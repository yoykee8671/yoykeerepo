// Turns paid Cafe24 orders into draft 입금요청.
//
// Three rules from how the desk actually works:
//   - Only paid orders count. 입금전 is not an order yet.
//   - One request per (주문번호, 브랜드). A single order routinely carries items
//     from several suppliers and each brand is paid separately.
//   - Lines stay at 품목별 주문번호 granularity. Merging items of the same brand
//     would lose the identifier the settlement reconciles against.
//
// Shipping is the exception to item granularity: Cafe24 quotes it once per
// supplier group within an order, which is the same unit the brand's shipping
// rule applies to.
//
// Nothing is written here. The caller previews, a human confirms, and only then
// are requests created.

// 결제완료로 볼 수 있는 상태. 입금전(F)·추가입금대기(M)는 주문으로 치지 않는다.
const PAID_PAYMENT_STATUS = new Set(["T", "A", "P"]);

// 취소·반품·교환에 들어간 품목은 지급 대상이 아니다.
function isLiveItem(item) {
  const status = String(item.order_status || "");
  if (/^[CRE]/.test(status)) return false;
  if (item.refund_date || item.cancel_date) return false;
  return true;
}

function isPaidOrder(order) {
  if (String(order.canceled || "") === "T") return false;
  if (String(order.paid || "") === "T") return true;
  return PAID_PAYMENT_STATUS.has(String(order.payment_status || ""));
}

function num(value) {
  const n = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
}

// 주문 내 공급사 단위 배송비. 카페24가 이미 이 단위로 끊어서 준다.
function supplierShipping(order, supplierId, itemCodes) {
  const groups = order.shipping_fee_detail || [];
  const match =
    groups.find((group) => (group.items || []).some((code) => itemCodes.includes(code))) ||
    groups.find((group) => String(group.supplier_code || "") === String(supplierId || ""));
  if (!match) return 0;
  return num(match.shipping_fee) + num(match.additional_shipping_fee);
}

export function buildRequestDrafts({ orders = [], brands = [], existingRequests = [] }) {
  const brandBySupplier = new Map();
  for (const brand of brands) {
    const key = String(brand.cafe24Supplier || "").trim().toUpperCase();
    if (key) brandBySupplier.set(key, brand);
  }

  // 이미 만들어진 (주문번호, 브랜드) 조합은 다시 만들지 않는다.
  const existingKeys = new Set(
    existingRequests
      .filter((request) => request.status !== "deleted")
      .map((request) => `${String(request.orderNo || "").trim()}::${request.brandId || ""}`)
  );

  const drafts = [];
  const skipped = { unpaid: 0, cancelled: 0, duplicate: 0 };
  const unmappedSuppliers = new Map();

  for (const order of orders) {
    if (!isPaidOrder(order)) {
      skipped.unpaid += 1;
      continue;
    }
    const orderNo = String(order.order_id || "").trim();
    const liveItems = (order.items || []).filter(isLiveItem);
    if (!liveItems.length) {
      skipped.cancelled += 1;
      continue;
    }

    const bySupplier = new Map();
    for (const item of liveItems) {
      const key = String(item.supplier_id || "").trim().toUpperCase();
      if (!bySupplier.has(key)) bySupplier.set(key, []);
      bySupplier.get(key).push(item);
    }

    for (const [supplierId, items] of bySupplier) {
      const brand = brandBySupplier.get(supplierId);
      if (!brand) {
        const name = items[0]?.supplier_name || supplierId;
        const entry = unmappedSuppliers.get(supplierId) || { supplierId, supplierName: name, orderCount: 0 };
        entry.orderCount += 1;
        unmappedSuppliers.set(supplierId, entry);
        continue;
      }
      if (existingKeys.has(`${orderNo}::${brand.id}`)) {
        skipped.duplicate += 1;
        continue;
      }

      const itemCodes = items.map((item) => String(item.order_item_code || ""));
      const lineItems = items.map((item) => {
        const quantity = Math.max(1, num(item.quantity));
        // 단가는 옵션 포함가. 할인은 카페24가 라인 합계로 주므로 라인에서 뺀다.
        const unitOriginal = num(item.product_price) + num(item.option_price);
        const lineDiscount = num(item.additional_discount_price) + num(item.coupon_discount_price);
        const totalSaleAmount = Math.max(0, unitOriginal * quantity - lineDiscount);
        return {
          orderItemCode: String(item.order_item_code || ""),
          itemCode: String(item.custom_product_code || item.product_code || "").trim(),
          itemName: String(item.product_name || item.product_name_default || "").trim(),
          quantity,
          originalPrice: unitOriginal,
          // 라인 총액을 먼저 확정하고 단가를 역산한다. 할인 단위를 잘못 잡아
          // 금액이 어긋나는 것을 피하기 위해 총액을 원본으로 삼는다.
          unitSalePrice: Math.round(totalSaleAmount / quantity),
          totalSaleAmount,
          unitSupplyPrice: num(item.supply_price),
          totalSupplyPrice: num(item.supply_price) * quantity,
          note: item.option_value || ""
        };
      });

      drafts.push({
        orderNo,
        brandId: brand.id,
        brandName: brand.name,
        supplierId,
        customerName: String(order.buyer_name || order.billing_name || "").trim(),
        orderedAt: String(order.order_date || ""),
        // 카페24가 실제로 청구한 배송비. 브랜드 규칙으로 계산한 값과 다르면
        // 확인 단계에서 드러난다.
        cafe24ShippingFee: supplierShipping(order, supplierId, itemCodes),
        payAfterShipping: brand.payAfterShipping === true,
        shipped: items.some((item) => Boolean(item.tracking_no)),
        lineItems
      });
    }
  }

  return {
    drafts,
    skipped,
    unmappedSuppliers: [...unmappedSuppliers.values()].sort((a, b) => b.orderCount - a.orderCount)
  };
}

// 이미 등록된 요청 중, 출고후입금 브랜드이면서 송장이 찍힌 건을 찾는다.
// 이 건들은 입금대기 → 입금요청으로 올라가야 한다.
export function findShippedAwaiting({ orders = [], requests = [], brands = [] }) {
  const brandById = new Map(brands.map((brand) => [brand.id, brand]));
  const shippedOrders = new Map(); // `${orderNo}::${supplierId}` -> tracking_no
  for (const order of orders) {
    const orderNo = String(order.order_id || "").trim();
    for (const item of order.items || []) {
      if (!item.tracking_no) continue;
      const key = `${orderNo}::${String(item.supplier_id || "").trim().toUpperCase()}`;
      if (!shippedOrders.has(key)) shippedOrders.set(key, String(item.tracking_no));
    }
  }

  return requests
    .filter((request) => request.status === "await_deposit")
    .map((request) => {
      const brand = brandById.get(request.brandId);
      const supplierId = String(brand?.cafe24Supplier || "").trim().toUpperCase();
      const trackingNo = shippedOrders.get(`${String(request.orderNo || "").trim()}::${supplierId}`);
      return trackingNo ? { request, brand, trackingNo } : null;
    })
    .filter(Boolean);
}
