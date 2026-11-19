// 팀챗 알림(채널톡): pay 알림을 깃허브 저장소의 이슈로 만들면, 채널톡 GitHub 앱이
// 팀챗 방에 올려 준다(2026-11-19 연결 확인). 방은 이슈 라벨로 가른다 — 채널톡 알림방
// 설정의 '필수 라벨'에 방마다 라벨을 하나씩 넣는다. 이슈 본문의 @아이디는 채널톡 매니저
// 프로필 데이터 github-username 과 같으면 그 사람이 태그된다.

export const ROOMS = {
  payment: { name: "결제및계산서요청", label: "결제요청" },
  brand: { name: "우프_브랜드", label: "브랜드" },
  erp: { name: "wooof_erp", label: "erp" }
};

// mode: auto(일어나면 바로) / manual(요청할 때 '팀챗 전송'을 체크하거나, 나중에 골라 보냄) / off
export const EVENTS = {
  request: { label: "입금요청 등록", room: "payment", mode: "manual", tags: ["yebin"] },
  payment: { label: "지급요청 등록", room: "payment", mode: "manual", tags: ["yebin"] },
  invoice: { label: "계산서발행 요청", room: "payment", mode: "manual", tags: ["yebin"] },
  product_registered: { label: "신상품 미진열 등록", room: "brand", mode: "auto", tags: ["yjr"] },
  deposit_confirm: { label: "카페24 입금확인", room: "erp", mode: "off", tags: [] }
};

export const DEFAULT_PEOPLE = [
  { key: "kyo", name: "이교영", github: "wooof-kyo" },
  { key: "yebin", name: "김예빈", github: "wooof-yebin" },
  { key: "yjr", name: "유재량", github: "wooof-yjr" }
];

export const DEFAULT_TEAM_ALERTS = { enabled: false, repo: "wooof-team/pay-alerts", people: DEFAULT_PEOPLE, events: {} };

// pay 안의 알림 종류 → 팀챗 알림 종류
const KIND_TO_EVENT = { request_new: "request", request_batch: "request", payment_new: "payment", deposit_confirm: "deposit_confirm", product_registered: "product_registered" };
export const eventOf = (kind) => KIND_TO_EVENT[kind] || kind;

export function eventConfig(cfg, event) {
  const base = EVENTS[event];
  if (!base) return null;
  return { ...base, ...((cfg?.events || {})[event] || {}) };
}

// 채널톡 '이슈 생성' 알림은 제목·라벨만 보여 주고 @태그·담당자를 사람으로 바꾸지 않는다
// (2026-11-19 시험). 그래서 고른 사람은 제목 끝에 '확인: 이름'으로 적는다.
export function mentionsFor(cfg, tagKeys = []) {
  const keys = new Set(tagKeys);
  return (cfg?.people || DEFAULT_PEOPLE).filter((p) => keys.has(p.key) && p.name).map((p) => String(p.name).trim());
}

// 자동으로 보낼 일인지(pushNotice 에서 부른다).
export function planAuto(cfg, kind) {
  const event = eventOf(kind);
  const ev = eventConfig(cfg, event);
  if (!cfg?.enabled || !ev || ev.mode !== "auto") return null;
  return { event, room: ev.room, mentions: mentionsFor(cfg, ev.tags) };
}

export function issueFor(notice, { event, room, mentions = [] }) {
  const ev = EVENTS[event] || { label: "알림" };
  const who = mentions.length ? ` · 확인: ${mentions.join(", ")}` : "";
  const title = `[${ev.label}] ${String(notice.title || "").trim()}`.slice(0, 250 - who.length) + who;
  const body = [String(notice.text || "").trim(), mentions.length ? `\n확인: ${mentions.join(", ")}` : "", "\n— WOOOF ERP(pay)"].join("\n").trim();
  return { title, body, labels: [ROOMS[room]?.label || ROOMS.erp.label] };
}

export function productRegisteredNotice({ brandName, count, products = [] }) {
  return {
    title: `${brandName} 신상품 ${count}건 미진열 등록`,
    text: `${brandName}의 ${count}건의 새로운 제품이 미진열로 등록되었습니다. 카페24 어드민에서 분류 지정 및 검수 후 진열로 변경해주세요.${products.length ? `\n${products.slice(0, 20).map((p) => `- ${p.productNo} ${p.name || ""}`).join("\n")}` : ""}`
  };
}

export async function createIssue({ repo, token, title, body, labels = [] }, fetchImpl = fetch) {
  if (!token) throw new Error("깃허브 토큰이 없습니다(알림 설정에서 넣어 주세요).");
  if (!/^[\w.-]+\/[\w.-]+$/.test(String(repo || ""))) throw new Error("저장소 이름이 올바르지 않습니다(예: wooof-team/pay-alerts).");
  const res = await fetchImpl(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "content-type": "application/json", "user-agent": "wooof-erp" },
    body: JSON.stringify({ title, body, labels })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(res.status === 401 || res.status === 403 || res.status === 404
      ? `깃허브가 거절했습니다(${res.status}) — 토큰 권한(pay-alerts 저장소 Issues 쓰기)을 확인하세요.`
      : `깃허브 오류 ${res.status}: ${text.slice(0, 120)}`);
  }
  const j = await res.json();
  return { number: j.number, url: j.html_url };
}
