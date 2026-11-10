#!/usr/bin/env node
// Verifies the Picky 3PL logistics rules that apply from the 2026-09
// settlement (CJ 대한통운, 물류비 800, 합포비, 박스단위 출고) and that earlier
// months keep the old unit prices.
//
//   node scripts/npb_logistics_verify.mjs

import assert from 'node:assert/strict';
import {
  buildNpbNamespace,
  npbCostConfigForMonth,
  npbCountParcels,
  npbComputeShipping
} from '../server.js';

const picky = buildNpbNamespace().brands.find((b) => b.id === 'pickydog');
const products = [
  { id: 'p45', name: '필바이츠 45g (5개입)', barcode: '8809990970018' },
  { id: 'p180', name: '필바이츠 180g (20개입)', barcode: '8809990970025' }
];

// One order-detail row; qty is the stock units in 재고매칭(1).
const row = (invoice, barcode, qty, ship = '2026-09-10 오후 1:00:00') => ({
  송장번호: invoice,
  주문수량: 1,
  주문상품출고일시: ship,
  '재고매칭(1)바코드번호': barcode,
  '재고매칭(1)상품명': '',
  '재고매칭(1)주문수량': qty,
  '재고매칭(2)바코드번호': '', '재고매칭(2)상품명': '', '재고매칭(2)주문수량': '',
  '재고매칭(3)바코드번호': '', '재고매칭(3)상품명': '', '재고매칭(3)주문수량': '',
  '재고매칭(4)바코드번호': '', '재고매칭(4)상품명': '', '재고매칭(4)주문수량': ''
});
const P45 = '8809990970018';
const P180 = '8809990970025';

// --- period selection: old months keep the old prices ---
{
  const aug = npbCostConfigForMonth(picky.costConfig, '2026-08');
  const sep = npbCostConfigForMonth(picky.costConfig, '2026-09');
  const oct = npbCostConfigForMonth(picky.costConfig, '2026-10');
  const unit = (cfg, key) => {
    const t = cfg.shipTypes.find((s) => s.key === key);
    return t ? t.freight + t.handling : null;
  };
  assert.equal(unit(aug, '3pl'), 2650 + 1430, 'August keeps the old 3PL price');
  assert.equal(unit(aug, '3pl_box'), null, 'August has no box-unit type');
  // Ship types hold VAT-included amounts (the invoice total is "vat포함");
  // the price table keeps the VAT-excluded list prices.
  assert.equal(unit(sep, '3pl'), 2750 + 880, '소형 2,500 + 물류비 800, VAT 포함');
  assert.equal(unit(sep, '3pl_box'), 4400 + 880, '중형 4,000 + 물류비 800, VAT 포함');
  assert.equal(unit(sep, '3pl_bundle'), 110, '합포비 100원/개, VAT 포함');
  assert.equal(unit(sep, '3pl_truck'), 880, '용달 출고는 박스당 포장비만');
  assert.equal(unit(sep, 'hq'), 3300 + 550, '본사출고는 그대로');
  assert.ok(sep.shipTypes.find((s) => s.key === 'quick').manual, '퀵/용달 운송비는 그대로 별도청구');
  assert.deepEqual(unit(oct, '3pl'), unit(sep, '3pl'), 'later months use the latest period');
  assert.equal(npbCostConfigForMonth(picky.costConfig, '').shipTypes[0].freight, 2650,
    'unknown month falls back to the base config');
}

// --- parcel counting ---
{
  const rows = [
    row('A', P45, 1),                         // single item, no 합포비
    row('B', P45, 4),                         // 합포 4 → 3 extra
    row('C', P45, 2), row('C', P180, 1),      // two rows one invoice → 3 units, 2 extra
    row('D', P45, 200),                       // 2 boxes of 100, no 합포비
    row('E', P180, 40),                       // 32/box → 2 boxes (rounded up)
    row('F', P45, 99),                        // below a full box → normal parcel, 98 extra
    row('G', P45, 3, '2026-08-31 오후 11:00:00'), // other month → excluded
    row('', P45, 5),                          // no tracking number → not shipped
    row('H', P45, 2, '')                      // no ship date → not shipped
  ];
  const r = npbCountParcels(rows, products, picky.costConfig.periods[0].boxUnits, '2026-09');
  assert.equal(r.parcels, 4, 'A, B, C, F are normal parcels');
  assert.equal(r.boxes, 4, 'D = 2 boxes, E = 2 boxes');
  assert.equal(r.extraUnits, 3 + 2 + 98, '합포 extra units over normal parcels only');
  assert.equal(r.boxParcels, 2);
  assert.equal(r.skippedOtherMonth, 1);
  assert.equal(r.skippedUnshipped, 2);
}

{
  // A header spelled with a space still groups by tracking number.
  const r2 = { ...row('X', P45, 1) }; delete r2.송장번호; r2['운송장 번호'] = 'X';
  const r3 = { ...row('X', P45, 2) }; delete r3.송장번호; r3['운송장 번호'] = 'X';
  const r = npbCountParcels([r2, r3], products, picky.costConfig.periods[0].boxUnits, '2026-09');
  assert.equal(r.parcels, 1);
  assert.equal(r.extraUnits, 2);
}

// --- worked example from the brief: 1 box with 4 items = 2,500 + 800 + 300 ---
{
  const sep = npbCostConfigForMonth(picky.costConfig, '2026-09');
  const shipping = npbComputeShipping({ '3pl': 1, '3pl_bundle': 3 }, sep);
  assert.equal(shipping.total, Math.round(3600 * 1.1), '3,600원(부가세별도) = 3,960원 VAT 포함');
  const box = npbComputeShipping({ '3pl_box': 1 }, sep);
  assert.equal(box.total, Math.round(4800 * 1.1), '박스단위 1박스 4,800원(부가세별도)');
  // 합포비 is counted per item, not per parcel, so it stays out of 건수.
  assert.equal(shipping.countTotal, 1);
}

console.log('npb logistics verify: all checks passed');
