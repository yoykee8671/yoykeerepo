import http from "node:http";
import { readFile, writeFile, mkdir, stat, unlink } from "node:fs/promises";
import { realpathSync } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import { gzip as gzipCb } from "node:zlib";
import pg from "pg";
import * as clobe from "./lib/clobe-mcp.mjs";
import { reconcile } from "./lib/clobe-reconcile.mjs";
import * as cafe24 from "./lib/cafe24-api.mjs";
import { cafe24OrdersToRows, compareRows } from "./lib/cafe24-rows.mjs";
import { buildRequestDrafts, findShippedAwaiting } from "./lib/cafe24-collect.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "db.json");
const PRICE_WORKBOOK_SCRIPT = path.join(__dirname, "scripts", "price_entry_excel.py");
const SETTLEMENT_SCRIPT = path.join(__dirname, "scripts", "settlement_excel.py");
const XLSX_PARSE_SCRIPT = path.join(__dirname, "scripts", "xlsx_to_json.py");
const NPB_PARSE_SCRIPT = path.join(__dirname, "scripts", "npb_parse.py");
const NPB_XLSX_SCRIPT = path.join(__dirname, "scripts", "npb_settlement_xlsx.py");
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "0.0.0.0";
const execFileAsync = promisify(execFile);
const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();
const POSTGRES_STATE_ROW_ID = "primary";
const pgPool = DATABASE_URL ? new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: /supabase\.(co|com)/.test(DATABASE_URL) ? { rejectUnauthorized: false } : undefined
}) : null;

const SESSION_TTL_MS = 1000 * 60 * 60 * 12;
const sessions = new Map();

const sheetTabs = [
  ["1629213714", "입금요청시트"],
  ["1994375587", "테일릿(주미스)"],
  ["618044748", "펫페이스"],
  ["1125741887", "니드포펫"],
  ["1983204101", "릴리스키친"],
  ["1067605749", "페슬러"],
  ["201514557", "아롬나옴"],
  ["991553456", "몽슈슈"],
  ["1295564434", "로렌츠(B2B)"],
  ["1163941819", "카네브"],
  ["372470142", "봉쥬르뚜뚜"],
  ["1839023503", "퍼펫"],
  ["611366063", "레인보우스토리"],
  ["1980884453", "오고니아"],
  ["1925576713", "안스펫"],
  ["50374302", "헤이마"],
  ["751496302", "누핀"],
  ["571607962", "기타(지급요청메모용)"],
  ["1035008371", "아카바코퍼레이션 (패디펫)"],
  ["364389214", "►패디펫_푸드 단가표 (25년 6월 23일 부)"],
  ["2006844602", "►패디펫_푸드 단가표"],
  ["617964825", "페치 (테일스키친)"],
  ["346995459", "퍼피갤러리"],
  ["267857250", "미티본(펫대디)"],
  ["1521587436", "오느루"],
  ["1683923643", "포포네"],
  ["1969678380", "주로(에이파크)"],
  ["1590140829", "쉬오트"],
  ["1206380947", "인히어런트"],
  ["849628223", "어니스트밀"],
  ["1139693981", "스윙도츠"],
  ["400134206", "골드로니"],
  ["809516537", "펫츠그린"],
  ["1641386426", "플러쉬퍼피"],
  ["2146581801", "앤블랭크"],
  ["1828764435", "뮤니쿤트"],
  ["167415920", "누누숨"],
  ["126453398", "고공캣"],
  ["1155954780", "클러스터라운드"],
  ["11416949", "아인솝"],
  ["850492291", "분독"],
  ["495476590", "리케이(아이그룸)"],
  ["580439968", "►리케이 단가표"],
  ["1271914960", "펫에스테(GLC)"],
  ["1756547147", "베럴즈"],
  ["1902629733", "트러스티푸드(림피드)"],
  ["1681815453", "온힐"],
  ["1380278539", "온힐 단가표"],
  ["1800358557", "브릿지독"],
  ["1603933775", "리꼬르소"],
  ["169372212", "포사이어티 (시카로 / 논스톱)"],
  ["1587321387", "지노네이처 (포엣미)"],
  ["192550830", "빌리스벳"],
  ["1818471631", "이비야야(도기파크)"],
  ["1390007758", "위러브코코"],
  ["130404279", "복슬강아지"],
  ["348275423", "스쿱543"],
  ["1694285939", "쿠루름"],
  ["226098046", "룰루키친"],
  ["206742817", "테일하이"],
  ["310148050", "꼬뜨cote"],
  ["1840456707", "닥터웰릿(곰곰연구소)"],
  ["1791042675", "콘디(삼보첨단)"],
  ["849984962", "프롬한라(벨아벨팜)"],
  ["1801710840", "리카리카"],
  ["1194146522", "아롬나옴 단가표"],
  ["726485810", "패디펫_후르타 단가표"],
  ["2093782878", "아카바_푸드 단가표"],
  ["536027763", "아카바_3월행사공급가"],
  ["174749298", "온힐_어드밴스/인스팅트 단가표"],
  ["1957958785", "시트양식"],
  ["1113795844", "템플릿 양식"],
  ["708304631", "주미스2501"]
];

const importedRequests = [
  {
    brandName: "펫페이스",
    displayBrandName: "★펫페이스",
    orderNo: "주문건 노란색 표기",
    customerName: "9월입금오류 (수식)",
    depositAmount: 37800,
    expectedDepositDate: "",
    cutoffNote: "출고마감:   오후 2 시",
    sourceSheet: "펫페이스",
    sourceRow: 106,
    requiredMemo: "",
    businessName: "주식회사 리딩펫",
    businessNumber: "897-81-01377",
    depositorName: "주식회사 리딩펫"
  },
  {
    brandName: "펫페이스",
    displayBrandName: "★펫페이스",
    orderNo: "주문건 노란색 표기",
    customerName: "10월입금오류 (수식)",
    depositAmount: 8400,
    expectedDepositDate: "",
    cutoffNote: "출고마감:   오후 2 시",
    sourceSheet: "펫페이스",
    sourceRow: 111,
    requiredMemo: "",
    businessName: "주식회사 리딩펫",
    businessNumber: "897-81-01377",
    depositorName: "주식회사 리딩펫"
  },
  {
    brandName: "봉쥬르뚜뚜",
    displayBrandName: "★봉쥬르뚜뚜",
    orderNo: "20260320-0000042",
    customerName: "Mhkang",
    depositAmount: 27000,
    expectedDepositDate: "",
    cutoffNote: "위탁정산",
    sourceSheet: "봉쥬르뚜뚜",
    sourceRow: 22,
    requiredMemo: "",
    businessName: "봉쥬르뚜뚜",
    businessNumber: "197-16-02773",
    depositorName: "박혜준"
  },
  {
    brandName: "스쿱543",
    displayBrandName: "스쿱543",
    orderNo: "20260409-0000301",
    customerName: "임동희",
    depositAmount: 39500,
    expectedDepositDate: "",
    cutoffNote: "송장입력 후 지급",
    sourceSheet: "스쿱543",
    sourceRow: 52,
    requiredMemo: "",
    businessName: "스쿱543",
    businessNumber: "204-38-52312",
    depositorName: "홍성진(스쿱543)"
  },
  {
    brandName: "트러스티푸드",
    displayBrandName: "트러스티푸드",
    orderNo: "20260415-0000616",
    customerName: "최혜영",
    depositAmount: 206400,
    expectedDepositDate: "",
    cutoffNote: "출고마감시간",
    sourceSheet: "트러스티푸드(림피드)",
    sourceRow: 32,
    requiredMemo: "b2b",
    businessName: "림피드 주식회사",
    businessNumber: "455-86-01649",
    depositorName: "림피드(주)"
  }
];

const settlementTypes = new Set(["prepay_debt", "prepay_fee", "prepay_supply", "consignment", "direct_purchase"]);
const shippingPolicyTypes = new Set(["free", "flat", "threshold"]);
const requestStatuses = new Set(["pending", "await_deposit", "paid", "hold", "error", "consignment_unpaid", "deleted"]);
// Statuses that still represent an unpaid, live obligation (counted in 대기금액).
const PENDING_STATUSES = ["pending", "await_deposit"];

function inferSettlementType(row = {}) {
  const text = `${row.cutoffNote || ""} ${row.requiredMemo || ""}`;
  if (text.includes("위탁")) return "consignment";
  return "prepay_fee";
}

function inferCutoffType(note = "") {
  if (note.includes("위탁")) return "consignment";
  if (note.includes("송장") || note.includes("출고완료")) return "after_shipment";
  return "time";
}

function inferCutoffHour(note = "") {
  const match = String(note).match(/오(?:전|후)\s*(\d{1,2})\s*시/);
  if (!match) return "";
  let hour = Number(match[1]);
  if (note.includes("오후") && hour < 12) hour += 12;
  if (note.includes("오전") && hour === 12) hour = 0;
  return hour >= 8 && hour <= 19 ? String(hour).padStart(2, "0") : "";
}

