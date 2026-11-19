// node scripts/ship_form_verify.mjs — 택배 발주양식(펫페이스): 품목 1행, 내품명, 받는 분
import assert from "node:assert/strict";
import { buildShipFormRows, shipFormOf, shipFormFileName, SHIP_FORM_HEADERS } from "../lib/ship-form.mjs";

const form = shipFormOf({ name: "펫페이스" });
assert.equal(form.senderName, "리딩펫");
assert.equal(shipFormOf({ name: "테일릿" }), null);
assert.equal(shipFormOf({ name: "펫페이스", shipForm: { enabled: false } }).enabled, false);
const orders = [{
  order_id: "20261119-0000001",
  receivers: [{ name: "성혜경", cellphone: "010-5459-7457", phone: "010-5459-7457", zipcode: "04524", address_full: "대구광역시 수성구 들안로32길 55-27 (황금동) 1층 잇츠폴댕", shipping_message: "문 앞" }],
  items: [
    { supplier_id: "S00000PF", internal_product_name: "올라 옥토퍼스 라지", custom_variant_code: "22124", product_name: "[펫페이스] 올라", quantity: 2, order_status: "N10" },
    { supplier_id: "S00000PF", internal_product_name: "조지 지라프", custom_variant_code: "22194", quantity: 1, order_status: "N10" },
    { supplier_id: "S00000PF", internal_product_name: "취소된 것", custom_variant_code: "1", quantity: 1, order_status: "C40" },
    { supplier_id: "S0000OTH", internal_product_name: "다른 브랜드", quantity: 1, order_status: "N10" }
  ]
}];
const { rows } = buildShipFormRows(orders, { supplierId: "s00000pf", form });
assert.equal(SHIP_FORM_HEADERS.length, 11);
assert.equal(rows.length, 2);
assert.deepEqual(rows[0], ["리딩펫", "01077455522", "경기도 양주시 은현면 도하리 93-18", "성혜경", "010-5459-7457", "010-5459-7457", "04524", "대구광역시 수성구 들안로32길 55-27 (황금동) 1층 잇츠폴댕", "올라 옥토퍼스 라지 22124", 2, "문 앞"]);
assert.equal(rows[1][8], "조지 지라프 22194");
assert.equal(shipFormFileName(form, new Date("2026-11-19T01:00:00Z")), "펫페이스 발주서_우프컴퍼니_261119.xlsx");
console.log("ship form verify: all checks passed");
