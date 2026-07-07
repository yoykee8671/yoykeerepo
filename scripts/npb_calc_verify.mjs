#!/usr/bin/env node
// NPB calc engine MASTER GATE — golden-master reproduction of the 2/3/4월
// 도톤 판매정산서 answer keys. Line configs below are transcribed by hand from
// each workbook's '채널별 판매데이터 정리' sheet (non-zero lines only). We import
// the REAL calc engine from server.js (pure functions, no server boot) and
// assert EXACT equality on every rollup number and 3사 분배 amount.
//
//   node scripts/npb_calc_verify.mjs
//
// Answer-key inspection: npb/doteon/(도톤)우프_2026-{2,3,4}월 판매정산서.xlsx

import {
  npbComputeRollup,
  npbComputeLogistics,
  npbComputeProfitSplit
} from '../server.js';

const costConfig = { smallShip: 2650, largeShip: 4400, pickPack: 1430 };

// Line shorthands. rate_on_sale defaults; margin_supply for 매입(쿠팡/테일릿).
const sale = (salePrice, feeRate, qty, eaPerUnit = 1, listPrice = 22000) => ({
  calcType: 'rate_on_sale', listPrice, salePrice, feeRate, qty, eaPerUnit
});
const margin = (salePrice, supplyPrice, qty, eaPerUnit = 1, listPrice = 22000) => ({
  calcType: 'margin_supply', listPrice, salePrice, supplyPrice, qty, eaPerUnit
});

const months = [
  {
    label: '2월',
    lines: [
      sale(22000, 0, 1),      // 우프자사몰 FC (정가판매, 수수료 0)
      sale(11000, 0.15, 1),   // 컬리 FC (할인가 11000, 조율수수료 15%)
      sale(11000, 0.15, 1)    // 컬리 OS
    ],
    ship: { small: 32, large: 0 },
    parties: [
      { partyName: '유씨엘주식회사', ratio: 0.4 },
      { partyName: '우프컴퍼니(주)', ratio: 0.3 },
      { partyName: '(주)메리고라운드', ratio: 0.3 }
    ],
    expect: {
      qtyTotal: 3, listTotal: 66000, discountTotal: 22000, realSaleTotal: 44000,
      feeTotal: 3300, revenueTotal: 40700, logisticsCost: 130560, profit: -89860
    },
    expectSplit: [-35944, -26958, -26958]
  },
  {
    label: '3월',
    lines: [
      sale(17000, 0.2, 7),        // 플리마켓 단품1개
      sale(26000, 0.2, 7, 2),     // 플리마켓 단품2개 (bundle, ea=2)
      sale(22000, 0.3, 1),        // 몰리스 FC
      sale(22000, 0.3, 1),        // 몰리스 OS
      sale(17600, 0.05, 7),       // 우프자사몰 FC (행사가 17600, PG 5%)
      sale(17600, 0.05, 1),       // 우프자사몰 OS
      sale(13200, 0.05, 2),       // 우프B2B OS (소매점가 13200, PG 5%)
      margin(22000, 13860, 2),    // 쿠팡 FC (공급가 고정 13860)
      margin(22000, 13860, 2)     // 쿠팡 OS
    ],
    ship: { small: 10, large: 3 },
    parties: [
      { partyName: '유씨엘주식회사', ratio: 0.55 },
      { partyName: '우프컴퍼니(주)', ratio: 0.45 },
      { partyName: '(주)메리고라운드', ratio: 0, excluded: true, note: '제외' }
    ],
    expect: {
      qtyTotal: 37, listTotal: 814000, discountTotal: 213800, realSaleTotal: 600200,
      feeTotal: 114320, revenueTotal: 485880, logisticsCost: 58290, profit: 337730
    },
    expectSplit: [185751.5, 151978.5, 0]
  },
  {
    label: '4월',
    lines: [
      sale(13200, 0.1, 13),       // 몽슈슈 FC (공급가 13200, 프로모션차감 10%)
      sale(13200, 0.1, 14),       // 몽슈슈 OS
      sale(17600, 0.05, 3),       // 스마트스토어 OS (프로모션가 17600, 5%)
      sale(22000, 0.3, 1),        // 몰리스 FC
      sale(22000, 0.3, 2),        // 몰리스 OS
      sale(17600, 0.05, 8),       // 우프자사몰 FC
      sale(17600, 0.05, 8),       // 우프자사몰 OS
      sale(16500, 0.25, 81),      // 자사몰-공구 1개 (qty already in EA)
      sale(14960, 0.25, 108),     // 자사몰-공구 2개구매시
      sale(14080, 0.25, 66),      // 자사몰-공구 3개구매시
      sale(22000, 0.3, 1),        // 컬리 FC (조율수수료 30%)
      sale(22000, 0.3, 2)         // 컬리 OS
    ],
    ship: { small: 181, large: 0 },
    parties: [
      { partyName: '유씨엘주식회사', ratio: 0.4 },
      { partyName: '우프컴퍼니(주)', ratio: 0.3 },
      { partyName: '재계약중', ratio: 0.3, note: '제외' }
    ],
    expect: {
      qtyTotal: 307, listTotal: 6754000, discountTotal: 2049740, realSaleTotal: 4704260,
      feeTotal: 1062325, revenueTotal: 3641935, logisticsCost: 738480, profit: 2903455
    },
    expectSplit: [1161382, 871036.5, 871036.5]
  }
];

