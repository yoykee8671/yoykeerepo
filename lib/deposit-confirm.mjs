// 카페24 무통장 '입금전' 주문 ↔ 클로브 은행 입금 → 자동 입금확인.
//
// 운영 직원은 통장 내역(클로브)을 볼 필요 없이, 확실한 건은 서버가 카페24에 입금확인을 넣는다.
// '확실' = 금액이 같고, 입금자명이 맞고, 주문일 이후 windowDays 안의 입금이며, 그 입금과 그 주문이
// 서로 단 하나뿐인 짝일 때. 나머지(이름이 다르거나 후보가 여럿)는 경영관리가 보고 손으로 처리한다.
// 카페24: PUT /api/v2/admin/payments {status:"paid"} (mall.write_order).

const DAY = 86400000;
const INTERNAL = new Set(["계좌간 입금", "계좌간 출금", "계좌간 이체"]);

export const normName = (s) => String(s || "")
  .replace(/\(.*?\)|주식회사|㈜|\(주\)/g, "")
  .replace(/[^0-9a-zA-Z가-힣]/g, "")
  .toLowerCase();

// 은행 입금자명은 앞 몇 글자만 찍히기도 한다(예: '홍길동우프' → '홍길동우'). 짧은 쪽이 긴 쪽의 앞부분이면 같다고 본다.
export function namesMatch(a, b) {
  const x = normName(a);
  const y = normName(b);
  if (x.length < 2 || y.length < 2) return false;
  return x === y || x.startsWith(y) || y.startsWith(x);
}

const methods = (o) => (Array.isArray(o.payment_method) ? o.payment_method : String(o.payment_method || "").split(","))
  .map((m) => String(m).trim()).filter(Boolean);

export function orderAmount(o) {
  const a = o.actual_order_amount || {};
  return Math.round(Number(a.payment_amount ?? o.payment_amount ?? 0));
}

// 무통장(cash) · 미결제 · 취소 아님
export function unpaidCashOrders(orders = []) {
  return orders.filter((o) => methods(o).includes("cash") && String(o.paid || "") === "F" && String(o.canceled || "F") !== "T" && orderAmount(o) > 0)
    .map((o) => ({ orderId: String(o.order_id), shopNo: Number(o.shop_no || 1), orderDate: String(o.order_date || ""),
      amount: orderAmount(o), depositor: String(o.billing_name || "").trim(), buyer: String(o.buyer_name || "").trim() }));
}

export function incomingDeposits(transactions = [], { accountIds = [] } = {}) {
  const allowed = accountIds.length ? new Set(accountIds.map(Number)) : null;
  return transactions.filter((t) => Number(t.inAmount) > 0 && !INTERNAL.has(String(t.category || "")) && (!allowed || allowed.has(Number(t.accountId))))
    .map((t) => ({ txId: String(t.transactionId), at: String(t.transactionAt || ""), amount: Math.round(Number(t.inAmount)),
      name: String(t.transactionName || t.transactionDescription || "").trim(), accountId: t.accountId }));
}

const time = (s) => {
  const t = Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : `${String(s).replace(" ", "T")}+09:00`);
  return Number.isNaN(t) ? 0 : t;
};

// 반환: { sure: [{order, tx}], check: [{order, txs, reason}] }
export function matchDeposits(orders, deposits, { usedTxIds = [], windowDays = 7 } = {}) {
  const used = new Set(usedTxIds.map(String));
  const pool = deposits.filter((d) => !used.has(d.txId));
  const inWindow = (o, d) => {
    const ot = time(o.orderDate);
    const dt = time(d.at);
    return ot && dt && dt >= ot - 3600000 && dt <= ot + windowDays * DAY;
  };
  const cand = new Map(); // orderId -> deposits with same amount in window
  for (const o of orders) cand.set(o.orderId, pool.filter((d) => d.amount === o.amount && inWindow(o, d)));
  const sure = [];
  const check = [];
  for (const o of orders) {
    const same = cand.get(o.orderId);
    if (!same.length) continue; // 아직 입금 없음
    const named = same.filter((d) => namesMatch(d.name, o.depositor) || (o.buyer && namesMatch(d.name, o.buyer)));
    if (named.length === 1) {
      const d = named[0];
      // 같은 입금을 노리는 다른 주문(같은 금액·같은 이름)이 있으면 확실하지 않다.
      const rivals = orders.filter((x) => x.orderId !== o.orderId && cand.get(x.orderId).some((y) => y.txId === d.txId)
        && (namesMatch(d.name, x.depositor) || (x.buyer && namesMatch(d.name, x.buyer))));
      if (!rivals.length) { sure.push({ order: o, tx: d }); continue; }
      check.push({ order: o, txs: [d], reason: "같은 이름·금액의 다른 주문이 있음" });
      continue;
    }
    if (named.length > 1) { check.push({ order: o, txs: named, reason: "같은 이름·금액 입금이 여러 건" }); continue; }
    check.push({ order: o, txs: same.slice(0, 5), reason: "금액은 같지만 입금자명이 다름" });
  }
  // 한 입금이 두 주문에 '확실'로 붙지 않게(위 rivals 로 막지만 한 번 더)
  const seen = new Set();
  const finalSure = sure.filter((m) => (seen.has(m.tx.txId) ? false : (seen.add(m.tx.txId), true)));
  return { sure: finalSure, check };
}
