// 팀챗 알림(채널톡): pay 알림을 깃허브 저장소의 이슈로 만들면, 채널톡 GitHub 앱이
// 지정한 팀챗 방(wooof_erp)에 올려 준다(2026-11-19 연결 확인). 이슈 본문의 @깃허브아이디는
// 채널톡 매니저 프로필의 github-username 과 맞으면 그 사람이 태그된다.

export const ALERT_KINDS = {
  request_new: "입금요청 발생",
  payment_new: "지급요청 발생",
  request_paid: "입금 완료",
  payment_approval: "대표 허가 필요",
  deposit_confirm: "카페24 입금확인"
};
// 입금요청 발생은 화면 입력(request_new)과 주문매칭 묶음(request_batch)을 같이 뜻한다.
export const KIND_GROUP = { request_batch: "request_new" };

export const DEFAULT_TEAM_ALERTS = {
  enabled: false,
  repo: "wooof-team/pay-alerts",
  kinds: ["request_new", "payment_new"],
  people: [
    { name: "김예빈", github: "", on: true, kinds: ["request_new", "payment_new"] },
    { name: "이교영", github: "yoykee8671", on: false, kinds: ["request_new", "payment_new"] }
  ]
};

export function alertKindOf(kind) {
  return KIND_GROUP[kind] || kind;
}

// 보낼지와 태그할 사람을 정한다.
export function planAlert(cfg, kind) {
  const k = alertKindOf(kind);
  if (!cfg?.enabled || !(cfg.kinds || []).includes(k)) return null;
  const mentions = (cfg.people || [])
    .filter((p) => p.on && p.github && (p.kinds || []).includes(k))
    .map((p) => `@${String(p.github).replace(/^@/, "").trim()}`)
    .filter((m) => /^@[A-Za-z0-9-]{1,39}$/.test(m));
  return { kind: k, mentions };
}

export function issueFor(notice, plan) {
  const title = String(notice.title || "알림").slice(0, 200);
  const body = [notice.text || "", plan.mentions.length ? `\n${plan.mentions.join(" ")} 확인해 주세요.` : "", "\n— WOOOF ERP(pay)"].join("\n").trim();
  return { title: `[${ALERT_KINDS[plan.kind] || "알림"}] ${title}`.slice(0, 250), body };
}

export async function createIssue({ repo, token, title, body }, fetchImpl = fetch) {
  if (!token) throw new Error("깃허브 토큰이 없습니다(알림 설정에서 넣어 주세요).");
  if (!/^[\w.-]+\/[\w.-]+$/.test(String(repo || ""))) throw new Error("저장소 이름이 올바르지 않습니다(예: wooof-team/pay-alerts).");
  const res = await fetchImpl(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", "content-type": "application/json", "user-agent": "wooof-erp" },
    body: JSON.stringify({ title, body })
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
