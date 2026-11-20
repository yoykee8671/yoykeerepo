// 메신저 공유함 (v2). 담당자가 봐야 할 일을 한 줄 알림으로 쌓고, 팀챗에 공유한다.
//
// - 지금(채널톡 무료 플랜): Open API 를 쓸 수 없어 [복사] → 팀챗에 붙여 넣기.
// - 나중(키·비밀값 + Startup 이상): 설정에서 '시험'(내 계정에만 공지) 또는 '실제'(팀챗 그룹)로 켜면
//   [채널톡 보내기]와 자동 발송이 동작한다. 키는 환경변수 CHANNEL_ACCESS_KEY / CHANNEL_ACCESS_SECRET 에만 둔다.
// API: https://api-doc.channel.works (Channel-Version 2026-06-01)
//   팀챗 그룹   POST /open/groups/{groupId}/messages?botName=..   {plainText}
//   매니저 공지 POST /open/announcements/announce?managerIds=..&botName=..  {plainText}

export const NOTICE_KINDS = {
  request_new: "입금요청 등록",
  request_batch: "입금요청 등록(묶음)",
  request_paid: "입금 완료",
  payment_new: "지급요청 등록",
  payment_confirm: "지급요청 확인",
  payment_approval: "허가 필요",
  payment_paid: "지급 완료",
  evidence: "증빙 발행 완료",
  closing: "월 마감",
  deposit_confirm: "카페24 입금확인",
  daily: "일일 보고",
  manual: "직접 작성"
};

export const DEFAULT_MESSENGER = { mode: "off", groupId: "24726", botName: "WOOOF ERP", testManagerId: "", autoKinds: [] };

const won = (n) => `${Math.round(Number(n || 0)).toLocaleString("ko-KR")}원`;
const wonSp = (n) => `${Math.round(Number(n || 0)).toLocaleString("ko-KR")} 원`;
const sum = (items) => items.reduce((s, x) => s + Number(x.amount || 0), 0);

// 입금 완료·지급완료·증빙 발행 완료 복사 문구. 여러 알림을 합칠 때도 같은 함수를 쓴다(화면 public/app.js 에 같은 규칙).
export const EVIDENCE_KINDS = ["매입세금", "매출세금", "영세", "거래명세서", "청구서", "발주서", "영수증", "기타"];
export function paidText(kind, items) {
  const head = { request_paid: "입금 완료", payment_paid: "지급완료", evidence: "증빙 발행 완료" }[kind];
  const line = {
    request_paid: (x) => [x.brandName, x.orderNo, x.customerName, won(x.amount)].filter(Boolean).join(" "),
    payment_paid: (x) => `${[x.payee, x.title].filter(Boolean).join(" ")} ${wonSp(x.amount)}`,
    evidence: (x) => `${[x.cat, x.partner].filter(Boolean).join(" ")} ${wonSp(x.amount)}${x.memo ? ` |  ${x.memo}` : ""}`
  }[kind];
  return [`[${head}] ${items.length}건 · 합계 ${won(sum(items))}`, ...items.map((x, i) => `[${i + 1}] ${line(x)}`)].join("\n");
}

