#!/usr/bin/env node
// Verifies the legacy ledger migration plan and the receivable ledger.
//
//   node scripts/v2_migration_verify.mjs

import assert from 'node:assert/strict';
import { planMigration, receivableLedger, matchBrandForTab, recomputeZeroDeductions } from '../lib/legacy-migration.mjs';

const brands = [
  { id: 'b1', name: '고공캣', rawSheetName: '고공캣', hasReceivable: true, receivableTotal: 13_865_295, depositorName: '김지연' },
  { id: 'b2', name: '아카바코퍼레이션 (패디펫)', hasReceivable: true, receivableTotal: 26_588_480, businessName: '(주)아카바코퍼레이션' },
  { id: 'b3', name: '테일릿', hasReceivable: false },
  { id: 'b4', name: '골드로니', hasReceivable: true, receivableTotal: 4_256_312 }
];
const requests = [
  { id: 'r1', brandId: 'b1', brandName: '고공캣', orderNo: '20260520-0000001', depositAmount: 29_000, receivableDeduction: 0, status: 'pending', createdAt: '2026-05-20' },
  { id: 'r2', brandId: 'b1', brandName: '고공캣', orderNo: '20260601-0000002', depositAmount: 10_000, status: 'paid', createdAt: '2026-06-01' },
  { id: 'r3', brandId: 'b1', brandName: '고공캣', orderNo: '20260601-0000002', depositAmount: 10_000, status: 'paid', createdAt: '2026-06-02' }, // dup, newer
  { id: 'r4', brandId: 'b2', brandName: '아카바', orderNo: '20260301-0000003', depositAmount: 50_000, receivableDeduction: 15_000, status: 'paid', createdAt: '2026-05-01' }
];
const tabs = {
  '고공캣': { rows: [
    { orderNo: '20250519-0000032', customer: '오유미', paid: 29_000, margin: 6_375, date: '2025-05-20' },
    { orderNo: '20260520-0000001', customer: '중복', paid: 29_000, margin: 6_375, date: '2026-05-20' } // same as r1 → keep app, ask deduction
  ] },
  '아카바코퍼레이션 (패디펫)': { rows: [
    { orderNo: '20260301-0000003', customer: 'x', paid: 52_000, margin: 15_000, date: '2026-03-02' } // amount differs → question
  ] },
  '테일릿(주미스)': { rows: [{ orderNo: '20260203-0000056', customer: '정은정', paid: 19_600, margin: 0, date: '2026-02-04' }] },
  '쿠루름': { rows: [{ orderNo: '20250101-0000001', paid: 1000 }] }
};
const creditors = [
  { creditor: '김지연', biz: '고공캣', total: 22_328_600 },
  { creditor: '(주)아카바코퍼레이션', biz: null, total: 26_588_480 }
];

assert.equal(matchBrandForTab('테일릿(주미스)', brands)?.id, 'b3');

const plan = planMigration({ brands, requests, tabs, creditors });
assert.deepEqual(plan.autoDeletes.map((d) => [d.requestId, d.keepId]), [['r2', 'r3']], 'older duplicate is removed, newest kept');
assert.equal(plan.legacyOrders.length, 2, '고공캣 old order + 테일릿 order');
const gg = plan.legacyOrders.find((o) => o.brandId === 'b1');
assert.equal(gg.receivableDeduction, 6_375);
assert.equal(plan.legacyOrders.find((o) => o.brandId === 'b3').receivableDeduction, 0, 'non-debt brand: no deduction');
const kinds = plan.questions.map((x) => x.kind).sort();
assert.deepEqual(kinds, ['amount-mismatch', 'claim-base', 'claim-base', 'request-deduction', 'tab-brand', 'zero-deduction']);
assert.ok(plan.questions.find((x) => x.id === 'claim:b1').choices.some((c) => c.value === 22_328_600));
assert.ok(!plan.questions.some((x) => x.id === 'claim:b2'), 'matching claim needs no question');
assert.ok(plan.questions.find((x) => x.id === 'claim:b4').title.includes('찾지 못했습니다'));
assert.equal(plan.perBrand.find((p) => p.brandId === 'b1').legacyDeducted, 6_375);
assert.equal(plan.perBrand.find((p) => p.brandId === 'b1').skippedSame, 1);

// ledger: base − legacy − app deductions + adjustments
const led = receivableLedger({ ...brands[0], receivableTotal: 22_328_600 }, {
  legacyOrders: plan.legacyOrders,
  requests: [{ ...requests[0], receivableDeduction: 6_375 }],
  adjustments: [{ brandId: 'b1', date: '2026-07-01', amount: -1_000, memo: '조정' }]
});
assert.equal(led.deducted, 6_375 + 6_375 + 1_000);
assert.equal(led.balance, 22_328_600 - 13_750);
assert.equal(led.entries.at(-1).balance, led.balance);

// zero-deduction answers
const zr = [
  { id: 'z1', productSalesAmount: 40_000, receivableDeduction: 0 },
  { id: 'z2', productSalesAmount: 10_000, supplyAmount: 7_000, receivableDeduction: 0, cancelledAmount: 2_000 },
  { id: 'z3', productSalesAmount: 0, receivableDeduction: 0 }
];
let z = recomputeZeroDeductions(zr, { mode: 'rate', rate: 25 });
assert.deepEqual(z.changes.map((c) => [c.id, c.after]), [['z1', 10_000], ['z2', 2_500 + 1_500]]);
z = recomputeZeroDeductions(zr, { mode: 'supply-margin' });
assert.deepEqual(z.changes.map((c) => [c.id, c.after]), [['z2', 3_000]]);
assert.deepEqual(z.skipped.map((x) => x.id), ['z1', 'z3']);
assert.equal(recomputeZeroDeductions(zr, { mode: 'none' }).changes.length, 0);

console.log('v2 migration verify: all checks passed');
