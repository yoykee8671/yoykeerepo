// node scripts/v2_sellmate_verify.mjs — 셀메이트 재고 파일 읽기·분류·맞추기
import assert from "node:assert/strict";
import { parseSellmateRows, planSellmateImport, snapshotTotals, parseSellmateTime, classifyProduct } from "../lib/sellmate.mjs";

const csv = `상품명,옵션명,현재재고,공급처,공급처코드,바코드번호,바코드번호2,상품코드,상품코드(카페),상품위치,원가,판매처옵션코드,마지막입고일,가용재고
베럴즈 윈터 자켓_버건디,4XL,9,베럴즈,15,1-724300010567,8809879543982,"=""P000BIGC""",P000BIGC,A-G-4-1,20805,000A,2026-10-13 오후 6:33:59,8
필바이츠 45g 치킨 (5개입),단일상품,100,우프재고,1,1-724300099999,8809999999999,"=""""",P000BLCF000A,,3000,,2026-09-01 오전 9:05:00,100
콘디 아이스팩 파우치,단일상품,0,우프재고,1,1-724300088888,8808888888888,,,,0,,,0
상품 부속 누락 재발송용 생성코드,단일상품,998,자사,1,1-724300013643,10213220000,,,,0,,,998`;
const rows = parseSellmateRows(csv);
assert.equal(rows.length, 4);
assert.equal(rows[0].name, "베럴즈 윈터 자켓_버건디 / 4XL");
assert.equal(rows[0].owner, "betters");
assert.equal(rows[0].cafe24VariantCode, "P000BIGC000A");
assert.equal(rows[1].cafe24Code, "P000BLCF");
assert.equal(rows[1].cafe24VariantCode, "P000BLCF000A");
assert.equal(rows[1].owner, "wooof");
assert.equal(rows[0].lastInbound, "2026-10-13T18:33:59+09:00");
assert.equal(parseSellmateTime("2026-09-01 오전 9:05:00"), "2026-09-01T09:05:00+09:00");
assert.equal(classifyProduct("필바이츠 45g", "우프재고").businessUnit, "npb");
assert.equal(classifyProduct("이름 모를 장난감", "우프재고").needsReview, true);
assert.equal(classifyProduct("바스락삑삑 장난감", "우프재고").discontinued, true);
assert.deepEqual(classifyProduct("콘디 아이스팩", "우프재고"), { itemKind: "product", businessUnit: "pb", brandHint: "콘디", needsReview: false });
assert.deepEqual(classifyProduct("[우프배송] 씻어쓰는 누기패드", "우프재고"), { itemKind: "vendorProduct", businessUnit: "", brandHint: "", needsReview: false, discontinued: true });
assert.equal(classifyProduct("우프x멍랩 산책 와펜", "우프재고").discontinued, true);
assert.equal(classifyProduct("우프x멍랩 산책 와펜", "우프재고").businessUnit, "pb");

const plan = planSellmateImport([{ id: "x", itemName: "옛 이름", barcode: "8809879543982" }], rows);
assert.equal(plan.updates.length, 1); // 바코드로 맞춤
assert.equal(plan.updates[0].patch.sellmateCode, "1-724300010567");
assert.equal(plan.creates.length, 2); // 재발송용 코드는 건너뜀
assert.deepEqual(plan.creates.map((c) => [c.itemKind, c.businessUnit, c.needsReview]), [["product", "npb", false], ["product", "pb", false]]);

const t = snapshotTotals(rows);
assert.equal(t.units, 9 + 100 + 0 + 998);
assert.equal(t.inStock, 3);
assert.equal(t.byOwner.betters.costValue, 9 * 20805);
// 자동 분류였던 예전 품목은 셀메이트 규칙으로 고친다, 사람이 고른 것은 그대로
const p2 = planSellmateImport([{ id: "y", itemName: "필바이츠 45g 치킨 (5개입)", itemKind: "vendorProduct", kindAuto: true }, { id: "z", itemName: "베럴즈 윈터 자켓_버건디 / 4XL", itemKind: "vendorProduct", kindAuto: false }], rows);
assert.equal(p2.updates.find((u) => u.id === "y").patch.itemKind, "product");
assert.equal(p2.updates.find((u) => u.id === "y").patch.businessUnit, "npb");
assert.equal(p2.updates.find((u) => u.id === "z").patch.itemKind, undefined);
console.log("v2 sellmate verify: all checks passed");
