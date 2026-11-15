#!/usr/bin/env node
// Verifies the 현금흐름표 grid: row matching, cell precedence, totals, balances.
//
//   node scripts/v2_cashflow_verify.mjs

import assert from 'node:assert/strict';
import { rowTokens, matchRow, monthDays, buildGrid, balances, scheduleDay } from '../lib/cash-flow.mjs';

assert.deepEqual(rowTokens('생산비/세림통상'), ['생산', '세림통상']);
assert.deepEqual(rowTokens('B 신한은행 이자비용'), ['신한', '이자']);
assert.equal(scheduleDay('말일'), 31);
assert.equal(scheduleDay('10일'), 10);
assert.equal(monthDays('2026-11').length, 30);
assert.equal(monthDays('2026-11')[14].dow, '일', '2026-11-15 is a Sunday');

const rows = [
  { id: 'danal', side: 'in', label: '다날', order: 1 },
  { id: 'etcin', side: 'in', label: '기타 입금', order: 9 },
  { id: 'bshinhan', side: 'out', label: 'B 신한은행 이자비용', order: 1 },
  { id: 'seorim', side: 'out', label: '생산비/세림통상', order: 2 },
  { id: 'pay', side: 'out', label: '급여', order: 3 },
  { id: 'etcout', side: 'out', label: '기타 출금', order: 9 }
];
assert.equal(matchRow(rows, { side: 'out', text: '세림통상 생산비 지급요청' })?.id, 'seorim');
assert.equal(matchRow(rows, { side: 'out', text: '신한 일반자금대출 상환(이자)', company: 'betters' })?.id, 'bshinhan');
assert.equal(matchRow(rows, { side: 'out', text: '신한 일반자금대출 상환(이자)', company: 'wooof' }), null, 'B rows are 베럴즈 only');

const g = buildGrid({
  rows, month: '2026-11', today: '2026-11-15', actualSynced: true,
  cells: [
    { date: '2026-11-02', rowId: 'danal', amount: 100, source: 'sheet' },
    { date: '2026-11-03', rowId: 'danal', amount: 999, source: 'manual', memo: '직접' },
    { date: '2026-11-20', rowId: 'pay', amount: 6_000_000, source: 'sheet' }
  ],
  actual: [
    { date: '2026-11-02', side: 'in', amount: 120, text: '다날 정산' },
    { date: '2026-11-03', side: 'in', amount: 50, text: '다날' },
    { date: '2026-11-04', side: 'in', amount: 7, text: '모르는 입금' }
  ],
  plan: [
    { date: '2026-11-20', side: 'out', amount: 5_000_000, text: '임직원 급여', source: 'schedule' },
    { date: '2026-11-25', side: 'out', amount: 1_400_080, text: '세림통상 생산비', source: 'payment' },
    { date: '2026-11-10', side: 'out', amount: 1, text: '세림통상 생산비', source: 'payment' }
  ]
});
assert.equal(g.grid.danal['2026-11-02'].kind, 'actual', 'past day: synced Clobe actual wins over the old sheet');
assert.equal(g.grid.danal['2026-11-02'].amount, 120);
assert.equal(g.grid.danal['2026-11-03'].kind, 'manual');
assert.equal(g.grid.etcin['2026-11-04'].amount, 7, 'unmatched → 기타 입금');
assert.equal(g.grid.pay['2026-11-20'].kind, 'sheet', 'future: value already in the sheet wins over the plan');
assert.equal(g.grid.seorim['2026-11-25'].kind, 'plan');
assert.equal(g.grid.seorim['2026-11-10'], undefined, 'past plan without actual shows nothing');
assert.equal(g.totals['2026-11-25'].out, 1_400_080);
const b = balances(g.days, g.totals, 10_000_000, '2026-11-15');
assert.equal(b['2026-11-14'], undefined);
assert.equal(b['2026-11-20'], 10_000_000 - 6_000_000);
assert.equal(b['2026-11-30'], 4_000_000 - 1_400_080);
assert.equal(buildGrid({ rows, month: '2026-11', company: 'wooof' }).rows.some((r) => r.id === 'bshinhan'), false, 'company filter hides 베럴즈 rows');

console.log('v2 cashflow verify: all checks passed');
