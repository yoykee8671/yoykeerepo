// 월 마감 (v2). 이카운트의 '편집제한일자'와 '미○○ 현황'을 우리 메뉴에 맞춘 것.
//
// - 마감한 달(lockedThrough 까지)의 자료는 서버가 수정·삭제를 거부한다:
//   입금요청(그 달 주문), 처리완료된 지급요청(그 달 지급), 월 정산 현황(그 달), 현금흐름표 칸(그 날).
// - 마감 전 점검: 그 달에 아직 끝나지 않은 일을 센다. 0건이 아니어도 대표가 사유를 남기고 마감할 수 있다.
// - 마감·해제는 대표만, 기록(history)을 남긴다.

export const ym = (d) => String(d || "").slice(0, 7);
export const isYm = (s) => /^\d{4}-\d{2}$/.test(String(s || ""));

export function isLocked(closing, month) {
  const through = closing?.lockedThrough || "";
  return Boolean(through && isYm(month) && month <= through);
}

export function lockedMessage(month) {
  return `${month} 은(는) 마감된 달이라 고칠 수 없습니다. 고쳐야 하면 대표가 정산 > 월 마감에서 마감을 풀어 주세요.`;
}

export function prevMonth(month) {
  const [y, m] = month.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

const OPEN_REQUEST = new Set(["pending", "await_deposit", "consignment_unpaid"]);
const OPEN_PAYMENT = new Set(["requested", "confirmed", "awaiting_approval", "on_hold"]);

// 그 달에 끝나지 않은 일. items: [{ key, label, count, hint, go: {tab, sub?} }]
export function closingCheck({ month, requests = [], requestMonth, payments = [], boardRows = [], questions = [], stock = [], overdueSales = [] }) {
  const items = [];
  const add = (key, label, list, hint, go) => items.push({ key, label, count: list.length, hint, go, sample: list.slice(0, 5) });
  add("requests", "입금 안 된 입금요청", requests.filter((r) => requestMonth(r) === month && OPEN_REQUEST.has(r.status))
    .map((r) => `${r.brandName || ""} ${r.orderNo || ""}`.trim()), "입금 처리하거나 취소하세요.", { tab: "requests" });
  add("payments", "처리 안 된 지급요청", payments.filter((p) => OPEN_PAYMENT.has(p.status) && ym(p.dueDate || p.createdAt) <= month)
    .map((p) => `${p.code || ""} ${p.title || ""}`.trim()), "처리완료·보류·취소 중 하나로 정리하세요.", { tab: "payments" });
  const active = boardRows.filter((r) => Number(r.sales || 0) || Number(r.shipping || 0) || Number(r.recovered || 0));
  add("unchecked", "월 정산 현황 미확인 브랜드", active.filter((r) => !r.checked).map((r) => r.brandName), "숫자를 보고 '확인'을 체크하세요.", { tab: "monthly" });
  add("unsent", "정산서 미발송 브랜드", active.filter((r) => !r.sent).map((r) => r.brandName), "정산서를 보내고 '발송'을 체크하세요.", { tab: "monthly" });
  add("diffs", "시트와 숫자가 다른 브랜드", active.filter((r) => (r.diffs || []).length).map((r) => r.brandName), "차이를 확인하세요.", { tab: "monthly" });
  add("questions", "답하지 않은 확인 필요", questions.filter((q) => q.status === "open").map((q) => q.title), "확인 필요 메뉴에서 답하세요.", { tab: "setup" });
  add("overdueSales", "입금기한 지난 판매 미수", overdueSales, "거래처에 입금을 확인하거나 기한을 바꾸세요.", { tab: "trade", sub: "sales" });
  add("negative", "마이너스 재고", stock.filter((s) => s.negative).map((s) => s.name), "입출고 기록을 확인하세요.", { tab: "trade", sub: "stock" });
  return { month, items, open: items.reduce((s, i) => s + i.count, 0) };
}
