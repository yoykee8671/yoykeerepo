import http from "node:http";
import { readFile, writeFile, mkdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import { gzipSync } from "node:zlib";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "db.json");
const PRICE_WORKBOOK_SCRIPT = path.join(__dirname, "scripts", "price_entry_excel.py");
const SETTLEMENT_SCRIPT = path.join(__dirname, "scripts", "settlement_excel.py");
const XLSX_PARSE_SCRIPT = path.join(__dirname, "scripts", "xlsx_to_json.py");
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

function shippingRuleText(policyType, flatFee, thresholdAmount, thresholdFee) {
  if (policyType === "flat") return flatFee > 0 ? `무조건 ${flatFee.toLocaleString("ko-KR")}원` : "무조건 0원";
  if (policyType === "threshold") {
    return `${thresholdAmount.toLocaleString("ko-KR")}원 미만 ${thresholdFee.toLocaleString("ko-KR")}원`;
  }
  return "무료배송";
}

function normalizeShippingPolicy(input = {}, current = {}) {
  const policyType = shippingPolicyTypes.has(input.shippingPolicyType) ? input.shippingPolicyType : current.shippingPolicyType || "free";
  const shippingFlatFee = number(input.shippingFlatFee, number(current.shippingFlatFee));
  const shippingThresholdAmount = number(input.shippingThresholdAmount, number(current.shippingThresholdAmount));
  const shippingThresholdFee = number(input.shippingThresholdFee, number(current.shippingThresholdFee));
  return {
    shippingPolicyType: policyType,
    shippingFlatFee,
    shippingThresholdAmount,
    shippingThresholdFee,
    shippingRule: shippingRuleText(policyType, shippingFlatFee, shippingThresholdAmount, shippingThresholdFee)
  };
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
  return safe;
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
      createdAt,
      updatedAt: createdAt
    };
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
    paymentLogs: []
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
    touch(brand, "shippingRule", "");
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
  return { db, changed };
}

let cachedDb = null;
async function readDb() {
  await ensureDb();
  if (pgPool) {
    if (cachedDb) return cachedDb;
    cachedDb = await readPostgresDb();
    return cachedDb;
  }
  return JSON.parse(await readFile(DB_PATH, "utf8"));
}

