#!/usr/bin/env node
// Verifies the 일일 자금보고 calculation: schedule repeats, sources, balance walk.
//
//   node scripts/v2_cash_report_verify.mjs

import assert from 'node:assert/strict';
import { occurrences, buildCashReport, reportText } from '../lib/cash-report.mjs';

// monthly on the 31st falls on the last day of shorter months
assert.deepEqual(occurrences({ repeat: 'monthly', dayOfMonth: 31 }, '2026-11-01', '2026-12-31'), ['2026-11-30', '2026-12-31']);
// weekly Monday (1)
assert.deepEqual(occurrences({ repeat: 'weekly', weekday: 1 }, '2026-11-13', '2026-11-24'), ['2026-11-16', '2026-11-23']);
// once, start/end bounds, skip dates, inactive
assert.deepEqual(occurrences({ repeat: 'once', date: '2026-11-15' }, '2026-11-13', '2026-11-20'), ['2026-11-15']);
assert.deepEqual(occurrences({ repeat: 'monthly', dayOfMonth: 15, endDate: '2026-11-14' }, '2026-11-13', '2026-12-20'), []);
assert.deepEqual(occurrences({ repeat: 'monthly', dayOfMonth: 15, skipDates: ['2026-11-15'] }, '2026-11-13', '2026-12-20'), ['2026-12-15']);
assert.deepEqual(occurrences({ repeat: 'monthly', dayOfMonth: 15, active: false }, '2026-11-13', '2026-12-20'), []);

const r = buildCashReport({
  today: '2026-11-13',
  days: 7,
  company: 'wooof',
  openingBalance: 1_000_000,
  schedules: [
    { id: 's1', company: 'wooof', direction: 'out', title: '사무실 임대료', amount: 800_000, repeat: 'monthly', dayOfMonth: 15 },
    { id: 's2', company: 'wooof', direction: 'in', title: '스마트스토어 정산', amount: 300_000, repeat: 'once', date: '2026-11-13' },
    { id: 's3', company: 'betters', direction: 'out', title: '베럴즈 건', amount: 999_999, repeat: 'once', date: '2026-11-13' }
  ],
  payments: [
    { id: 'p1', status: 'confirmed', amount: 8_000, dueDate: '2026-11-10', payeeName: '김성준', title: '택배비' }, // overdue → today
    { id: 'p2', status: 'paid', amount: 5_000, dueDate: '2026-11-13' },
    { id: 'p3', status: 'requested', amount: 600_000, plannedDate: '2026-11-17', title: '임가공비' }
  ],
  requests: [
    { id: 'r1', status: 'pending', brandName: '테일릿', expectedDepositDate: '2026-11-13', depositAmount: 100_000, creditUsedAmount: 10_000 },
    { id: 'r2', status: 'paid', expectedDepositDate: '2026-11-13', depositAmount: 50_000 }
  ]
});
assert.equal(r.today.cashIn, 300_000);
assert.equal(r.today.cashOut, 8_000 + 90_000, 'overdue payment + net 선매입; other company excluded');
assert.ok(r.today.items.some((l) => l.overdue));
assert.equal(r.days.find((d) => d.date === '2026-11-15').cashOut, 800_000);
assert.equal(r.days.find((d) => d.date === '2026-11-17').cashOut, 600_000);
assert.equal(r.endingBalance, 1_000_000 + 300_000 - 98_000 - 800_000 - 600_000);
assert.equal(r.shortfallDate, '2026-11-17', 'first day the balance goes negative');
const text = reportText(r, { companyName: '우프', accounts: [{ name: '하나504', balance: 1_000_000 }] });
assert.match(text, /\[일일 자금보고\] 우프 11\/13\(금\)/);
assert.match(text, /\[기한지남\] 김성준 택배비 8,000원/);
assert.match(text, /⚠ 11\/17\(화\)에 잔액이 모자랍니다/);

console.log('v2 cash report verify: all checks passed');