function number(value, fallback = 0) {
  // Tolerate thousands separators (e.g. "3,000") from comma-formatted inputs.
  const parsed = Number(typeof value === "string" ? value.replace(/,/g, "").trim() : value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function dateOnly(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function normalizeSearchText(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeItemKey(itemCode, itemName) {
  return `${String(itemCode || "").trim().toLowerCase()}::${String(itemName || "").trim().toLowerCase()}`;
}

function shippingRuleText(policyType, flatFee, thresholdAmount, thresholdFee, thresholdBase = "sales") {
  if (policyType === "flat") return flatFee > 0 ? `무조건 ${flatFee.toLocaleString("ko-KR")}원` : "무조건 0원";
  if (policyType === "threshold") {
    const base = thresholdBase === "supply" ? "공급가" : "제품매출";
    return `${base} ${thresholdAmount.toLocaleString("ko-KR")}원 미만 ${thresholdFee.toLocaleString("ko-KR")}원`;
  }
  return "무료배송";
}

function normalizeShippingPolicy(input = {}, current = {}) {
  const policyType = shippingPolicyTypes.has(input.shippingPolicyType) ? input.shippingPolicyType : current.shippingPolicyType || "free";
  const shippingFlatFee = number(input.shippingFlatFee, number(current.shippingFlatFee));
  const shippingThresholdAmount = number(input.shippingThresholdAmount, number(current.shippingThresholdAmount));
  const shippingThresholdFee = number(input.shippingThresholdFee, number(current.shippingThresholdFee));
  // 배송비 N-미만 기준을 어느 금액으로 잴지: "sales" = 제품매출(고객 기준, 기본),
  // "supply" = 공급가 합계(할인 반영 후 실입금 기준, 펫페이스 등 특이 브랜드).
  const shippingThresholdBase = ["sales", "supply"].includes(input.shippingThresholdBase)
    ? input.shippingThresholdBase
    : (current.shippingThresholdBase === "supply" ? "supply" : "sales");
  return {
    shippingPolicyType: policyType,
    shippingFlatFee,
    shippingThresholdAmount,
    shippingThresholdFee,
    shippingThresholdBase,
    shippingRule: shippingRuleText(policyType, shippingFlatFee, shippingThresholdAmount, shippingThresholdFee, shippingThresholdBase)
  };
}

// --- 브랜드 규칙 유효기간 (계약 변경 이력) --------------------------------
//
// 계약이 바뀌면(예: 릴리스키친 2026-08-01부터 수수료 20%→25%, 무료배송→4,000원)
// 브랜드 필드를 덮어쓰는 것으로 끝내면 과거 정산이 새 규칙으로 계산돼 전부 오류가
// 난다. 그래서 규칙은 버전으로 쌓고, 정산할 때 그 주문이 배송완료된 시점에
// 유효했던 버전을 골라 쓴다.
//
// brand 최상위 필드는 "오늘 유효한 버전"의 사본으로 유지된다 — 신규 입금요청과
// 기존 화면들이 그대로 동작하고, 미래 날짜로 예약해둔 변경이 당겨 적용되지 않는다.
const BRAND_RULE_FIELDS = [
  "commissionRate",
  "shippingPolicyType",
  "shippingFlatFee",
  "shippingThresholdAmount",
  "shippingThresholdFee",
  "shippingThresholdBase",
  "shippingRule"
];

// 이력이 없던 시절의 데이터를 덮기 위한 최초 버전의 시작일.
const BRAND_RULE_EPOCH = "2000-01-01";

function pickBrandRuleFields(source = {}) {
  const rule = {};
  for (const key of BRAND_RULE_FIELDS) rule[key] = source[key];
  return rule;
}

// 기준일 정규화. dateOnly 는 정확히 yyyy-MM-dd 만 받아들이는데 now() 는 ISO
// 타임스탬프를 주므로, 여기서 날짜 부분만 떼어낸다. 이걸 빠뜨리면 기준일이
// 빈 문자열이 되어 어떤 버전도 매칭되지 않고 늘 최초 버전으로 떨어진다.
function asOfDate(value) {
  const text = String(value || "").trim();
  const direct = dateOnly(text);
  if (direct) return direct;
  const head = text.slice(0, 10);
  return dateOnly(head) || dateOnly(new Date().toISOString().slice(0, 10));
}

function buildBrandRule(source, validFrom, note = "") {
  return {
    id: id("brule"),
    validFrom: validFrom ? asOfDate(validFrom) : BRAND_RULE_EPOCH,
    ...pickBrandRuleFields(source),
    note: String(note || ""),
    createdAt: now()
  };
}

// 정렬된 이력에서 asOf 시점에 유효한 버전을 고른다. asOf 가 최초 버전보다도
// 이르면 최초 버전을 쓴다 — 그 이전 계약은 기록이 없으므로 가장 오래된 것이
// 최선의 근사다.
function brandRuleAt(brand, asOf) {
  const history = Array.isArray(brand?.ruleHistory) ? brand.ruleHistory : [];
  if (!history.length) return null;
  const sorted = [...history].sort((a, b) => String(a.validFrom).localeCompare(String(b.validFrom)));
  const target = asOfDate(asOf);
  let chosen = null;
  for (const rule of sorted) {
    if (String(rule.validFrom) <= target) chosen = rule;
  }
  return chosen || sorted[0];
}

// asOf 시점 규칙이 반영된 브랜드 사본. 배송비 헬퍼들이 평범한 객체를 받으므로
// 그대로 넘겨 쓸 수 있다.
function effectiveBrand(brand, asOf) {
  const rule = brandRuleAt(brand, asOf);
  return rule ? { ...brand, ...pickBrandRuleFields(rule) } : brand;
}

// 최상위 규칙 필드를 "오늘 유효한 버전"으로 맞춘다.
function syncBrandCurrentRules(brand) {
  const rule = brandRuleAt(brand, now());
  if (!rule) return false;
  let changed = false;
  for (const key of BRAND_RULE_FIELDS) {
    if (brand[key] !== rule[key]) {
      brand[key] = rule[key];
      changed = true;
    }
  }
  return changed;
}

// 정산월을 가르는 날짜 기준. 명시적으로 고르지 않은 브랜드는 기존 동작을
// 그대로 유지한다 — 위탁은 배송완료일, 나머지는 주문일.
const settlementDateBases = new Set(["order", "delivered"]);

function brandSettlementDateBasis(brand = {}) {
  if (settlementDateBases.has(brand.settlementDateBasis)) return brand.settlementDateBasis;
  return brand.settlementType === "consignment" ? "delivered" : "order";
}

// 배송비 임계 기준금액 선택: 기본은 제품매출, 브랜드 설정이 supply면 공급가 합계.
function shippingThresholdBaseAmount(brand = {}, { salesAmount = 0, supplyAmount = 0 } = {}) {
  return brand.shippingThresholdBase === "supply" ? number(supplyAmount) : number(salesAmount);
}

function calculateBaseShippingFee(brand = {}, productSalesAmount = 0) {
  const policyType = shippingPolicyTypes.has(brand.shippingPolicyType) ? brand.shippingPolicyType : "free";
  if (policyType === "flat") return Math.max(0, number(brand.shippingFlatFee));
  if (policyType === "threshold") {
    const thresholdAmount = Math.max(0, number(brand.shippingThresholdAmount));
    const thresholdFee = Math.max(0, number(brand.shippingThresholdFee));
    return productSalesAmount < thresholdAmount ? thresholdFee : 0;
  }
  return 0;
}

function normalizePriceFields(entry = {}) {
  const originalPrice = number(entry.originalPrice, number(entry.consumerPrice));
  const discountPrice = number(entry.discountPrice);
  const currentSalePrice = number(entry.salePrice, discountPrice || originalPrice);
  return {
    originalPrice,
    consumerPrice: originalPrice,
    discountPrice,
    salePrice: currentSalePrice,
    currentSalePrice
  };
}

function promotionRuleWithRefs(db, rule) {
  const brand = db.brands.find((item) => item.id === rule.brandId);
  return {
    ...rule,
    brandName: brand?.name || "",
    targetItemLabels: sanitizePromotionTargets(rule.targetItems).map((item) => item.label)
  };
}

function isPromotionRuleActive(rule, onDate = "") {
  const targetDate = dateOnly(onDate) || now().slice(0, 10);
  const from = dateOnly(rule.validFrom) || "0000-01-01";
  const to = dateOnly(rule.validTo) || "9999-12-31";
  return rule.isActive !== false && from <= targetDate && targetDate <= to;
}

function getActivePromotionRule(db, brandId = "", onDate = "") {
  return (db.promotionRules || [])
    .filter((rule) => (!brandId || rule.brandId === brandId) && isPromotionRuleActive(rule, onDate))
    .sort((a, b) => (b.validFrom || "").localeCompare(a.validFrom || "") || b.updatedAt.localeCompare(a.updatedAt))[0] || null;
}

function getActivePromotionRules(db, brandId = "", onDate = "") {
  return (db.promotionRules || [])
    .filter((rule) => (!brandId || rule.brandId === brandId) && isPromotionRuleActive(rule, onDate))
    .sort((a, b) => {
      if ((a.scopeType || "all") !== (b.scopeType || "all")) return (a.scopeType || "all") === "items" ? -1 : 1;
      return (b.validFrom || "").localeCompare(a.validFrom || "") || b.updatedAt.localeCompare(a.updatedAt);
    });
}

function effectiveRuleRate(rule, brandRate) {
  if (!rule) return brandRate;
  if (rule.commissionRate === null || rule.commissionRate === undefined || rule.commissionRate === "") return brandRate;
  return number(rule.commissionRate);
}

function computeDiscountAmount(rule, productSales) {
  if (!rule) return 0;
  const value = number(rule.discountValue);
  if (!value) return 0;
  if (rule.discountValueType === "percent") {
    return Math.round((number(productSales) * value) / 100);
  }
  if (rule.discountValueType === "fixed") {
    return Math.min(value, number(productSales));
  }
  return 0;
}

function buildPromotionContext(db, brand = {}, lineItems = [], onDate = "") {
  const activeRules = getActivePromotionRules(db, brand?.id, onDate);
  const brandRate = number(brand?.commissionRate);
  // Price-discount rules apply ONLY when explicitly picked per line; they never
  // auto-apply. Baseline rules (no price discount) keep their auto behavior.
  const autoRules = activeRules.filter((rule) => !(number(rule.discountValue) > 0));
  const allRule = autoRules.find((rule) => (rule.scopeType || "all") === "all") || null;
  const itemRules = autoRules.filter((rule) => (rule.scopeType || "all") === "items");
  if (!lineItems.length) {
    if (!allRule) return null;
    return {
      primaryRuleId: allRule.id,
      name: allRule.name,
      commissionRate: effectiveRuleRate(allRule, brandRate),
      commissionAmount: null,
      discountValueType: allRule.discountValueType || "",
      discountValue: number(allRule.discountValue),
      appliedRules: [promotionRuleWithRefs(db, allRule)]
    };
  }
  const rulesById = new Map(activeRules.map((rule) => [rule.id, rule]));
  let salesTotal = 0;
  let commissionTotal = 0;
  let discountTotal = 0;
  const appliedRules = [];
  const seen = new Set();
  for (const item of lineItems) {
    const lineSales = number(item.totalSaleAmount);
    if (!lineSales) continue;
    salesTotal += lineSales;
    // Rule resolution priority: explicit per-line pick (ignores targetItems) >
    // auto-match by item key > brand-wide "all" rule.
    const key = normalizeItemKey(item.itemCode, item.itemName);
    const explicitRule = item.promotionRuleId ? rulesById.get(item.promotionRuleId) || null : null;
    const itemRule = explicitRule || itemRules.find((rule) => sanitizePromotionTargets(rule.targetItems).some((target) => target.key === key)) || null;
    const matchedRule = itemRule || allRule;
    const lineDiscount = computeDiscountAmount(matchedRule, lineSales);
    const rate = effectiveRuleRate(matchedRule, brandRate);
    discountTotal += lineDiscount;
    commissionTotal += Math.round(Math.max(0, lineSales - lineDiscount) * (rate / 100));
    if (matchedRule && !seen.has(matchedRule.id)) {
      seen.add(matchedRule.id);
      appliedRules.push(promotionRuleWithRefs(db, matchedRule));
    }
  }
  if (!appliedRules.length) return allRule ? {
    primaryRuleId: allRule.id,
    name: allRule.name,
    commissionRate: effectiveRuleRate(allRule, brandRate),
    commissionAmount: null,
    discountValueType: allRule.discountValueType || "",
    discountValue: number(allRule.discountValue),
    appliedRules: [promotionRuleWithRefs(db, allRule)]
  } : null;
  const netSalesTotal = Math.max(0, salesTotal - discountTotal);
  return {
    primaryRuleId: appliedRules.length === 1 ? appliedRules[0].id : "",
    name: appliedRules.length === 1 ? appliedRules[0].name : `품목별 프로모션 ${appliedRules.length}건`,
    commissionRate: netSalesTotal > 0 ? Number(((commissionTotal / netSalesTotal) * 100).toFixed(2)) : brandRate,
    commissionAmount: commissionTotal,
    discountAmount: discountTotal,
    discountValueType: allRule?.discountValueType || "",
    discountValue: allRule ? number(allRule.discountValue) : 0,
    appliedRules
  };
}

function now() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

function normalizeName(name) {
  return String(name || "").replace(/^★/, "").trim();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function publicAdmin(admin) {
  const { passwordHash, ...safe } = admin;
  // owner 는 저장값과 무관하게 전권이고, 아직 권한을 지정하지 않은 계정은
  // 지금 실제로 적용되는 기본값을 그대로 보여준다 — 화면과 동작이 어긋나지
  // 않게 한다.
  return {
    ...safe,
    permissions: admin.role === "owner" ? fullPermissions() : actorPermissions(admin)
  };
}

// owner 가 한 명도 없게 되는 변경을 막는다. 그렇게 되면 권한을 되돌릴 수 있는
// 사람이 아무도 남지 않는다.
function isLastActiveOwner(db, adminId) {
  const owners = db.admins.filter((item) => item.role === "owner" && item.isActive !== false);
  return owners.length <= 1 && owners.some((item) => item.id === adminId);
}

function fullPermissions() {
  const all = {};
  for (const menu of MENU_REGISTRY) all[menu.key] = [...menu.actions];
  return all;
}

// NPB (도톤 운영대행) namespace seed — brand DOTEON, products, channels, and
// per-channel line templates. Stored under db.npb via readDb/writeDb (C2-blob).
export function buildNpbNamespace() {
  const createdAt = now();
  const brand = {
    id: "doteon",
    name: "도톤",
    costConfig: {
      smallShip: 2650, // VAT-included, documentation-only (never recomputed)
      largeShip: 4400,
      pickPack: 1430,
      // 출고 유형별 실비. 유형이 브랜드마다 다르다 — 도톤은 소형/대형으로
      // 갈리고, 픽키는 출고지(3PL/본사)로 갈린다. 목록으로 두면 계산식을
      // 건드리지 않고 유형을 늘릴 수 있다.
      shipTypes: [
        { key: "small", label: "소형 출고", freight: 2650, handling: 1430 },
        { key: "large", label: "대형 출고", freight: 4400, handling: 1430 }
      ],
      // 실비를 정산에서 공제하지 않고 별도 청구할지. 브랜드마다 다르다.
      billSeparately: false,
      threePlTable: [
        { item: "보관료", unitPrice: null, unit: "월/평당", note: "청구제외" },
        { item: "입고비용", unitPrice: 0, unit: "건", note: "청구제외" },
        { item: "택배운임비", unitPrice: 2500, unit: "건", note: "로젠택배(소형)" },
        { item: "택배운임비", unitPrice: 4000, unit: "건", note: "로젠택배(중대형)" },
        { item: "물류비", unitPrice: 1300, unit: "건", note: "부자재/피킹/패킹" }
      ]
    }
  };

  // 픽키도기클럽(사업자 픽키파크) — 제품 필바이츠. 실비(물류·광고)는 정산에서
  // 공제하지 않고 별도 청구한다.
  const pickyBrand = {
    id: "pickydog",
    name: "픽키도기클럽",
    businessName: "픽키파크",
    productLine: "필바이츠",
    costConfig: {
      billSeparately: true,
      shipTypes: [
        { key: "3pl", label: "3PL 출고 (택배)", freight: 2650, handling: 1430 },
        { key: "hq", label: "본사 출고 (택배)", freight: 3300, handling: 550 },
        // 용달·퀵은 건마다 금액이 달라 실비를 직접 적는다.
        { key: "quick", label: "용달/퀵", freight: 0, handling: 0, manual: true, excludeFromTotal: true }
      ],
      threePlTable: [
        { item: "보관료", unitPrice: 4000, unit: "월/평당", note: "청구제외 / 한시적 무상제공" },
        { item: "입고비용", unitPrice: null, unit: "건", note: "청구제외 / 한시적 무상제공" },
        { item: "물류솔루션", unitPrice: 300000, unit: "월별", note: "청구제외 / 한시적 무상제공" },
        { item: "택배운임비", unitPrice: 2500, unit: "건", note: "로젠택배(소형)" },
        { item: "택배운임비", unitPrice: 4000, unit: "건", note: "로젠택배(중형이상)" },
        { item: "물류사용비", unitPrice: 1300, unit: "건", note: "박스·부자재 / 피킹 / 패킹" },
        { item: "본사 택배운임비", unitPrice: 3000, unit: "건", note: "로젠택배(소형)" },
        { item: "본사 부자재(박스)", unitPrice: 500, unit: "건", note: "" }
      ],
      // 광고비는 이 시트에 누적된다. 정산에는 넣지 않고 별도 청구한다.
      adCostSheetUrl: "https://docs.google.com/spreadsheets/d/1RA45qIvKCGRh5evCtiXMmpypdNb8gxvKWAkwfu-MHz0/edit"
    },
  };

  // 번들 구성이 상품마다 다르다 — 45g 는 1·3·5·10개 묶음이 있고 180g 는 낱개뿐이다.
  // "필바이츠 상품 목록 및 SKU 정보 최신" 기준.
  const pickyPackTiers45 = [
    { tier: "1개", ea: 1, listPrice: 6800 },
    { tier: "3개", ea: 3, listPrice: 20400 },
    { tier: "5개", ea: 5, listPrice: 34000 },
    { tier: "10개", ea: 10, listPrice: 68000 }
  ];
  const pickyPackTiers180 = [{ tier: "1개", ea: 1, listPrice: 26900 }];

  const pickyProducts = [
    {
      id: "pb45_chicken", brandId: "pickydog", barcode: "8809879544071",
      name: "픽키도기클럽 필바이츠 45g (5개입) - 치킨 오리지널", listPrice: 6800,
      nameKeywords: ["45g", "치킨", "오리지널"], skuCodes: ["P000BLOX"],
      packTiers: pickyPackTiers45
    },
    {
      id: "pb180_chicken", brandId: "pickydog", barcode: "",
      name: "픽키도기클럽 필바이츠 180g (20개입) - 치킨 오리지널", listPrice: 26900,
      nameKeywords: ["180g", "치킨", "오리지널"], skuCodes: [],
      packTiers: pickyPackTiers180
    },
    {
      id: "pb45_vegan", brandId: "pickydog", barcode: "",
      name: "픽키도기클럽 필바이츠 45g (5개입) - 비건 고구마와 피넛버터", listPrice: 6800,
      nameKeywords: ["45g", "비건", "고구마", "피넛버터"], skuCodes: [],
      packTiers: pickyPackTiers45
    },
    {
      id: "pb180_vegan", brandId: "pickydog", barcode: "",
      name: "픽키도기클럽 필바이츠 180g (20개입) - 비건 고구마와 피넛버터", listPrice: 26900,
      nameKeywords: ["180g", "비건", "고구마", "피넛버터"], skuCodes: [],
      packTiers: pickyPackTiers180
    }
  ];

  // 정산서의 채널·수수료율을 그대로 옮겼다. 정산형태는 계산서를 누가 발행하는지
  // 구분하는 값이라 계산에는 쓰지 않고 표기용으로 남긴다.
  const pickyChannels = [
    { code: "picky_b2c", name: "wooof-B2C", feeRate: 0.1, settleBy: "우프", filenameKeywords: ["b2c", "cafe24"] },
    { code: "picky_b2b", name: "wooof-B2B", feeRate: 0.05, settleBy: "우프", filenameKeywords: ["b2b"] },
    { code: "picky_tailit", name: "테일릿(대리점)", feeRate: 0.52, settleBy: "우프", filenameKeywords: ["대리점", "테일릿"] },
    { code: "picky_coupang", name: "쿠팡", feeRate: 0, settleBy: "우프", filenameKeywords: ["쿠팡", "coupang"], feeNote: "품목별 상이" },
    { code: "picky_smartstore", name: "스마트스토어", feeRate: 0, settleBy: "픽키파크", filenameKeywords: ["smartstore", "스마트스토어"], feeNote: "네이버 기준" },
    { code: "picky_kurly", name: "마켓컬리", feeRate: 0.35, settleBy: "픽키파크", filenameKeywords: ["컬리", "kurly"] },
    { code: "picky_sparkpet", name: "스파크펫", feeRate: 0.35, settleBy: "픽키파크", filenameKeywords: ["스파크펫", "sparkpet"] },
    { code: "picky_mongshu", name: "몽슈슈", feeRate: 0.4, settleBy: "우프", filenameKeywords: ["몽슈슈"] },
    { code: "picky_popup", name: "팝업/외부행사", feeRate: 0.05, settleBy: "우프", filenameKeywords: ["행사", "팝업"] }
  ].map((c, i) => ({
    ...c, brandId: "pickydog", category: "온라인", archetype: "consignment",
    calcType: "rate_on_sale", salePrice: 6800, supplyPrice: null,
    vatIncluded: true, active: true, sortOrder: 100 + i
  }));

  const products = [
    {
      id: "fc", brandId: "doteon", barcode: "8809879544118",
      name: "도톤 포레스트 워터리스 풋클리너 100ml", listPrice: 22000,
      nameKeywords: ["풋클리너", "발세정제", "Foot Cleaner"], skuCodes: ["BT25DTFC"]
    },
    {
      id: "os", brandId: "doteon", barcode: "8809879544101",
      name: "도톤 포레스트 아웃도어 스프레이 150ml", listPrice: 22000,
      nameKeywords: ["아웃도어", "스프레이", "해충방지", "Outdoor Spray"], skuCodes: ["BT25OS"]
    }
  ];

  // archetype drives UI labels/adjust behavior; calcType drives the math
  // (위탁/자사/대리점 = rate_on_sale, 매입 = margin_supply on 공급가).
  const channels = [
    {
      code: "mongshu", name: "몽슈슈", category: "위탁재고", archetype: "consignment",
      calcType: "rate_on_sale", salePrice: 22000, feeRate: 0.4, supplyPrice: 13200,
      priceLabel: "정가", vatIncluded: true, feeAdjustable: false,
      filenameKeywords: ["몽슈슈"], active: true
    },
    {
      code: "smartstore", name: "스마트스토어", category: "직매출", archetype: "direct",
      calcType: "rate_on_sale", salePrice: 19800, feeRate: 0.05, supplyPrice: null,
      priceLabel: "프로모션가", vatIncluded: true, feeAdjustable: false, filenameKeywords: ["스마트스토어"], active: true
    },
    {
      code: "tailit", name: "테일릿", category: "대리점", archetype: "agency",
      calcType: "rate_on_sale", salePrice: 22000, feeRate: 0.52, supplyPrice: 10560,
      priceLabel: "정가", vatIncluded: true, feeAdjustable: false,
      filenameKeywords: ["대리점"], active: true
    },
    {
      code: "emart", name: "몰리스(이마트)", category: "위탁재고", archetype: "consignment",
      calcType: "rate_on_sale", salePrice: 22000, feeRate: 0.3, supplyPrice: 15400,
      priceLabel: "정가", vatIncluded: true, feeAdjustable: false,
      filenameKeywords: ["emart", "몰리스"], active: true
    },
    {
      code: "wooofmall", name: "우프자사몰", category: "직매출", archetype: "direct",
      calcType: "rate_on_sale", salePrice: 19800, feeRate: 0.05, supplyPrice: null,
      priceLabel: "프로모션가", vatIncluded: true, feeAdjustable: false, filenameKeywords: ["cafe24"], active: true
    },
    {
      code: "gongu", name: "자사몰-공구", category: "직매출", archetype: "direct",
      calcType: "rate_on_sale", salePrice: null, feeRate: 0.25, supplyPrice: null,
      vatIncluded: true, feeAdjustable: false, filenameKeywords: ["영이공구"],
      tiers: [
        { tier: "1개", eaPerUnit: 1, salePrice: 16500, discountRate: 0.25 },
        { tier: "2개", eaPerUnit: 2, salePrice: 14960, discountRate: 0.32 },
        { tier: "3개", eaPerUnit: 3, salePrice: 14080, discountRate: 0.36 }
      ],
      active: true
    },
    {
      code: "b2b", name: "우프B2B사업자몰", category: "매입", archetype: "purchase",
      calcType: "rate_on_sale", salePrice: 13200, feeRate: 0.05, supplyPrice: null,
      vatIncluded: true, feeAdjustable: false, filenameKeywords: ["b2b"], active: true
    },
    {
      code: "kurly", name: "컬리", category: "위탁", archetype: "consignment",
      calcType: "rate_on_sale", salePrice: 22000, feeRate: 0.3, supplyPrice: null,
      priceLabel: "할인가", vatIncluded: true, feeAdjustable: true,
      filenameKeywords: ["컬리"], active: true
    },
    {
      code: "coupang", name: "쿠팡", category: "매입", archetype: "purchase",
      calcType: "rate_on_sale", salePrice: 22000, feeRate: 0.37, supplyPrice: 13860,
      priceLabel: "판매가", vatIncluded: true, feeAdjustable: false, bundle: true,
      filenameKeywords: ["쿠팡"], active: true
    },
    {
      code: "pharmasquare", name: "파마스퀘어", category: "대리점", archetype: "agency",
      calcType: "rate_on_sale", salePrice: 22000, feeRate: 0.45, supplyPrice: null,
      vatIncluded: true, feeAdjustable: false, filenameKeywords: ["파마스퀘어"], active: true
    },
    {
      code: "tarimarket", name: "태리마켓(행사)", category: "행사", archetype: "consignment",
      calcType: "rate_on_sale", salePrice: 15000, feeRate: 0.2, supplyPrice: null,
      vatIncluded: true, feeAdjustable: true, filenameKeywords: ["행사", "태리마켓"], active: true
    }
  ];
  channels.forEach((channel, index) => {
    channel.brandId = "doteon";
    channel.sortOrder = index + 1;
  });

  // Per-channel line templates that seed a monthly grid. 공구 expands per tier.
  const channelLineConfigs = [];
  let lineSeq = 0;
  for (const channel of channels) {
    if (channel.tiers) {
      for (const tier of channel.tiers) {
        channelLineConfigs.push({
          channelCode: channel.code, productId: "os",
          lineLabel: `DOTEON Outdoor Spray ${tier.tier}`,
          listPrice: 22000, salePrice: tier.salePrice, feeRate: channel.feeRate,
          supplyPrice: null, discountRate: tier.discountRate,
          eaPerUnit: tier.eaPerUnit, sortOrder: ++lineSeq
        });
      }
      continue;
    }
    for (const product of products) {
      channelLineConfigs.push({
        channelCode: channel.code, productId: product.id,
        lineLabel: product.id === "fc" ? "DOTEON Foot Cleaner" : "DOTEON Outdoor Spray",
        listPrice: 22000, salePrice: channel.salePrice, feeRate: channel.feeRate,
        supplyPrice: channel.supplyPrice, discountRate: null,
        eaPerUnit: 1, sortOrder: ++lineSeq
      });
    }
  }

  return {
    version: 1,
    createdAt,
    brands: [brand, pickyBrand],
    products: [...products, ...pickyProducts],
    channels: [...channels, ...pickyChannels],
    channelLineConfigs,
    defaultProfitSplit: [
      { partyName: "유씨엘주식회사", ratio: 0.4, sortOrder: 1 },
      { partyName: "우프컴퍼니(주)", ratio: 0.3, sortOrder: 2 },
      { partyName: "재계약중", ratio: 0.3, sortOrder: 3 }
    ],
    settlements: []
  };
}

function buildInitialDb() {
  const createdAt = now();
  const brandByName = new Map();
  const brands = [];

  for (const [sheetId, rawName] of sheetTabs) {
    if (rawName === "입금요청시트") continue;
    const isPriceSheet = /단가표|템플릿|양식|행사공급가|주미스2501/.test(rawName);
    const brand = {
      id: id("brand"),
      sheetId,
      name: rawName.replace(/^►|^\s*►/, "").trim(),
      rawSheetName: rawName,
      type: isPriceSheet ? "reference" : "brand",
      settlementType: "prepay_fee",
      commissionRate: 0,
      hasReceivable: false,
      receivableTotal: 0,
      consignmentDueDay: "",
      shippingPolicyType: "free",
      shippingFlatFee: 0,
      shippingThresholdAmount: 0,
      shippingThresholdFee: 0,
      shippingThresholdBase: "sales",
      shippingRule: "무료배송",
      promotionSummary: "",
      isActive: !isPriceSheet,
      starred: rawName.startsWith("★"),
      businessName: "",
      businessNumber: "",
      representativeName: "",
      bankName: "",
      bankAccount: "",
      accountHolder: "",
      depositorName: "",
      cutoffNote: "",
      cutoffType: "time",
      cutoffHour: "",
      requiredMemo: "",
      googleSheetUrl: "",
      shareToken: crypto.randomBytes(12).toString("hex"),
      ruleHistory: [],
      createdAt,
      updatedAt: createdAt
    };
    brand.ruleHistory = [buildBrandRule(brand, BRAND_RULE_EPOCH, "최초 등록 규칙")];
    brands.push(brand);
    brandByName.set(normalizeName(rawName), brand);
  }

  for (const row of importedRequests) {
    const key = normalizeName(row.sourceSheet || row.brandName);
    const brand = brandByName.get(key) || brandByName.get(normalizeName(row.brandName));
    if (!brand) continue;
    brand.businessName ||= row.businessName;
    brand.businessNumber ||= row.businessNumber;
    brand.depositorName ||= row.depositorName;
    brand.accountHolder ||= row.depositorName;
    brand.cutoffNote ||= row.cutoffNote;
    brand.cutoffType = inferCutoffType(brand.cutoffNote);
    brand.cutoffHour = inferCutoffHour(brand.cutoffNote);
    brand.settlementType = inferSettlementType(row);
    brand.requiredMemo ||= row.requiredMemo;
  }

  const requests = importedRequests.map((row) => {
    const brand =
      brandByName.get(normalizeName(row.sourceSheet)) ||
      brandByName.get(normalizeName(row.brandName));
    return {
      id: id("req"),
      brandId: brand?.id || "",
      brandName: row.displayBrandName || row.brandName,
      orderNo: row.orderNo,
      customerName: row.customerName,
      depositAmount: row.depositAmount,
      productSalesAmount: row.depositAmount,
      baseShippingFee: 0,
      extraShippingFee: 0,
      extraShippingNote: "",
      shippingFee: 0,
      promotionRuleId: "",
      promotionRuleName: "",
      appliedPromotionRules: [],
      commissionRate: brand?.commissionRate || 0,
      commissionAmount: 0,
      supplyAmount: 0,
      receivableDeduction: 0,
      settlementType: brand?.settlementType || inferSettlementType(row),
      expectedDepositDate: row.expectedDepositDate,
      cutoffNote: row.cutoffNote,
      sourceSheet: row.sourceSheet,
      sourceRow: row.sourceRow,
      requiredMemo: row.requiredMemo,
      businessName: row.businessName,
      businessNumber: row.businessNumber,
      depositorName: row.depositorName,
      status: (brand?.settlementType || inferSettlementType(row)) === "consignment" ? "consignment_unpaid" : "pending",
      paidAmount: "",
      paidAt: "",
      createdAt,
      updatedAt: createdAt
    };
  });

  let adminPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!adminPassword) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("BOOTSTRAP_ADMIN_PASSWORD must be set when bootstrapping in production.");
    }
    adminPassword = crypto.randomBytes(12).toString("base64url");
    console.warn(`[bootstrap] Generated temporary admin password: ${adminPassword}`);
  }
  const admin = {
    id: id("admin"),
    name: process.env.BOOTSTRAP_ADMIN_NAME || "Owner",
    email: process.env.BOOTSTRAP_ADMIN_EMAIL || "owner@wooofpay.local",
    role: "owner",
    isActive: true,
    passwordHash: hashPassword(adminPassword),
    createdAt,
    updatedAt: createdAt
  };

  return {
    version: 1,
    createdAt,
    admins: [admin],
    brands,
    priceEntries: [],
    priceAliases: [],
    promotionRules: [],
    requests,
    auditLogs: [
      {
        id: id("audit"),
        actorId: admin.id,
        actorName: admin.name,
        action: "bootstrap",
        entityType: "system",
        entityId: "initial",
        summary: "Google Sheets 구조를 기준으로 초기 데이터 생성",
        before: null,
        after: {
          brandCount: brands.length,
          requestCount: requests.length,
          source: "2026_선매입 브랜드 관리대장"
        },
        at: createdAt
      }
    ],
    archiveHistory: [],
    paymentLogs: [],
    npb: buildNpbNamespace(),
    clobe: buildClobeNamespace()
  };
}

let ensureDbPromise = null;
async function ensureDb() {
  if (!ensureDbPromise) ensureDbPromise = doEnsureDb();
  return ensureDbPromise;
}
async function doEnsureDb() {
  if (pgPool) {
    await ensurePostgresDb();
    return;
  }
  await mkdir(DATA_DIR, { recursive: true });
  try {
    await stat(DB_PATH);
    const db = JSON.parse(await readFile(DB_PATH, "utf8"));
    const { db: migrated, changed } = migrateDb(db);
    if (changed) await writeJson(DB_PATH, migrated);
  } catch {
    await writeJson(DB_PATH, buildInitialDb());
  }
}

async function ensurePostgresDb() {
  await pgPool.query(`
    create table if not exists app_state (
      id text primary key,
      state jsonb not null,
      updated_at timestamptz not null default now()
    )
  `);

  const current = await pgPool.query("select state from app_state where id = $1", [POSTGRES_STATE_ROW_ID]);
  if (current.rowCount) {
    const { db: migrated, changed } = migrateDb(current.rows[0].state || {});
    if (changed) await writePostgresDb(migrated);
    return;
  }

  let seed = null;
  try {
    const local = JSON.parse(await readFile(DB_PATH, "utf8"));
    seed = migrateDb(local).db;
  } catch {
    seed = buildInitialDb();
  }
  await writePostgresDb(seed);
}

function migrateDb(db) {
  let changed = false;
  const touch = (object, key, value) => {
    if (!(key in object)) {
      object[key] = value;
      changed = true;
    }
  };

  for (const brand of db.brands || []) {
    touch(brand, "settlementType", inferSettlementType(brand));
    if (!settlementTypes.has(brand.settlementType)) {
      brand.settlementType = "prepay_fee";
      changed = true;
    }
    touch(brand, "commissionRate", 0);
    touch(brand, "hasReceivable", false);
    touch(brand, "receivableTotal", 0);
    touch(brand, "consignmentDueDay", "");
    touch(brand, "shippingPolicyType", "free");
    touch(brand, "shippingFlatFee", 0);
    touch(brand, "shippingThresholdAmount", 0);
    touch(brand, "shippingThresholdFee", 0);
    touch(brand, "shippingThresholdBase", "sales");
    touch(brand, "settlementDateBasis", brand.settlementType === "consignment" ? "delivered" : "order");
    // 출고 후 입금 브랜드: 주문 시점엔 입금대기로 두고, 송장이 찍히면 입금요청으로
    // 올린다. 지금까지는 배송 메모에 글로만 적혀 있어 자동화가 읽을 수 없었다.
    touch(brand, "payAfterShipping", false);
    touch(brand, "shippingRule", "");
    // 규칙 이력이 없는 기존 브랜드는 현재 규칙을 최초 버전으로 이관한다.
    // 시작일을 EPOCH 로 두어 과거 정산이 지금과 동일하게 계산되도록 한다.
    if (!Array.isArray(brand.ruleHistory) || !brand.ruleHistory.length) {
      brand.ruleHistory = [buildBrandRule(brand, BRAND_RULE_EPOCH, "최초 등록 규칙 (자동 이관)")];
      changed = true;
    }
    if (!shippingPolicyTypes.has(brand.shippingPolicyType)) {
      brand.shippingPolicyType = "free";
      changed = true;
    }
    brand.shippingFlatFee = number(brand.shippingFlatFee);
    brand.shippingThresholdAmount = number(brand.shippingThresholdAmount);
    brand.shippingThresholdFee = number(brand.shippingThresholdFee);
    const normalizedShipping = normalizeShippingPolicy(brand, brand);
    if (brand.shippingRule !== normalizedShipping.shippingRule) {
      brand.shippingRule = normalizedShipping.shippingRule;
      changed = true;
    }
    touch(brand, "promotionSummary", "");
    touch(brand, "representativeName", "");
    touch(brand, "bankName", "");
    touch(brand, "bankAccount", "");
    touch(brand, "accountHolder", brand.depositorName || "");
    touch(brand, "cutoffType", inferCutoffType(brand.cutoffNote));
    touch(brand, "cutoffHour", inferCutoffHour(brand.cutoffNote));
  }

  for (const request of db.requests || []) {
    const brand = (db.brands || []).find((item) => item.id === request.brandId);
    touch(request, "productSalesAmount", number(request.depositAmount));
    touch(request, "baseShippingFee", number(request.shippingFee));
    touch(request, "extraShippingFee", 0);
    touch(request, "extraShippingNote", "");
    touch(request, "shippingFee", 0);
    touch(request, "promotionRuleId", "");
    touch(request, "promotionRuleName", "");
    touch(request, "appliedPromotionRules", []);
    touch(request, "commissionRate", number(brand?.commissionRate));
    touch(request, "commissionAmount", 0);
    touch(request, "supplyAmount", 0);
    touch(request, "receivableDeduction", 0);
    touch(request, "settlementType", brand?.settlementType || "prepay_fee");
    touch(request, "lineItems", []);
    if (!requestStatuses.has(request.status)) {
      request.status = request.settlementType === "consignment" ? "consignment_unpaid" : "pending";
      changed = true;
    }
    if (request.settlementType === "consignment" && request.status === "pending") {
      request.status = "consignment_unpaid";
      changed = true;
    }
  }

  touch(db, "archiveHistory", []);
  touch(db, "paymentLogs", []);
  touch(db, "auditLogs", []);
  touch(db, "priceEntries", []);
  touch(db, "priceAliases", []);
  touch(db, "promotionRules", []);
  for (const rule of db.promotionRules || []) {
    touch(rule, "scopeType", "all");
    touch(rule, "discountKind", "");
    touch(rule, "discountValueType", "");
    touch(rule, "discountValue", 0);
    touch(rule, "discountDetails", "");
    touch(rule, "targetItems", []);
  }

  // NPB namespace: seed whole on first run, else merge only missing top-level
  // keys (idempotent — never clobber existing db.npb data).
  if (!db.npb || typeof db.npb !== "object") {
    db.npb = buildNpbNamespace();
    changed = true;
  } else {
    const npbSeed = buildNpbNamespace();
    for (const key of Object.keys(npbSeed)) touch(db.npb, key, npbSeed[key]);
    // touch 는 최상위 키만 채운다. 브랜드·채널·상품은 이미 존재하는 배열이라
    // 새로 추가된 항목이 들어가지 못하므로 id 기준으로 병합한다. 이미 있는
    // 항목은 손대지 않는다 — 화면에서 고친 값을 덮어쓰면 안 된다.
    const mergeById = (listKey, idKey) => {
      const current = Array.isArray(db.npb[listKey]) ? db.npb[listKey] : [];
      const have = new Set(current.map((item) => String(item?.[idKey] ?? "")));
      const missing = (npbSeed[listKey] || []).filter(
        (item) => !have.has(String(item?.[idKey] ?? ""))
      );
      if (missing.length) {
        db.npb[listKey] = [...current, ...missing];
        changed = true;
      }
    };
    mergeById("brands", "id");
    mergeById("products", "id");
    mergeById("channels", "code");

    // 출고 실비를 유형 목록으로 옮긴다. 기존 브랜드는 소형/대형 단가를 그대로
    // 옮겨 담아 금액이 바뀌지 않는다.
    for (const npbBrand of db.npb.brands || []) {
      const cfg = npbBrand.costConfig || (npbBrand.costConfig = {});
      if (!Array.isArray(cfg.shipTypes) || !cfg.shipTypes.length) {
        cfg.shipTypes = [
          { key: "small", label: "소형 출고", freight: number(cfg.smallShip), handling: number(cfg.pickPack) },
          { key: "large", label: "대형 출고", freight: number(cfg.largeShip), handling: number(cfg.pickPack) }
        ];
        changed = true;
      }
      if (cfg.billSeparately === undefined) {
        cfg.billSeparately = false;
        changed = true;
      }
      // 시드에 뒤늦게 붙은 필드는 브랜드가 이미 존재하면 병합에서 빠진다.
      // 값이 비어 있을 때만 채운다 — 화면에서 고친 값을 덮어쓰지 않는다.
      const seeded = (npbSeed.brands || []).find((b) => b.id === npbBrand.id);
      if (seeded) {
        for (const key of ["businessName", "productLine"]) {
          if (npbBrand[key] === undefined && seeded[key] !== undefined) {
            npbBrand[key] = seeded[key];
            changed = true;
          }
        }
        if (!cfg.adCostSheetUrl && seeded.costConfig?.adCostSheetUrl) {
          cfg.adCostSheetUrl = seeded.costConfig.adCostSheetUrl;
          changed = true;
        }
        if (!Array.isArray(cfg.threePlTable) || !cfg.threePlTable.length) {
          if (seeded.costConfig?.threePlTable) {
            cfg.threePlTable = seeded.costConfig.threePlTable;
            changed = true;
          }
        }
      }
    }
  }

  // Clobe (클로브ai) connection state. Tokens live here rather than in env
  // because they are issued per-user at runtime and rotate on refresh.
  if (!db.clobe || typeof db.clobe !== "object") {
    db.clobe = buildClobeNamespace();
    changed = true;
  } else {
    const clobeSeed = buildClobeNamespace();
    for (const key of Object.keys(clobeSeed)) touch(db.clobe, key, clobeSeed[key]);
  }

  // Cafe24 Admin API connection state, same shape and lifecycle as db.clobe.
  if (!db.cafe24 || typeof db.cafe24 !== "object") {
    db.cafe24 = buildCafe24Namespace();
    changed = true;
  } else {
    const cafe24Seed = buildCafe24Namespace();
    for (const key of Object.keys(cafe24Seed)) touch(db.cafe24, key, cafe24Seed[key]);
  }
  return { db, changed };
}

function buildCafe24Namespace() {
  return {
    accessToken: "",
    refreshToken: "",
    expiresAt: "",
    refreshTokenExpiresAt: "",
    mallId: "",
    connectedBy: "",
    connectedAt: "",
    lastSyncAt: ""
  };
}

function buildClobeNamespace() {
  return {
    clientId: "",
    redirectUri: "",
    accessToken: "",
    refreshToken: "",
    expiresAt: "",
    companyId: "",
    companyName: "",
    accountIds: [],
    windowDays: 7,
    connectedBy: "",
    connectedAt: "",
    lastSyncAt: ""
  };
}

let cachedDb = null;
// In-flight read shared by every caller. A page load fires ten API calls at
// once; without this they each see an empty cache and each fetch and parse the
// whole state blob — on a 0.5 vCPU instance those parses serialise and even a
// 340-byte response waits behind them.
let cachedDbPromise = null;
let cachedDbAt = 0;

// The whole state is one JSON document, so every write replaces it entirely.
// A cache that never expires therefore lets a stale instance overwrite newer
// data — that actually happened: a local server holding a pre-migration
// snapshot wiped a brand that another instance had just added. The TTL keeps
// the read savings while bounding how stale a snapshot can get, and the
// revision check below makes an overwrite impossible rather than merely rare.
const DB_CACHE_TTL_MS = 3000;

async function readDb() {
  await ensureDb();
  if (pgPool) {
    if (cachedDb && Date.now() - cachedDbAt < DB_CACHE_TTL_MS) return cachedDb;
    if (!cachedDbPromise) {
      cachedDbPromise = readPostgresDb()
        .then((db) => {
          cachedDb = db;
          cachedDbAt = Date.now();
          return db;
        })
        .finally(() => {
          cachedDbPromise = null;
        });
    }
    return cachedDbPromise;
  }
  return JSON.parse(await readFile(DB_PATH, "utf8"));
}

async function writeDb(db) {
  if (pgPool) {
    await writePostgresDb(db);
    cachedDb = db;
    cachedDbAt = Date.now();
    return;
  }
  await writeJson(DB_PATH, db);
}

async function readPostgresDb() {
  const result = await pgPool.query("select state from app_state where id = $1", [POSTGRES_STATE_ROW_ID]);
  if (!result.rowCount) {
    const seed = buildInitialDb();
    await writePostgresDb(seed);
    return seed;
  }
  return result.rows[0].state;
}

// Every write replaces the whole document, so two instances that both read
// before either wrote will silently destroy each other's changes. The write is
// therefore conditional on the revision that was read: if the stored revision
// moved, someone else wrote first and this write is refused rather than
// applied on top of a stale snapshot.
async function writePostgresDb(db) {
  const prevRev = Number(db.__rev || 0);
  const nextRev = prevRev + 1;
  const next = { ...db, __rev: nextRev };
  const result = await pgPool.query(
    `
      insert into app_state (id, state, updated_at)
      values ($1, $2::jsonb, now())
      on conflict (id)
      do update set state = excluded.state, updated_at = now()
      where coalesce((app_state.state->>'__rev')::bigint, 0) = $3
    `,
    [POSTGRES_STATE_ROW_ID, JSON.stringify(next), prevRev]
  );
  if (!result.rowCount) {
    // 다른 인스턴스가 먼저 저장했다. 낡은 스냅샷을 덮어쓰지 않고 실패시킨다.
    cachedDb = null;
    cachedDbAt = 0;
    const error = new Error(
      "다른 곳에서 먼저 저장되었습니다. 화면을 새로고침한 뒤 다시 시도하세요."
    );
    error.status = 409;
    throw error;
  }
  db.__rev = nextRev;
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`);
}

function addAudit(db, actor, action, entityType, entityId, summary, before, after) {
  db.auditLogs.unshift({
    id: id("audit"),
    actorId: actor?.id || "system",
    actorName: actor?.name || "System",
    action,
    entityType,
    entityId,
    summary,
    before: before ?? null,
    after: after ?? null,
    at: now()
  });
  db.auditLogs = db.auditLogs.slice(0, 2000);
}

// gzip-compress text responses when the client supports it; cuts transfer size
// of large JSON payloads (request lists, audit logs) dramatically. Small bodies
// are sent raw since compression overhead isn't worth it under ~1KB.
const gzipAsync = promisify(gzipCb);

function endMaybeGzip(res, status, headers, body) {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const accept = res.req?.headers?.["accept-encoding"] || "";
  if (buffer.length < 1024 || !/\bgzip\b/.test(accept)) {
    res.writeHead(status, headers);
    res.end(buffer);
    return;
  }
  // Compress off the event loop. gzipSync blocks every other in-flight request
  // for its duration, which is exactly the wrong thing when ten responses are
  // being produced at once.
  gzipAsync(buffer)
    .then((zipped) => {
      res.writeHead(status, { ...headers, "content-encoding": "gzip", vary: "accept-encoding" });
      res.end(zipped);
    })
    .catch(() => {
      res.writeHead(status, headers);
      res.end(buffer);
    });
}

function sendJson(res, status, data, headers = {}) {
  endMaybeGzip(res, status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers
  }, JSON.stringify(data));
}

function sendText(res, status, text, type = "text/plain; charset=utf-8", headers = {}) {
  endMaybeGzip(res, status, {
    "content-type": type,
    "cache-control": "no-store",
    ...headers
  }, text);
}

function sendBuffer(res, status, content, type = "application/octet-stream", headers = {}) {
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
    ...headers
  });
  res.end(content);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function safeUnlink(filePath) {
  if (!filePath) return;
  try {
    await unlink(filePath);
  } catch {}
}

async function runPriceWorkbookScript(args) {
  const { stdout, stderr } = await execFileAsync("python3", [PRICE_WORKBOOK_SCRIPT, ...args], {
    cwd: __dirname,
    maxBuffer: 10 * 1024 * 1024
  });
  if (stderr?.trim()) {
    console.error(stderr.trim());
  }
  return stdout;
}

function priceWorkbookRows(db, brand) {
  return getLatestPriceCatalog(db, brand.id).map((entry) => ({
    entryId: entry.id,
    action: "수정",
    brandName: brand.name,
    itemCode: entry.itemCode,
    itemName: entry.itemName,
    spec: entry.spec,
    unit: entry.unit,
    supplyPrice: number(entry.supplyPrice),
    originalPrice: number(entry.originalPrice, entry.consumerPrice),
    discountPrice: number(entry.discountPrice),
    salePrice: number(entry.salePrice),
    effectiveFrom: entry.effectiveFrom,
    barcode: entry.barcode,
    isActive: entry.isActive !== false,
    note: entry.note || ""
  }));
}

async function buildPriceWorkbookTemplate(db, brand) {
  const tmpBase = path.join(os.tmpdir(), `wooofpay-price-template-${crypto.randomBytes(8).toString("hex")}`);
  const inputPath = `${tmpBase}.json`;
  const outputPath = `${tmpBase}.xlsx`;
  try {
    await writeFile(inputPath, JSON.stringify({ brandName: brand.name, rows: priceWorkbookRows(db, brand) }, null, 2), "utf8");
    await runPriceWorkbookScript(["export", "--input", inputPath, "--output", outputPath]);
    return await readFile(outputPath);
  } finally {
    await safeUnlink(inputPath);
    await safeUnlink(outputPath);
  }
}

async function parsePriceWorkbookUpload(body = {}) {
  const fileBase64 = String(body.fileBase64 || "").trim();
  if (!fileBase64) {
    throw new Error("업로드할 Excel 파일을 선택하세요.");
  }
  const fileBuffer = Buffer.from(fileBase64, "base64");
  const extension = path.extname(String(body.fileName || "")).toLowerCase() || ".xlsx";
  const tmpPath = path.join(os.tmpdir(), `wooofpay-price-import-${crypto.randomBytes(8).toString("hex")}${extension}`);
  try {
    await writeFile(tmpPath, fileBuffer);
    const stdout = await runPriceWorkbookScript(["import", "--input", tmpPath]);
    const parsed = JSON.parse(stdout || "{}");
    return Array.isArray(parsed.rows) ? parsed.rows : [];
  } finally {
    await safeUnlink(tmpPath);
  }
}

// ---------------------------------------------------------------------------
// Monthly settlement engine (정산): reconcile data1(입금요청, DB) ×
// data2(카페24 CSV) × data3(은행 XLSX) and render a 정산내역서 xlsx.
// ---------------------------------------------------------------------------

// Minimal RFC-4180-ish CSV parser (handles quotes, embedded commas/newlines).
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field); field = "";
    } else if (ch === "\n") {
      row.push(field); rows.push(row); row = []; field = "";
    } else if (ch === "\r") {
      // ignore; handled by \n
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

function parseCafe24Csv(base64) {
  const buf = Buffer.from(base64, "base64");
  // cafe24 exports UTF-8 (with BOM); fall back to raw utf8.
  const text = buf.toString("utf8");
  const rows = parseCsv(text).filter((r) => r.some((c) => String(c).trim() !== ""));
  if (!rows.length) return [];
  const header = rows[0].map((h) => String(h).trim());
  return rows.slice(1).map((r) => {
    const obj = {};
    header.forEach((h, i) => { obj[h] = r[i] != null ? String(r[i]).trim() : ""; });
    return obj;
  });
}

async function parseBankXlsxUpload(base64) {
  const buf = Buffer.from(base64, "base64");
  const tmpPath = path.join(os.tmpdir(), `wooofpay-bank-${crypto.randomBytes(8).toString("hex")}.xlsx`);
  try {
    await writeFile(tmpPath, buf);
    const { stdout } = await execFileAsync("python3", [XLSX_PARSE_SCRIPT, "--input", tmpPath], {
      cwd: __dirname,
      maxBuffer: 20 * 1024 * 1024
    });
    const parsed = JSON.parse(stdout || "{}");
    const sheets = parsed.sheets || {};
    const firstKey = Object.keys(sheets)[0];
    return firstKey ? sheets[firstKey] : [];
  } finally {
    await safeUnlink(tmpPath);
  }
}

function distinctCafe24Suppliers(rows) {
  const map = new Map();
  for (const r of rows) {
    const code = r["공급사"] || "";
    const name = r["공급사명"] || "";
    const key = code || name;
    if (!key) continue;
    if (!map.has(key)) map.set(key, { code, name, count: 0 });
    map.get(key).count++;
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

// Does a cafe24 row belong to the given brand's supplier mapping?
function cafe24RowMatchesBrand(row, brand) {
  const target = String(brand.cafe24Supplier || "").trim().toUpperCase();
  if (!target) return false;
  const code = String(row["공급사"] || "").trim().toUpperCase();
  const name = String(row["공급사명"] || "").trim().toUpperCase();
  return target === code || target === name;
}

// cafe24 날짜 컬럼은 내보내기마다 형식이 다르다: "2026-06-15", "2026.7.7 12:19"
// (점 구분·월/일 0 미패딩), "2026/07/15", "20260615 13:20:00".
//
// 구분자를 지우고 앞 8자리를 취하는 방식은 0 미패딩 형식에서 조용히 망가진다 —
// "2026.7.7 12:19" 이 "2026-77-12" 가 되어 어떤 실제 날짜보다도 커지고, 계약
// 규칙이 미래 버전으로 잘못 잡힌다. 그래서 구분자가 있으면 자리별로 파싱한다.
function cafe24DateOnly(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";
  const parts = text.match(/^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  if (parts) {
    const [, y, m, d] = parts;
    const month = Number(m);
    const day = Number(d);
    if (month < 1 || month > 12 || day < 1 || day > 31) return "";
    return `${y}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }
  const digits = text.replace(/[^0-9]/g, "");
  if (digits.length < 8) return "";
  const month = Number(digits.slice(4, 6));
  const day = Number(digits.slice(6, 8));
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

function cafe24RowIsCancelled(row) {
  return Boolean(
    String(row["환불완료일"] || "").trim() ||
    String(row["취소처리중[환불완료] 처리일"] || "").trim() ||
    String(row["환불상태"] || "").trim() ||
    number(row["총 실제 환불금액"]) > 0
  );
}

// Unit sale price for a cafe24 line = 판매가 + 옵션추가 가격 (options change the
// price, e.g. 7,900 + 1,000 = 8,900). Note the "옵션+판매가" column is a UNIT
// price (does NOT include quantity), so the line total is always unit × 수량.
// 단가 = 옵션까지 포함한 1개 가격.
//
// 내보내기 형식마다 컬럼이 다르다. 어떤 파일은 "판매가" + "옵션추가 가격" 으로
// 나뉘어 오고, 어떤 파일은 "옵션+판매가" 한 컬럼에 합쳐서 온다. 후자만 있는
// 파일에서 "옵션추가 가격" 을 찾으면 0 이 되어 옵션가가 통째로 빠진다 —
// 2026-07 파일 417행 중 80행이 여기 해당했고, 옵션이 45,000원인 상품이
// 25,000원으로 계산됐다. 합쳐진 컬럼이 있으면 그것을 우선한다.
function cafe24UnitPrice(row) {
  const combined = number(row["옵션+판매가"]);
  if (combined > 0) return combined;
  return number(row["판매가"]) + number(row["옵션추가 가격"]);
}
function cafe24RowSaleAmount(row) {
  return cafe24UnitPrice(row) * Math.max(1, number(row["수량"], 1));
}
// Order-level shipping from cafe24. 공급사 기본 배송비 repeats on each row of an
// order, so take it once (max); add 개별/지역별 배송비. Handles either export's
// column names.
function cafe24OrderShipping(rows) {
  const maxCol = (name) => Math.max(0, ...rows.map((r) => number(r[name])));
  const base = Math.max(maxCol("공급사 기본 배송비"), maxCol("기본배송비"));
  const indiv = maxCol("개별배송비");
  const region = Math.max(maxCol("지역별 배송비"), maxCol("지역배송비추가"));
  return base + indiv + region;
}

// Normalize a bank party/label for fuzzy comparison: uppercase, drop spaces and
// any bracketed suffix (지점명·법인격 등), keep hangul/latin/digits only.
// "온힐 송도점" / "베럴즈（BETTERS）" / "김지연(고공캣)" → 온힐 / 베럴즈 / 고공캣 core.
function normalizeBankParty(value) {
  return String(value || "")
    .replace(/[（(【\[].*?[)）】\]]/g, " ")
    .replace(/주식회사|㈜|\(주\)/g, " ")
    .toUpperCase()
    .replace(/[^0-9A-Z가-힣]/g, "");
}
// Does a bank row belong to the brand? Similarity match across 거래처 라벨·거래자명·
// 적요: a brand key matches when it is contained in (or contains) the normalized
// field, so branch/legal-entity suffixes don't break matching.
function bankRowMatchesBrand(row, brandKeys) {
  const fields = [row["거래처 라벨"], row["거래자명"], row["적요"]].map(normalizeBankParty).filter(Boolean);
  return brandKeys.some((k) => k && fields.some((f) => f.includes(k) || k.includes(f)));
}

// Collect a brand's bank movements across the whole file. Returns withdrawals
// (출금, for per-order matching) and the total of deposits (입금, e.g. refunds
// of mis-payments) so callers can net them — grabbing only 출금 overstates the
// paid total when a refund came back.
function bankBrandMovements(bankRows, brand) {
  const brandKeys = [String(brand.bankLabel || "").trim(), String(brand.name || "").trim()]
    .map(normalizeBankParty)
    .filter(Boolean);
  const rows = [];
  const deposits = [];
  const coverage = new Set();
  for (const r of bankRows) {
    const y = Number(r["거래 연도"] || 0);
    const m = Number(r["거래 월"] || 0);
    if (y && m) coverage.add(`${y}-${String(m).padStart(2, "0")}`);
    const out = number(r["출금"]);
    const inn = number(r["입금"]);
    if (!out && !inn) continue;
    if (!bankRowMatchesBrand(r, brandKeys)) continue;
    const base = { ym: y && m ? `${y}-${String(m).padStart(2, "0")}` : "", date: r["거래일시"] || "", memo: r["적요"] || "" };
    if (out) rows.push({ ...base, amount: out, used: false });
    if (inn) deposits.push({ ...base, amount: inn });
  }
  return { rows, deposits, coverage };
}

// Canonical(정가) price matcher for catalog-basis brands (예: 고공캣). Matches a
// cafe24 product name against the brand's price catalog + aliases; the longest
// matched text wins so "캣모나이트 리필 (3개입)" beats "캣모나이트".
// 카페24 품목 행을 정산서 라인으로 펼친다.
//
// 합계는 입금요청 금액(실제로 지급한 금액)에 맞춰야 하므로 품목별 비중대로
// 나눠 담고 잔돈은 가장 큰 라인에 얹는다. 그래야 총액과 품목 단위가 둘 다
// 지켜진다 — 카페24 원금액을 그대로 쓰면 할인·쿠폰 처리 차이만큼 총액이 어긋난다.
function explodeOrderRows(rowsOfOrder, billedTotal) {
  const base = rowsOfOrder.map((row) => {
    const quantity = Math.max(1, number(row["수량"], 1));
    const unit = cafe24UnitPrice(row);
    return {
      orderItemCode: String(row["품목별 주문번호"] || "").trim(),
      itemName: row["주문상품명(기본)"] || "",
      quantity,
      originalPrice: unit,
      gross: Math.max(0, unit * quantity - number(row["상품별 추가할인금액"]))
    };
  });
  if (!base.length) return [];
  const grossTotal = base.reduce((sum, item) => sum + item.gross, 0);
  const target = number(billedTotal);

  let allocated = 0;
  const scaled = base.map((item, index) => {
    const share = grossTotal > 0 && target > 0
      ? Math.round((item.gross / grossTotal) * target)
      : (index === 0 ? target : 0);
    allocated += share;
    return { ...item, totalSaleAmount: share };
  });
  if (target > 0 && allocated !== target) {
    const biggest = scaled.reduce((a, b) => (b.totalSaleAmount > a.totalSaleAmount ? b : a));
    biggest.totalSaleAmount += target - allocated;
  }
  return scaled.map((item) => ({
    orderItemCode: item.orderItemCode,
    itemName: item.itemName,
    quantity: item.quantity,
    originalPrice: item.originalPrice,
    unitSalePrice: Math.round(item.totalSaleAmount / item.quantity),
    totalSaleAmount: item.totalSaleAmount
  }));
}

function buildCanonPriceMatcher(db, brand) {
  const strip = (s) => String(s || "").toLowerCase().replace(/\s+/g, "");
  const entries = getLatestPriceCatalog(db, brand.id).map((entry) => ({
    key: strip(entry.itemName || entry.itemCode),
    label: entry.itemName || entry.itemCode,
    price: number(normalizePriceFields(entry).currentSalePrice)
  })).filter((e) => e.key && e.price > 0);
  const today = now().slice(0, 10);
  for (const alias of db.priceAliases || []) {
    if (alias.brandId !== brand.id || alias.isActive === false) continue;
    const from = dateOnly(alias.validFrom) || "0000-01-01";
    const to = dateOnly(alias.validTo) || "9999-12-31";
    if (today < from || today > to) continue;
    const target = (db.priceEntries || []).find((item) => item.id === alias.priceEntryId);
    if (!target) continue;
    const price = number(normalizePriceFields(target).currentSalePrice);
    if (price > 0) entries.push({ key: strip(alias.aliasText), label: alias.aliasText, price });
  }
  return {
    hasCatalog: entries.length > 0,
    match(productName) {
      const name = strip(productName);
      let best = null;
      for (const e of entries) {
        if (name.includes(e.key) && (!best || e.key.length > best.key.length)) best = e;
      }
      return best;
    }
  };
}

// Core reconciliation. Returns { needsMapping, suppliers, errors, warnings,
// summary, lines, cancels, excludedCount, settlementType }.
function computeSettlementResult(db, brand, year, month, cafe24Rows, bankRows) {
  const monthPrefix = `${year}${String(month).padStart(2, "0")}`;
  const settlementType = brand.settlementType || "prepay_fee";
  const suppliers = distinctCafe24Suppliers(cafe24Rows);

  // 정산서 머리말에 찍히는 대표 요율. 건별 요율이 갈릴 수 있으므로 정산월
  // 말일 기준 규칙을 대표값으로 쓰고, 실제로 섞였다면 아래에서 경고를 낸다.
  const periodEnd = new Date(Date.UTC(Number(year), Number(month), 0)).toISOString().slice(0, 10);
  const rate = number(effectiveBrand(brand, periodEnd).commissionRate);

  // 계약 규칙은 "이 정산이 그 건을 어느 달로 묶는지"와 같은 날짜로 고른다.
  // 선매입은 주문일로 정산월을 가르므로 주문일, 위탁은 배송완료월로 가르므로
  // 배송완료일이다. 기준이 어긋나면 7/31 주문·8/3 배송완료 건이 7월 정산에
  // 들어가면서 8월 요율로 계산되는 모순이 생긴다.
  // settlementType 은 정산 흐름 자체를 가르는 구조적 값이라 건별로 흔들면
  // 안 되므로 브랜드 현재값을 그대로 쓴다.
  const appliedRules = new Map(); // validFrom -> 적용 건수
  const ruleFor = (asOf) => {
    const target = asOf || `${year}-${String(month).padStart(2, "0")}-01`;
    const rule = brandRuleAt(brand, target);
    if (rule) appliedRules.set(rule.validFrom, (appliedRules.get(rule.validFrom) || 0) + 1);
    return rule ? { ...brand, ...pickBrandRuleFields(rule) } : brand;
  };
  // 주문 단위 규칙: 한 주문 안의 품목은 같은 규칙으로 계산되어야 하므로
  // 주문당 날짜 하나로 정한다.
  const ruleForOrder = (orderNo, rowsOfOrder) => {
    if (brandSettlementDateBasis(brand) === "delivered") {
      const dates = rowsOfOrder.map((r) => cafe24DateOnly(r["배송완료일"])).filter(Boolean).sort();
      return ruleFor(dates.length ? dates[dates.length - 1] : "");
    }
    return ruleFor(cafe24DateOnly(String(orderNo || "").slice(0, 8)));
  };

  if (!String(brand.cafe24Supplier || "").trim()) {
    return { needsMapping: true, suppliers, settlementType };
  }

  // data2: cafe24 rows for this brand
  const brandRows = cafe24Rows.filter((r) => cafe24RowMatchesBrand(r, brand));

  // 어느 날짜로 정산월을 가를지는 브랜드 설정(settlementDateBasis)을 따른다.
  //   delivered : [배송완료일]이 정산월인 건 (주문일 무관) — 위탁 기본값
  //   order     : [주문일](주문번호 앞 8자리)이 정산월 + 배송완료된 건 — 그 외 기본값
  // 계약이 브랜드마다 다르므로 정산유형에 묶지 않고 브랜드별로 고르게 둔다.
  const dateBasis = brandSettlementDateBasis(brand);
  const isConsignment = settlementType === "consignment";
  const byDelivered = dateBasis === "delivered";
  const ymOf = (raw) => String(cafe24DateOnly(raw) || "").replace(/[^0-9]/g, "").slice(0, 6);
  const cancels = [];
  const includedByOrder = new Map(); // orderNo -> [정산 포함 cafe24 rows]
  const allRowsByOrder = new Map(); // orderNo -> [all non-cancelled rows] (부분배송 대조용)
  let excludedCount = 0;
  for (const r of brandRows) {
    const orderNo = String(r["주문번호"] || "").trim();
    const orderDate = orderNo.slice(0, 8);
    const deliveredDate = String(r["배송완료일"] || "").trim();
    const delivered = Boolean(deliveredDate);
    if (cafe24RowIsCancelled(r)) {
      cancels.push({
        itemNo: r["품목별 주문번호"] || orderNo,
        name: r["주문상품명(기본)"] || "",
        qty: number(r["수량"]),
        saleTotal: cafe24RowSaleAmount(r),
        reason: r["환불상태"] || (r["환불완료일"] ? "환불완료" : "취소/교환"),
        note: r["환불완료일"] || r["취소처리중[환불완료] 처리일"] || ""
      });
      continue;
    }
    const included = byDelivered
      ? (delivered && ymOf(deliveredDate) === monthPrefix)      // 배송완료월 기준
      : (orderDate.startsWith(monthPrefix) && delivered);       // 주문일 기준 + 배송완료
    const inScope = byDelivered ? included : orderDate.startsWith(monthPrefix);
    if (inScope) {
      if (!allRowsByOrder.has(orderNo)) allRowsByOrder.set(orderNo, []);
      allRowsByOrder.get(orderNo).push(r);
    }
    if (included) {
      if (!includedByOrder.has(orderNo)) includedByOrder.set(orderNo, []);
      includedByOrder.get(orderNo).push(r);
    } else {
      excludedCount++;
    }
  }

  // data1: wooofpay 입금요청 for this brand, keyed by orderNo
  const reqByOrder = new Map();
  for (const req of db.requests) {
    if (req.brandId !== brand.id || req.status === "deleted") continue;
    reqByOrder.set(String(req.orderNo || "").trim(), req);
  }

  const errors = [];
  const warnings = [];
  const lines = [];
  let seq = 0;
  // 금액 대조 기준: "catalog"(정가/단가표 — 예: 고공캣)이면 카페24 결제액 대신
  // 단가표 정가로 기대금액을 재계산해 검증한다. 기본은 카페24 결제액 기준.
  const priceBasis = brand.priceBasis === "catalog" ? "catalog" : "cafe24";
  const canon = priceBasis === "catalog" ? buildCanonPriceMatcher(db, brand) : null;
  if (canon && !canon.hasCatalog) {
    warnings.push("정가(단가표) 기준 브랜드인데 단가표에 판매가 있는 품목이 없습니다 — 단가표를 먼저 등록하세요.");
  }
  const sumSales = (rows) => rows.reduce((s, r) => s + cafe24RowSaleAmount(r), 0);
  const sumItemDisc = (rows) => rows.reduce((s, r) => s + number(r["상품별 추가할인금액"]), 0);
  const orderCoupon = (rows) => rows.reduce((mx, r) => Math.max(mx, number(r["쿠폰 할인금액(최종)"]), number(r["주문서 쿠폰 할인금액"])), 0);

  // 위탁: 입금요청(data1)이 없다. 카페24 데이터로만 정산서 라인을 구성한다.
  if (isConsignment) {
    for (const [orderNo, rowsOfOrder] of includedByOrder) {
      const orderShip = cafe24OrderShipping(rowsOfOrder);
      const orderBrand = ruleForOrder(orderNo, rowsOfOrder);
      const orderRate = number(orderBrand.commissionRate);
      rowsOfOrder.forEach((r, idx) => {
        seq++;
        const qty = Math.max(1, number(r["수량"], 1));
        const original = cafe24UnitPrice(r);               // 소비자가(정가) 단가 = 판매가+옵션
        const lineDisc = number(r["상품별 추가할인금액"]);  // 라인 총 할인
        const discountRate = original > 0 && qty > 0 ? Math.max(0, Number((lineDisc / (qty * original)).toFixed(4))) : 0;
        const unitSale = Math.round(original * (1 - discountRate));
        const saleTotal = Math.max(0, original * qty - lineDisc);
        const commissionWon = Math.round(saleTotal * (orderRate / 100));
        lines.push({
          itemNo: r["품목별 주문번호"] || `${orderNo}-${String(idx + 1).padStart(2, "0")}`,
          name: r["주문상품명(기본)"] || "",
          qty,
          consumer: unitSale,
          original,
          discountRate,
          saleTotal,
          ship: idx === 0 ? orderShip : 0,
          refundShip: 0,
          ratePct: orderRate,
          commissionWon,
          supplyAmt: saleTotal - commissionWon,
          payDate: "",
          note: r["상품별 추가할인 상세"] || ""
        });
      });
    }
  } else
  for (const [orderNo, rowsOfOrder] of includedByOrder) {
    const req = reqByOrder.get(orderNo);
    if (!req) {
      errors.push({ orderNo, type: "missing_request", message: `카페24 배송완료 주문이 입금요청에 없습니다: ${orderNo}` });
      continue;
    }
    // 위탁은 계산서 발행 후 익월 말 입금이라 정산 시점에 미입금이 정상 → 미입금 체크 제외.
    if (!isConsignment) {
      const paid = req.status === "paid" || Boolean(req.paidAt);
      if (!paid) {
        errors.push({ orderNo, type: "unpaid", message: `입금완료되지 않은 주문입니다: ${orderNo}` });
      }
    }
    const orderBrand = ruleForOrder(orderNo, rowsOfOrder);
    const orderRate = number(orderBrand.commissionRate);
    const wooofSales = number(req.productSalesAmount);
    if (priceBasis === "catalog" && canon.hasCatalog) {
      // 정가 기준: 카페24 품목을 단가표 정가로 환산해 기대금액 계산.
      let expected = 0;
      const unmatched = [];
      for (const r of rowsOfOrder) {
        const hit = canon.match(r["주문상품명(기본)"]);
        if (!hit) unmatched.push(String(r["주문상품명(기본)"] || "").trim());
        else expected += hit.price * Math.max(1, number(r["수량"], 1));
      }
      if (unmatched.length) {
        errors.push({
          orderNo,
          type: "catalog_unmatched",
          message: `정가표 매칭 실패 ${orderNo}: ${[...new Set(unmatched)].join(", ")} — 단가표에 품목 또는 별칭을 등록하세요.`
        });
      } else if (wooofSales && Math.abs(expected - wooofSales) > 1) {
        errors.push({
          orderNo,
          type: "amount_mismatch",
          message: `정가 기준 금액 불일치 ${orderNo}: 정가 ${expected.toLocaleString()} vs 입금요청 ${wooofSales.toLocaleString()}`
        });
      } else {
        const shipBase = shippingThresholdBaseAmount(orderBrand, {
          salesAmount: expected,
          supplyAmount: number(req.supplyAmount)
        });
        const expectedShip = calculateBaseShippingFee(orderBrand, shipBase);
        const reqShip = number(req.shippingFee);
        if (Math.abs(expectedShip - reqShip) > 1) {
          errors.push({
            orderNo,
            type: "ship_mismatch",
            message: `배송비 불일치 ${orderNo}: 정책상 ${expectedShip.toLocaleString()} vs 입금요청 ${reqShip.toLocaleString()}`
          });
        }
      }
    } else {
      // 카페24 결제액 기준: 할인/쿠폰/부분배송을 감안한 후보 금액 중 하나와
      // 일치하면 통과 (할인 부담 주체가 브랜드별로 달라 후보 방식으로 수용).
      const allRows = allRowsByOrder.get(orderNo) || rowsOfOrder;
      const partial = allRows.length > rowsOfOrder.length;
      const sets = partial ? [rowsOfOrder, allRows] : [rowsOfOrder];
      const candidates = new Set();
      for (const rows of sets) {
        const list = sumSales(rows);
        const disc = sumItemDisc(rows);
        const coupon = orderCoupon(rows);
        [list, list - disc, list - coupon, list - disc - coupon].forEach((v) => candidates.add(Math.round(v)));
      }
      const cafeSales = sumSales(rowsOfOrder);
      if (cafeSales && wooofSales && ![...candidates].some((c) => Math.abs(c - wooofSales) <= 1)) {
        const cand = [...candidates].filter((c) => c > 0).sort((a, b) => b - a).map((c) => c.toLocaleString()).join(" / ");
        errors.push({
          orderNo,
          type: "amount_mismatch",
          message: `금액 불일치 ${orderNo}: 입금요청 ${wooofSales.toLocaleString()} — 카페24 기준 후보(정가/할인/쿠폰${partial ? "/부분배송" : ""} 반영): ${cand}`
        });
      } else if (partial) {
        warnings.push(`부분배송 주문 ${orderNo}: 일부 품목만 배송완료 상태입니다 — 정산 포함 범위를 확인하세요.`);
      }
    }
    // 정산서는 품목별 주문번호 단위로 한 줄씩 나와야 한다. 입금요청에 품목
    // 내역이 없는 건(총액만 입력한 경우)은 예전처럼 카페24 품목으로 펼친다 —
    // 한 줄로 접으면 서로 다른 상품이 수량만 합쳐진 채 사라진다.
    const items = sanitizeLineItems(req.lineItems);
    const detail = items.length ? items : explodeOrderRows(rowsOfOrder, wooofSales);
    const orderShip = number(req.shippingFee);
    detail.forEach((it, idx) => {
      seq++;
      const saleTotal = number(it.totalSaleAmount, number(it.unitSalePrice) * number(it.quantity));
      const commissionWon = Math.round(saleTotal * (orderRate / 100));
      const unitSale = number(it.unitSalePrice);            // 현재판매가(할인가)
      const original = number(it.originalPrice) || unitSale; // 원판매가(정가)
      const discountRate = original > 0 ? Math.max(0, Number((1 - unitSale / original).toFixed(4))) : 0;
      lines.push({
        // 진짜 품목별 주문번호를 쓴다. 순번으로 지어내면 -02/-03 품목이 전부
        // -01 로 찍혀 원본 주문과 대조가 안 된다.
        itemNo: it.orderItemCode || `${orderNo}-${String(idx + 1).padStart(2, "0")}`,
        name: it.itemName || it.itemCode || "",
        qty: number(it.quantity) || 1,
        consumer: unitSale,
        original,                 // 원판매가(정가) 단가
        discountRate,             // 할인율 (fraction) — 위탁 상세 시트용
        saleTotal,
        ship: idx === 0 ? orderShip : 0,
        refundShip: 0,
        ratePct: orderRate,
        commissionWon,
        supplyAmt: saleTotal - commissionWon,
        payDate: req.paidAt || "",
        note: it.note || ""
      });
    });
  }

  // 한 정산 안에서 계약 규칙이 갈렸으면 반드시 드러낸다 — 조용히 섞이면
  // 합계만 보고는 어느 요율이 적용됐는지 알 수 없다.
  if (appliedRules.size > 1) {
    const detail = [...appliedRules.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([validFrom, count]) => {
        const rule = (brand.ruleHistory || []).find((item) => item.validFrom === validFrom);
        const rateText = rule ? `수수료 ${number(rule.commissionRate)}%` : "";
        const shipText = rule?.shippingRule ? ` · ${rule.shippingRule}` : "";
        return `${validFrom}~ (${rateText}${shipText}) ${count}건`;
      })
      .join(" / ");
    warnings.push(`이 정산에 계약 규칙 ${appliedRules.size}개 버전이 적용됐습니다 — ${detail}`);
  }

  const salesTotal = lines.reduce((s, l) => s + l.saleTotal, 0);
  const shipTotal = lines.reduce((s, l) => s + l.ship, 0);
  const refundShipTotal = lines.reduce((s, l) => s + l.refundShip, 0);
  const commissionTotal = lines.reduce((s, l) => s + l.commissionWon, 0);
  const isDebt = settlementType === "prepay_debt";
  const deliveredSupply = isDebt ? salesTotal : salesTotal - commissionTotal;
  const finalAmount = deliveredSupply + shipTotal + refundShipTotal;

  // data3: 은행 출금 대조 — 주문건별 매칭. 정산에 포함된 각 주문의 입금액과
  // 동일한 출금이 브랜드 앞으로 존재하는지 건별 확인한다. 은행 파일이 5~7월 등
  // 여러 달을 담고 있어도 정산월에 한정하지 않고 파일 전체 범위에서 찾는다
  // (배송 후 입금하는 업체는 월 경계를 넘어가기도 하므로).
  let bankMonthTotal = 0;
  if (isConsignment) {
    // 위탁은 계산서 발행 후 익월 말에 입금하므로 이번 정산 시점 통장 내역과
    // 대조할 것이 없다. 은행 대조를 건너뛰고 카페24(배송완료 기준)로만 정산한다.
    warnings.push("위탁 정산은 익월 말 입금이라 은행 출금 대조를 하지 않습니다 (카페24 배송완료 기준으로만 집계).");
  } else if (bankRows.length) {
    const { rows: bankBrand, deposits: bankDeposits, coverage } = bankBrandMovements(bankRows, brand);
    const coverageList = [...coverage].sort();
    const coverageLabel = coverageList.length
      ? (coverageList.length === 1 ? coverageList[0] : `${coverageList[0]}~${coverageList[coverageList.length - 1]}`)
      : "";
    for (const [orderNo] of includedByOrder) {
      const req = reqByOrder.get(orderNo);
      if (!req) continue;
      // 이번에 실제 나가는 금액 = paidAmount(있으면) 또는
      // 업체실입금 − 외상차감 − 기지급(부족분만 이번에 송금).
      const expect = Math.round(number(req.paidAmount) || Math.max(0, number(req.depositAmount) - number(req.creditUsedAmount) - number(req.priorPaidAmount)));
      if (!expect) continue;
      // 파일 전체 범위에서 동일 금액 출금을 찾는다(월 무관).
      const hit = bankBrand.find((r) => !r.used && Math.abs(r.amount - expect) <= 1);
      if (hit) {
        hit.used = true;
        bankMonthTotal += hit.amount;
        continue;
      }
      const paidYm = String(req.paidAt || "").slice(0, 7);
      if (paidYm && coverage.size && !coverage.has(paidYm)) {
        // 입금일이 업로드된 은행 파일 범위 밖 → 오류 아님(다른 달 파일 확인 필요).
        warnings.push(`은행 파일 범위(${coverageLabel}) 밖 입금 추정: ${orderNo} (입금액 ${expect.toLocaleString()}원, 입금일 ${paidYm}) — 해당 기간 은행 내역을 함께 올리면 대조됩니다.`);
      } else {
        errors.push({
          orderNo,
          type: "bank_missing",
          message: `은행 출금 내역 없음: ${orderNo} (입금액 ${expect.toLocaleString()}원)`
        });
      }
    }
    // 입금(환불) 반영: 오입금 환불 등으로 브랜드가 우리에게 돌려준 금액은
    // 순 지급액에서 차감해야 총액이 맞는다. 은행 출금합 = 매칭 출금 − 입금(환불).
    const depositTotal = bankDeposits.reduce((s, r) => s + r.amount, 0);
    if (depositTotal > 0) {
      bankMonthTotal -= depositTotal;
      warnings.push(`브랜드 입금(환불 등) ${bankDeposits.length}건 (합 ${depositTotal.toLocaleString()}원)을 순 출금액에서 차감했습니다 — 오입금 환불 여부를 확인하세요.`);
    }
    // 매칭 안 된 출금을 건별 분류: (a)어떤 주문 입금액과도 안 맞으면 과입금/오입금
    // 의심 → 오류, (b)이번 정산 포함 주문(이미 매칭됨) 금액과 같으면 중복입금 의심
    // → 오류, (c)타 기간 주문 금액과 같으면 정보(경고). 두 번 입금·잘못 입금을
    // 놓치지 않도록 반드시 체크해서 알려준다.
    const allExpects = [];
    for (const req of reqByOrder.values()) {
      const e = Math.round(number(req.paidAmount) || Math.max(0, number(req.depositAmount) - number(req.creditUsedAmount) - number(req.priorPaidAmount)));
      if (e) allExpects.push({ orderNo: String(req.orderNo || "").trim(), expect: e, included: includedByOrder.has(String(req.orderNo || "").trim()) });
    }
    const settlementYm = `${year}-${String(month).padStart(2, "0")}`;
    for (const lw of bankBrand.filter((r) => !r.used)) {
      const info = (lw.date ? `${lw.date} ` : "") + (lw.memo || "").trim();
      // 앞뒤 달 출금은 (배송 후 익월 입금 등) 주문 매칭 용도로만 쓰고, 과입금·중복
      // 체크 대상에서는 제외한다 → 정보 경고만. 과입금/중복 판정은 정산월 내 출금만.
      const inMonth = !lw.ym || lw.ym === settlementYm;
      if (!inMonth) {
        warnings.push(`정산월 밖 출금 ${lw.amount.toLocaleString()}원 (${lw.ym}) — 전월/익월 정산건 추정, 해당 월 정산에서 확인하세요. (${info})`);
        continue;
      }
      const near = allExpects.filter((a) => Math.abs(a.expect - lw.amount) <= 1);
      if (near.some((a) => a.included)) {
        errors.push({ type: "bank_duplicate", message: `중복입금 의심 ${lw.amount.toLocaleString()}원 — ${near.find((a) => a.included).orderNo} 입금액과 동일 (${info})` });
      } else if (near.length) {
        warnings.push(`타 기간 주문 추정 출금 ${lw.amount.toLocaleString()}원 — ${near[0].orderNo} (${info})`);
      } else {
        errors.push({ type: "bank_overpaid", message: `매칭 안 되는 출금 ${lw.amount.toLocaleString()}원 (과입금/오입금 의심) — ${info || "적요 없음"}` });
      }
    }
  } else {
    warnings.push("은행 파일이 업로드되지 않아 출금 대조를 건너뜁니다.");
  }

  return {
    needsMapping: false,
    suppliers,
    settlementType,
    rate,
    errors,
    warnings,
    excludedCount,
    cancels,
    lines,
    summary: {
      salesTotal, shipTotal, refundShipTotal, commissionTotal,
      deliveredSupply, finalAmount, bankTotal: bankMonthTotal, orderCount: includedByOrder.size
    }
  };
}

// ---------------------------------------------------------------------------
// NPB (도톤 운영대행) settlement calc engine — pure functions, no I/O.
// Golden-master reproduction gate: scripts/npb_calc_verify.mjs (2/3/4월).
// ---------------------------------------------------------------------------

// One settlement line -> money totals. rate_on_sale (위탁/자사/대리점):
// 매출=salePrice*qty, 공제=round(매출*feeRate), 정산=매출-공제. margin_supply
// (매입, 공급가 고정): 매출=판매가*qty, 정산=공급가*qty, 공제=매출-정산.
// eaPerUnit affects 정가/총수량 only; salePrice is already per order/bundle.
export function npbComputeLine(line) {
  const qty = number(line.qty);
  const ea = number(line.eaPerUnit, 1) || 1;
  const listTotal = number(line.listPrice) * qty * ea;
  if (line.calcType === "margin_supply") {
    const saleTotal = number(line.salePrice) * qty;
    const settleTotal = number(line.supplyPrice) * qty;
    return { listTotal, saleTotal, feeTotal: saleTotal - settleTotal, settleTotal };
  }
  const saleTotal = number(line.salePrice) * qty;
  const feeTotal = Math.round(saleTotal * number(line.feeRate));
  return { listTotal, saleTotal, feeTotal, settleTotal: saleTotal - feeTotal };
}

// Rollup over lines (4-step 종합정산). 실판매계=Σ매출; 할인계=정가-실판매;
// 매출계=실판매-공제; 이익=매출계-실비-이월손실. carryOver is the prior month's
// unrecovered net loss carried forward (0 unless a previous month ran negative;
// e.g. 3월 answer key = 매출계-실비-89860 where 89860 is |2월 이익|).
export function npbComputeRollup(lines, logisticsCost, carryOver = 0) {
  let qtyTotal = 0;
  let listTotal = 0;
  let realSaleTotal = 0;
  let feeTotal = 0;
  for (const line of lines) {
    const computed = npbComputeLine(line);
    qtyTotal += number(line.qty) * (number(line.eaPerUnit, 1) || 1);
    listTotal += computed.listTotal;
    realSaleTotal += computed.saleTotal;
    feeTotal += computed.feeTotal;
  }
  const revenueTotal = realSaleTotal - feeTotal;
  const cost = number(logisticsCost);
  const carry = number(carryOver);
  return {
    qtyTotal,
    listTotal,
    discountTotal: listTotal - realSaleTotal,
    realSaleTotal,
    feeTotal,
    revenueTotal,
    logisticsCost: cost,
    carryOver: carry,
    profit: revenueTotal - cost - carry
  };
}

// 실비(운임/물류) = 소형*(택배소형+피킹) + 중대형*(택배중대형+피킹). Unit costs
// are VAT-included documentation values from costConfig.
// 출고 유형별 실비. counts 는 { 유형키: 건수 } 또는 { 유형키: { count, amount } }.
// 용달·퀵처럼 건마다 금액이 다른 유형(manual)은 적어 넣은 금액을 그대로 쓴다.
// 유형 목록이 없는 예전 브랜드는 소형/대형 단가로 자동 구성해 결과가 같다.
export function npbComputeShipping(counts, costConfig) {
  const cfg = costConfig || {};
  const types = Array.isArray(cfg.shipTypes) && cfg.shipTypes.length
    ? cfg.shipTypes
    : [
        { key: "small", label: "소형 출고", freight: number(cfg.smallShip), handling: number(cfg.pickPack) },
        { key: "large", label: "대형 출고", freight: number(cfg.largeShip), handling: number(cfg.pickPack) }
      ];
  const breakdown = types.map((t) => {
    const raw = counts?.[t.key];
    const entry = raw && typeof raw === "object" ? raw : { count: raw };
    const count = number(entry.count);
    const unit = number(t.freight) + number(t.handling);
    const amount = t.manual ? number(entry.amount) : count * unit;
    return {
      key: t.key,
      label: t.label || t.key,
      manual: Boolean(t.manual),
      // 용달·퀵처럼 건별 사정이 다른 운송은 합계에 넣지 않고 개별 기재한다.
      excludeFromTotal: Boolean(t.excludeFromTotal),
      count,
      freight: number(t.freight),
      handling: number(t.handling),
      amount
    };
  });
  const counted = breakdown.filter((b) => !b.excludeFromTotal);
  return {
    total: counted.reduce((sum, b) => sum + b.amount, 0),
    countTotal: counted.reduce((sum, b) => sum + b.count, 0),
    // 합계에서 뺀 항목도 청구 근거로 남긴다.
    separateTotal: breakdown.filter((b) => b.excludeFromTotal).reduce((sum, b) => sum + b.amount, 0),
    breakdown
  };
}

export function npbComputeLogistics(shipCountSmall, shipCountLarge, costConfig) {
  const cfg = costConfig || {};
  const pickPack = number(cfg.pickPack);
  return number(shipCountSmall) * (number(cfg.smallShip) + pickPack)
    + number(shipCountLarge) * (number(cfg.largeShip) + pickPack);
}

// 이익 3사 분배. Excluded party contributes ratio 0; remaining ratios are
// renormalized so they still sum to 1 (proportional redistribution). Amount is
// ratio*profit with NO rounding (keeps .5 shares).
export function npbComputeProfitSplit(profit, parties) {
  const list = parties || [];
  const activeRatioSum = list
    .filter((party) => !party.excluded)
    .reduce((sum, party) => sum + number(party.ratio), 0);
  return list.map((party) => {
    const ratio = party.excluded || activeRatioSum <= 0
      ? 0
      : number(party.ratio) / activeRatioSum;
    return {
      party: party.party || party.partyName || "",
      ratio,
      amount: ratio * number(profit),
      excluded: Boolean(party.excluded),
      note: party.note || ""
    };
  });
}

// Resolve a parsed line's channel code (which may be the parser dispatch code,
// e.g. "molly") back to the namespace channel config ("emart"). Reverse lookup
// is computed at call time to avoid a module-load TDZ on NPB_PARSER_CHANNEL.
function npbNamespaceChannel(code) {
  for (const [ns, parser] of Object.entries(NPB_PARSER_CHANNEL)) {
    if (parser === code) return ns;
  }
  return code;
}

// 파일명으로 채널을 찾는다. 채널 설정의 filenameKeywords 를 먼저 보고, 없으면
// 채널명·코드로 매칭한다. 화면에서 채널을 추가하면 파서 코드를 고치지 않아도
// 파일명 인식이 따라오게 하는 것이 목적이다.
//
// 한 파일이 여러 채널에 걸릴 수 있다 — "DB_cafe24_영이공구_202605" 는 cafe24 와
// 영이공구 둘 다에 맞는다. 내보내기 파일명이 DB_플랫폼_채널_연월 순서라 뒤쪽이
// 더 구체적인 채널이므로, 나중에 나오는 키워드를 택한다. 잘못 고르면 매출이
// 엉뚱한 채널에 붙으므로 후보를 함께 돌려주어 화면에서 확인할 수 있게 한다.
// macOS 는 한글 파일명을 NFD 로 저장하므로 양쪽 다 NFC 로 맞춘다.
function npbMatchChannels(channels, fileName) {
  const base = String(fileName || "").normalize("NFC").toLowerCase().replace(/\s+/g, "");
  if (!base) return [];
  const hits = [];
  for (const channel of channels || []) {
    if (channel.active === false) continue;
    const keys = [
      ...(Array.isArray(channel.filenameKeywords) ? channel.filenameKeywords : []),
      channel.name,
      channel.code
    ]
      .map((k) => String(k || "").normalize("NFC").toLowerCase().replace(/\s+/g, ""))
      .filter(Boolean);
    let best = null;
    for (const key of keys) {
      const at = base.indexOf(key);
      if (at < 0) continue;
      if (!best || at > best.at || (at === best.at && key.length > best.length)) {
        best = { at, length: key.length, key };
      }
    }
    if (best) hits.push({ code: channel.code, name: channel.name, ...best });
  }
  hits.sort((a, b) => (b.at - a.at) || (b.length - a.length));
  return hits;
}

// 라인에 채널 단가·수수료를 채우고 합계·물류비·이익배분까지 다시 계산한다.
// 업로드와 워크시트 저장이 같은 경로를 쓰도록 함수로 뺐다 — 업로드 후 사람이
// [저장(계산)] 을 눌러야 숫자가 맞는 것이 병목이었다.
// 생략한 값은 저장된 값을 그대로 쓰므로, 인자 없이 불러도 안전하다.
function npbRecompute(db, settlement, opts = {}) {
  const brand = npbGetBrand(db, settlement.brand);
  const costConfig = brand?.costConfig || {};
  const npbChannels = (db.npb?.channels || []).filter(
    (c) => !brand || String(c.brandId).toLowerCase() === String(brand.id).toLowerCase()
  );
  const lines = (settlement.lines || []).map((line) => npbEnrichLine(line, npbChannels));
  settlement.lines = lines;
  // 출고 건수는 유형별로 받는다. 예전 정산은 소형/대형 두 값만 갖고 있으므로
  // 그대로 옮겨 담아 결과가 달라지지 않게 한다.
  const counts = opts?.logistics?.counts
    || settlement.logistics?.counts
    || {
      small: number(settlement.logistics?.smallCount),
      large: number(settlement.logistics?.largeCount)
    };
  if (opts?.logistics && !opts.logistics.counts) {
    if (opts.logistics.smallCount !== undefined) counts.small = number(opts.logistics.smallCount);
    if (opts.logistics.largeCount !== undefined) counts.large = number(opts.logistics.largeCount);
  }
  const shipping = npbComputeShipping(counts, costConfig);
  // 실비를 별도 청구하는 브랜드는 정산 이익에서 공제하지 않는다. 금액은 그대로
  // 산출해 청구 근거로 남긴다.
  const billSeparately = costConfig.billSeparately === true;
  const carryOver = number(opts?.carryOver, number(settlement.carryOver));
  const rollup = npbComputeRollup(lines, billSeparately ? 0 : shipping.total, carryOver);
  const parties = settlement.parties && settlement.parties.length
    ? settlement.parties
    : db.npb.defaultProfitSplit || [];
  const profitSplit = npbComputeProfitSplit(rollup.profit, parties);
  const pickPack = number(costConfig.pickPack);
  const byKey = Object.fromEntries(shipping.breakdown.map((b) => [b.key, b]));
  settlement.logistics = {
    counts,
    breakdown: shipping.breakdown,
    countTotal: shipping.countTotal,
    separateTotal: shipping.separateTotal,
    billSeparately,
    // 예전 필드도 함께 남긴다 — 정산서 출력과 과거 데이터가 이 이름을 쓴다.
    smallCount: number(counts.small),
    largeCount: number(counts.large),
    smallShip: number(costConfig.smallShip),
    largeShip: number(costConfig.largeShip),
    pickPack,
    smallTotal: number(byKey.small?.amount),
    largeTotal: number(byKey.large?.amount),
    grandTotal: shipping.total
  };
  settlement.carryOver = carryOver;
  settlement.rollup = rollup;
  settlement.profitSplit = profitSplit;
  if (Array.isArray(opts.inventory)) settlement.inventory = opts.inventory;
  settlement.updatedAt = now();
  return { rollup, logistics: settlement.logistics, profitSplit, inventory: settlement.inventory, billSeparately };
}

// 물류 입출고 원장에서 상품별 입고·출고를 뽑는다. 지금까지는 재고를 손으로
// 적어야 했다 — 파일에 이미 있는 숫자를 다시 옮겨 적는 셈이었다.
// 컬럼명은 WMS 내보내기 기준이며, 없으면 비슷한 이름을 찾는다.
export function npbInventoryFromLogistics(rows, products) {
  const pick = (row, names) => {
    for (const n of names) if (row[n] !== undefined) return row[n];
    const key = Object.keys(row).find((k) => names.some((n) => k.replace(/\s+/g, "").includes(n)));
    return key ? row[key] : undefined;
  };
  // 물류 양식이 둘이다. 입출고 원장은 입고수량·출고수량을 주고, 출고상세는
  // 주문 단위라 주문수량이 곧 출고다. 상품 식별 컬럼 이름도 다르다.
  const match = (row) => {
    const barcode = String(pick(row, ["바코드번호", "재고매칭(1)바코드번호", "바코드"]) ?? "").trim();
    const code = String(pick(row, ["상품코드", "판매처상품코드", "품목코드"]) ?? "").trim().toUpperCase();
    const name = String(pick(row, ["상품명", "재고매칭(1)상품명", "판매처상품명", "품목명"]) ?? "").trim();
    for (const p of products) {
      if (barcode && p.barcode && barcode === String(p.barcode)) return p.id;
      if (code && (p.skuCodes || []).some((sku) => code.startsWith(String(sku).toUpperCase()))) return p.id;
    }
    // 바코드·코드가 비면 이름으로 찾는다. 여러 상품에 걸리면 판단하지 않는다.
    const hits = products.filter((p) =>
      (p.nameKeywords || []).some((k) => name.includes(k))
    );
    return hits.length === 1 ? hits[0].id : "";
  };

  const totals = new Map();
  const unmatched = new Set();
  for (const row of rows || []) {
    if (!row || typeof row !== "object") continue;
    const inbound = number(pick(row, ["입고수량"]));
    const hasLedger = pick(row, ["입고수량"]) !== undefined || pick(row, ["출고수량"]) !== undefined;
    const outbound = hasLedger
      ? number(pick(row, ["출고수량"]))
      : number(pick(row, ["주문수량", "수량"]));
    if (!inbound && !outbound) continue;
    const id = match(row);
    if (!id) {
      const name = String(pick(row, ["상품명", "재고매칭(1)상품명", "판매처상품명", "품목명"]) ?? "").trim();
      if (name) unmatched.add(name);
      continue;
    }
    const cur = totals.get(id) || { inbound: 0, outbound: 0 };
    cur.inbound += inbound;
    cur.outbound += outbound;
    totals.set(id, cur);
  }
  return { totals, unmatched: [...unmatched] };
}

// 전월 마감재고를 이번 달 기초로 이월한다. 첫 달만 손으로 넣으면 그 뒤로는
// 이어진다.
function npbPriorClosing(db, settlement) {
  const list = (db.npb.settlements || [])
    .filter((s) => s.brand === settlement.brand && s.periodMonth < settlement.periodMonth)
    .sort((a, b) => String(b.periodMonth).localeCompare(String(a.periodMonth)));
  const prior = list[0];
  if (!prior) return new Map();
  return new Map((prior.inventory || []).map((r) => [r.productKey, number(r.closing)]));
}

// 광고비는 구글시트에 누적된다. 공개 링크의 CSV 내보내기를 읽으므로 별도
// 인증이 필요 없다. 정산에는 넣지 않고 별도 청구 근거로만 쓴다.
export function npbAdCostCsvUrl(sheetUrl) {
  const id = String(sheetUrl || "").match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/)?.[1];
  return id ? `https://docs.google.com/spreadsheets/d/${id}/export?format=csv` : "";
}

// 기간 셀은 첫 행에만 있고 이후 매체 행은 비어 있다 — 마지막 기간을 물려 쓴다.
export function npbParseAdCost(csvText, periodMonth) {
  const rows = parseCsv(String(csvText || ""));
  const want = String(periodMonth || "").replace(/-/g, ".");
  const items = [];
  let current = "";
  for (const row of rows.slice(1)) {
    const period = String(row[0] || "").trim();
    if (period) current = period;
    const medium = String(row[1] || "").trim();
    const amount = number(String(row[2] || "").replace(/,/g, ""));
    if (!medium || !current) continue;
    // "2026.04.01~2026.04.30" 에서 앞쪽 연·월만 본다.
    const month = current.match(/(\d{4})[.\-\/](\d{1,2})/);
    if (!month) continue;
    const key = `${month[1]}.${String(Number(month[2])).padStart(2, "0")}`;
    if (want && key !== want) continue;
    items.push({ period: current, medium, amount });
  }
  return { items, total: items.reduce((sum, i) => sum + i.amount, 0) };
}

// 판매처마다 상품명이 다르다. 파서가 못 알아본 이름은 버리지 않고 여기서
// 다시 맞춰본다 — 먼저 사람이 지정해둔 별칭, 그다음 상품표 키워드.
// 그래도 모르면 사람이 한 번 지정하고, 그 지정이 별칭으로 저장돼 다음부터는
// 자동으로 인식된다.
// 정산 key 는 DOTEON_202606 처럼 대문자를 쓰고 상품·채널은 소문자 id 를 쓴다.
// 브랜드를 가릴 때는 항상 이걸로 비교한다 — 대소문자가 갈리면 상품표도 별칭도
// 빈 목록이 되어 아무것도 매칭되지 않는다.
function npbSameBrand(a, b) {
  return String(a ?? "doteon").trim().toLowerCase() === String(b ?? "doteon").trim().toLowerCase();
}

function npbNormalizeName(value) {
  return String(value || "").normalize("NFC").toLowerCase().replace(/\s+/g, "");
}

// "(3팩/15개)" → 3개, "(5개입)" → 1개, "(20개입/1박스)" → 1개(180g)
function npbGuessTier(sourceName, product) {
  const text = String(sourceName || "");
  const tiers = product?.packTiers || [];
  const packs = text.match(/(\d+)\s*팩/);
  if (packs) {
    const want = `${Number(packs[1])}개`;
    const hit = tiers.find((t) => t.tier === want);
    if (hit) return hit.tier;
  }
  return tiers[0]?.tier || "";
}

function npbMatchProduct(sourceName, products) {
  const norm = npbNormalizeName(sourceName);
  if (!norm) return null;
  // 키워드가 모두 들어 있는 상품만 후보로 본다. 하나만 남을 때 채택한다 —
  // 맛이나 용량을 못 가르면 임의로 고르지 않는다.
  const hits = products.filter((p) =>
    (p.nameKeywords || []).length &&
    (p.nameKeywords || []).every((k) => norm.includes(npbNormalizeName(k)))
  );
  return hits.length === 1 ? hits[0] : null;
}

function npbResolveLines(lines, products, aliases) {
  const aliasByName = new Map(
    (aliases || []).map((a) => [npbNormalizeName(a.sourceName), a])
  );
  const resolved = [];
  const unresolved = new Map();
  for (const line of lines || []) {
    if (line.productKey) {
      resolved.push(line);
      continue;
    }
    const sourceName = line.raw?.sourceName || line.tier || line.label || "";
    const alias = aliasByName.get(npbNormalizeName(sourceName));
    if (alias) {
      resolved.push({ ...line, productKey: alias.productId, tier: alias.tier || "", label: alias.label || sourceName });
      continue;
    }
    const product = npbMatchProduct(sourceName, products);
    if (product) {
      const tier = npbGuessTier(sourceName, product);
      resolved.push({ ...line, productKey: product.id, tier, label: `${product.name}${tier ? ` ${tier}` : ""}` });
      continue;
    }
    const key = npbNormalizeName(sourceName);
    const cur = unresolved.get(key) || { sourceName, qty: 0 };
    cur.qty += number(line.qtyEa ?? line.qty);
    unresolved.set(key, cur);
  }
  return { resolved, unresolved: [...unresolved.values()] };
}

function npbDetectChannelFromName(channels, fileName) {
  return npbMatchChannels(channels, fileName)[0]?.code || "";
}

function npbFindChannel(channels, code) {
  const want = String(code || "").trim().toLowerCase();
  if (!want) return null;
  const list = channels || [];
  const canonical = npbNamespaceChannel(want);
  return (
    list.find((c) => String(c.code).toLowerCase() === want) ||
    list.find((c) => String(c.code).toLowerCase() === canonical) ||
    null
  );
}

// Merge parsed-upload row fields (channel, productKey, qtyEa/qtyOrders, tier)
// with the channel config pricing so npbComputeLine has everything it needs.
// Convention (matches the answer keys): qty is the TOTAL EA count and salePrice
// is per-EA, so eaPerUnit collapses to 1. 공구 tier rows resolve their per-EA
// price from channel.tiers by leading digit. Fields already present on the line
// (manual grid edits) win over config defaults.
function npbEnrichLine(line, channels) {
  const channel = npbFindChannel(channels, line.channel);
  const qty = line.qty != null ? number(line.qty) : number(line.qtyEa);
  const enriched = {
    ...line,
    channel: channel ? channel.code : line.channel,
    qty,
    eaPerUnit: 1,
    listPrice: line.listPrice != null ? number(line.listPrice) : 22000
  };
  if (!channel) return enriched;
  enriched.calcType = line.calcType || channel.calcType || "rate_on_sale";
  let tierPrice = null;
  if (Array.isArray(channel.tiers) && line.tier) {
    const digit = String(line.tier).match(/(\d)/);
    const tier = digit
      ? channel.tiers.find((t) => String(t.tier).startsWith(digit[1]))
      : null;
    if (tier) tierPrice = tier.salePrice;
  }
  enriched.salePrice = line.salePrice != null
    ? number(line.salePrice)
    : number(tierPrice != null ? tierPrice : channel.salePrice);
  enriched.feeRate = line.feeRate != null ? number(line.feeRate) : number(channel.feeRate);
  enriched.supplyPrice = line.supplyPrice != null
    ? number(line.supplyPrice)
    : number(channel.supplyPrice);
  return enriched;
}

async function generateSettlementXlsx(spec) {
  const tmpBase = path.join(os.tmpdir(), `wooofpay-settlement-${crypto.randomBytes(8).toString("hex")}`);
  const inputPath = `${tmpBase}.json`;
  const outputPath = `${tmpBase}.xlsx`;
  try {
    await writeFile(inputPath, JSON.stringify(spec), "utf8");
    await execFileAsync("python3", [SETTLEMENT_SCRIPT, "--input", inputPath, "--output", outputPath], {
      cwd: __dirname,
      maxBuffer: 20 * 1024 * 1024
    });
    return await readFile(outputPath);
  } finally {
    await safeUnlink(inputPath);
    await safeUnlink(outputPath);
  }
}

function settlementSpecFromResult(brand, year, month, result) {
  // Statement title & filename use the wooofpay brand name (not the cafe24 supplier code).
  const supplierName = String(brand.name || brand.cafe24Supplier || "").trim();
  return {
    type: result.settlementType,
    supplierName,
    year: Number(year),
    monthLabel: `${Number(month)}/1-${Number(month)}/${new Date(Number(year), Number(month), 0).getDate()}`,
    rate: number(result.rate) / 100,
    lines: result.lines,
    cancels: result.cancels
  };
}

// --- NPB (도톤 운영대행) settlement API helpers ----------------------------

// Namespace channel codes differ from npb_parse.py's dispatch codes for a few
// channels; map before invoking the parser so the recipe is recognized.
const NPB_PARSER_CHANNEL = {
  emart: "molly",
  wooofmall: "cafe24",
  tarimarket: "terrymarket"
};

function npbGetBrand(db, brandCode) {
  const code = String(brandCode || "").trim().toLowerCase();
  return (db.npb?.brands || []).find((item) => String(item.id).toLowerCase() === code) || null;
}

function npbFindSettlement(db, key) {
  return (db.npb?.settlements || []).find((item) => item.key === key) || null;
}

// Write the uploaded base64 to a temp file then run npb_parse.py, mirroring
// parseBankXlsxUpload. Channel is passed explicitly (temp filename is random,
// so filename-based detection can't work). Returns the parser JSON.
async function runNpbParse(base64, fileName, channel) {
  const buf = Buffer.from(base64 || "", "base64");
  const ext = path.extname(fileName || "") || ".xlsx";
  const tmpPath = path.join(os.tmpdir(), `wooofpay-npb-${crypto.randomBytes(8).toString("hex")}${ext}`);
  try {
    await writeFile(tmpPath, buf);
    const args = [NPB_PARSE_SCRIPT, "--input", tmpPath];
    const parserChannel = NPB_PARSER_CHANNEL[channel] || channel;
    if (parserChannel) args.push("--channel", parserChannel);
    let stdout;
    try {
      ({ stdout } = await execFileAsync("python3", args, {
        cwd: __dirname,
        maxBuffer: 20 * 1024 * 1024
      }));
    } catch (err) {
      // Surface the real python error (stderr/traceback) instead of a generic message.
      const detail = String(err.stderr || err.message || "").trim().split("\n").pop();
      throw new Error(`파서 실행 오류: ${detail || "python3 실행 실패"}`);
    }
    try {
      return JSON.parse(stdout || "{}");
    } catch (err) {
      throw new Error(`파서 출력 해석 실패: ${String(stdout || "").slice(0, 200)}`);
    }
  } finally {
    await safeUnlink(tmpPath);
  }
}

// Build the npb_settlement_xlsx.py spec.json from a stored settlement. The
// generator is tolerant (all fields optional), so we map what we have and let
// missing sections fall back to its defaults.
function npbBuildXlsxSpec(db, settlement) {
  const brand = npbGetBrand(db, settlement.brand);
  const costConfig = brand?.costConfig || {};
  const period = settlement.period || {};
  const allChannels = db.npb?.channels || [];
  const byCode = new Map();
  for (const line of settlement.lines || []) {
    const code = line.channelCode || line.channel || "unknown";
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code).push(line);
  }
  const channels = [];
  for (const [code, lines] of byCode) {
    const meta = allChannels.find((item) => item.code === code);
    channels.push({
      name: meta?.name || code,
      headers: ["상품", "수량", "정가", "매출", "공제", "정산"],
      rows: lines.map((line) => {
        const computed = npbComputeLine(line);
        return [
          line.label || line.lineLabel || line.productKey || "",
          number(line.qty),
          computed.listTotal,
          computed.saleTotal,
          computed.feeTotal,
          computed.settleTotal
        ];
      })
    });
  }
  const profitSplit = (settlement.profitSplit || []).map((party) => ({
    partyName: party.partyName || party.party || "",
    ratio: party.ratio,
    amount: party.amount,
    note: party.note || "",
    excluded: Boolean(party.excluded)
  }));
  return {
    period: {
      year: period.year,
      month: period.month,
      monthStart: period.monthStart || "",
      range: period.range || "",
      monthEnd: period.monthEnd || "",
      start: period.start || "",
      end: period.end || ""
    },
    rollup: settlement.rollup || {},
    inventory: settlement.inventory || [],
    inventoryTotal: settlement.inventoryTotal || null,
    profitSplit,
    profitSplitTotalRatio: settlement.rollup ? 1 : undefined,
    profitSplitTotalAmount: settlement.rollup?.profit,
    logistics: settlement.logistics || {},
    threePLTable: costConfig.threePlTable || [],
    channels,
    ledger: settlement.ledger || {},
    memo: settlement.memo || []
  };
}

