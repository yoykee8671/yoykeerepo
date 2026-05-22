import http from "node:http";
import { readFile, writeFile, mkdir, stat, unlink } from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import os from "node:os";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "public");
const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "db.json");
const PRICE_WORKBOOK_SCRIPT = path.join(__dirname, "scripts", "price_entry_excel.py");
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

const settlementTypes = new Set(["prepay_debt", "prepay_fee", "prepay_supply", "consignment"]);
const shippingPolicyTypes = new Set(["free", "flat", "threshold"]);
const requestStatuses = new Set(["pending", "paid", "hold", "error", "consignment_unpaid", "deleted"]);

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
  const parsed = Number(value);
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

function buildPromotionContext(db, brand = {}, lineItems = [], onDate = "") {
  const activeRules = getActivePromotionRules(db, brand?.id, onDate);
  const brandRate = number(brand?.commissionRate);
  const allRule = activeRules.find((rule) => (rule.scopeType || "all") === "all") || null;
  const itemRules = activeRules.filter((rule) => (rule.scopeType || "all") === "items");
  if (!lineItems.length) {
    if (!allRule) return null;
    return {
      primaryRuleId: allRule.id,
      name: allRule.name,
      commissionRate: number(allRule.commissionRate),
      commissionAmount: null,
      appliedRules: [promotionRuleWithRefs(db, allRule)]
    };
  }
  let salesTotal = 0;
  let commissionTotal = 0;
  const appliedRules = [];
  const seen = new Set();
  for (const item of lineItems) {
    const lineSales = number(item.totalSaleAmount);
    if (!lineSales) continue;
    salesTotal += lineSales;
    const key = normalizeItemKey(item.itemCode, item.itemName);
    const itemRule = itemRules.find((rule) => sanitizePromotionTargets(rule.targetItems).some((target) => target.key === key)) || null;
    const matchedRule = itemRule || allRule;
    const rate = matchedRule ? number(matchedRule.commissionRate) : brandRate;
    commissionTotal += Math.round(lineSales * (rate / 100));
    if (matchedRule && !seen.has(matchedRule.id)) {
      seen.add(matchedRule.id);
      appliedRules.push(promotionRuleWithRefs(db, matchedRule));
    }
  }
  if (!appliedRules.length) return allRule ? {
    primaryRuleId: allRule.id,
    name: allRule.name,
    commissionRate: number(allRule.commissionRate),
    commissionAmount: null,
    appliedRules: [promotionRuleWithRefs(db, allRule)]
  } : null;
  return {
    primaryRuleId: appliedRules.length === 1 ? appliedRules[0].id : "",
    name: appliedRules.length === 1 ? appliedRules[0].name : `품목별 프로모션 ${appliedRules.length}건`,
    commissionRate: salesTotal > 0 ? Number(((commissionTotal / salesTotal) * 100).toFixed(2)) : brandRate,
    commissionAmount: commissionTotal,
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

function sendJson(res, status, data, headers = {}) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...headers
  });
  res.end(body);
}

