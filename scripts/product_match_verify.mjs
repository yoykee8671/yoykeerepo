// node scripts/product_match_verify.mjs — 기준 상품(단가표) 매칭 추천 규칙 확인
import assert from "node:assert/strict";
import * as pm from "../lib/product-match.mjs";

// 판매용 말머리는 빼고 비교한다.
assert.equal(pm.cleanProductName("[1+1] 후르타 2025 몬순 코트 (4컬러)"), "후르타 몬순 코트");
assert.equal(pm.cleanProductName("(1+1) [아울렛] 맥아담스 방목 치킨 (5kg)"), "맥아담스 방목 치킨 (5kg)");
assert.equal(pm.cleanProductName("(미노출 상품) 워프 소고기 50g"), "워프 소고기 50g");

// 한글 색상 → 영문, 사이즈 범위 띄어쓰기, 용량 단위.
assert.deepEqual([...pm.specTokens("루비/40 - 50")].sort(), ["40-50", "ruby"]);
assert.deepEqual([...pm.specTokens("45-60 strawberry")].sort(), ["45-60", "strawberry"]);
assert.deepEqual([...pm.specTokens("5KG")], ["5000g"]);
assert.deepEqual([...pm.specTokens("2.5kg")], ["2500g"]);

// 원료·나이·라인이 다르면 이름이 비슷해도 다른 상품.
assert.equal(pm.conflicts("맥아담스 방목 치킨과 연어 소형견용 사료 (5kg)", "맥아담스 방목 치킨 소형견용 사료 (2kg / 5kg)"), "protein");
assert.equal(pm.conflicts("맥아담스 방목 치킨 중대형견용 사료 (2kg)", "맥아담스 방목 치킨 소형견용 사료 (2kg / 5kg)"), "stage");
assert.equal(pm.conflicts("후르타 몬순 코트 (3컬러)", "Hurtta Monsoon coat II ECO"), "version");
assert.equal(pm.conflicts("MEOW 먀오 비프&호키 에어드라이드 (100g)", "Multilong Leash Eco"), "kind");
assert.equal(pm.conflicts("후르타 몬순 코트 에코 2 (4컬러)", "Hurtta Monsoon coat II ECO"), "");

const entries = [
  { code: "IT-1", itemName: "Hurtta Monsoon coat II ECO", spec: "ruby 23", barcode: "6410329340001", consumerPrice: 151000 },
  { code: "IT-2", itemName: "Hurtta Monsoon coat II ECO", spec: "ruby 25", barcode: "6410329340002", consumerPrice: 151000 },
  { code: "IT-3", itemName: "Hurtta Monsoon coat II ECO", spec: "peacock 23", barcode: "", consumerPrice: 151000 },
  { code: "IT-4", itemName: "맥아담스 방목 치킨 소형견용 사료 (2kg / 5kg)", spec: "5KG", consumerPrice: 139000 },
  { code: "IT-5", itemName: "맥아담스 방목 치킨과 연어 소형견용 사료 (2kg / 5kg)", spec: "5KG", consumerPrice: 151000 }
];
const v = (code, ...values) => ({ variant_code: code, additional_amount: "0.00", options: values.map((value) => ({ value })) });
const products = [
  // 본사가 (1+1) 을 붙였든 말든 같은 상품으로 본다.
  { product_no: 1, product_name: "(1+1) 후르타 몬순 코트 에코 2 (4컬러)", price: "151000.00", variants: [v("P1A", "루비", "23"), v("P1B", "루비", "25"), v("P1C", "피콕", "23")] },
  { product_no: 2, product_name: "맥아담스 방목 치킨과 연어 소형견용 사료 (5kg)", price: "151000.00", variants: [v("P2A")] },
  { product_no: 3, product_name: "후르타 슬리핑 백", price: "130000.00", variants: [v("P3A", "S")] }
];
const res = pm.suggestProductMatches({ products, entries });
const coat = res.find((r) => r.productNo === 1).best;
assert.equal(coat.model, "Hurtta Monsoon coat II ECO");
assert.deepEqual(coat.pairs.map((p) => [p.variantCode, p.entryCode]), [["P1A", "IT-1"], ["P1B", "IT-2"], ["P1C", "IT-3"]]);
assert.ok(coat.pairs.every((p) => p.priceHit));
assert.equal(res.find((r) => r.productNo === 2).best.pairs[0].entryCode, "IT-5");
assert.equal(res.find((r) => r.productNo === 3).best, null);

// 이미 연결된 품목은 다시 추천하지 않는다.
const again = pm.suggestProductMatches({ products, entries, links: { P1A: { entryCode: "IT-1" } } });
assert.equal(again.find((r) => r.productNo === 1).best.pairs.length, 2);

// 기준 코드: 바코드 → 카페24 품목코드 → 단가표 코드.
assert.deepEqual(pm.baseCodeOf(entries[0], "P1A"), { code: "6410329340001", kind: "barcode" });
assert.deepEqual(pm.baseCodeOf(entries[2], "P1C"), { code: "P1C", kind: "cafe24" });
assert.deepEqual(pm.baseCodeOf(entries[2]), { code: "IT-3", kind: "pay" });

// 카페24 자체 품목코드에 넣을 값: 바코드, 없으면 단가표 코드.
assert.equal(pm.cafe24CodeFor(entries[0]), "6410329340001");
assert.equal(pm.cafe24CodeFor(entries[2]), "IT-3");

console.log("product_match_verify OK");