async function generateNpbXlsx(spec) {
  const tmpBase = path.join(os.tmpdir(), `wooofpay-npb-xlsx-${crypto.randomBytes(8).toString("hex")}`);
  const inputPath = `${tmpBase}.json`;
  const outputPath = `${tmpBase}.xlsx`;
  try {
    await writeFile(inputPath, JSON.stringify(spec), "utf8");
    await execFileAsync("python3", [NPB_XLSX_SCRIPT, "--input", inputPath, "--output", outputPath], {
      cwd: __dirname,
      maxBuffer: 20 * 1024 * 1024
    });
    return await readFile(outputPath);
  } finally {
    await safeUnlink(inputPath);
    await safeUnlink(outputPath);
  }
}

function normalizeImportedAction(row = {}) {
  const action = String(row.action || "").trim().toLowerCase();
  if (action) return action;
  return row.entryId ? "update" : "create";
}

function getCookie(req, name) {
  const cookie = req.headers.cookie || "";
  const parts = cookie.split(";").map((v) => v.trim());
  for (const part of parts) {
    const [key, value] = part.split("=");
    if (key === name) return decodeURIComponent(value || "");
  }
  return "";
}

async function getActor(req) {
  const token = getCookie(req, "wooofpay_session");
  const session = sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    sessions.delete(token);
    return null;
  }
  const db = await readDb();
  const admin = db.admins.find((item) => item.id === session.adminId && item.isActive);
  return admin || null;
}

