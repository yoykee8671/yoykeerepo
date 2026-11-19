// 팀챗 알림: pay 알림을 슬랙 봇(chat.postMessage)으로 #notice 에 쓰면, 채널톡의 슬랙 연동이
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

export const isSlackBotToken = (t) => /^xoxb-[\w-]+$/.test(String(t || "").trim());
const SLACK_ERRORS = {
  invalid_auth: "봇 토큰이 틀렸습니다", not_authed: "봇 토큰이 없습니다", account_inactive: "봇 토큰이 해지됐습니다",
  token_revoked: "봇 토큰이 해지됐습니다", channel_not_found: "채널을 찾지 못했습니다(채널 이름·ID 확인)",
  not_in_channel: "봇이 채널에 없습니다(채널에서 /invite @알림)", missing_scope: "봇 권한(chat:write)이 없습니다"
};

// 웹훅 글은 채널톡에 번호(B...)로만 보여서 봇 토큰만 쓴다(2026-11-20).
export async function postSlackBot({ token, channel, text }, fetchImpl = fetch) {
  if (!isSlackBotToken(token)) throw new Error("슬랙 봇 토큰이 없거나 올바르지 않습니다(xoxb-...).");
  if (!channel) throw new Error("보낼 슬랙 채널이 없습니다(예: #notice).");
  const res = await fetchImpl("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8", authorization: `Bearer ${token}` },
    body: JSON.stringify({ channel, text, mrkdwn: true })
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || !j.ok) throw new Error(`슬랙이 거절했습니다 — ${SLACK_ERRORS[j.error] || j.error || res.status}`);
  return { ok: true };
}
