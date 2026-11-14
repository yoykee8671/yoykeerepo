#!/usr/bin/env node
// Verifies brand info import from the partner form responses: latest response
// wins, empty fields auto-fill, conflicts (bank) ask, new and dormant brands.
//
//   node scripts/v2_brand_info_verify.mjs

import assert from 'node:assert/strict';
import { formTime, readResponse, planBrandInfo, applyPaths, brandInfoQuestions } from '../lib/brand-info.mjs';

assert.equal(formTime('2025. 4. 23 오후 2:14:31'), '2025-04-23T14:14');
assert.equal(formTime('2024. 1. 5 오전 12:03:00'), '2024-01-05T00:03');

const row = (ts, name, account, email, main) => ({ '타임스탬프': ts, '0-1. 브랜드명 (국문)': name, '0-4. 회사명(상호)': `${name}상사`,
  '1-1.  전자 세금계산서 발행용 이메일 주소': email, '1-3. 파트너 결제 정보 [계좌번호]': account, '2-1. 운영 메인 담당자 성함 (필수)': main,
  '2-1. 메인 담당자 이메일 주소 (필수)': 'm@x.kr' });
const r = readResponse(row('2025. 4. 23 오후 2:14:31', '퍼펫', '123-45', 'a@b.c', '문유빈'));
assert.equal(r.name, '퍼펫');
assert.equal(r.values['profile.contacts.main.name'], '문유빈');
assert.equal(r.values['profile.contacts.main.email'], 'm@x.kr');
assert.equal(r.values['top.bankAccount'], '123-45');

const brands = [
  { id: 'p', name: '퍼펫', type: 'brand', bankAccount: '999-99', businessName: '' },
  { id: 'g', name: '고공캣', type: 'brand', bankAccount: '12345', profile: { invoiceEmail: 'old@x.kr' } },
  { id: 'd', name: '잠자는곳', type: 'brand' }
];
const sheets = {
  '2022-24': [row('2023. 1. 1 오전 9:00:00', '퍼펫', '111-11', 'old@p.kr', '옛담당')],
  '2025': [row('2025. 4. 23 오후 2:14:31', '퍼펫', '123-45', 'new@p.kr', '문유빈'), row('2025. 5. 1 오전 9:00:00', '고공캣', '1-2345', 'old@x.kr', '김지연'),
    row('2025. 6. 1 오전 9:00:00', '새브랜드', '1', 'n@n.kr', '홍')]
};
const requests = [{ brandId: 'p', createdAt: '2026-11-01' }, { brandId: 'g', createdAt: '2026-10-01' }, { brandId: 'd', createdAt: '2025-01-01' }];
const plan = planBrandInfo({ brands, sheets, requests, today: '2026-11-14' });
const pa = plan.auto.find((a) => a.brandId === 'p');
assert.equal(pa.set['top.businessName'], '퍼펫상사', 'empty field filled from the latest response');
assert.equal(pa.set['profile.contacts.main.name'], '문유빈');
const pc = plan.conflicts.find((c) => c.brandId === 'p');
assert.deepEqual(pc.fields.map((f) => [f.path, f.sheet]), [['top.bankAccount', '123-45']]);
assert.ok(!plan.conflicts.some((c) => c.brandId === 'g'), 'same account digits and same email are not conflicts');
assert.deepEqual(plan.newBrands.map((n) => n.name), ['새브랜드']);
assert.deepEqual(plan.dormant.map((d) => d.brandId), ['d']);

const b = applyPaths({ id: 'p' }, pa.set);
assert.equal(b.businessName, '퍼펫상사');
assert.equal(b.profile.contacts.main.name, '문유빈');
const qs = brandInfoQuestions(plan);
assert.deepEqual(qs.map((q) => q.kind), ['brand-info', 'brand-new']);
assert.equal(qs[0].suggested, 'sheet-no-bank');

console.log('v2 brand info verify: all checks passed');