function requireActor(actor, res) {
  if (!actor) {
    sendJson(res, 401, { error: "로그인이 필요합니다." });
    return false;
  }
  return true;
}

// --- 메뉴 권한 -------------------------------------------------------------
//
// 메뉴를 여기 한 곳에만 등록하면 관리자 화면의 권한 표에 자동으로 나온다.
// 새 메뉴가 생길 때 권한 화면을 따로 고칠 필요가 없다.
//
// owner 는 항상 전권이라 저장된 값을 보지 않는다 — 잘못 저장해서 스스로를
// 잠그는 사고를 구조적으로 막는다.
//
// actions 는 그 메뉴에서 의미가 있는 것만 적는다. 이력처럼 읽기만 있는 곳에
// 쓰기·삭제 체크박스를 두면 무엇을 허용한 건지 알 수 없어진다.
const MENU_REGISTRY = [
  { key: "dashboard", label: "대시보드", actions: ["view"] },
  { key: "requests", label: "입금요청", actions: ["view", "create", "edit", "delete", "pay"] },
  { key: "prices", label: "단가표", actions: ["view", "create", "edit", "delete"] },
  { key: "brands", label: "브랜드", actions: ["view", "create", "edit", "delete"] },
  { key: "admins", label: "관리자", actions: ["view", "create", "edit", "delete"] },
  { key: "audits", label: "이력", actions: ["view"] },
  { key: "archive", label: "아카이브", actions: ["view", "edit"] },
  { key: "settlement", label: "정산", actions: ["view", "export"] },
  { key: "pipeline", label: "자동화", actions: ["view", "apply"] },
  { key: "reconcile", label: "클로브ai", actions: ["view", "apply"] },
  { key: "npb", label: "npb정산", actions: ["view", "edit"] }
];

const ACTION_LABELS = {
  view: "접근·읽기",
  create: "등록",
  edit: "수정",
  delete: "삭제",
  pay: "입금완료 처리",
  export: "정산서 출력",
  apply: "실행·반영"
};

// 권한을 손대기 전의 동작. manager 는 지금까지 owner 와 같았고 operator 는
// 연동 메뉴만 막혀 있었다 — 그대로 옮겨와야 이 기능을 켜는 것만으로 누군가의
// 권한이 조용히 바뀌지 않는다.
function defaultPermissions(role) {
  const all = {};
  for (const menu of MENU_REGISTRY) {
    if (role === "manager") {
      all[menu.key] = [...menu.actions];
      continue;
    }
    // operator 등 그 외 등급은 권한 기능을 켜기 전과 똑같이 둔다.
    // 연동 메뉴는 막혀 있었고, 관리자 메뉴는 목록 조회만 열려 있었다
    // (GET /api/admins 에는 검사가 없었고 생성·수정·삭제만 막혀 있었다).
    if (menu.key === "reconcile" || menu.key === "pipeline") all[menu.key] = [];
    else if (menu.key === "admins") all[menu.key] = ["view"];
    else all[menu.key] = [...menu.actions];
  }
  return all;
}

function actorPermissions(actor) {
  if (!actor) return {};
  const stored = actor.permissions && typeof actor.permissions === "object" ? actor.permissions : null;
  return stored || defaultPermissions(actor.role);
}

function can(actor, menuKey, action = "view") {
  if (!actor) return false;
  if (actor.role === "owner") return true;
  const menu = MENU_REGISTRY.find((item) => item.key === menuKey);
  if (!menu || !menu.actions.includes(action)) return false;
  const granted = actorPermissions(actor)[menuKey];
  return Array.isArray(granted) && granted.includes(action);
}

function requirePermission(actor, res, menuKey, action, message) {
  if (can(actor, menuKey, action)) return true;
  const menu = MENU_REGISTRY.find((item) => item.key === menuKey);
  sendJson(res, 403, {
    error: message || `${menu?.label || menuKey} ${ACTION_LABELS[action] || action} 권한이 없습니다.`
  });
  return false;
}

// 저장 시 정규화: 등록되지 않은 메뉴·액션은 버린다. 메뉴가 사라졌는데 권한만
// 남아 도는 것을 막는다.
function sanitizePermissions(raw) {
  const clean = {};
  for (const menu of MENU_REGISTRY) {
    const given = Array.isArray(raw?.[menu.key]) ? raw[menu.key] : [];
    const actions = menu.actions.filter((action) => given.includes(action));
    // 하위 권한만 주고 접근을 안 주면 화면에 못 들어가 아무 의미가 없다.
    if (actions.length && !actions.includes("view")) actions.unshift("view");
    clean[menu.key] = actions;
  }
  return clean;
}

function finalDepositAmount(item) {
  return Math.max(0, Number(item.depositAmount || 0) - Number(item.creditUsedAmount || 0));
}

function brandSummary(db, brandId) {
  const requests = db.requests.filter((item) => item.brandId === brandId);
  const pending = requests.filter((item) => PENDING_STATUSES.includes(item.status)).length;
  const total = requests.reduce((sum, item) => sum + finalDepositAmount(item), 0);
  const liveRequests = requests.filter((item) => item.status !== "deleted");
  const receivableDeducted = liveRequests.reduce((sum, item) => sum + Number(item.receivableDeduction || 0), 0);
  const creditBalance = liveRequests.reduce(
    (sum, item) => sum + Number(item.overpaidAmount || 0) - Number(item.creditUsedAmount || 0),
    0
  );
  const brand = db.brands.find((item) => item.id === brandId);
  const receivableRemaining = Math.max(0, Number(brand?.receivableTotal || 0) - receivableDeducted);
  const latestCatalogCount = getLatestPriceCatalog(db, brandId).length;
  return { requestCount: requests.length, pendingCount: pending, totalAmount: total, receivableDeducted, receivableRemaining, creditBalance, latestCatalogCount };
}

function hydrateBrand(db, brand) {
  const activePromotions = getActivePromotionRules(db, brand.id);
  return {
    ...brand,
    ...brandSummary(db, brand.id),
    promotionSummary:
      activePromotions.length === 1
        ? `${activePromotions[0].name} (${number(activePromotions[0].commissionRate)}%)`
        : activePromotions.length > 1
          ? `${activePromotions.length}건 운영중`
          : ""
  };
}

function dashboard(db) {
  const activeRequests = db.requests.filter((item) => item.status !== "deleted");
  const realtimeRequests = activeRequests.filter((item) => item.settlementType !== "consignment" && item.status !== "consignment_unpaid");
  const pending = realtimeRequests.filter((item) => PENDING_STATUSES.includes(item.status));
  const paid = activeRequests.filter((item) => item.status === "paid");
  const consignmentUnpaid = activeRequests.filter((item) => item.status === "consignment_unpaid");
  const outstanding = activeRequests.filter((item) => item.status !== "paid");
  return {
    requestCount: outstanding.length,
    pendingCount: pending.length,
    paidCount: paid.length,
    totalPendingAmount: pending.reduce((sum, item) => sum + finalDepositAmount(item), 0),
    consignmentUnpaidCount: consignmentUnpaid.length,
    consignmentUnpaidAmount: consignmentUnpaid.reduce((sum, item) => sum + finalDepositAmount(item), 0),
    brandCount: db.brands.filter((item) => item.type === "brand").length,
    recentAudits: db.auditLogs.slice(0, 8),
    sourceRules: [
      "입금요청시트는 브랜드별 시트에서 미입금/지급대상 주문을 집계합니다.",
      "핵심 식별자는 주문번호, 원본 시트명, 원본 행 번호 조합입니다.",
      "선매입-채권은 제품매출 100%와 배송비를 입금 요청하고, 미공제 수수료를 채권액에서 차감합니다.",
      "선매입-일반(수수료)은 제품매출에서 계약 수수료를 차감하고 배송비를 더해 입금액을 계산합니다.",
      "선매입-일반(공급가)은 주문 품목의 공급가 합과 배송비를 입금액으로 계산합니다.",
      "위탁은 위탁-입금전 상태로 별도 필터링하고 실시간 대기금액 집계에서는 제외합니다."
    ]
  };
}

