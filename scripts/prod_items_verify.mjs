// node scripts/prod_items_verify.mjs — 생산처 상세내역 줄 ↔ 품목 코드 추천 규칙 확인
import assert from "node:assert/strict";
import * as pi from "../lib/prod-items.mjs";

const preset = pi.PRESETS["세림통상"];
const items = preset.map((p, i) => ({ id: `i${i}`, itemName: p.name, aliases: p.aliases, sizeTag: p.sizeTag, validFrom: p.validFrom }));
const prices = preset.flatMap((p, i) => p.prices.map(([d, v]) => ({ itemId: `i${i}`, effectiveFrom: d, price: v })));
const name = (s) => (s?.itemId ? items.find((x) => x.id === s.itemId).itemName : s?.itemIds?.map((id) => items.find((x) => x.id === id).itemName).join(" / "));
const sug = (item, unitPrice, date = "2026-08-01", qty = 1) => pi.suggestLine({ item, unitPrice, date, qty }, { items, prices });

assert.equal(pi.lineKey("45x35 (앞솜) -카시트속커버"), "45x35앞솜카시트속커버");
assert.equal(name(sug("카시트(오렌지)", 38940)), "카시트 공임 · 오렌지");
assert.equal(name(sug("카시트(블루)", 32500)), "카시트 공임 · 네이비(블루)"); // 블루 = 네이비
assert.equal(name(sug("리드줄(레드/1.2M)", 2800)), "리드줄 공임 · 1.2m");
assert.equal(name(sug("리드줄 2.0", 2800)), "리드줄 공임 · 2m");
assert.equal(name(sug("목줄 S (4/2누락분추가)", 2800)), "목줄 공임 · S");
assert.equal(sug("하네스", 4300).status, "unsized"); // S·M 같은 단가 → 사이즈 미기재
assert.equal(sug("하네스 S,M", 4300).why, "사이즈 여러 개");
assert.equal(name(sug("이케코백(SM/옐로우)", 15300)), "이케코백 공임 · SM");
assert.equal(name(sug("이케코(우베민트)", 16800, "2026-10-02")), "뉴 이케코백 ML 공임");
assert.equal(name(sug("이케코백", 15000, "2024-04-29")), "이케코백 공임 · SM / 이케코백 공임 · ML"); // 뉴 이케코백은 예전 줄에 안 나옴
assert.equal(name(sug("이케코백 어깨끈", 1100)), "이케코백 어깨끈(제원단)");
assert.equal(name(sug("이케코 샘플", 30000)), "샘플 제작");
assert.equal(name(sug("목줄 수선 (L -> S)", 20000)), "수선");
assert.equal(name(sug("속커버(60*35)", 750)), "카시트 속커버 60×35 (옆솜)");
assert.equal(name(sug("운임*3", 3)), "운임(세림 출고)");
assert.ok(pi.amountSuspicious({ qty: 1, unitPrice: 3 }));
assert.ok(pi.amountSuspicious({ qty: 170, unitPrice: 0 }));
assert.equal(sug("알 수 없는 것", 100), null);

// 단가개정 표시
const orange = items.find((x) => x.itemName === "카시트 공임 · 오렌지").id;
assert.equal(pi.revisionLabel(prices, orange, "2026-04-02"), "");
assert.equal(pi.revisionLabel(prices, orange, "2026-07-13"), "(260713단가개정)");
assert.equal(pi.revisionLabel(prices, orange, "2026-08-01"), "(260713단가개정)");

// 확정한 연결에서 배운다
const learned = new Map([[`${pi.lineKey("하네스")}|4300`, items.find((x) => x.itemName === "하네스 공임 · M").id]]);
assert.equal(name(pi.suggestLine({ item: "하네스", unitPrice: 4300, date: "2026-01-01" }, { items, prices, learned })), "하네스 공임 · M");

console.log("prod_items_verify OK");
