// Adapts Cafe24 Admin API orders into the Korean-keyed rows the settlement
// engine already reads from an uploaded CSV, so computeSettlementResult works
// identically whichever source the data came from.
//
// One row per order item, mirroring the export: order-level values (배송비,
// 주문서 쿠폰) repeat on every row of the order because the engine reduces them
// with max() rather than sum().
//
// Field names come from a real API response, not the docs — the docs site
// renders its field reference client-side and could not be read.

// Shipping is quoted per supplier group, which is exactly the granularity a
// per-brand settlement needs: a multi-brand order must not charge one brand's
// shipping to another.
function shippingForSupplier(order, supplierId, itemCode) {
  const groups = order.shipping_fee_detail || [];
  const match =
    groups.find((group) => (group.items || []).includes(itemCode)) ||
    groups.find((group) => String(group.supplier_code || "") === String(supplierId || ""));
  if (!match) return { base: 0, refunded: 0 };
  return {
    base: num(match.shipping_fee) + num(match.additional_shipping_fee),
    refunded: num(match.refunded_shipping_fee) + num(match.return_shipping_fee)
  };
}

// 취소/반품/교환은 주문상태 접두어로 갈린다: C=취소, R=반품, E=교환.
// 환불일이 찍혔거나 클레임 수량이 있으면 그것도 취소로 본다.
function claimInfo(item) {
  const status = String(item.order_status || "");
  const isClaim = /^[CRE]/.test(status) || Boolean(item.refund_date) || num(item.claim_quantity) > 0;
  if (!isClaim) return { cancelled: false, statusText: "", refundDate: "" };
  return {
    cancelled: true,
    statusText: item.status_text || item.claim_reason_type || "취소/교환",
    refundDate: dateOnly(item.refund_date) || dateOnly(item.cancel_date) || dateOnly(item.return_confirmed_date) || ""
  };
}

export function cafe24OrdersToRows(orders = []) {
  const rows = [];
  for (const order of orders) {
    const orderId = String(order.order_id || "");
    const actual = order.actual_order_amount || order.initial_order_amount || {};
    const orderCoupon = num(actual.coupon_discount_price);
    const regional =
      (order.regional_surcharge_detail || []).reduce((sum, entry) => sum + num(entry.surcharge ?? entry.shipping_fee), 0) ||
      num(order.additional_shipping_fee);

    for (const item of order.items || []) {
      const itemCode = String(item.order_item_code || "");
      const ship = shippingForSupplier(order, item.supplier_id, itemCode);
      const claim = claimInfo(item);
      rows.push({
        "주문번호": orderId,
        "품목별 주문번호": itemCode,
        "공급사": String(item.supplier_id || ""),
        "공급사명": String(item.supplier_name || ""),
        "주문상품명(기본)": String(item.product_name || item.product_name_default || ""),
        "수량": num(item.quantity),
        "판매가": num(item.product_price),
        "옵션추가 가격": num(item.option_price),
        // 내보내기가 합쳐서 주는 컬럼도 같이 낸다. 엔진이 이쪽을 우선하므로
        // 두 형식 어디에도 맞고, 옵션가가 빠질 여지가 없다.
        "옵션+판매가": num(item.product_price) + num(item.option_price),
        "상품별 추가할인금액": num(item.additional_discount_price),
        "쿠폰 할인금액(최종)": num(item.coupon_discount_price),
        "주문서 쿠폰 할인금액": orderCoupon,
        // 배송완료일과 배송시작일(shipped_date)은 다르다. 정산 포함 여부를 가르는
        // 값이므로 반드시 delivered_date 를 쓴다.
        "배송완료일": dateOnly(item.delivered_date),
        "주문일": dateOnly(item.ordered_date || order.order_date),
        "공급사 기본 배송비": ship.base,
        "개별배송비": num(item.individual_shipping_fee),
        "지역별 배송비": regional,
        "환불완료일": claim.refundDate,
        "환불상태": claim.cancelled ? claim.statusText : "",
        "총 실제 환불금액": claim.cancelled ? num(item.payment_amount) : 0,
        "취소처리중[환불완료] 처리일": ""
      });
    }
  }
  return rows;
}

// Compares adapted API rows against the CSV rows for the same items, so a
// wrong assumption (a per-unit value mapped as a line total, say) shows up as
// a concrete diff rather than a quietly wrong settlement.
const COMPARE_FIELDS = [
  "공급사", "수량", "옵션+판매가", "상품별 추가할인금액",
  "쿠폰 할인금액(최종)", "배송완료일", "공급사 기본 배송비", "개별배송비"
];

export function compareRows(csvRows = [], apiRows = []) {
  const key = (row) => String(row["품목별 주문번호"] || "").trim();
  const csvByKey = new Map();
  for (const row of csvRows) {
    const k = key(row);
    if (k) csvByKey.set(k, row);
  }
  const diffs = [];
  let compared = 0;
  const onlyInApi = [];
  const matchedKeys = new Set();

  for (const apiRow of apiRows) {
    const k = key(apiRow);
    const csvRow = csvByKey.get(k);
    if (!csvRow) {
      onlyInApi.push(k);
      continue;
    }
    matchedKeys.add(k);
    compared += 1;
    for (const field of COMPARE_FIELDS) {
      const a = normalize(apiRow[field]);
      const c = normalize(csvRow[field]);
      if (a !== c) diffs.push({ itemNo: k, field, api: a, csv: c });
    }
  }

  const onlyInCsv = [...csvByKey.keys()].filter((k) => !matchedKeys.has(k));
  return {
    compared,
    diffCount: diffs.length,
    diffsByField: diffs.reduce((acc, d) => {
      acc[d.field] = (acc[d.field] || 0) + 1;
      return acc;
    }, {}),
    diffs: diffs.slice(0, 100),
    onlyInApi: onlyInApi.slice(0, 50),
    onlyInCsv: onlyInCsv.slice(0, 50),
    onlyInApiCount: onlyInApi.length,
    onlyInCsvCount: onlyInCsv.length
  };
}

// Dates compare on the day; amounts compare numerically so "0.00" and "0" and
// "" are the same thing.
function normalize(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const asDate = dateOnly(text);
  if (asDate) return asDate;
  const cleaned = text.replace(/,/g, "");
  if (/^-?\d+(\.\d+)?$/.test(cleaned)) return String(Number(cleaned));
  return text;
}

function num(value) {
  const n = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function dateOnly(value) {
  const text = String(value ?? "").trim();
  if (!text) return "";
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dotted = text.match(/^(\d{4})[.\/](\d{1,2})[.\/](\d{1,2})/);
  if (dotted) {
    return `${dotted[1]}-${String(Number(dotted[2])).padStart(2, "0")}-${String(Number(dotted[3])).padStart(2, "0")}`;
  }
  return "";
}