async function writeDb(db) {
  if (pgPool) {
    await writePostgresDb(db);
    cachedDb = db;
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

async function writePostgresDb(db) {
  await pgPool.query(
    `
      insert into app_state (id, state, updated_at)
      values ($1, $2::jsonb, now())
      on conflict (id)
      do update set state = excluded.state, updated_at = now()
    `,
    [POSTGRES_STATE_ROW_ID, JSON.stringify(db)]
  );
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
function endMaybeGzip(res, status, headers, body) {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const accept = res.req?.headers?.["accept-encoding"] || "";
  if (buffer.length >= 1024 && /\bgzip\b/.test(accept)) {
    const zipped = gzipSync(buffer);
    res.writeHead(status, { ...headers, "content-encoding": "gzip", vary: "accept-encoding" });
    res.end(zipped);
    return;
  }
  res.writeHead(status, headers);
  res.end(buffer);
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
function cafe24UnitPrice(row) {
  return number(row["판매가"]) + number(row["옵션추가 가격"]);
}
function cafe24RowSaleAmount(row) {
  return cafe24UnitPrice(row) * Math.max(1, number(row["수량"], 1));
}

// Sum bank withdrawals (출금) attributable to a brand for the given month.
// All withdrawal rows in the bank file attributable to this brand (no month
// filter — per-order matching decides relevance). Each row carries its ym so
// callers can tell in-month vs out-of-month entries apart.
function bankBrandWithdrawals(bankRows, brand) {
  const labels = [String(brand.bankLabel || "").trim(), String(brand.name || "").trim()]
    .filter(Boolean)
    .map((s) => s.toUpperCase());
  const rows = [];
  const coverage = new Set();
  for (const r of bankRows) {
    const y = Number(r["거래 연도"] || 0);
    const m = Number(r["거래 월"] || 0);
    if (y && m) coverage.add(`${y}-${String(m).padStart(2, "0")}`);
    const out = number(r["출금"]);
    if (!out) continue;
    const label = String(r["거래처 라벨"] || "").trim().toUpperCase();
    const payer = String(r["거래자명"] || "").trim().toUpperCase();
    const memo = String(r["적요"] || "").trim().toUpperCase();
    const hit = labels.some((l) => l && (label === l || payer.includes(l) || memo.includes(l)));
    if (!hit) continue;
    rows.push({
      amount: out,
      ym: y && m ? `${y}-${String(m).padStart(2, "0")}` : "",
      date: r["거래일시"] || "",
      memo: r["적요"] || "",
      used: false
    });
  }
  return { rows, coverage };
}

// Canonical(정가) price matcher for catalog-basis brands (예: 고공캣). Matches a
// cafe24 product name against the brand's price catalog + aliases; the longest
// matched text wins so "캣모나이트 리필 (3개입)" beats "캣모나이트".
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
  const rate = number(brand.commissionRate);
  const suppliers = distinctCafe24Suppliers(cafe24Rows);

  if (!String(brand.cafe24Supplier || "").trim()) {
    return { needsMapping: true, suppliers, settlementType };
  }

  // data2: cafe24 rows for this brand
  const brandRows = cafe24Rows.filter((r) => cafe24RowMatchesBrand(r, brand));

  const cancels = [];
  const includedByOrder = new Map(); // orderNo -> [delivered cafe24 rows]
  const allRowsByOrder = new Map(); // orderNo -> [all non-cancelled rows] (부분배송 대조용)
  let excludedCount = 0;
  for (const r of brandRows) {
    const orderNo = String(r["주문번호"] || "").trim();
    const orderDate = orderNo.slice(0, 8);
    const delivered = Boolean(String(r["배송완료일"] || "").trim());
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
    if (orderDate.startsWith(monthPrefix)) {
      if (!allRowsByOrder.has(orderNo)) allRowsByOrder.set(orderNo, []);
      allRowsByOrder.get(orderNo).push(r);
    }
    if (orderDate.startsWith(monthPrefix) && delivered) {
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
  for (const [orderNo, rowsOfOrder] of includedByOrder) {
    const req = reqByOrder.get(orderNo);
    if (!req) {
      errors.push({ orderNo, type: "missing_request", message: `카페24 배송완료 주문이 입금요청에 없습니다: ${orderNo}` });
      continue;
    }
    const paid = req.status === "paid" || Boolean(req.paidAt);
    if (!paid) {
      errors.push({ orderNo, type: "unpaid", message: `입금완료되지 않은 주문입니다: ${orderNo}` });
    }
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
        const expectedShip = calculateBaseShippingFee(brand, expected);
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
    // Build detail lines from wooofpay lineItems (billing truth). One order's
    // shipping is charged once (attached to the first line).
    const items = sanitizeLineItems(req.lineItems);
    const detail = items.length ? items : [{
      itemName: rowsOfOrder[0]?.["주문상품명(기본)"] || "",
      quantity: number(req.quantity) || 1,
      unitSalePrice: wooofSales,
      totalSaleAmount: wooofSales,
      totalSupplyPrice: number(req.supplyAmount)
    }];
    const orderShip = number(req.shippingFee);
    detail.forEach((it, idx) => {
      seq++;
      const saleTotal = number(it.totalSaleAmount, number(it.unitSalePrice) * number(it.quantity));
      const commissionWon = Math.round(saleTotal * (rate / 100));
      lines.push({
        itemNo: `${orderNo}-${String(idx + 1).padStart(2, "0")}`,
        name: it.itemName || it.itemCode || "",
        qty: number(it.quantity) || 1,
        consumer: number(it.unitSalePrice),
        saleTotal,
        ship: idx === 0 ? orderShip : 0,
        refundShip: 0,
        ratePct: rate,
        commissionWon,
        supplyAmt: saleTotal - commissionWon,
        payDate: req.paidAt || "",
        note: ""
      });
    });
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
  if (bankRows.length) {
    const { rows: bankBrand, coverage } = bankBrandWithdrawals(bankRows, brand);
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
    const leftover = bankBrand.filter((r) => !r.used);
    if (leftover.length) {
      const sum = leftover.reduce((s, r) => s + r.amount, 0);
      warnings.push(`이번 정산과 매칭되지 않은 브랜드 출금 ${leftover.length}건 (합 ${sum.toLocaleString()}원) — 전월/익월분·교환/반품 배송비 등인지 확인하세요.`);
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

function canManageAdmins(actor) {
  return actor?.role === "owner" || actor?.role === "manager";
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
  const baseShippingFee = number(input.baseShippingFee, calculateBaseShippingFee(brand, productSalesAmount));
  const extraShippingFee = number(input.extraShippingFee);
  const shippingFee = baseShippingFee + extraShippingFee;
  const promotionContext = input._promotionContext || null;
  const derivedProductSalesAmount = lineItems.reduce((sum, item) => sum + number(item.totalSaleAmount), 0);
  const effectiveProductSalesAmount = derivedProductSalesAmount > 0 ? derivedProductSalesAmount : productSalesAmount;
  // When line items are present, the promotion context already aggregated the
  // per-line discount (each line may carry its own rule); use it directly.
  // Otherwise fall back to the order-level discount from the brand-wide rule.
  const discountAmount = Number.isFinite(promotionContext?.discountAmount)
    ? number(promotionContext.discountAmount)
    : computeDiscountAmount(promotionContext, effectiveProductSalesAmount);
  const adjustedProductSales = Math.max(0, effectiveProductSalesAmount - discountAmount);
  const commissionRate = promotionContext ? number(promotionContext.commissionRate) : number(input.commissionRate, number(brand.commissionRate));
  const derivedSupplyAmount = lineItems.reduce((sum, item) => sum + number(item.totalSupplyPrice), 0);
  const supplyAmount = lineItems.length ? derivedSupplyAmount : number(input.supplyAmount);
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
    sendJson(res, 200, {
      priceEntries: (db.priceEntries || [])
        .slice()
        .sort((a, b) => (b.effectiveFrom || "").localeCompare(a.effectiveFrom || "") || b.updatedAt.localeCompare(a.updatedAt))
        .map((entry) => priceEntryWithBrand(db, entry)),
      catalog: getLatestPriceCatalog(db).map((entry) => priceEntryWithBrand(db, entry))
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
    Object.assign(brand, normalizeShippingPolicy(brand, before));
    brand.updatedAt = now();
    addAudit(db, actor, "update", "brand", brand.id, `${brand.name} 브랜드 수정`, before, brand);
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

  if (pathname === "/api/admins" && method === "GET") {
    sendJson(res, 200, { admins: db.admins.map(publicAdmin) });
    return;
  }

  if (pathname === "/api/admins" && method === "POST") {
    if (!canManageAdmins(actor)) {
      sendJson(res, 403, { error: "관리자 생성 권한이 없습니다." });
      return;
    }
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
    if (!canManageAdmins(actor)) {
      sendJson(res, 403, { error: "관리자 수정 권한이 없습니다." });
      return;
    }
    const body = await readBody(req);
    const admin = db.admins.find((item) => item.id === adminMatch[1]);
    if (!admin) {
      sendJson(res, 404, { error: "관리자를 찾을 수 없습니다." });
      return;
    }
    const before = publicAdmin(admin);
    for (const key of ["name", "role", "isActive"]) {
      if (key in body) admin[key] = body[key];
    }
    if (body.password) admin.passwordHash = hashPassword(body.password);
    admin.updatedAt = now();
    addAudit(db, actor, "update", "admin", admin.id, `${admin.email} 관리자 수정`, before, publicAdmin(admin));
    await writeDb(db);
    sendJson(res, 200, { admin: publicAdmin(admin) });
    return;
  }

  if (adminMatch && method === "DELETE") {
    if (!canManageAdmins(actor)) {
      sendJson(res, 403, { error: "관리자 삭제 권한이 없습니다." });
      return;
    }
    const index = db.admins.findIndex((item) => item.id === adminMatch[1]);
    if (index === -1) {
      sendJson(res, 404, { error: "관리자를 찾을 수 없습니다." });
      return;
    }
    if (db.admins[index].id === actor.id) {
      sendJson(res, 400, { error: "본인 계정은 삭제할 수 없습니다." });
      return;
    }
    const [before] = db.admins.splice(index, 1);
    addAudit(db, actor, "delete", "admin", before.id, `${before.email} 관리자 삭제`, publicAdmin(before), null);
    await writeDb(db);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (pathname === "/api/audits" && method === "GET") {
    sendJson(res, 200, { auditLogs: db.auditLogs });
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
    let cafe24Rows = [];
    let bankRows = [];
    try {
      if (body.cafe24Csv) cafe24Rows = parseCafe24Csv(body.cafe24Csv);
      if (body.bankXlsx) bankRows = await parseBankXlsxUpload(body.bankXlsx);
    } catch (error) {
      sendJson(res, 400, { error: `파일 파싱 실패: ${error.message}` });
      return;
    }
    if (!cafe24Rows.length) { sendJson(res, 400, { error: "카페24 주문내역(CSV)을 업로드하세요." }); return; }
    const result = computeSettlementResult(db, brand, body.year, body.month, cafe24Rows, bankRows);
    sendJson(res, 200, {
      brand: { id: brand.id, name: brand.name, settlementType: brand.settlementType, cafe24Supplier: brand.cafe24Supplier || "" },
      ...result,
      lines: result.needsMapping ? [] : result.lines
    });
    return;
  }

  if (pathname === "/api/settlement/export" && method === "POST") {
    const body = await readBody(req);
    const brand = db.brands.find((item) => item.id === body.brandId);
    if (!brand) { sendJson(res, 400, { error: "브랜드를 선택하세요." }); return; }
    let cafe24Rows = [];
    let bankRows = [];
    try {
      if (body.cafe24Csv) cafe24Rows = parseCafe24Csv(body.cafe24Csv);
      if (body.bankXlsx) bankRows = await parseBankXlsxUpload(body.bankXlsx);
    } catch (error) {
      sendJson(res, 400, { error: `파일 파싱 실패: ${error.message}` });
      return;
    }
    const result = computeSettlementResult(db, brand, body.year, body.month, cafe24Rows, bankRows);
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
    console.error(error);
    sendJson(res, 500, { error: "서버 오류가 발생했습니다.", detail: error.message });
  }
});

await ensureDb();
server.listen(PORT, HOST, () => {
  console.log(`WooofPay running at http://${HOST}:${PORT}`);
});
