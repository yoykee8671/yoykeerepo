// node scripts/v2_pipeline_prepare_verify.mjs — 주문매칭: 카페24 배송준비중 대상 고르기
import assert from "node:assert/strict";
import { buildRequestDrafts, planPrepare } from "../lib/cafe24-collect.mjs";

const orders = [
  { order_id: "20261118-0000001", shop_no: 1, paid: "T", order_date: "2026-11-18", buyer_name: "가", items: [
    { order_item_code: "20261118-0000001-01", supplier_id: "S1", product_name: "A", quantity: 1, product_price: "10000", order_status: "N10" },
    { order_item_code: "20261118-0000001-02", supplier_id: "S2", product_name: "B", quantity: 1, product_price: "5000", order_status: "N10" }
  ] },
  { order_id: "20261118-0000002", shop_no: 2, paid: "T", order_date: "2026-11-18", buyer_name: "나", items: [
    { order_item_code: "20261118-0000002-01", supplier_id: "S1", product_name: "A", quantity: 2, product_price: "10000", order_status: "N30" }
  ] }
];
const brands = [{ id: "b1", name: "브랜드1", cafe24Supplier: "S1" }, { id: "b2", name: "브랜드2", cafe24Supplier: "S2" }];
const { drafts } = buildRequestDrafts({ orders, brands, existingRequests: [] });
const d1 = drafts.filter((d) => d.brandId === "b1");
assert.equal(d1.length, 2);
assert.equal(d1[0].shopNo, 1);
assert.equal(d1[1].shopNo, 2);
assert.equal(d1[0].lineItems[0].orderStatus, "N10");
const plan = planPrepare(d1);
// 브랜드1 품목만, 이미 배송중(N30)인 주문은 건너뜀
assert.deepEqual(plan.byShop, [{ shopNo: 1, requests: [{ orderId: "20261118-0000001", itemCodes: ["20261118-0000001-01"] }] }]);
assert.deepEqual(plan.skipped, ["20261118-0000002"]);
assert.deepEqual(planPrepare([]).byShop, []);
console.log("v2 pipeline prepare verify: all checks passed");