function sendText(res, status, text, type = "text/plain; charset=utf-8", headers = {}) {
  res.writeHead(status, {
    "content-type": type,
    "cache-control": "no-store",
    ...headers
  });
  res.end(text);
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
  const pending = requests.filter((item) => item.status === "pending").length;
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
  const pending = realtimeRequests.filter((item) => item.status === "pending");
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
      const unitSalePrice = number(item.unitSalePrice, number(item.salePrice));
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
        unitSalePrice,
        totalSaleAmount,
        effectiveFrom: dateOnly(item.effectiveFrom)
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
  const commissionRate = promotionContext ? number(promotionContext.commissionRate) : number(input.commissionRate, number(brand.commissionRate));
  const derivedSupplyAmount = lineItems.reduce((sum, item) => sum + number(item.totalSupplyPrice), 0);
  const supplyAmount = lineItems.length ? derivedSupplyAmount : number(input.supplyAmount);
  const commissionAmount = Number.isFinite(promotionContext?.commissionAmount)
    ? number(promotionContext.commissionAmount)
    : Math.round(effectiveProductSalesAmount * (commissionRate / 100));
  const hasReceivable = input.hasReceivable === true || input.hasReceivable === "true" || brand.hasReceivable || settlementType === "prepay_debt";
  const receivableMargin = Math.max(0, effectiveProductSalesAmount - supplyAmount - (settlementType === "prepay_supply" && hasReceivable ? baseShippingFee : 0));

  let depositAmount = number(input.depositAmount);
  if (settlementType === "prepay_debt") {
    depositAmount = effectiveProductSalesAmount + shippingFee;
  } else if (settlementType === "prepay_supply") {
    depositAmount = hasReceivable ? effectiveProductSalesAmount + extraShippingFee : supplyAmount + shippingFee;
  } else if (settlementType === "prepay_fee" || settlementType === "consignment") {
    depositAmount = effectiveProductSalesAmount - commissionAmount + shippingFee;
  }

  return {
    settlementType,
    productSalesAmount: effectiveProductSalesAmount,
    baseShippingFee,
    extraShippingFee,
    extraShippingNote: String(input.extraShippingNote || "").trim(),
    shippingFee,
    promotionRuleId: promotionContext?.primaryRuleId || "",
    promotionRuleName: promotionContext?.name || "",
    appliedPromotionRules: promotionContext?.appliedRules || [],
    commissionRate,
    commissionAmount,
    supplyAmount,
    depositAmount,
    receivableDeduction: hasReceivable ? (settlementType === "prepay_supply" ? receivableMargin : commissionAmount) : 0,
    lineItems
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
  ["depositorName", "입금자명"],
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
    const brand = db.brands.find((item) => item.id === body.brandId && item.type === "brand");
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
    const hasOverlap = isActive && (db.promotionRules || []).some((rule) => {
      if (rule.brandId !== brand.id || rule.isActive === false) return false;
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
      commissionRate: number(body.commissionRate),
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
    const hasOverlap = isActive && (db.promotionRules || []).some((item) => {
      if (item.id === rule.id || item.brandId !== rule.brandId || item.isActive === false) return false;
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
    if ("commissionRate" in body) rule.commissionRate = number(body.commissionRate);
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
      "googleSheetUrl"
    ]) {
      if (key in body) brand[key] = body[key];
    }
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
    db.requests.unshift(request);
    addAudit(db, actor, "create", "request", request.id, `${request.orderNo} 입금요청 생성`, null, request);
    if (request.brandId) {
      await syncArchive(db, actor, request.brandId, "request_created");
    }
    await writeDb(db);
    sendJson(res, 201, { request });
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
    for (const brandId of touchedBrands) {
      await syncArchive(db, actor, brandId, "request_paid");
    }
    if (updated.length) await writeDb(db);
    sendJson(res, 200, { updatedRequests: updated, skippedRequestIds: skipped.map((item) => item.id), batchId });
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
    for (const brandId of touchedBrands) {
      await syncArchive(db, actor, brandId, "request_deleted");
    }
    await writeDb(db);
    sendJson(res, 200, { deletedRequests: updated });
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
      "overpaidAmount",
      "overpaidReason",
      "overpaidNote",
      "creditUsedAmount",
      "creditUsedNote"
    ]) {
      if (key in body) {
        if (key === "sourceRow") {
          request[key] = Number(body[key] || 0);
        } else if (key === "overpaidAmount" || key === "creditUsedAmount") {
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
    for (const brandId of brandIds) {
      await syncArchive(db, actor, brandId, "request_updated");
    }
    await writeDb(db);
    sendJson(res, 200, { request });
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
    if (before.brandId) {
      await syncArchive(db, actor, before.brandId, "request_deleted");
    }
    await writeDb(db);
    sendJson(res, 200, { ok: true });
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
    res.writeHead(200, { "content-type": type, "cache-control": cacheControl });
    res.end(content);
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
