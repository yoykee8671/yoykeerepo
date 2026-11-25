// node scripts/po_receipt_verify.mjs — 발주서 입고(자동 기본) 규칙 확인
import assert from "node:assert/strict";
import * as r from "../lib/po-receipt.mjs";

const materials = [
  { id: "m1", code: "SB-0015", itemName: "웨빙 25mm 오렌지", itemKind: "material", materialType: "SB", leadTimeDays: 3, orderUnit: "yd" },
  { id: "m2", code: "OP-0002", itemName: "원단 염색비", itemKind: "material", materialType: "OP", leadTimeDays: 10 }
];
const partners = [{ id: "dongsan", name: "동산섬유", paymentTiming: "prepay" }, { id: "serim", name: "세림통상", category: "production" }];
const locations = [{ key: "HQ", name: "우프 창고" }, { key: "serim", name: "세림통상" }];
const po = { id: "po1", docNo: "PO-1", docType: "purchase_order", partnerId: "dongsan", orderDate: "2026-11-25", status: "ordered",
  deliveryPlace: { name: "세림통상" }, lineItems: [{ materialId: "m1", itemName: "웨빙", quantity: 350, unit: "yd" }, { materialId: "m2", itemName: "염색비", quantity: 1 }] };
const ctx = (payments = [], deliveryPlaces = []) => ({ materials, partners, locations, payments, deliveryPlaces });

// 재고 줄: 부자재만(외주가공 염색비는 빠짐)
assert.deepEqual(r.receiptLines(po, materials).map((l) => l.materialId), ["m1"]);
// 위치: 납품지 이름이 생산처와 같으면 그 생산처, 납품지에 연결한 위치가 우선
assert.equal(r.receiptLocation(po, ctx()).key, "serim");
assert.equal(r.receiptLocation(po, ctx([], [{ name: "세림 통상", stockLocation: "HQ" }])).key, "HQ");
assert.equal(r.receiptLocation({ ...po, deliveryPlace: { name: "모르는 곳" } }, ctx()), null);

// 선결제인데 지급 전 → 자동 입고 대기
let plan = r.receiptPlan(po, ctx([{ poId: "po1", status: "requested", createdAt: "2026-11-25T01:00:00Z" }]), "2026-11-30");
assert.equal(plan.expected, "2026-11-28"); // 지급요청일 + 리드타임 3일
assert.deepEqual(plan.blockers, ["선결제 — 아직 지급 전"]);
assert.equal(plan.autoOk, false);
assert.ok(plan.overdue);
assert.match(plan.message, /동산섬유의 웨빙 25mm 오렌지 350yd이\(가\) 세림통상에 11\/28 입고예정입니다/);

// 지급완료 → 지급일 + 리드타임, 자동 입고 가능
plan = r.receiptPlan(po, ctx([{ poId: "po1", status: "paid", paidAt: "2026-11-26", createdAt: "2026-11-25T01:00:00Z" }]), "2026-11-30");
assert.equal(plan.expected, "2026-11-29");
assert.ok(plan.autoOk);
// 납기일·직접 정한 날이 우선
assert.equal(r.receiptPlan({ ...po, dueDate: "2026-12-05" }, ctx(), "2026-11-30").expected, "2026-12-05");
assert.equal(r.receiptPlan({ ...po, dueDate: "2026-12-05", expectedDate: "2026-12-01" }, ctx(), "2026-11-30").expected, "2026-12-01");
// 자동 입고 끔, 이미 입고, 발주서 아님
assert.ok(r.receiptPlan({ ...po, autoReceive: false }, ctx(), "2026-11-30").blockers.includes("자동 입고 꺼짐"));
assert.equal(r.receiptPlan({ ...po, status: "received" }, ctx(), "2026-11-30"), null);
assert.equal(r.receiptPlan({ ...po, docType: "statement" }, ctx(), "2026-11-30"), null);

// 입고 기록: 실제 수량이 다르면 그 수량
const moves = r.receiptMoves(po, plan, { date: "2026-11-29", qtys: { m1: 340 }, auto: true });
assert.deepEqual(moves.map((m) => [m.materialId, m.location, m.type, m.qty]), [["m1", "serim", "in", 340]]);
assert.match(moves[0].memo, /자동/);

console.log("po_receipt_verify OK");
