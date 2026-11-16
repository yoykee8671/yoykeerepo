#!/usr/bin/env node
// Verifies the 입점사 월정산 board: month basis, brand name matching,
// computed vs sheet values, manual values for consignment brands, questions.
//
//   node scripts/v2_monthly_verify.mjs

import assert from 'node:assert/strict';
import { requestMonth, matchBrandName, computeMonth, boardRows, planMonthlyImport, monthlyQuestions } from '../lib/monthly-board.mjs';

assert.equal(requestMonth({ orderNo: '20261015-0000123', createdAt: '2026-11-02' }), '2026-10');
assert.equal(requestMonth({ createdAt: '2026-11-02T00:00:00Z' }), '2026-11');

const brands = [
  { id: 'a', name: '아카바코퍼레이션 (패디펫)', settlementType: 'prepay_debt' },
  { id: 'r', name: '리케이(아이그룸)' },
  { id: 'g', name: '고공캣', rawSheetName: '고공캣' },
  { id: 'c', name: '공감캣', settlementType: 'consignment' },
  { id: 'e', name: '어니스트밀' }
];
assert.equal(matchBrandName('패디펫(아카바코퍼레이션)', brands)?.id, 'a');
assert.equal(matchBrandName('아이그룸 (리케이)', brands)?.id, 'r');
assert.equal(matchBrandName('고공캣', brands)?.id, 'g');
assert.equal(matchBrandName('모르는곳', brands), null);
const tf = [{ id: 'on', name: '트러스티푸드 (온라인)' }, { id: 'b2b', name: '트러스티푸드 (B2B)' }];
assert.equal(matchBrandName('트러스티푸드 (b2b)', tf)?.id, 'b2b');
assert.equal(matchBrandName('ANBLANK 앤블랭크', [{ id: 'x', name: '앤블랭크' }])?.id, 'x');

const requests = [
  { brandId: 'g', orderNo: '20261003-1', productSalesAmount: 100_000, shippingFee: 3_000, receivableDeduction: 25_000, depositAmount: 103_000 },
  { brandId: 'g', orderNo: '20261020-2', productSalesAmount: 107_000, shippingFee: 0, receivableDeduction: 26_750 },
  { brandId: 'g', orderNo: '20260930-3', productSalesAmount: 9_999 },
  { brandId: 'e', orderNo: '20261005-4', productSalesAmount: 66_000, receivableDeduction: 16_500 },
  { brandId: 'g', orderNo: '20261011-5', productSalesAmount: 1, status: 'deleted' }
];
const cm = computeMonth(requests, '2026-10');
assert.equal(cm.g.sales, 207_000);
assert.equal(cm.g.recovered, 51_750);
assert.equal(cm.g.count, 2);

const extract = { months: { '2026-10': [
  { brand: '고공캣', kind: '선매입', sales: 207_000, shipping: 3_000, recovered: 51_750, margin: 0, checked: true },
  { brand: '공감캣', kind: '위탁', sales: 977_200, shipping: 7_000, margin: 293_160 },
  { brand: '어니스트밀', kind: '선매입', sales: 50_400, recovered: 12_600 },
  { brand: '쿠루름', sales: 1_000 }
] } };
const plan = planMonthlyImport(extract, { brands, requests });
assert.equal(plan.records.length, 3);
assert.deepEqual(plan.records.find((r) => r.brandId === 'c').manual, { sales: 977_200, shipping: 7_000, recovered: 0, margin: 293_160 });
assert.equal(plan.records.find((r) => r.brandId === 'g').manual, undefined, 'app data wins when there are requests');
assert.deepEqual(plan.unmatched.map((u) => u.name), ['쿠루름']);
assert.deepEqual(plan.salesGaps.map((g) => [g.brandId, g.app, g.sheet]), [['e', 66_000, 50_400]]);

const rows = boardRows({ brands, requests, records: plan.records, ym: '2026-10' });
const gg = rows.find((r) => r.brandId === 'g');
assert.equal(gg.source, 'requests');
assert.deepEqual(gg.diffs, [], 'shipping differs? sheet 3,000 vs app 3,000 → same');
assert.ok(gg.checked);
const gc = rows.find((r) => r.brandId === 'c');
assert.equal(gc.source, 'manual');
assert.equal(gc.margin, 293_160);
assert.deepEqual(rows.find((r) => r.brandId === 'e').diffs, ['sales', 'recovered']);

const qs = monthlyQuestions(plan);
assert.deepEqual(qs.map((q) => q.kind), ['monthly-brand', 'monthly-gap']);
assert.match(qs[1].detail, /76%/);

console.log('v2 monthly verify: all checks passed');
