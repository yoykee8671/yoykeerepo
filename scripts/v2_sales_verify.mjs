#!/usr/bin/env node
// Verifies the sales pipeline rules: stage derivation, next action, receivables.
//
//   node scripts/v2_sales_verify.mjs

import assert from 'node:assert/strict';
import { deriveStage, nextAction, remaining, receivables, stageReached } from '../lib/sales-orders.mjs';

const base = { id: 'o1', code: 'SO-2611-001', total: 110_000, partnerName: 'VIP동물병원' };
assert.equal(deriveStage(base), 'received');
assert.equal(nextAction(base), 'statement');
const st = { ...base, statementId: 'po1' };
assert.equal(deriveStage(st), 'statement');
assert.equal(nextAction(st), 'send');
const sent = { ...st, sentAt: '2026-11-13' };
assert.equal(deriveStage(sent), 'sent');
const inv = { ...sent, invoice: { requestedAt: '2026-11-13', status: 'requested', dueDate: '2026-11-20' } };
assert.equal(deriveStage(inv), 'invoiced');
assert.equal(nextAction(inv), 'issue', 'tax invoice still to be issued');
const issued = { ...inv, invoice: { ...inv.invoice, status: 'issued' } };
assert.equal(nextAction(issued), 'receive');
const partial = { ...issued, receipts: [{ amount: 60_000 }] };
assert.equal(remaining(partial), 50_000);
assert.equal(deriveStage(partial), 'invoiced', 'partial payment keeps it open');
const done = { ...issued, receipts: [{ amount: 60_000 }, { amount: 50_000 }] };
assert.equal(deriveStage(done), 'paid');
assert.equal(nextAction(done), '');
assert.equal(deriveStage({ ...done, cancelledAt: 'x' }), 'cancelled');
assert.equal(deriveStage({ ...inv, onHold: true }), 'on_hold');
assert.ok(stageReached(inv, 'sent'));
assert.ok(!stageReached(st, 'sent'));
// paying straight away without the earlier steps still counts as paid
assert.equal(deriveStage({ ...base, receipts: [{ amount: 110_000 }] }), 'paid');

const list = receivables([base, st, sent, partial, done, { ...sent, id: 'o9', invoice: { requestedAt: 'x', dueDate: '2026-11-10' } }], '2026-11-13');
assert.equal(list.length, 3, 'sent + partial + overdue invoiced; not received/statement/paid');
assert.equal(list[0].id, 'o9');
assert.ok(list[0].overdue);
assert.equal(list.find((r) => r.remaining === 50_000)?.dueDate, '2026-11-20');

console.log('v2 sales verify: all checks passed');