function sanitizeLineItems(raw) {
  const source =
    Array.isArray(raw) ? raw : typeof raw === "string" && raw.trim() ? (() => {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    })() : [];

  return source
    .map((item) => {
      const quantity = Math.max(1, number(item.quantity, 1));
      const unitSupplyPrice = number(item.unitSupplyPrice);
      const totalSupplyPrice = number(item.totalSupplyPrice, quantity * unitSupplyPrice);
      const originalPrice = number(item.originalPrice, number(item.consumerPrice));
      const discountPrice = number(item.discountPrice);
      // 현재판매가(unitSalePrice): explicit value if given, else 원판매가 - 할인가.
      const unitSalePrice = number(
        item.unitSalePrice,
        number(item.salePrice, Math.max(0, originalPrice - discountPrice))
      );
      const totalSaleAmount = number(item.totalSaleAmount, quantity * unitSalePrice);
      return {
        id: item.id || id("line"),
        priceEntryId: item.priceEntryId || "",
        itemCode: String(item.itemCode || "").trim(),
        itemName: String(item.itemName || "").trim(),
        spec: String(item.spec || "").trim(),
        unit: String(item.unit || "").trim(),
        quantity,
        unitSupplyPrice,
        totalSupplyPrice,
        originalPrice,
        discountPrice,
        unitSalePrice,
        totalSaleAmount,
        promotionRuleId: String(item.promotionRuleId || "").trim(),
        effectiveFrom: dateOnly(item.effectiveFrom),
        effectiveTo: dateOnly(item.effectiveTo)
      };
    })
    .filter((item) => item.itemCode || item.itemName);
}

function sanitizePromotionTargets(raw) {
  const source =
    Array.isArray(raw) ? raw : typeof raw === "string" && raw.trim() ? (() => {
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    })() : [];

  return source
    .map((item) => {
      const itemCode = String(item.itemCode || "").trim();
      const itemName = String(item.itemName || "").trim();
      return {
        itemCode,
        itemName,
        key: normalizeItemKey(itemCode, itemName),
        label: itemCode && itemName ? `${itemCode} | ${itemName}` : itemName || itemCode
      };
    })
    .filter((item) => item.key !== "::");
}

function getLatestPriceCatalog(db, brandId = "") {
  const today = now().slice(0, 10);
  const grouped = new Map();
  for (const entry of (db.priceEntries || []).filter((item) => item.isActive !== false)) {
    if (brandId && entry.brandId !== brandId) continue;
    if (entry.effectiveTo && entry.effectiveTo < today) continue;
    const key = `${entry.brandId}::${normalizeItemKey(entry.itemCode, entry.itemName)}`;
    const current = grouped.get(key);
    const currentDate = current?.effectiveFrom || "";
    const nextDate = entry.effectiveFrom || "";
    if (!current || nextDate > currentDate || (nextDate === currentDate && entry.updatedAt > current.updatedAt)) {
      grouped.set(key, entry);
    }
  }
  return Array.from(grouped.values())
    .sort((a, b) =>
      a.brandId === b.brandId
        ? String(a.itemName || a.itemCode).localeCompare(String(b.itemName || b.itemCode), "ko")
        : String(a.brandId).localeCompare(String(b.brandId), "ko")
    )
    .map((entry) => ({
      ...entry,
      ...normalizePriceFields(entry),
      latestSupplyPrice: number(entry.supplyPrice),
      key: normalizeItemKey(entry.itemCode, entry.itemName)
    }));
}

function isAliasActive(alias, onDate = "") {
  const targetDate = dateOnly(onDate) || now().slice(0, 10);
  const from = dateOnly(alias.validFrom) || "0000-01-01";
  const to = dateOnly(alias.validTo) || "9999-12-31";
  return alias.isActive !== false && from <= targetDate && targetDate <= to;
}

function getActivePriceAliases(db, brandId = "", onDate = "") {
  return (db.priceAliases || [])
    .filter((alias) => (!brandId || alias.brandId === brandId) && isAliasActive(alias, onDate))
    .sort((a, b) => (b.validFrom || "").localeCompare(a.validFrom || "") || b.updatedAt.localeCompare(a.updatedAt));
}

function rangesOverlap(fromA = "", toA = "", fromB = "", toB = "") {
  const startA = dateOnly(fromA) || "0000-01-01";
  const endA = dateOnly(toA) || "9999-12-31";
  const startB = dateOnly(fromB) || "0000-01-01";
  const endB = dateOnly(toB) || "9999-12-31";
  return startA <= endB && startB <= endA;
}

function priceAliasWithRefs(db, alias) {
  const brand = db.brands.find((item) => item.id === alias.brandId);
  const target = (db.priceEntries || []).find((item) => item.id === alias.priceEntryId);
  return {
    ...alias,
    brandName: brand?.name || "",
    targetItemCode: target?.itemCode || "",
    targetItemName: target?.itemName || ""
  };
}

function priceEntryWithBrand(db, entry) {
  const brand = db.brands.find((item) => item.id === entry.brandId);
  return {
    ...entry,
    ...normalizePriceFields(entry),
    brandName: brand?.name || "",
    latest: getLatestPriceCatalog(db, entry.brandId).some((item) => item.id === entry.id)
  };
}

// 목록을 한 번에 변환할 때 쓴다.
//
// 항목마다 priceEntryWithBrand 를 부르면 그 안에서 단가표 전체를 다시 훑고
// 정렬한다 — 463개면 463번이고, 그 사이 이벤트 루프가 멈춰 동시에 처리 중인
// 다른 응답까지 전부 대기한다. "최신" 판정과 브랜드 조회를 한 번만 만들어 쓴다.
// 그룹 키에 brandId 가 들어 있어 전체 기준 최신 집합은 브랜드별 결과와 같다.
function priceEntriesWithBrand(db, entries) {
  const brandById = new Map((db.brands || []).map((brand) => [brand.id, brand]));
  const latestIds = new Set(getLatestPriceCatalog(db).map((item) => item.id));
  return entries.map((entry) => ({
    ...entry,
    ...normalizePriceFields(entry),
    brandName: brandById.get(entry.brandId)?.name || "",
    latest: latestIds.has(entry.id)
  }));
}

function applyImportedPriceWorkbook(db, actor, brand, rows) {
  const nextDb = structuredClone(db);
  const result = { created: 0, updated: 0, revised: 0, deleted: 0, skipped: 0 };
  const errors = [];

  for (const row of rows) {
    const action = normalizeImportedAction(row);
    if (row.brandName && row.brandName !== brand.name) {
      errors.push(`${row.rowNumber}행: 브랜드명이 선택한 브랜드와 다릅니다.`);
      continue;
    }
    if (action === "delete") {
      if (!row.entryId) {
        errors.push(`${row.rowNumber}행: 삭제는 entryId가 필요합니다.`);
        continue;
      }
      const linkedAlias = (nextDb.priceAliases || []).find((item) => item.priceEntryId === row.entryId && item.isActive !== false);
      if (linkedAlias) {
        errors.push(`${row.rowNumber}행: 참조 중인 품목 별칭이 있어 삭제할 수 없습니다.`);
        continue;
      }
      const index = (nextDb.priceEntries || []).findIndex((item) => item.id === row.entryId && item.brandId === brand.id);
      if (index === -1) {
        errors.push(`${row.rowNumber}행: 삭제할 단가 이력을 찾지 못했습니다.`);
        continue;
      }
      nextDb.priceEntries.splice(index, 1);
      result.deleted += 1;
      continue;
    }

    const itemCode = String(row.itemCode || "").trim();
    const itemName = String(row.itemName || "").trim();
    if (!itemCode && !itemName) {
      result.skipped += 1;
      continue;
    }

    const payload = {
      brandId: brand.id,
      itemCode,
      itemName,
      spec: String(row.spec || "").trim(),
      unit: String(row.unit || "").trim(),
      barcode: String(row.barcode || "").trim(),
      supplyPrice: number(row.supplyPrice),
      ...normalizePriceFields({
        originalPrice: row.originalPrice,
        consumerPrice: row.consumerPrice,
        discountPrice: row.discountPrice,
        salePrice: row.salePrice
      }),
      effectiveFrom: dateOnly(row.effectiveFrom) || now().slice(0, 10),
      effectiveTo: dateOnly(row.effectiveTo) || "",
      note: String(row.note || "").trim(),
      isActive: row.isActive !== false && row.isActive !== "false"
    };

    if (action === "revise") {
      nextDb.priceEntries.unshift({
        id: id("price"),
        ...payload,
        createdAt: now(),
        updatedAt: now()
      });
      result.revised += 1;
      continue;
    }

    let target = null;
    if (row.entryId) {
      target = (nextDb.priceEntries || []).find((item) => item.id === row.entryId && item.brandId === brand.id) || null;
      if (!target && action === "update") {
        errors.push(`${row.rowNumber}행: 수정할 단가 이력을 찾지 못했습니다.`);
        continue;
      }
    }
    if (!target) {
      target = (nextDb.priceEntries || []).find((item) =>
        item.brandId === brand.id &&
        normalizeItemKey(item.itemCode, item.itemName) === normalizeItemKey(payload.itemCode, payload.itemName) &&
        (item.effectiveFrom || "") === payload.effectiveFrom
      ) || null;
    }

    if (target) {
      const changed = Object.entries(payload).some(([key, value]) => {
        if (typeof value === "number") return number(target[key]) !== number(value);
        return String(target[key] || "") !== String(value || "");
      });
      if (changed) {
        Object.assign(target, payload, { updatedAt: now() });
        result.updated += 1;
      } else {
        result.skipped += 1;
      }
    } else {
      nextDb.priceEntries.unshift({
        id: id("price"),
        ...payload,
        createdAt: now(),
        updatedAt: now()
      });
      result.created += 1;
    }
  }

  if (errors.length) {
    return { ok: false, errors };
  }

  addAudit(
    nextDb,
    actor,
    "bulk_import",
    "price_entry",
    brand.id,
    `${brand.name} 단가표 Excel 반영`,
    null,
    { brandId: brand.id, ...result }
  );
  return { ok: true, db: nextDb, result };
}

function calculateSettlement(input, brand = {}) {
  const lineItems = sanitizeLineItems(input.lineItems);
  const settlementType = settlementTypes.has(input.settlementType)
    ? input.settlementType
    : settlementTypes.has(brand.settlementType)
      ? brand.settlementType
      : "prepay_fee";
  const productSalesAmount = number(input.productSalesAmount, number(input.depositAmount));
  const derivedProductSalesAmount = lineItems.reduce((sum, item) => sum + number(item.totalSaleAmount), 0);
  const effectiveProductSalesAmount = derivedProductSalesAmount > 0 ? derivedProductSalesAmount : productSalesAmount;
  const derivedSupplyAmount = lineItems.reduce((sum, item) => sum + number(item.totalSupplyPrice), 0);
  const supplyAmount = lineItems.length ? derivedSupplyAmount : number(input.supplyAmount);
  // 배송비 기준금액: 브랜드 설정에 따라 제품매출 또는 공급가 합계로 임계 판정.
  const shippingBase = shippingThresholdBaseAmount(brand, {
    salesAmount: effectiveProductSalesAmount,
    supplyAmount
  });
  const baseShippingFee = number(input.baseShippingFee, calculateBaseShippingFee(brand, shippingBase));
  const extraShippingFee = number(input.extraShippingFee);
  const shippingFee = baseShippingFee + extraShippingFee;
  const promotionContext = input._promotionContext || null;
  // When line items are present, the promotion context already aggregated the
  // per-line discount (each line may carry its own rule); use it directly.
  // Otherwise fall back to the order-level discount from the brand-wide rule.
  const discountAmount = Number.isFinite(promotionContext?.discountAmount)
    ? number(promotionContext.discountAmount)
    : computeDiscountAmount(promotionContext, effectiveProductSalesAmount);
  const adjustedProductSales = Math.max(0, effectiveProductSalesAmount - discountAmount);
  const commissionRate = promotionContext ? number(promotionContext.commissionRate) : number(input.commissionRate, number(brand.commissionRate));
  const commissionAmount = Number.isFinite(promotionContext?.commissionAmount)
    ? number(promotionContext.commissionAmount)
    : Math.round(adjustedProductSales * (commissionRate / 100));
  const hasReceivable = input.hasReceivable === true || input.hasReceivable === "true" || brand.hasReceivable || settlementType === "prepay_debt";
  const receivableMargin = Math.max(0, adjustedProductSales - supplyAmount - (settlementType === "prepay_supply" && hasReceivable ? baseShippingFee : 0));

  let depositAmount = number(input.depositAmount);
  if (settlementType === "prepay_debt") {
    depositAmount = adjustedProductSales + shippingFee;
  } else if (settlementType === "prepay_supply") {
    depositAmount = hasReceivable ? adjustedProductSales + extraShippingFee : supplyAmount + shippingFee;
  } else if (settlementType === "direct_purchase") {
    depositAmount = adjustedProductSales + shippingFee;
  } else if (settlementType === "prepay_fee" || settlementType === "consignment") {
    depositAmount = adjustedProductSales - commissionAmount + shippingFee;
  }

  const isDirect = settlementType === "direct_purchase";
  return {
    settlementType,
    productSalesAmount: effectiveProductSalesAmount,
    baseShippingFee,
    extraShippingFee,
    extraShippingNote: String(input.extraShippingNote || "").trim(),
    shippingFee,
    promotionRuleId: isDirect ? "" : (promotionContext?.primaryRuleId || ""),
    promotionRuleName: isDirect ? "" : (promotionContext?.name || ""),
    appliedPromotionRules: isDirect ? [] : (promotionContext?.appliedRules || []),
    commissionRate: isDirect ? 0 : commissionRate,
    commissionAmount: isDirect ? 0 : commissionAmount,
    supplyAmount: isDirect ? 0 : supplyAmount,
    depositAmount,
    receivableDeduction: isDirect ? 0 : (hasReceivable ? (settlementType === "prepay_supply" ? receivableMargin : Math.round(effectiveProductSalesAmount * number(brand.commissionRate) / 100) + Math.round(number(input.cancelledAmount) * (1 - number(brand.commissionRate) / 100))) : 0),
    lineItems: isDirect ? [] : lineItems
  };
}

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replaceAll("\"", "\"\"")}"`;
  return text;
}

function requestRows(db, brandId = "") {
  return db.requests
    .filter((item) => !brandId || item.brandId === brandId)
    .filter((item) => item.status !== "deleted")
    .slice()
    .sort((a, b) => String(a.orderNo || "").localeCompare(String(b.orderNo || ""), "en", { numeric: true }))
    .map((item) => {
      const brand = db.brands.find((b) => b.id === item.brandId);
      return {
        brand: item.brandName || brand?.name || "",
        settlementType: item.settlementType,
        orderNo: item.orderNo,
        customerName: item.customerName,
        lineItemsSummary: sanitizeLineItems(item.lineItems).map((line) => `${line.itemName || line.itemCode} x${line.quantity}`).join(", "),
        depositAmount: item.depositAmount,
        expectedDepositDate: item.expectedDepositDate,
        cutoffNote: item.cutoffNote,
        sourceSheet: item.sourceSheet,
        sourceRow: item.sourceRow,
        requiredMemo: item.requiredMemo,
        productSalesAmount: item.productSalesAmount,
        shippingFee: item.shippingFee,
        baseShippingFee: item.baseShippingFee,
        extraShippingFee: item.extraShippingFee,
        extraShippingNote: item.extraShippingNote,
        promotionRuleName: item.promotionRuleName,
        appliedPromotionRulesSummary: Array.isArray(item.appliedPromotionRules)
          ? item.appliedPromotionRules.map((rule) => rule.name).filter(Boolean).join(", ")
          : "",
        commissionRate: item.commissionRate,
        commissionAmount: item.commissionAmount,
        supplyAmount: item.supplyAmount,
        receivableDeduction: item.receivableDeduction,
        businessName: item.businessName,
        businessNumber: item.businessNumber,
        depositorName: item.depositorName,
        status: item.status,
        paidAmount: item.paidAmount,
        paidAt: item.paidAt
      };
    });
}

const exportColumns = [
  ["brand", "브랜드"],
  ["settlementType", "정산유형"],
  ["orderNo", "주문번호"],
  ["customerName", "주문자명"],
  ["productSalesAmount", "제품매출"],
  ["lineItemsSummary", "품목"],
  ["shippingFee", "배송비"],
  ["promotionRuleName", "적용 프로모션"],
  ["appliedPromotionRulesSummary", "적용 프로모션 상세"],
  ["commissionRate", "수수료율"],
  ["commissionAmount", "수수료"],
  ["supplyAmount", "공급가합"],
  ["depositAmount", "업체 실 입금액"],
  ["receivableDeduction", "채권차감액"],
  ["expectedDepositDate", "입금(예정)일자"],
  ["cutoffNote", "출고마감시간"],
  ["sourceSheet", "원본 시트"],
  ["sourceRow", "행 번호"],
  ["requiredMemo", "필수 메모 및 계좌번호 확인 (필요시)"],
  ["businessName", "사업자명"],
  ["businessNumber", "사업자번호"],
  ["depositorName", "계좌예금주명"],
  ["status", "상태"],
  ["paidAmount", "실입금액"],
  ["paidAt", "입금일"]
];

function toCsv(rows) {
  return [
    exportColumns.map(([, label]) => csvEscape(label)).join(","),
    ...rows.map((row) => exportColumns.map(([key]) => csvEscape(row[key])).join(","))
  ].join("\n");
}

function toExcelHtml(rows, title) {
  const head = exportColumns.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join("");
  const body = rows
    .map((row) => {
      const cells = exportColumns.map(([key]) => `<td>${escapeHtml(row[key] ?? "")}</td>`).join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(
    title
  )}</title></head><body><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`;
}

const paymentLogColumns = [
  ["loggedAt", "처리시각"],
  ["paidAt", "입금일"],
  ["brandName", "브랜드"],
  ["orderNo", "주문번호"],
  ["customerName", "주문자명"],
  ["depositAmount", "요청입금액"],
  ["paidAmount", "실입금액"],
  ["actorName", "처리자"],
  ["mode", "처리방식"],
  ["requestId", "요청ID"],
  ["batchId", "배치ID"]
];

function paymentLogRows(db) {
  return (db.paymentLogs || []).map((item) => ({
    loggedAt: item.loggedAt,
    paidAt: item.paidAt,
    brandName: item.brandName,
    orderNo: item.orderNo,
    customerName: item.customerName,
    depositAmount: item.depositAmount,
    paidAmount: item.paidAmount,
    actorName: item.actorName,
    mode: item.mode,
    requestId: item.requestId,
    batchId: item.batchId || ""
  }));
}

function toCsvWithColumns(rows, columns) {
  return [
    columns.map(([, label]) => csvEscape(label)).join(","),
    ...rows.map((row) => columns.map(([key]) => csvEscape(row[key])).join(","))
  ].join("\n");
}

function toExcelHtmlWithColumns(rows, columns, title) {
  const head = columns.map(([, label]) => `<th>${escapeHtml(label)}</th>`).join("");
  const body = rows
    .map((row) => {
      const cells = columns.map(([key]) => `<td>${escapeHtml(row[key] ?? "")}</td>`).join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body><table border="1"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`;
}

function buildArchivePayload(db, brandId = "") {
  const brand = brandId ? db.brands.find((item) => item.id === brandId) : null;
  const rows = requestRows(db, brandId);
  return {
    archiveName: brand ? `${brand.name} 입금요청 아카이브` : "전체 입금요청 아카이브",
    brandId: brand?.id || "",
    brandName: brand?.name || "전체",
    rows,
    columns: exportColumns.map(([key, label]) => ({ key, label })),
    sentAt: now()
  };
}

async function syncArchive(db, actor, brandId = "", reason = "manual") {
  const brand = brandId ? db.brands.find((item) => item.id === brandId) : null;
  const payload = buildArchivePayload(db, brandId);
  let webhookResult = null;
  if (process.env.GOOGLE_APPS_SCRIPT_WEBHOOK_URL) {
    try {
      const response = await fetch(process.env.GOOGLE_APPS_SCRIPT_WEBHOOK_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, reason })
      });
      webhookResult = { status: response.status, body: await response.text() };
    } catch (error) {
      webhookResult = { status: 0, body: error.message };
    }
  }
  const archive = {
    id: id("archive"),
    brandId: brand?.id || "",
    brandName: brand?.name || "전체",
    rowCount: payload.rows.length,
    googleSheetUrl: brand?.googleSheetUrl || "",
    webhookEnabled: Boolean(process.env.GOOGLE_APPS_SCRIPT_WEBHOOK_URL),
    webhookResult,
    reason,
    createdAt: now()
  };
  db.archiveHistory.unshift(archive);
  db.archiveHistory = db.archiveHistory.slice(0, 200);
  addAudit(db, actor, "archive", "google_sheet", archive.id, `${archive.brandName} 아카이브 동기화`, null, archive);
  return { archive, payload };
}

// Fire-and-forget archive sync: keeps the slow Google Sheet webhook off the
// HTTP critical path. The primary mutation is already persisted by the handler
// before this runs; here we sync each affected brand then persist the archive
// records in one extra write. Errors are logged, never surfaced to the client.
function syncArchiveInBackground(db, actor, brandIds, reason) {
  const ids = (Array.isArray(brandIds) ? brandIds : [brandIds]).filter(Boolean);
  if (!ids.length) return;
  (async () => {
    try {
      for (const brandId of ids) {
        await syncArchive(db, actor, brandId, reason);
      }
      await writeDb(db);
    } catch (error) {
      console.error("background archive sync failed", error);
    }
  })();
}

function addPaymentLog(db, actor, request, { paidAt, paidAmount, mode = "single", batchId = "" }) {
  db.paymentLogs.unshift({
    id: id("paylog"),
    requestId: request.id,
    brandId: request.brandId,
    brandName: request.brandName,
    orderNo: request.orderNo,
    customerName: request.customerName,
    depositAmount: number(request.depositAmount),
    paidAmount: number(paidAmount, number(request.depositAmount)),
    paidAt: paidAt || "",
    actorId: actor?.id || "system",
    actorName: actor?.name || "System",
    mode,
    batchId,
    loggedAt: now()
  });
  db.paymentLogs = db.paymentLogs.slice(0, 5000);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
}

function contentDisposition(filename) {
  return `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

// --- Clobe (클로브ai) MCP integration -------------------------------------

// In-flight authorization attempts. Deliberately not persisted: a PKCE verifier
// is single-use and short-lived, and a server restart mid-login should just
// make the user click connect again rather than leave a usable secret on disk.
const clobePendingAuth = new Map();
const CLOBE_AUTH_TTL_MS = 10 * 60 * 1000;

// WooofPay only ever settles 주식회사 우프컴퍼니. The clobe account can also see
// 베럴즈/엘브이더블유/픽키파크, so the company is pinned by business number —
// stable across renames, and it keeps another company's banking out of reach.
const CLOBE_COMPANY_BIZ_NO = "3148700725";

function clobePickCompany(companies) {
  return (companies || []).find((item) => String(item.businessRegNo || "") === CLOBE_COMPANY_BIZ_NO) || null;
}

function clobeRedirectUri(req) {
  const configured = String(process.env.PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
  if (configured) return `${configured}/api/clobe/callback`;
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const host = req.headers["x-forwarded-host"] || req.headers.host || `localhost:${PORT}`;
  const proto = forwardedProto || (/^localhost|^127\.0\.0\.1/.test(String(host)) ? "http" : "https");
  return `${proto}://${host}/api/clobe/callback`;
}

function clobeIsConnected(db) {
  return Boolean(db.clobe?.refreshToken && db.clobe?.clientId);
}

// Returns a usable access token, refreshing and persisting when the stored one
// is at or near expiry. clobe has no client_credentials grant, so if the
// refresh token itself is rejected the only fix is a human re-login.
async function clobeAccessToken(db) {
  const state = db.clobe;
  if (!clobeIsConnected(db)) throw new Error("클로브가 연결되지 않았습니다. 먼저 연결하세요.");
  const expiresAt = state.expiresAt ? new Date(state.expiresAt).getTime() : 0;
  if (state.accessToken && expiresAt - Date.now() > 60000) {
    return clobe.openSecret(state.accessToken);
  }
  let tokens;
  try {
    tokens = await clobe.refreshTokens({
      clientId: state.clientId,
      refreshToken: clobe.openSecret(state.refreshToken)
    });
  } catch (error) {
    const failure = new Error(`클로브 재인증이 필요합니다: ${error.message}`);
    failure.needsReauth = true;
    throw failure;
  }
  state.accessToken = clobe.sealSecret(tokens.accessToken);
  if (tokens.refreshToken) state.refreshToken = clobe.sealSecret(tokens.refreshToken);
  state.expiresAt = tokens.expiresAt;
  await writeDb(db);
  return tokens.accessToken;
}

async function clobeCall(db, tool, input) {
  const accessToken = await clobeAccessToken(db);
  return clobe.callTool(accessToken, tool, input);
}

// Pulls every bank transaction in the range, following the keyset cursor.
// Capped so a wide date range can't spin forever. Omit direction for both ways.
async function clobeFetchTransactions(db, { startDate, endDate, direction = null }) {
  if (!clobeIsConnected(db)) throw new Error("클로브가 연결되지 않았습니다. 먼저 연결하세요.");
  const companyId = db.clobe.companyId;
  if (!companyId) throw new Error("대사 대상 회사를 먼저 선택하세요.");
  const collected = [];
  let cursor = null;
  for (let page = 0; page < 20; page += 1) {
    const payload = await clobeCall(db, "get_labeled_transactions", {
      companyId,
      startDate,
      endDate,
      size: 100,
      ...(direction ? { direction } : {}),
      ...(cursor ? { cursor } : {})
    });
    collected.push(...(payload.content || []));
    if (!payload.hasNext || !payload.nextCursor) break;
    cursor = payload.nextCursor;
  }
  return collected;
}

// Adapts clobe transactions to the Korean-keyed row shape the settlement
// engine already expects from an uploaded bank XLSX, so computeSettlementResult
// works identically whether the data came from a file or from clobe.
// Mirrors the columns read by bankBrandMovements/bankRowMatchesBrand.
function clobeRowsToBankRows(transactions, accountIds = []) {
  const allowed = accountIds.length ? new Set(accountIds.map(Number)) : null;
  return transactions
    .filter((tx) => !allowed || allowed.has(Number(tx.accountId)))
    .map((tx) => {
      const at = String(tx.transactionAt || "");
      return {
        "거래 연도": Number(at.slice(0, 4)) || 0,
        "거래 월": Number(at.slice(5, 7)) || 0,
        "거래일시": at.replace("T", " "),
        "출금": Number(tx.outAmount || 0),
        "입금": Number(tx.inAmount || 0),
        "적요": tx.transactionDescription || "",
        "거래자명": tx.transactionName || "",
        "거래처 라벨": tx.businessEntityName || tx.customLabel || tx.category || ""
      };
    });
}

// Settlement pulls a wider range than the settlement month itself: brands that
// pay after delivery routinely cross the month boundary, and the engine
// deliberately searches the whole dataset rather than just the target month.
function clobeSettlementRange(year, month) {
  const start = new Date(Date.UTC(Number(year), Number(month) - 1, 1));
  start.setUTCMonth(start.getUTCMonth() - 1);
  const end = new Date(Date.UTC(Number(year), Number(month) + 1, 0));
  const today = new Date();
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: (end > today ? today : end).toISOString().slice(0, 10)
  };
}

// Orders come either from an uploaded export or straight from Cafe24. The API
// path deliberately does not filter by supplier: the engine needs every
// supplier in the month to offer the 공급사 매핑 list, and it narrows to the
// brand itself anyway — same shape as the "월 전체 공급사 포함" export.
// 실패한 갈래를 알려주지 않으면 어디를 손봐야 할지 알 수 없다.
function settlementSourceError(body, error) {
  if (error.status === 403) return error.message;
  if (body.useCafe24 && /카페24/.test(error.message)) return `카페24 주문 조회 실패: ${error.message}`;
  if (body.useClobe && /클로브/.test(error.message)) return `클로브 은행내역 조회 실패: ${error.message}`;
  return `데이터 준비 실패: ${error.message}`;
}

async function settlementOrderRows(db, body, actor, brand) {
  if (body.useCafe24) {
    if (!can(actor, "pipeline", "view")) {
      const error = new Error("카페24 주문 조회 권한이 없습니다.");
      error.status = 403;
      throw error;
    }
    const pad = (n) => String(n).padStart(2, "0");
    const startDate = `${body.year}-${pad(body.month)}-01`;
    const endDate = new Date(Date.UTC(Number(body.year), Number(body.month), 0)).toISOString().slice(0, 10);
    // 정산이 그 달로 묶는 기준과 같은 날짜로 조회해야 범위가 어긋나지 않는다.
    const dateType = brandSettlementDateBasis(brand) === "delivered" ? "shipend_date" : "order_date";
    const orders = await withCafe24Token(db, (token) =>
      cafe24.fetchOrders(token, { startDate, endDate, dateType }));
    db.cafe24.lastSyncAt = now();
    return {
      rows: cafe24OrdersToRows(orders),
      source: "cafe24",
      range: { startDate, endDate, dateType },
      orderCount: orders.length
    };
  }
  return { rows: body.cafe24Csv ? parseCafe24Csv(body.cafe24Csv) : [], source: "upload", range: null };
}

// Shared by /api/settlement/run and /api/settlement/export so the exported
// workbook is computed from exactly the same bank data as the preview.
async function settlementBankRows(db, body, actor) {
  if (body.useClobe) {
    if (!can(actor, "reconcile", "view")) {
      const error = new Error("클로브 은행내역 조회 권한이 없습니다.");
      error.status = 403;
      throw error;
    }
    const range = clobeSettlementRange(body.year, body.month);
    const transactions = await clobeFetchTransactions(db, range);
    return { rows: clobeRowsToBankRows(transactions, db.clobe?.accountIds || []), source: "clobe", range };
  }
  if (body.bankXlsx) {
    return { rows: await parseBankXlsxUpload(body.bankXlsx), source: "upload", range: null };
  }
  return { rows: [], source: "none", range: null };
}

function clobePublicState(db) {
  const state = db.clobe || {};
  return {
    connected: clobeIsConnected(db),
    companyId: state.companyId || "",
    companyName: state.companyName || "",
    accountIds: state.accountIds || [],
    windowDays: Number(state.windowDays || 7),
    connectedBy: state.connectedBy || "",
    connectedAt: state.connectedAt || "",
    lastSyncAt: state.lastSyncAt || "",
    encryptedAtRest: clobe.tokenEncryptionEnabled()
  };
}

// 초안을 브랜드 규칙으로 계산한다. 화면에서 만드는 입금요청과 같은 경로를
// 쓰므로, 자동 수집분과 수기 입력분의 금액 산출이 갈리지 않는다.
function priceDraft(db, draft) {
  const brand = db.brands.find((item) => item.id === draft.brandId) || {};
  const promotionContext = buildPromotionContext(db, brand, sanitizeLineItems(draft.lineItems), "");
  const calc = calculateSettlement({ lineItems: draft.lineItems, _promotionContext: promotionContext }, brand);
  return {
    depositAmount: calc.depositAmount,
    productSalesAmount: calc.productSalesAmount,
    baseShippingFee: calc.baseShippingFee,
    commissionRate: calc.commissionRate,
    commissionAmount: calc.commissionAmount,
    settlementType: calc.settlementType,
    // 카페24가 청구한 배송비와 브랜드 규칙이 다르면 확인 단계에서 보여준다.
    shippingMismatch: Math.abs(number(calc.baseShippingFee) - number(draft.cafe24ShippingFee)) > 1
  };
}

