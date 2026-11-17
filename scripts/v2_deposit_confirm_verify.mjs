// node scripts/v2_deposit_confirm_verify.mjs — 카페24 입금전 ↔ 은행 입금 자동 확인 규칙
import assert from "node:assert/strict";
import { unpaidCashOrders, incomingDeposits, matchDeposits, namesMatch } from "../lib/deposit-confirm.mjs";

assert.equal(namesMatch("홍길동", "홍길동"), true);
assert.equal(namesMatch("홍길동우프", "홍길동"), true);
assert.equal(namesMatch("김철수", "홍길동"), false);
assert.equal(namesMatch("홍", "홍길동"), false);

const orders = unpaidCashOrders([
  { order_id: "A", shop_no: 1, paid: "F", canceled: "F", payment_method: ["cash"], order_date: "2026-11-16T10:00:00+09:00", payment_amount: "35000.00", billing_name: "홍길동", buyer_name: "홍길동" },
  { order_id: "B", shop_no: 1, paid: "F", canceled: "F", payment_method: ["cash"], order_date: "2026-11-16T11:00:00+09:00", payment_amount: "20000.00", billing_name: "이영희" },
  { order_id: "C", shop_no: 1, paid: "F", canceled: "F", payment_method: ["cash"], order_date: "2026-11-16T12:00:00+09:00", payment_amount: "15000.00", billing_name: "박민수" },
  { order_id: "D", shop_no: 1, paid: "F", canceled: "F", payment_method: ["cash"], order_date: "2026-11-16T12:30:00+09:00", payment_amount: "15000.00", billing_name: "박민수" },
  { order_id: "E", shop_no: 1, paid: "T", payment_method: ["cash"], order_date: "2026-11-16T12:00:00+09:00", payment_amount: "9000", billing_name: "x" },
  { order_id: "F", shop_no: 1, paid: "F", payment_method: ["card"], order_date: "2026-11-16T12:00:00+09:00", payment_amount: "9000", billing_name: "y" },
  { order_id: "G", shop_no: 1, paid: "F", canceled: "T", payment_method: ["cash"], order_date: "2026-11-16T12:00:00+09:00", payment_amount: "9000", billing_name: "z" }
]);
assert.deepEqual(orders.map((o) => o.orderId), ["A", "B", "C", "D"]);

const deposits = incomingDeposits([
  { transactionId: 1, transactionAt: "2026-11-16T14:00:00", inAmount: 35000, transactionName: "홍길동" },
  { transactionId: 2, transactionAt: "2026-11-16T15:00:00", inAmount: 20000, transactionName: "이영히" },
  { transactionId: 3, transactionAt: "2026-11-16T15:30:00", inAmount: 15000, transactionName: "박민수" },
  { transactionId: 4, transactionAt: "2026-11-16T16:00:00", inAmount: 99000, transactionName: "계좌이동", category: "계좌간 입금" },
  { transactionId: 5, transactionAt: "2026-11-16T16:00:00", outAmount: 35000, transactionName: "홍길동" }
]);
assert.equal(deposits.length, 3);

const r = matchDeposits(orders, deposits);
assert.deepEqual(r.sure.map((m) => `${m.order.orderId}:${m.tx.txId}`), ["A:1"]);
const reasons = Object.fromEntries(r.check.map((c) => [c.order.orderId, c.reason]));
assert.equal(reasons.B, "금액은 같지만 입금자명이 다름");
assert.equal(reasons.C, "같은 이름·금액의 다른 주문이 있음");
assert.equal(reasons.D, "같은 이름·금액의 다른 주문이 있음");

// 이미 쓴 입금은 다시 안 씀, 기간 밖 입금은 안 봄
assert.equal(matchDeposits(orders, deposits, { usedTxIds: ["1"] }).sure.length, 0);
const late = incomingDeposits([{ transactionId: 9, transactionAt: "2026-11-30T10:00:00", inAmount: 35000, transactionName: "홍길동" }]);
assert.equal(matchDeposits(orders, late).sure.length, 0);
console.log("v2 deposit confirm: ok");
