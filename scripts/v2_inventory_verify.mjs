#!/usr/bin/env node
// Verifies 원부자재 재고 rules: stock by location, BOM consumption with loss,
// reorder suggestion rounded to the order multiple, producible quantity.
//
//   node scripts/v2_inventory_verify.mjs

import assert from 'node:assert/strict';
import { stockByLocation, requirements, consumptionMoves, stockStatus, producible } from '../lib/inventory.mjs';

const F = 'factory-1';
const materials = [
  { id: 'm-pouch', code: 'MT-0043', itemName: '필포켓 파우치' },
  { id: 'm-box', code: 'MT-0044', itemName: '단상자' },
  { id: 'm-goods', code: 'MT-0005', itemName: '판매용 상품' } // not tracked
];
const product = { id: 'p1', name: '필바이츠 45g', lines: [
  { materialId: 'm-pouch', perUnit: 5, lossRate: 2 },   // 5 pouches per box, 2% loss
  { materialId: 'm-box', perUnit: 1, lossRate: 0 }
] };

const moves = [
  { materialId: 'm-pouch', location: 'HQ', type: 'in', qty: 6000 },
  { materialId: 'm-pouch', location: 'HQ', type: 'move_out', qty: 5000 },
  { materialId: 'm-pouch', location: F, type: 'move_in', qty: 5000 },
  { materialId: 'm-box', location: F, type: 'in', qty: 1200 },
  { materialId: 'm-box', location: F, type: 'out', qty: 10 },        // damaged
  { materialId: 'm-box', location: F, type: 'adjust', qty: -15 },    // counted 15 fewer
  { materialId: 'm-box', location: F, type: 'in', qty: 999, voided: true }
];
const s = stockByLocation(moves);
assert.equal(s['m-pouch|HQ'], 1000);
assert.equal(s[`m-pouch|${F}`], 5000);
assert.equal(s[`m-box|${F}`], 1175, 'voided rows are ignored');

assert.deepEqual(requirements(product, 100), [{ materialId: 'm-pouch', qty: 510 }, { materialId: 'm-box', qty: 100 }]);

const run = { id: 'r1', productId: 'p1', quantity: 800, location: F, date: '2026-11-13', status: 'done' };
const used = consumptionMoves(run, product);
assert.equal(used.length, 2);
assert.equal(used[0].qty, 4080);
assert.equal(used[0].type, 'use');
assert.equal(used[0].refId, 'r1');

const after = [...moves, ...used];
assert.equal(stockByLocation(after)[`m-pouch|${F}`], 920);

// a planned run of 300 needs 1,530 pouches and 300 boxes
const status = stockStatus({
  materials,
  moves: after,
  runs: [{ ...run }, { id: 'r2', productId: 'p1', quantity: 300, location: F, status: 'planned' }],
  products: [product],
  settings: { 'm-pouch': { safetyStock: 1000, orderMultiple: 2000, unit: '개' }, 'm-box': { safetyStock: 50 } }
});
assert.equal(status.length, 2, 'only tracked materials');
const pouch = status.find((r) => r.materialId === 'm-pouch');
assert.equal(pouch.onHand, 1920);
assert.equal(pouch.plannedUse, 1530);
assert.equal(pouch.available, 390);
assert.ok(pouch.needOrder);
assert.equal(pouch.suggestOrder, 2000, '610 short, rounded up to the 2,000 order multiple');
assert.equal(status[0].materialId, 'm-pouch', 'items needing an order come first');
const box = status.find((r) => r.materialId === 'm-box');
assert.equal(box.available, 1175 - 800 - 300);
assert.ok(!box.needOrder);

const can = producible(product, after, F);
assert.equal(can.quantity, 180, '920 pouches / 5.1 = 180');
assert.equal(can.limitedBy, 'm-pouch');

console.log('v2 inventory verify: all checks passed');
