#!/usr/bin/env node
// Verifies setup proposals: sanitising actions and shaping questions.
//
//   node scripts/v2_proposals_verify.mjs

import assert from 'node:assert/strict';
import { normalizeProposal, sanitizeAction, describeActions } from '../lib/setup-proposals.mjs';

const q = normalizeProposal({
  key: 'vreview monthly', title: '브이리뷰 월 이용료', suggested: 'yes',
  choices: [
    { key: 'yes', label: '매월 25일 등록', actions: [{ type: 'cashSchedule', title: '브이리뷰', amount: '277,750', repeat: 'monthly', dayOfMonth: 25, company: 'wooof', startDate: '2026-11-01' }] },
    { key: 'no', label: '안 함' }
  ]
});
assert.equal(q.id, 'proposal:vreview_monthly');
assert.equal(q.kind, 'proposal');
assert.equal(q.suggested, 'yes');
assert.equal(q.choices[0].actions[0].amount, 277_750);
assert.equal(q.choices[0].actions[0].direction, 'out');
assert.deepEqual(q.choices[1].actions, []);
assert.throws(() => sanitizeAction({ type: 'cashSchedule', title: 'x', amount: 1 }), /덜 채워/, 'once needs a date');
assert.throws(() => sanitizeAction({ type: 'deleteAll' }), /모르는/);
assert.equal(sanitizeAction({ type: 'payment', title: 'MIH 8월', amount: 5_500_000, company: 'evil' }).company, 'wooof');
assert.match(describeActions(q.choices[0].actions), /매월 25일 277,750원/);
assert.throws(() => normalizeProposal({ key: 'k', choices: [] }), /선택지/);

console.log('v2 proposals verify: all checks passed');
