#!/usr/bin/env node
// Verifies per-channel pricing: lookup order, rounding, VAT modes, periods,
// NPB seeding, and the setup questions it raises.
//
//   node scripts/v2_pricing_verify.mjs

import assert from 'node:assert/strict';
import {
  roundPrice, resolvePrice, priceSheet, pricingQuestions, seedChannelsFromNpb, channelKeyFromNpb,
  seedExceptionsFromNpb
} from '../lib/channel-pricing.mjs';

assert.equal(roundPrice(12345, 10, 'round'), 12350);
assert.equal(roundPrice(12345, 100, 'floor'), 12300);
assert.equal(roundPrice(12301, 100, 'ceil'), 12400);
assert.equal(roundPrice(19.999999999, 1, 'floor'), 20 - 1 + 1, 'float noise does not drop a unit');

const item = { ref: 'npb:pb45', name: '필바이츠 45g', listPrice: 6800 };
const kurly = { id: 'ch1', name: '컬리', pricingMode: 'discount', rate: 35, roundUnit: 10, roundMethod: 'floor' };

// rule: 6800 × 0.65 = 4420
let r = resolvePrice({ channel: kurly, item });
assert.equal(r.status, 'ok');
assert.equal(r.source, 'rule');
assert.equal(r.unitPrice, 4420);
assert.equal(r.supply + r.vat, 4420);
assert.equal(r.supply, Math.round(4420 / 1.1));

// period exception wins inside the period only
const exceptions = [
  { id: 'x1', channelId: 'ch1', itemRef: 'npb:pb45', mode: 'fixed', price: 3900, from: '2026-12-01', to: '2026-12-15' },
  { id: 'x0', channelId: 'ch1', itemRef: 'npb:pb45', mode: 'discount', rate: 40 }
];
r = resolvePrice({ channel: kurly, item, exceptions, date: '2026-12-10' });
assert.equal(r.source, 'exception');
assert.equal(r.unitPrice, 3900);
r = resolvePrice({ channel: kurly, item, exceptions, date: '2026-12-20' });
assert.equal(r.exceptionId, 'x0', 'open-ended exception after the promo ends');
assert.equal(r.unitPrice, 4080);
r = resolvePrice({ channel: kurly, item, exceptions: [exceptions[0]], date: '2026-12-20' });
assert.equal(r.source, 'rule', 'expired promo falls back to the channel rule');

// VAT-excluded channel: price is the supply price, rounded on the supply side
const emart = { id: 'ch2', name: '이마트', pricingMode: 'supply_rate', rate: 70, vatMode: 'excluded', roundUnit: 10, roundMethod: 'round' };
r = resolvePrice({ channel: emart, item: { ref: 'npb:d', name: '도톤', listPrice: 22000 } });
assert.equal(r.unitPrice, 14000, '22000 × 0.7 / 1.1 = 14000');
assert.equal(r.supply, 14000);
assert.equal(r.vat, 1400);
assert.equal(r.vatMode, 'excluded');

// fixed exception written VAT-excluded on a VAT-included channel
r = resolvePrice({ channel: kurly, item, exceptions: [{ id: 'x2', channelId: 'ch1', itemRef: 'npb:pb45', mode: 'fixed', price: 4000, vatMode: 'excluded' }] });
assert.equal(r.unitPrice, 4000);
assert.equal(r.gross, 4400);

// unknown: no rule → missing
r = resolvePrice({ channel: { id: 'ch3', name: '신규' }, item });
assert.equal(r.status, 'missing');
r = resolvePrice({ channel: { id: 'ch3', name: '신규', pricingMode: 'fixed' }, item });
assert.equal(r.note, '고정가 미입력');

assert.equal(priceSheet({ channel: kurly, items: [item, { ref: 'x', name: '정가없음' }] })[1].status, 'missing');