// 이벤트 → 알림 {kind, title, text, ref}
export function noticeFor(kind, d = {}) {
  switch (kind) {
    case "request_new":
      return { title: `${d.brandName} 입금요청 ${won(d.depositAmount)}`,
        text: `[입금요청] ${d.brandName} · 주문 ${d.orderNo || "-"} · ${d.customerName || ""}\n입금액 ${won(d.depositAmount)}${d.expectedDepositDate ? ` · 예정일 ${d.expectedDepositDate}` : ""}${d.by ? ` · 등록 ${d.by}` : ""}` };
    case "request_batch": {
      const items = d.items || [];
      const total = items.reduce((sum, x) => sum + Number(x.depositAmount || 0), 0);
      const byBrand = new Map();
      for (const x of items) byBrand.set(x.brandName, (byBrand.get(x.brandName) || 0) + 1);
      const lines = items.map((x) => `- ${x.brandName} ${x.orderNo || ""} ${x.customerName || ""} ${won(x.depositAmount)}`);
      return { title: `입금요청 ${items.length}건 ${won(total)}${d.source ? ` (${d.source})` : ""}`,
        text: `[입금요청] ${items.length}건 · 합계 ${won(total)}${d.source ? ` · ${d.source}` : ""}${d.by ? ` · ${d.by}` : ""}\n${[...byBrand.entries()].map(([b, n]) => `${b} ${n}건`).join(", ")}\n${lines.slice(0, 20).join("\n")}${lines.length > 20 ? `\n외 ${lines.length - 20}건` : ""}` };
    }
    case "request_paid": {
      // [입금 완료] 4건 · 합계 131,630원 / [1] 릴리스키친 20261119-0000028 홍길동 15,250원
      const items = (d.items || []).map((x) => ({ brandName: x.brandName || "", orderNo: x.orderNo || "", customerName: x.customerName || "", amount: Number(x.paidAmount ?? x.amount ?? x.depositAmount ?? 0) }));
      return { title: `입금 완료 ${items.length}건 ${won(sum(items))}`, text: paidText("request_paid", items), items };
    }
    case "payment_new":
      return { title: `지급요청 ${d.code || ""} ${d.title} ${won(d.amount)}`,
        text: `[지급요청] ${d.code || ""} ${d.title}\n${won(d.amount)} → ${d.payeeName || d.holder || ""} ${d.bankName || ""}${d.dueDate ? ` · 기한 ${d.dueDate}` : ""}${d.by ? ` · 요청 ${d.by}` : ""}` };
    case "payment_confirm":
      return { title: `지급요청 확인 ${d.code || ""} ${d.title}`, text: `[지급요청 확인] ${d.code || ""} ${d.title} ${won(d.amount)} · 확인 ${d.by || ""}` };
    case "payment_approval":
      return { title: `허가 필요 ${d.code || ""} ${d.title} ${won(d.amount)}`, text: `[대표 허가 필요] ${d.code || ""} ${d.title} ${won(d.amount)} (기준금액 이상) · 확인 ${d.by || ""}` };
    case "payment_paid": {
      // [지급완료] 2건 · 합계 131,630원 / [1] 태성산업 내용 67,155 원
      const items = [{ payee: d.payeeName || d.holder || "", title: `${d.title || ""}`.trim(), amount: Number(d.amount || 0) }];
      return { title: `지급 완료 ${d.code || ""} ${d.title}`, text: paidText("payment_paid", items), items };
    }
    case "evidence": {
      // [증빙 발행 완료] 1건 · 합계 131,630원 / [1] 매입세금 소일베이커 131,630 원 |  내용
      const items = (d.items || []).map((x) => ({ cat: String(x.cat || "기타"), partner: String(x.partner || ""), amount: Number(String(x.amount ?? 0).replace(/,/g, "")) || 0, memo: String(x.memo || "") }));
      return { title: `증빙 발행 완료 ${items.length}건 ${won(sum(items))}`, text: paidText("evidence", items), items };
    }
    case "deposit_confirm": {
      const lines = (d.items || []).map((x) => `- ${x.orderId} ${x.depositor || ""} ${won(x.amount)}`);
      return { title: `카페24 입금확인 ${d.items?.length || 0}건`, text: `[카페24 입금확인] ${d.items?.length || 0}건 처리(${d.by || "자동"})\n${lines.slice(0, 30).join("\n")}${lines.length > 30 ? `\n외 ${lines.length - 30}건` : ""}` };
    }
    case "closing":
      return { title: `${d.month} 월 마감`, text: `[월 마감] ${d.month} 까지 마감했습니다.${d.note ? ` (${d.note})` : ""} · ${d.by || ""}` };
    default:
      return { title: d.title || NOTICE_KINDS[kind] || "알림", text: d.text || "" };
  }
}

export function channelConfigured(env = process.env) {
  return Boolean(String(env.CHANNEL_ACCESS_KEY || "").trim() && String(env.CHANNEL_ACCESS_SECRET || "").trim());
}

// 보낼 곳. 시험 모드는 내 매니저 계정에만(팀챗 그룹에는 절대 안 감).
export function channelTarget(cfg) {
  const bot = encodeURIComponent(String(cfg.botName || "WOOOF ERP").slice(0, 30));
  if (cfg.mode === "test") {
    if (!/^\d+$/.test(String(cfg.testManagerId || ""))) return { error: "시험 모드에는 내 매니저 ID 가 필요합니다." };
    return { path: `/open/announcements/announce?managerIds=${cfg.testManagerId}&botName=${bot}` };
  }
  if (cfg.mode === "live") {
    if (!/^\d+$/.test(String(cfg.groupId || ""))) return { error: "팀챗 그룹 ID 가 필요합니다." };
    return { path: `/open/groups/${cfg.groupId}/messages?botName=${bot}` };
  }
  return { error: "채널톡 보내기가 꺼져 있습니다." };
}

export async function sendToChannel(cfg, text, { env = process.env, fetchImpl = fetch } = {}) {
  if (!channelConfigured(env)) return { ok: false, error: "채널톡 키·비밀값이 없습니다(무료 플랜은 Open API 불가)." };
  const target = channelTarget(cfg);
  if (target.error) return { ok: false, error: target.error };
  const res = await fetchImpl(`https://api.channel.io${target.path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-access-key": env.CHANNEL_ACCESS_KEY, "x-access-secret": env.CHANNEL_ACCESS_SECRET, "Channel-Version": "2026-06-01" },
    body: JSON.stringify({ plainText: String(text).slice(0, 4000) })
  });
  if (!res.ok) {
    let msg = "";
    try { msg = (await res.json())?.errors?.[0]?.message || ""; } catch {}
    return { ok: false, error: `채널톡 ${res.status}${msg ? `: ${msg}` : ""}` };
  }
  return { ok: true, target: cfg.mode };
}
