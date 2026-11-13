#!/usr/bin/env node
// Verifies 우프코드 assignment (v2 unified codes).
//
//   node scripts/v2_codes_verify.mjs [state.json]
//
// With a state.json (a copy of app_state.state), also reports what the
// backfill would assign on that data without writing anything.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assignCodes, CODE_SCHEMES } from '../server.js';

// --- ordering, padding, never reusing numbers ---
{
  const db = {
    brands: [
      { id: 'b2', name: '나중', createdAt: '2026-05-02' },
      { id: 'b1', name: '먼저', createdAt: '2026-05-01' }
    ],
    admins: [{ id: 'a1' }]
  };
  assert.equal(assignCodes(db), 3);
  assert.equal(db.brands.find((b) => b.id === 'b1').code, 'BR-0001', 'older record gets the smaller number');
  assert.equal(db.brands.find((b) => b.id === 'b2').code, 'BR-0002');
  assert.equal(db.admins[0].code, 'AD-01');
  // delete BR-0002, add a new brand: number 2 is not reused
  db.brands = db.brands.filter((b) => b.id !== 'b2');
  db.brands.push({ id: 'b3', createdAt: '2026-06-01' });
  assignCodes(db);
  assert.equal(db.brands.find((b) => b.id === 'b3').code, 'BR-0003');
  // running again changes nothing
  assert.equal(assignCodes(db), 0);
  // an existing code is kept even if the record is edited
  db.brands[0].name = '이름변경';
  assignCodes(db);
  assert.equal(db.brands[0].code, 'BR-0001');
}

// --- price history rows of one item share the item's code ---
{
  const db = {
    priceEntries: [
      { id: 'p1', brandId: 'B', itemCode: 'X1', itemName: '사료', createdAt: '2026-01-01' },
      { id: 'p2', brandId: 'B', itemCode: 'X1', itemName: '사료', createdAt: '2026-03-01' },
      { id: 'p3', brandId: 'B', itemCode: '', itemName: '간식', createdAt: '2026-02-01' },
      { id: 'p4', brandId: 'C', itemCode: 'X1', itemName: '사료', createdAt: '2026-02-01' }
    ]
  };
  assignCodes(db);
  const code = (pid) => db.priceEntries.find((e) => e.id === pid).code;
  assert.equal(code('p1'), code('p2'), 'revisions of one item share a code');
  assert.notEqual(code('p1'), code('p3'));
  assert.notEqual(code('p1'), code('p4'), 'same item code under another brand is another item');
  // a later revision inherits the existing code
  db.priceEntries.unshift({ id: 'p5', brandId: 'B', itemCode: 'X1', itemName: '사료', createdAt: '2026-11-01' });
  assignCodes(db);
  assert.equal(code('p5'), code('p1'));
}

console.log('v2 codes verify: all checks passed');

// --- optional dry run on real data ---
const file = process.argv[2];
if (file) {
  const state = JSON.parse(readFileSync(file, 'utf8'));
  const before = JSON.stringify(state);
  const n = assignCodes(state);
  for (const s of CODE_SCHEMES) {
    const list = state[s.collection] || [];
    const codes = new Set(list.map((x) => x.code));
    const sample = list.slice().sort((a, b) => String(a.code).localeCompare(String(b.code))).slice(0, 2)
      .map((x) => `${x.code} ${x.name || x.itemName || x.alias || ''}`.trim());
    console.log(`${s.label}: ${list.length}건 → 코드 ${codes.size}개 (마지막 ${state.codeSeq[s.prefix] || 0}) 예: ${sample.join(' / ')}`);
  }
  console.log(`assigned ${n}; only code fields changed:`,
    JSON.stringify(stripCodes(JSON.parse(before))) === JSON.stringify(stripCodes(state)));
}

function stripCodes(st) {
  const out = JSON.parse(JSON.stringify(st));
  delete out.codeSeq;
  for (const s of CODE_SCHEMES) for (const x of out[s.collection] || []) delete x.code;
  return out;
}