// seeding: brand-split NPB channels merge, supply rate hint
assert.equal(channelKeyFromNpb('picky_coupang'), 'coupang');
assert.equal(channelKeyFromNpb('picky_sparkpet'), 'spark');
assert.equal(channelKeyFromNpb('picky_b2c'), 'wooofmall');
const npb = [
  { code: 'coupang', name: '쿠팡', salePrice: 22000, supplyPrice: 13860, feeRate: 0.37, vatIncluded: true },
  { code: 'picky_coupang', name: 'coupang', salePrice: 6800, feeRate: 0 },
  { code: 'emart', name: '몰리스(이마트)', salePrice: 22000, supplyPrice: 15400, feeRate: 0.3, vatIncluded: false },
  { code: 'picky_b2c', name: 'wooof-cafe24', note: '자사몰' },
  { code: 'wooofmall', name: '우프자사몰' }
];
const seed = seedChannelsFromNpb(npb);
assert.equal(seed.created.length, 3);
const coupang = seed.created.find((c) => c.seedKey === 'coupang');
assert.equal(coupang.name, '쿠팡');
assert.deepEqual(coupang.npbChannelCodes, ['coupang', 'picky_coupang']);
assert.equal(coupang.feeRate, 37);
assert.equal(seed.hints.coupang.supplyRate, 63);
assert.equal(seed.created.find((c) => c.seedKey === 'emart').vatMode, 'excluded');
assert.equal(seed.created.find((c) => c.seedKey === 'emart').type, 'offline');
assert.equal(seed.created.find((c) => c.seedKey === 'wooofmall').type, 'own_mall');
assert.equal(seedChannelsFromNpb(npb, seed.created).created.length, 0, 're-seeding adds nothing');

// questions: missing rule + used price mismatch
const channels = [{ ...coupang, id: 'chC' }, kurly];
const qs = pricingQuestions({
  channels, items: [item], exceptions: [],
  used: [
    { channelId: 'ch1', itemRef: 'npb:pb45', unitPrice: 4420, date: '2026-10-01', docNo: 'TS-1' }, // matches
    { channelId: 'ch1', itemRef: 'npb:pb45', unitPrice: 4500, date: '2026-11-01', docNo: 'TS-2' }  // latest, differs
  ],
  hints: { chC: { supplyRate: 63, feeRate: 37 } }
});
assert.deepEqual(qs.map((q) => q.kind), ['channel-rule', 'channel-price']);
assert.equal(qs[0].suggested, 'supply_rate');
assert.ok(qs[1].detail.includes('TS-2'));
assert.equal(qs[1].choices[0].value, 4500);

// per-brand seeds: doteon coupang supply price → fixed; picky coupang fee 0 ≠ 37 → fee-only exception
const npbB = npb.map((n) => ({ ...n, brandId: n.code.startsWith('picky_') ? 'picky' : 'doteon' }));
const chs = seed.created.map((c, i) => ({ ...c, id: `CH${i}` }));
const seededX = seedExceptionsFromNpb(npbB, chs, [{ id: 'fc', brandId: 'doteon', listPrice: 22000 }, { id: 'pb45', brandId: 'picky', listPrice: 6800 }]);
const cx = seededX.find((x) => x.itemRef === 'npb:fc' && x.note === 'coupang');
assert.equal(cx.mode, 'fixed');
assert.equal(cx.price, 13860);
const px = seededX.find((x) => x.itemRef === 'npb:pb45' && x.note === 'picky_coupang');
assert.equal(px.mode, undefined);
assert.equal(px.feeRate, 0);
const chCoupang = chs.find((c) => c.seedKey === 'coupang');
r = resolvePrice({ channel: { ...chCoupang, pricingMode: 'list' }, item: { ref: 'npb:pb45', name: 'pb', listPrice: 6800 }, exceptions: seededX });
assert.equal(r.unitPrice, 6800, 'fee-only exception keeps the rule price');
assert.equal(r.feeRate, 0);
r = resolvePrice({ channel: { ...chCoupang, pricingMode: 'list' }, item: { ref: 'npb:fc', name: 'fc', listPrice: 22000 }, exceptions: seededX });
assert.equal(r.unitPrice, 13860);
assert.equal(r.feeRate, 37);

console.log('v2 pricing verify: all checks passed');
