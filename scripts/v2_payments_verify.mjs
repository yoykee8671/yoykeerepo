#!/usr/bin/env node
// Verifies 지급요청 rules: quick-text parsing, approval step, upcoming window.
//
//   node scripts/v2_payments_verify.mjs

import assert from 'node:assert/strict';
import {
  parseQuickPaymentText, normalizeBankName, statusAfterConfirm, upcomingPayments, addDays
} from '../lib/payment-requests.mjs';

// The exact message format used in 채널톡 today.
{
  const r = parseQuickPaymentText('041302 04 196113 국민 김성준 로젠택배 8,000원\n세림 택배 착불비 입금 부탁드립니다! @김예빈');
  assert.equal(r.accountNumber, '04130204196113', 'leading zero kept, spaces removed');
  assert.equal(r.bankName, '국민은행');
  assert.equal(r.holder, '김성준');
  assert.equal(r.amount, 8000);
  assert.equal(r.title, '로젠택배 세림 택배 착불비');
}
{
  const r = parseQuickPaymentText('신한은행 110-513-952707 강태훈 촬영비 1.5만원 11/15까지');
  assert.equal(r.accountNumber, '110513952707');
  assert.equal(r.bankName, '신한은행');
  assert.equal(r.holder, '강태훈');
  assert.equal(r.amount, 15000);
  assert.match(r.dueDate, /^\d{4}-11-15$/);
  assert.equal(r.title, '촬영비');
}
{
  const r = parseQuickPaymentText('그냥 메모만');
  assert.equal(r.amount, 0);
  assert.equal(r.accountNumber, '');
  assert.equal(r.title, '그냥 메모만');
}
assert.equal(normalizeBankName('기업'), '기업은행');
assert.equal(normalizeBankName('카카오'), '카카오뱅크');

assert.equal(statusAfterConfirm(999_999), 'confirmed');
assert.equal(statusAfterConfirm(1_000_000), 'awaiting_approval');
assert.equal(statusAfterConfirm(5_000_000, 0), 'confirmed', 'threshold 0 turns approval off');

{
  const today = '2026-11-13';
  const list = [
    { id: 'a', amount: 1000, dueDate: '2026-11-12', status: 'requested' },  // overdue
    { id: 'b', amount: 2000, dueDate: '2026-11-13', status: 'confirmed' },  // today
    { id: 'c', amount: 3000, plannedDate: '2026-11-20', dueDate: '2026-11-25', status: 'confirmed' }, // planned wins
    { id: 'd', amount: 4000, dueDate: '2026-11-21', status: 'requested' },  // beyond 7 days
    { id: 'e', amount: 5000, status: 'requested' },                          // undated
    { id: 'f', amount: 6000, dueDate: '2026-11-14', status: 'paid' }        // done
  ];
  const u = upcomingPayments(list, today, 7);
  assert.equal(u.end, '2026-11-20');
  assert.equal(u.overdueTotal, 1000);
  assert.equal(u.todayTotal, 2000);
  assert.equal(u.windowTotal, 5000);
  assert.equal(u.undatedTotal, 5000);
  assert.ok(!Object.values(u.byDay).flat().some((p) => p.id === 'f'));
}
assert.equal(addDays('2026-12-30', 3), '2027-01-02');

console.log('v2 payments verify: all checks passed');
