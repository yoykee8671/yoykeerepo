// 판매 파이프라인 (v2).
//
// 지금은 주문이 오면 대표가 명세서를 엑셀로 따로 만들어 업체에 보내고, 노션에
// 계산서 발행을 요청하고, 입금은 통장을 보고 확인한다. 한 주문이 이 단계를
// 순서대로 지나가게 하고, 계산서까지 냈는데 덜 들어온 돈은 '받을 돈'으로 모은다.
//
//   주문접수 → 명세서 → 업체전달 → 청구·계산서 → 입금확인
//
// 명세서는 기존 '명세서 발행'(purchaseOrders, 거래명세서) 기록을 그대로 만든다.

export const SALES_STAGES = [
  ["received", "주문접수"],
  ["statement", "명세서"],
  ["sent", "업체전달"],
  ["invoiced", "청구·계산서"],
  ["paid", "입금확인"]
];
export const SALES_STAGE_LABELS = { ...Object.fromEntries(SALES_STAGES), on_hold: "보류", cancelled: "취소" };

export const INVOICE_TYPES = ["세금계산서", "계산서", "영수증", "미발행"];
// 노션 '세금계산서 발행 요청' 상태와 같은 말.
export const INVOICE_STATUSES = { requested: "요청", issued: "완료", on_hold: "보류/대기", cancelled: "취소" };
export const SEND_METHODS = ["메일", "카카오톡", "팩스", "택배동봉", "직접전달"];

const stageIndex = (key) => SALES_STAGES.findIndex(([k]) => k === key);

export function paidTotal(order) {
  return (order?.receipts || []).reduce((s, r) => s + Number(r.amount || 0), 0);
}

export function remaining(order) {
  return Math.max(0, Number(order?.total || 0) - paidTotal(order));
}

// 지금 단계. 기록된 사실(명세서·전달·계산서·입금)에서 다시 계산한다 — 손으로
// 단계를 고치다 어긋나는 일을 막는다.
export function deriveStage(order) {
  const o = order || {};
  if (o.cancelledAt) return "cancelled";
  if (o.onHold) return "on_hold";
  if (Number(o.total || 0) > 0 && remaining(o) === 0) return "paid";
  if (o.invoice?.requestedAt) return "invoiced";
  if (o.sentAt) return "sent";
  if (o.statementId) return "statement";
  return "received";
}

// 다음에 할 일 한 줄. 목록에서 담당자가 바로 누를 버튼을 고르는 데 쓴다.
export function nextAction(order) {
  switch (deriveStage(order)) {
    case "received": return "statement";
    case "statement": return "send";
    case "sent": return "invoice";
    case "invoiced": return order?.invoice?.status === "requested" ? "issue" : "receive";
    default: return "";
  }
}

export function stageReached(order, key) {
  const now = deriveStage(order);
  if (now === "cancelled" || now === "on_hold") return false;
  return stageIndex(now) >= stageIndex(key);
}

// 받을 돈(미수금): 업체에 전달했거나 계산서를 낸 주문 중 덜 들어온 돈.
// 기한은 입금기한 → 계산서 요청 시 정한 기한 순.
export function receivables(orders, today) {
  const t = String(today || "").slice(0, 10);
  return (orders || [])
    .filter((o) => ["sent", "invoiced"].includes(deriveStage(o)) && remaining(o) > 0)
    .map((o) => {
      const due = String(o.invoice?.dueDate || o.dueDate || "").slice(0, 10);
      return {
        id: o.id, code: o.code, partnerName: o.partnerName || "", title: o.title || "",
        total: Number(o.total || 0), paid: paidTotal(o), remaining: remaining(o),
        dueDate: due, overdue: Boolean(due && t && due < t)
      };
    })
    .sort((a, b) => (a.dueDate || "9999").localeCompare(b.dueDate || "9999"));
}
