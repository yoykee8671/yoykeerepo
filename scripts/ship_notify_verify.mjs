// node scripts/ship_notify_verify.mjs — 출고 알림: 받는 곳 찾기, 문구, 문자 길이, 자동 대상
import assert from "node:assert/strict";
import * as sn from "../lib/ship-notify.mjs";

const partners = [{ code: "PT-0001", contactPhone: "010-1111-2222", contactEmail: "", invoiceEmail: "tax@b.com" }];
const brand = { id: "b1", name: "테일릿", partnerCode: "PT-0001", profile: { ceoPhone: "02-123-4567" } };
// 주문배송 담당이 비면: 설문 대표자(02 번호는 휴대폰 아님) → 거래처 담당자 휴대폰
assert.deepEqual(sn.resolveShipPhone(brand, partners), { value: "01011112222", source: "거래처 담당자" });
assert.deepEqual(sn.resolveShipPhone({ ...brand, shipContactPhone: "010-9999-8888" }, partners), { value: "01099998888", source: "주문배송 담당" });
// 메일: 담당자 메일 없음 → 거래처 계산서 메일
assert.deepEqual(sn.resolveShipEmail(brand, partners), { value: "tax@b.com", source: "거래처 계산서 메일" });
assert.equal(sn.resolveShipEmail({ ...brand, shipContactEmail: "ship@b.com" }, partners).value, "ship@b.com");
assert.equal(sn.resolveShipPhone({ name: "x" }, []).value, "");

// 기본 문자 문구는 단문(90byte) 안
const req = { id: "r1", orderNo: "20261118-0000012", customerName: "홍길동", paidAt: "2026-11-18T05:00:00Z", lineItems: [{ itemName: "간식", quantity: 2 }] };
for (const t of sn.DEFAULT_TEMPLATES.sms) {
  const text = sn.fillTemplate(t.text, sn.templateVars({ name: "아더마스펫" }, [req, { ...req, id: "r2", orderNo: "20261118-0000013" }]));
  assert.ok(sn.smsBytes(text) <= 90, `${t.id} ${sn.smsBytes(text)}byte: ${text}`);
}
assert.equal(sn.smsBytes("가a1"), 4);
assert.equal(sn.fillTemplate("{브랜드}/{없음}", { 브랜드: "A" }), "A/{없음}");

// 자동 대상: 자동 켠 뒤 입금완료 + 안 보냄 + 3일 안
const now = new Date("2026-11-18T09:00:00Z");
const db = {
  brands: [{ id: "b1", name: "A", shipSmsMode: "auto", shipSmsAutoSince: "2026-11-18T04:00:00Z", shipMailMode: "manual" }],
  requests: [
    { id: "a", brandId: "b1", status: "paid", paidAt: "2026-11-18T05:00:00Z" },
    { id: "b", brandId: "b1", status: "paid", paidAt: "2026-11-18T03:00:00Z" }, // 켜기 전
    { id: "c", brandId: "b1", status: "paid", paidAt: "2026-11-18T06:00:00Z", shipNotify: { sms: { ok: true } } },
    { id: "d", brandId: "b1", status: "pending", paidAt: "" },
    { id: "e", brandId: "b1", status: "paid", paidAt: "2026-11-18T07:00:00Z", shipNotify: { sms: { pendingAt: "2026-11-18T08:55:00Z" } } }
  ]
};
assert.deepEqual(sn.dueAutoNotices(db, { now }).map((d) => [d.request.id, d.channel]), [["a", "sms"]]);
console.log("ship notify verify: all checks passed");