function buildRequestFromDraft(db, brand, draft) {
  const promotionContext = buildPromotionContext(db, brand, sanitizeLineItems(draft.lineItems), "");
  const calc = calculateSettlement({ lineItems: draft.lineItems, _promotionContext: promotionContext }, brand);
  return {
    id: id("req"),
    brandId: brand.id,
    brandName: brand.name,
    orderNo: String(draft.orderNo || "").trim(),
    customerName: String(draft.customerName || "").trim(),
    depositAmount: calc.depositAmount,
    productSalesAmount: calc.productSalesAmount,
    baseShippingFee: calc.baseShippingFee,
    extraShippingFee: 0,
    extraShippingNote: "",
    shippingFee: calc.shippingFee,
    promotionRuleId: calc.promotionRuleId,
    promotionRuleName: calc.promotionRuleName,
    appliedPromotionRules: calc.appliedPromotionRules,
    commissionRate: calc.commissionRate,
    commissionAmount: calc.commissionAmount,
    supplyAmount: calc.supplyAmount,
    receivableDeduction: calc.receivableDeduction,
    settlementType: calc.settlementType,
    lineItems: calc.lineItems,
    expectedDepositDate: "",
    cutoffNote: brand.cutoffNote || "",
    sourceSheet: "카페24 자동수집",
    sourceRow: 0,
    requiredMemo: brand.requiredMemo || "",
    businessName: brand.businessName || "",
    businessNumber: brand.businessNumber || "",
    depositorName: brand.depositorName || "",
    // 출고후입금 브랜드는 송장이 찍히기 전까지 입금대기로 둔다.
    status: brand.payAfterShipping === true ? "await_deposit" : "pending",
    paidAmount: "",
    paidAt: "",
    notes: "",
    quantity: (draft.lineItems || []).reduce((sum, line) => sum + number(line.quantity), 0),
    priorPaidAmount: 0,
    priorPaidNote: "",
    cancelledAmount: 0,
    cancelledReason: "",
    cancelledNote: "",
    overpaidAmount: 0,
    overpaidReason: "",
    overpaidNote: "",
    creditUsedAmount: 0,
    creditUsedNote: "",
    source: "cafe24_auto",
    cafe24ShippingFee: number(draft.cafe24ShippingFee),
    createdAt: now(),
    updatedAt: now()
  };
}

// --- Cafe24 Admin API integration ---------------------------------------

const cafe24PendingAuth = new Map();

function cafe24RedirectUri(req) {
  const configured = String(process.env.PUBLIC_BASE_URL || "").trim().replace(/\/$/, "");
  if (configured) return `${configured}/api/cafe24/callback`;
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim();
  const host = req.headers["x-forwarded-host"] || req.headers.host || `localhost:${PORT}`;
  const proto = forwardedProto || (/^localhost|^127\.0\.0\.1/.test(String(host)) ? "http" : "https");
  return `${proto}://${host}/api/cafe24/callback`;
}

function cafe24IsConnected(db) {
  return Boolean(db.cafe24?.refreshToken);
}

// Cafe24's refresh token lives 2 weeks. Once it lapses there is no automated
// recovery — say so plainly instead of retrying.
async function cafe24AccessToken(db, { force = false } = {}) {
  const state = db.cafe24;
  if (!cafe24IsConnected(db)) throw new Error("카페24가 연결되지 않았습니다. 먼저 연결하세요.");
  const expiresAt = state.expiresAt ? new Date(state.expiresAt).getTime() : 0;
  if (!force && state.accessToken && expiresAt - Date.now() > 60000) {
    return clobe.openSecret(state.accessToken);
  }
  let tokens;
  try {
    tokens = await cafe24.refreshTokens({ refreshToken: clobe.openSecret(state.refreshToken) });
  } catch (error) {
    const failure = new Error(`카페24 재연결이 필요합니다 (갱신 토큰 만료 가능): ${error.message}`);
    failure.needsReauth = true;
    throw failure;
  }
  state.accessToken = clobe.sealSecret(tokens.accessToken);
  if (tokens.refreshToken) state.refreshToken = clobe.sealSecret(tokens.refreshToken);
  state.expiresAt = tokens.expiresAt;
  state.refreshTokenExpiresAt = tokens.refreshTokenExpiresAt || state.refreshTokenExpiresAt;
  await writeDb(db);
  return tokens.accessToken;
}

// 만료 시각 판정이 어긋나도 서비스가 멈추지 않도록, invalid_token 이면 한 번
// 강제로 갱신하고 다시 시도한다. 카페24가 오프셋 없는 현지시각을 주기 때문에
// 시계 해석이 틀어질 여지가 늘 있다.
async function withCafe24Token(db, run) {
  const token = await cafe24AccessToken(db);
  try {
    return await run(token);
  } catch (error) {
    const looksExpired = error.status === 401 || /invalid_token|expired/i.test(String(error.message || ""));
    if (!looksExpired) throw error;
    const fresh = await cafe24AccessToken(db, { force: true });
    return run(fresh);
  }
}

function cafe24PublicState(db) {
  const state = db.cafe24 || {};
  const config = cafe24.cafe24Config();
  return {
    configured: cafe24.cafe24Configured(),
    connected: cafe24IsConnected(db),
    mallId: state.mallId || config.mallId || "",
    connectedBy: state.connectedBy || "",
    connectedAt: state.connectedAt || "",
    lastSyncAt: state.lastSyncAt || "",
    refreshTokenExpiresAt: state.refreshTokenExpiresAt || ""
  };
}

