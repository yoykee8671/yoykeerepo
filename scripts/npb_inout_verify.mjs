#!/usr/bin/env node
// Verifies the 입출고 내역 upload helpers: Sellmate exports come as CSV or
// real .xls/.xlsx, and the order-detail export (ord_ordList) carries the
// stock quantity in its 재고매칭 slots, not in 주문수량.
//
//   node scripts/npb_inout_verify.mjs

import assert from 'node:assert/strict';
import {
  npbInventoryFromLogistics,
  npbLogisticsRowMonth,
  npbIsSpreadsheetUpload
} from '../server.js';

const products = [
  { id: 'p45', name: '필바이츠 45g', barcode: '8809990970018' },
  { id: 'p180', name: '필바이츠 180g', barcode: '8809990970025' }
];

// The export always has four 재고매칭 slots; unused ones are blank.
const blankSlots = (from) => {
  const out = {};
  for (let n = from; n <= 4; n++) {
    out[`재고매칭(${n})바코드번호`] = '';
    out[`재고매칭(${n})상품명`] = '';
    out[`재고매칭(${n})주문수량`] = '';
  }
  return out;
};

// Order-detail row: one 5-pack order takes 5 units out of stock.
const packRow = {
  판매처상품명: '(5팩/25개입) 필바이츠',
  주문수량: 1,
  주문상품출고일시: '2026-09-30 오후 3:29:31',
  '재고매칭(1)바코드번호': 8809990970018,
  '재고매칭(1)상품명': '필바이츠 45g (5개입)',
  '재고매칭(1)주문수량': 5,
  ...blankSlots(2)
};

// Set order: two different stock items in one order line.
const setRow = {
  판매처상품명: '필바이츠 세트',
  주문수량: 1,
  주문상품출고일시: '2026-09-12 오전 10:00:00',
  '재고매칭(1)바코드번호': '8809990970018',
  '재고매칭(1)상품명': '필바이츠 45g',
  '재고매칭(1)주문수량': 1,
  '재고매칭(2)바코드번호': '8809990970025',
  '재고매칭(2)상품명': '필바이츠 180g',
  '재고매칭(2)주문수량': 2,
  ...blankSlots(3)
};

// Ledger (stk_inoutList) rows keep working as before.
const ledgerRows = [
  { 입출고일자: '2026-09-03', 바코드번호: '8809990970025', 상품명: '필바이츠 180g', 입고수량: 10, 출고수량: 0 },
  { 입출고일자: '2026-09-04', 바코드번호: '8809990970025', 상품명: '필바이츠 180g', 입고수량: 0, 출고수량: 3 }
];

{
  const { totals, unmatched } = npbInventoryFromLogistics([packRow, setRow], products);
  assert.deepEqual(totals.get('p45'), { inbound: 0, outbound: 6 }, '5-pack counts 5 units, set adds 1');
  assert.deepEqual(totals.get('p180'), { inbound: 0, outbound: 2 }, 'second 재고매칭 slot is counted');
  assert.deepEqual(unmatched, []);
}
{
  const { totals } = npbInventoryFromLogistics(ledgerRows, products);
  assert.deepEqual(totals.get('p180'), { inbound: 10, outbound: 3 });
}
{
  // An order Sellmate could not match to stock must not be counted by the
  // channel 주문수량 (a 5-pack would count as 1); it is reported instead.
  const unmatchedRow = { ...packRow, ...blankSlots(1) };
  const { totals, unmatched } = npbInventoryFromLogistics([unmatchedRow], products);
  assert.equal(totals.size, 0);
  assert.deepEqual(unmatched, ['(5팩/25개입) 필바이츠 (재고매칭 없음)']);
}
{
  // Order-detail rows without 재고매칭 columns fall back to 주문수량.
  const { totals } = npbInventoryFromLogistics(
    [{ 판매처상품명: 'x', 바코드번호: '8809990970018', 주문수량: 4 }], products);
  assert.deepEqual(totals.get('p45'), { inbound: 0, outbound: 4 });
}

assert.equal(npbLogisticsRowMonth(ledgerRows[0]), '2026-09');
assert.equal(npbLogisticsRowMonth(packRow), '2026-09');
assert.equal(npbLogisticsRowMonth({ 발송일자: '2026-08-31 오후 11:59:00' }), '2026-08');
assert.equal(npbLogisticsRowMonth({ 주문일자: '2026-09-30T00:00:00' }), '');

const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
const zip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0, 0]);
const csv = Buffer.from('입출고일자,상품명\n', 'utf8');
assert.equal(npbIsSpreadsheetUpload('ord_ordList.xls', ole), true);
assert.equal(npbIsSpreadsheetUpload('a.xlsx', zip), true);
assert.equal(npbIsSpreadsheetUpload('renamed.csv', ole), true, 'content wins over a wrong extension');
assert.equal(npbIsSpreadsheetUpload('stk_inoutList.csv', csv), false);

console.log('npb inout verify: all checks passed');
