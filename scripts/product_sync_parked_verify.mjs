// node scripts/product_sync_parked_verify.mjs — '운영하지 않음' 자동 분류·재개 규칙 확인
import assert from "node:assert/strict";
import * as ps from "../lib/product-sync.mjs";

const p = (no, display, selling, name = `상품${no}`) => [no, { product_no: no, display, selling, product_name: name }];
const src = { parked: {}, unparked: {} };

// 진열X·판매X → 자동 운영하지 않음, 신상품(미진열·판매중)·진열중은 그대로
let ch = ps.applyParking(src, new Map([p(1, "F", "F"), p(2, "F", "T"), p(3, "T", "T"), p(4, "T", "F")]), "t1");
assert.deepEqual(ch.parked.map((x) => x.wooofProductNo), [1]);
assert.ok(ps.isParked(src, 1) && !ps.isParked(src, 2) && !ps.isParked(src, 3) && !ps.isParked(src, 4));
assert.equal(src.parked["1"].auto, true);

// 다시 진열하면 자동 재개
ch = ps.applyParking(src, new Map([p(1, "T", "T")]), "t2");
assert.deepEqual(ch.resumed.map((x) => x.wooofProductNo), [1]);
assert.ok(!ps.isParked(src, 1));

// 사람이 재개했는데 카페24가 그대로 FF면 다시 넣지 않는다. 상태가 바뀌었다가 다시 FF가 되면 그때 넣는다.
src.parked["5"] = { auto: true, state: "FF" };
delete src.parked["5"]; src.unparked["5"] = { state: "FF" };
ch = ps.applyParking(src, new Map([p(5, "F", "F")]), "t3");
assert.ok(!ps.isParked(src, 5));
ps.applyParking(src, new Map([p(5, "F", "T")]), "t4");
assert.ok(!src.unparked["5"]);
ps.applyParking(src, new Map([p(5, "F", "F")]), "t5");
assert.ok(ps.isParked(src, 5));

// 사람이 직접 운영하지 않음으로 보낸 미진열·판매중 상품은 그대로 유지(자동 재개는 진열할 때만)
src.parked["6"] = { auto: false, state: "FT" };
ps.applyParking(src, new Map([p(6, "F", "T")]), "t6");
assert.ok(ps.isParked(src, 6));

console.log("product_sync_parked_verify OK");
