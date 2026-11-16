#!/usr/bin/env node
// Verifies VAT splitting on trade documents: VAT-inclusive prices are split
// from the line/document totals so every visible number adds up.
//
//   node scripts/v2_vat_verify.mjs

import assert from 'node:assert/strict';
import { purchaseOrderTotals } from '../server.js';

const line = (qty, unitPrice, grossUnitPrice) => ({ quantity: qty, unitPrice, grossUnitPrice, totalPrice: Math.round(qty * unitPrice) });

// The case from TS-20261106-001: 4,420 (VAT incl.) x 25 = 110,500.
{
  const items = [line(25, 4018, 4420)];
  const t = purchaseOrderTotals(items, 'gross');
  assert.deepEqual(t, { subtotal: 100_455, vat: 10_045, total: 110_500 });
  assert.equal(items[0].supplyAmount, 100_455, 'line supply is split from the line total, not 4,018 x 25');
  assert.equal(items[0].totalPrice, 100_455);
  assert.equal(items[0].vatAmount, 10_045);
}

// Several VAT-inclusive lines: line splits always add up to the document.
{
  const items = [line(3, 909, 1000), line(7, 1363, 1500), line(1, 18_181, 19_999), line(13, 2_454, 2_700)];
  const t = purchaseOrderTotals(items, 'gross');
  const sum = (k) => items.reduce((s, i) => s + i[k], 0);
  assert.equal(t.total, 3_000 + 10_500 + 19_999 + 35_100);
  assert.equal(sum('supplyAmount'), t.subtotal);
  assert.equal(sum('vatAmount'), t.vat);
  assert.equal(sum('amount'), t.total);
  assert.equal(t.subtotal + t.vat, t.total);
}

// VAT-exclusive documents keep their totals; line VAT adds up to the document VAT.
{
  const items = [line(3, 1_005, 0), line(2, 2_995, 0)];
  const t = purchaseOrderTotals(items, 'supply');
  assert.deepEqual(t, { subtotal: 9_005, vat: 901, total: 9_906 });
  assert.equal(items.reduce((s, i) => s + i.vatAmount, 0), 901);
  assert.equal(items[0].supplyAmount, 3_015);
}

console.log('v2 vat verify: all checks passed');
