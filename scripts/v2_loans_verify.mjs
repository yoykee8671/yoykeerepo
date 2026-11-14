#!/usr/bin/env node
// Verifies the loan ledger: balance after repayments, expected payments,
// cash schedule lines, Clobe matching, and the sheet import plan.
//
//   node scripts/v2_loans_verify.mjs

import assert from 'node:assert/strict';
import { payDayOf, loanBalance, loanStatus, expectedPayment, loanScheduleLines, matchLoanPayments, planLoanImport } from '../lib/loans.mjs';

const a = { id: 'A', company: 'wooof', bank: '하나', name: '이차보전', balance: 4_581_340, asOf: '2026-07-24', rate: 3.47,
  principalPayment: 416_666, payDay: '5일', account: '229-910301-68107', maturity: '2027-07-03' };
const b = { id: 'B', company: 'wooof', bank: '신한', name: '일반자금', balance: 300_000_000, asOf: '2026-07-24', rate: 5.3,
  payDay: '20일', account: '100-032-839697', maturity: '2027-10-31' };
const c = { id: 'C', company: 'wooof', bank: '신한', name: '일반자금2', balance: 500_000_000, asOf: '2026-07-24', rate: 5.24,
  payDay: '말일', account: '100-032-839697', maturity: '2027-10-30' };
assert.equal(payDayOf(c), 31);
assert.equal(payDayOf({ payDay: '20일 ' }), 20);

const pays = [
  { loanId: 'A', date: '2026-07-05', principal: 416_666 }, // before asOf: already in the sheet balance
  { loanId: 'A', date: '2026-08-05', principal: 416_666 },
  { loanId: 'A', date: '2026-09-05', principal: 416_666, voided: true }
];
assert.equal(loanBalance(a, pays), 4_581_340 - 416_666);
assert.equal(loanStatus(a, 1, '2026-11-14'), 'active');
assert.equal(loanStatus({ maturity: '2026-12-01' }, 1, '2026-11-14'), 'due-soon');
assert.equal(loanStatus({ maturity: '2025-10-31' }, 1, '2026-11-14'), 'matured');
assert.equal(loanStatus(a, 0, '2026-11-14'), 'closed');

const e = expectedPayment(b, 300_000_000);
assert.equal(e.principal, 0);
assert.equal(e.interest, 1_325_000, '300M × 5.3% / 12');
const mp = expectedPayment({ monthlyPayment: 2_662_306, rate: 2.2 }, 65_780_000);
assert.equal(mp.total, 2_662_306);
assert.equal(mp.interest, Math.round(65_780_000 * 0.022 / 12));

const lines = loanScheduleLines([a, b, c], pays, '2026-11-14', '2026-11-30');
assert.deepEqual(lines.map((l) => [l.fromLoan, l.date]), [['B', '2026-11-20'], ['C', '2026-11-30']]);
assert.equal(loanScheduleLines([a], [...pays, { loanId: 'A', date: '2026-12-05', principal: 1 }], '2026-12-01', '2026-12-31').length, 0, 'already paid this month');

const txs = [
  { transactionId: 1, transactionAt: '2026-11-20T09:00:00', outAmount: 1_330_000, accountNumber: '100-032-839697', transactionDescription: '대출이자' },
  { transactionId: 2, transactionAt: '2026-11-30T09:00:00', outAmount: 2_180_000, accountNumber: '100032839697', transactionDescription: '이자' },
  { transactionId: 3, transactionAt: '2026-11-20T09:00:00', outAmount: 50_000, accountNumber: '100-032-839697', transactionDescription: '택배' },
  { transactionId: 4, transactionAt: '2026-11-05T09:00:00', outAmount: 430_000, accountNumber: '229-910301-68107', transactionDescription: '' }
];
const m = matchLoanPayments([a, b, c], txs, pays);
assert.deepEqual(m.map((x) => [x.txId, x.loanId]), [['1', 'B'], ['2', 'C'], ['4', 'A']]);
assert.equal(m[2].principal, 416_666);
assert.equal(m[2].interest, 430_000 - 416_666);
assert.equal(matchLoanPayments([a, b, c], txs, [...pays, ...m]).length, 0, 'same tx is not matched twice');

const plan = planLoanImport({ asOf: { wooof: '2026-07-24' }, loans: [
  { sheetKey: 'wooof:0:x', company: 'wooof', name: '일반자금대출', bank: '신한', balance: 300_000_000, maturity: '2025-10-31', memo: '매년만기/연갱신' },
  { sheetKey: 'betters:0:y', company: 'betters', name: '옛 대출', balance: 0, balanceBlank: true, maturity: '2023-06-07' }
] }, { today: '2026-11-14' });
assert.equal(plan.loans[0].asOf, '2026-07-24');
assert.ok(plan.loans[0].autoRenew);
assert.ok(plan.loans[1].closed);
assert.deepEqual(plan.questions.map((q) => q.kind), ['loan-maturity']);
assert.equal(plan.questions[0].suggested, 'extended');

console.log('v2 loans verify: all checks passed');
