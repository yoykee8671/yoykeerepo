// 원부자재 재고 (v2).
//
// 공장이 원부자재를 제대로 관리하지 못해, 우리가 넣어준 양·생산한 양·남은 양·
// 발주 단위·발주 필요를 직접 계산해 왔다(포포타올·콘디·필바이츠). 여기서는
//   - 입출고 기록(stockMoves)을 쌓아 품목 × 보관처 재고를 계산하고
//   - 제품 구성(BOM)과 생산 기록으로 생산 투입량을 자동 차감하고
//   - 예정 생산이 쓸 양을 빼고도 안전재고 아래로 가면 '발주 필요'와 추천 발주량
//     (발주 단위로 올림)을 낸다.
//
// 수량은 모두 재고단위(개·m·kg 등) 기준이다.

export const MOVE_TYPES = {
  in: "입고",          // 구매·공장에 넣어줌 (+)
  use: "생산투입",     // 생산 완료 시 자동 (−)
  out: "반출·폐기",    // (−)
  move_out: "이동(보냄)",
  move_in: "이동(받음)",
  adjust: "실사 조정"  // 센 수량과의 차이 (±)
};

const round3 = (n) => Math.round(Number(n || 0) * 1000) / 1000;

// 입출고 기록의 부호 있는 수량.
export function signedQty(move) {
  const q = Number(move?.qty || 0);
  switch (move?.type) {
    case "in": case "move_in": return q;
    case "use": case "out": case "move_out": return -Math.abs(q);
    case "adjust": return q; // 이미 차이(±)로 저장한다
    default: return 0;
  }
}

// 품목 × 보관처 재고. { "materialId|location": qty }
export function stockByLocation(moves) {
  const out = {};
  for (const m of moves || []) {
    if (m.voided) continue;
    const key = `${m.materialId}|${m.location || ""}`;
    out[key] = round3((out[key] || 0) + signedQty(m));
  }
  return out;
}

// 제품 n개를 만들 때 드는 원부자재 (손실률 포함).
export function requirements(product, quantity) {
  return (product?.lines || [])
    .filter((l) => l.materialId && l.basis !== "lot" && Number(l.perUnit) > 0)
    .map((l) => ({
      materialId: l.materialId,
      qty: round3(Number(quantity || 0) * Number(l.perUnit) * (1 + Number(l.lossRate || 0) / 100))
    }));
}

// 생산 완료 시 만들 생산투입 기록들.
export function consumptionMoves(run, product) {
  return requirements(product, run.quantity).map((r) => ({
    materialId: r.materialId,
    location: run.location || "",
    type: "use",
    qty: r.qty,
    date: run.date,
    refType: "production",
    refId: run.id,
    memo: `${product?.name || ""} ${Number(run.quantity).toLocaleString("ko-KR")}개 생산`
  }));
}

// 재고현황 한 줄씩. settings: { [materialId]: { safetyStock, orderMultiple, unit, leadTimeDays } }
export function stockStatus({ materials = [], moves = [], runs = [], products = [], settings = {} }) {
  const byLoc = stockByLocation(moves);
  const productById = new Map(products.map((p) => [p.id, p]));
  // 예정 생산이 쓸 양
  const planned = {};
  for (const run of runs) {
    if (run.status !== "planned") continue;
    for (const r of requirements(productById.get(run.productId), run.quantity)) {
      planned[r.materialId] = round3((planned[r.materialId] || 0) + r.qty);
    }
  }
  const tracked = new Set([
    ...Object.keys(settings).filter((k) => settings[k]?.tracked !== false),
    ...moves.map((m) => m.materialId),
    ...products.flatMap((p) => (p.lines || []).map((l) => l.materialId))
  ]);
  return materials
    .filter((m) => tracked.has(m.id))
    .map((m) => {
      const s = settings[m.id] || {};
      const locations = Object.entries(byLoc)
        .filter(([k]) => k.startsWith(`${m.id}|`))
        .map(([k, qty]) => ({ location: k.slice(m.id.length + 1), qty }))
        .filter((l) => l.qty !== 0);
      const onHand = round3(locations.reduce((a, l) => a + l.qty, 0));
      const plannedUse = planned[m.id] || 0;
      const available = round3(onHand - plannedUse);
      const safety = Number(s.safetyStock || 0);
      const need = available < safety;
      const multiple = Math.max(0, Number(s.orderMultiple || 0));
      const shortBy = round3(safety - available);
      const suggest = need ? (multiple > 0 ? Math.ceil(shortBy / multiple) * multiple : shortBy) : 0;
      return {
        materialId: m.id, code: m.code || "", name: m.itemName, partnerId: m.partnerId || "",
        unit: s.unit || m.orderUnit || "", locations, onHand, plannedUse, available,
        safetyStock: safety, orderMultiple: multiple, leadTimeDays: Number(s.leadTimeDays ?? m.leadTimeDays ?? 0),
        needOrder: need, suggestOrder: round3(suggest), negative: onHand < 0
      };
    })
    .sort((a, b) => Number(b.needOrder) - Number(a.needOrder) || String(a.name).localeCompare(String(b.name), "ko"));
}

// 지금 그 보관처 재고로 만들 수 있는 제품 수 (가장 모자란 원부자재 기준).
export function producible(product, moves, location) {
  const byLoc = stockByLocation(moves);
  const lines = (product?.lines || []).filter((l) => l.materialId && l.basis !== "lot" && Number(l.perUnit) > 0);
  if (!lines.length) return { quantity: 0, limitedBy: "" };
  let best = Infinity;
  let limitedBy = "";
  for (const l of lines) {
    const per = Number(l.perUnit) * (1 + Number(l.lossRate || 0) / 100);
    const have = byLoc[`${l.materialId}|${location || ""}`] || 0;
    const can = Math.floor(Math.max(0, have) / per + 1e-9);
    if (can < best) { best = can; limitedBy = l.materialId; }
  }
  return { quantity: best === Infinity ? 0 : best, limitedBy };
}