async function routeApi(req, res, url) {
  const pathname = url.pathname;
  const method = req.method || "GET";

  if (pathname === "/api/login" && method === "POST") {
    const body = await readBody(req);
    const db = await readDb();
    const admin = db.admins.find(
      (item) => item.email.toLowerCase() === String(body.email || "").toLowerCase() && item.isActive
    );
    if (!admin || !verifyPassword(body.password || "", admin.passwordHash)) {
      sendJson(res, 401, { error: "이메일 또는 비밀번호가 올바르지 않습니다." });
      return;
    }
    const token = crypto.randomBytes(24).toString("hex");
    sessions.set(token, { adminId: admin.id, expiresAt: Date.now() + SESSION_TTL_MS });
    addAudit(db, admin, "login", "admin", admin.id, "관리자 로그인", null, publicAdmin(admin));
    await writeDb(db);
    sendJson(res, 200, { admin: publicAdmin(admin) }, {
      "set-cookie": `wooofpay_session=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_MS / 1000}`
    });
    return;
  }

  if (pathname === "/api/logout" && method === "POST") {
    const token = getCookie(req, "wooofpay_session");
    sessions.delete(token);
    sendJson(res, 200, { ok: true }, {
      "set-cookie": "wooofpay_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0"
    });
    return;
  }

  if (pathname.startsWith("/api/public/brand/") && method === "GET") {
    const token = decodeURIComponent(pathname.split("/").pop() || "");
    const db = await readDb();
    const brand = db.brands.find((item) => item.shareToken === token && item.isActive);
    if (!brand) {
      sendJson(res, 404, { error: "공유 링크를 찾을 수 없습니다." });
      return;
    }
    sendJson(res, 200, {
      brand: hydrateBrand(db, brand),
      requests: db.requests.filter((item) => item.brandId === brand.id && item.status !== "deleted")
    });
    return;
  }

  const actor = await getActor(req);
  if (pathname === "/api/session" && method === "GET") {
    sendJson(res, 200, { admin: actor ? publicAdmin(actor) : null });
    return;
  }
  if (pathname === "/api/health" && method === "GET") {
    sendJson(res, 200, { ok: true, storage: pgPool ? "postgres" : "json-file" });
    return;
  }
  if (!requireActor(actor, res)) return;

  const db = await readDb();

  if (pathname === "/api/dashboard" && method === "GET") {
    sendJson(res, 200, dashboard(db));
    return;
  }

  if (pathname === "/api/brands" && method === "GET") {
    sendJson(res, 200, { brands: db.brands.map((brand) => hydrateBrand(db, brand)) });
    return;
  }

  if (pathname === "/api/price-entries" && method === "GET") {
    const sortedEntries = (db.priceEntries || [])
      .slice()
      .sort((a, b) => (b.effectiveFrom || "").localeCompare(a.effectiveFrom || "") || b.updatedAt.localeCompare(a.updatedAt));
    sendJson(res, 200, {
      priceEntries: priceEntriesWithBrand(db, sortedEntries),
      catalog: priceEntriesWithBrand(db, getLatestPriceCatalog(db))
    });
    return;
  }

  if (pathname === "/api/price-entries/template" && method === "GET") {
    const brandId = url.searchParams.get("brandId") || "";
    const brand = db.brands.find((item) => item.id === brandId && item.type === "brand");
    if (!brand) {
      sendJson(res, 400, { error: "브랜드를 먼저 선택하세요." });
      return;
    }
    const workbook = await buildPriceWorkbookTemplate(db, brand);
    sendBuffer(
      res,
      200,
      workbook,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      { "content-disposition": contentDisposition(`${brand.name}-단가업로드양식.xlsx`) }
    );
    return;
  }

  if (pathname === "/api/price-aliases" && method === "GET") {
    sendJson(res, 200, {
      priceAliases: (db.priceAliases || [])
        .slice()
        .sort((a, b) => (b.validFrom || "").localeCompare(a.validFrom || "") || b.updatedAt.localeCompare(a.updatedAt))
        .map((alias) => priceAliasWithRefs(db, alias))
    });
    return;
  }

  if (pathname === "/api/promotion-rules" && method === "GET") {
    sendJson(res, 200, {
      promotionRules: (db.promotionRules || [])
        .slice()
        .sort((a, b) => (b.validFrom || "").localeCompare(a.validFrom || "") || b.updatedAt.localeCompare(a.updatedAt))
        .map((rule) => promotionRuleWithRefs(db, rule))
    });
    return;
  }

  if (pathname === "/api/price-entries" && method === "POST") {
    const body = await readBody(req);
    const brand = db.brands.find((item) => item.id === body.brandId);
    if (!brand) {
      sendJson(res, 400, { error: "브랜드를 먼저 선택하세요." });
      return;
    }
    const entry = {
      id: id("price"),
      brandId: brand.id,
      itemCode: String(body.itemCode || "").trim(),
      itemName: String(body.itemName || "").trim(),
      spec: String(body.spec || "").trim(),
      unit: String(body.unit || "").trim(),
      barcode: String(body.barcode || "").trim(),
      supplyPrice: number(body.supplyPrice),
      ...normalizePriceFields(body),
      effectiveFrom: dateOnly(body.effectiveFrom) || now().slice(0, 10),
      effectiveTo: dateOnly(body.effectiveTo) || "",
      note: String(body.note || "").trim(),
      isActive: body.isActive !== false && body.isActive !== "false",
      createdAt: now(),
      updatedAt: now()
    };
    if (!entry.itemCode && !entry.itemName) {
      sendJson(res, 400, { error: "품목코드 또는 품목명은 필요합니다." });
      return;
    }
    db.priceEntries.unshift(entry);
    addAudit(db, actor, "create", "price_entry", entry.id, `${brand.name} 단가 개정 등록`, null, entry);
    await writeDb(db);
    sendJson(res, 201, { priceEntry: priceEntryWithBrand(db, entry) });
    return;
  }

  if (pathname === "/api/price-entries/import" && method === "POST") {
    const body = await readBody(req);
    const brand = db.brands.find((item) => item.id === body.brandId);
    if (!brand) {
      sendJson(res, 400, { error: "브랜드를 먼저 선택하세요." });
      return;
    }
    let rows;
    try {
      rows = await parsePriceWorkbookUpload(body);
    } catch (error) {
      sendJson(res, 400, { error: error.message || "Excel 파일을 읽지 못했습니다." });
      return;
    }
    const applied = applyImportedPriceWorkbook(db, actor, brand, rows);
    if (!applied.ok) {
      sendJson(res, 400, { error: "업로드 파일에 반영할 수 없는 행이 있습니다.", details: applied.errors });
      return;
    }
    await writeDb(applied.db);
    sendJson(res, 200, { result: applied.result });
    return;
  }

  const priceEntryMatch = pathname.match(/^\/api\/price-entries\/([^/]+)$/);
  if (priceEntryMatch && method === "PUT") {
    const body = await readBody(req);
    const entry = (db.priceEntries || []).find((item) => item.id === priceEntryMatch[1]);
    if (!entry) {
      sendJson(res, 404, { error: "단가 이력을 찾을 수 없습니다." });
      return;
    }
    const before = { ...entry };
    for (const key of ["itemCode", "itemName", "spec", "unit", "barcode", "note"]) {
      if (key in body) entry[key] = String(body[key] || "").trim();
    }
    for (const key of ["supplyPrice", "consumerPrice", "originalPrice", "discountPrice", "salePrice"]) {
      if (key in body) entry[key] = number(body[key]);
    }
    Object.assign(entry, normalizePriceFields(entry));
    if ("effectiveFrom" in body) entry.effectiveFrom = dateOnly(body.effectiveFrom) || entry.effectiveFrom;
    if ("effectiveTo" in body) entry.effectiveTo = dateOnly(body.effectiveTo) || "";
    if ("isActive" in body) entry.isActive = body.isActive !== false && body.isActive !== "false";
    entry.updatedAt = now();
    addAudit(db, actor, "update", "price_entry", entry.id, `${entry.itemName || entry.itemCode} 단가 이력 수정`, before, entry);
    await writeDb(db);
    sendJson(res, 200, { priceEntry: priceEntryWithBrand(db, entry) });
    return;
  }

  if (priceEntryMatch && method === "DELETE") {
    const linkedAlias = (db.priceAliases || []).find((item) => item.priceEntryId === priceEntryMatch[1] && item.isActive !== false);
    if (linkedAlias) {
      sendJson(res, 400, { error: "이 단가를 참조 중인 별칭이 있어 먼저 별칭을 정리해야 합니다." });
      return;
    }
    const index = (db.priceEntries || []).findIndex((item) => item.id === priceEntryMatch[1]);
    if (index === -1) {
      sendJson(res, 404, { error: "단가 이력을 찾을 수 없습니다." });
      return;
    }
    const [before] = db.priceEntries.splice(index, 1);
    addAudit(db, actor, "delete", "price_entry", before.id, `${before.itemName || before.itemCode} 단가 이력 삭제`, before, null);
    await writeDb(db);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (pathname === "/api/price-aliases" && method === "POST") {
    const body = await readBody(req);
    const brand = db.brands.find((item) => item.id === body.brandId);
    if (!brand) {
      sendJson(res, 400, { error: "브랜드를 먼저 선택하세요." });
      return;
    }
    const target = (db.priceEntries || []).find((item) => item.id === body.priceEntryId && item.brandId === brand.id);
    if (!target) {
      sendJson(res, 400, { error: "연결할 단가 대상을 찾을 수 없습니다." });
      return;
    }
    const aliasText = String(body.aliasText || "").trim();
    const aliasKey = normalizeSearchText(aliasText);
    const validFrom = dateOnly(body.validFrom) || now().slice(0, 10);
    const validTo = dateOnly(body.validTo);
    if (!aliasText) {
      sendJson(res, 400, { error: "별칭 문구를 입력하세요." });
      return;
    }
    if (validTo && validTo < validFrom) {
      sendJson(res, 400, { error: "종료일은 시작일보다 빠를 수 없습니다." });
      return;
    }
    const hasOverlap = (db.priceAliases || []).some((item) =>
      item.brandId === brand.id &&
      item.isActive !== false &&
      normalizeSearchText(item.aliasText) === aliasKey &&
      rangesOverlap(item.validFrom, item.validTo, validFrom, validTo)
    );
    if (hasOverlap) {
      sendJson(res, 409, { error: "같은 브랜드에서 동일 별칭의 기간이 겹칩니다." });
      return;
    }
    const alias = {
      id: id("alias"),
      brandId: brand.id,
      aliasText,
      aliasKey,
      priceEntryId: target.id,
      validFrom,
      validTo,
      note: String(body.note || "").trim(),
      isActive: body.isActive !== false && body.isActive !== "false",
      createdAt: now(),
      updatedAt: now()
    };
    db.priceAliases.unshift(alias);
    addAudit(db, actor, "create", "price_alias", alias.id, `${brand.name} 품목 별칭 등록`, null, priceAliasWithRefs(db, alias));
    await writeDb(db);
    sendJson(res, 201, { priceAlias: priceAliasWithRefs(db, alias) });
    return;
  }

  const priceAliasMatch = pathname.match(/^\/api\/price-aliases\/([^/]+)$/);
  if (priceAliasMatch && method === "PUT") {
    const body = await readBody(req);
    const alias = (db.priceAliases || []).find((item) => item.id === priceAliasMatch[1]);
    if (!alias) {
      sendJson(res, 404, { error: "별칭 이력을 찾을 수 없습니다." });
      return;
    }
    const before = { ...alias };
    const nextBrandId = body.brandId || alias.brandId;
    const brand = db.brands.find((item) => item.id === nextBrandId);
    if (!brand) {
      sendJson(res, 400, { error: "브랜드를 먼저 선택하세요." });
      return;
    }
    const nextTargetId = body.priceEntryId || alias.priceEntryId;
    const target = (db.priceEntries || []).find((item) => item.id === nextTargetId && item.brandId === brand.id);
    if (!target) {
      sendJson(res, 400, { error: "연결할 단가 대상을 찾을 수 없습니다." });
      return;
    }
    const aliasText = "aliasText" in body ? String(body.aliasText || "").trim() : alias.aliasText;
    const aliasKey = normalizeSearchText(aliasText);
    const validFrom = "validFrom" in body ? (dateOnly(body.validFrom) || alias.validFrom || now().slice(0, 10)) : alias.validFrom;
    const validTo = "validTo" in body ? dateOnly(body.validTo) : alias.validTo;
    if (!aliasText) {
      sendJson(res, 400, { error: "별칭 문구를 입력하세요." });
      return;
    }
    if (validTo && validTo < validFrom) {
      sendJson(res, 400, { error: "종료일은 시작일보다 빠를 수 없습니다." });
      return;
    }
    const hasOverlap = (db.priceAliases || []).some((item) =>
      item.id !== alias.id &&
      item.brandId === brand.id &&
      item.isActive !== false &&
      normalizeSearchText(item.aliasText) === aliasKey &&
      rangesOverlap(item.validFrom, item.validTo, validFrom, validTo)
    );
    if (hasOverlap) {
      sendJson(res, 409, { error: "같은 브랜드에서 동일 별칭의 기간이 겹칩니다." });
      return;
    }
    alias.brandId = brand.id;
    alias.priceEntryId = target.id;
    alias.aliasText = aliasText;
    alias.aliasKey = aliasKey;
    alias.validFrom = validFrom;
    alias.validTo = validTo;
    if ("note" in body) alias.note = String(body.note || "").trim();
    if ("isActive" in body) alias.isActive = body.isActive !== false && body.isActive !== "false";
    alias.updatedAt = now();
    addAudit(db, actor, "update", "price_alias", alias.id, `${brand.name} 품목 별칭 수정`, before, priceAliasWithRefs(db, alias));
    await writeDb(db);
    sendJson(res, 200, { priceAlias: priceAliasWithRefs(db, alias) });
    return;
  }

  if (priceAliasMatch && method === "DELETE") {
    const index = (db.priceAliases || []).findIndex((item) => item.id === priceAliasMatch[1]);
    if (index === -1) {
      sendJson(res, 404, { error: "별칭 이력을 찾을 수 없습니다." });
      return;
    }
    const [before] = db.priceAliases.splice(index, 1);
    addAudit(db, actor, "delete", "price_alias", before.id, `${before.aliasText} 품목 별칭 삭제`, priceAliasWithRefs(db, before), null);
    await writeDb(db);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (pathname === "/api/promotion-rules" && method === "POST") {
    const body = await readBody(req);
    const brand = db.brands.find((item) => item.id === body.brandId);
    if (!brand) {
      sendJson(res, 400, { error: "브랜드를 먼저 선택하세요." });
      return;
    }
    const name = String(body.name || "").trim();
    const validFrom = dateOnly(body.validFrom) || now().slice(0, 10);
    const validTo = dateOnly(body.validTo);
    const isActive = body.isActive !== false && body.isActive !== "false";
    const scopeType = body.scopeType === "items" ? "items" : "all";
    const targetItems = sanitizePromotionTargets(body.targetItems);
    if (!name) {
      sendJson(res, 400, { error: "프로모션명은 필수입니다." });
      return;
    }
    if (scopeType === "items" && !targetItems.length) {
      sendJson(res, 400, { error: "품목 지정 프로모션은 대상 품목이 필요합니다." });
      return;
    }
    if (validTo && validTo < validFrom) {
      sendJson(res, 400, { error: "종료일은 시작일보다 빠를 수 없습니다." });
      return;
    }
    // Discount rules are pick-only (never auto-apply), so they never conflict.
    // Only baseline (no-discount) rules with the same scope/target are guarded.
    const newHasDiscount = number(body.discountValue) > 0;
    const hasOverlap = isActive && !newHasDiscount && (db.promotionRules || []).some((rule) => {
      if (rule.brandId !== brand.id || rule.isActive === false) return false;
      if (number(rule.discountValue) > 0) return false;
      if (!rangesOverlap(rule.validFrom, rule.validTo, validFrom, validTo)) return false;
      const ruleScope = rule.scopeType || "all";
      if (scopeType === "all") return ruleScope === "all";
      if (ruleScope !== "items") return false;
      const existingTargets = sanitizePromotionTargets(rule.targetItems);
      return targetItems.some((target) => existingTargets.some((item) => item.key === target.key));
    });
    if (hasOverlap) {
      sendJson(res, 409, { error: "같은 브랜드에서 활성 프로모션 기간이 겹칩니다." });
      return;
    }
    const rule = {
      id: id("promo"),
      brandId: brand.id,
      name,
      scopeType,
      targetItems,
      commissionRate: body.commissionRate === "" || body.commissionRate == null ? null : number(body.commissionRate),
      discountKind: String(body.discountKind || "").trim(),
      discountValueType: String(body.discountValueType || "").trim(),
      discountValue: Math.max(0, number(body.discountValue)),
      discountDetails: String(body.discountDetails || "").trim(),
      validFrom,
      validTo,
      note: String(body.note || "").trim(),
      isActive,
      createdAt: now(),
      updatedAt: now()
    };
    db.promotionRules.unshift(rule);
    addAudit(db, actor, "create", "promotion_rule", rule.id, `${brand.name} 프로모션 수수료 규칙 등록`, null, promotionRuleWithRefs(db, rule));
    await writeDb(db);
    sendJson(res, 201, { promotionRule: promotionRuleWithRefs(db, rule) });
    return;
  }

  const promotionRuleMatch = pathname.match(/^\/api\/promotion-rules\/([^/]+)$/);
  if (promotionRuleMatch && method === "PUT") {
    const body = await readBody(req);
    const rule = (db.promotionRules || []).find((item) => item.id === promotionRuleMatch[1]);
    if (!rule) {
      sendJson(res, 404, { error: "프로모션 규칙을 찾을 수 없습니다." });
      return;
    }
    const before = { ...rule };
    const name = "name" in body ? String(body.name || "").trim() : rule.name;
    const validFrom = "validFrom" in body ? (dateOnly(body.validFrom) || rule.validFrom || now().slice(0, 10)) : rule.validFrom;
    const validTo = "validTo" in body ? dateOnly(body.validTo) : rule.validTo;
    const isActive = "isActive" in body ? body.isActive !== false && body.isActive !== "false" : rule.isActive !== false;
    const scopeType = "scopeType" in body ? (body.scopeType === "items" ? "items" : "all") : (rule.scopeType || "all");
    const targetItems = "targetItems" in body ? sanitizePromotionTargets(body.targetItems) : sanitizePromotionTargets(rule.targetItems);
    if (!name) {
      sendJson(res, 400, { error: "프로모션명은 필수입니다." });
      return;
    }
    if (scopeType === "items" && !targetItems.length) {
      sendJson(res, 400, { error: "품목 지정 프로모션은 대상 품목이 필요합니다." });
      return;
    }
    if (validTo && validTo < validFrom) {
      sendJson(res, 400, { error: "종료일은 시작일보다 빠를 수 없습니다." });
      return;
    }
    const newHasDiscount = number("discountValue" in body ? body.discountValue : rule.discountValue) > 0;
    const hasOverlap = isActive && !newHasDiscount && (db.promotionRules || []).some((item) => {
      if (item.id === rule.id || item.brandId !== rule.brandId || item.isActive === false) return false;
      if (number(item.discountValue) > 0) return false;
      if (!rangesOverlap(item.validFrom, item.validTo, validFrom, validTo)) return false;
      const itemScope = item.scopeType || "all";
      if (scopeType === "all") return itemScope === "all";
      if (itemScope !== "items") return false;
      const existingTargets = sanitizePromotionTargets(item.targetItems);
      return targetItems.some((target) => existingTargets.some((existing) => existing.key === target.key));
    });
    if (hasOverlap) {
      sendJson(res, 409, { error: "같은 브랜드에서 활성 프로모션 기간이 겹칩니다." });
      return;
    }
    rule.name = name;
    rule.scopeType = scopeType;
    rule.targetItems = targetItems;
    if ("commissionRate" in body) {
      rule.commissionRate = body.commissionRate === "" || body.commissionRate == null ? null : number(body.commissionRate);
    }
    if ("discountKind" in body) rule.discountKind = String(body.discountKind || "").trim();
    if ("discountValueType" in body) rule.discountValueType = String(body.discountValueType || "").trim();
    if ("discountValue" in body) rule.discountValue = Math.max(0, number(body.discountValue));
    if ("discountDetails" in body) rule.discountDetails = String(body.discountDetails || "").trim();
    if ("note" in body) rule.note = String(body.note || "").trim();
    rule.validFrom = validFrom;
    rule.validTo = validTo;
    rule.isActive = isActive;
    rule.updatedAt = now();
    addAudit(db, actor, "update", "promotion_rule", rule.id, `${promotionRuleWithRefs(db, rule).brandName} 프로모션 수수료 규칙 수정`, before, promotionRuleWithRefs(db, rule));
    await writeDb(db);
    sendJson(res, 200, { promotionRule: promotionRuleWithRefs(db, rule) });
    return;
  }

  if (promotionRuleMatch && method === "DELETE") {
    const index = (db.promotionRules || []).findIndex((item) => item.id === promotionRuleMatch[1]);
    if (index === -1) {
      sendJson(res, 404, { error: "프로모션 규칙을 찾을 수 없습니다." });
      return;
    }
    const [before] = db.promotionRules.splice(index, 1);
    addAudit(db, actor, "delete", "promotion_rule", before.id, `${before.name} 프로모션 수수료 규칙 삭제`, promotionRuleWithRefs(db, before), null);
    await writeDb(db);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (pathname === "/api/brands" && method === "POST") {
    const body = await readBody(req);
    const brand = {
      id: id("brand"),
      sheetId: "",
      name: String(body.name || "").trim(),
      rawSheetName: String(body.name || "").trim(),
      type: body.type || "brand",
      settlementType: settlementTypes.has(body.settlementType) ? body.settlementType : "prepay_fee",
      commissionRate: number(body.commissionRate),
      hasReceivable: body.hasReceivable === true || body.hasReceivable === "true",
      receivableTotal: number(body.receivableTotal),
      consignmentDueDay: body.consignmentDueDay || "",
      isActive: body.isActive !== false,
      starred: Boolean(body.starred),
      businessName: body.businessName || "",
      businessNumber: body.businessNumber || "",
      representativeName: body.representativeName || "",
      bankName: body.bankName || "",
      bankAccount: body.bankAccount || "",
      accountHolder: body.accountHolder || body.depositorName || "",
      depositorName: body.depositorName || "",
      cutoffNote: body.cutoffNote || "",
      cutoffType: body.cutoffType || inferCutoffType(body.cutoffNote || ""),
      cutoffHour: body.cutoffHour || inferCutoffHour(body.cutoffNote || ""),
      requiredMemo: body.requiredMemo || "",
      googleSheetUrl: body.googleSheetUrl || "",
      cafe24Supplier: String(body.cafe24Supplier || "").trim(),
      bankLabel: String(body.bankLabel || "").trim(),
      priceBasis: body.priceBasis === "catalog" ? "catalog" : "cafe24",
      shareToken: crypto.randomBytes(12).toString("hex"),
      createdAt: now(),
      updatedAt: now()
    };
    Object.assign(brand, normalizeShippingPolicy(body, brand));
    if (!brand.name) {
      sendJson(res, 400, { error: "브랜드명은 필수입니다." });
      return;
    }
    db.brands.unshift(brand);
    addAudit(db, actor, "create", "brand", brand.id, `${brand.name} 브랜드 생성`, null, brand);
    await writeDb(db);
    sendJson(res, 201, { brand: hydrateBrand(db, brand) });
    return;
  }

  const brandMatch = pathname.match(/^\/api\/brands\/([^/]+)$/);
  if (brandMatch && method === "PUT") {
    const body = await readBody(req);
    const brand = db.brands.find((item) => item.id === brandMatch[1]);
    if (!brand) {
      sendJson(res, 404, { error: "브랜드를 찾을 수 없습니다." });
      return;
    }
    const before = { ...brand };
    for (const key of [
      "name",
      "type",
      "settlementType",
      "commissionRate",
      "hasReceivable",
      "receivableTotal",
      "consignmentDueDay",
      "shippingPolicyType",
      "shippingFlatFee",
      "shippingThresholdAmount",
      "shippingThresholdFee",
      "shippingThresholdBase",
      "settlementDateBasis",
      "payAfterShipping",
      "isActive",
      "starred",
      "businessName",
      "businessNumber",
      "representativeName",
      "bankName",
      "bankAccount",
      "accountHolder",
      "depositorName",
      "cutoffNote",
      "cutoffType",
      "cutoffHour",
      "requiredMemo",
      "googleSheetUrl",
      "cafe24Supplier",
      "bankLabel",
      "priceBasis"
    ]) {
      if (key in body) brand[key] = body[key];
    }
    if (brand.priceBasis !== "catalog") brand.priceBasis = "cafe24";
    brand.commissionRate = number(brand.commissionRate);
    brand.receivableTotal = number(brand.receivableTotal);
    brand.hasReceivable = brand.hasReceivable === true || brand.hasReceivable === "true";
    if (!settlementTypes.has(brand.settlementType)) brand.settlementType = "prepay_fee";
    if (!settlementDateBases.has(brand.settlementDateBasis)) {
      brand.settlementDateBasis = brandSettlementDateBasis(brand);
    }
    brand.payAfterShipping = brand.payAfterShipping === true || brand.payAfterShipping === "true";
    Object.assign(brand, normalizeShippingPolicy(brand, before));

    // 계약 규칙 변경: ruleValidFrom 이 오면 덮어쓰지 않고 그 날짜의 버전을
    // 새로 쌓는다. 같은 날짜가 이미 있으면 그 버전을 고쳐 쓴다(오타 정정).
    // 그러고 나서 최상위 필드를 "오늘 유효한 버전"으로 되돌린다 — 미래로
    // 예약한 변경이 지금 만드는 입금요청에 당겨 적용되면 안 되기 때문.
    const ruleValidFrom = dateOnly(body.ruleValidFrom);
    if (ruleValidFrom) {
      if (!Array.isArray(brand.ruleHistory)) brand.ruleHistory = [];
      const existing = brand.ruleHistory.find((item) => item.validFrom === ruleValidFrom);
      if (existing) {
        Object.assign(existing, pickBrandRuleFields(brand), { note: String(body.ruleNote ?? existing.note ?? "") });
      } else {
        brand.ruleHistory.push(buildBrandRule(brand, ruleValidFrom, body.ruleNote || ""));
      }
      brand.ruleHistory.sort((a, b) => String(a.validFrom).localeCompare(String(b.validFrom)));
      syncBrandCurrentRules(brand);
    } else if (Array.isArray(brand.ruleHistory) && brand.ruleHistory.length) {
      // 시작일 없이 규칙을 고치면 "지금 유효한 버전"을 그 자리에서 수정한 것으로 본다.
      const current = brandRuleAt(brand, now());
      if (current) Object.assign(current, pickBrandRuleFields(brand));
    }

    brand.updatedAt = now();
    addAudit(db, actor, "update", "brand", brand.id, `${brand.name} 브랜드 수정`, before, brand);
    await writeDb(db);
    sendJson(res, 200, { brand: hydrateBrand(db, brand) });
    return;
  }

  // 잘못 등록한 계약 규칙 버전 삭제. 마지막 한 개는 남긴다 — 규칙이 하나도
  // 없으면 과거 정산의 기준이 사라진다.
  const brandRuleMatch = pathname.match(/^\/api\/brands\/([^/]+)\/rules\/([^/]+)$/);
  if (brandRuleMatch && method === "DELETE") {
    const brand = db.brands.find((item) => item.id === brandRuleMatch[1]);
    if (!brand) {
      sendJson(res, 404, { error: "브랜드를 찾을 수 없습니다." });
      return;
    }
    const history = Array.isArray(brand.ruleHistory) ? brand.ruleHistory : [];
    if (history.length <= 1) {
      sendJson(res, 400, { error: "규칙 버전은 최소 1개가 있어야 합니다." });
      return;
    }
    const index = history.findIndex((item) => item.id === brandRuleMatch[2]);
    if (index === -1) {
      sendJson(res, 404, { error: "규칙 버전을 찾을 수 없습니다." });
      return;
    }
    const before = { ...brand };
    const [removed] = history.splice(index, 1);
    syncBrandCurrentRules(brand);
    brand.updatedAt = now();
    addAudit(db, actor, "delete", "brand_rule", brand.id, `${brand.name} 계약규칙 ${removed.validFrom} 삭제`, removed, null);
    await writeDb(db);
    sendJson(res, 200, { brand: hydrateBrand(db, brand) });
    return;
  }

  if (brandMatch && method === "DELETE") {
    const index = db.brands.findIndex((item) => item.id === brandMatch[1]);
    if (index === -1) {
      sendJson(res, 404, { error: "브랜드를 찾을 수 없습니다." });
      return;
    }
    const [before] = db.brands.splice(index, 1);
    for (const request of db.requests.filter((item) => item.brandId === before.id)) {
      request.brandId = "";
      request.updatedAt = now();
    }
    addAudit(db, actor, "delete", "brand", before.id, `${before.name} 브랜드 삭제`, before, null);
    await writeDb(db);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (pathname === "/api/requests" && method === "GET") {
    sendJson(res, 200, { requests: db.requests.filter((item) => item.status !== "deleted") });
    return;
  }

  if (pathname === "/api/requests" && method === "POST") {
    const body = await readBody(req);
    const brand = db.brands.find((item) => item.id === body.brandId);
    const promotionContext = brand ? buildPromotionContext(db, brand, sanitizeLineItems(body.lineItems), body.expectedDepositDate) : null;
    const calc = calculateSettlement({ ...body, _promotionContext: promotionContext }, brand);
    const request = {
      id: id("req"),
      brandId: body.brandId || "",
      brandName: body.brandName || brand?.name || "",
      orderNo: body.orderNo || "",
      customerName: body.customerName || "",
      depositAmount: calc.depositAmount,
      productSalesAmount: calc.productSalesAmount,
      baseShippingFee: calc.baseShippingFee,
      extraShippingFee: calc.extraShippingFee,
      extraShippingNote: calc.extraShippingNote,
      shippingFee: calc.shippingFee,
      promotionRuleId: calc.promotionRuleId,
      promotionRuleName: calc.promotionRuleName,
      appliedPromotionRules: calc.appliedPromotionRules,
      commissionRate: calc.commissionRate,
      commissionAmount: calc.commissionAmount,
      supplyAmount: calc.supplyAmount,
      receivableDeduction: calc.receivableDeduction,
      settlementType: calc.settlementType,
      lineItems: calc.lineItems,
      expectedDepositDate: body.expectedDepositDate || "",
      cutoffNote: body.cutoffNote || brand?.cutoffNote || "",
      sourceSheet: body.sourceSheet || brand?.rawSheetName || brand?.name || "",
      sourceRow: Number(body.sourceRow || 0),
      requiredMemo: body.requiredMemo || brand?.requiredMemo || "",
      businessName: body.businessName || brand?.businessName || "",
      businessNumber: body.businessNumber || brand?.businessNumber || "",
      depositorName: body.depositorName || brand?.depositorName || "",
      status: body.status || (calc.settlementType === "consignment" ? "consignment_unpaid" : "pending"),
      paidAmount: body.paidAmount || "",
      paidAt: body.paidAt || "",
      notes: String(body.notes || "").trim(),
      quantity: Math.max(0, Number(body.quantity || 0)),
      priorPaidAmount: Math.max(0, number(body.priorPaidAmount)),
      priorPaidNote: String(body.priorPaidNote || "").trim(),
      cancelledAmount: Math.max(0, number(body.cancelledAmount)),
      cancelledReason: String(body.cancelledReason || "").trim(),
      cancelledNote: String(body.cancelledNote || "").trim(),
      overpaidAmount: Math.max(0, number(body.overpaidAmount)),
      overpaidReason: String(body.overpaidReason || "").trim(),
      overpaidNote: String(body.overpaidNote || "").trim(),
      creditUsedAmount: Math.max(0, number(body.creditUsedAmount)),
      creditUsedNote: String(body.creditUsedNote || "").trim(),
      createdAt: now(),
      updatedAt: now()
    };
    if (!request.orderNo || !request.customerName) {
      sendJson(res, 400, { error: "주문번호와 주문자명은 필수입니다." });
      return;
    }
    // Idempotency guard: drop accidental double-submits of the same request.
    const duplicate = db.requests.find(
      (existing) =>
        existing.orderNo === request.orderNo &&
        existing.brandId === request.brandId &&
        existing.customerName === request.customerName &&
        Date.now() - new Date(existing.createdAt).getTime() < 60000
    );
    if (duplicate) {
      sendJson(res, 200, { request: duplicate, deduped: true });
      return;
    }
    db.requests.unshift(request);
    addAudit(db, actor, "create", "request", request.id, `${request.orderNo} 입금요청 생성`, null, request);
    await writeDb(db);
    sendJson(res, 201, { request });
    syncArchiveInBackground(db, actor, request.brandId, "request_created");
    return;
  }

  if (pathname === "/api/requests/mark-paid" && method === "POST") {
    const body = await readBody(req);
    const ids = Array.isArray(body.requestIds) ? body.requestIds : [];
    if (!ids.length) {
      sendJson(res, 400, { error: "입금완료 처리할 요청을 선택하세요." });
      return;
    }
    const paidAt = String(body.paidAt || "").trim() || now();
    const batchId = ids.length > 1 ? id("paybatch") : "";
    const touchedBrands = new Set();
    const updated = [];
    const skipped = [];
    for (const request of db.requests.filter((item) => ids.includes(item.id) && item.status !== "deleted")) {
      if (request.status === "paid" && request.paidAt) {
        skipped.push(request);
        continue;
      }
      const before = { ...request };
      request.status = "paid";
      request.paidAt = paidAt;
      request.paidAmount = number(body.paidAmount, number(request.depositAmount));
      request.updatedAt = now();
      addPaymentLog(db, actor, request, { paidAt: request.paidAt, paidAmount: request.paidAmount, mode: ids.length > 1 ? "bulk" : "single", batchId });
      addAudit(db, actor, "update", "request_payment", request.id, `${request.orderNo} 입금완료 처리`, before, request);
      if (request.brandId) touchedBrands.add(request.brandId);
      updated.push(request);
    }
    if (!updated.length && !skipped.length) {
      sendJson(res, 404, { error: "처리할 입금요청을 찾지 못했습니다." });
      return;
    }
    if (updated.length) await writeDb(db);
    sendJson(res, 200, { updatedRequests: updated, skippedRequestIds: skipped.map((item) => item.id), batchId });
    if (updated.length) syncArchiveInBackground(db, actor, [...touchedBrands], "request_paid");
    return;
  }

  if (pathname === "/api/requests/bulk-delete" && method === "POST") {
    const body = await readBody(req);
    const ids = Array.isArray(body.requestIds) ? body.requestIds : [];
    if (!ids.length) {
      sendJson(res, 400, { error: "삭제할 입금요청을 선택하세요." });
      return;
    }
    const touchedBrands = new Set();
    const updated = [];
    for (const request of db.requests.filter((item) => ids.includes(item.id) && item.status !== "deleted")) {
      const before = { ...request };
      request.status = "deleted";
      request.updatedAt = now();
      addAudit(db, actor, "delete", "request", request.id, `${request.orderNo} 입금요청 삭제`, before, request);
      if (request.brandId) touchedBrands.add(request.brandId);
      updated.push(request);
    }
    if (!updated.length) {
      sendJson(res, 404, { error: "삭제할 입금요청을 찾지 못했습니다." });
      return;
    }
    await writeDb(db);
    sendJson(res, 200, { deletedRequests: updated });
    syncArchiveInBackground(db, actor, [...touchedBrands], "request_deleted");
    return;
  }

  // Fast status change (single or bulk) — no settlement recalculation, so it is
  // far quicker than the full PUT edit path. Archive sync runs in background.
  if (pathname === "/api/requests/set-status" && method === "POST") {
    const body = await readBody(req);
    const ids = Array.isArray(body.requestIds) ? body.requestIds : [];
    const status = String(body.status || "").trim();
    const allowed = new Set(["pending", "await_deposit", "paid", "hold", "error", "consignment_unpaid"]);
    if (!ids.length) { sendJson(res, 400, { error: "상태를 변경할 요청을 선택하세요." }); return; }
    if (!allowed.has(status)) { sendJson(res, 400, { error: "허용되지 않은 상태입니다." }); return; }
    const paidAt = String(body.paidAt || "").trim() || now();
    const batchId = ids.length > 1 ? id("statusbatch") : "";
    const touchedBrands = new Set();
    const updated = [];
    for (const request of db.requests.filter((item) => ids.includes(item.id) && item.status !== "deleted")) {
      if (request.status === status) continue;
      const before = { ...request };
      if (status === "paid") {
        request.status = "paid";
        request.paidAt = request.paidAt || paidAt;
        request.paidAmount = number(request.paidAmount, number(request.depositAmount));
        addPaymentLog(db, actor, request, { paidAt: request.paidAt, paidAmount: request.paidAmount, mode: ids.length > 1 ? "bulk" : "single", batchId });
      } else {
        request.status = status;
      }
      request.updatedAt = now();
      addAudit(db, actor, "update", "request_status", request.id, `${request.orderNo} 상태 변경 → ${status}`, before, request);
      if (request.brandId) touchedBrands.add(request.brandId);
      updated.push(request);
    }
    if (!updated.length) { sendJson(res, 200, { updatedRequests: [] }); return; }
    await writeDb(db);
    sendJson(res, 200, { updatedRequests: updated });
    syncArchiveInBackground(db, actor, [...touchedBrands], "status_changed");
    return;
  }

  const requestMatch = pathname.match(/^\/api\/requests\/([^/]+)$/);
  if (requestMatch && method === "PUT") {
    const body = await readBody(req);
    const request = db.requests.find((item) => item.id === requestMatch[1]);
    if (!request) {
      sendJson(res, 404, { error: "입금요청을 찾을 수 없습니다." });
      return;
    }
    const before = { ...request };
    for (const key of [
      "brandId",
      "brandName",
      "orderNo",
      "customerName",
      "productSalesAmount",
      "baseShippingFee",
      "extraShippingFee",
      "extraShippingNote",
      "shippingFee",
      "promotionRuleId",
      "promotionRuleName",
      "appliedPromotionRules",
      "commissionRate",
      "commissionAmount",
      "supplyAmount",
      "depositAmount",
      "receivableDeduction",
      "settlementType",
      "expectedDepositDate",
      "cutoffNote",
      "sourceSheet",
      "sourceRow",
      "requiredMemo",
      "businessName",
      "businessNumber",
      "depositorName",
      "status",
      "paidAmount",
      "paidAt",
      "notes",
      "quantity",
      "cancelledAmount",
      "cancelledReason",
      "cancelledNote",
      "overpaidAmount",
      "overpaidReason",
      "overpaidNote",
      "creditUsedAmount",
      "creditUsedNote",
      "priorPaidAmount",
      "priorPaidNote"
    ]) {
      if (key in body) {
        if (key === "sourceRow") {
          request[key] = Number(body[key] || 0);
        } else if (key === "quantity") {
          request[key] = Math.max(0, Number(body[key] || 0));
        } else if (key === "overpaidAmount" || key === "creditUsedAmount" || key === "cancelledAmount" || key === "priorPaidAmount") {
          request[key] = Math.max(0, number(body[key]));
        } else {
          request[key] = body[key];
        }
      }
    }
    const brand = db.brands.find((item) => item.id === request.brandId);
    const promotionContext = brand ? buildPromotionContext(db, brand, sanitizeLineItems(body.lineItems || request.lineItems), body.expectedDepositDate || request.expectedDepositDate) : null;
    const calc = calculateSettlement({ ...request, ...body, _promotionContext: promotionContext }, brand);
    Object.assign(request, calc);
    if (request.settlementType === "consignment" && request.status === "pending") {
      request.status = "consignment_unpaid";
    }
    request.updatedAt = now();
    addAudit(db, actor, "update", "request", request.id, `${request.orderNo} 입금요청 수정`, before, request);
    const brandIds = new Set([before.brandId, request.brandId].filter(Boolean));
    await writeDb(db);
    sendJson(res, 200, { request });
    syncArchiveInBackground(db, actor, [...brandIds], "request_updated");
    return;
  }

  if (requestMatch && method === "DELETE") {
    const request = db.requests.find((item) => item.id === requestMatch[1]);
    if (!request) {
      sendJson(res, 404, { error: "입금요청을 찾을 수 없습니다." });
      return;
    }
    const before = { ...request };
    request.status = "deleted";
    request.updatedAt = now();
    addAudit(db, actor, "delete", "request", request.id, `${request.orderNo} 입금요청 삭제`, before, request);
    await writeDb(db);
    sendJson(res, 200, { ok: true });
    syncArchiveInBackground(db, actor, before.brandId, "request_deleted");
    return;
  }

  // 등록된 메뉴와 액션. 새 메뉴는 MENU_REGISTRY 에 넣기만 하면 권한 화면에
  // 자동으로 나타난다.
  if (pathname === "/api/menus" && method === "GET") {
    sendJson(res, 200, { menus: MENU_REGISTRY, actionLabels: ACTION_LABELS });
    return;
  }

  if (pathname === "/api/admins" && method === "GET") {
    sendJson(res, 200, { admins: db.admins.map(publicAdmin) });
    return;
  }

  if (pathname === "/api/admins" && method === "POST") {
    if (!requirePermission(actor, res, "admins", "create")) return;
    const body = await readBody(req);
    const email = String(body.email || "").trim().toLowerCase();
    if (!email || !body.password) {
      sendJson(res, 400, { error: "이메일과 비밀번호는 필수입니다." });
      return;
    }
    if (db.admins.some((item) => item.email.toLowerCase() === email)) {
      sendJson(res, 409, { error: "이미 존재하는 이메일입니다." });
      return;
    }
    const admin = {
      id: id("admin"),
      name: body.name || email,
      email,
      role: body.role || "operator",
      isActive: body.isActive !== false,
      permissions: sanitizePermissions(body.permissions || defaultPermissions(body.role || "operator")),
      passwordHash: hashPassword(body.password),
      createdAt: now(),
      updatedAt: now()
    };
    db.admins.push(admin);
    addAudit(db, actor, "create", "admin", admin.id, `${admin.email} 관리자 생성`, null, publicAdmin(admin));
    await writeDb(db);
    sendJson(res, 201, { admin: publicAdmin(admin) });
    return;
  }

  const adminMatch = pathname.match(/^\/api\/admins\/([^/]+)$/);
  if (adminMatch && method === "PUT") {
    if (!requirePermission(actor, res, "admins", "edit")) return;
    const body = await readBody(req);
    const admin = db.admins.find((item) => item.id === adminMatch[1]);
    if (!admin) {
      sendJson(res, 404, { error: "관리자를 찾을 수 없습니다." });
      return;
    }
    const before = publicAdmin(admin);
    // owner 는 자기 계정의 권한이나 등급을 스스로 낮출 수 없다. 마지막 owner 가
    // 실수로 자신을 강등하면 아무도 권한을 되돌릴 수 없게 된다.
    const demotingSelf = admin.id === actor.id && admin.role === "owner"
      && "role" in body && body.role !== "owner";
    if (demotingSelf) {
      sendJson(res, 400, { error: "본인의 오너 권한은 해제할 수 없습니다. 다른 오너 계정으로 변경하세요." });
      return;
    }
    const losingOwner = ("role" in body && body.role !== "owner") || body.isActive === false;
    if (admin.role === "owner" && losingOwner && isLastActiveOwner(db, admin.id)) {
      sendJson(res, 400, { error: "마지막 오너 계정입니다. 다른 오너를 먼저 지정하세요." });
      return;
    }
    for (const key of ["name", "role", "isActive"]) {
      if (key in body) admin[key] = body[key];
    }
    if ("permissions" in body) {
      admin.permissions = sanitizePermissions(body.permissions);
    } else if ("role" in body && !admin.permissions) {
      admin.permissions = sanitizePermissions(defaultPermissions(admin.role));
    }
    if (body.password) admin.passwordHash = hashPassword(body.password);
    admin.updatedAt = now();
    addAudit(db, actor, "update", "admin", admin.id, `${admin.email} 관리자 수정`, before, publicAdmin(admin));
    await writeDb(db);
    sendJson(res, 200, { admin: publicAdmin(admin) });
    return;
  }

  if (adminMatch && method === "DELETE") {
    if (!requirePermission(actor, res, "admins", "delete")) return;
    const index = db.admins.findIndex((item) => item.id === adminMatch[1]);
    if (index === -1) {
      sendJson(res, 404, { error: "관리자를 찾을 수 없습니다." });
      return;
    }
    if (db.admins[index].id === actor.id) {
      sendJson(res, 400, { error: "본인 계정은 삭제할 수 없습니다." });
      return;
    }
    if (isLastActiveOwner(db, db.admins[index].id)) {
      sendJson(res, 400, { error: "마지막 오너 계정은 삭제할 수 없습니다." });
      return;
    }
    const [before] = db.admins.splice(index, 1);
    addAudit(db, actor, "delete", "admin", before.id, `${before.email} 관리자 삭제`, publicAdmin(before), null);
    await writeDb(db);
    sendJson(res, 200, { ok: true });
    return;
  }

  // 감사로그는 전체가 2MB가 넘는다. 화면을 열 때마다 통째로 보내면 다른 응답까지
  // 같이 느려지므로 기본은 최근 것만 준다.
  if (pathname === "/api/audits" && method === "GET") {
    const limit = Math.min(1000, Math.max(1, Number(url.searchParams.get("limit") || 200)));
    const offset = Math.max(0, Number(url.searchParams.get("offset") || 0));
    sendJson(res, 200, {
      auditLogs: db.auditLogs.slice(offset, offset + limit),
      total: db.auditLogs.length,
      offset,
      limit
    });
    return;
  }

  const paymentLogMatch = pathname.match(/^\/api\/export\/payment-log\.(csv|xls)$/);
  if (paymentLogMatch && method === "GET") {
    const rows = paymentLogRows(db);
    const ext = paymentLogMatch[1];
    const title = "입금완료_로그";
    if (ext === "csv") {
      sendText(res, 200, toCsvWithColumns(rows, paymentLogColumns), "text/csv; charset=utf-8", {
        "content-disposition": contentDisposition(`${title}.csv`)
      });
    } else {
      sendText(res, 200, toExcelHtmlWithColumns(rows, paymentLogColumns, title), "application/vnd.ms-excel; charset=utf-8", {
        "content-disposition": contentDisposition(`${title}.xls`)
      });
    }
    return;
  }

  const csvMatch = pathname.match(/^\/api\/export\/(?:(brand)\/([^/.]+)\.)?(csv|xls)$/);
  if (csvMatch && method === "GET") {
    const brandId = csvMatch[1] ? csvMatch[2] : "";
    const brand = brandId ? db.brands.find((item) => item.id === brandId) : null;
    const rows = requestRows(db, brandId);
    const ext = csvMatch[3];
    const title = brand ? `${brand.name}_입금요청` : "전체_입금요청";
    if (ext === "csv") {
      sendText(res, 200, toCsv(rows), "text/csv; charset=utf-8", {
        "content-disposition": contentDisposition(`${title}.csv`)
      });
    } else {
      sendText(res, 200, toExcelHtml(rows, title), "application/vnd.ms-excel; charset=utf-8", {
        "content-disposition": contentDisposition(`${title}.xls`)
      });
    }
    return;
  }

  if (pathname === "/api/archives/google-sync" && method === "POST") {
    const body = await readBody(req);
    const { archive, payload } = await syncArchive(db, actor, body.brandId || "", "manual");
    await writeDb(db);
    sendJson(res, 200, { archive, payload });
    return;
  }

  if (pathname === "/api/archives" && method === "GET") {
    sendJson(res, 200, { archiveHistory: db.archiveHistory });
    return;
  }

  if (pathname === "/api/payment-logs" && method === "GET") {
    sendJson(res, 200, { paymentLogs: db.paymentLogs });
    return;
  }

  if (pathname === "/api/settlement/run" && method === "POST") {
    const body = await readBody(req);
    const brand = db.brands.find((item) => item.id === body.brandId);
    if (!brand) { sendJson(res, 400, { error: "브랜드를 선택하세요." }); return; }
    if (!body.year || !body.month) { sendJson(res, 400, { error: "정산 연/월을 선택하세요." }); return; }
    let orders = { rows: [], source: "upload", range: null };
    let bank = { rows: [], source: "none", range: null };
    try {
      orders = await settlementOrderRows(db, body, actor, brand);
      bank = await settlementBankRows(db, body, actor);
      if (orders.source === "cafe24" || bank.source === "clobe") await writeDb(db);
    } catch (error) {
      sendJson(res, error.status || (error.needsReauth ? 401 : 400), { error: settlementSourceError(body, error) });
      return;
    }
    if (!orders.rows.length) {
      sendJson(res, 400, {
        error: body.useCafe24
          ? "카페24에서 해당 기간 주문을 찾지 못했습니다. 기간과 기준일 설정을 확인하세요."
          : "카페24 주문내역(CSV)을 업로드하세요."
      });
      return;
    }
    const result = computeSettlementResult(db, brand, body.year, body.month, orders.rows, bank.rows);
    sendJson(res, 200, {
      brand: { id: brand.id, name: brand.name, settlementType: brand.settlementType, cafe24Supplier: brand.cafe24Supplier || "" },
      ...result,
      orderSource: { source: orders.source, rowCount: orders.rows.length, orderCount: orders.orderCount || 0, range: orders.range },
      bankSource: { source: bank.source, rowCount: bank.rows.length, range: bank.range },
      lines: result.needsMapping ? [] : result.lines
    });
    return;
  }

  if (pathname === "/api/settlement/export" && method === "POST") {
    const body = await readBody(req);
    const brand = db.brands.find((item) => item.id === body.brandId);
    if (!brand) { sendJson(res, 400, { error: "브랜드를 선택하세요." }); return; }
    let orders = { rows: [], source: "upload", range: null };
    let bank = { rows: [], source: "none", range: null };
    try {
      orders = await settlementOrderRows(db, body, actor, brand);
      bank = await settlementBankRows(db, body, actor);
      if (orders.source === "cafe24" || bank.source === "clobe") await writeDb(db);
    } catch (error) {
      sendJson(res, error.status || (error.needsReauth ? 401 : 400), { error: settlementSourceError(body, error) });
      return;
    }
    const result = computeSettlementResult(db, brand, body.year, body.month, orders.rows, bank.rows);
    if (result.needsMapping) { sendJson(res, 409, { error: "먼저 카페24 공급사 매핑을 저장하세요." }); return; }
    if (result.errors.length && !body.force) {
      sendJson(res, 409, { error: "정산 오류가 있어 출력할 수 없습니다.", errors: result.errors });
      return;
    }
    const spec = settlementSpecFromResult(brand, body.year, body.month, result);
    try {
      const buffer = await generateSettlementXlsx(spec);
      const ym = `${body.year}${String(body.month).padStart(2, "0")}`;
      sendBuffer(res, 200, buffer,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        { "content-disposition": contentDisposition(`(우프) ${spec.supplierName}_${ym}.xlsx`) });
    } catch (error) {
      sendJson(res, 500, { error: `정산서 생성 실패: ${error.message}` });
    }
    return;
  }

  // --- 반자동 파이프라인 ---------------------------------------------------
  // 각 단계는 버튼 하나에 대응하고, 수집·확인은 미리보기만 하고 아무것도 쓰지
  // 않는다. 실제 생성/전환은 사람이 확인한 뒤 apply 로만 일어난다.
  if (pathname.startsWith("/api/pipeline/")) {
    // 미리보기는 접근 권한, 실제 생성·전환은 실행 권한을 따로 본다.
    const action = /\/apply$/.test(pathname) ? "apply" : "view";
    if (!requirePermission(actor, res, "pipeline", action)) return;
  }

  // ① 수집 (미리보기) — 결제된 카페24 주문에서 만들어질 입금요청을 보여준다.
  if (pathname === "/api/pipeline/collect" && method === "POST") {
    const body = await readBody(req);
    try {
      const endDate = dateOnly(body.endDate) || now().slice(0, 10);
      const startDate = dateOnly(body.startDate) ||
        new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
      const orders = await withCafe24Token(db, (token) =>
        cafe24.fetchOrders(token, { startDate, endDate, dateType: "order_date" }));
      const result = buildRequestDrafts({
        orders,
        brands: db.brands,
        existingRequests: db.requests
      });
      // 미리보기 단계에서 금액까지 계산해 보여준다. 확인 단계가 곧 검산이다.
      const priced = result.drafts.map((draft) => ({
        ...draft,
        ...priceDraft(db, draft)
      }));
      db.cafe24.lastSyncAt = now();
      await writeDb(db);
      sendJson(res, 200, {
        range: { startDate, endDate },
        orderCount: orders.length,
        drafts: priced,
        skipped: result.skipped,
        unmappedSuppliers: result.unmappedSuppliers
      });
    } catch (error) {
      sendJson(res, error.needsReauth ? 401 : 502, { error: error.message });
    }
    return;
  }

  // ① 수집 (적용) — 확인한 초안만 실제 입금요청으로 만든다.
  if (pathname === "/api/pipeline/collect/apply" && method === "POST") {
    const body = await readBody(req);
    const drafts = Array.isArray(body.drafts) ? body.drafts : [];
    if (!drafts.length) {
      sendJson(res, 400, { error: "생성할 요청을 선택하세요." });
      return;
    }
    const created = [];
    const skipped = [];
    for (const draft of drafts) {
      const brand = db.brands.find((item) => item.id === draft.brandId);
      const orderNo = String(draft.orderNo || "").trim();
      if (!brand || !orderNo) continue;
      // 미리보기와 적용 사이에 누군가 만들었을 수 있다.
      const exists = db.requests.some(
        (item) => item.status !== "deleted" && String(item.orderNo || "").trim() === orderNo && item.brandId === brand.id
      );
      if (exists) {
        skipped.push(orderNo);
        continue;
      }
      const request = buildRequestFromDraft(db, brand, draft);
      db.requests.unshift(request);
      addAudit(db, actor, "create", "request", request.id,
        `${request.orderNo} 입금요청 자동수집 (${brand.name})`, null, request);
      created.push(request);
    }
    if (created.length) await writeDb(db);
    sendJson(res, 200, { created, createdCount: created.length, skipped });
    return;
  }

  // ⑤ 출고 감지 — 출고후입금 브랜드의 입금대기 건 중 송장이 찍힌 것을 찾는다.
  if (pathname === "/api/pipeline/shipped" && method === "POST") {
    const body = await readBody(req);
    try {
      const endDate = dateOnly(body.endDate) || now().slice(0, 10);
      const startDate = dateOnly(body.startDate) ||
        new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const orders = await withCafe24Token(db, (token) =>
        cafe24.fetchOrders(token, { startDate, endDate, dateType: "order_date" }));
      const found = findShippedAwaiting({ orders, requests: db.requests, brands: db.brands });
      sendJson(res, 200, {
        range: { startDate, endDate },
        items: found.map(({ request, brand, trackingNo }) => ({
          requestId: request.id,
          orderNo: request.orderNo,
          brandName: brand?.name || request.brandName,
          amount: finalDepositAmount(request),
          trackingNo
        }))
      });
    } catch (error) {
      sendJson(res, error.needsReauth ? 401 : 502, { error: error.message });
    }
    return;
  }

  // ⑤ 출고 감지 (적용) — 입금대기 → 입금요청.
  if (pathname === "/api/pipeline/shipped/apply" && method === "POST") {
    const body = await readBody(req);
    const ids = Array.isArray(body.requestIds) ? body.requestIds : [];
    const updated = [];
    for (const request of db.requests.filter((item) => ids.includes(item.id) && item.status === "await_deposit")) {
      const before = { ...request };
      request.status = "pending";
      request.updatedAt = now();
      addAudit(db, actor, "update", "request", request.id,
        `${request.orderNo} 출고 확인 — 입금대기에서 입금요청으로`, before, request);
      updated.push(request);
    }
    if (updated.length) await writeDb(db);
    sendJson(res, 200, { updated, updatedCount: updated.length });
    return;
  }

  // --- Cafe24 Admin API endpoints -----------------------------------------
  // Order data and a delegated credential — owner/manager only, same as clobe.
  if (pathname.startsWith("/api/cafe24/")) {
    if (!requirePermission(actor, res, "pipeline", "view", "카페24 연동 권한이 없습니다.")) return;
    if (!db.cafe24 || typeof db.cafe24 !== "object") db.cafe24 = buildCafe24Namespace();
  }

  if (pathname === "/api/cafe24/status" && method === "GET") {
    sendJson(res, 200, cafe24PublicState(db));
    return;
  }

  if (pathname === "/api/cafe24/connect" && method === "POST") {
    if (!cafe24.cafe24Configured()) {
      sendJson(res, 400, { error: "CAFE24_MALL_ID / CAFE24_CLIENT_ID / CAFE24_CLIENT_SECRET 환경변수를 먼저 설정하세요." });
      return;
    }
    try {
      const redirectUri = cafe24RedirectUri(req);
      const state = cafe24.createState();
      cafe24PendingAuth.set(state, { redirectUri, actorId: actor.id, createdAt: Date.now() });
      for (const [key, value] of cafe24PendingAuth) {
        if (Date.now() - value.createdAt > CLOBE_AUTH_TTL_MS) cafe24PendingAuth.delete(key);
      }
      sendJson(res, 200, { authorizeUrl: cafe24.buildAuthorizeUrl({ redirectUri, state }) });
    } catch (error) {
      sendJson(res, 502, { error: `카페24 연결 준비 실패: ${error.message}` });
    }
    return;
  }

  if (pathname === "/api/cafe24/callback" && method === "GET") {
    const code = url.searchParams.get("code") || "";
    const state = url.searchParams.get("state") || "";
    const pending = cafe24PendingAuth.get(state);
    cafe24PendingAuth.delete(state);
    const fail = (reason) => {
      res.writeHead(302, { location: `/?cafe24=error&reason=${encodeURIComponent(reason)}` });
      res.end();
    };
    if (url.searchParams.get("error")) return void fail(url.searchParams.get("error"));
    if (!code || !pending) return void fail("인증 요청이 만료되었습니다. 다시 시도하세요.");
    // Cafe24 authorization codes expire after one minute.
    if (Date.now() - pending.createdAt > CLOBE_AUTH_TTL_MS) return void fail("인증 요청이 만료되었습니다.");
    if (pending.actorId !== actor.id) return void fail("인증을 시작한 계정과 다릅니다.");
    try {
      const tokens = await cafe24.exchangeCode({ code, redirectUri: pending.redirectUri });
      db.cafe24.accessToken = clobe.sealSecret(tokens.accessToken);
      db.cafe24.refreshToken = clobe.sealSecret(tokens.refreshToken);
      db.cafe24.expiresAt = tokens.expiresAt;
      db.cafe24.refreshTokenExpiresAt = tokens.refreshTokenExpiresAt || "";
      db.cafe24.mallId = tokens.mallId || "";
      db.cafe24.connectedBy = actor.name || actor.email || "";
      db.cafe24.connectedAt = now();
      addAudit(db, actor, "update", "cafe24", "connection", `카페24 연동 연결 (${db.cafe24.mallId})`, null, cafe24PublicState(db));
      await writeDb(db);
      res.writeHead(302, { location: "/?cafe24=connected" });
      res.end();
    } catch (error) {
      fail(error.message);
    }
    return;
  }

  if (pathname === "/api/cafe24/disconnect" && method === "POST") {
    addAudit(db, actor, "delete", "cafe24", "connection", "카페24 연동 해제", cafe24PublicState(db), null);
    db.cafe24 = buildCafe24Namespace();
    await writeDb(db);
    sendJson(res, 200, cafe24PublicState(db));
    return;
  }

  // Returns one raw order exactly as Cafe24 sends it. The settlement engine
  // consumes Korean-keyed spreadsheet columns, so the API→column adapter has
  // to be written against real field names rather than guessed from docs.
  if (pathname === "/api/cafe24/sample" && method === "GET") {
    try {
      const startDate = url.searchParams.get("startDate") || "";
      const endDate = url.searchParams.get("endDate") || "";
      const payload = await withCafe24Token(db, (token) => cafe24.apiGet(token, "/api/v2/admin/orders", {
        start_date: startDate,
        end_date: endDate,
        date_type: url.searchParams.get("dateType") || "order_date",
        supplier_id: url.searchParams.get("supplierId") || "",
        embed: "items",
        limit: Number(url.searchParams.get("limit") || 2)
      }));
      db.cafe24.lastSyncAt = now();
      await writeDb(db);
      sendJson(res, 200, payload);
    } catch (error) {
      sendJson(res, error.needsReauth ? 401 : 502, { error: error.message });
    }
    return;
  }

  // Diffs the adapted API rows against an uploaded CSV for the same period.
  // The adapter was written from one sample response, so before it replaces the
  // upload it has to be shown to reproduce the export field by field — a value
  // mapped at the wrong granularity would otherwise shift settlements silently.
  if (pathname === "/api/cafe24/compare" && method === "POST") {
    const body = await readBody(req);
    try {
      const csvRows = body.cafe24Csv ? parseCafe24Csv(body.cafe24Csv) : [];
      if (!csvRows.length) {
        sendJson(res, 400, { error: "비교할 카페24 CSV를 올려주세요." });
        return;
      }
      const orders = await withCafe24Token(db, (token) => cafe24.fetchOrders(token, {
        startDate: body.startDate,
        endDate: body.endDate,
        dateType: body.dateType || "order_date",
        supplierId: body.supplierId || ""
      }));
      const apiRows = cafe24OrdersToRows(orders);
      db.cafe24.lastSyncAt = now();
      await writeDb(db);
      sendJson(res, 200, {
        orderCount: orders.length,
        apiRowCount: apiRows.length,
        csvRowCount: csvRows.length,
        ...compareRows(csvRows, apiRows)
      });
    } catch (error) {
      sendJson(res, error.needsReauth ? 401 : 502, { error: error.message });
    }
    return;
  }

  // --- Clobe (클로브ai) 입금대사 endpoints ---------------------------------
  // Banking data and a long-lived delegated credential — owner/manager only.
  if (pathname.startsWith("/api/clobe/")) {
    if (!requirePermission(actor, res, "reconcile", "view", "클로브 연동 권한이 없습니다.")) return;
    if (!db.clobe || typeof db.clobe !== "object") db.clobe = buildClobeNamespace();
  }

  if (pathname === "/api/clobe/status" && method === "GET") {
    sendJson(res, 200, clobePublicState(db));
    return;
  }

  if (pathname === "/api/clobe/connect" && method === "POST") {
    try {
      const redirectUri = clobeRedirectUri(req);
      // The client_id is bound to its redirect URI at registration, so a moved
      // deployment needs a fresh registration rather than a reused one.
      if (!db.clobe.clientId || db.clobe.redirectUri !== redirectUri) {
        const registration = await clobe.registerClient(redirectUri);
        db.clobe.clientId = registration.clientId;
        db.clobe.redirectUri = redirectUri;
        await writeDb(db);
      }
      const { verifier, challenge } = clobe.createPkcePair();
      const state = crypto.randomBytes(24).toString("hex");
      clobePendingAuth.set(state, { verifier, redirectUri, actorId: actor.id, createdAt: Date.now() });
      for (const [key, value] of clobePendingAuth) {
        if (Date.now() - value.createdAt > CLOBE_AUTH_TTL_MS) clobePendingAuth.delete(key);
      }
      const authorizeUrl = await clobe.buildAuthorizeUrl({
        clientId: db.clobe.clientId,
        redirectUri,
        challenge,
        state
      });
      sendJson(res, 200, { authorizeUrl });
    } catch (error) {
      sendJson(res, 502, { error: `클로브 연결 준비 실패: ${error.message}` });
    }
    return;
  }

  if (pathname === "/api/clobe/callback" && method === "GET") {
    const code = url.searchParams.get("code") || "";
    const state = url.searchParams.get("state") || "";
    const pending = clobePendingAuth.get(state);
    clobePendingAuth.delete(state);
    const fail = (reason) => {
      res.writeHead(302, { location: `/?clobe=error&reason=${encodeURIComponent(reason)}` });
      res.end();
    };
    if (url.searchParams.get("error")) return void fail(url.searchParams.get("error"));
    if (!code || !pending) return void fail("인증 요청이 만료되었습니다. 다시 시도하세요.");
    if (Date.now() - pending.createdAt > CLOBE_AUTH_TTL_MS) return void fail("인증 요청이 만료되었습니다.");
    if (pending.actorId !== actor.id) return void fail("인증을 시작한 계정과 다릅니다.");
    try {
      const tokens = await clobe.exchangeCode({
        clientId: db.clobe.clientId,
        redirectUri: pending.redirectUri,
        code,
        verifier: pending.verifier
      });
      db.clobe.accessToken = clobe.sealSecret(tokens.accessToken);
      db.clobe.refreshToken = clobe.sealSecret(tokens.refreshToken);
      db.clobe.expiresAt = tokens.expiresAt;
      db.clobe.connectedBy = actor.name || actor.email || "";
      db.clobe.connectedAt = now();

      // 우프컴퍼니 is the only company WooofPay settles, so bind it right away
      // rather than making the operator pick from the other three.
      const context = await clobe.callTool(tokens.accessToken, "get_my_context", {});
      const company = clobePickCompany(context.companies);
      if (!company) {
        return void fail("이 클로브 계정에서 주식회사 우프컴퍼니를 찾지 못했습니다.");
      }
      db.clobe.companyId = company.companyId;
      db.clobe.companyName = company.companyName;
      addAudit(db, actor, "update", "clobe", "connection", `클로브 연동 연결 (${company.companyName})`, null, { companyId: company.companyId });
      await writeDb(db);
      res.writeHead(302, { location: "/?clobe=connected" });
      res.end();
    } catch (error) {
      fail(error.message);
    }
    return;
  }

  if (pathname === "/api/clobe/disconnect" && method === "POST") {
    addAudit(db, actor, "delete", "clobe", "connection", "클로브 연동 해제", clobePublicState(db), null);
    db.clobe = buildClobeNamespace();
    await writeDb(db);
    sendJson(res, 200, clobePublicState(db));
    return;
  }

  // Re-binds 우프컴퍼니 if a connection predates the pinning, and reports the
  // company back. Other companies on the clobe account are never exposed.
  if (pathname === "/api/clobe/companies" && method === "GET") {
    try {
      const context = await clobeCall(db, "get_my_context", {});
      const company = clobePickCompany(context.companies);
      if (!company) {
        sendJson(res, 404, { error: "이 클로브 계정에서 주식회사 우프컴퍼니를 찾지 못했습니다." });
        return;
      }
      if (db.clobe.companyId !== company.companyId) {
        db.clobe.companyId = company.companyId;
        db.clobe.companyName = company.companyName;
        await writeDb(db);
      }
      sendJson(res, 200, { companies: [company] });
    } catch (error) {
      sendJson(res, error.needsReauth ? 401 : 502, { error: error.message });
    }
    return;
  }

  // 클로브 데이터가 언제까지 수집된 것인지. 재수집은 클로브에서만 가능해서
  // (MCP 에 트리거 도구가 없다) 여기서는 상태만 보여주고 링크로 안내한다.
  if (pathname === "/api/clobe/scraping" && method === "GET") {
    try {
      const payload = await clobeCall(db, "get_scraping_status", { companyId: db.clobe.companyId });
      sendJson(res, 200, payload);
    } catch (error) {
      sendJson(res, error.needsReauth ? 401 : 502, { error: error.message });
    }
    return;
  }

  if (pathname === "/api/clobe/accounts" && method === "GET") {
    try {
      const [accounts, scraping] = await Promise.all([
        clobeCall(db, "get_bank_accounts", { companyId: db.clobe.companyId }),
        clobeCall(db, "get_scraping_status", { companyId: db.clobe.companyId }).catch(() => null)
      ]);
      sendJson(res, 200, { accounts: accounts.accounts || [], scraping });
    } catch (error) {
      sendJson(res, error.needsReauth ? 401 : 502, { error: error.message });
    }
    return;
  }

  if (pathname === "/api/clobe/settings" && method === "POST") {
    const body = await readBody(req);
    // companyId is deliberately not settable — it is pinned to 우프컴퍼니.
    if (body.accountIds !== undefined) {
      db.clobe.accountIds = (Array.isArray(body.accountIds) ? body.accountIds : []).map(Number).filter(Boolean);
    }
    if (body.windowDays !== undefined) {
      db.clobe.windowDays = Math.min(60, Math.max(0, Number(body.windowDays) || 0));
    }
    await writeDb(db);
    sendJson(res, 200, clobePublicState(db));
    return;
  }

  if (pathname === "/api/clobe/reconcile" && method === "POST") {
    const body = await readBody(req);
    const startDate = String(body.startDate || "").trim();
    const endDate = String(body.endDate || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) {
      sendJson(res, 400, { error: "조회 시작일과 종료일을 yyyy-MM-dd 형식으로 지정하세요." });
      return;
    }
    try {
      // 양방향을 모두 가져온다. 요청마다 기대 방향이 다르므로 매칭 단계에서 가른다.
      const transactions = await clobeFetchTransactions(db, { startDate, endDate });
      const unpaid = db.requests
        .filter((item) => item.status !== "paid" && item.status !== "deleted")
        .map((item) => ({
          id: item.id,
          orderNo: item.orderNo,
          brandId: item.brandId,
          brandName: item.brandName,
          customerName: item.customerName,
          depositorName: item.depositorName,
          status: item.status,
          expectedAmount: finalDepositAmount(item),
          expectedDepositDate: item.expectedDepositDate,
          createdAt: item.createdAt,
          // 입금요청은 종류를 불문하고 우프가 브랜드에 지급하는 건이라 통장에서는
          // 출금이다. 위탁도 마찬가지 — 수수료를 공제하고 익월 말에 지급한다.
          // 실제 거래로 확인: 올데이올가닉·라이펫 등 위탁 브랜드 거래 7건이 모두 출금.
          direction: "OUT"
        }));
      const result = reconcile({
        requests: unpaid,
        transactions,
        options: { windowDays: Number(db.clobe.windowDays || 7), accountIds: db.clobe.accountIds }
      });
      db.clobe.lastSyncAt = now();
      await writeDb(db);
      sendJson(res, 200, { ...result, range: { startDate, endDate } });
    } catch (error) {
      sendJson(res, error.needsReauth ? 401 : 502, { error: error.message });
    }
    return;
  }

  if (pathname === "/api/clobe/tax-invoices" && method === "GET") {
    try {
      const payload = await clobeCall(db, "get_tax_invoices", {
        companyId: db.clobe.companyId,
        startDate: url.searchParams.get("startDate") || "",
        endDate: url.searchParams.get("endDate") || "",
        ...(url.searchParams.get("type") ? { type: url.searchParams.get("type") } : {}),
        ...(url.searchParams.get("q") ? { searchParam: url.searchParams.get("q") } : {}),
        size: 100
      });
      sendJson(res, 200, payload);
    } catch (error) {
      sendJson(res, error.needsReauth ? 401 : 502, { error: error.message });
    }
    return;
  }

  // --- NPB (도톤 운영대행) settlement endpoints (plan §F) -------------------
  // 상품명 별칭. 한 번 지정하면 그 이름은 다음부터 자동으로 인식된다.
  if (pathname === "/api/npb/aliases" && method === "POST") {
    const body = await readBody(req);
    const items = Array.isArray(body.aliases) ? body.aliases : [];
    if (!items.length) { sendJson(res, 400, { error: "저장할 매칭이 없습니다." }); return; }
    if (!Array.isArray(db.npb.productAliases)) db.npb.productAliases = [];
    let saved = 0;
    for (const item of items) {
      const sourceName = String(item.sourceName || "").trim();
      const productId = String(item.productId || "").trim();
      if (!sourceName || !productId) continue;
      const brandId = String(item.brandId || "doteon");
      const key = npbNormalizeName(sourceName);
      const existing = db.npb.productAliases.find(
        (a) => a.brandId === brandId && npbNormalizeName(a.sourceName) === key
      );
      const product = (db.npb.products || []).find((p) => p.id === productId);
      const tier = String(item.tier || "");
      const label = product ? `${product.name}${tier ? ` ${tier}` : ""}` : sourceName;
      if (existing) {
        Object.assign(existing, { productId, tier, label, updatedAt: now() });
      } else {
        db.npb.productAliases.push({
          id: id("npbalias"), brandId, sourceName, productId, tier, label, createdAt: now()
        });
      }
      saved += 1;
    }
    addAudit(db, actor, "update", "npb_alias", "aliases", `상품명 매칭 ${saved}건 저장`, null, null);
    await writeDb(db);
    sendJson(res, 200, { saved, aliases: db.npb.productAliases });
    return;
  }

  if (pathname === "/api/npb/config" && method === "GET") {
    const brand = npbGetBrand(db, url.searchParams.get("brand") || "doteon");
    if (!brand) { sendJson(res, 404, { error: "브랜드를 찾을 수 없습니다." }); return; }
    // 브랜드가 여럿이므로 그 브랜드 것만 내려준다 — 안 그러면 픽키 워크시트에
    // 도톤 채널이 함께 뜬다. brandId 가 없는 예전 항목은 도톤 것으로 본다.
    const ofBrand = (item) => npbSameBrand(item.brandId, brand.id);
    sendJson(res, 200, {
      brand: brand.id,
      brands: (db.npb.brands || []).map((b) => ({
        id: b.id, name: b.name, businessName: b.businessName || "", productLine: b.productLine || ""
      })),
      channels: (db.npb.channels || []).filter(ofBrand),
      costConfig: brand.costConfig || {},
      products: (db.npb.products || []).filter(ofBrand),
      channelLineConfigs: (db.npb.channelLineConfigs || []).filter(
        (lc) => (db.npb.channels || []).some((c) => c.code === lc.channelCode && ofBrand(c))
      ),
      productAliases: (db.npb.productAliases || []).filter((a) => npbSameBrand(a.brandId, brand.id)),
      defaultProfitSplit: db.npb.defaultProfitSplit || []
    });
    return;
  }

  if (pathname === "/api/npb/config" && method === "PUT") {
    const body = await readBody(req);
    const brand = npbGetBrand(db, body.brand || "doteon");
    if (!brand) { sendJson(res, 404, { error: "브랜드를 찾을 수 없습니다." }); return; }
    if (Array.isArray(body.channels)) {
      // 이 브랜드 채널만 교체한다. 전체를 덮어쓰면 다른 브랜드 채널이 사라진다.
      const others = (db.npb.channels || []).filter(
        (c) => !npbSameBrand(c.brandId, brand.id)
      );
      db.npb.channels = [...others, ...body.channels.map((c) => ({ ...c, brandId: brand.id }))];
    }
    if (body.costConfig && typeof body.costConfig === "object") {
      brand.costConfig = { ...brand.costConfig, ...body.costConfig };
    }
    if (Array.isArray(body.products)) {
      // 이 브랜드 상품만 교체한다.
      const others = (db.npb.products || []).filter(
        (p) => String(p.brandId || "doteon") !== brand.id
      );
      db.npb.products = [...others, ...body.products.map((p) => ({ ...p, brandId: brand.id }))];
    }
    const parties = body.parties || body.defaultProfitSplit;
    if (Array.isArray(parties)) db.npb.defaultProfitSplit = parties;
    await writeDb(db);
    sendJson(res, 200, {
      brand: brand.id,
      channels: db.npb.channels,
      costConfig: brand.costConfig,
      defaultProfitSplit: db.npb.defaultProfitSplit
    });
    return;
  }

  if (pathname === "/api/npb/settlements" && method === "GET") {
    const brandCode = String(url.searchParams.get("brand") || "").trim().toLowerCase();
    const list = (db.npb.settlements || [])
      .filter((item) => !brandCode || String(item.brand).toLowerCase() === brandCode)
      .map((item) => ({
        key: item.key,
        brand: item.brand,
        period: item.period,
        status: item.status,
        issuedAt: item.issuedAt || "",
        rollup: item.rollup
          ? {
              qtyTotal: item.rollup.qtyTotal,
              realSaleTotal: item.rollup.realSaleTotal,
              revenueTotal: item.rollup.revenueTotal,
              profit: item.rollup.profit
            }
          : null
      }));
    sendJson(res, 200, { settlements: list });
    return;
  }

  if (pathname === "/api/npb/settlements" && method === "POST") {
    const body = await readBody(req);
    const brand = npbGetBrand(db, body.brand || "doteon");
    if (!brand) { sendJson(res, 404, { error: "브랜드를 찾을 수 없습니다." }); return; }
    const raw = String(body.periodMonth || "").trim();
    const match = raw.match(/^(\d{4})[-/]?(\d{1,2})$/);
    if (!match) { sendJson(res, 400, { error: "정산 월(YYYY-MM)을 입력하세요." }); return; }
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (month < 1 || month > 12) { sendJson(res, 400, { error: "정산 월이 올바르지 않습니다." }); return; }
    const brandLabel = String(body.brand || brand.id).toUpperCase();
    const key = `${brandLabel}_${year}${String(month).padStart(2, "0")}`;
    if (npbFindSettlement(db, key)) {
      sendJson(res, 409, { error: "이미 존재하는 정산 월입니다.", key });
      return;
    }
    const settlement = {
      key,
      brand: brandLabel,
      period: { year, month },
      status: "draft",
      uploads: {},
      lines: [],
      logistics: {},
      inventory: [],
      rollup: null,
      profitSplit: [],
      parties: (db.npb.defaultProfitSplit || []).map((party) => ({ ...party })),
      carryOver: 0,
      createdAt: now(),
      updatedAt: now()
    };
    db.npb.settlements.push(settlement);
    await writeDb(db);
    sendJson(res, 201, { settlement });
    return;
  }

  if (pathname.startsWith("/api/npb/settlements/")) {
    const segments = pathname.split("/");
    const key = decodeURIComponent(segments[4] || "");
    const action = segments[5] || "";
    const settlement = npbFindSettlement(db, key);
    if (!settlement) { sendJson(res, 404, { error: "정산을 찾을 수 없습니다." }); return; }

    if (!action && method === "GET") {
      sendJson(res, 200, { settlement });
      return;
    }

    if (action === "upload" && method === "POST") {
      const body = await readBody(req);
      const kind = body.kind === "logistics" ? "logistics" : "channel";
      if (!body.fileBase64) { sendJson(res, 400, { error: "업로드할 파일이 없습니다." }); return; }
      // Files can't be read by openpyxl in two cases; give actionable messages
      // instead of a cryptic parse failure:
      //  1) OLE2 (magic D0CF11E0) WITH an EncryptedPackage stream = a
      //     password-encrypted .xlsx (the WMS export protects it). Needs the
      //     password removed, not a format conversion.
      //  2) OLE2 without that stream = an old binary .xls.
      const fileBuf = Buffer.from(String(body.fileBase64 || ""), "base64");
      const isOle = fileBuf.length >= 4 && fileBuf.readUInt32BE(0) === 0xd0cf11e0;
      if (isOle) {
        const encMarker = Buffer.from("EncryptedPackage", "utf16le");
        if (fileBuf.includes(encMarker)) {
          sendJson(res, 400, {
            error:
              "이 파일은 비밀번호로 암호화되어 있습니다. Excel에서 파일을 연 뒤 " +
              "'검토 → 통합 문서 보호 → 암호 제거'(또는 '다른 이름으로 저장 → 도구/옵션에서 암호 삭제')로 " +
              "암호를 없앤 .xlsx로 저장해 올려주세요."
          });
          return;
        }
        sendJson(res, 400, {
          error:
            "이 파일은 구형 .xls(바이너리) 형식입니다. 확장자만 .xlsx로 바꾸면 안 되고, " +
            "Excel에서 '파일 → 다른 이름으로 저장 → Excel 통합 문서(.xlsx)'로 실제 변환해서 올려주세요."
        });
        return;
      }
      if (/\.xls$/i.test(body.fileName || "")) {
        sendJson(res, 400, {
          error: "구형 .xls 파일은 읽을 수 없습니다. Excel에서 '다른 이름으로 저장 → .xlsx'로 변환한 뒤 올려주세요."
        });
        return;
      }
      try {
        if (kind === "channel") {
          // 채널을 명시하지 않으면 파일명으로 찾는다. 한 곳에 몰아서 올리고
          // 파일명이 채널을 결정하게 하는 것이 실제 업무 흐름에 맞다.
          const matches = body.channel ? [] : npbMatchChannels(db.npb.channels, body.fileName);
          const channelCode = body.channel || matches[0]?.code || "";
          if (!channelCode) {
            sendJson(res, 400, {
              error: `파일명으로 채널을 알 수 없습니다: ${body.fileName || "(이름 없음)"}. ` +
                `채널 설정에서 그 채널의 '파일명 키워드'를 등록하거나, 아래에서 채널을 직접 고르세요.`,
              needsChannel: true,
              fileName: body.fileName || ""
            });
            return;
          }
          const parsed = await runNpbParse(body.fileBase64, body.fileName, channelCode);
          // 판매처 상품명을 상품표·별칭으로 맞춘다. 못 맞춘 것은 화면에서
          // 한 번 지정하면 별칭으로 남아 다음부터 자동 인식된다.
          const uploadProducts = (db.npb.products || []).filter(
            (p) => npbSameBrand(p.brandId, settlement.brand)
          );
          const resolvedOut = npbResolveLines(
            parsed.lines || [],
            uploadProducts,
            (db.npb.productAliases || []).filter((a) => npbSameBrand(a.brandId, settlement.brand))
          );
          const parsedLines = resolvedOut.resolved.map((line) => ({
            ...line,
            channel: channelCode
          }));
          settlement.uploads[channelCode] = {
            kind,
            channel: channelCode,
            fileName: body.fileName || "",
            lines: parsedLines,
            warnings: parsed.warnings || [],
            uploadedAt: now()
          };
          // Accumulate parsed lines into the editable grid: drop any prior lines
          // for this channel (idempotent re-upload) and append the fresh ones.
          settlement.lines = (settlement.lines || [])
            .filter((line) => line.channel !== channelCode)
            .concat(parsedLines);
          // 업로드 즉시 집계까지 끝낸다. 사람이 워크시트로 건너가 [저장(계산)]
          // 을 눌러야 숫자가 맞는 구조가 병목이었다.
          const computed = npbRecompute(db, settlement);
          await writeDb(db);
          sendJson(res, 200, {
            kind,
            channel: channelCode,
            // 파일명이 여러 채널에 걸렸으면 무엇을 골랐고 무엇이 밀렸는지 알린다.
            alternatives: matches.slice(1).map((m) => ({ code: m.code, name: m.name })),
            rows: parsedLines,
            warnings: parsed.warnings || [],
            unresolved: resolvedOut.unresolved,
            rollup: computed.rollup
          });
        } else {
          const rows = await parseBankXlsxUpload(body.fileBase64);
          settlement.uploads.logistics = {
            kind,
            fileName: body.fileName || "",
            rows,
            uploadedAt: now()
          };
          // 입출고 원장에서 상품별 입고·출고를 바로 채운다. 기초는 전월 마감을
          // 이월하고, 마감 = 기초 + 입고 - 출고 로 계산한다.
          const brandProducts = (db.npb.products || []).filter(
            (p) => npbSameBrand(p.brandId, settlement.brand)
          );
          const derived = npbInventoryFromLogistics(rows, brandProducts);
          const opening = npbPriorClosing(db, settlement);
          const priorRows = new Map((settlement.inventory || []).map((r) => [r.productKey, r]));
          settlement.inventory = brandProducts.map((p) => {
            const kept = priorRows.get(p.id) || {};
            const t = derived.totals.get(p.id) || { inbound: 0, outbound: 0 };
            const open = opening.has(p.id) ? opening.get(p.id) : number(kept.opening);
            // 비매출(협찬·샘플)은 파일로 알 수 없어 입력값을 그대로 둔다.
            const nonSale = number(kept.nonSale);
            return {
              productKey: p.id,
              name: p.name,
              opening: open,
              inbound: t.inbound,
              outbound: t.outbound,
              sold: number(kept.sold),
              nonSale,
              closing: open + t.inbound - t.outbound
            };
          });
          const computed = npbRecompute(db, settlement);
          await writeDb(db);
          sendJson(res, 200, {
            kind,
            rows,
            inventory: settlement.inventory,
            warnings: derived.unmatched.length
              ? [`상품을 알 수 없는 항목 ${derived.unmatched.length}건: ${derived.unmatched.slice(0, 3).join(", ")}`]
              : [],
            rollup: computed.rollup
          });
        }
      } catch (error) {
        sendJson(res, 400, { error: `파일 파싱 실패: ${error.message}` });
      }
      return;
    }

    if (action === "lines" && method === "PUT") {
      const body = await readBody(req);
      if (!Array.isArray(body.lines)) { sendJson(res, 400, { error: "lines 배열이 필요합니다." }); return; }
      settlement.lines = body.lines;
      settlement.updatedAt = now();
      await writeDb(db);
      sendJson(res, 200, { settlement });
      return;
    }

    // 광고비 조회. 시트를 읽어 그 달 집행분만 추린다.
    if (action === "adcost" && method === "GET") {
      const brand = npbGetBrand(db, settlement.brand);
      const sheetUrl = brand?.costConfig?.adCostSheetUrl || "";
      const csvUrl = npbAdCostCsvUrl(sheetUrl);
      if (!csvUrl) {
        sendJson(res, 200, { items: [], total: 0, sheetUrl, note: "광고비 시트가 설정되지 않았습니다." });
        return;
      }
      try {
        const response = await fetch(csvUrl, { redirect: "follow" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        // 로그인 페이지가 오면 시트가 비공개다.
        if (/<html/i.test(text.slice(0, 200))) {
          throw new Error("시트를 읽을 수 없습니다. '링크가 있는 모든 사용자'로 공유해 주세요.");
        }
        const parsed = npbParseAdCost(text, settlement.periodMonth);
        settlement.adCost = { ...parsed, sheetUrl, fetchedAt: now() };
        await writeDb(db);
        sendJson(res, 200, { ...parsed, sheetUrl });
      } catch (error) {
        sendJson(res, 502, { error: `광고비 시트 조회 실패: ${error.message}`, sheetUrl });
      }
      return;
    }

    if (action === "compute" && method === "POST") {
      const body = await readBody(req);
      const result = npbRecompute(db, settlement, body);
      await writeDb(db);
      sendJson(res, 200, result);
      return;
    }

    if (action === "profit-split" && method === "PUT") {
      const body = await readBody(req);
      const parties = body.parties || body.profitSplit;
      if (!Array.isArray(parties)) { sendJson(res, 400, { error: "parties 배열이 필요합니다." }); return; }
      settlement.parties = parties;
      if (settlement.rollup) {
        settlement.profitSplit = npbComputeProfitSplit(settlement.rollup.profit, parties);
      }
      settlement.updatedAt = now();
      await writeDb(db);
      sendJson(res, 200, { parties: settlement.parties, profitSplit: settlement.profitSplit });
      return;
    }

    if (action === "finalize" && method === "POST") {
      settlement.status = "final";
      settlement.issuedAt = now();
      settlement.updatedAt = now();
      await writeDb(db);
      sendJson(res, 200, { settlement });
      return;
    }

    if (action === "xlsx" && method === "GET") {
      try {
        const spec = npbBuildXlsxSpec(db, settlement);
        const buffer = await generateNpbXlsx(spec);
        sendBuffer(res, 200, buffer,
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          { "content-disposition": contentDisposition(`(도톤) ${settlement.key}.xlsx`) });
      } catch (error) {
        sendJson(res, 500, { error: `정산서 생성 실패: ${error.message}` });
      }
      return;
    }

    sendJson(res, 404, { error: "API를 찾을 수 없습니다." });
    return;
  }

  sendJson(res, 404, { error: "API를 찾을 수 없습니다." });
}

async function computeAssetVersion() {
  const targets = ["app.js", "styles.css"];
  const stats = await Promise.all(
    targets.map((name) => stat(path.join(PUBLIC_DIR, name)).catch(() => null))
  );
  const latest = stats.reduce((acc, s) => (s && s.mtimeMs > acc ? s.mtimeMs : acc), 0);
  return Math.floor(latest).toString(36);
}

async function serveStatic(req, res, pathname) {
  const staticPath = pathname === "/" || pathname.startsWith("/share/") ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, staticPath));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, "Forbidden");
    return;
  }
  try {
    const ext = path.extname(filePath);
    const type =
      ext === ".html"
        ? "text/html; charset=utf-8"
        : ext === ".css"
          ? "text/css; charset=utf-8"
          : ext === ".js"
            ? "text/javascript; charset=utf-8"
            : "application/octet-stream";
    let content;
    let cacheControl;
    if (ext === ".html") {
      const raw = await readFile(filePath, "utf8");
      const version = await computeAssetVersion();
      content = raw
        .replaceAll("/styles.css", `/styles.css?v=${version}`)
        .replaceAll("/app.js", `/app.js?v=${version}`);
      cacheControl = "no-cache";
    } else {
      content = await readFile(filePath);
      cacheControl = "public, max-age=31536000, immutable";
    }
    endMaybeGzip(res, 200, { "content-type": type, "cache-control": cacheControl }, content);
  } catch {
    res.writeHead(302, { location: "/" });
    res.end();
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) {
      await routeApi(req, res, url);
    } else {
      await serveStatic(req, res, url.pathname);
    }
  } catch (error) {
    // 동시 저장 충돌은 서버 오류가 아니라 다시 시도하면 되는 상황이다.
    if (error.status === 409) {
      sendJson(res, 409, { error: error.message });
      return;
    }
    console.error(error);
    sendJson(res, 500, { error: "서버 오류가 발생했습니다.", detail: error.message });
  }
});

// Only bootstrap the DB and bind the port when run directly (node server.js).
// Importing this module (e.g. scripts/npb_calc_verify.mjs) must have no side
// effects — pure functions are re-used without starting the server.
const isMainModule = Boolean(process.argv[1]) &&
  realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
if (isMainModule) {
  await ensureDb();
  server.listen(PORT, HOST, () => {
    console.log(`WooofPay running at http://${HOST}:${PORT}`);
  });
}
