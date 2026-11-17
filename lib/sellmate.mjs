// 셀메이트(풀필먼트) 재고 엑셀 → ERP (v2).
//
// 셀메이트 '재고 내보내기'는 확장자가 .xlsx 여도 실제로는 CSV(cp949)다. 화면에서 글자로 바꿔 보낸다.
// - 한 줄 = SKU 하나. 셀메이트 고유번호(바코드번호 1-7243…)로 맞춘다.
// - '공급처'는 상품 종류가 아니라 **재고 귀속 사업자**다(우프재고 = 우프컴퍼니, 베럴즈 = 예전 Betters 귀속).
// - 상품 종류는 이름으로 먼저 나눈다: 베럴즈 → 제품(PB), 픽키도기클럽·도톤·공감캣 → 제품(NPB), 그 밖 → 거래처 상품(확인 필요 표시).
// - 올릴 때마다 그날 재고를 스냅샷으로 남긴다(재고 추이·재고자산).

import { parseCsv } from "./notion-archive.mjs";

const clean = (v) => String(v ?? "").replace(/^=?"?|"$/g, "").trim();
const int = (v) => { const n = Number(clean(v).replace(/,/g, "")); return Number.isFinite(n) ? Math.round(n) : 0; };

export const OWNER_FROM_SUPPLIER = { 우프재고: "wooof", 베럴즈: "betters", 자사: "wooof", 픽키도기클럽: "npb", 도톤: "npb", 공감캣: "npb" };
export const OWNER_LABELS = { wooof: "우프컴퍼니", betters: "Betters(예전 귀속)", npb: "NPB", other: "기타" };
const NPB_BRANDS = ["픽키도기클럽", "도톤", "공감캣"];
const NPB_LINES = { 필바이츠: "픽키도기클럽" }; // 상품 이름에 브랜드 대신 상품군만 있는 경우

