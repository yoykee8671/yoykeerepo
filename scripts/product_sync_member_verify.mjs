// node scripts/product_sync_member_verify.mjs — 회원가 공급사(테일릿) 동기화 규칙 확인
import assert from "node:assert/strict";
import * as ps from "../lib/product-sync.mjs";
import * as im from "../lib/brand-source-imweb.mjs";

// 유통몰 표기: [브랜드] 앞머리, 뒤 판매 안내 꼬리표
assert.equal(ps.cleanSourceName("[닥터맘마]촉촉사료 파인 700g[★오프라인 전용★]"), "닥터맘마 촉촉사료 파인 700g");
assert.equal(ps.cleanSourceName("[로렌츠] 못난이 과일껌 (딸기) 90g[★온/오프 가능 – 조건부★]"), "로렌츠 못난이 과일껌 (딸기) 90g");

// 우프 이름이 본사 이름 안에 통째로 들어 있으면(뒤에 검색용 문구) 추천, 우프 [1+1] 말머리는 뺀다
const sources = [
  { sourceNo: 1, name: "[고메이트]와규 소간 25g 강아지 고양이 동결건조 간식 트릿[온/오프라인 가능]", options: [] },
  { sourceNo: 2, name: "[고메이트]남태평양 호키 45g 강아지 고양이 동결건조 간식 트릿[온/오프라인 가능]", options: [] }
];
const { suggestions } = ps.suggestLinks({ sourceProducts: sources, wooofProducts: [
  { product_no: 10, product_name: "고메이트 와규 소간 25g" },
  { product_no: 11, product_name: "[1+1] 고메이트 남태평양 호키 45g" }
] });
assert.deepEqual(suggestions.map((s) => [s.wooof.product_no, s.source.sourceNo]), [[10, 1], [11, 2]]);

// 본사 '옵션 1개' ↔ 우프 단일품목은 짝
const m = ps.matchOptions({ options: [{ label: "와규 소간 25g", values: ["와규 소간 25g"] }] }, [{ variant_code: "P1", options: [] }]);
assert.equal(m.pairs.length, 1);
assert.equal(m.unmatchedSource.length + m.unmatchedWooof.length, 0);

// 회원가 모드: 정가 ↔ 우프 판매가, 회원가 ↔ 우프 공급가. 회원 할인은 프로모션이 아니다.
const wooof = { product_no: 10, price: "20800.00", supply_price: "14200.00", variants: [{ variant_code: "P1", options: [], selling: "T", display: "T", quantity: 99 }] };
const base = { sourceId: "tailit", sourceNo: 1, link: { sourceNo: 1 }, settings: { priceMode: "member", restockQuantity: 99 } };
const same = ps.computeIssues({ ...base, source: { name: "x", price: 20800, salePrice: 14200, options: [] }, wooof });
assert.deepEqual(same.filter((i) => ["price", "supply_price", "source_promo"].includes(i.type)), []);
const changed = ps.computeIssues({ ...base, source: { name: "x", price: 21800, salePrice: 14900, options: [] }, wooof });
assert.deepEqual(changed.filter((i) => ["price", "supply_price"].includes(i.type)).map((i) => [i.type, i.to]).sort(), [["price", 21800], ["supply_price", 14900]]);

// 옵션명 자동 맞춤: 앞의 [브랜드] 표시는 맞추지 않고, '옵션 1개 = 상품명'도 맞추지 않는다. 뒤의 안내 문구는 그대로 맞춘다.
const variant = (code, value) => ({ variant_code: code, options: [{ name: "종류", value }], selling: "T", display: "T", quantity: 99 });
const two = { price: "5000.00", supply_price: "3000.00", variants: [variant("P1", "소세지"), variant("P2", "수박")] };
const texts = (opts) => ps.computeIssues({ ...base, settings: { restockQuantity: 99 }, wooof: two,
  source: { name: "x", price: 5000, salePrice: 5000, options: opts } }).filter((i) => i.type === "option_text").map((i) => i.to);
assert.deepEqual(texts([{ label: "[하울고]소세지", values: ["[하울고]소세지"], selling: true }, { label: "[하울고]수박", values: ["[하울고]수박"], selling: true }]), []);
assert.deepEqual(texts([{ label: "소세지 (12/1 순차배송)", values: ["소세지 (12/1 순차배송)"], selling: true }, { label: "수박", values: ["수박"], selling: true }]), ["소세지 (12/1 순차배송)"]);
const one = { price: "5000.00", supply_price: "3000.00", variants: [variant("P1", "소세지 바스락 토이")] };
assert.deepEqual(ps.computeIssues({ ...base, settings: { restockQuantity: 99 }, wooof: one,
  source: { name: "x", price: 5000, salePrice: 5000, options: [{ label: "[하울고]소세지 바스락 토이", values: ["[하울고]소세지 바스락 토이"], selling: true }] } })
  .filter((i) => i.type === "option_text"), []);

// 로그인 안 된 상세 페이지는 회원가가 숨겨진 것으로 본다
assert.ok(im.memberPriceHidden('<span class="real_price">판매가 회원공개</span>'));
assert.ok(!im.memberPriceHidden('<span class="real_price">14,200원</span>'));

console.log("product_sync_member_verify OK");