const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('en-US') : String(n));
let allPass = true;
// 이월손실: carry a prior month's net loss forward until it is recovered. Derived
// from the engine's own output (not a magic constant) — matches 3월 answer-key
// formula =매출계-실비-89860 where 89860 = |2월 이익|.
let prevProfit = 0;

for (const month of months) {
  const failures = [];
  const carryOver = prevProfit < 0 ? -prevProfit : 0;
  const logisticsCost = npbComputeLogistics(month.ship.small, month.ship.large, costConfig);
  const rollup = npbComputeRollup(month.lines, logisticsCost, carryOver);
  prevProfit = rollup.profit;

  for (const [key, want] of Object.entries(month.expect)) {
    const got = rollup[key];
    if (got !== want) failures.push(`${key}: got ${fmt(got)} !== expected ${fmt(want)}`);
  }

  const split = npbComputeProfitSplit(rollup.profit, month.parties);
  const splitSum = split.reduce((sum, part) => sum + part.amount, 0);
  month.expectSplit.forEach((want, index) => {
    const got = split[index] ? split[index].amount : undefined;
    // .5 shares are exact rationals; allow float epsilon (answer key stores the
    // same 185751.50000000003 for 0.55*337730).
    if (typeof got !== 'number' || Math.abs(got - want) > 1e-6) {
      const name = month.parties[index].partyName;
      failures.push(`분배[${name}]: got ${fmt(got)} !== expected ${fmt(want)}`);
    }
  });
  // 분배 합계는 이익과 일치해야 한다 (제외/재분배 후에도 총액 보존).
  if (Math.abs(splitSum - rollup.profit) > 1e-6) {
    failures.push(`분배합계: ${fmt(splitSum)} !== 이익 ${fmt(rollup.profit)}`);
  }

  if (failures.length === 0) {
    console.log(`PASS ${month.label}  ` +
      `총수량=${fmt(rollup.qtyTotal)} 정가계=${fmt(rollup.listTotal)} ` +
      `할인계=${fmt(rollup.discountTotal)} 실판매계=${fmt(rollup.realSaleTotal)} ` +
      `공제=${fmt(rollup.feeTotal)} 매출계=${fmt(rollup.revenueTotal)} ` +
      `실비=${fmt(rollup.logisticsCost)} ` +
      `${rollup.carryOver ? `이월=${fmt(rollup.carryOver)} ` : ''}` +
      `이익=${fmt(rollup.profit)} | ` +
      `분배=[${split.map((part) => fmt(part.amount)).join(', ')}]`);
  } else {
    allPass = false;
    console.log(`FAIL ${month.label}`);
    for (const failure of failures) console.log(`  - ${failure}`);
  }
}

console.log('');
console.log(allPass
  ? 'MASTER GATE: PASS — 2/3/4월 all reproduce EXACTLY.'
  : 'MASTER GATE: FAIL — see discrepancies above.');
process.exit(allPass ? 0 : 1);