// '2026-10-13 오후 6:33:59' → '2026-10-13T18:33:59+09:00'
export function parseSellmateTime(v) {
  const t = clean(v);
  const m = t.match(/(\d{4})-(\d{2})-(\d{2})(?:\s*(오전|오후)\s*(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return "";
  if (!m[4]) return `${m[1]}-${m[2]}-${m[3]}`;
  let h = Number(m[5]) % 12;
  if (m[4] === "오후") h += 12;
  return `${m[1]}-${m[2]}-${m[3]}T${String(h).padStart(2, "0")}:${m[6]}:${m[7] || "00"}+09:00`;
}

// 대표가 정해 준 분류(2026-11-17). 다시 올려도 같은 분류가 되게 이름 규칙으로 둔다.
//   콘디: 2025년부터 PB(입점 브랜드였다가 원단 매입 후 자체 생산). 멍랩 와펜: 우프 제작품(마지막 재고).
//   누기패드·라루·바스락삑삑: 우프가 소싱한 외부 제품(마지막 재고, 다시 주문 안 함).
const PB_KEYWORDS = ["베럴즈", "콘디", "멍랩"];
const SOURCED_KEYWORDS = ["누기패드", "라루", "바스락삑삑"];
const DISCONTINUED_KEYWORDS = ["누기패드", "라루", "멍랩", "바스락삑삑"]; // 바스락삑삑 장난감: 단종(2026-11-17)
export function classifyProduct(name, supplier) {
  const n = String(name || "");
  const discontinued = DISCONTINUED_KEYWORDS.some((k) => n.includes(k));
  const base = classifyBase(n, supplier);
  return discontinued ? { ...base, discontinued: true } : base;
}
function classifyBase(n, supplier) {
  if (SOURCED_KEYWORDS.some((k) => n.includes(k))) return { itemKind: "vendorProduct", businessUnit: "", brandHint: "", needsReview: false };
  const npb = NPB_BRANDS.find((b) => n.includes(b)) || Object.entries(NPB_LINES).find(([line]) => n.includes(line))?.[1];
  if (npb) return { itemKind: "product", businessUnit: "npb", brandHint: npb, needsReview: false };
  const pb = PB_KEYWORDS.find((k) => n.includes(k));
  if (pb || /betters/i.test(n) || supplier === "베럴즈") return { itemKind: "product", businessUnit: "pb", brandHint: pb || "베럴즈", needsReview: false };
  return { itemKind: "vendorProduct", businessUnit: "", brandHint: "", needsReview: true };
}

export function parseSellmateRows(text) {
  return parseCsv(text).map((r) => {
    const sellmateCode = clean(r["바코드번호"]);
    if (!sellmateCode) return null;
    const productName = clean(r["상품명"]);
    const optionName = clean(r["옵션명"]);
    const supplier = clean(r["공급처"]);
    // 카페24 상품코드는 8자리(P000XXXX), 옵션까지면 12자리(P000XXXX000A). 칸마다 섞여 있어서 앞 8자리만 상품코드로 쓴다.
    const cafeRaw = [clean(r["상품코드(카페)"]), clean(r["상품코드"])].find((c) => /^P0/.test(c)) || "";
    const cafe = cafeRaw.slice(0, 8);
    const optCode = clean(r["판매처옵션코드"]) || clean(r["옵션코드"]) || (cafeRaw.length >= 12 ? cafeRaw.slice(8, 12) : "");
    const barcode2 = clean(r["바코드번호2"]);
    const altBarcode = [clean(r["상품코드"])].find((c) => /^\d{12,14}$/.test(c)) || "";
    return {
      sellmateCode, productName, optionName: optionName === "단일상품" ? "" : optionName,
      name: optionName && optionName !== "단일상품" ? `${productName} / ${optionName}` : productName,
      supplier, owner: OWNER_FROM_SUPPLIER[supplier] || "other",
      barcode: /^\d{12,14}$/.test(barcode2) ? barcode2 : altBarcode, sellmateCode2: barcode2,
      cafe24Code: cafe, cafe24VariantCode: cafe && optCode ? `${cafe}${optCode}` : "",
      location: clean(r["상품위치"]), stock: int(r["현재재고"]), available: r["가용재고"] !== undefined ? int(r["가용재고"]) : int(r["현재재고"]),
      cost: int(r["원가"]), consumerPrice: int(r["소비자가"]), lastInbound: parseSellmateTime(r["마지막입고일"])
    };
  }).filter(Boolean);
}

// 기존 품목과 맞춘다(셀메이트 고유번호 → 바코드 → 같은 이름). 새로 만들 것 / 고칠 것.
export function planSellmateImport(items = [], rows = []) {
  const byCode = new Map();
  const byBarcode = new Map();
  const byName = new Map();
  for (const m of items) {
    if (m.sellmateCode) byCode.set(m.sellmateCode, m);
    for (const b of [m.barcode, m.itemCode]) if (/^\d{12,14}$/.test(String(b || ""))) byBarcode.set(String(b), m);
    byName.set(String(m.itemName || "").replace(/\s/g, ""), m);
  }
  const creates = [];
  const updates = [];
  for (const r of rows) {
    if (/재발송용 생성코드/.test(r.productName)) continue;
    const hit = byCode.get(r.sellmateCode) || (r.barcode && byBarcode.get(r.barcode)) || byName.get(r.name.replace(/\s/g, ""));
    const sync = { sellmateCode: r.sellmateCode, owner: r.owner, storage: r.location, cafe24Code: r.cafe24Code, cafe24VariantCode: r.cafe24VariantCode,
      sellmateCost: r.cost, lastInbound: r.lastInbound, stock: r.stock, available: r.available };
    if (hit) {
      const patch = { ...sync };
      if (r.barcode && !hit.barcode) patch.barcode = r.barcode;
      // 자동으로 나눴던 품목(사람이 고르지 않은 것)은 셀메이트 규칙으로 다시 맞춘다.
      const c = classifyProduct(r.name, r.supplier);
      if (hit.kindAuto && !c.needsReview && (c.itemKind !== hit.itemKind || (c.businessUnit || "") !== (hit.businessUnit || ""))) {
        Object.assign(patch, { itemKind: c.itemKind, businessUnit: c.businessUnit, ...(c.discontinued ? { discontinued: true } : {}) });
      }
      updates.push({ id: hit.id, name: hit.itemName, patch });
    } else {
      creates.push({ itemName: r.name, ...classifyProduct(r.name, r.supplier), barcode: r.barcode, baseUnit: "개", ...sync, source: "셀메이트" });
    }
  }
  return { creates, updates };
}

export function snapshotTotals(rows) {
  const t = { skus: rows.length, inStock: 0, units: 0, available: 0, costValue: 0, byOwner: {} };
  for (const r of rows) {
    t.units += r.stock;
    t.available += r.available;
    if (r.stock > 0) t.inStock += 1;
    t.costValue += r.stock * (r.cost || 0);
    const o = (t.byOwner[r.owner] ||= { units: 0, costValue: 0 });
    o.units += r.stock;
    o.costValue += r.stock * (r.cost || 0);
  }
  return t;
}
