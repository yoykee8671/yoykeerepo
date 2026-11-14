#!/usr/bin/env node
// Verifies 생산비 ledger, FIFO open bills, rate lookups and detail checks.
//
//   node scripts/v2_production_verify.mjs

import assert from 'node:assert/strict';
import { partnerLedger, openBills, findRate, rateChecks, partnerSummary, planProductionImport } from '../lib/production-cost.mjs';

const p = {
  bills: [
    { id: 'b1', date: '2026-09-01', amount: 1_000_000 },
    { id: 'b2', date: '2026-10-01', amount: 500_000 },
    { id: 'b3', date: '2026-11-05', amount: 300_000 },
    { id: 'bx', date: '2026-11-06', amount: 999, voided: true }
  ],
  payments: [{ id: 'p1', date: '2026-10-15', amount: 1_200_000 }],
  adjustments: [{ id: 'a1', date: '2026-11-01', amount: -100_000, memo: '불량 차감' }]
};
const led = partnerLedger(p);
assert.equal(led.billed, 1_800_000);
assert.equal(led.paid, 1_200_000);
assert.equal(led.balance, 500_000);
assert.equal(led.entries.at(-1).balance, 500_000);

const open = openBills(p, '2026-11-14');
assert.deepEqual(open.map((b) => [b.id, b.remaining, b.partial]), [['b2', 200_000, true], ['b3', 300_000, false]]);
assert.equal(open[0].ageDays, 44);
const s = partnerSummary(p, '2026-11-14');
assert.equal(s.balance, 500_000);
assert.equal(s.oldestDate, '2026-10-01');
assert.equal(s.lastPayment, '2026-10-15');

const rates = [
  { item: '카시트', option: '블랙', unitPrice: 31_000, from: '' },
  { item: '카시트', option: '블랙', unitPrice: 32_505, from: '2026-05-06' },
  { item: '카시트', option: '블루', unitPrice: 32_500 },
  { item: '리드줄', option: '1.2 / 2.0', unitPrice: 2_800 },
  { item: '이케코백', option: 'ML', unitPrice: 15_000 }
];
assert.equal(findRate(rates, '카시트(블랙)', '2026-03-01').unitPrice, 31_000);
assert.equal(findRate(rates, '카시트 블랙', '2026-06-01').unitPrice, 32_505, 'newer rate after its start date');
assert.equal(findRate(rates, '리드줄 2.0', '2026-01-01').unitPrice, 2_800);
assert.equal(findRate(rates, '카시트(네이비)', '2026-11-05'), null, 'no matching colour');
const answered = [...rates, { item: '카시트(블루)', option: '', unitPrice: 33_000, from: '2026-07-01' }];
assert.equal(findRate(answered, '카시트(블루)', '2026-08-01').unitPrice, 33_000, 'rate registered from an answer wins after its date');
assert.equal(findRate(answered, '카시트(블루)', '2026-06-01').unitPrice, 32_500);

const details = [
  { date: '2026-11-05', total: 1_400_080, lines: [
    { item: '카시트(네이비)', qty: 20, unitPrice: 35_140, gross: 773_080 },
    { item: '카시트(블루)', qty: 10, unitPrice: 33_000, gross: 363_000 },
    { item: '운임', qty: 1, unitPrice: 5_500, gross: 6_050 }
  ] },
  { date: '2026-11-09', total: 455_950, lines: [{ item: '리드줄 1.2', qty: 10, unitPrice: 2_800, gross: 30_800 }] }
];
const chk = rateChecks({ details, rates, bills: [{ date: '2026-11-05', amount: 1_400_080 }, { date: '2026-11-09', amount: 455_000 }] });
assert.deepEqual(chk.mismatches.map((m) => [m.item, m.rate, m.diff]), [['카시트(블루)', 32_500, 5_000]]);
assert.deepEqual(chk.unknown.map((u) => u.item), ['카시트(네이비)']);
assert.deepEqual(chk.totals.map((t) => [t.date, t.note]), [['2026-11-09', '상세 합계와 청구액이 다름']]);

// linked payments stick to their bill; FIFO only for the rest
const q = {
  bills: [{ id: 'old', date: '2022-04-26', amount: 407_000 }, { id: 'n1', date: '2026-07-16', amount: 888_030 }],
  payments: [{ id: 'x', date: '2026-08-18', amount: 888_030, billId: 'n1' }]
};
assert.deepEqual(openBills(q, '2026-11-14').map((b) => b.id), ['old']);

// import plan
const extract = {
  partners: [{ name: '세림통상', sheetBalance: 1_900_000,
    bills: [{ date: '2026-11-05', amount: 1_400_080 }, { date: '2026-11-09', amount: 455_000 }],
    payments: [{ date: '2026-11-12', amount: 1_000_000 }],
    details }, { name: '모름', bills: [{ date: '2026-01-01', amount: 1 }] }],
  rates: rates.map((r) => ({ ...r, partner: '세림통상' }))
};
const plan = planProductionImport(extract, { partnerIdByName: { 세림통상: 'PT1' }, today: '2026-11-14' });
assert.equal(plan.bills.length, 2, 'unknown partner skipped');
assert.equal(plan.bills[0].id, 'pb:세림통상:0');
assert.equal(plan.summary[0].balance, 855_080);
const kinds = plan.questions.map((x) => x.kind);
assert.deepEqual(kinds, ['prod-balance', 'prod-rate-change', 'prod-rate-new', 'prod-total']);
assert.equal(plan.questions[0].choices[1].value, 1_900_000);
assert.equal(planProductionImport(extract, { partnerIdByName: { 세림통상: 'PT1' } }).bills[1].id, plan.bills[1].id, 'stable ids');

console.log('v2 production verify: all checks passed');
