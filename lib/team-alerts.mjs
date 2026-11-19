// 팀챗 알림: pay 알림을 슬랙 채널(Incoming Webhook)로 보내면, 채널톡의 슬랙 연동이
// 그 채널을 팀챗 방 하나(alert)로 옮겨 준다(2026-11-20 연결 확인).
// 사람 태그는 슬랙→채널톡 경로에서 되지 않아 쓰지 않는다 — 방 알림을 모두 켜 두고 다 같이 본다.

// mode: auto(일어나면 바로) / manual(요청할 때 '팀챗 전송'을 체크하거나, 나중에 골라 보냄) / off
export const EVENTS = {
  request: { label: "입금요청 등록", mode: "manual" },
  payment: { label: "지급요청 등록", mode: "manual" },
  invoice: { label: "계산서발행 요청", mode: "manual" },
  product_registered: { label: "신상품 미진열 등록", mode: "auto" },
  deposit_confirm: { label: "카페24 입금확인", mode: "off" }
};

export const DEFAULT_TEAM_ALERTS = { enabled: false, events: {} };

// pay 안의 알림 종류 → 팀챗 알림 종류
const KIND_TO_EVENT = { request_new: "request", request_batch: "request", payment_new: "payment", deposit_confirm: "deposit_confirm", product_registered: "product_registered" };
export const eventOf = (kind) => KIND_TO_EVENT[kind] || kind;

export function eventConfig(cfg, event) {
  const base = EVENTS[event];
  if (!base) return null;
  const saved = (cfg?.events || {})[event] || {};
  return { ...base, ...(["auto", "manual", "off"].includes(saved.mode) ? { mode: saved.mode } : {}) };
}

// 자동으로 보낼 일인지(pushNotice 에서 부른다).
export function planAuto(cfg, kind) {
  const event = eventOf(kind);
  const ev = eventConfig(cfg, event);
  if (!cfg?.enabled || !ev || ev.mode !== "auto") return null;
  return { event };
}

// 슬랙 글: 첫 줄은 굵게 '[알림종류] 제목', 다음 줄부터 내용.
const esc = (s) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export function slackTextFor(notice, { event } = {}) {
  const label = EVENTS[event]?.label || "알림";
  const title = String(notice.title || "").trim();
  const body = String(notice.text || "").trim();
  return [`*[${esc(label)}] ${esc(title)}*`, body ? esc(body) : ""].filter(Boolean).join("\n").slice(0, 3800);
}

export function productRegisteredNotice({ brandName, count, products = [] }) {
  return {
    title: `${brandName} 신상품 ${count}건 미진열 등록`,
    text: `${brandName}의 ${count}건의 새로운 제품이 미진열로 등록되었습니다. 카페24 어드민에서 분류 지정 및 검수 후 진열로 변경해주세요.${products.length ? `\n${products.slice(0, 20).map((p) => `- ${p.productNo} ${p.name || ""}`).join("\n")}` : ""}`
  };
}

export const isSlackWebhook = (url) => /^https:\/\/hooks\.slack\.com\/services\/[\w/]+$/.test(String(url || "").trim());

export async function postSlack({ webhook, text }, fetchImpl = fetch) {
  if (!webhook) throw new Error("슬랙 웹훅 주소가 없습니다(알림 설정에서 넣어 주세요).");
  if (!isSlackWebhook(webhook)) throw new Error("슬랙 웹훅 주소가 올바르지 않습니다(https://hooks.slack.com/services/...).");
  const res = await fetchImpl(webhook, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, mrkdwn: true, username: "WOOOF ERP" })
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(res.status === 403 || res.status === 404
      ? `슬랙이 거절했습니다(${res.status}) — 웹훅 주소가 지워졌거나 바뀌었는지 확인하세요.`
      : `슬랙 오류 ${res.status}: ${t.slice(0, 120)}`);
  }
  return { ok: true };
}
