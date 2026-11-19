// 브랜드가 우리 어드민에서 주문처리를 하지 않을 때, 그 브랜드의 택배 발송용 엑셀 양식
// (예: 펫페이스 발주서)을 우리가 만들어 전달한다. 품목 1개 = 1행.
// A~C: 보내는 분(브랜드 고정값), D~: 받는 분(카페24 주문의 수령인), I: 내품명, J: 수량.

export const SHIP_FORM_HEADERS = [
  "보내는분성명", "보내는분전화번호", "보내는분주소(전체, 분할)",
  "받는분성명", "받는분전화번호", "받는분기타연락처", "받는분우편번호", "받는분주소(전체, 분할)",
  "내품명", "내품수량", "배송메세지"
];

// 펫페이스(리딩펫) 기본값 — 대표가 준 양식(2026-11-19)의 A~C열.
export const DEFAULT_SHIP_FORMS = {
  펫페이스: { enabled: true, senderName: "리딩펫", senderPhone: "01077455522", senderAddress: "경기도 양주시 은현면 도하리 93-18", fileLabel: "펫페이스 발주서" }
};

export function shipFormOf(brand) {
  if (brand?.shipForm && typeof brand.shipForm === "object") return brand.shipForm;
  const key = Object.keys(DEFAULT_SHIP_FORMS).find((k) => String(brand?.name || "").includes(k));
  return key ? DEFAULT_SHIP_FORMS[key] : null;
}

const liveItem = (item) => !/^[CRE]/.test(String(item.order_status || "")) && !item.refund_date && !item.cancel_date;

// orders: 카페24 주문(embed=items,receivers). supplierId 의 품목만 넣는다.
export function buildShipFormRows(orders, { supplierId = "", form }) {
  const rows = [];
  const missing = [];
  const sid = String(supplierId || "").trim().toUpperCase();
  for (const order of orders || []) {
    const r = (order.receivers || [])[0] || {};
    const address = String(r.address_full || [r.address1, r.address2].filter(Boolean).join(" ")).trim();
    for (const item of order.items || []) {
      if (sid && String(item.supplier_id || "").trim().toUpperCase() !== sid) continue;
      if (!liveItem(item)) continue;
      const name = String(item.internal_product_name || "").trim() || String(item.product_name || "").trim();
      const code = String(item.custom_variant_code || "").trim();
      if (!item.internal_product_name) missing.push(`${order.order_id} ${item.product_name || ""}`);
      rows.push([
        form.senderName || "", form.senderPhone || "", form.senderAddress || "",
        String(r.name || order.receiver_name || "").trim(),
        String(r.cellphone || r.phone || "").trim(),
        String(r.phone || r.cellphone || "").trim(),
        String(r.zipcode || "").trim(),
        address,
        code && !name.includes(code) ? `${name} ${code}` : name,
        Number(item.quantity || 0),
        String(r.shipping_message || "").trim()
      ]);
    }
  }
  return { rows, missing };
}

export function shipFormFileName(form, date = new Date()) {
  const kst = new Date(date.getTime() + 9 * 3600000).toISOString().slice(2, 10).replace(/-/g, "");
  return `${form.fileLabel || "택배 발주서"}_우프컴퍼니_${kst}.xlsx`;
}
