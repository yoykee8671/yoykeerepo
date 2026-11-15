#!/usr/bin/env node
// Verifies the rehabilitation repayment plan: 2026 prepayment, year-end dues,
// cash schedule lines and loan → creditor linking.
//
//   node scripts/v2_rehab_verify.mjs

import assert from 'node:assert/strict';
import { yearSummary, creditorsForYear, rehabScheduleLines, creditorPlan } from '../lib/rehab-plan.mjs';

const plan = {
  totals: { prepaid: 1_800_270, prepaidPaid: 1_739_605, remaining2026: 1_800_300, years: { 2026: 3_600_570, 2027: 20_864_277 } },
  creditors: [
    { cat: '구상채권', creditor: '기술보증기금', total: 980_085_697, cash: 196_017_140, prepaid: 980_085, remaining2026: 980_085, years: { 2026: 1_960_170, 2027: 13_721_199 } },
    { cat: '특수관계인채권', creditor: '이교영', total: 76_911_370, cash: 0, prepaid: 0, years: {} }
  ]
};
let ys = yearSummary(plan, [], '2026-11-15');
assert.deepEqual(ys.map((y) => [y.year, y.due, y.status]), [['2026', 1_800_300, 'this-year'], ['2027', 20_864_277, 'planned']]);
assert.equal(ys[0].prepaidPaid, 1_739_605);
ys = yearSummary(plan, [{ year: '2026', amount: 1_800_300, date: '2026-12-20' }], '2026-12-21');
assert.equal(ys[0].status, 'paid');
assert.equal(yearSummary(plan, [], '2027-01-05')[0].status, 'overdue');

const c26 = creditorsForYear(plan, '2026');
assert.deepEqual(c26.map((c) => [c.creditor, c.planned, c.prepaid, c.remaining]), [['기술보증기금', 1_960_170, 980_085, 980_085]]);
assert.equal(creditorsForYear(plan, '2027')[0].remaining, 13_721_199);

const lines = rehabScheduleLines(plan, [], '2026-12-01', '2026-12-31');
assert.deepEqual(lines.map((l) => [l.date, l.amount, l.category]), [['2026-12-31', 1_800_300, '회생변제']]);
assert.equal(rehabScheduleLines(plan, [{ year: '2026', amount: 1_800_300 }], '2026-12-01', '2026-12-31').length, 0);

assert.equal(creditorPlan(plan, '기술보증기금')?.cash, 196_017_140);
assert.equal(creditorPlan(plan, ''), null);

console.log('v2 rehab verify: all checks passed');
