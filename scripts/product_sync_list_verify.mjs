// node scripts/product_sync_list_verify.mjs — 카페24 공급사 목록 읽기(상품 칸 표시 / 이름형 주소)
import assert from "node:assert/strict";
import * as c24 from "../lib/brand-source-cafe24.mjs";

// 어니스트밀: 상품 칸 표시 없이 이름형 주소만 쓴다 — 그 분류 링크만 센다(다른 분류·추천 칸 제외)
const listHtml = `<a href="/product/화식-3팩-골라담기/30/category/63/display/1/">a</a><a href="/product/화식-3팩-골라담기/30/category/63/display/1/">b</a>
  <a href="/product/수제간식-고메트릿-3종/61/category/63/display/1/">c</a><a href="/product/추천상품/99/category/1/display/2/">d</a>`;
assert.deepEqual(c24.parseListPage(listHtml, 63), [30, 61]);
// 기존 스킨(상품 칸 표시)은 그대로
assert.deepEqual(c24.parseListPage('<div id="anchorBoxId_12"></div><div id="anchorBoxId_15"></div>', 63), [12, 15]);

console.log("product_sync_list_verify OK");
