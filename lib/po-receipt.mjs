// 발주서 입고: 기본은 자동, 필요할 때만 사람이 확인(2026-11-25 사용자 결정).
//
// - 어디로: 발주서 납품지 → 납품지에 연결한 '재고 위치'(우프 창고·생산처). 연결이 없으면 이름이
//   생산처와 같을 때 그 생산처. 그래도 모르면 자동으로 넣지 않고 사람에게 묻는다.
// - 언제: 직접 정한 날 > 발주서 납기일 > (지급완료일 · 없으면 지급요청일 · 없으면 발주일) + 품목 리드타임.
// - 선결제 거래처인데 아직 지급 전이면 자동 입고를 기다린다(물건이 안 나온다).
// - 재고에 넣는 것은 재고를 세는 자재(원자재·부자재·포장재)뿐. 공임·외주가공·운임은 넣지 않는다.
// 계산만 한다. 저장은 server.js.

const STOCK_TYPES = new Set(["RM", "SB", "PK"]);
const key = (s) => String(s || "").replace(/\s+/g, "").toLowerCase();

export function addDays(date, n) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + Number(n || 0));
  return d.toISOString().slice(0, 10);
}

// 재고에 들어갈 줄(품목이 연결된 자재 줄).
export function receiptLines(po, materials = []) {
  const byId = new Map(materials.map((m) => [m.id, m]));
  return (po.lineItems || []).map((l) => ({ line: l, material: byId.get(l.materialId) }))
    .filter(({ material }) => material && (material.itemKind || "material") === "material" && STOCK_TYPES.has(material.materialType || "SB"))
    .map(({ line, material }) => ({ materialId: material.id, code: material.code || "", name: material.itemName, qty: Number(line.quantity || 0), unit: line.unit || material.baseUnit || material.orderUnit || "", leadTimeDays: Number(material.leadTimeDays || 0) }));
}

export function receiptLocation(po, { deliveryPlaces = [], locations = [] } = {}) {
  const name = String(po.deliveryPlace?.name || "").trim();
  if (!name) return null;
  const place = deliveryPlaces.find((p) => key(p.name) === key(name));
  if (place?.stockLocation) return locations.find((l) => l.key === place.stockLocation) || null;
  return locations.find((l) => l.key !== "HQ" && key(name).includes(key(l.name))) || null;
}

export function expectedReceipt(po, { payments = [], lines = [], partner = null } = {}) {
  const linked = payments.filter((p) => p.poId === po.id && p.status !== "cancelled");
  const paid = linked.filter((p) => p.status === "paid" && p.paidAt).sort((a, b) => String(a.paidAt).localeCompare(String(b.paidAt)))[0];
  const waitingPayment = partner?.paymentTiming === "prepay" && !paid;
  if (po.expectedDate) return { date: po.expectedDate, basis: "직접 정한 날", waitingPayment };
  if (po.dueDate) return { date: po.dueDate, basis: "발주서 납기일", waitingPayment };
  const lead = Math.max(0, ...lines.map((l) => l.leadTimeDays || 0));
  const requested = linked.sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))[0];
  const [base, label] = paid ? [paid.paidAt, "지급완료"] : requested ? [String(requested.createdAt).slice(0, 10), "지급요청"] : [po.orderDate, "발주일"];
  return { date: addDays(base, lead), basis: `${label} ${String(base).slice(5).replace("-", "/")} + 리드타임 ${lead}일`, waitingPayment };
}

// 입고 안 된 발주서 한 건의 상태. autoOk 면 예정일에 자동 입고한다.
export function receiptPlan(po, ctx, today) {
  if ((po.docType || "purchase_order") !== "purchase_order" || ["received", "cancelled"].includes(po.status)) return null;
  const lines = receiptLines(po, ctx.materials);
  if (!lines.length) return null;
  const partner = (ctx.partners || []).find((p) => p.id === po.partnerId) || null;
  const location = receiptLocation(po, ctx);
  const exp = expectedReceipt(po, { payments: ctx.payments, lines, partner });
  const blockers = [];
  if (!location) blockers.push("입고 위치를 모름");
  if (exp.waitingPayment) blockers.push("선결제 — 아직 지급 전");
  if (po.autoReceive === false) blockers.push("자동 입고 꺼짐");
  const items = lines.map((l) => `${l.name} ${Number(l.qty).toLocaleString("ko-KR")}${l.unit}`);
  const what = items.length > 1 ? `${items[0]} 외 ${items.length - 1}건` : items[0];
  return {
    poId: po.id, docNo: po.docNo, partnerName: partner?.name || "", lines, location, expected: exp.date, basis: exp.basis,
    blockers, autoOk: !blockers.length, due: exp.date <= today, overdue: exp.date < today && blockers.length > 0,
    message: `${partner?.name || "거래처"}의 ${what}이(가) ${location?.name || po.deliveryPlace?.name || "납품지"}에 ${exp.date.slice(5).replace("-", "/")} 입고예정입니다. 입고를 확인하세요.`
  };
}

// 입고 기록(재고 +). qtys: { materialId: 실제 수량 } — 없으면 발주 수량.
export function receiptMoves(po, plan, { date, location, qtys = {}, by = "", auto = false } = {}) {
  return plan.lines.map((l) => ({
    materialId: l.materialId, location: location || plan.location?.key || "", type: "in",
    qty: Math.round(Number(qtys[l.materialId] ?? l.qty) * 1000) / 1000, date,
    refType: "purchaseOrder", refId: po.id,
    memo: `${po.docNo} ${plan.partnerName} 입고${auto ? "(자동)" : ""}`, createdBy: by
  })).filter((m) => m.qty > 0 && m.location);
}
