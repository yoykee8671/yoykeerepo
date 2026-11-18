const state = {
  admin: null,
  tab: "dashboard",
  // 공급사 상품 동기화 (MUNIKUND 등). 화면은 renderProductSync 아래에 있다.
  productSync: {
    screen: "issues",
    sourceId: (() => {
      try { return localStorage.getItem("wooofpay.productSync.source") || "munikund"; } catch { return "munikund"; }
    })(),
    overview: null,
    detail: null,
    loading: false,
    loaded: false,
    error: "",
    selected: [],
    issueFilter: "action",
    jobs: {},
    linkForm: null,
    linkCheck: null,
    linkSearch: null,
    candidateNames: {},
    showIgnored: false,
    showUnlinked: false,
    // 신상품 후보 등록일 기간 (비우면 설정의 "최근 며칠")
    candFrom: "",
    candTo: ""
  },
  brands: [],
  requests: [],
  partners: [],
  materials: [],
  purchaseOrders: [],
  deliveryPlaces: [],
  transferAccounts: [],
  priceEntries: [],
  priceCatalog: [],
  aliasEntries: [],
  promotionRules: [],
  paymentLogs: [],
  admins: [],
  audits: [],
  auditsTotal: 0,
  auditsLoaded: false,
  archivesLoaded: false,
  archives: [],
  dashboard: null,
  filters: { q: "", statusValues: null, brandIds: null, settlementTypes: null, promotionRuleId: "", dateFrom: "", dateTo: "" },
  filtersInitialized: false,
  editingRequest: null,
  // 입금요청 저장 직전, 정가 기준 브랜드인데 단가표에 없는 품목이 있으면 여기
  // 채워서 "신규 등록/별칭 연결" 확인 패널을 띄운다. null이면 패널 없음.
  catalogResolve: null,
  editingBrand: null,
  editingAdmin: null,
  editingPermissions: null,
  menus: [],
  actionLabels: {},
  editingPriceEntry: null,
  editingPriceAlias: null,
  editingPromotionRule: null,
  priceFilters: { brandId: "" },
  priceImportStatus: null,
  brandFilterQ: "",
  selectedRequestIds: [],
  bulkPaidAt: new Date().toISOString().slice(0, 10),
  settlement: { year: new Date().getFullYear(), month: new Date().getMonth() + 1, brandId: "", cafe24: null, bank: null, useClobe: true, useCafe24: true, result: null, running: false, comparing: false, compare: null, scan: null, scanning: false, scanShowEmpty: false },
  clobe: {
    status: null,
    loading: false,
    running: false,
    companies: null,
    accounts: null,
    result: null,
    error: "",
    confirming: "",
    showAllAccounts: false,
    startDate: new Date(Date.now() - 13 * 86400000).toISOString().slice(0, 10),
    endDate: new Date().toISOString().slice(0, 10)
  },
  cafe24: { status: null, sample: "", sampling: false, error: "" },
  pipeline: {
    startDate: new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10),
    endDate: new Date().toISOString().slice(0, 10),
    collecting: false, collect: null, selected: [],
    shipping: false, shipped: null, shippedSelected: [], error: "",
    scraping: null
  },
  npb: {
    screen: "list",
    loaded: false,
    loading: false,
    config: null,
    settlements: [],
    current: null,
    currentKey: "",
    periodMonth: `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`,
    brandId: "doteon",
    brands: [],
    parsePreview: null,
    review: null,
    pendingUploads: [],
    logisticsCounts: {},
    unresolved: [],
    aliasDraft: {},
    adCost: null,
    adCostLoading: false,
    worksheet: null,
    inventory: null,
    profitParties: [
      { party: "", ratio: 0, excluded: false, note: "" },
      { party: "", ratio: 0, excluded: false, note: "" },
      { party: "", ratio: 0, excluded: false, note: "" }
    ]
  },
  procurement: {
    screen: "partners",
    editingPartner: null,
    editingMaterial: null,
    editingPurchaseOrder: null,
    editingDeliveryPlace: null,
    partnerFilterCategory: "",
    importStatus: null,
    templateDownloadFor: null,
    docTypeFilter: "",
    formDocType: "purchase_order",
    previewPurchaseOrder: null
  }
};

// 정산 브랜드는 화면에서 고른다. 도톤 외 브랜드도 같은 방식으로 정산한다.
const NPB_DEFAULT_BRAND = "doteon";
const npbBrand = () => state.npb.brandId || NPB_DEFAULT_BRAND;
const PARTNER_CATEGORY_LABELS = { production: "생산업체", sales: "판매납품처", purchase: "매입공급처", issuer: "발행자(자사)" };
// 거래처 1차 분류(여러 개). 서버 PARTNER_ROLES 와 같다. 자사(발행자)는 분류가 아니라 '구분'.
const PARTNER_ROLE_LABELS = { production: "생산", sales: "판매", purchase: "매입", service: "서비스", etc: "기타" };
const isIssuer = (p) => p.category === "issuer";
// 보관 표시: 글자 대신 작은 상자 아이콘(마우스를 올리면 '보관').
const ARCHIVE_ICON = `<span class="archived-ic" title="보관 — 2025년 이후 거래 없음"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/></svg></span>`;
const partnerRoles = (p) => (isIssuer(p) ? [] : Array.isArray(p.roles) && p.roles.length ? p.roles.filter((r) => PARTNER_ROLE_LABELS[r]) : [p.category === "sales" ? "sales" : p.category === "purchase" ? "purchase" : "production"]);
const PARTNER_ROLE_COLORS = { production: "orange", sales: "blue", purchase: "green", service: "purple", etc: "grey" };
// 목록에서 분류를 색 칩으로 보여 준다(2차는 1차 색을 따른다).
const partnerTagChips = (p, opt) => {
  if (isIssuer(p)) return tagChip("발행자(자사)", "pink");
  const parentOf = (sub) => Object.keys(PARTNER_ROLE_LABELS).find((k) => (opt?.sub?.[k] || []).includes(sub));
  return [...partnerRoles(p).map((r) => tagChip(PARTNER_ROLE_LABELS[r], PARTNER_ROLE_COLORS[r])), ...(p.subRoles || []).map((sub) => tagChip(sub, PARTNER_ROLE_COLORS[parentOf(sub)] || "grey"))].join("");
};
const partnerTagText = (p) => (isIssuer(p) ? "발행자(자사)" : [...partnerRoles(p).map((r) => PARTNER_ROLE_LABELS[r]), ...(p.subRoles || [])].join(" · "));
const formatBizNo = (v) => { const d = String(v || "").replace(/\D/g, ""); return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : String(v || ""); };
async function ensurePartnerOptions() {
  if (state.partnerOptions || state.partnerOptionsLoading) return;
  state.partnerOptionsLoading = true;
  try { state.partnerOptions = await api("/api/partner-options"); } catch { state.partnerOptions = { sub: {}, orderMethods: [], evidenceTypes: [] }; }
  state.partnerOptionsLoading = false;
  renderApp();
}
const PO_STATUS_LABELS = { ordered: "발주", in_production: "생산중", received: "입고완료", cancelled: "취소" };
// 네 양식은 담기는 내용이 같아 한 목록에 모아 두고 docType으로만 가른다.
// dateLabel/dueLabel은 같은 날짜 칸이 양식마다 다르게 불리는 이름이고,
// defaultCategory는 작성 화면에서 수신처로 먼저 보여줄 거래처 분류다
// (생산처에 발주서, 납품지에 견적·청구·명세 -- 다른 분류도 고를 수 있다).
const TRADE_DOC_TYPES = [
  ["purchase_order", "발주서", { dateLabel: "발주일", dueLabel: "납기일", defaultCategory: "production" }],
  ["statement", "거래명세서", { dateLabel: "거래일자", dueLabel: "", defaultCategory: "sales" }],
  ["invoice", "청구서", { dateLabel: "청구일", dueLabel: "지급기일", defaultCategory: "sales" }],
  ["quote", "견적서", { dateLabel: "견적일", dueLabel: "유효기간", defaultCategory: "sales" }]
];
const TRADE_DOC_LABELS = Object.fromEntries(TRADE_DOC_TYPES.map(([key, label]) => [key, label]));
const TRADE_DOC_META = Object.fromEntries(TRADE_DOC_TYPES.map(([key, , meta]) => [key, meta]));
const tradeDocMeta = (docType) => TRADE_DOC_META[docType] || TRADE_DOC_META.purchase_order;
// '거래' 메뉴: 판매·생산/재고·거래관리를 한 메뉴로(대표 결정 2026-11-15). 화면 자체는 기존 것을 그대로 쓴다.
const TRADE_SCREENS = [
  ["partners", "거래처(사업자)"],
  ["sales", "판매 주문·가격"],
  ["stock", "생산·재고·생산비"],
  ["orders", "명세서·발주서"],
  ["materials", "품목(자재·제품·거래처 상품)"],
  ["deliveryPlaces", "납품지"],
  ["accounts", "입금계좌"]
];
function tradeCan(key) {
  if (key === "sales") return can("sales", "view");
  if (key === "stock") return can("stock", "view");
  return can("procurement", "view");
}
function tradeState() {
  if (!state.trade) state.trade = { screen: (TRADE_SCREENS.find(([k]) => tradeCan(k)) || ["partners"])[0] };
  return state.trade;
}

const PROCUREMENT_SCREENS = [
  ["partners", "거래처관리"],
  ["materials", "원부자재관리"],
  ["deliveryPlaces", "납품지관리"],
  ["accounts", "계좌관리"],
  ["orders", "명세서 발행"]
];

// 거래관리 입력 폼을 새 창으로 띄울 때 쓰는 표 — 창이 어느 화면의 어떤
// 레코드를 편집하는지, 저장 후 부모 창에 뭐라고 알릴지를 한 곳에 적는다.
const PROCUREMENT_POPUPS = {
  partner: {
    screen: "partners",
    editKey: "editingPartner",
    collection: "partners",
    title: "거래처",
    desc: "거래처 정보를 입력한 뒤 저장하면 목록 창에 바로 반영됩니다.",
    render: () => renderPartnerForm(),
    bind: () => bindPartners()
  },
  material: {
    screen: "materials",
    editKey: "editingMaterial",
    collection: "materials",
    title: "원부자재",
    desc: "원부자재 정보를 입력한 뒤 저장하면 목록 창에 바로 반영됩니다.",
    render: () => renderMaterialForm(),
    bind: () => bindMaterials()
  },
  deliveryPlace: {
    screen: "deliveryPlaces",
    editKey: "editingDeliveryPlace",
    collection: "deliveryPlaces",
    title: "납품지",
    desc: "납품지 정보를 입력한 뒤 저장하면 목록 창에 바로 반영됩니다.",
    render: () => renderDeliveryPlaceForm(),
    bind: () => bindDeliveryPlaces()
  }
};

const PRODUCT_SYNC_SCREENS = [
  ["issues", "확인 필요"],
  ["candidates", "신상품 등록"],
  ["links", "상품 연결표"],
  ["settings", "설정·기록"]
];

const NPB_SCREENS = [
  ["list", "월 목록/이력"],
  ["worksheet", "정산 워크시트"],
  ["upload", "업로드"],
  ["expenses", "실비/청구"],
  ["channels", "채널 설정"],
  ["preview", "미리보기/다운로드"]
];

// Client-side line math — MUST mirror server.js npbComputeLine (rate_on_sale):
// 매출=salePrice*qty, 수수료=round(매출*feeRate), 정산=매출-수수료,
// 정가=listPrice*qty*eaPerUnit. eaPerUnit stays 1 (qty is already total EA).
// 서버의 npbComputeLine 과 같은 규칙으로 계산한다. 화면이 단가×수량만 쓰면
// 파일에서 읽은 금액을 쓰는 채널(네이버·쿠팡)에서 워크시트와 정산서가 서로
// 다른 숫자를 말하게 된다.
// 채널별 끝자리 처리. 서버(npbRound)와 같은 규칙이어야 워크시트와 저장된
// 정산이 1원씩 갈리지 않는다.
function npbRoundBy(value, mode) {
  const n = Number(value || 0);
  if (!Number.isFinite(n)) return 0;
  if (mode === "round") return Math.round(n);
  if (mode === "ceil") return Math.ceil(n);
  if (mode === "floor") return Math.floor(n);
  return n;
}

function npbRowMath(row) {
  const qty = Number(row.qty || 0);
  const ea = Number(row.eaPerUnit || 1) || 1;
  const src = row.source || {};
  const has = (v) => v !== undefined && v !== null && v !== "";
  const mode = String(row.rounding || "");
  const r = (v) => npbRoundBy(v, mode);
  const list = r(has(src.listAmount) ? Number(src.listAmount) : Number(row.listPrice || 0) * qty * ea);
  // 기준가(=salePrice)가 있고 수량이 있으면 매출은 그 곱이다. 서버와 같은 규칙.
  const revenue = r(Number(row.salePrice || 0) > 0 && qty > 0
    ? Number(row.salePrice) * qty
    : (has(src.saleAmount) ? Number(src.saleAmount) : Number(row.salePrice || 0) * qty));
  if (has(src.settleAmount)) {
    const settle = r(src.settleAmount);
    return { revenue, fee: revenue - settle, settle, list, fromFile: true };
  }
  const fee = has(src.feeAmount)
    ? r(src.feeAmount)
    : (mode ? npbRoundBy(revenue * Number(row.feeRate || 0), mode)
      : Math.round(revenue * Number(row.feeRate || 0)));
  return { revenue, fee, settle: revenue - fee, list, fromFile: has(src.saleAmount) };
}

// The answer-key channel order for the worksheet blocks.
// 업로드한 파일을 어디까지 자동으로 반영할지. 채널마다 자료 사정이 달라
// 한 규칙으로 묶을 수 없다.
const NPB_ENTRY_MODES = [
  ["direct", "그대로 반영", "파일을 읽는 즉시 워크시트에 넣습니다."],
  ["review", "파싱에서 수정", "검수표에서 행별로 고친 뒤 [확정/반영] 을 누릅니다."],
  ["worksheet", "워크시트에서 수정", "일단 반영하고 워크시트에서 고칩니다."],
  ["summary", "합계만 기재", "품목 내역 없이 채널 합계만 워크시트에 적습니다. 파일은 근거로만 남습니다."]
];

// 채널별 끝자리 처리. 판매처 정산서가 소수로 오는 채널이 있어 받는 쪽 표와
// 1원씩 어긋난다. 기본값은 "그대로" 라서, 켜지 않은 채널과 이미 확정한 달의
// 금액은 이 설정이 생겼다고 달라지지 않는다.
const NPB_ROUNDING_MODES = [
  ["", "그대로"],
  ["round", "반올림"],
  ["ceil", "올림"],
  ["floor", "내림"]
];

const NPB_WS_ORDER = [
  "mongshu", "smartstore", "tailit", "emart", "wooofmall", "gongu",
  "b2b", "kurly", "coupang", "tarimarket", "pharmasquare"
];

// Map a parser productKey (foot/spray) to a config productId (fc/os).
function npbProductId(key) {
  const k = String(key || "").toLowerCase();
  if (k === "fc" || k === "foot") return "fc";
  if (k === "os" || k === "spray") return "os";
  return k;
}

const app = document.querySelector("#app");
// 금액은 거래명세서·세금계산서 관례대로 항상 1원 단위 정수로만 표기한다.
const money = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 0 });
// Amount helpers: parse a possibly comma-formatted string to a number, and
// format a number with thousands separators for display in money inputs.
function parseAmount(value) {
  const n = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}
function formatAmount(value) {
  if (value === "" || value === null || value === undefined) return "";
  const n = parseAmount(value);
  return n ? money.format(n) : (Number(value) === 0 && String(value) !== "" ? "0" : "");
}
const uiParams = new URLSearchParams(location.search);
const isRequestPopup = uiParams.get("request-popup") === "1";
const isBrandPopup = uiParams.get("brand-popup") === "1";
const popupRequestId = uiParams.get("request-id") || "";
const popupBrandId = uiParams.get("brand-id") || "";
const popupDraftPrefill = uiParams.get("draft-prefill") === "1";
// 거래관리 입력 폼들도 입금요청과 같은 "새 창" 방식을 쓴다 — 목록 창은
// 그대로 두고 입력 창만 따로 띄워 두 창을 오가며 작업할 수 있게.
const procurementPopupKind = uiParams.get("procurement-popup") || "";
const procurementPopupId = uiParams.get("record-id") || "";
const RECENT_BRANDS_KEY = "wooofpay_recent_brands";
const DRAFT_PREFILL_KEY = "wooofpay_pipeline_draft_prefill";

// 파이프라인 확인 표의 행별 "입금요청 입력" 버튼이 새 창으로 넘기는 초안을 읽는다.
// 아직 저장 전이라 request-id 로 찾을 수가 없어 localStorage 로 다리를 놓는다 —
// 한 번 읽으면 지워서 다음에 창을 새로고침해도 같은 초안이 다시 뜨지 않게 한다.
function readDraftPrefill() {
  try {
    const raw = localStorage.getItem(DRAFT_PREFILL_KEY);
    localStorage.removeItem(DRAFT_PREFILL_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    return draft && typeof draft === "object" ? { ...draft, id: "" } : null;
  } catch {
    return null;
  }
}

window.addEventListener("message", async (event) => {
  if (event.origin !== location.origin) return;
  if (!state.admin) return;
  const type = event.data?.type;
  if (type === "requestSaved" && !isRequestPopup) {
    await refreshAndRender();
    return;
  }
  if (type === "procurementSaved" && !procurementPopupKind) {
    await refreshAndRender();
    return;
  }
  if (type === "brandSaved") {
    if (isRequestPopup) {
      await loadAll();
      const form = app.querySelector("[data-request-form]");
      const brandId = form?.querySelector("[name='brandId']")?.value;
      const updatedBrandId = event.data.brandId;
      if (form && brandId && (!updatedBrandId || brandId === updatedBrandId)) {
        const brand = state.brands.find((b) => b.id === brandId);
        if (brand) {
          const baseShipping = form.querySelector("[name='baseShippingFee']");
          const wasBaseManual = baseShipping?.dataset.manual === "1";
          applyBrandDefaults(form, brand);
          if (wasBaseManual && baseShipping) baseShipping.dataset.manual = "1";
          updateRequestCalculation(form);
        }
      }
      showToast("브랜드 정보가 반영되었습니다.");
      return;
    }
    await refreshAndRender();
  }
});

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    credentials: "same-origin",
    ...options,
    body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body
  });
  const isJson = response.headers.get("content-type")?.includes("application/json");
  const data = isJson ? await response.json() : await response.text();
  if (response.ok && data && typeof data === "object" && typeof data.warning === "string") {
    setTimeout(() => showToast(data.warning, "error"), 0);
  }
  if (!response.ok) {
    const error = new Error(data?.error || "요청에 실패했습니다.");
    if (data?.details) error.details = data.details;
    error.payload = data;
    throw error;
  }
  return data;
}

// Several GETs in one round trip (/api/batch). Returns data in the same order;
// a failed sub-call becomes an Error object unless `throwOnError`.
async function apiBatch(paths, { throwOnError = true } = {}) {
  // 이미 받아 둔 목록은 해시를 보내고, 서버는 바뀌지 않았으면 내용 없이 same 만 돌려준다
  // (저장 뒤 다시 불러올 때 바뀐 목록만 내려온다). 기억은 이 탭의 메모리에만 둔다.
  const cache = (state.batchCache ||= {});
  const qs = paths.map((p) => `p=${encodeURIComponent(p)}&v=${encodeURIComponent(cache[p]?.hash || "")}`).join("&");
  const { results } = await api(`/api/batch?${qs}`);
  return paths.map((p) => {
    const r = results[p] || { status: 500, data: {} };
    if (r.status < 400 && r.same && cache[p]) return structuredClone(cache[p].data);
    if (r.status < 400) {
      if (r.hash) cache[p] = { hash: r.hash, data: structuredClone(r.data) };
      return r.data;
    }
    const error = new Error(r.data?.error || "요청에 실패했습니다.");
    error.status = r.status;
    error.payload = r.data;
    if (throwOnError) throw error;
    return error;
  });
}

function h(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function statusLabel(status) {
  return {
    pending: "입금요청",
    await_deposit: "입금대기",
    paid: "입금완료",
    hold: "보류",
    error: "오류",
    consignment_unpaid: "위탁-입금전"
  }[status] || status || "입금요청";
}

// Statuses selectable inline / in bulk (excludes deleted).
const STATUS_CHOICES = ["pending", "await_deposit", "paid", "hold", "error"];

function renderRowStatusSelect(item) {
  const values = STATUS_CHOICES.includes(item.status) ? STATUS_CHOICES : [item.status, ...STATUS_CHOICES];
  const options = values
    .map((v) => `<option value="${h(v)}" ${item.status === v ? "selected" : ""}>${h(statusLabel(v))}</option>`)
    .join("");
  return `<select class="status-select status-${h(item.status)}" data-row-status="${item.id}">${options}</select>`;
}

// Fast inline/bulk status change: optimistic UI + lightweight endpoint, then
// merge the server response without a full reload (keeps it snappy).
async function changeRequestStatus(ids, status, paidAt = "") {
  const clean = Array.from(new Set(ids)).filter(Boolean);
  if (!clean.length || !status) return;
  const prev = new Map();
  state.requests.forEach((r) => {
    if (clean.includes(r.id)) {
      prev.set(r.id, r.status);
      r.status = status;
    }
  });
  renderApp();
  try {
    const result = await api("/api/requests/set-status", { method: "POST", body: { requestIds: clean, status, paidAt } });
    const map = new Map((result.updatedRequests || []).map((r) => [r.id, r]));
    state.requests = state.requests.map((r) => (map.has(r.id) ? { ...r, ...map.get(r.id) } : r));
    renderApp();
    showToast(clean.length > 1 ? `${clean.length}건 상태 변경` : "상태를 변경했습니다.");
  } catch (error) {
    state.requests.forEach((r) => { if (prev.has(r.id)) r.status = prev.get(r.id); });
    renderApp();
    showToast(error.message || "상태 변경 실패", "error");
  }
}

function settlementLabel(type) {
  return {
    prepay_debt: "선매입-채권",
    prepay_fee: "선매입-일반(수수료)",
    prepay_supply: "선매입-일반(공급가)",
    consignment: "위탁",
    direct_purchase: "직매입(사업자가)"
  }[type] || "선매입-일반(수수료)";
}

function cutoffLabel(brand) {
  if (!brand) return "";
  if (brand.cutoffType === "after_shipment") return "출고완료 확인 후 입금";
  if (brand.cutoffType === "consignment") return "위탁입금";
  return brand.cutoffHour ? `${brand.cutoffHour}:00` : "시간 미설정";
}

function receivableDeductionLabel(settlementType, brand) {
  if (settlementType === "prepay_supply" && brand?.hasReceivable) return "채권변제 누적액";
  return "채권차감액";
}

function specialSettlementNote(settlementType, brand) {
  if (settlementType === "prepay_supply" && brand?.hasReceivable) {
    return "이 브랜드는 실입금액을 판매매출 기준으로 계산하고, 기본 배송비와 공급가 차액만 채권변제로 누적합니다.";
  }
  return "";
}

function fmtDate(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("ko-KR", { dateStyle: "short", timeStyle: "short" });
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

function nowLocalDateTime() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function combinePaidDateTime(dateStr) {
  if (dateStr && /^\d{4}-\d{2}-\d{2}T/.test(dateStr)) return dateStr;
  const d = new Date();
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  const date = dateStr || `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  return `${date}T${time}`;
}

function toDatetimeLocal(value) {
  if (!value) return "";
  const d = new Date(value);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}T${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}

function renderRequestMemoCell(item) {
  const parts = [];
  if (item.notes) parts.push(h(item.notes));
  const over = Number(item.overpaidAmount || 0);
  if (over > 0) {
    const reason = item.overpaidReason ? ` · ${h(overpaidReasonLabel(item.overpaidReason))}` : "";
    const note = item.overpaidNote ? `<br><span class="muted">${h(item.overpaidNote)}</span>` : "";
    parts.push(`<span style="color:var(--green);font-weight:600">+${money.format(over)}원 외상발생${reason}</span>${note}`);
  }
  const used = Number(item.creditUsedAmount || 0);
  if (used > 0) {
    const note = item.creditUsedNote ? `<br><span class="muted">${h(item.creditUsedNote)}</span>` : "";
    parts.push(`<span style="color:var(--red);font-weight:600">-${money.format(used)}원 외상차감</span>${note}`);
  }
  return parts.length ? parts.join("<br>") : "-";
}

function finalDepositAmount(item) {
  // 남은(이번에 지급할) 금액 = 업체실입금 − 외상차감 − 기지급(이미 보낸 부분).
  return Math.max(0, Number(item?.depositAmount || 0) - Number(item?.creditUsedAmount || 0) - Number(item?.priorPaidAmount || 0));
}

function splitDirectTotal(total, brand) {
  const value = Math.max(0, Number(total || 0));
  if (!brand || !value) return { product: value, shipping: 0 };
  if (brand.shippingPolicyType === "threshold") {
    const threshold = Number(brand.shippingThresholdAmount || 0);
    const fee = Number(brand.shippingThresholdFee || 0);
    if (threshold > 0 && fee > 0) {
      if (value >= threshold) return { product: value, shipping: 0 };
      return { product: Math.max(0, value - fee), shipping: fee };
    }
  }
  if (brand.shippingPolicyType === "flat") {
    const fee = Number(brand.shippingFlatFee || 0);
    return { product: Math.max(0, value - fee), shipping: fee };
  }
  return { product: value, shipping: 0 };
}

function renderCreditBalance(value, withUnit = true) {
  const n = Number(value || 0);
  if (!n) return `<span class="muted">-</span>`;
  const color = n > 0 ? "var(--green)" : "var(--red)";
  const prefix = n > 0 ? "+" : "";
  return `<strong style="color:${color}">${prefix}${money.format(n)}${withUnit ? "원" : ""}</strong>`;
}

function discountKindLabel(value) {
  return {
    permanent: "상시할인",
    period: "기간할인",
    coupon: "쿠폰할인",
    quantity: "구매수량별"
  }[value] || "";
}

function renderPromotionDiscountCell(item) {
  const hasValue = Number(item.discountValue || 0) > 0 && item.discountValueType;
  if (!item.discountKind && !item.discountDetails && !hasValue) return `<span class="muted">-</span>`;
  const parts = [];
  if (item.discountKind) parts.push(`<strong>${h(discountKindLabel(item.discountKind))}</strong>`);
  if (hasValue) {
    const unit = item.discountValueType === "percent" ? "%" : "원";
    parts.push(`<span style="color:var(--red);font-weight:600">−${money.format(Number(item.discountValue))}${unit}</span>`);
  }
  if (item.discountDetails) parts.push(`<span class="muted">${h(item.discountDetails)}</span>`);
  return parts.join("<br>");
}

function overpaidReasonLabel(value) {
  return {
    overpay: "오입금",
    sold_out: "품절",
    price_change: "가격변경",
    mispay: "오송금",
    manual: "수동"
  }[value] || value || "";
}

function formatPaidAtCell(value) {
  if (!value) return "-";
  const d = new Date(value);
  if (isNaN(d.getTime())) return h(String(value));
  const datePart = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const hasTime = String(value).includes("T") || String(value).includes(":");
  if (!hasTime) return h(datePart);
  const timePart = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
  return `${h(datePart)}<br><span class="muted">${h(timePart)}</span>`;
}

async function init() {
  if (location.pathname.startsWith("/share/")) {
    await renderShare(location.pathname.split("/").pop());
    return;
  }
  // 세션 확인과 첫 목록을 한 번에 받는다. 로그인 전이면 목록은 401 로 와서 버린다.
  const [session, ...lists] = await apiBatch(["/api/session", ...LOAD_ALL_PATHS], { throwOnError: false });
  state.admin = session instanceof Error ? null : session.admin;
  if (!state.admin) {
    renderLogin();
    return;
  }
  await loadAll(lists);
  if (isRequestPopup) {
    state.tab = "requests";
    state.editingRequest = popupDraftPrefill
      ? readDraftPrefill()
      : state.requests.find((item) => item.id === popupRequestId) || null;
  }
  if (isBrandPopup) {
    state.tab = "brands";
    state.editingBrand = state.brands.find((item) => item.id === popupBrandId) || null;
    state.editingPromotionRule = null;
  }
  if (procurementPopupKind) {
    state.tab = "procurement";
    const config = PROCUREMENT_POPUPS[procurementPopupKind];
    if (config) {
      state.procurement.screen = config.screen;
      state.procurement[config.editKey] = procurementPopupId
        ? (state[config.collection] || []).find((item) => item.id === procurementPopupId) || null
        : null;
    }
  }
  // Landing back from the clobe OAuth redirect. Strip the query so a reload
  // doesn't replay the toast.
  const params = new URLSearchParams(location.search);
  const clobeResult = params.get("clobe");
  const cafe24Result = params.get("cafe24");
  if (clobeResult || cafe24Result) {
    state.tab = params.get("tab") === "productsync" ? "productsync" : "reconcile";
    const reason = params.get("reason") || "";
    const label = clobeResult ? "클로브ai" : "카페24";
    const result = clobeResult || cafe24Result;
    history.replaceState(null, "", location.pathname);
    renderApp();
    if (result === "connected") showToast(`${label}가 연결되었습니다.`);
    else showToast(reason ? `${label} 연결 실패: ${reason}` : `${label} 연결에 실패했습니다.`, "error");
    return;
  }
  renderApp();
}

const LOAD_ALL_PATHS = ["/api/dashboard", "/api/brands", "/api/requests", "/api/price-entries", "/api/price-aliases", "/api/promotion-rules",
  "/api/payment-logs", "/api/admins", "/api/menus", "/api/partners", "/api/materials", "/api/purchase-orders", "/api/delivery-places", "/api/transfer-accounts"];

async function loadAll(prefetched = null) {
  // 이력·아카이브는 화면을 열 때가 아니라 해당 탭을 눌렀을 때 부른다. 감사로그
  // 전체는 2MB가 넘어서, 매번 실어 보내면 나머지 응답까지 같이 밀린다.
  // 목록 14개는 /api/batch 한 번으로 받는다(터널 왕복 한 번에 0.5초 안팎).
  const lists = prefetched || await apiBatch(LOAD_ALL_PATHS, { throwOnError: false });
  const firstError = lists.slice(0, 13).find((x) => x instanceof Error);
  if (firstError) throw firstError;
  const [dashboard, brands, requests, priceEntries, priceAliases, promotionRules, paymentLogs, admins, menus, partners, materials, purchaseOrders, deliveryPlaces, transferAccounts] = lists;
  // 입금계좌 목록. 브랜드 설정의 계좌 선택과 계좌관리 화면이 쓴다.
  state.transferAccounts = (transferAccounts instanceof Error ? {} : transferAccounts).transferAccounts || [];
  state.menus = menus.menus || [];
  state.actionLabels = menus.actionLabels || {};
  state.dashboard = dashboard;
  state.brands = brands.brands;
  state.requests = requests.requests;
  state.priceEntries = priceEntries.priceEntries;
  state.priceCatalog = priceEntries.catalog;
  state.aliasEntries = priceAliases.priceAliases;
  state.promotionRules = promotionRules.promotionRules;
  state.paymentLogs = paymentLogs.paymentLogs;
  state.admins = admins.admins;
  state.partners = partners.partners;
  state.materials = materials.materials;
  state.purchaseOrders = purchaseOrders.purchaseOrders;
  state.deliveryPlaces = deliveryPlaces.deliveryPlaces;

  ensureRequestFilterDefaults();
  state.selectedRequestIds = state.selectedRequestIds.filter((id) =>
    state.requests.some((item) => item.id === id && item.status !== "deleted")
  );
}

function ensureRequestFilterDefaults() {
  const brandIds = state.brands.filter((b) => b.isActive !== false).map((b) => b.id);
  if (!state.filtersInitialized) {
    state.filters.brandIds = brandIds;
    state.filters.settlementTypes = ["prepay_debt", "prepay_fee", "prepay_supply", "direct_purchase"];
    state.filters.statusValues = ["pending", "await_deposit"];
    state.filtersInitialized = true;
    return;
  }
  if (Array.isArray(state.filters.brandIds)) {
    state.filters.brandIds = state.filters.brandIds.filter((id) => brandIds.includes(id));
  }
}

function renderLogin(error = "") {
  app.innerHTML = `
    <main class="login">
      <form class="login-panel" data-login>
        <h1>WOOOF ERP</h1>
        <p>우프 통합 관리 시스템 — 결제·거래·정산·자금을 한 곳에서 관리합니다.</p>
        <div class="form-grid" style="margin-top:16px">
          <div class="field">
            <label>이메일</label>
            <input name="email" autocomplete="username" placeholder="이메일" value="">
          </div>
          <div class="field">
            <label>비밀번호</label>
            <input name="password" type="password" autocomplete="current-password" placeholder="비밀번호" value="">
          </div>
          <div class="error-text">${h(error)}</div>
          <button class="primary" type="submit">로그인</button>
        </div>
      </form>
    </main>
  `;
  app.querySelector("[data-login]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const result = await api("/api/login", {
        method: "POST",
        body: { email: form.get("email"), password: form.get("password") }
      });
      state.admin = result.admin;
      await loadAll();
      renderApp();
    } catch (err) {
      renderLogin(err.message);
    }
  });
}

// 다시 그려도 보던 자리를 지킨다. 같은 화면(탭 + 하위 화면)이면 창과 스크롤되는 상자(표·사이드바·팝업)의
// 위치를 되돌리고, 다른 화면으로 옮기면 맨 위에서 시작한다. 위치는 사용자가 스크롤할 때 기억하고,
// 다시 그린 직후 잠깐(불러오는 중 화면이 짧아져 브라우저가 위치를 줄이는 동안)은 기억을 덮어쓰지 않는다.
const scrollMemory = { view: "", win: 0, boxes: {} };
let scrollQuietUntil = 0;
function currentViewKey() {
  const sub = TAB_SUBMENUS[state.tab];
  return `${state.tab}|${sub ? state[sub.stateKey]?.screen || "" : ""}`;
}
function scrollBoxKey(el) {
  const sig = `${el.tagName}.${[...el.classList].sort().join(".")}`;
  return `${sig}#${[...app.querySelectorAll(el.tagName)].filter((x) => `${x.tagName}.${[...x.classList].sort().join(".")}` === sig).indexOf(el)}`;
}
document.addEventListener("scroll", (event) => {
  if (Date.now() < scrollQuietUntil) return;
  const el = event.target;
  if (el === document || el === document.documentElement) scrollMemory.win = window.scrollY;
  else if (el instanceof Element && app.contains(el)) scrollMemory.boxes[scrollBoxKey(el)] = [el.scrollTop, el.scrollLeft];
}, { capture: true, passive: true });
function restoreScroll(view) {
  if (scrollMemory.view !== view) {
    scrollMemory.view = view; scrollMemory.win = 0; scrollMemory.boxes = {};
    scrollQuietUntil = Date.now() + 300;
    window.scrollTo(0, 0);
    return;
  }
  scrollQuietUntil = Date.now() + 300;
  window.scrollTo(0, scrollMemory.win);
  for (const [key, [top, left]] of Object.entries(scrollMemory.boxes)) {
    const [sig, idx] = key.split("#");
    const [tag, ...cls] = sig.split(".");
    const el = [...app.querySelectorAll(tag)].filter((x) => [...x.classList].sort().join(".") === cls.join("."))[Number(idx)];
    if (el) { el.scrollTop = top; el.scrollLeft = left; }
  }
}

// 목록 + 입력칸 2단 화면: 입력칸을 접으면 목록이 화면 전체를 쓴다(1920 모니터에서도 표가 잘리지 않게).
// 기준정보 화면(거래처·원부자재·납품지·입금계좌·명세서·단가표·브랜드)은 기본 접힘, 입금요청·지급요청처럼
// 입력이 잦은 화면은 기본 펼침. 수정 중이면 항상 펼친다. 화면별 선택은 이 브라우저에 기억한다.
const FORM_COLLAPSED_DEFAULT = new Set(["trade|partners", "trade|materials", "trade|deliveryPlaces", "trade|accounts", "trade|orders", "prices|", "brands|", "procurement|partners", "procurement|materials", "procurement|deliveryPlaces", "procurement|orders"]);
function formPrefs() {
  if (!state.formPrefs) { try { state.formPrefs = JSON.parse(localStorage.getItem("formCollapsed") || "{}"); } catch { state.formPrefs = {}; } }
  return state.formPrefs;
}
function enhanceLayouts() {
  const view = currentViewKey();
  app.querySelectorAll(".main section.layout:not(.single)").forEach((layout, i) => {
    const [list, side] = layout.children;
    if (!list || !side || layout.children.length !== 2 || !side.querySelector("form")) return;
    const key = `${view}#${i}`;
    const editing = /수정/.test(side.querySelector(".panel-head h2, h2")?.textContent || "");
    const pref = formPrefs()[key];
    const collapsed = !editing && (pref ?? FORM_COLLAPSED_DEFAULT.has(view));
    layout.classList.add("layout-collapsible");
    layout.classList.toggle("form-collapsed", collapsed);
    const set = (v) => { formPrefs()[key] = v; try { localStorage.setItem("formCollapsed", JSON.stringify(formPrefs())); } catch {} };
    const sideHead = side.querySelector(".panel-head");
    if (sideHead && !editing) {
      const close = document.createElement("button");
      close.type = "button"; close.className = "small ghost form-fold"; close.textContent = "접기 ⟩"; close.title = "입력칸을 접고 목록을 넓게 봅니다";
      close.addEventListener("click", () => { set(true); layout.classList.add("form-collapsed"); });
      sideHead.appendChild(close);
    }
    const listHead = list.querySelector(".panel-head") || list;
    const open = document.createElement("button");
    open.type = "button"; open.className = "small form-unfold";
    open.textContent = `⟨ ${(side.querySelector(".panel-head h2, h2")?.textContent || "입력").trim()}`;
    open.addEventListener("click", () => { set(false); layout.classList.remove("form-collapsed"); side.scrollIntoView({ block: "nearest" }); });
    listHead.appendChild(open);
    // 목록의 '새 ○○' 버튼은 입력칸을 펼친 채로 열리게 한다(원래 동작보다 먼저 돈다).
    list.querySelectorAll("button").forEach((btn) => {
      const t = btn.textContent.trim();
      if (/^(새 |\+ ?새|＋)/.test(t) && !/새 ?창/.test(t)) btn.addEventListener("click", () => set(false), { capture: true });
    });
  });
}

function renderApp() {
  renderAppInner();
  if (!isRequestPopup && !isBrandPopup && !PROCUREMENT_POPUPS[procurementPopupKind]) {
    enhanceLayouts();
    restoreScroll(currentViewKey());
  }
}

function renderAppInner() {
  if (isRequestPopup) {
    app.innerHTML = renderRequestPopup();
    bindCurrentTab();
    app.querySelector("[data-close-popup]")?.addEventListener("click", () => window.close());
    app.querySelector("[data-reset-popup-form]")?.addEventListener("click", () => {
      state.editingRequest = null;
      state.catalogResolve = null;
      history.replaceState({}, "", "/?request-popup=1");
      renderApp();
      focusRequestForm();
    });
    app.querySelector("[data-logout]").addEventListener("click", async () => {
      await api("/api/logout", { method: "POST" });
      state.admin = null;
      clearEditing();
      renderLogin();
    });
    return;
  }
  if (isBrandPopup) {
    app.innerHTML = renderBrandPopup();
    bindBrands();
    app.querySelector("[data-close-popup]")?.addEventListener("click", () => window.close());
    app.querySelector("[data-logout]").addEventListener("click", async () => {
      await api("/api/logout", { method: "POST" });
      state.admin = null;
      clearEditing();
      renderLogin();
    });
    return;
  }
  const procurementPopup = PROCUREMENT_POPUPS[procurementPopupKind];
  if (procurementPopup) {
    app.innerHTML = renderProcurementPopup(procurementPopup);
    procurementPopup.bind();
    app.querySelector("[data-close-popup]")?.addEventListener("click", () => window.close());
    app.querySelector("[data-reset-popup-form]")?.addEventListener("click", () => {
      state.procurement[procurementPopup.editKey] = null;
      history.replaceState({}, "", `/?procurement-popup=${procurementPopupKind}`);
      renderApp();
    });
    app.querySelector("[data-logout]").addEventListener("click", async () => {
      await api("/api/logout", { method: "POST" });
      state.admin = null;
      clearEditing();
      renderLogin();
    });
    return;
  }
  const tabs = [
    // 순서 = 좌측 메뉴 순서. 묶음(대분류)은 NAV_GROUPS 로 정하고, 첫 중분류 자리에 나온다.
    ["dashboard", "대시보드"],
    // 자동화(카페24 수집)와 클로브ai(입금대사)는 결국 한 흐름이라 한 화면에서
    // 본다. 권한 키는 pipeline 하나로 묶고, 화면 안에서 두 단계를 이어 보여준다.
    ["pipeline", "주문매칭"],
    ["requests", "입금요청"],
    ["payments", "지급요청"],
    ["trade", "거래"],
    ["settlement", "월 정산 생성"],
    ["monthly", "월 정산 현황"],
    ["npb", "npb정산"],
    ["closing", "월 마감"],
    ["brands", "브랜드"],
    ["prices", "단가표"],
    ["productsync", "상품동기화"],
    ["kpi", "KPI·손익"],
    ["cash", "자금"],
    ["admins", "관리자"],
    ["audits", "이력"],
    ["archive", "아카이브"],
    ["setup", "확인 필요"],
    ["messenger", "메신저 공유"],
    ["notion", "노션 기록"]
  ].filter(([key]) => (key === "monthly" || key === "closing" ? can("settlement", "view") : key === "trade" ? TRADE_SCREENS.some(([k]) => tradeCan(k)) : can(key, "view")) || (key === "pipeline" && can("reconcile", "view"))
    || (key === "setup" && (state.admin?.role === "owner" || can("cash", "edit")))
    || (key === "messenger" && (state.admin?.role === "owner" || can("payments", "view") || can("requests", "view") || can("cash", "view")))
    || (key === "notion" && (state.admin?.role === "owner" || can("payments", "view") || can("procurement", "view"))));
  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <button type="button" class="brandmark" data-go-home title="홈(대시보드)">
          <strong>WOOOF ERP</strong>
          <span>우프 통합 관리 시스템</span>
        </button>
        <nav class="nav">
          ${renderNavItems(tabs)}
        </nav>
        <div class="sidebar-footer">
          <span>${h(state.admin.name)} · ${h(state.admin.role)}</span>
          <button class="ghost" data-logout>로그아웃</button>
        </div>
      </aside>
      <main class="main">${renderCurrentTab()}</main>
    </div>
  `;
  app.querySelectorAll("[data-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      state.tab = button.dataset.tab;
      state.navKeepClosed = null;
      if (state.tab === "trade") tradeState();
      clearEditing();
      renderApp();
    });
  });
  app.querySelectorAll("[data-nav-group]").forEach((button) => {
    button.addEventListener("click", () => {
      const open = navOpenSet();
      const key = button.dataset.navGroup;
      // 보고 있는 화면의 대분류를 접으면, 다른 화면으로 옮길 때까지 접힌 채로 둔다.
      if (open.has(key)) { open.delete(key); if (navGroupOf(state.tab)?.key === key) state.navKeepClosed = key; }
      else { open.add(key); if (state.navKeepClosed === key) state.navKeepClosed = null; }
      saveNavOpen();
      renderApp();
    });
  });
  app.querySelectorAll("[data-nav-star]").forEach((star) => {
    star.addEventListener("click", async (event) => {
      event.stopPropagation();
      const key = star.dataset.navStar;
      const list = navFavorites();
      const next = list.includes(key) ? list.filter((x) => x !== key) : [...list, key];
      state.admin.navFavorites = next;
      renderApp();
      try { state.admin.navFavorites = (await api("/api/me/nav-favorites", { method: "PUT", body: { favorites: next } })).favorites; }
      catch (error) { state.admin.navFavorites = list; renderApp(); showToast(error.message, "error"); }
    });
  });
  app.querySelectorAll("[data-nav-fav]").forEach((button) => {
    button.addEventListener("click", () => {
      const [tab, sub] = button.dataset.navFav.split(":");
      state.tab = tab;
      if (tab === "trade") tradeState();
      const conf = TAB_SUBMENUS[tab];
      if (sub && conf) state[conf.stateKey].screen = sub;
      clearEditing();
      renderApp();
    });
  });
  app.querySelector("[data-go-home]")?.addEventListener("click", () => {
    state.tab = "dashboard";
    clearEditing();
    renderApp();
  });
  app.querySelectorAll("[data-subtab]").forEach((button) => {
    button.addEventListener("click", () => {
      const config = TAB_SUBMENUS[button.dataset.subtab];
      if (!config) return;
      state[config.stateKey].screen = button.dataset.subtabKey;
      // 화면을 옮기면 이전 화면의 일회성 안내(엑셀 업로드 결과 등)는 지운다.
      if (config.stateKey === "procurement" || config.stateKey === "trade") {
        state.procurement.importStatus = null;
        state.procurement.templateDownloadFor = null;
      }
      renderApp();
    });
  });
  app.querySelector("[data-logout]").addEventListener("click", async () => {
    await api("/api/logout", { method: "POST" });
    state.admin = null;
    renderLogin();
  });
  bindCurrentTab();
  startPsBadgePolling();
}

// 우프코드(v2 통합 고유코드) 표시. 없으면 빈칸.
function codeTag(item) {
  return item?.code ? `<span class="code-tag">${h(item.code)}</span> ` : "";
}

// 대분류에 하위 메뉴가 있으면 사이드바에서 그 아래로 펼친다. 대분류마다
// 하위 메뉴 목록과, 선택 상태를 들고 있는 state 키를 여기 한 곳에 적는다.
const TAB_SUBMENUS = {
  trade: { screens: TRADE_SCREENS, stateKey: "trade", visible: (key) => tradeCan(key) },
  procurement: { screens: PROCUREMENT_SCREENS, stateKey: "procurement" },
  npb: { screens: NPB_SCREENS, stateKey: "npb" },
  productsync: { screens: PRODUCT_SYNC_SCREENS, stateKey: "productSync" }
};

// 대분류 아래 중분류로 묶는 메뉴(대표 결정 2026-11-16). 중분류는 원래 탭 그대로(state.tab)라
// 화면·권한·하위 화면은 바뀌지 않는다. 대분류는 눌러서 펼치고 접는다(▸/▾).
const NAV_GROUPS = [
  { key: "buy", label: "결제/구매", children: ["pipeline", "requests", "payments"] },
  { key: "settle", label: "정산", children: ["settlement", "monthly", "npb", "closing"] },
  { key: "mall", label: "자사몰관리", children: ["brands", "prices", "productsync"] },
  { key: "mgmt", label: "경영관리", children: ["kpi", "cash"] },
  { key: "admin", label: "관리/설정", children: ["admins", "audits", "archive", "setup", "messenger", "notion"] }
];
const navGroupOf = (tab) => NAV_GROUPS.find((g) => g.children.includes(tab));
// 펼쳐 둔 대분류는 이 브라우저에 기억한다(편의용).
function navOpenSet() {
  if (!state.navOpen) {
    let saved = [];
    try { saved = JSON.parse(localStorage.getItem("navOpen") || "[]"); } catch {}
    state.navOpen = new Set(Array.isArray(saved) ? saved : []);
  }
  return state.navOpen;
}
function saveNavOpen() { try { localStorage.setItem("navOpen", JSON.stringify([...navOpenSet()])); } catch {} }
const navFavorites = () => (Array.isArray(state.admin?.navFavorites) ? state.admin.navFavorites : []);
const navStar = (favKey) => `<span class="nav-star ${navFavorites().includes(favKey) ? "on" : ""}" data-nav-star="${h(favKey)}" title="자주 쓰는 메뉴">${navFavorites().includes(favKey) ? "★" : "☆"}</span>`;

function renderNavItems(tabs) {
  const visible = new Map(tabs);
  const open = navOpenSet();
  const activeGroup = navGroupOf(state.tab);
  if (activeGroup && state.navKeepClosed !== activeGroup.key) open.add(activeGroup.key);
  const done = new Set();
  const item = (key, label) => {
    const hasSub = Boolean(TAB_SUBMENUS[key]);
    return `
    <button data-tab="${key}" class="nav-item ${state.tab === key ? "active" : ""}"><span class="nav-label">${label}${key === "productsync" ? renderPsNavDot() : ""}</span>${hasSub ? `<span class="nav-caret">${state.tab === key ? "▾" : "▸"}</span>` : ""}${navStar(key)}</button>
    ${state.tab === key ? renderTabSubmenu(key) : ""}`;
  };
  // ★ 자주 쓰는 메뉴: 맨 위에 따로. 'tab' 또는 'tab:하위화면'.
  const favs = navFavorites().map((fk) => {
    const [tab, sub] = fk.split(":");
    if (!visible.has(tab)) return "";
    const conf = TAB_SUBMENUS[tab];
    const subLabel = sub && conf ? (conf.screens.find(([k]) => k === sub) || [])[1] : "";
    if (sub && !subLabel) return "";
    const active = state.tab === tab && (!sub || state[conf.stateKey]?.screen === sub);
    return `<button data-nav-fav="${h(fk)}" class="nav-item ${active ? "active" : ""}"><span class="nav-label">${h(subLabel || visible.get(tab))}${subLabel ? `<small class="nav-from"> · ${h(visible.get(tab))}</small>` : ""}</span>${navStar(fk)}</button>`;
  }).filter(Boolean);
  const favBlock = favs.length ? `<div class="nav-favs"><div class="nav-section">자주 쓰는 메뉴</div>${favs.join("")}</div>` : "";
  return favBlock + tabs.map(([key, label]) => {
    const group = navGroupOf(key);
    if (!group) return item(key, label);
    if (done.has(group.key)) return "";
    done.add(group.key);
    const kids = group.children.filter((k) => visible.has(k));
    const isOpen = open.has(group.key);
    return `
      <button data-nav-group="${group.key}" class="nav-item ${kids.includes(state.tab) ? "active" : ""}"><span class="nav-label">${group.label}</span><span class="nav-caret">${isOpen ? "▾" : "▸"}</span></button>
      ${isOpen ? `<div class="nav-sub">${kids.map((k) => item(k, visible.get(k))).join("")}</div>` : ""}`;
  }).join("");
}

function renderTabSubmenu(tabKey) {
  const config = TAB_SUBMENUS[tabKey];
  if (!config) return "";
  if (tabKey === "trade") tradeState();
  const current = state[config.stateKey]?.screen;
  return `
    <div class="nav-sub">
      ${config.screens
        .filter(([key]) => !config.visible || config.visible(key))
        .map(([key, label]) =>
          `<button data-subtab="${tabKey}" data-subtab-key="${key}" class="nav-item ${current === key ? "active" : ""}"><span class="nav-label">${label}</span>${navStar(`${tabKey}:${key}`)}</button>`)
        .join("")}
    </div>`;
}

function renderProcurementPopup(config) {
  const editing = state.procurement[config.editKey];
  return `
    <main class="popup-shell">
      ${pageHead(
        editing?.id ? `${config.title} 수정` : `${config.title} 입력`,
        config.desc,
        `
          <button type="button" data-reset-popup-form>새 ${config.title}</button>
          <button type="button" data-close-popup>닫기</button>
          <button class="ghost" type="button" data-logout>로그아웃</button>
        `
      )}
      <section class="panel">
        <div class="panel-body">${config.render()}</div>
      </section>
    </main>
  `;
}

function renderRequestPopup() {
  return `
    <main class="popup-shell">
      ${pageHead(
        state.editingRequest?.id ? "입금요청 수정" : "입금요청 입력",
        "브랜드 기본값은 자동 반영되고, 변동값만 입력합니다.",
        `
          <button type="button" data-reset-popup-form>새 요청</button>
          <button type="button" data-close-popup>닫기</button>
          <button class="ghost" type="button" data-logout>로그아웃</button>
        `
      )}
      <section class="panel">
        <div class="panel-body">${renderRequestForm()}</div>
      </section>
      ${renderCatalogResolvePanel()}
    </main>
  `;
}

function renderBrandPopup() {
  const brand = state.editingBrand;
  const brandRules = brand
    ? state.promotionRules.filter((rule) => rule.brandId === brand.id)
    : [];
  const headerTitle = brand ? `브랜드 수정 · ${brand.name || ""}` : "브랜드를 찾지 못했습니다";
  return `
    <main class="popup-shell">
      ${pageHead(
        headerTitle,
        "브랜드 정보와 프로모션 규칙을 수정한 뒤 입금요청 창으로 돌아가세요.",
        `
          <button type="button" data-close-popup>닫기</button>
          <button class="ghost" type="button" data-logout>로그아웃</button>
        `
      )}
      ${brand ? `
        <section class="panel">
          <div class="panel-head"><h2>브랜드 정보</h2></div>
          <div class="panel-body">${renderBrandForm()}</div>
        </section>
        <section class="panel" style="margin-top:14px">
          <div class="panel-head">
            <h2>${state.editingPromotionRule ? "프로모션 규칙 수정" : "프로모션 규칙 등록"}</h2>
            <span class="muted">현재 브랜드 규칙 ${brandRules.length}건</span>
          </div>
          <div class="panel-body">
            <div class="table-wrap" style="max-height:240px;margin-bottom:14px">
              <table class="brand-promotions-table">
                <thead><tr><th>프로모션</th><th>범위</th><th>수수료율</th><th>가격 할인</th><th>기간</th><th>상태</th><th>작업</th></tr></thead>
                <tbody>
                  ${brandRules.map((item) => `
                    <tr>
                      <td>${h(item.name)}</td>
                      <td class="wrap">${h(item.scopeType === "items" ? (item.targetItemLabels || []).join(", ") || "특정 품목" : "브랜드 전체")}</td>
                      <td>${item.commissionRate || item.commissionRate === 0 ? `${h(item.commissionRate)}%` : `<span class="muted">-</span>`}</td>
                      <td class="wrap">${renderPromotionDiscountCell(item)}</td>
                      <td>${h(item.validFrom || "-")}${item.validTo ? ` ~ ${h(item.validTo)}` : " ~ 상시"}</td>
                      <td>${promotionRuleStatusLabel(item)}</td>
                      <td><div class="row-actions"><button data-edit-promotion-rule="${item.id}">수정</button><button class="danger icon-btn" data-delete-promotion-rule="${item.id}" aria-label="삭제" title="삭제">×</button></div></td>
                    </tr>`).join("") || `<tr><td colspan="7" class="empty">등록된 프로모션 규칙이 없습니다.</td></tr>`}
                </tbody>
              </table>
            </div>
            ${renderPromotionRuleForm()}
          </div>
        </section>
      ` : `<section class="panel"><div class="panel-body empty">URL에 지정된 브랜드를 찾지 못했습니다. 창을 닫고 다시 시도하세요.</div></section>`}
    </main>
  `;
}

function clearEditing() {
  state.editingRequest = null;
  state.editingBrand = null;
  state.editingAdmin = null;
  // 관리자 폼의 임시 입력(비밀번호 포함)과 권한 체크도 함께 비운다. 남겨 두면
  // 다른 탭에 갔다 오면 "관리자 입력" 폼에 앞서 고치던 사람의 값이 채워진다.
  state.adminDraft = null;
  state.editingPermissions = null;
  state.editingPriceEntry = null;
  state.editingPriceAlias = null;
  state.editingPromotionRule = null;
  state.procurement.editingPartner = null;
  state.procurement.editingMaterial = null;
  state.procurement.editingPurchaseOrder = null;
}

// '거래' 메뉴: 고른 하위 화면에 맞는 기존 화면을 그린다.
function renderTrade() {
  const t = tradeState();
  if (!tradeCan(t.screen)) t.screen = (TRADE_SCREENS.find(([k]) => tradeCan(k)) || ["partners"])[0];
  if (t.screen === "sales") return renderSales();
  if (t.screen === "stock") return renderStock();
  state.procurement.screen = t.screen;
  return renderProcurement();
}
function bindTrade() {
  const t = tradeState();
  if (t.screen === "sales") bindSales();
  else if (t.screen === "stock") bindStock();
  else bindProcurement();
}

function renderCurrentTab() {
  if (state.tab === "requests") return renderRequests();
  if (state.tab === "prices") return renderPrices();
  if (state.tab === "brands") return renderBrands();
  if (state.tab === "procurement") return renderProcurement();
  if (state.tab === "payments") return renderPayments();
  if (state.tab === "cash") return renderCash();
  if (state.tab === "sales") return renderSales();
  if (state.tab === "stock") return renderStock();
  if (state.tab === "setup") return renderSetup();
  if (state.tab === "monthly") return renderMonthly();
  if (state.tab === "closing") return renderClosing();
  if (state.tab === "messenger") return renderMessenger();
  if (state.tab === "notion") return renderNotionArchive();
  if (state.tab === "trade") return renderTrade();
  if (state.tab === "kpi") return renderKpi();
  if (state.tab === "admins") return renderAdmins();
  if (state.tab === "audits") return renderAudits();
  if (state.tab === "archive") return renderArchive();
  if (state.tab === "settlement") return renderSettlement();
  // 주문매칭 화면은 두 권한(주문매칭, 주문매칭(클로브))을 합친 곳이다. 체크된
  // 쪽만 보여준다 — 한쪽만 받은 관리자에게 "권한 없음" 안내가 겹쳐 뜨지 않게.
  if (state.tab === "pipeline") {
    if (!can("pipeline")) return renderReconcile();
    return renderPipeline() + (canUseClobe() ? renderReconcile(true) + renderDepositConfirm() : "");
  }
  if (state.tab === "reconcile") return renderPipeline() + renderReconcile(true);
  if (state.tab === "npb") return renderNpb();
  if (state.tab === "productsync") return renderProductSync();
  return renderDashboard();
}

// 하위 메뉴가 있는 대분류는 지금 보고 있는 화면 이름까지 제목에 붙인다 --
// 좌측에서 고른 하위 메뉴가 본문 제목과 이어져 보이도록.
function currentScreenLabel(tabKey) {
  // 새 창(팝업)은 제목이 이미 "거래처 입력"처럼 구체적이라 빵부스러기가 붙으면
  // 되레 헷갈린다.
  if (isRequestPopup || isBrandPopup || procurementPopupKind) return "";
  const config = TAB_SUBMENUS[tabKey];
  if (!config) return "";
  const current = state[config.stateKey]?.screen;
  return (config.screens.find(([key]) => key === current) || [])[1] || "";
}

function pageHead(title, subtitle, actions = "") {
  const screenLabel = currentScreenLabel(state.tab);
  return `
    <div class="topbar">
      <div>
        <h1>${h(title)}${screenLabel ? `<span class="page-crumb"> / ${h(screenLabel)}</span>` : ""}</h1>
        <p>${h(subtitle)}</p>
      </div>
      <div class="toolbar">${actions}</div>
    </div>
  `;
}

function summarizeMultiFilter(allLabel, selectedValues, options) {
  const total = options.length;
  const selectedCount = selectedValues.length;
  if (!total || selectedCount === total) return allLabel;
  if (selectedCount === 0) return `${allLabel} 없음`;
  if (selectedCount === 1) return options.find((item) => item.value === selectedValues[0])?.label || allLabel;
  return `${allLabel} ${selectedCount}/${total}`;
}

function getRecentBrandIds() {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_BRANDS_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return [];
  }
}

function pushRecentBrand(brandId) {
  if (!brandId) return;
  const next = [brandId, ...getRecentBrandIds().filter((id) => id !== brandId)].slice(0, 10);
  localStorage.setItem(RECENT_BRANDS_KEY, JSON.stringify(next));
}

function recentSortedBrands() {
  const recentIds = getRecentBrandIds();
  const rank = new Map(recentIds.map((id, index) => [id, index]));
  return state.brands
    .filter((b) => b.isActive !== false)
    .slice()
    .sort((a, b) => {
      const aRank = rank.has(a.id) ? rank.get(a.id) : 9999;
      const bRank = rank.has(b.id) ? rank.get(b.id) : 9999;
      if (aRank !== bRank) return aRank - bRank;
      return String(a.name || "").localeCompare(String(b.name || ""), "ko");
    });
}

function renderMultiFilter({ key, title, allLabel, options, selectedValues }) {
  const allChecked = options.length > 0 && selectedValues.length === options.length;
  return `
    <details class="multi-filter" data-filter-group="${key}">
      <summary>${h(summarizeMultiFilter(allLabel, selectedValues, options))}</summary>
      <div class="multi-filter-menu">
        <label class="multi-filter-option">
          <input type="checkbox" data-filter-all="${key}" ${allChecked ? "checked" : ""}>
          <span>${h(allLabel)}</span>
        </label>
        ${options.map((option) => `
          <label class="multi-filter-option">
            <input type="checkbox" data-filter-option="${key}" value="${h(option.value)}" ${selectedValues.includes(option.value) ? "checked" : ""}>
            <span>${h(option.label)}</span>
          </label>
        `).join("")}
      </div>
    </details>
  `;
}

// 오늘 할 일: 여러 메뉴의 대기 건(권한에 맞게). 누르면 그 화면으로.
function renderTodo() {
  const t = state.todo;
  if (!t) return `<section class="panel todo-panel"><div class="panel-head"><h2>오늘 할 일</h2></div><div class="panel-body"><p class="muted">불러오는 중…</p></div></section>`;
  const cards = t.items.map((it) => `<button type="button" class="todo-card ${it.tone ? `tone-${h(it.tone)}` : ""}" data-todo-go="${h(it.go.tab)}${it.go.sub ? `:${h(it.go.sub)}` : ""}">
      <span class="todo-label">${h(it.label)}</span>
      <strong>${it.count != null ? `${money.format(it.count)}건` : "확인"}</strong>
      ${it.amount != null ? `<span class="todo-amount">${money.format(Math.round(it.amount))}원</span>` : ""}</button>`).join("");
  return `<section class="panel todo-panel"><div class="panel-head"><h2>오늘 할 일</h2><button class="small ghost" data-todo-refresh>새로고침</button></div>
    <div class="panel-body">${cards ? `<div class="todo-grid">${cards}</div>` : `<p class="muted">처리할 일이 없습니다. 👍</p>`}</div></section>`;
}
function bindTodo() {
  if (state.todo && Date.now() - (state.todoAt || 0) > 60000 && !state.todoLoading) state.todo = null;
  if (!state.todo && !state.todoLoading) {
    state.todoLoading = true;
    api("/api/todo").then((r) => { state.todo = r; state.todoAt = Date.now(); }).catch(() => { state.todo = { items: [] }; state.todoAt = Date.now(); }).finally(() => { state.todoLoading = false; if (state.tab === "dashboard") renderApp(); });
  }
  app.querySelector("[data-todo-refresh]")?.addEventListener("click", () => { state.todo = null; renderApp(); });
  app.querySelectorAll("[data-todo-go]").forEach((b) => b.addEventListener("click", () => {
    const [tab, sub] = b.dataset.todoGo.split(":");
    state.tab = tab;
    if (tab === "trade") tradeState();
    const conf = TAB_SUBMENUS[tab];
    if (sub && conf) state[conf.stateKey].screen = sub;
    state.todo = null;
    clearEditing();
    renderApp();
  }));
}

function renderDashboard() {
  const d = state.dashboard;
  return `
    ${pageHead("대시보드", "오늘 처리할 일과 입금요청 현황을 한눈에 봅니다.")}
    ${renderTodo()}
    <section class="stats">
      <div class="stat"><span>입금요청</span><strong>${money.format(d.requestCount)}</strong></div>
      <div class="stat"><span>대기 건수</span><strong>${money.format(d.pendingCount)}</strong></div>
      <div class="stat"><span>대기 금액</span><strong>${money.format(d.totalPendingAmount)}원</strong></div>
      <div class="stat"><span>위탁-입금전</span><strong>${money.format(d.consignmentUnpaidCount || 0)}</strong></div>
    </section>
    <section class="layout">
      <div class="panel">
        <div class="panel-head"><h2>이관한 핵심 규칙</h2></div>
        <div class="panel-body">
          ${d.sourceRules.map((item) => `<p class="notice">${h(item)}</p>`).join("")}
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>최근 이력</h2></div>
        <div class="panel-body">${renderAuditList(d.recentAudits)}</div>
      </div>
    </section>
  `;
}

function renderRequests() {
  const actions = `
    <button type="button" class="ghost" data-deleted-requests>삭제된 요청</button>
    ${downloadMenu([["/api/export/csv", "입금요청 CSV"], ["/api/export/xls", "입금요청 Excel"], ["/api/export/payment-log.csv", "입금로그 CSV"], ["/api/export/payment-log.xls", "입금로그 Excel"]])}
    <button class="primary" type="button" data-open-request-popup>새 창 입금요청</button>
  `;
  const dr = state.deletedRequests;
  const deletedModal = dr?.open ? v2Modal(`<div class="panel-head"><h2>삭제된 입금요청</h2><button data-deleted-close>닫기</button></div>
    <div class="panel-body">${dr.list ? `<p class="muted" style="font-size:12px">실수로 지운 요청을 되돌립니다. 마감된 달의 요청은 되돌릴 수 없습니다.</p>
      <div class="table-wrap"><table class="compact" data-unit="원"><thead><tr><th>삭제 시각</th><th>브랜드</th><th>주문번호</th><th>주문자</th><th>입금액</th><th></th></tr></thead><tbody>
      ${dr.list.map((r) => `<tr><td>${h(fmtDate(r.updatedAt))}</td><td>${h(r.brandName)}</td><td>${h(r.orderNo)}</td><td>${h(r.customerName)}</td><td class="num">${money.format(r.depositAmount || 0)}</td>
        <td>${can("requests", "delete") ? `<button class="small" data-restore-request="${h(r.id)}">되돌리기</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="6" class="empty">삭제된 요청이 없습니다.</td></tr>`}
      </tbody></table></div>` : `<p class="muted">불러오는 중…</p>`}</div>`, "data-deleted-close") : "";
  const rows = filteredRequests();
  const selectableRows = rows.filter((item) => item.status !== "deleted");
  const allSelected = selectableRows.length > 0 && selectableRows.every((item) => state.selectedRequestIds.includes(item.id));
  const selectedIdSet = new Set(state.selectedRequestIds);
  const selectedTotal = state.requests
    .filter((item) => selectedIdSet.has(item.id))
    .reduce((sum, item) => sum + finalDepositAmount(item), 0);
  return `
    ${pageHead("입금요청", "주문번호, 업체 실 입금액, 입금 예정일과 정산 메모를 관리합니다.", actions)}${deletedModal}${renderShipSendModal()}
    <section class="layout single">
      <div class="panel">
        <div class="panel-head"><h2>요청 목록</h2><span class="muted">${money.format(rows.length)}건</span></div>
        <div class="panel-body">
          <div class="filters request-filters">
            <input data-filter-q placeholder="주문번호, 주문자, 브랜드 검색" value="${h(state.filters.q)}">
            <label class="date-range">주문일 <input type="date" data-filter-date-from value="${h(state.filters.dateFrom || "")}"></label>
            <label class="date-range">~ <input type="date" data-filter-date-to value="${h(state.filters.dateTo || "")}"></label>
            ${state.filters.dateFrom || state.filters.dateTo ? `<button type="button" class="ghost" data-filter-date-clear>기간 초기화</button>` : ""}
            ${renderMultiFilter({
              key: "brand",
              title: "브랜드",
              allLabel: "전체 브랜드",
              options: state.brands.filter((b) => b.isActive !== false).map((b) => ({ value: b.id, label: b.name })),
              selectedValues: state.filters.brandIds || []
            })}
            ${renderMultiFilter({
              key: "settlement",
              title: "정산유형",
              allLabel: "전체 정산유형",
              options: ["prepay_debt", "prepay_fee", "prepay_supply", "consignment", "direct_purchase"].map((value) => ({ value, label: settlementLabel(value) })),
              selectedValues: state.filters.settlementTypes || []
            })}
            ${renderMultiFilter({
              key: "status",
              title: "상태",
              allLabel: "전체 상태",
              options: ["pending", "await_deposit", "consignment_unpaid", "paid", "hold", "error"].map((value) => ({ value, label: statusLabel(value) })),
              selectedValues: state.filters.statusValues || []
            })}
            <select data-filter-promotion>
              <option value="">전체 프로모션</option>
              <option value="__with__" ${state.filters.promotionRuleId === "__with__" ? "selected" : ""}>프로모션 있음</option>
              <option value="__without__" ${state.filters.promotionRuleId === "__without__" ? "selected" : ""}>프로모션 없음</option>
              ${state.promotionRules.map((rule) => `<option value="${rule.id}" ${state.filters.promotionRuleId === rule.id ? "selected" : ""}>${h(rule.brandName)} · ${h(rule.name)}</option>`).join("")}
            </select>
          </div>
          <div class="bulk-bar ${state.selectedRequestIds.length ? "is-active" : ""}" role="group" aria-label="선택한 요청 일괄 처리">
            <span class="bulk-count">${state.selectedRequestIds.length ? `<b>${state.selectedRequestIds.length}건 선택</b> · 합계 <strong class="amount-emphasis">${money.format(selectedTotal)}원</strong>` : "선택한 요청 일괄 처리"}</span>
            <label class="inline-field"><span>입금일</span><input type="date" data-bulk-paid-at value="${h(state.bulkPaidAt)}" aria-label="일괄 입금일"></label>
            <button type="button" data-mark-selected-paid ${state.selectedRequestIds.length ? "" : "disabled"}>입금완료 처리</button>
            <select data-bulk-status aria-label="선택 상태 변경" ${state.selectedRequestIds.length ? "" : "disabled"}>
              <option value="">상태 변경…</option>
              ${STATUS_CHOICES.map((v) => `<option value="${v}">${h(statusLabel(v))}로 변경</option>`).join("")}
            </select>
            ${can("requests", "pay") ? `<button type="button" data-transfer-xlsx ${state.selectedRequestIds.length ? "" : "disabled"}>하나은행 이체양식</button>` : ""}
            <button type="button" data-ship-notify-selected ${state.selectedRequestIds.length ? "" : "disabled"}>출고 요청 보내기</button>
            <span class="bulk-spacer"></span>
            <button type="button" class="ghost" data-clear-selection ${state.selectedRequestIds.length ? "" : "disabled"}>선택 해제</button>
            <button type="button" class="danger" data-delete-selected-requests ${state.selectedRequestIds.length ? "" : "disabled"}>선택 삭제</button>
          </div>
          <div class="table-wrap">
            <table class="requests-table m-cards">
              <thead><tr><th><input type="checkbox" data-select-all-requests ${allSelected ? "checked" : ""}></th><th>작업</th><th>상태</th><th>정산유형</th><th>브랜드</th><th>주문번호</th><th>주문자</th><th>제품매출</th><th>배송비</th><th>입금액</th><th>적용 프로모션</th><th>예정일</th><th>입금일시</th><th>출고/정산</th><th>메모</th></tr></thead>
              <tbody>
                ${rows.map(renderRequestRow).join("") || `<tr><td colspan="15" class="empty">표시할 입금요청이 없습니다.</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  `;
}

function filteredRequests() {
  const q = state.filters.q.trim().toLowerCase();
  const selectedStatuses = new Set(state.filters.statusValues || []);
  const selectedBrands = new Set(state.filters.brandIds || []);
  const selectedSettlementTypes = new Set(state.filters.settlementTypes || []);
  return state.requests
    .filter((item) => !selectedStatuses.size || selectedStatuses.has(item.status))
    .filter((item) => !selectedBrands.size || selectedBrands.has(item.brandId))
    .filter((item) => !selectedSettlementTypes.size || selectedSettlementTypes.has(item.settlementType))
    .filter((item) => {
      const appliedRules = Array.isArray(item.appliedPromotionRules) ? item.appliedPromotionRules : [];
      if (!state.filters.promotionRuleId) return true;
      if (state.filters.promotionRuleId === "__with__") return appliedRules.length > 0 || Boolean(item.promotionRuleName);
      if (state.filters.promotionRuleId === "__without__") return appliedRules.length === 0 && !item.promotionRuleName;
      return appliedRules.some((rule) => rule.id === state.filters.promotionRuleId) || item.promotionRuleId === state.filters.promotionRuleId;
    })
    .filter((item) => {
      // 고객주문일 = 주문번호 앞 8자리(YYYYMMDD)
      const from = (state.filters.dateFrom || "").replaceAll("-", "");
      const to = (state.filters.dateTo || "").replaceAll("-", "");
      if (!from && !to) return true;
      const orderDate = String(item.orderNo || "").slice(0, 8);
      if (!/^\d{8}$/.test(orderDate)) return false;
      if (from && orderDate < from) return false;
      if (to && orderDate > to) return false;
      return true;
    })
    .filter((item) => {
      if (!q) return true;
      return [item.brandName, item.orderNo, item.customerName, item.sourceSheet, item.requiredMemo, summarizeAppliedPromotions(item)]
        .join(" ")
        .toLowerCase()
        .includes(q);
    })
    .sort((a, b) => {
      const aAt = a.createdAt || "";
      const bAt = b.createdAt || "";
      if (aAt !== bAt) return aAt.localeCompare(bAt);
      return String(a.orderNo || "").localeCompare(String(b.orderNo || ""), "ko");
    });
}

function renderRequestRow(item) {
  return `
    <tr class="hub-go" data-row-edit="[data-open-edit-request-popup]">
      <td class="m-check"><input type="checkbox" aria-label="${h(item.orderNo)} 선택" data-select-request="${item.id}" ${state.selectedRequestIds.includes(item.id) ? "checked" : ""}></td>
      <td class="m-actions"><div class="row-actions">${item.status !== "paid" ? `<button data-pay-request="${item.id}">입금완료</button>` : ""}${item.status === "paid" && shipNotifyOn(item) ? `<button data-ship-notify="${item.id}" title="브랜드 출고 담당자에게 문자·메일">출고 요청</button>` : ""}<button data-open-edit-request-popup="${item.id}">수정</button><button class="danger icon-btn" data-delete-request="${item.id}" aria-label="삭제" title="삭제">×</button></div></td>
      <td class="m-status">${renderRowStatusSelect(item)}${shipSentTags(item)}</td>
      <td class="m-hide">${settlementLabel(item.settlementType)}</td>
      <td class="m-title">${h(item.brandName)}</td>
      <td class="m-sub"><a href="#" class="order-link" data-open-edit-request-popup="${item.id}">${h(item.orderNo)}</a></td>
      <td class="m-sub">${h(item.customerName)}</td>
      <td class="num m-hide">${money.format(Number(item.productSalesAmount || 0))}원</td>
      <td class="num m-hide">${money.format(Number(item.shippingFee || 0))}원</td>
      <td class="num m-amount"><strong class="amount-emphasis">${money.format(finalDepositAmount(item))}원</strong>${Number(item.creditUsedAmount || 0) > 0 ? `<br><span class="muted" style="font-size:11px">원 ${money.format(Number(item.depositAmount || 0))}원 − 외상 ${money.format(Number(item.creditUsedAmount || 0))}원</span>` : ""}${Number(item.priorPaidAmount || 0) > 0 ? `<br><span class="muted" style="font-size:11px">총 ${money.format(Number(item.depositAmount || 0))}원 − 기지급 ${money.format(Number(item.priorPaidAmount || 0))}원 = 추가 ${money.format(finalDepositAmount(item))}원</span>` : ""}</td>
      <td class="wrap m-hide">${h(summarizeAppliedPromotions(item) || "-")}</td>
      <td class="m-field" data-label="예정일">${h(item.expectedDepositDate)}</td>
      <td class="m-field" data-label="입금">${formatPaidAtCell(item.paidAt)}</td>
      <td class="wrap m-hide">${h(item.cutoffNote || item.requiredMemo)}</td>
      <td class="wrap m-hide">${renderRequestMemoCell(item)}</td>
    </tr>
  `;
}

function renderRequestForm() {
  const item = state.editingRequest || {};
  const selectedBrand = state.brands.find((brand) => brand.id === item.brandId);
  const brandInputValue = selectedBrand?.name || item.brandName || "";
  const brandOptions = recentSortedBrands();
  const lineItems = item.lineItems || [];
  const settlementType = selectedBrand?.settlementType || item.settlementType || "prepay_fee";
  const showReceivableFields = settlementType === "prepay_debt" || (settlementType === "prepay_supply" && Boolean(selectedBrand?.hasReceivable || Number(item.receivableDeduction || 0) > 0));
  const receivableLabel = receivableDeductionLabel(settlementType, selectedBrand);
  const settlementNote = specialSettlementNote(settlementType, selectedBrand);
  const resolvedSourceSheet = item.sourceSheet || selectedBrand?.rawSheetName || selectedBrand?.name || "";
  const resolvedCutoffNote = item.cutoffNote || selectedBrand?.cutoffNote || "";
  const resolvedRequiredMemo = item.requiredMemo || selectedBrand?.requiredMemo || "";
  const resolvedBusinessName = item.businessName || selectedBrand?.businessName || "";
  const resolvedBusinessNumber = item.businessNumber || selectedBrand?.businessNumber || "";
  const resolvedDepositorName = item.depositorName || selectedBrand?.depositorName || "";
  const resolvedBankName = selectedBrand?.bankName || "";
  const resolvedBankAccount = selectedBrand?.bankAccount || "";
  const resolvedAccountInfo = [resolvedBankName, resolvedBankAccount].filter(Boolean).join(" ") || "-";
  const extraShippingEnabled = Number(item.extraShippingFee || 0) > 0 || Boolean(item.extraShippingNote);
  const commissionDisplay = item.commissionRate ?? selectedBrand?.commissionRate ?? "";
  const promotion = findActivePromotionRule(selectedBrand?.id, item.expectedDepositDate);
  const lineSupplyTotal = lineItems.reduce((sum, li) => sum + Number(li.totalSupplyPrice || 0), 0);
  const autoBaseShippingFee = calculateBrandShippingFee(
    selectedBrand,
    shippingThresholdBaseAmount(selectedBrand, {
      salesAmount: Number(item.productSalesAmount || item.depositAmount || 0),
      supplyAmount: lineSupplyTotal || Number(item.supplyAmount || 0)
    })
  );
  const defaultBaseShippingFee = item.baseShippingFee ?? autoBaseShippingFee;
  const baseShippingManual =
    item.baseShippingFee != null && Number(item.baseShippingFee) !== Number(autoBaseShippingFee || 0);
  const defaultExtraShippingFee = item.extraShippingFee ?? 0;
  const defaultShippingFee = item.shippingFee ?? (Number(defaultBaseShippingFee || 0) + Number(defaultExtraShippingFee || 0));
  return `
    <form class="form-grid request-form" data-request-form>
      <input name="settlementType" type="hidden" value="${h(settlementType)}">
      <input name="sourceSheet" type="hidden" value="${h(resolvedSourceSheet)}">
      <input name="cutoffNote" type="hidden" value="${h(resolvedCutoffNote)}">
      <input name="requiredMemo" type="hidden" value="${h(resolvedRequiredMemo)}">
      <input name="businessName" type="hidden" value="${h(resolvedBusinessName)}">
      <input name="businessNumber" type="hidden" value="${h(resolvedBusinessNumber)}">
      <input name="depositorName" type="hidden" value="${h(resolvedDepositorName)}">
      <div class="field">
        <label>브랜드</label>
        <input name="brandSearch" list="request-brand-options" value="${h(brandInputValue)}" placeholder="브랜드명을 입력해 검색">
        <input name="brandId" type="hidden" value="${h(item.brandId)}">
        <datalist id="request-brand-options">
          ${brandOptions.map((b) => `<option value="${h(b.name)}"></option>`).join("")}
        </datalist>
        <div class="toolbar" style="margin-top:4px">
          <button type="button" data-open-brand-popup ${item.brandId ? "" : "disabled"}>브랜드/프로모션 수정</button>
          <span class="muted">최근 사용한 브랜드 10개가 상단에 우선 노출됩니다.</span>
        </div>
      </div>
      <section class="fixed-summary">
        <div class="fixed-summary-title">브랜드 자동 적용값</div>
        <div class="fixed-summary-grid">
          <div class="fixed-card"><span>정산유형</span><strong data-fixed-settlement-type>${h(settlementLabel(settlementType))}</strong></div>
          <div class="fixed-card"><span>기본 수수료율</span><strong data-fixed-commission-rate>${commissionDisplay !== "" ? `${h(commissionDisplay)}%` : "-"}</strong></div>
          <div class="fixed-card"><span>기본 배송비</span><strong data-fixed-base-shipping>${money.format(Number(defaultBaseShippingFee || 0))}원</strong></div>
        </div>
        <div class="fixed-summary-grid" style="grid-template-columns:repeat(2,minmax(0,1fr))">
          <div class="fixed-card"><span>출고 기준</span><strong data-fixed-cutoff>${h(cutoffLabel(selectedBrand || { cutoffNote: resolvedCutoffNote, cutoffType: item.cutoffType, cutoffHour: item.cutoffHour })) || "-"}</strong></div>
          <div class="fixed-card"><span>원본 시트</span><strong data-fixed-source-sheet>${h(resolvedSourceSheet || "-")}</strong></div>
        </div>
        <div class="fixed-summary-grid">
          <div class="fixed-card"><span>계좌예금주명</span><strong data-fixed-depositor>${h(resolvedDepositorName || "-")}</strong></div>
          <div class="fixed-card"><span>계좌정보(은행/번호)</span><strong data-fixed-account>${h(resolvedAccountInfo)}</strong></div>
          <div class="fixed-card"><span>사업자</span><strong data-fixed-business>${h(resolvedBusinessName || "-")}${resolvedBusinessNumber ? ` (${h(resolvedBusinessNumber)})` : ""}</strong></div>
        </div>
        <div class="fixed-summary-notes">
        <div><span>필수 메모</span><strong data-fixed-required-memo>${h(resolvedRequiredMemo || "-")}</strong></div>
        <div><span>정산 메모</span><strong data-fixed-cutoff-note>${h(resolvedCutoffNote || "-")}</strong></div>
        ${settlementNote ? `<div><span>계산 안내</span><strong data-special-settlement-note>${h(settlementNote)}</strong></div>` : `<div style="display:none"><span>계산 안내</span><strong data-special-settlement-note></strong></div>`}
      </div>
      </section>
      <div class="form-sec-head"><h3>주문·금액</h3></div>
      <div class="field three">
        <div><label>주문번호</label><input name="orderNo" value="${h(item.orderNo)}" required></div>
        <div><label>주문자명</label><input name="customerName" value="${h(item.customerName)}" required></div>
        <div><label>수량</label><input name="quantity" type="number" min="0" step="1" value="${h(item.quantity || "")}" placeholder="총 수량"></div>
      </div>
      <div class="field" data-show-direct="1" style="display:none">
        <label>총 입금액 (배송비 포함, 역산 입력)</label>
        <input name="directTotalAmount" type="text" inputmode="numeric" class="money-input" value="${h(formatAmount(item.depositAmount))}" placeholder="예: 8,800">
        <div class="muted" data-direct-breakdown style="margin-top:4px"></div>
      </div>
      <div class="field two" data-hide-direct="1">
        <div><label>제품매출</label><input name="productSalesAmount" type="text" inputmode="numeric" class="money-input" value="${h(formatAmount(item.productSalesAmount || item.depositAmount))}"></div>
        <div>
          <label>기본 배송비 <span class="muted" style="font-weight:400">(수동 변경 가능)</span></label>
          <input name="baseShippingFee" type="text" inputmode="numeric" class="money-input" value="${h(formatAmount(defaultBaseShippingFee))}" data-manual="${baseShippingManual ? "1" : ""}">
        </div>
      </div>
      <div class="field">
        <label class="checkbox-line" style="justify-self:start"><input name="useExtraShippingFee" type="checkbox" ${extraShippingEnabled ? "checked" : ""}> 지역/예외 추가배송비 직접 입력</label>
      </div>
      <div class="field two" data-extra-shipping-fields style="${extraShippingEnabled ? "" : "display:none"}">
        <div><label>지역 추가배송비</label><input name="extraShippingFee" type="text" inputmode="numeric" class="money-input" value="${h(formatAmount(defaultExtraShippingFee))}"></div>
        <div><label>추가배송비 메모</label><input name="extraShippingNote" value="${h(item.extraShippingNote || "")}" placeholder="예: 제주 추가 4,000원"></div>
      </div>
      <div class="field three">
        <div><label>총 배송비</label><input name="shippingFee" type="text" readonly class="money-input" value="${h(formatAmount(defaultShippingFee))}"></div>
        <div data-hide-direct="1"><label>수수료율(%)</label><input name="commissionRate" type="number" min="0" max="100" step="0.1" readonly value="${h(item.commissionRate ?? promotion?.commissionRate ?? selectedBrand?.commissionRate ?? "")}"></div>
        <div data-supply-amount-field style="${settlementType === "prepay_supply" ? "" : "display:none"}"><label>공급가 합</label><input name="supplyAmount" type="text" inputmode="numeric" class="money-input" value="${h(formatAmount(item.supplyAmount))}"></div>
      </div>
      <div class="field" data-hide-direct="1">
        <label>적용 프로모션</label>
        <select name="promotionRuleId">
          <option value="">(자동)</option>
          ${(selectedBrand ? state.promotionRules.filter((rule) => rule.brandId === selectedBrand.id && rule.isActive !== false) : [])
            .map((rule) => {
              const from = rule.validFrom || "0000-01-01";
              const to = rule.validTo || "9999-12-31";
              const targetDate = item.expectedDepositDate || new Date().toISOString().slice(0, 10);
              const outOfPeriod = !(from <= targetDate && targetDate <= to);
              return `<option value="${rule.id}" ${item.promotionRuleId === rule.id ? "selected" : ""}>${h(rule.name)}${outOfPeriod ? " (기간외)" : ""}</option>`;
            }).join("")}
        </select>
        <span class="muted" data-promotion-preview>${h(item.promotionRuleName || promotion?.name || "없음")}</span>
        ${lineItems.length ? `<span class="muted">품목별 항목을 쓰는 요청은 여기서 고른 값이 계산에 반영되지 않습니다 — 각 품목 행에서 지정하세요.</span>` : ""}
      </div>
      <div class="form-sec-head" data-hide-direct="1"><h3>품목</h3><span class="meta">최대 30개 행 · 현재판매가는 원판매가−할인금액 자동</span></div>
      <div class="field" data-hide-direct="1">
        <label>품목 검색해서 추가</label>
        <input name="lineItemsJson" type="hidden" value='${h(JSON.stringify(lineItems))}'>
        <div class="field two">
          <div class="autocomplete" style="position:relative">
            <input name="lineItemSearch" autocomplete="off" placeholder="품목코드 또는 품목명 검색 (입력 즉시 목록에서 선택)">
            <div class="autocomplete-menu" data-line-item-menu hidden></div>
          </div>
          <div><input name="lineItemQty" type="number" min="1" value="1" placeholder="수량"></div>
        </div>
        <datalist id="request-price-options"></datalist>
        <div class="toolbar" style="margin-top:8px">
          <button type="button" data-add-line-item>단가표에서 추가</button>
          <span class="muted" data-bulk-result></span>
        </div>
        <div data-line-items-table>${renderRequestLineItems(lineItems)}</div>
        <div class="toolbar" style="margin-top:8px">
          <button type="button" class="primary" data-add-manual-line-item>+ 행 추가</button>
          <span class="muted">모든 값은 선택 입력입니다.</span>
        </div>
      </div>
      <div class="form-sec-head"><h3>입금</h3></div>
      <div class="field two">
        <div>
          <label>업체 실 입금액 <span class="muted" style="font-weight:400">(직접 고치면 그 금액으로 고정)</span></label>
          <input name="depositAmount" type="text" inputmode="numeric" class="money-input" value="${h(formatAmount(item.depositAmount))}" data-manual="${item.depositAmountManual ? "1" : ""}">
          <p class="muted" data-deposit-manual-hint style="margin:4px 0 0;display:none"></p>
        </div>
        <div data-receivable-deduction-field style="${showReceivableFields ? "" : "display:none"}"><label data-receivable-deduction-label>${h(receivableLabel)}</label><input name="receivableDeduction" type="text" readonly class="money-input" value="${h(formatAmount(item.receivableDeduction))}"></div>
      </div>
      <div class="field two">
        <div>
          <label>기지급액 <span class="muted" style="font-weight:400">(이미 보낸 금액 — 부족분만 추가 지급 시)</span></label>
          <input name="priorPaidAmount" type="text" inputmode="numeric" class="money-input" value="${h(formatAmount(item.priorPaidAmount))}" placeholder="0">
        </div>
        <div><label>기지급 메모</label><input name="priorPaidNote" value="${h(item.priorPaidNote || "")}" placeholder="예: 6/25 수수료 공제분 37,500 선지급"></div>
      </div>
      <div class="field" data-prior-paid-hint style="${Number(item.priorPaidAmount || 0) > 0 ? "" : "display:none"}"></div>
      <div class="field two">
        <div><label>입금 예정일</label><input name="expectedDepositDate" type="date" value="${h(item.expectedDepositDate)}"></div>
        <div>
          <label>조정 반영 후 최종 입금액 <span class="muted" style="font-weight:400">(자동 계산, 직접 수정 가능)</span></label>
          <input name="paidAmount" type="text" inputmode="numeric" class="money-input" value="${h(formatAmount(item.paidAmount))}" data-manual="${item.paidAmount ? "1" : ""}">
        </div>
      </div>
      <div class="field two">
        <div><label>입금일시</label><input name="paidAt" type="datetime-local" step="1" value="${h(toDatetimeLocal(item.paidAt))}"></div>
        <div><label>상태</label><select name="status">${["pending", "await_deposit", "consignment_unpaid", "paid", "hold", "error"].map((s) => `<option value="${s}" ${(item.status || (settlementType === "consignment" ? "consignment_unpaid" : "pending")) === s ? "selected" : ""}>${statusLabel(s)}</option>`).join("")}</select></div>
      </div>
      <div class="form-sec-head"><h3>메모·이체 표시</h3></div>
      <div class="field">
        <label>주문 메모</label>
        <textarea name="notes" placeholder="해당 입금건에 대한 메모 (예: 통화 내용, 특이사항 등)">${h(item.notes || "")}</textarea>
      </div>
      <div class="field two">
        <div>
          <label>출금통장표시 <span class="muted" style="font-weight:400">(이체양식 · 비우면 브랜드 기본값)</span></label>
          <input name="withdrawMemo" data-manual="${item.withdrawMemo ? "1" : ""}" oninput="this.dataset.manual='1'" value="${h(item.withdrawMemo ?? selectedBrand?.withdrawMemoDefault ?? "")}" placeholder="${h(selectedBrand?.withdrawMemoDefault || "브랜드명선매입")}">
        </div>
        <div>
          <label>입금통장표시 <span class="muted" style="font-weight:400">(이체양식 · 기본 공란)</span></label>
          <input name="depositMemo" value="${h(item.depositMemo || "")}">
        </div>
      </div>
      <div class="form-sec-head"><h3>정산 조정</h3><span class="meta">필요할 때만 펼치세요</span></div>
      <details class="fixed-summary collapsible-summary" ${
        Number(item.overpaidAmount || 0) > 0 || Number(item.creditUsedAmount || 0) > 0 || item.overpaidNote || item.creditUsedNote ? "open" : ""
      }>
        <summary class="fixed-summary-title">외상 처리 <span class="muted" style="font-weight:400">(품절·가격변경·오입금 등 정산 조정용)</span></summary>
        <div data-brand-credit-hint class="muted" style="margin-bottom:8px">${
          selectedBrand
            ? `${h(selectedBrand.name)} 외상 잔액: ${renderCreditBalance(selectedBrand.creditBalance)}`
            : "브랜드를 선택하면 잔액이 표시됩니다."
        }</div>
        <div class="field two">
          <div>
            <label>과입금(외상 발생)</label>
            <input name="overpaidAmount" type="text" inputmode="numeric" class="money-input" value="${h(formatAmount(item.overpaidAmount))}" placeholder="0">
          </div>
          <div>
            <label>과입금 사유</label>
            <select name="overpaidReason">
              ${["", "overpay", "sold_out", "price_change", "mispay", "manual"].map((v) => `<option value="${v}" ${(item.overpaidReason || "") === v ? "selected" : ""}>${v ? overpaidReasonLabel(v) : "선택 안 함"}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="field"><label>과입금 메모</label><input name="overpaidNote" value="${h(item.overpaidNote || "")}" placeholder="예: 품절로 ₩5,000 환불 대신 외상 처리"></div>
        <div class="field two">
          <div>
            <label>외상 차감(이번 송금 시 차감)</label>
            <input name="creditUsedAmount" type="text" inputmode="numeric" class="money-input" value="${h(formatAmount(item.creditUsedAmount))}" placeholder="0">
          </div>
          <div>
            <label>외상 차감 메모</label>
            <input name="creditUsedNote" value="${h(item.creditUsedNote || "")}" placeholder="예: 20260518-001 과입금 차감">
          </div>
        </div>
        <div class="muted">실제 송금액 ≒ 업체 실 입금액 − 외상 차감. 차감 금액은 직접 입력하세요.</div>
      </details>
      <details class="fixed-summary collapsible-summary" ${
        Number(item.cancelledAmount || 0) > 0 || item.cancelledNote ? "open" : ""
      }>
        <summary class="fixed-summary-title">환불·취소 처리 <span class="muted" style="font-weight:400">(품절·반품·부분취소)</span></summary>
        <div class="muted" style="margin-bottom:8px">
          채권: 입력 시 채권차감액에 자동 누적(수수료 중복 방지). 선매입: 외상 처리 섹션 활용. 위탁: 별도 환불 행 생성 필요.
        </div>
        <div class="field two">
          <div>
            <label>환불·취소 금액</label>
            <input name="cancelledAmount" type="text" inputmode="numeric" class="money-input" value="${h(formatAmount(item.cancelledAmount))}" placeholder="0">
          </div>
          <div>
            <label>사유</label>
            <select name="cancelledReason">
              ${[
                ["", "선택 안 함"],
                ["sold_out", "품절"],
                ["return", "반품"],
                ["partial_cancel", "부분 취소"],
                ["manual", "수동/기타"]
              ].map(([v, label]) => `<option value="${v}" ${(item.cancelledReason || "") === v ? "selected" : ""}>${label}</option>`).join("")}
            </select>
          </div>
        </div>
        <div class="field"><label>환불/취소 메모</label><input name="cancelledNote" value="${h(item.cancelledNote || "")}" placeholder="예: 사료 1포 품절 4,000원"></div>
      </details>

      <div class="field" data-hide-direct="1">
        <label>계산 수수료 <span class="muted" style="font-weight:400" data-commission-display-hint>${selectedBrand?.hasReceivable ? "(채권 기준 — 프로모션 무시)" : "(실제 차감액)"}</span></label>
        <input name="commissionAmount" type="text" readonly class="money-input" value="${h(formatAmount(item.commissionAmount))}">
      </div>
      <div class="toolbar form-save-bar">
        <button class="primary" type="submit">${state.editingRequest?.id ? "수정 저장" : "요청 추가"}</button>
        ${state.editingRequest ? `<button type="button" data-cancel-edit>취소</button>` : ""}
      </div>
    </form>
  `;
}

function renderBrands() {
  const rules = filteredPromotionRules();
  const brandRows = filteredBrands();
  return `
    ${pageHead("브랜드", "시트별 업체 정보를 관리하고 공유 링크와 Google Sheets 아카이브 링크를 지정합니다.", `${state.admin?.role === "owner" ? `<button data-brand-info-upload>브랜드 설문 응답 올리기</button><input type="file" accept=".xlsx,.xls" data-brand-info-file hidden>` : ""}<button class="primary" data-new-brand>새 브랜드</button>`)}
    ${state.admin?.role === "owner" ? renderShipNotifySettings() : ""}
    <section class="layout brands-layout">
      <div class="panel">
        <div class="panel-head"><h2>브랜드 목록</h2><span class="muted">${money.format(brandRows.length)}개</span></div>
        <div class="panel-body" style="padding-bottom:0">
          <input data-brand-filter-q placeholder="브랜드명, 사업자명 검색" value="${h(state.brandFilterQ)}">
          <div class="npb-subnav" style="margin:8px 0 0">${[["all", "전체"], ["active", "최근 6개월 거래"], ["dormant", `장기 미거래 ${(state.brandActivity?.dormant || []).length || ""}`]].map(([k, l]) => `<button class="npb-subtab ${(state.brandDormantFilter || "all") === k ? "active" : ""}" data-brand-dormant="${k}">${l}</button>`).join("")}</div>
        </div>
        <div class="table-wrap">
          <table class="compact brands-table" data-unit="원">
            <thead><tr><th>브랜드</th><th>정산유형</th><th data-nounit="1">요청</th><th>금액/채권잔액</th><th>외상잔액</th><th>사업자</th><th>프로모션</th><th>공유</th><th>작업</th></tr></thead>
            <tbody>${brandRows.map(renderBrandRow).join("") || `<tr><td colspan="9" class="empty">표시할 브랜드가 없습니다.</td></tr>`}</tbody>
          </table>
        </div>
        <div class="panel-body">
          <h3 style="margin-top:0">프로모션 규칙 (수수료 / 가격할인)</h3>
          <div class="table-wrap" style="max-height:280px">
            <table class="compact promotion-rules-table">
              <thead><tr><th>브랜드</th><th>프로모션</th><th>범위</th><th>수수료율</th><th>가격 할인</th><th>기간</th><th>상태</th><th>작업</th></tr></thead>
              <tbody>
                ${rules.map((item) => `
                  <tr>
                    <td>${h(item.brandName)}</td>
                    <td>${h(item.name)}</td>
                    <td class="wrap">${h(item.scopeType === "items" ? (item.targetItemLabels || []).join(", ") || "특정 품목" : "브랜드 전체")}</td>
                    <td>${item.commissionRate || item.commissionRate === 0 ? `${h(item.commissionRate)}%` : `<span class="muted">-</span>`}</td>
                    <td class="wrap">${renderPromotionDiscountCell(item)}</td>
                    <td>${h(item.validFrom || "-")}${item.validTo ? ` ~ ${h(item.validTo)}` : " ~ 상시"}</td>
                    <td>${promotionRuleStatusLabel(item)}</td>
                    <td><div class="row-actions"><button data-edit-promotion-rule="${item.id}">수정</button><button class="danger icon-btn" data-delete-promotion-rule="${item.id}" aria-label="삭제" title="삭제">×</button></div></td>
                  </tr>`).join("") || `<tr><td colspan="8" class="empty">등록된 프로모션 규칙이 없습니다.</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>${state.editingBrand ? "브랜드 수정" : "브랜드 입력"}</h2></div>
        <div class="panel-body">
          ${renderBrandForm()}
          <hr style="border:none;border-top:1px solid var(--line);margin:20px 0">
          <h3 style="margin:0 0 12px">${state.editingPromotionRule ? "프로모션 규칙 수정" : "프로모션 규칙 등록"}</h3>
          ${renderPromotionRuleForm()}
        </div>
      </div>
    </section>
  `;
}

function renderPrices() {
  const rows = filteredPriceCatalog();
  const revisions = filteredPriceEntries();
  const aliases = filteredPriceAliases();
  const selectedBrand = state.brands.find((b) => b.id === state.priceFilters.brandId) || null;
  return `
    ${pageHead("단가표", "브랜드별 품목 공급가와 개정 이력을 관리합니다.", `<button class="primary" data-new-price-entry>새 단가 개정</button>`)}
    <section class="layout">
      <div class="panel">
        <div class="panel-head">
          <h2>현재 적용 단가</h2>
          <div class="toolbar">
            <select data-price-brand-filter>
              <option value="">전체 브랜드</option>
              ${state.brands.filter((b) => b.type === "brand").map((b) => `<option value="${b.id}" ${state.priceFilters.brandId === b.id ? "selected" : ""}>${h(b.name)}</option>`).join("")}
            </select>
            <button type="button" data-download-price-template ${selectedBrand ? "" : "disabled"}>업로드 양식 다운로드</button>
            <label class="file-button">
              <input type="file" data-price-import-file accept=".xlsx,.xlsm,.xltx">
              Excel 선택
            </label>
            <button type="button" data-upload-price-template ${selectedBrand ? "" : "disabled"}>엑셀 업로드 반영</button>
          </div>
        </div>
        <div class="panel-body" style="padding-bottom:0">
          <div class="notice">
            ${selectedBrand ? `${h(selectedBrand.name)} 기준으로 현재 단가가 담긴 업로드 양식을 내려받아 수정 후 다시 업로드하면 일괄 수정됩니다.` : "브랜드를 선택하면 현재 단가가 담긴 Excel 양식을 내려받아 일괄 수정할 수 있습니다."}
          </div>
          <div class="muted price-import-guide">기존 행 수정, 신규 추가, 개정추가, 삭제를 한 파일에서 같이 반영할 수 있습니다.</div>
          ${state.priceImportStatus ? `<div class="${state.priceImportStatus.kind === "error" ? "error-text" : "notice"}">${h(state.priceImportStatus.text)}${state.priceImportStatus.details?.length ? `<br>${state.priceImportStatus.details.map((item) => h(item)).join("<br>")}` : ""}</div>` : ""}
        </div>
        <div class="table-wrap">
          <table class="price-catalog-table">
            <thead><tr><th>브랜드</th><th>코드</th><th>품목명</th><th>옵션</th><th>공급가</th><th>원판매가</th><th>할인금액</th><th>현재 판매가</th><th>적용 시작</th><th>적용 종료</th><th>작업</th></tr></thead>
            <tbody>
              ${rows.map((item) => `
                <tr>
                  <td>${h(item.brandName)}</td>
                  <td>${h(item.itemCode)}</td>
                  <td>${codeTag(item)}${h(item.itemName)}</td>
                  <td>${h(item.spec || item.unit || "")}</td>
                  <td>${money.format(Number(item.supplyPrice || 0))}원</td>
                  <td>${money.format(Number(item.originalPrice || item.consumerPrice || 0))}원</td>
                  <td>${money.format(Number(item.discountPrice || 0))}원</td>
                  <td>${money.format(Number(item.salePrice || 0))}원</td>
                  <td>${h(item.effectiveFrom)}</td>
                  <td>${h(item.effectiveTo || "상시")}</td>
                  <td><div class="row-actions"><button data-clone-price-entry="${item.id}">개정 추가</button><button data-edit-price-entry="${item.id}">수정</button><button class="danger icon-btn" data-delete-price-entry="${item.id}" aria-label="삭제" title="삭제">×</button></div></td>
                </tr>`).join("") || `<tr><td colspan="11" class="empty">등록된 품목이 없습니다.</td></tr>`}
            </tbody>
          </table>
        </div>
        <div class="panel-body">
          <h3 style="margin-top:0">개정 이력</h3>
          <div class="table-wrap" style="max-height:280px">
            <table class="price-revisions-table">
              <thead><tr><th>브랜드</th><th>코드</th><th>품목명</th><th>공급가</th><th>원판매가</th><th>할인금액</th><th>현재 판매가</th><th>적용 시작</th><th>적용 종료</th><th>작업</th></tr></thead>
              <tbody>
                ${revisions.map((item) => `
                  <tr>
                    <td>${h(item.brandName)}</td>
                    <td>${h(item.itemCode)}</td>
                    <td>${codeTag(item)}${h(item.itemName)}</td>
                    <td>${money.format(Number(item.supplyPrice || 0))}원</td>
                    <td>${money.format(Number(item.originalPrice || item.consumerPrice || 0))}원</td>
                    <td>${money.format(Number(item.discountPrice || 0))}원</td>
                    <td>${money.format(Number(item.salePrice || 0))}원</td>
                    <td>${h(item.effectiveFrom)}</td>
                    <td>${h(item.effectiveTo || "상시")}</td>
                    <td><div class="row-actions"><button data-edit-price-entry="${item.id}">수정</button><button class="danger icon-btn" data-delete-price-entry="${item.id}" aria-label="삭제" title="삭제">×</button></div></td>
                  </tr>`).join("") || `<tr><td colspan="10" class="empty">개정 이력이 없습니다.</td></tr>`}
              </tbody>
            </table>
          </div>
          <h3>기간별 품목 별칭</h3>
          <div class="table-wrap" style="max-height:280px">
            <table class="price-aliases-table">
              <thead><tr><th>브랜드</th><th>별칭</th><th>연결 품목</th><th>적용 기간</th><th>상태</th><th>작업</th></tr></thead>
              <tbody>
                ${aliases.map((item) => `
                  <tr>
                    <td>${h(item.brandName)}</td>
                    <td>${h(item.aliasText)}</td>
                    <td>${h(item.targetItemCode ? `${item.targetItemCode} | ` : "")}${h(item.targetItemName)}</td>
                    <td>${h(item.validFrom || "-")}${item.validTo ? ` ~ ${h(item.validTo)}` : " ~ 상시"}</td>
                    <td>${priceAliasStatusLabel(item)}</td>
                    <td><div class="row-actions"><button data-edit-price-alias="${item.id}">수정</button><button class="danger icon-btn" data-delete-price-alias="${item.id}" aria-label="삭제" title="삭제">×</button></div></td>
                  </tr>`).join("") || `<tr><td colspan="6" class="empty">등록된 별칭이 없습니다.</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>${state.editingPriceEntry?.id ? "단가 이력 수정" : "단가 개정 등록"}</h2></div>
        <div class="panel-body">
          ${renderPriceEntryForm()}
          <hr style="border:none;border-top:1px solid var(--line);margin:20px 0">
          <h3 style="margin:0 0 12px">${state.editingPriceAlias ? "기간 별칭 수정" : "기간 별칭 수정 대기"}</h3>
          ${renderPriceAliasForm()}
        </div>
      </div>
    </section>
  `;
}

function renderPriceEntryForm() {
  const item = state.editingPriceEntry || {};
  return `
    <form class="form-grid" data-price-entry-form>
      <div class="field">
        <label>브랜드</label>
        <select name="brandId" ${item.id ? "disabled" : ""}>
          <option value="">브랜드 선택</option>
          ${state.brands.filter((b) => b.type === "brand").map((b) => `<option value="${b.id}" ${item.brandId === b.id ? "selected" : ""}>${h(b.name)}</option>`).join("")}
        </select>
      </div>
      <div class="field two">
        <div><label>품목코드</label><input name="itemCode" value="${h(item.itemCode)}"></div>
        <div><label>품목명</label><input name="itemName" value="${h(item.itemName)}" required></div>
      </div>
      <div class="field two">
        <div><label>옵션</label><input name="spec" value="${h(item.spec)}"></div>
        <div><label>수량</label><input name="unit" value="${h(item.unit)}"></div>
      </div>
      <div class="field two">
        <div><label>공급가 <span class="muted" style="font-weight:400">(수수료 기준 브랜드는 비워두세요)</span></label><input name="supplyPrice" type="number" min="0" value="${h(item.supplyPrice || "")}"></div>
        <div><label>적용 시작일</label><input name="effectiveFrom" type="date" value="${h(item.effectiveFrom || new Date().toISOString().slice(0, 10))}" required></div>
      </div>
      <div class="field"><label>적용 종료일 (비우면 상시)</label><input name="effectiveTo" type="date" value="${h(item.effectiveTo || "")}"></div>
      <div class="field three">
        <div><label>원판매가</label><input name="originalPrice" type="number" min="0" value="${h((item.originalPrice ?? item.consumerPrice) || "")}"></div>
        <div><label>할인금액</label><input name="discountPrice" type="number" min="0" value="${h(item.discountPrice || "")}"></div>
        <div><label>현재 판매가</label><input name="salePrice" type="number" min="0" value="${h(item.salePrice || "")}"></div>
      </div>
      <div class="field"><label>바코드</label><input name="barcode" value="${h(item.barcode)}"></div>
      <div class="field"><label>메모</label><textarea name="note">${h(item.note)}</textarea></div>
      <div class="field"><label>사용 상태</label><select name="isActive"><option value="true" ${item.isActive !== false ? "selected" : ""}>Y</option><option value="false" ${item.isActive === false ? "selected" : ""}>N</option></select></div>
      <div class="toolbar">
        <button class="primary" type="submit">${item.id ? "수정 저장" : "개정 등록"}</button>
        ${state.editingPriceEntry ? `<button type="button" data-cancel-price-entry>취소</button>` : ""}
      </div>
    </form>
  `;
}

function filteredPriceCatalog() {
  return state.priceCatalog.filter((item) => !state.priceFilters.brandId || item.brandId === state.priceFilters.brandId);
}

function filteredPriceEntries() {
  return state.priceEntries.filter((item) => !state.priceFilters.brandId || item.brandId === state.priceFilters.brandId);
}

function filteredPriceAliases() {
  return state.aliasEntries.filter((item) => !state.priceFilters.brandId || item.brandId === state.priceFilters.brandId);
}

function filteredBrands() {
  const q = normalizeSearchText(state.brandFilterQ);
  const dormant = new Set(state.brandActivity?.dormant || []);
  const mode = state.brandDormantFilter || "all";
  return state.brands.filter((brand) => {
    if (mode === "dormant" && !dormant.has(brand.id)) return false;
    if (mode === "active" && (dormant.has(brand.id) || brand.type === "reference")) return false;
    if (!q) return true;
    return normalizeSearchText(`${brand.name || ""} ${brand.businessName || ""} ${brand.rawSheetName || ""}`).includes(q);
  });
}

function renderPriceAliasForm() {
  const item = state.editingPriceAlias;
  if (!item) return `<div class="empty">왼쪽 목록에서 수정할 기간 별칭을 선택하세요.</div>`;
  const targets = state.priceCatalog.filter((entry) => entry.brandId === item.brandId);
  return `
    <form class="form-grid" data-price-alias-form>
      <div class="field">
        <label>브랜드</label>
        <input value="${h(item.brandName)}" disabled>
      </div>
      <div class="field">
        <label>별칭 문구</label>
        <input name="aliasText" value="${h(item.aliasText)}" required>
      </div>
      <div class="field">
        <label>연결 품목</label>
        <select name="priceEntryId" required>
          <option value="">품목 선택</option>
          ${targets.map((entry) => `<option value="${entry.id}" ${item.priceEntryId === entry.id ? "selected" : ""}>${h(formatPriceOption(entry))}</option>`).join("")}
        </select>
      </div>
      <div class="field two">
        <div><label>적용 시작일</label><input name="validFrom" type="date" value="${h(item.validFrom || "")}" required></div>
        <div><label>적용 종료일</label><input name="validTo" type="date" value="${h(item.validTo || "")}"></div>
      </div>
      <div class="field"><label>메모</label><input name="note" value="${h(item.note || "")}"></div>
      <div class="field"><label>상태</label><select name="isActive"><option value="true" ${item.isActive !== false ? "selected" : ""}>Y</option><option value="false" ${item.isActive === false ? "selected" : ""}>N</option></select></div>
      <div class="toolbar">
        <button class="primary" type="submit">수정 저장</button>
        <button type="button" data-cancel-price-alias>취소</button>
      </div>
    </form>
  `;
}

function renderRequestLineItemsSummary(items) {
  const real = items.filter(
    (item) => String(item.itemCode || "").trim() || String(item.itemName || "").trim()
  );
  if (!real.length) return "";
  const sum = (fn) => real.reduce((acc, item) => acc + fn(item), 0);
  const qty = (item) => Math.max(0, Number(item.quantity || 0));
  const totalCount = real.length;
  const totalQty = sum(qty);
  const totalSupply = sum((item) => qty(item) * Number(item.unitSupplyPrice || 0));
  const totalOriginal = sum((item) => qty(item) * Number(item.originalPrice || 0));
  const totalDiscount = sum((item) => qty(item) * Number(item.discountPrice || 0));
  const totalSale = sum((item) => Number(item.totalSaleAmount || qty(item) * Number(item.unitSalePrice || 0)));
  const cell = (label, value) => `<span><b>${label}</b> ${value}</span>`;
  return `
    <div class="line-items-summary" data-line-items-summary>
      ${cell("총 건수", `${money.format(totalCount)}건`)}
      ${cell("총 수량", `${money.format(totalQty)}개`)}
      ${cell("총 공급가", `${money.format(totalSupply)}원`)}
      ${cell("총 원판매가", `${money.format(totalOriginal)}원`)}
      ${cell("총 할인금액", `${money.format(totalDiscount)}원`)}
      ${cell("현재판매가 총합계", `${money.format(totalSale)}원`)}
    </div>
  `;
}

function renderRequestLineItems(items, promotionOptions = []) {
  if (!items.length) return `<div class="empty">추가된 품목이 없습니다.</div>`;
  const promotionCell = (item) => {
    if (!promotionOptions.length) return `<span class="muted">규칙 없음</span>`;
    const options = [`<option value="">(자동)</option>`]
      .concat(promotionOptions.map((rule) =>
        `<option value="${rule.id}" ${item.promotionRuleId === rule.id ? "selected" : ""}>${h(rule.name)}${rule.outOfPeriod ? " (기간외)" : ""}</option>`))
      .join("");
    return `<select data-line-promotion="${item.id}" aria-label="프로모션">${options}</select>`;
  };
  return `
    <div class="table-wrap line-items-wrap" style="max-height:300px">
      <table class="line-items-table">
        <thead><tr><th>작업</th><th>주문번호</th><th>코드</th><th>품목명</th><th>수량</th><th>공급가</th><th>원판매가</th><th>할인금액</th><th>현재판매가</th><th>적용시작</th><th>적용종료</th><th>판매합계</th><th>프로모션</th></tr></thead>
        <tbody>
          ${items.map((item) => `
            <tr data-line-row="${item.id}">
              <td><button type="button" class="danger icon-btn" data-remove-line-item="${item.id}" aria-label="삭제" title="삭제">×</button></td>
              <td><span class="muted">${h(item.orderItemCode || "")}</span></td>
              <td><input value="${h(item.itemCode || "")}" data-line-code="${item.id}" aria-label="품목코드" placeholder="코드"></td>
              <td><input value="${h(item.itemName || "")}" data-line-name="${item.id}" aria-label="품목명" placeholder="품목명">${
                item.optionName ? `<div class="muted" style="font-size:11px">- 옵션 : ${h(item.optionName)}</div>` : ""
              }</td>
              <td><input type="number" min="1" value="${h(item.quantity)}" data-line-qty="${item.id}" class="qty-input" aria-label="수량"></td>
              <td><input type="text" inputmode="numeric" class="money-input" value="${h(formatAmount(item.unitSupplyPrice))}" data-line-supply-price="${item.id}" aria-label="공급가" placeholder="선택"></td>
              <td><input type="text" inputmode="numeric" class="money-input" value="${h(formatAmount(item.originalPrice))}" data-line-original="${item.id}" aria-label="원판매가" placeholder="선택"></td>
              <td><input type="text" inputmode="numeric" class="money-input" value="${h(formatAmount(item.discountPrice))}" data-line-discount="${item.id}" aria-label="할인금액" placeholder="선택"></td>
              <td><input type="text" inputmode="numeric" class="money-input" value="${h(formatAmount(item.unitSalePrice))}" data-line-sale-price="${item.id}" aria-label="현재판매가" placeholder="자동"></td>
              <td><input type="date" value="${h(item.effectiveFrom || "")}" data-line-from="${item.id}" aria-label="적용시작"></td>
              <td><input type="date" value="${h(item.effectiveTo || "")}" data-line-to="${item.id}" aria-label="적용종료"></td>
              <td data-line-saletotal="${item.id}">${money.format(Number(item.totalSaleAmount || 0))}원</td>
              <td>${promotionCell(item)}</td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>
    <div data-line-items-summary-slot>${renderRequestLineItemsSummary(items)}</div>
  `;
}

function renderBulkUnmatchedItems(items) {
  if (!items.length) return "";
  return `
    <div class="unmatched-list">
      ${items.map((item) => `
        <div class="unmatched-item">
          <div class="unmatched-summary">
            <strong>${h(item.itemName || item.itemCode || item.raw)}</strong>
            <span class="muted">수량 ${h(item.quantity)} · 원본: ${h(item.raw)}</span>
          </div>
          <div class="field two">
            <div>
              <label>기존 단가 매핑</label>
              <input type="text" value="${h(item.suggestedSearch || item.itemName || item.itemCode)}" data-unmatched-map-input="${item.id}" list="request-price-options">
            </div>
            <div>
              <label>신규 공급가</label>
              <input type="number" min="0" placeholder="공급가" data-unmatched-supply-price="${item.id}">
            </div>
          </div>
          <div class="field two">
            <div>
              <label>자동 매핑 별칭</label>
              <input type="text" value="${h(item.aliasText || item.itemName || item.itemCode || item.raw)}" data-unmatched-alias-text="${item.id}" placeholder="다음부터 자동 인식할 문구">
            </div>
            <div>
              <label>메모</label>
              <input type="text" value="${h(item.aliasNote || "")}" data-unmatched-alias-note="${item.id}" placeholder="예: 행사 표기 변경">
            </div>
          </div>
          <div class="field two">
            <div>
              <label>적용 시작일</label>
              <input type="date" value="${h(item.defaultValidFrom || "")}" data-unmatched-alias-from="${item.id}">
            </div>
            <div>
              <label>적용 종료일</label>
              <input type="date" value="${h(item.defaultValidTo || "")}" data-unmatched-alias-to="${item.id}">
            </div>
          </div>
          <div class="toolbar">
            <button type="button" data-apply-unmatched-map="${item.id}">기존 단가 연결</button>
            <button type="button" data-create-unmatched-alias="${item.id}">기간 별칭 저장 후 연결</button>
            <button type="button" data-create-unmatched-price="${item.id}">새 단가 등록 후 추가</button>
            <button type="button" data-dismiss-unmatched="${item.id}">제외</button>
          </div>
        </div>
      `).join("")}
    </div>
  `;
}

function renderBrandRow(brand) {
  const share = `${location.origin}/share/${brand.shareToken}`;
  return `
    <tr class="hub-go" data-row-edit="[data-edit-brand]">
      <td>${codeTag(brand)}${brand.starred ? "★ " : ""}${h(brand.name)}${(state.brandActivity?.dormant || []).includes(brand.id) && brand.type !== "reference" ? ` <span class="badge muted" title="마지막 입금요청 ${h(state.brandActivity?.lastRequest?.[brand.id] || "없음")}">장기 미거래</span>` : ""}</td>
      <td><span class="badge">${brand.type === "reference" ? "참고시트" : settlementLabel(brand.settlementType)}</span></td>
      <td class="num">${money.format(brand.requestCount || 0)}건</td>
      <td class="num">${brand.hasReceivable ? money.format(brand.receivableRemaining || 0) : money.format(brand.totalAmount || 0)}</td>
      <td class="num">${renderCreditBalance(brand.creditBalance, false)}</td>
      <td class="wrap">${h(brand.businessName || "-")}<br><span class="muted">${h(cutoffLabel(brand))}</span></td>
      <td class="wrap">${h(brand.promotionSummary || "-")}</td>
      <td><a href="${share}" target="_blank" rel="noreferrer">공유 보기</a></td>
      <td><div class="row-actions"><button data-edit-brand="${brand.id}">수정</button><a href="/api/export/brand/${brand.id}.xls"><button>Excel</button></a><button class="danger icon-btn" data-delete-brand="${brand.id}" aria-label="삭제" title="삭제">×</button></div></td>
    </tr>
  `;
}

// 계약 규칙은 버전으로 쌓인다. 시작일을 비우고 저장하면 지금 적용 중인 버전을
// 고친 것으로 보고, 날짜를 넣으면 그 날짜부터 유효한 새 버전이 생긴다. 정산은
// 주문의 배송완료일 시점에 유효했던 버전으로 계산하므로, 지난달 정산이 이번 달
// 새 계약으로 다시 계산되는 일이 없다.
function brandPayAfterShipping(brand) {
  return brand?.payAfterShipping === true || brand?.payAfterShipping === "true";
}

function renderBrandRuleSection(brand) {
  if (!brand?.id) {
    return `<div class="field"><label>계약 규칙 변경</label>
      <span class="muted">브랜드를 저장한 뒤에 규칙 변경 이력을 관리할 수 있습니다.</span></div>`;
  }
  const history = [...(brand.ruleHistory || [])].sort((a, b) => String(b.validFrom).localeCompare(String(a.validFrom)));
  const today = new Date().toISOString().slice(0, 10);
  const activeId = history.filter((r) => String(r.validFrom) <= today).sort((a, b) => String(a.validFrom).localeCompare(String(b.validFrom))).pop()?.id;
  const rows = history
    .map((rule) => {
      const isActive = rule.id === activeId;
      const isFuture = String(rule.validFrom) > today;
      const badge = isActive
        ? `<span class="badge clobe-high">적용중</span>`
        : isFuture
          ? `<span class="badge clobe-medium">예정</span>`
          : `<span class="badge">과거</span>`;
      return `<tr>
        <td>${badge}</td>
        <td>${h(rule.validFrom)}${rule.validFrom === "2000-01-01" ? `<br><span class="muted">최초</span>` : ""}</td>
        <td class="num">${h(Number(rule.commissionRate || 0))}%</td>
        <td>${h(rule.shippingRule || "")}</td>
        <td>${h(rule.note || "")}</td>
        <td>
          <button type="button" data-edit-brand-rule="${rule.id}">이 버전 수정</button>
          ${history.length > 1 ? `<button type="button" class="danger icon-btn" data-remove-brand-rule="${rule.id}" aria-label="삭제" title="삭제">×</button>` : ""}
        </td>
      </tr>`;
    })
    .join("");
  return `
    <div class="field">
      <label>계약 규칙 변경 (적용 시작일)</label>
      <input name="ruleValidFrom" type="date" value="">
      <span class="muted">
        위 수수료율·배송비를 <b>언제부터</b> 적용할지 지정합니다. 비워두면 지금 적용 중인 규칙을 수정합니다.
        정산은 주문의 <b>배송완료일</b> 기준으로 그 시점 규칙을 적용하므로, 지난 달 정산은 옛 규칙 그대로 계산됩니다.
      </span>
    </div>
    <div class="field"><label>변경 사유 (선택)</label>
      <input name="ruleNote" placeholder="예: 2026년 재계약 — 수수료 25%, 배송비 4,000원"></div>
    <div class="field">
      <label>규칙 이력</label>
      <div class="table-wrap" style="max-height:220px">
        <table class="brand-rule-history-table"><thead><tr><th>상태</th><th>적용 시작</th><th>수수료</th><th>배송비</th><th>사유</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table>
      </div>
    </div>
  `;
}

// 설문으로 받은 업체 정보(담당자·세금계산서 이메일·반품지 등). 보기 전용.
function renderBrandProfile(b) {
  const p = b.profile;
  if (!p) return "";
  const c = p.contacts || {};
  const person = (label, x) => x && (x.name || x.email || x.mobile || x.phone)
    ? `<tr><th>${label}</th><td>${h(x.name || "")} ${h(x.mobile || x.phone || "")} ${x.email ? `<a href="mailto:${h(x.email)}">${h(x.email)}</a>` : ""}</td></tr>` : "";
  const row = (label, v) => v ? `<tr><th>${label}</th><td class="wrap">${h(v)}</td></tr>` : "";
  return `<details class="brand-profile" open><summary>업체 정보 (브랜드 설문${b.profileUpdatedAt ? ` ${h(String(b.profileUpdatedAt).slice(0, 10))}` : ""})</summary>
    <table class="kv">${person("메인 담당자", c.main)}${person("정산 담당자", c.settlement)}${person("CS 담당자", c.cs)}${person("배송 담당자", c.delivery)}
    ${row("세금계산서 이메일", p.invoiceEmail)}${row("대표 전화", p.phone)}${row("사업자유형", p.businessType)}${row("공급형태", p.supplyType)}
    ${row("사업장 주소", p.address)}${row("반품지", p.returnAddress)}${row("택배사", p.courier)}${row("배송비 정책", p.shippingPolicyText)}${row("발송 마감", p.cutoffText)}
    ${row("공급사 아이디", p.supplierId)}${row("웹사이트", p.website)}${row("SNS", p.sns)}</table></details>`;
}

function brandEntity(b) {
  if (!b?.id) return null;
  const dig = (v) => String(v || "").replace(/\D/g, "");
  return (state.partners || []).find((p) => p.id === b.entityPartnerId) || (dig(b.businessNumber) ? (state.partners || []).find((p) => dig(p.businessNumber) === dig(b.businessNumber)) : null) || null;
}
function renderBrandForm() {
  const b = state.editingBrand || {};
  const ent = brandEntity(b);
  return `
    ${b.id ? `<p class="muted" style="margin:0 0 8px">사업자(거래처): ${ent ? `<button class="ghost small" data-brand-entity="${h(ent.id)}">${h(ent.name)} 열기</button>` : "아직 이어진 거래처 없음 — 거래 > 거래처에서 이 브랜드를 이을 수 있습니다"}</p>` : ""}
    ${renderBrandProfile(b)}
    <form class="form-grid" data-brand-form>
      <div class="field"><label>브랜드명</label><input name="name" value="${h(b.name)}" required></div>
      <div class="field two">
        <div><label>구분</label><select name="type"><option value="brand" ${(b.type || "brand") === "brand" ? "selected" : ""}>브랜드</option><option value="reference" ${b.type === "reference" ? "selected" : ""}>참고시트</option></select></div>
        <div><label>사용</label><select name="isActive"><option value="true" ${b.isActive !== false ? "selected" : ""}>Y</option><option value="false" ${b.isActive === false ? "selected" : ""}>N</option></select></div>
      </div>
      <div class="field">
        <label>정산유형</label>
        <select name="settlementType">
          ${["prepay_debt", "prepay_fee", "prepay_supply", "consignment", "direct_purchase"].map((s) => `<option value="${s}" ${(b.settlementType || "prepay_fee") === s ? "selected" : ""}>${settlementLabel(s)}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label>입금 시점</label>
        <select name="payAfterShipping">
          <option value="false" ${brandPayAfterShipping(b) ? "" : "selected"}>주문 즉시 입금요청 (기본)</option>
          <option value="true" ${brandPayAfterShipping(b) ? "selected" : ""}>출고 후 입금 — 송장이 찍히면 입금요청으로 전환</option>
        </select>
        <span class="muted">
          품절이 잦거나 오더메이드라 출고까지 며칠 걸리는 브랜드는 <b>출고 후 입금</b>으로 두세요.
          주문이 들어오면 <b>입금대기</b> 상태로 올라가고, 카페24에 송장이 입력되면 <b>입금요청</b>으로 바뀝니다.
        </span>
      </div>
      <div class="field">
        <label>정산 월 기준일</label>
        <select name="settlementDateBasis">
          <option value="order" ${(b.settlementDateBasis || (b.settlementType === "consignment" ? "delivered" : "order")) === "order" ? "selected" : ""}>주문일 기준 (주문번호 앞 8자리) · 출고완료(배송완료 또는 송장등록) 건만</option>
          <option value="delivered" ${(b.settlementDateBasis || (b.settlementType === "consignment" ? "delivered" : "order")) === "delivered" ? "selected" : ""}>배송완료일 기준 (주문일 무관)</option>
        </select>
        <span class="muted">
          어느 날짜로 정산월을 가를지 정합니다. 계약 규칙(수수료·배송비)도 같은 날짜로 적용됩니다.
          주문일 기준에서도 <b>배송완료된 건만</b> 정산에 들어갑니다 — 카페24에 배송완료가 안 찍힌 주문은 다음 달로 넘어갑니다.
        </span>
      </div>
      <div class="field two">
        <div><label>계약 수수료율(%)</label><input name="commissionRate" type="number" min="0" max="100" step="0.1" value="${h(b.commissionRate ?? "")}"></div>
        <div><label>채권액 있음</label><select name="hasReceivable"><option value="false" ${!b.hasReceivable ? "selected" : ""}>없음</option><option value="true" ${b.hasReceivable ? "selected" : ""}>있음</option></select></div>
      </div>
      <div class="field two" data-brand-receivable-fields style="${b.hasReceivable ? "" : "display:none"}">
        <div><label>총 채권액</label><input name="receivableTotal" type="number" min="0" value="${h(b.receivableTotal || "")}"></div>
        <div><label>위탁 입금 기한</label><input name="consignmentDueDay" placeholder="예: 익월 10일, 익월 말" value="${h(b.consignmentDueDay)}"></div>
      </div>
      <div class="field">
        <label>기본 배송비 규칙</label>
        <select name="shippingPolicyType">
          <option value="free" ${(b.shippingPolicyType || "free") === "free" ? "selected" : ""}>무료배송</option>
          <option value="flat" ${b.shippingPolicyType === "flat" ? "selected" : ""}>무조건 고정배송비</option>
          <option value="threshold" ${b.shippingPolicyType === "threshold" ? "selected" : ""}>N원 미만 배송비</option>
        </select>
      </div>
      <div class="field two">
        <div><label>고정 배송비</label><input name="shippingFlatFee" type="number" min="0" value="${h(b.shippingFlatFee || "")}" placeholder="예: 3000"></div>
        <div><label>기준 주문금액</label><input name="shippingThresholdAmount" type="number" min="0" value="${h(b.shippingThresholdAmount || "")}" placeholder="예: 50000"></div>
      </div>
      <div class="field two">
        <div><label>기준 미만 배송비</label><input name="shippingThresholdFee" type="number" min="0" value="${h(b.shippingThresholdFee || "")}" placeholder="예: 3000"></div>
        <div>
          <label>배송비 기준금액</label>
          <select name="shippingThresholdBase">
            <option value="sales" ${(b.shippingThresholdBase || "sales") !== "supply" ? "selected" : ""}>제품매출 기준 (고객 기준·일반)</option>
            <option value="supply" ${b.shippingThresholdBase === "supply" ? "selected" : ""}>공급가 기준 (입금액 기준·예: 펫페이스)</option>
          </select>
        </div>
      </div>
      <div class="field"><label>적용 미리보기</label><input value="${h(describeShippingRule(b))}" disabled></div>
      <div class="field"><label>배송비 운영 메모</label><input value="지역 추가배송비는 입금요청 입력에서 필요할 때만 별도 기입합니다." disabled></div>
      ${renderBrandRuleSection(b)}
      <div class="field two">
        <div>
          <label>출고 기준</label>
          <select name="cutoffType">
            <option value="time" ${(b.cutoffType || "time") === "time" ? "selected" : ""}>시간 지정</option>
            <option value="after_shipment" ${b.cutoffType === "after_shipment" ? "selected" : ""}>출고완료 확인 후 입금</option>
            <option value="consignment" ${b.cutoffType === "consignment" ? "selected" : ""}>위탁입금</option>
          </select>
        </div>
        <div>
          <label>출고 마감시간</label>
          <select name="cutoffHour">
            <option value="">선택</option>
            ${Array.from({ length: 12 }, (_, index) => index + 8).map((hour) => `<option value="${String(hour).padStart(2, "0")}" ${String(b.cutoffHour || "") === String(hour).padStart(2, "0") ? "selected" : ""}>${String(hour).padStart(2, "0")}:00</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="field"><label>출고마감/정산 메모</label><textarea name="cutoffNote">${h(b.cutoffNote)}</textarea></div>
      <div class="field"><label>필수 메모 및 계좌 확인</label><textarea name="requiredMemo">${h(b.requiredMemo)}</textarea></div>
      <div class="field two">
        <div><label>사업자명</label><input name="businessName" value="${h(b.businessName)}"></div>
        <div><label>사업자번호</label><input name="businessNumber" value="${h(b.businessNumber)}"></div>
      </div>
      <div class="field"><label>대표자명</label><input name="representativeName" value="${h(b.representativeName)}"></div>
      <div class="field two">
        <div>
          <label>연결 거래처 <span class="muted" style="font-weight:400">(같은 회사면 연결)</span></label>
          <select name="partnerCode">
            <option value="">연결 안 함</option>
            ${(state.partners || []).filter((p) => p.code).map((p) => `<option value="${h(p.code)}" ${b.partnerCode === p.code ? "selected" : ""}>${h(p.code)} · ${h(p.name)}</option>`).join("")}
          </select>
        </div>
        <div>
          <label>사업부 <span class="muted" style="font-weight:400">(손익·KPI 구분)</span></label>
          <select name="businessUnit">
            <option value="">미지정</option>
            ${[["wooof", "우프(입점)"], ["pb", "PB"], ["npb", "NPB"], ["service", "용역"]].map(([k, l]) => `<option value="${k}" ${b.businessUnit === k ? "selected" : ""}>${l}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="field">
        <label>입금계좌 <span class="muted" style="font-weight:400">(거래관리 &gt; 계좌관리 목록에서 선택 · 이체양식 기본값)</span></label>
        <select name="transferAccountId" data-brand-transfer-account>
          <option value="">직접 입력</option>
          ${(state.transferAccounts || []).slice()
            .sort((x, y) => String(x.alias || "").localeCompare(String(y.alias || ""), "ko"))
            .map((a) => `<option value="${h(a.id)}" ${b.transferAccountId === a.id ? "selected" : ""}>${h(a.alias || a.holder)} · ${h(a.bankName)} ${h(a.accountNumber)}</option>`).join("")}
        </select>
      </div>
      <div class="field two">
        <div><label>입금은행명</label><input name="bankName" value="${h(b.bankName)}"></div>
        <div><label>통장계좌번호</label><input name="bankAccount" value="${h(b.bankAccount)}"></div>
      </div>
      <div class="field">
        <label>출금통장표시 기본값 <span class="muted" style="font-weight:400">(비우면 "${h((b.name || "브랜드명") + "선매입")}" · 입금요청마다 고칠 수 있음)</span></label>
        <input name="withdrawMemo" value="${h(b.withdrawMemo || "")}" placeholder="${h((b.name || "브랜드명") + "선매입")}">
      </div>
      <div class="field"><label>계좌예금주명</label><input name="depositorName" value="${h(b.depositorName)}"></div>
      <div class="field two">
        <div><label>카페24 공급사명/코드 <span class="muted" style="font-weight:400">(정산 매칭용)</span></label><input name="cafe24Supplier" value="${h(b.cafe24Supplier || "")}" placeholder="예: KOGONGCAT 또는 S000000W"></div>
        <div><label>은행 거래처 라벨 <span class="muted" style="font-weight:400">(비우면 브랜드명)</span></label><input name="bankLabel" value="${h(b.bankLabel || "")}" placeholder="예: 고공캣"></div>
      </div>
      <div class="field">
        <label>정산 금액 기준 <span class="muted" style="font-weight:400">(정가 기준 브랜드는 단가표에 정가 등록 필요 — 예: 고공캣)</span></label>
        <select name="priceBasis">
          <option value="cafe24" ${(b.priceBasis || "cafe24") === "cafe24" ? "selected" : ""}>카페24 결제액 기준 (기본)</option>
          <option value="catalog" ${b.priceBasis === "catalog" ? "selected" : ""}>정가(단가표) 기준</option>
        </select>
      </div>
      <div class="field">
        <label style="display:flex;align-items:center;gap:6px;font-weight:400">
          <input type="checkbox" name="autoCreateRequests" ${b.autoCreateRequests ? "checked" : ""}>
          수집 시 입금요청 자동 등록 <span class="muted">(확인 목록에 띄우지 않음)</span>
        </label>
        <p class="muted" style="margin:4px 0 0;font-size:11px">
          월정산 거래처처럼 건건이 확인할 필요가 없을 때 켜세요. 공급사코드는 그대로 쓰므로
          정산 집계와 정산내역 다운로드에는 영향이 없습니다.
        </p>
      </div>
      <div class="field"><label>Google Sheets 아카이브 URL</label><input name="googleSheetUrl" value="${h(b.googleSheetUrl)}" placeholder="브랜드별 공유용 스프레드시트 링크"></div>
      ${state.editingBrand ? renderBrandShipNotifyFields(b) : ""}
      <div class="toolbar">
        <button class="primary" type="submit">${state.editingBrand ? "수정 저장" : "브랜드 추가"}</button>
        ${state.editingBrand ? `<button type="button" data-cancel-edit>취소</button>` : ""}
      </div>
    </form>
  `;
}

// ---- 출고 알림(브랜드 출고 담당자에게 문자·메일) -----------------------------
function shipNotifyOn(item) {
  const b = state.brands.find((x) => x.id === item.brandId);
  return Boolean(b && ((b.shipSmsMode && b.shipSmsMode !== "off") || (b.shipMailMode && b.shipMailMode !== "off")));
}
function shipSentTags(item) {
  const n = item.shipNotify || {};
  const tag = (k, l) => (n[k]?.ok ? `<span class="ship-tag is-ok" title="${h(fmtDate(n[k].at))} ${h(n[k].to || "")}">${l}✓</span>` : n[k]?.error ? `<span class="ship-tag is-fail" title="${h(n[k].error)}">${l} 실패</span>` : "");
  const t = tag("sms", "문자") + tag("mail", "메일");
  return t ? `<div class="ship-tags">${t}</div>` : "";
}
// 대표 전용: 문자 발신번호와 문구(문자 3·메일 3)를 고친다.
function renderShipNotifySettings() {
  ensureShipNotify();
  const cfg = state.shipNotify;
  const st = state.shipSettings || (state.shipSettings = { open: false });
  if (!cfg) return "";
  const draft = st.draft || (st.draft = JSON.parse(JSON.stringify(cfg.templates)));
  const bytes = (t) => { let n = 0; for (const ch of String(t || "")) n += ch.charCodeAt(0) > 127 ? 2 : 1; return n; };
  return `<details class="panel ship-settings" ${st.open ? "open" : ""} data-ship-settings>
    <summary class="panel-head"><h2>출고 알림 설정</h2><span class="meta">문자 발신번호 · 문자·메일 문구 · 쓰는 법: 브랜드 수정 › 출고 알림</span></summary>
    <div class="panel-body">
      ${!cfg.smsScope ? notice("warn", "카페24 연결에 문자 권한이 아직 없습니다", "서버 설정을 바꾼 뒤 주문매칭 › 카페24 연동에서 '다시 연결하기'를 한 번 눌러 주세요.") : ""}
      ${!cfg.mailConfigured ? notice("warn", "메일 발송 설정이 아직 없습니다", "우프 CS 메일(wooof.betters@gmail.com)의 Gmail 앱 비밀번호를 서버에 넣어야 메일이 나갑니다.") : ""}
      <div class="action-row">
        <label class="inline-field"><span>문자 발신번호</span>
          <select data-ship-sender>${st.senders ? st.senders.map((x) => `<option value="${x.senderNo}" ${Number(cfg.senderNo) === x.senderNo ? "selected" : ""}>${h(x.sender)}${x.authStatus && x.authStatus !== "30" ? " (인증 대기)" : ""}</option>`).join("") : `<option value="${cfg.senderNo || 0}">${cfg.senderNo ? `발신자 ${cfg.senderNo}` : "불러오기를 누르세요"}</option>`}</select></label>
        <button data-ship-senders-load>카페24에서 불러오기</button>
        ${st.balance ? `<span class="meta">문자 잔액: ${h(JSON.stringify(st.balance).replace(/[{}"]/g, "").replace(/,/g, " · "))}</span>` : ""}
      </div>
      <div class="ship-tpl-grid">
        <div><h3>문자 문구 <span class="meta">단문 90byte(한글 약 45자)</span></h3>
          ${draft.sms.map((t, i) => `<div class="ship-tpl"><input data-tpl="sms:${i}:name" value="${h(t.name)}" aria-label="문자 문구 이름">
            <textarea data-tpl="sms:${i}:text" rows="2">${h(t.text)}</textarea><span class="meta ${bytes(t.text) > 80 ? "danger-text" : ""}">문구만 ${bytes(t.text)}byte (브랜드명·주문번호가 들어가면 늘어남)</span></div>`).join("")}</div>
        <div><h3>메일 문구</h3>
          ${draft.mail.map((t, i) => `<div class="ship-tpl"><input data-tpl="mail:${i}:name" value="${h(t.name)}" aria-label="메일 문구 이름">
            <input data-tpl="mail:${i}:subject" value="${h(t.subject)}" aria-label="메일 제목"><textarea data-tpl="mail:${i}:body" rows="5">${h(t.body)}</textarea></div>`).join("")}</div>
      </div>
      <p class="hint">넣을 수 있는 값: {브랜드} {주문번호} {주문자} {입금일} {품목} {건수} {주문목록}</p>
      <div class="action-row"><button class="primary" data-ship-settings-save>설정 저장</button></div>
    </div>
  </details>`;
}
function bindShipSettings() {
  const el = app.querySelector("[data-ship-settings]");
  if (!el) return;
  const st = state.shipSettings;
  el.addEventListener("toggle", () => { st.open = el.open; });
  el.querySelectorAll("[data-tpl]").forEach((inp) => inp.addEventListener("input", () => {
    const [kind, i, key] = inp.dataset.tpl.split(":");
    st.draft[kind][Number(i)][key] = inp.value;
  }));
  el.querySelector("[data-ship-senders-load]")?.addEventListener("click", async () => {
    try { const r = await api("/api/ship-notify/senders"); st.senders = r.senders; st.balance = r.balance; renderApp(); }
    catch (e) { showToast(e.message, "error"); }
  });
  el.querySelector("[data-ship-settings-save]")?.addEventListener("click", async () => {
    const senderNo = Number(el.querySelector("[data-ship-sender]")?.value || 0);
    try {
      await api("/api/ship-notify/settings", { method: "PUT", body: { senderNo, templates: st.draft } });
      state.shipNotify = null; st.draft = null; showToast("출고 알림 설정을 저장했습니다.");
      await ensureShipNotify();
    } catch (e) { showToast(e.message, "error"); }
  });
}

function renderShipSendModal() {
  const ss = state.shipSend;
  if (!ss) return "";
  const cfg = state.shipNotify;
  if (!cfg) { ensureShipNotify(); return v2Modal(`<div class="panel-body"><p class="muted">불러오는 중…</p></div>`, "data-ship-close"); }
  const sel = (ch, list) => `<select data-ship-tpl="${ch}" ${ss[ch] ? "" : "disabled"}>${list.map((t) => `<option value="${h(t.id)}" ${ss[ch] === t.id ? "selected" : ""}>${h(t.name)}</option>`).join("")}</select>`;
  const pv = ss.preview?.previews || [];
  return v2Modal(`<div class="panel-head"><h2>출고 요청 보내기 <span class="count">${ss.ids.length}건</span></h2><button data-ship-close>닫기</button></div>
    <div class="panel-body">
      <div class="ship-channels">
        <label class="switch-line"><input type="checkbox" data-ship-ch="sms" ${ss.sms ? "checked" : ""}><span><b>문자</b></span></label>${sel("sms", cfg.templates.sms)}
        <label class="switch-line"><input type="checkbox" data-ship-ch="mail" ${ss.mail ? "checked" : ""}><span><b>메일</b> <span class="meta">${h(cfg.mailFrom || "")}</span></span></label>${sel("mail", cfg.templates.mail)}
      </div>
      ${ss.mail && !cfg.mailConfigured ? notice("warn", "메일 발송 설정이 아직 없습니다", "우프 CS 메일(Gmail) 앱 비밀번호를 서버에 넣어야 메일이 나갑니다.") : ""}
      <p class="hint">같은 브랜드 여러 건은 한 통으로 묶어 보냅니다.</p>
      <div class="ship-previews">${ss.loading ? `<p class="muted">미리보기 만드는 중…</p>` : pv.map((p) => `<div class="ship-pv">
        <div class="ship-pv-head"><b>${h(p.brandName)}</b> <span class="meta">${p.count}건</span></div>
        ${p.sms ? `<div class="ship-pv-row"><span class="ship-pv-k">문자</span><div>${p.sms.value ? `<span class="meta">${h(p.sms.value)} · ${h(p.sms.source)}</span>` : `<span class="danger-text">받을 휴대폰 번호 없음 — 브랜드 › 주문배송 담당 연락처</span>`}
          <pre class="ship-pv-text">${h(p.sms.text)}</pre><span class="meta ${p.sms.bytes > 90 ? "danger-text" : ""}">${p.sms.bytes}/90byte ${p.sms.bytes > 90 ? "· 장문으로 나가 요금이 더 듭니다" : "· 단문"}</span></div></div>` : ""}
        ${p.mail ? `<div class="ship-pv-row"><span class="ship-pv-k">메일</span><div>${p.mail.value ? `<span class="meta">${h(p.mail.value)} · ${h(p.mail.source)}</span>` : `<span class="danger-text">받을 메일 없음 — 브랜드 › 주문배송 담당 이메일</span>`}
          <div class="ship-pv-subject">${h(p.mail.subject)}</div><pre class="ship-pv-text">${h(p.mail.body)}</pre></div></div>` : ""}
      </div>`).join("")}</div>
      <div class="action-row">
        <button class="primary" data-ship-send ${ss.sending || ss.loading || (!ss.sms && !ss.mail) ? "disabled" : ""}>${ss.sending ? "보내는 중…" : "보내기"}</button>
        <button data-ship-close>취소</button>
      </div>
    </div>`, "data-ship-close");
}
async function openShipSend(ids) {
  await ensureShipNotify();
  const cfg = state.shipNotify;
  const items = state.requests.filter((r) => ids.includes(r.id));
  const brands = items.map((r) => state.brands.find((b) => b.id === r.brandId)).filter(Boolean);
  const anySms = brands.some((b) => b.shipSmsMode && b.shipSmsMode !== "off");
  const anyMail = brands.some((b) => b.shipMailMode && b.shipMailMode !== "off");
  const first = brands[0] || {};
  state.shipSend = {
    ids,
    sms: anySms || !anyMail ? (first.shipSmsTemplateId || cfg?.templates.sms[0]?.id || "sms1") : "",
    mail: anyMail ? (first.shipMailTemplateId || cfg?.templates.mail[0]?.id || "mail1") : ""
  };
  loadShipPreview();
}
async function loadShipPreview() {
  const ss = state.shipSend;
  if (!ss) return;
  ss.loading = true; renderApp();
  try { ss.preview = await api("/api/ship-notify/preview", { method: "POST", body: { requestIds: ss.ids, sms: ss.sms, mail: ss.mail } }); }
  catch (e) { ss.preview = null; showToast(e.message, "error"); }
  ss.loading = false; renderApp();
}
function bindShipSend() {
  app.querySelectorAll("[data-ship-notify]").forEach((b) => b.addEventListener("click", (e) => { e.stopPropagation(); openShipSend([b.dataset.shipNotify]); }));
  app.querySelector("[data-ship-notify-selected]")?.addEventListener("click", () => openShipSend([...state.selectedRequestIds]));
  const ss = state.shipSend;
  if (!ss) return;
  app.querySelectorAll("[data-ship-close]").forEach((b) => b.addEventListener("click", () => { state.shipSend = null; renderApp(); }));
  app.querySelectorAll("[data-ship-ch]").forEach((c) => c.addEventListener("change", () => {
    const ch = c.dataset.shipCh;
    ss[ch] = c.checked ? (state.shipNotify.templates[ch][0]?.id || "") : "";
    loadShipPreview();
  }));
  app.querySelectorAll("[data-ship-tpl]").forEach((sel) => sel.addEventListener("change", () => { ss[sel.dataset.shipTpl] = sel.value; loadShipPreview(); }));
  app.querySelector("[data-ship-send]")?.addEventListener("click", async () => {
    ss.sending = true; renderApp();
    try {
      const { results } = await api("/api/ship-notify/send", { method: "POST", body: { requestIds: ss.ids, sms: ss.sms, mail: ss.mail } });
      const ok = results.filter((r) => r.ok).length, bad = results.filter((r) => !r.ok);
      showToast(`출고 요청 ${ok}통 보냈습니다.${bad.length ? ` 실패 ${bad.length}통: ${bad.map((r) => `${r.brandName} ${r.channel === "sms" ? "문자" : "메일"} — ${r.error}`).join(", ")}` : ""}`, bad.length ? "error" : "");
      state.shipSend = null;
      await loadAll();
    } catch (e) { showToast(e.message, "error"); ss.sending = false; }
    renderApp();
  });
}
const SHIP_MODE_LABELS = { off: "안 보냄", manual: "버튼으로 보냄", auto: "입금완료 때 자동 (계속)" };
async function ensureShipNotify() {
  if (state.shipNotify || state.shipNotifyLoading) return;
  state.shipNotifyLoading = true;
  try { state.shipNotify = await api("/api/ship-notify/settings"); } catch { state.shipNotify = null; }
  state.shipNotifyLoading = false;
  renderApp();
}
const digitsOnly = (v) => String(v || "").replace(/\D/g, "");
const isMobileNo = (v) => /^01[016789]\d{7,8}$/.test(digitsOnly(v));
const isMailAddr = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());
// 서버(lib/ship-notify.mjs)와 같은 순서로 '비워 두면 보낼 곳'을 보여 준다.
function shipFallback(b, kind) {
  const p = b.profile || {}, c = p.contacts || {};
  const partner = (state.partners || []).find((x) => x.code && x.code === b.partnerCode);
  const list = kind === "phone"
    ? [[c.delivery?.mobile, "배송 담당자(설문)"], [c.main?.mobile, "메인 담당자(설문)"], [p.ceoPhone, "대표자(설문)"], [partner?.contactPhone, "거래처 담당자"]]
    : [[c.delivery?.email, "배송 담당자(설문)"], [c.main?.email, "메인 담당자(설문)"], [partner?.contactEmail, "거래처 담당자"], [p.invoiceEmail, "계산서 메일(설문)"], [partner?.invoiceEmail, "거래처 계산서 메일"]];
  const hit = list.find(([v]) => (kind === "phone" ? isMobileNo(v) : isMailAddr(v)));
  return hit ? `${hit[0]} (${hit[1]})` : "";
}
function renderBrandShipNotifyFields(b) {
  ensureShipNotify();
  const cfg = state.shipNotify;
  const tplSelect = (name, list, cur) => `<select name="${name}">${(list || []).map((t) => `<option value="${h(t.id)}" ${cur === t.id ? "selected" : ""}>${h(t.name)}</option>`).join("")}</select>`;
  const modeSelect = (name, cur) => `<select name="${name}">${Object.entries(SHIP_MODE_LABELS).map(([k, l]) => `<option value="${k}" ${(cur || "off") === k ? "selected" : ""}>${l}</option>`).join("")}</select>`;
  const phoneFb = shipFallback(b, "phone"), mailFb = shipFallback(b, "mail");
  return `<div class="form-sec-head"><h3>출고 알림</h3><span class="meta">입금완료되면 이 브랜드 출고 담당자에게 문자·메일</span></div>
    <div class="field two">
      <div><label>주문배송 담당 연락처 <span class="muted" style="font-weight:400">(휴대폰)</span></label><input name="shipContactPhone" value="${h(b.shipContactPhone || "")}" placeholder="${h(phoneFb ? `비우면 ${phoneFb}` : "비어 있으면 보낼 번호가 없습니다")}"></div>
      <div><label>주문배송 담당 이메일</label><input name="shipContactEmail" type="email" value="${h(b.shipContactEmail || "")}" placeholder="${h(mailFb ? `비우면 ${mailFb}` : "비어 있으면 보낼 메일이 없습니다")}"></div>
    </div>
    <div class="field two">
      <div><label>문자 발송</label>${modeSelect("shipSmsMode", b.shipSmsMode)}</div>
      <div><label>메일 발송</label>${modeSelect("shipMailMode", b.shipMailMode)}</div>
    </div>
    ${cfg ? `<div class="field two">
      <div><label>기본 문자 문구</label>${tplSelect("shipSmsTemplateId", cfg.templates.sms, b.shipSmsTemplateId)}</div>
      <div><label>기본 메일 문구</label>${tplSelect("shipMailTemplateId", cfg.templates.mail, b.shipMailTemplateId)}</div>
    </div>` : ""}
    <p class="hint">'자동'은 켠 뒤에 입금완료된 건부터 보냅니다. 같은 건에는 한 번만 나갑니다.</p>`;
}

function filteredPromotionRules() {
  return state.promotionRules;
}

function renderPromotionRuleForm() {
  const item = state.editingPromotionRule || {};
  const selectedBrandId = item.brandId || state.editingBrand?.id || "";
  const targetItems = Array.isArray(item.targetItems)
    ? item.targetItems
    : (() => {
      try {
        const parsed = JSON.parse(item.targetItems || "[]");
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    })();
  const options = state.priceCatalog.filter((entry) => entry.brandId === selectedBrandId);
  return `
    <form class="form-grid" data-promotion-rule-form>
      <div class="field">
        <label>브랜드</label>
        <select name="brandId" required>
          <option value="">브랜드 선택</option>
          ${state.brands.filter((b) => b.type === "brand").map((b) => `<option value="${b.id}" ${selectedBrandId === b.id ? "selected" : ""}>${h(b.name)}</option>`).join("")}
        </select>
      </div>
      <div class="field"><label>프로모션명</label><input name="name" value="${h(item.name)}" required placeholder="예: 5월 할인전 정산율"></div>
      <div class="field">
        <label>적용 범위</label>
        <select name="scopeType">
          <option value="all" ${(item.scopeType || "all") === "all" ? "selected" : ""}>브랜드 전체</option>
          <option value="items" ${item.scopeType === "items" ? "selected" : ""}>특정 품목</option>
        </select>
      </div>
      <div class="field two">
        <div><label>적용 수수료율(%) <span class="muted" style="font-weight:400">(수수료 변경 없으면 비워두세요 — 비우면 브랜드 계약율 적용)</span></label><input name="commissionRate" type="number" min="0" max="100" step="0.1" value="${h(item.commissionRate ?? "")}"></div>
        <div><label>상태</label><select name="isActive"><option value="true" ${item.isActive !== false ? "selected" : ""}>Y</option><option value="false" ${item.isActive === false ? "selected" : ""}>N</option></select></div>
      </div>
      <div class="field three">
        <div>
          <label>가격 할인 종류</label>
          <select name="discountKind">
            ${[
              ["", "없음"],
              ["permanent", "상시할인"],
              ["period", "기간할인"],
              ["coupon", "쿠폰할인"],
              ["quantity", "구매수량별할인"]
            ].map(([v, label]) => `<option value="${v}" ${(item.discountKind || "") === v ? "selected" : ""}>${label}</option>`).join("")}
          </select>
        </div>
        <div>
          <label>할인 값</label>
          <input name="discountValue" type="number" min="0" step="0.01" value="${h(item.discountValue ?? "")}" placeholder="예: 10">
        </div>
        <div>
          <label>단위</label>
          <select name="discountValueType">
            ${[
              ["", "선택 안 함"],
              ["percent", "% (정률)"],
              ["fixed", "원 (정액)"]
            ].map(([v, label]) => `<option value="${v}" ${(item.discountValueType || "") === v ? "selected" : ""}>${label}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="field">
        <label>할인 메모 <span class="muted" style="font-weight:400">(쿠폰코드·수량 구간 등 자유 기재 — 계산엔 영향 없음)</span></label>
        <input name="discountDetails" value="${h(item.discountDetails || "")}" placeholder="예: WELCOME10, 5개 이상부터 적용">
      </div>
      <div class="field" data-promotion-target-wrap style="${(item.scopeType || "all") === "items" ? "" : "display:none"}">
        <label>대상 품목</label>
        <input type="hidden" name="targetItems" value='${h(JSON.stringify(targetItems))}'>
        <div class="field two">
          <div><input name="promotionTargetSearch" list="promotion-target-options" placeholder="품목코드 또는 품목명 검색"></div>
          <div><button type="button" data-add-promotion-target>품목 추가</button></div>
        </div>
        <datalist id="promotion-target-options">
          ${options.map((entry) => `<option value="${h(formatPriceOption(entry))}"></option>`).join("")}
        </datalist>
        <div data-promotion-target-list>${renderPromotionTargetList(targetItems)}</div>
      </div>
      <div class="field two">
        <div><label>시작일</label><input name="validFrom" type="date" value="${h(item.validFrom || new Date().toISOString().slice(0, 10))}" required></div>
        <div><label>종료일</label><input name="validTo" type="date" value="${h(item.validTo || "")}"></div>
      </div>
      <div class="field"><label>메모</label><input name="note" value="${h(item.note || "")}" placeholder="예: 브랜드 협의 22% 적용"></div>
      <div class="toolbar">
        <button class="primary" type="submit">${state.editingPromotionRule ? "수정 저장" : "규칙 등록"}</button>
        ${state.editingPromotionRule ? `<button type="button" data-cancel-promotion-rule>취소</button>` : ""}
      </div>
    </form>
  `;
}

function renderPromotionTargetList(items) {
  if (!items.length) return `<div class="empty">추가된 대상 품목이 없습니다.</div>`;
  return `
    <div class="table-wrap" style="max-height:180px">
      <table class="promotion-targets-table">
        <thead><tr><th>대상 품목</th><th>작업</th></tr></thead>
        <tbody>
          ${items.map((item, index) => `
            <tr>
              <td>${h(item.label || formatPromotionTargetLabel(item))}</td>
              <td><button type="button" data-remove-promotion-target="${index}" class="danger icon-btn" aria-label="삭제" title="삭제">×</button></td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function formatPromotionTargetLabel(item) {
  return item.itemCode && item.itemName ? `${item.itemCode} | ${item.itemName}` : item.itemName || item.itemCode || "";
}

function renderAdmins() {
  return `
    ${pageHead("관리자", "관리자 생성, 수정, 삭제는 모두 이력에 기록됩니다.", `<button class="primary" data-new-admin>새 관리자</button>`)}
    <section class="layout">
      <div class="panel">
        <div class="panel-head"><h2>관리자 계정</h2></div>
        <div class="table-wrap">
          <table class="admins-table">
            <thead><tr><th>이름</th><th>이메일</th><th>역할</th><th>상태</th><th>생성일</th><th>작업</th></tr></thead>
            <tbody>${state.admins.map(renderAdminRow).join("")}</tbody>
          </table>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>${state.editingAdmin ? "관리자 수정" : "관리자 입력"}</h2></div>
        <div class="panel-body">${renderAdminForm()}</div>
      </div>
    </section>
  `;
}

// 메뉴 목록은 서버가 준다. 새 메뉴가 생겨도 여기를 고칠 필요가 없다.
function renderPermissionGrid(admin) {
  const role = state.editingPermissions?.role ?? (admin.role || "operator");
  if (role === "owner") {
    return `<div class="field"><label>메뉴 권한</label>
      <span class="muted">오너는 모든 메뉴에 대한 전체 권한을 가집니다.</span></div>`;
  }
  const current = state.editingPermissions?.permissions
    || admin.permissions
    || {};
  const rows = state.menus.map((menu) => {
    const granted = current[menu.key] || [];
    const boxes = menu.actions.map((action) => `
      <label class="perm-box">
        <input type="checkbox" data-perm-menu="${h(menu.key)}" data-perm-action="${h(action)}"
          ${granted.includes(action) ? "checked" : ""}>
        ${h(state.actionLabels[action] || action)}
      </label>`).join("");
    return `<tr>
      <td><strong>${h(menu.label)}</strong></td>
      <td><div class="perm-actions">${boxes}</div></td>
    </tr>`;
  }).join("");
  return `
    <div class="field">
      <label>메뉴 권한</label>
      <span class="muted">
        체크한 메뉴만 화면에 나타나고, 체크한 동작만 허용됩니다.
        하위 동작을 주면 접근·읽기는 자동으로 함께 부여됩니다.
      </span>
      <div class="table-wrap" style="max-height:320px;margin-top:6px">
        <table class="admin-perms-table"><thead><tr><th style="width:120px">메뉴</th><th>허용할 동작</th></tr></thead>
        <tbody>${rows}</tbody></table>
      </div>
    </div>
  `;
}

function renderAdminRow(admin) {
  return `
    <tr>
      <td>${codeTag(admin)}${h(admin.name)}</td>
      <td>${h(admin.email)}</td>
      <td><span class="badge">${h(admin.role)}</span></td>
      <td>${admin.isActive ? "Y" : "N"}</td>
      <td>${fmtDate(admin.createdAt)}</td>
      <td><div class="row-actions"><button data-edit-admin="${admin.id}">수정</button><button class="danger icon-btn" data-delete-admin="${admin.id}" ${admin.id === state.admin.id ? "disabled" : ""} aria-label="삭제" title="삭제">×</button></div></td>
    </tr>
  `;
}

function renderAdminForm() {
  // 체크박스·역할을 바꾸면 화면을 다시 그린다. 그때 입력 중이던 값(역할 포함)이
  // 원래 값으로 되돌아가 역할 변경이 저장되지 않았다 — 고친 값을 먼저 쓴다.
  const a = { ...(state.editingAdmin || {}), ...(state.adminDraft || {}) };
  return `
    <form class="form-grid" data-admin-form>
      <div class="field"><label>이름</label><input name="name" value="${h(a.name)}" required></div>
      <div class="field"><label>이메일</label><input name="email" type="email" value="${h(a.email)}" ${state.editingAdmin ? "disabled" : "required"}></div>
      <div class="field two">
        <div><label>역할</label><select name="role">${["owner", "manager", "operator", "viewer"].map((r) => `<option value="${r}" ${(a.role || "operator") === r ? "selected" : ""}>${r}</option>`).join("")}</select></div>
        <div><label>상태</label><select name="isActive"><option value="true" ${a.isActive !== false ? "selected" : ""}>Y</option><option value="false" ${a.isActive === false ? "selected" : ""}>N</option></select></div>
      </div>
      <div class="field"><label>비밀번호 ${state.editingAdmin ? "(변경 시에만 입력)" : ""}</label><input name="password" type="password" value="${h(a.password || "")}" ${state.editingAdmin ? "" : "required"}></div>
      ${renderPermissionGrid(a)}
      <div class="toolbar">
        <button class="primary" type="submit">${state.editingAdmin ? "수정 저장" : "관리자 추가"}</button>
        ${state.editingAdmin ? `<button type="button" data-cancel-edit>취소</button>` : ""}
      </div>
    </form>
  `;
}

function renderAudits() {
  return `
    ${pageHead("이력", "관리자의 입력, 수정, 삭제, 로그인, 아카이브 작업을 시간순으로 확인합니다.")}
    <section class="panel">
      <div class="panel-head"><h2>감사 로그</h2><span class="muted">최근 ${money.format(state.audits.length)}건${state.auditsTotal > state.audits.length ? ` / 전체 ${money.format(state.auditsTotal)}건` : ""}</span></div>
      <div class="panel-body">${renderAuditList(state.audits)}</div>
    </section>
  `;
}

function renderAuditList(items) {
  return items.length
    ? items.map((item) => `
      <div class="audit-item">
        <strong>${h(item.summary)}</strong>
        <span class="muted">${fmtDate(item.at)} · ${h(item.actorName)} · ${h(item.action)} · ${h(item.entityType)}</span>
      </div>`).join("")
    : `<div class="empty">기록된 이력이 없습니다.</div>`;
}

function renderArchive() {
  return `
    ${pageHead("아카이브", "브랜드별 Excel 추출과 Google Sheets 동기화용 페이로드를 생성합니다.", `<button class="primary" data-sync-all>전체 동기화</button>`)}
    <section class="layout">
      <div class="panel">
        <div class="panel-head"><h2>브랜드별 아카이브</h2></div>
        <div class="table-wrap">
          <table class="sheets-sync-table">
            <thead><tr><th>브랜드</th><th>요청</th><th>Google Sheets</th><th>추출</th><th>동기화</th></tr></thead>
            <tbody>
              ${state.brands.filter((b) => b.type === "brand").map((b) => `
                <tr>
                  <td>${h(b.name)}</td>
                  <td>${money.format(b.requestCount || 0)}건</td>
                  <td class="wrap">${b.googleSheetUrl ? `<a href="${h(b.googleSheetUrl)}" target="_blank" rel="noreferrer">아카이브 열기</a>` : `<span class="muted">미지정</span>`}</td>
                  <td><a href="/api/export/brand/${b.id}.csv"><button>CSV</button></a> <a href="/api/export/brand/${b.id}.xls"><button>Excel</button></a></td>
                  <td><button data-sync-brand="${b.id}">동기화</button></td>
                </tr>`).join("")}
            </tbody>
          </table>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>최근 아카이브</h2></div>
        <div class="panel-body">
          ${state.archives.length ? state.archives.map((a) => `
            <div class="audit-item">
              <strong>${h(a.brandName)} · ${money.format(a.rowCount)}행</strong>
              <span class="muted">${fmtDate(a.createdAt)} · Webhook ${a.webhookEnabled ? "사용" : "미설정"}</span>
            </div>`).join("") : `<div class="empty">아카이브 기록이 없습니다.</div>`}
        </div>
      </div>
    </section>
  `;
}

async function renderShare(token) {
  try {
    const data = await api(`/api/public/brand/${token}`);
    app.innerHTML = `
      <main class="share-view">
        <section class="panel">
          <div class="panel-head">
            <div>
              <h1>${h(data.brand.name)} 입금 내역</h1>
              <p class="muted">공유 링크로 제공되는 읽기 전용 동기화 화면입니다.</p>
            </div>
            <span class="badge">${money.format(data.requests.length)}건</span>
          </div>
          <div class="table-wrap">
            <table class="sheet-preview-table">
              <thead><tr><th>상태</th><th>주문번호</th><th>주문자</th><th>입금액</th><th>예정일</th><th>메모</th><th>원본</th></tr></thead>
              <tbody>${data.requests.map((item) => `
                <tr>
                  <td><span class="badge ${h(item.status)}">${statusLabel(item.status)}</span></td>
                  <td>${h(item.orderNo)}</td>
                  <td>${h(item.customerName)}</td>
                  <td>${money.format(finalDepositAmount(item))}원</td>
                  <td>${h(item.expectedDepositDate)}</td>
                  <td class="wrap">${h(item.cutoffNote || item.requiredMemo)}</td>
                  <td>${h(item.sourceSheet)} ${item.sourceRow ? `#${h(item.sourceRow)}` : ""}</td>
                </tr>`).join("")}</tbody>
            </table>
          </div>
        </section>
      </main>
    `;
  } catch (err) {
    app.innerHTML = `<main class="login"><section class="login-panel"><h1>공유 링크 오류</h1><p>${h(err.message)}</p></section></main>`;
  }
}

// 이력·아카이브는 탭을 실제로 열었을 때만 가져온다.
async function ensureTabData() {
  if (state.tab === "audits" && !state.auditsLoaded) {
    state.auditsLoaded = true;
    try {
      const data = await api("/api/audits?limit=200");
      state.audits = data.auditLogs || [];
      state.auditsTotal = data.total || state.audits.length;
      renderApp();
    } catch (error) {
      state.auditsLoaded = false;
      showToast(error.message || "이력을 불러오지 못했습니다.", "error");
    }
  }
  if (state.tab === "archive" && !state.archivesLoaded) {
    state.archivesLoaded = true;
    try {
      state.archives = (await api("/api/archives")).archiveHistory || [];
      renderApp();
    } catch (error) {
      state.archivesLoaded = false;
      showToast(error.message || "아카이브를 불러오지 못했습니다.", "error");
    }
  }
}

function bindCurrentTab() {
  ensureTabData();
  if (state.tab === "dashboard") bindTodo();
  // 줄을 누르면 그 줄의 수정·상세 버튼을 누른 것처럼(버튼·입력칸을 누른 건 그대로).
  setTimeout(() => app.querySelectorAll("tr[data-row-edit]").forEach((tr) => {
    if (tr.dataset.rowBound) return;
    tr.dataset.rowBound = "1";
    tr.addEventListener("click", (e) => {
      if (e.target.closest("button, a, input, select, textarea, label")) return;
      tr.querySelector(tr.dataset.rowEdit)?.click();
    });
  }), 0);
  setTimeout(() => alignV2Tables(), 0);
  if (state.tab === "requests") bindRequests();
  if (state.tab === "prices") bindPrices();
  if (state.tab === "brands") bindBrands();
  if (state.tab === "procurement") bindProcurement();
  if (state.tab === "payments") bindPayments();
  if (state.tab === "cash") bindCash();
  if (state.tab === "sales") bindSales();
  if (state.tab === "stock") bindStock();
  if (state.tab === "setup") bindSetup();
  if (state.tab === "monthly") bindMonthly();
  if (state.tab === "closing") bindClosing();
  if (state.tab === "messenger") bindMessenger();
  if (state.tab === "notion") bindNotionArchive();
  if (state.tab === "trade") bindTrade();
  if (state.tab === "kpi") bindKpi();
  if (state.tab === "admins") bindAdmins();
  if (state.tab === "archive") bindArchive();
  if (state.tab === "settlement") bindSettlement();
  if (state.tab === "pipeline" || state.tab === "reconcile") {
    bindPipeline();
    bindReconcile();
    if (canUseClobe()) bindDepositConfirm();
  }
  if (state.tab === "npb") bindNpb();
  if (state.tab === "productsync") bindProductSync();
}

function formObject(form) {
  return Object.fromEntries(new FormData(form).entries());
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      const base64 = text.includes(",") ? text.split(",").pop() : "";
      resolve(base64 || "");
    };
    reader.onerror = () => reject(new Error("파일을 읽지 못했습니다."));
    reader.readAsDataURL(file);
  });
}

async function refreshAndRender() {
  await loadAll();
  renderApp();
}

function bindSearchInput(selector, applyValue) {
  const input = app.querySelector(selector);
  if (!input) return;
  let composing = false;
  const rerenderRestoringFocus = () => {
    renderApp();
    const next = app.querySelector(selector);
    if (!next) return;
    next.focus();
    const len = next.value.length;
    try {
      next.setSelectionRange(len, len);
    } catch {}
  };
  input.addEventListener("compositionstart", () => {
    composing = true;
  });
  input.addEventListener("compositionend", (event) => {
    composing = false;
    applyValue(event.target.value);
    rerenderRestoringFocus();
  });
  input.addEventListener("input", (event) => {
    applyValue(event.target.value);
    if (composing || event.isComposing) return;
    rerenderRestoringFocus();
  });
}

// 정가 기준 브랜드의 입금요청을 저장하기 전, 단가표에 없는 품목을 등록하거나
// 기존 품목의 별칭으로 연결하도록 보여주는 확인 패널. 요청 폼 자체는 건드리지
// 않는다 — 사용자가 입력하던 값이 패널 때문에 초기화되면 안 된다.
function renderCatalogResolvePanel() {
  const cr = state.catalogResolve;
  if (!cr) return "";
  const allDone = cr.items.every((it) => it.status !== "pending");
  const rows = cr.items.map((it, i) => {
    if (it.status === "registered") {
      return `<div class="catalog-resolve-item"><span class="status-dot is-ok"></span><b>${h(it.itemName)}</b> — 단가표에 새로 등록했습니다.</div>`;
    }
    if (it.status === "aliased") {
      return `<div class="catalog-resolve-item"><span class="status-dot is-ok"></span><b>${h(it.itemName)}</b> — "${h(it.aliasedToName || "")}" 별칭으로 연결했습니다.</div>`;
    }
    if (it.status === "skipped") {
      return `<div class="catalog-resolve-item"><span class="muted">⏭ <b>${h(it.itemName)}</b> — 이번엔 건너뜁니다.</span></div>`;
    }
    const suggestions = (it.suggestions || []).map((s) => `
      <button type="button" class="ghost" data-catalog-alias="${i}" data-price-entry-id="${h(s.priceEntryId)}"
        data-price-entry-name="${h(s.itemName || s.itemCode)}">"${h(s.itemName || s.itemCode)}"(${money.format(s.currentSalePrice)}원)와 같은 상품</button>
    `).join("");
    return `
      <div class="catalog-resolve-item">
        <div><b>${h(it.itemName)}</b> ${it.unitSalePrice ? `<span class="muted">(입력가 ${money.format(it.unitSalePrice)}원)</span>` : ""}</div>
        ${suggestions
          ? `<div class="toolbar" style="margin-top:4px">${suggestions}</div>`
          : `<p class="muted" style="margin:4px 0">비슷한 기존 품목을 찾지 못했습니다.</p>`}
        <div class="toolbar" style="margin-top:8px">
          <input type="text" data-catalog-new-name="${i}" value="${h(it.itemName)}" placeholder="단가표에 등록할 품목명">
          <input type="text" inputmode="numeric" class="money-input" data-catalog-new-price="${i}" value="${h(formatAmount(it.unitSalePrice || 0))}" placeholder="판매가">
          <button type="button" class="primary" data-catalog-register="${i}">새 품목으로 등록</button>
          <button type="button" data-catalog-skip="${i}">건너뛰기</button>
        </div>
      </div>
    `;
  }).join("<hr>");
  return `
    <section class="panel" data-catalog-resolve-panel>
      <div class="panel-head"><h2>단가표 확인 — ${h(cr.brandName)}</h2></div>
      <div class="panel-body">
        <p class="muted">이 브랜드는 정가(단가표) 기준으로 정산합니다. 아래 품목을 단가표에 등록하거나 기존 품목의 별칭으로
          연결한 뒤 저장을 이어가세요. 건너뛰어도 이번 요청 저장에는 영향이 없습니다.</p>
        ${rows}
        <div class="toolbar" style="margin-top:12px">
          <button type="button" class="primary" data-catalog-resolve-continue ${allDone ? "" : "disabled"}>확인 완료 · 저장 계속하기</button>
          <button type="button" data-catalog-resolve-cancel>패널 닫기</button>
        </div>
      </div>
    </section>
  `;
}

function showCatalogResolvePanel() {
  document.querySelector(".popup-shell")?.insertAdjacentHTML("beforeend", renderCatalogResolvePanel());
  bindCatalogResolvePanel();
}

function refreshCatalogResolvePanel() {
  const existing = document.querySelector("[data-catalog-resolve-panel]");
  const html = renderCatalogResolvePanel();
  if (!html) { existing?.remove(); return; }
  if (existing) existing.outerHTML = html;
  else document.querySelector(".popup-shell")?.insertAdjacentHTML("beforeend", html);
  bindCatalogResolvePanel();
}

function bindCatalogResolvePanel() {
  const panel = document.querySelector("[data-catalog-resolve-panel]");
  const cr = state.catalogResolve;
  if (!panel || !cr) return;
  panel.querySelectorAll("[data-catalog-alias]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const i = Number(btn.dataset.catalogAlias);
      const item = cr.items[i];
      try {
        await api("/api/price-aliases", {
          method: "POST",
          body: { brandId: cr.brandId, priceEntryId: btn.dataset.priceEntryId, aliasText: item.itemName }
        });
        item.status = "aliased";
        item.aliasedToName = btn.dataset.priceEntryName || "";
        showToast(`"${item.itemName}"를 별칭으로 연결했습니다.`);
      } catch (error) {
        showToast(error.message || "별칭 연결에 실패했습니다.", "error");
      }
      refreshCatalogResolvePanel();
    });
  });
  panel.querySelectorAll("[data-catalog-register]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const i = Number(btn.dataset.catalogRegister);
      const item = cr.items[i];
      const itemName = String(panel.querySelector(`[data-catalog-new-name="${i}"]`)?.value || "").trim();
      const price = parseAmount(panel.querySelector(`[data-catalog-new-price="${i}"]`)?.value || 0);
      if (!itemName) return showToast("품목명을 입력하세요.", "error");
      if (!price) return showToast("판매가를 입력하세요.", "error");
      try {
        await api("/api/price-entries", {
          method: "POST",
          body: { brandId: cr.brandId, itemName, itemCode: item.itemCode || "", salePrice: price, originalPrice: price }
        });
        item.status = "registered";
        item.itemName = itemName;
        showToast(`"${itemName}"를 단가표에 등록했습니다.`);
      } catch (error) {
        showToast(error.message || "단가표 등록에 실패했습니다.", "error");
      }
      refreshCatalogResolvePanel();
    });
  });
  panel.querySelectorAll("[data-catalog-skip]").forEach((btn) => {
    btn.addEventListener("click", () => {
      cr.items[Number(btn.dataset.catalogSkip)].status = "skipped";
      refreshCatalogResolvePanel();
    });
  });
  panel.querySelector("[data-catalog-resolve-continue]")?.addEventListener("click", async () => {
    const form = document.querySelector("[data-request-form]");
    if (form) await submitRequestPayload(form, cr.pendingBody, cr.wasEditing);
  });
  panel.querySelector("[data-catalog-resolve-cancel]")?.addEventListener("click", () => {
    state.catalogResolve = null;
    panel.remove();
    const liveBtn = document.querySelector("[data-request-form] [type='submit']");
    if (liveBtn) liveBtn.disabled = false;
  });
}

// 실제 입금요청 생성/수정 API 호출. 단가표 확인 패널을 거쳤든(저장 계속하기),
// 애초에 단가표 확인이 필요 없었든(정가 기준 브랜드가 아니거나 다 매칭됐든)
// 같은 경로로 저장한다.
async function submitRequestPayload(form, body, wasEditing) {
  try {
    if (state.editingRequest?.id) {
      await api(`/api/requests/${state.editingRequest.id}`, { method: "PUT", body });
    } else {
      await api("/api/requests", { method: "POST", body });
    }
    state.editingRequest = null;
    state.catalogResolve = null;
    if (isRequestPopup) {
      history.replaceState({}, "", "/?request-popup=1");
      window.opener?.postMessage({ type: "requestSaved" }, location.origin);
    }
    await refreshAndRender();
    showToast(wasEditing ? "수정되었습니다." : "저장되었습니다.");
    focusRequestForm();
  } finally {
    const liveBtn = form.querySelector('[type="submit"]');
    if (liveBtn) liveBtn.disabled = false;
  }
}

function bindRequests() {
  bindShipSend();
  const syncSelectedRequestIds = () => {
    const validIds = new Set(filteredRequests().filter((item) => item.status !== "deleted").map((item) => item.id));
    state.selectedRequestIds = state.selectedRequestIds.filter((id) => validIds.has(id));
  };
  const markRequestsPaid = async (requestIds, paidAt) => {
    const ids = Array.from(new Set(requestIds)).filter(Boolean);
    if (!ids.length) {
      alert("입금완료 처리할 요청을 선택하세요.");
      return;
    }
    const result = await api("/api/requests/mark-paid", {
      method: "POST",
      body: {
        requestIds: ids,
        paidAt: combinePaidDateTime(paidAt || state.bulkPaidAt)
      }
    });
    state.selectedRequestIds = state.selectedRequestIds.filter((id) => !ids.includes(id));
    state.editingRequest = null;
    await refreshAndRender();
    const skipped = result?.skippedRequestIds?.length || 0;
    const updated = result?.updatedRequests?.length || 0;
    if (skipped && !updated) {
      showToast("이미 입금완료된 건이라 입금일시는 유지됩니다.", "error");
    } else if (skipped) {
      showToast(`입금완료 ${updated}건 처리, 이미 완료된 ${skipped}건은 유지`, "success");
    }
  };
  const deleteRequests = async (requestIds) => {
    const ids = Array.from(new Set(requestIds)).filter(Boolean);
    if (!ids.length) {
      alert("삭제할 요청을 선택하세요.");
      return;
    }
    if (!confirm(`선택한 ${ids.length}건을 삭제 처리할까요?`)) return;
    await api("/api/requests/bulk-delete", {
      method: "POST",
      body: { requestIds: ids }
    });
    state.selectedRequestIds = state.selectedRequestIds.filter((id) => !ids.includes(id));
    state.editingRequest = null;
    await refreshAndRender();
  };
  const toggleFilterGroup = (key, values) => {
    if (key === "brand") state.filters.brandIds = values;
    if (key === "settlement") state.filters.settlementTypes = values;
    if (key === "status") state.filters.statusValues = values;
    syncSelectedRequestIds();
    renderApp();
  };
  app.querySelectorAll("[data-filter-all]").forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.dataset.filterAll;
      const values = Array.from(app.querySelectorAll(`[data-filter-option='${key}']`)).map((item) => item.value);
      toggleFilterGroup(key, input.checked ? values : []);
    });
  });
  app.querySelectorAll("[data-filter-option]").forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.dataset.filterOption;
      const values = Array.from(app.querySelectorAll(`[data-filter-option='${key}']:checked`)).map((item) => item.value);
      toggleFilterGroup(key, values);
    });
  });
  bindSearchInput("[data-filter-q]", (value) => {
    state.filters.q = value;
    syncSelectedRequestIds();
  });
  app.querySelector("[data-filter-date-from]")?.addEventListener("change", (event) => {
    state.filters.dateFrom = event.target.value || "";
    syncSelectedRequestIds();
    renderApp();
  });
  app.querySelector("[data-filter-date-to]")?.addEventListener("change", (event) => {
    state.filters.dateTo = event.target.value || "";
    syncSelectedRequestIds();
    renderApp();
  });
  app.querySelector("[data-filter-date-clear]")?.addEventListener("click", () => {
    state.filters.dateFrom = "";
    state.filters.dateTo = "";
    syncSelectedRequestIds();
    renderApp();
  });
  app.querySelector("[data-filter-promotion]")?.addEventListener("change", (event) => {
    state.filters.promotionRuleId = event.target.value;
    syncSelectedRequestIds();
    renderApp();
  });
  app.querySelector("[data-deleted-requests]")?.addEventListener("click", async () => {
    state.deletedRequests = { open: true, list: null };
    renderApp();
    try { state.deletedRequests.list = (await api("/api/requests/deleted")).requests; } catch (e) { showToast(e.message, "error"); state.deletedRequests.list = []; }
    renderApp();
  });
  app.querySelectorAll("[data-deleted-close]").forEach((b) => b.addEventListener("click", () => { state.deletedRequests = null; renderApp(); }));
  bindV2Modal();
  app.querySelectorAll("[data-restore-request]").forEach((b) => b.addEventListener("click", async () => {
    try {
      await api(`/api/requests/${encodeURIComponent(b.dataset.restoreRequest)}/restore`, { method: "POST", body: {} });
      state.deletedRequests.list = state.deletedRequests.list.filter((r) => r.id !== b.dataset.restoreRequest);
      showToast("되돌렸습니다.");
      await refreshAndRender();
    } catch (e) { showToast(e.message, "error"); }
  }));
  app.querySelector("[data-open-request-popup]")?.addEventListener("click", () => {
    window.open("/?request-popup=1", "wooofpay-request", "width=760,height=940,resizable=yes,scrollbars=yes");
  });
  app.querySelector("[data-bulk-paid-at]")?.addEventListener("input", (event) => {
    state.bulkPaidAt = event.target.value || new Date().toISOString().slice(0, 10);
  });
  app.querySelector("[data-mark-selected-paid]")?.addEventListener("click", async () => {
    await markRequestsPaid(state.selectedRequestIds, state.bulkPaidAt);
  });
  // 선택한 입금요청 → 하나은행 이체등록 엑셀.
  app.querySelector("[data-transfer-xlsx]")?.addEventListener("click", async () => {
    try {
      const res = await fetch("/api/requests/transfer-xlsx", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: state.selectedRequestIds })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return showToast(err.error || "이체 양식을 만들지 못했습니다.", "error");
      }
      const blob = await res.blob();
      const name = decodeURIComponent((res.headers.get("content-disposition") || "").match(/filename\*=UTF-8''([^;]+)/)?.[1] || "") || "하나은행_이체등록.xlsx";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      showToast(`${state.selectedRequestIds.length}건 이체양식을 받았습니다.`);
    } catch (error) {
      showToast(error.message || "이체 양식을 만들지 못했습니다.", "error");
    }
  });
  app.querySelector("[data-clear-selection]")?.addEventListener("click", () => {
    state.selectedRequestIds = [];
    renderApp();
  });
  app.querySelector("[data-delete-selected-requests]")?.addEventListener("click", async () => {
    await deleteRequests(state.selectedRequestIds);
  });
  app.querySelector("[data-select-all-requests]")?.addEventListener("change", (event) => {
    const rows = filteredRequests().filter((item) => item.status !== "deleted");
    if (event.target.checked) {
      state.selectedRequestIds = rows.map((item) => item.id);
    } else {
      state.selectedRequestIds = [];
    }
    renderApp();
  });
  app.querySelectorAll("[data-select-request]").forEach((input) => {
    input.addEventListener("change", (event) => {
      const id = input.dataset.selectRequest;
      if (!id) return;
      if (event.target.checked) {
        state.selectedRequestIds = Array.from(new Set([...state.selectedRequestIds, id]));
      } else {
        state.selectedRequestIds = state.selectedRequestIds.filter((item) => item !== id);
      }
      renderApp();
    });
  });
  app.querySelectorAll("[data-pay-request]").forEach((button) => {
    button.addEventListener("click", async () => {
      await markRequestsPaid([button.dataset.payRequest], state.bulkPaidAt);
    });
  });
  app.querySelectorAll("[data-row-status]").forEach((select) => {
    select.addEventListener("change", async (event) => {
      await changeRequestStatus([select.dataset.rowStatus], event.target.value, state.bulkPaidAt);
    });
  });
  app.querySelector("[data-bulk-status]")?.addEventListener("change", async (event) => {
    const status = event.target.value;
    event.target.value = "";
    if (!status) return;
    if (!state.selectedRequestIds.length) return showToast("상태를 변경할 요청을 선택하세요.", "error");
    await changeRequestStatus(state.selectedRequestIds, status, state.bulkPaidAt);
  });
  app.querySelectorAll("[data-open-edit-request-popup]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      window.open(`/?request-popup=1&request-id=${encodeURIComponent(button.dataset.openEditRequestPopup)}`, "wooofpay-request", "width=760,height=940,resizable=yes,scrollbars=yes");
    });
  });
  app.querySelectorAll("[data-delete-request]").forEach((button) => {
    button.addEventListener("click", async () => {
      await deleteRequests([button.dataset.deleteRequest]);
    });
  });
  const requestForm = app.querySelector("[data-request-form]");
  if (!requestForm) return;
  const brandSearch = requestForm.querySelector("[name='brandSearch']");
  const brandIdInput = requestForm.querySelector("[name='brandId']");
  const lineItemsInput = requestForm.querySelector("[name='lineItemsJson']");
  const lineItemsTable = requestForm.querySelector("[data-line-items-table]");
  const lineItemSearch = requestForm.querySelector("[name='lineItemSearch']");
  const lineItemQty = requestForm.querySelector("[name='lineItemQty']");
  const lineItemOptions = requestForm.querySelector("#request-price-options");
  const bulkResult = requestForm.querySelector("[data-bulk-result]");
  const bulkUnmatched = requestForm.querySelector("[data-bulk-unmatched]");
  const extraShippingToggle = requestForm.querySelector("[name='useExtraShippingFee']");
  const extraShippingFields = requestForm.querySelector("[data-extra-shipping-fields]");
  let unmatchedItems = [];
  const getEffectiveDate = () => requestForm.querySelector("[name='expectedDepositDate']")?.value || new Date().toISOString().slice(0, 10);
  const refreshPriceState = async () => {
    const [priceEntries, priceAliases] = await Promise.all([api("/api/price-entries"), api("/api/price-aliases")]);
    state.priceEntries = priceEntries.priceEntries;
    state.priceCatalog = priceEntries.catalog;
    state.aliasEntries = priceAliases.priceAliases;
  };
  const getLineItems = () => {
    try {
      const parsed = JSON.parse(lineItemsInput.value || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  };
  const normalizeLineItems = (items) =>
    items
      .slice(0, 30)
      .map((item) => {
        const quantity = Math.max(1, Number(item.quantity || 1));
        const unitSupplyPrice = Number(item.unitSupplyPrice || 0);
        const originalPrice = Number(item.originalPrice || 0);
        const discountPrice = Number(item.discountPrice || 0);
        const unitSalePrice = Number(item.unitSalePrice || item.salePrice || 0);
        return {
          ...item,
          quantity,
          unitSupplyPrice,
          originalPrice,
          discountPrice,
          unitSalePrice,
          effectiveFrom: item.effectiveFrom || "",
          effectiveTo: item.effectiveTo || "",
          salePriceManual: item.salePriceManual === true,
          promotionRuleId: String(item.promotionRuleId || ""),
          totalSupplyPrice: quantity * unitSupplyPrice,
          totalSaleAmount: quantity * unitSalePrice
        };
      });
  // Empty rows stay visible for editing ([+ 행 추가]); the server drops rows
  // without a code/name on save, so they never persist.
  // Lists every rule for the brand, not just ones active on the deposit date —
  // a late-filed request needs to pick a promotion whose period already ended.
  // Out-of-period rules are flagged so the dropdown can mark them, and sorted
  // after the in-period ones so staff aren't confused about what's current.
  const lineItemPromotionOptions = () => {
    const brand = getSelectedBrand();
    if (!brand) return [];
    const targetDate = getEffectiveDate();
    return state.promotionRules
      .filter((rule) => rule.brandId === brand.id && rule.isActive !== false)
      .map((rule) => {
        const from = rule.validFrom || "0000-01-01";
        const to = rule.validTo || "9999-12-31";
        return { ...rule, outOfPeriod: !(from <= targetDate && targetDate <= to) };
      })
      .sort((a, b) => Number(a.outOfPeriod) - Number(b.outOfPeriod));
  };
  const setLineItems = (items) => {
    const normalized = normalizeLineItems(items);
    lineItemsInput.value = JSON.stringify(normalized);
    lineItemsTable.innerHTML = renderRequestLineItems(normalized, lineItemPromotionOptions());
    lineItemsTable.querySelectorAll("[data-line-promotion]").forEach((select) => {
      select.addEventListener("change", () => {
        const updated = getLineItems().map((item) =>
          item.id === select.dataset.linePromotion ? { ...item, promotionRuleId: select.value } : item
        );
        setLineItems(updated);
        updateRequestCalculation(requestForm);
      });
    });
    lineItemsTable.querySelectorAll("[data-remove-line-item]").forEach((button) => {
      button.addEventListener("click", () => {
        setLineItems(getLineItems().filter((item) => item.id !== button.dataset.removeLineItem));
        updateRequestCalculation(requestForm);
      });
    });
    // In-place field edit: update the data model + this row's computed cells
    // WITHOUT rebuilding the table, so the focused input is never destroyed
    // (fixes the "types one char then loses focus" bug).
    const patchLine = (id, patch, opts = {}) => {
      const items = getLineItems().map((item) => {
        if (item.id !== id) return item;
        const merged = { ...item, ...patch };
        const quantity = Math.max(1, Number(merged.quantity || 1));
        const unitSupplyPrice = Math.max(0, Number(merged.unitSupplyPrice || 0));
        const originalPrice = Math.max(0, Number(merged.originalPrice || 0));
        const discountPrice = Math.max(0, Number(merged.discountPrice || 0));
        // 현재판매가: auto = 원판매가 - 할인금액, unless the user typed it directly.
        let salePriceManual = merged.salePriceManual === true;
        if (opts.saleTyped) salePriceManual = true;
        let unitSalePrice = Math.max(0, Number(merged.unitSalePrice || 0));
        if (!salePriceManual && ("originalPrice" in patch || "discountPrice" in patch)) {
          unitSalePrice = Math.max(0, originalPrice - discountPrice);
        }
        return {
          ...merged,
          quantity,
          unitSupplyPrice,
          originalPrice,
          discountPrice,
          unitSalePrice,
          salePriceManual,
          totalSupplyPrice: quantity * unitSupplyPrice,
          totalSaleAmount: quantity * unitSalePrice
        };
      });
      lineItemsInput.value = JSON.stringify(items);
      // Refresh the totals row in place. The table itself is never re-rendered
      // here — that would blow away focus and the IME buffer mid-typing — so
      // the summary has to be updated separately or it silently goes stale.
      const summarySlot = lineItemsTable.querySelector("[data-line-items-summary-slot]");
      if (summarySlot) summarySlot.innerHTML = renderRequestLineItemsSummary(items);
      const item = items.find((x) => x.id === id);
      if (item) {
        const saleCell = lineItemsTable.querySelector(`[data-line-saletotal='${id}']`);
        if (saleCell) saleCell.textContent = `${money.format(Number(item.totalSaleAmount || 0))}원`;
        // Reflect an auto-recomputed 현재판매가 into its input (unless the user is
        // typing in that very field), without rebuilding the row.
        if (!opts.saleTyped) {
          const saleInput = lineItemsTable.querySelector(`[data-line-sale-price='${id}']`);
          if (saleInput && parseAmount(saleInput.value) !== Number(item.unitSalePrice)) {
            saleInput.value = formatAmount(item.unitSalePrice);
          }
        }
      }
      updateRequestCalculation(requestForm);
    };
    lineItemsTable.querySelectorAll("[data-line-qty]").forEach((input) => {
      input.addEventListener("input", () => patchLine(input.dataset.lineQty, { quantity: Math.max(1, Number(input.value || 1)) }));
    });
    lineItemsTable.querySelectorAll("[data-line-supply-price]").forEach((input) => {
      input.addEventListener("input", () => patchLine(input.dataset.lineSupplyPrice, { unitSupplyPrice: parseAmount(input.value) }));
    });
    lineItemsTable.querySelectorAll("[data-line-original]").forEach((input) => {
      input.addEventListener("input", () => patchLine(input.dataset.lineOriginal, { originalPrice: parseAmount(input.value) }));
    });
    lineItemsTable.querySelectorAll("[data-line-discount]").forEach((input) => {
      input.addEventListener("input", () => patchLine(input.dataset.lineDiscount, { discountPrice: parseAmount(input.value) }));
    });
    lineItemsTable.querySelectorAll("[data-line-sale-price]").forEach((input) => {
      input.addEventListener("input", () => patchLine(input.dataset.lineSalePrice, { unitSalePrice: parseAmount(input.value) }, { saleTyped: true }));
    });
    lineItemsTable.querySelectorAll("[data-line-from]").forEach((input) => {
      input.addEventListener("input", () => patchLine(input.dataset.lineFrom, { effectiveFrom: input.value }));
    });
    lineItemsTable.querySelectorAll("[data-line-to]").forEach((input) => {
      input.addEventListener("input", () => patchLine(input.dataset.lineTo, { effectiveTo: input.value }));
    });
    lineItemsTable.querySelectorAll("[data-line-code]").forEach((input) => {
      input.addEventListener("input", () => patchLine(input.dataset.lineCode, { itemCode: input.value }));
    });
    lineItemsTable.querySelectorAll("[data-line-name]").forEach((input) => {
      input.addEventListener("input", () => patchLine(input.dataset.lineName, { itemName: input.value }));
    });
  };
  const refreshLineItemOptions = () => {
    const brand = state.brands.find((item) => item.id === brandIdInput.value) || findBrandByInput(brandSearch.value);
    const options = state.priceCatalog.filter((item) => !brand || item.brandId === brand.id);
    lineItemOptions.innerHTML = options.map((item) => `<option value="${h(formatPriceOption(item))}"></option>`).join("");
  };
  const getSelectedBrand = () =>
    state.brands.find((item) => item.id === brandIdInput.value) || findBrandByInput(brandSearch.value);
  const mergeLineItem = (items, priceItem, quantity) => {
    if (items.length >= 30 && !items.some((item) => item.priceEntryId === priceItem.id || (item.itemCode && item.itemCode === priceItem.itemCode && item.itemName === priceItem.itemName))) {
      if (bulkResult) bulkResult.textContent = "품목 행은 최대 30개까지 입력할 수 있습니다.";
      return items;
    }
    const existing = items.find((item) => item.priceEntryId === priceItem.id || (item.itemCode && item.itemCode === priceItem.itemCode && item.itemName === priceItem.itemName));
    const catalogOriginal = Number(priceItem.originalPrice || priceItem.consumerPrice || 0);
    const catalogDiscount = Number(priceItem.discountPrice || 0);
    if (existing) {
      existing.quantity = Math.max(1, Number(existing.quantity || 1) + quantity);
      existing.unitSupplyPrice = Number(priceItem.supplyPrice || existing.unitSupplyPrice || 0);
      existing.originalPrice = catalogOriginal || existing.originalPrice || 0;
      existing.discountPrice = catalogDiscount || existing.discountPrice || 0;
      existing.unitSalePrice = Number(priceItem.salePrice || existing.unitSalePrice || 0);
      existing.totalSupplyPrice = Number(existing.quantity) * Number(existing.unitSupplyPrice);
      existing.totalSaleAmount = Number(existing.quantity) * Number(existing.unitSalePrice || 0);
      existing.spec = priceItem.spec || existing.spec || "";
      existing.unit = priceItem.unit || existing.unit || "";
      existing.effectiveFrom = priceItem.effectiveFrom || existing.effectiveFrom || "";
      existing.effectiveTo = priceItem.effectiveTo || existing.effectiveTo || "";
      return items;
    }
    const newLine = {
      id: cryptoRandomId(),
      priceEntryId: priceItem.id,
      itemCode: priceItem.itemCode,
      itemName: priceItem.itemName,
      spec: priceItem.spec || "",
      unit: priceItem.unit || "",
      quantity,
      unitSupplyPrice: Number(priceItem.supplyPrice || 0),
      originalPrice: catalogOriginal,
      discountPrice: catalogDiscount,
      unitSalePrice: Number(priceItem.salePrice || 0),
      salePriceManual: Number(priceItem.salePrice || 0) !== Math.max(0, catalogOriginal - catalogDiscount),
      totalSupplyPrice: Number(priceItem.supplyPrice || 0) * quantity,
      totalSaleAmount: Number(priceItem.salePrice || 0) * quantity,
      effectiveFrom: priceItem.effectiveFrom,
      effectiveTo: priceItem.effectiveTo || ""
    };
    // 보여지는 빈 행(코드·품목명 없음)이 있으면 그 자리를 채워 잔여 빈 행이 남지 않게 함.
    const blankIndex = items.findIndex(
      (item) => !String(item.itemCode || "").trim() && !String(item.itemName || "").trim()
    );
    if (blankIndex >= 0) items[blankIndex] = { ...newLine, id: items[blankIndex].id };
    else items.push(newLine);
    return items;
  };
  const addManualLineItem = () => {
    const items = getLineItems();
    if (items.length >= 30) {
      if (bulkResult) bulkResult.textContent = "품목 행은 최대 30개까지 입력할 수 있습니다.";
      return;
    }
    items.push({
      id: cryptoRandomId(),
      priceEntryId: "",
      itemCode: "",
      itemName: "",
      spec: "",
      unit: "",
      quantity: 1,
      unitSupplyPrice: 0,
      originalPrice: 0,
      discountPrice: 0,
      unitSalePrice: 0,
      salePriceManual: false,
      totalSupplyPrice: 0,
      totalSaleAmount: 0,
      effectiveFrom: "",
      effectiveTo: ""
    });
    setLineItems(items);
    updateRequestCalculation(requestForm);
  };
  const setUnmatchedItems = (items) => {
    unmatchedItems = items;
    if (!bulkUnmatched) return;
    bulkUnmatched.innerHTML = renderBulkUnmatchedItems(unmatchedItems);
    bulkUnmatched.querySelectorAll("[data-dismiss-unmatched]").forEach((button) => {
      button.addEventListener("click", () => {
        setUnmatchedItems(unmatchedItems.filter((item) => item.id !== button.dataset.dismissUnmatched));
      });
    });
    bulkUnmatched.querySelectorAll("[data-apply-unmatched-map]").forEach((button) => {
      button.addEventListener("click", () => {
        const missing = unmatchedItems.find((item) => item.id === button.dataset.applyUnmatchedMap);
        const brand = getSelectedBrand();
        const input = bulkUnmatched.querySelector(`[data-unmatched-map-input='${button.dataset.applyUnmatchedMap}']`);
        const priceItem = findPriceCatalogByInput(input?.value || "", brand?.id || "", getEffectiveDate());
        if (!missing || !priceItem) {
          if (bulkResult) bulkResult.textContent = "기존 단가 매핑 대상을 찾지 못했습니다.";
          return;
        }
        setLineItems(mergeLineItem(getLineItems(), priceItem, missing.quantity));
        setUnmatchedItems(unmatchedItems.filter((item) => item.id !== missing.id));
        if (bulkResult) bulkResult.textContent = "미일치 품목을 기존 단가에 연결했습니다.";
        updateRequestCalculation(requestForm);
      });
    });
    bulkUnmatched.querySelectorAll("[data-create-unmatched-alias]").forEach((button) => {
      button.addEventListener("click", async () => {
        const missing = unmatchedItems.find((item) => item.id === button.dataset.createUnmatchedAlias);
        const brand = getSelectedBrand();
        const mapInput = bulkUnmatched.querySelector(`[data-unmatched-map-input='${button.dataset.createUnmatchedAlias}']`);
        const aliasTextInput = bulkUnmatched.querySelector(`[data-unmatched-alias-text='${button.dataset.createUnmatchedAlias}']`);
        const aliasNoteInput = bulkUnmatched.querySelector(`[data-unmatched-alias-note='${button.dataset.createUnmatchedAlias}']`);
        const validFromInput = bulkUnmatched.querySelector(`[data-unmatched-alias-from='${button.dataset.createUnmatchedAlias}']`);
        const validToInput = bulkUnmatched.querySelector(`[data-unmatched-alias-to='${button.dataset.createUnmatchedAlias}']`);
        const priceItem = findPriceCatalogByInput(mapInput?.value || "", brand?.id || "", getEffectiveDate());
        if (!missing || !brand || !priceItem) {
          if (bulkResult) bulkResult.textContent = "별칭으로 연결할 기존 단가를 찾지 못했습니다.";
          return;
        }
        const aliasText = String(aliasTextInput?.value || "").trim();
        if (!aliasText) {
          if (bulkResult) bulkResult.textContent = "자동 인식할 별칭 문구를 입력하세요.";
          return;
        }
        await api("/api/price-aliases", {
          method: "POST",
          body: {
            brandId: brand.id,
            priceEntryId: priceItem.id,
            aliasText,
            note: aliasNoteInput?.value || "",
            validFrom: validFromInput?.value || getEffectiveDate(),
            validTo: validToInput?.value || ""
          }
        });
        await refreshPriceState();
        refreshLineItemOptions();
        setLineItems(mergeLineItem(getLineItems(), priceItem, missing.quantity));
        setUnmatchedItems(unmatchedItems.filter((item) => item.id !== missing.id));
        if (bulkResult) bulkResult.textContent = "기간 별칭을 저장하고 품목에 연결했습니다.";
        updateRequestCalculation(requestForm);
      });
    });
    bulkUnmatched.querySelectorAll("[data-create-unmatched-price]").forEach((button) => {
      button.addEventListener("click", async () => {
        const missing = unmatchedItems.find((item) => item.id === button.dataset.createUnmatchedPrice);
        const brand = getSelectedBrand();
        const supplyInput = bulkUnmatched.querySelector(`[data-unmatched-supply-price='${button.dataset.createUnmatchedPrice}']`);
        const supplyPrice = Number(supplyInput?.value || 0);
        if (!missing || !brand) {
          if (bulkResult) bulkResult.textContent = "브랜드 또는 미일치 품목 정보가 없습니다.";
          return;
        }
        if (!supplyPrice) {
          if (bulkResult) bulkResult.textContent = "신규 공급가를 입력하세요.";
          return;
        }
        const created = await api("/api/price-entries", {
          method: "POST",
          body: {
            brandId: brand.id,
            itemCode: missing.itemCode || "",
            itemName: missing.itemName || missing.raw,
            spec: "",
            unit: "",
            supplyPrice,
            effectiveFrom: getEffectiveDate(),
            note: "일괄 입력 미일치 품목에서 생성"
          }
        });
        await refreshPriceState();
        refreshLineItemOptions();
        setLineItems(mergeLineItem(getLineItems(), created.priceEntry, missing.quantity));
        setUnmatchedItems(unmatchedItems.filter((item) => item.id !== missing.id));
        if (bulkResult) bulkResult.textContent = "새 단가를 등록하고 품목에 추가했습니다.";
        updateRequestCalculation(requestForm);
      });
    });
  };
  setLineItems(getLineItems());
  setUnmatchedItems([]);
  refreshLineItemOptions();
  // Start with one empty row so users can type a line immediately ([+ 행 추가]
  // adds more). Empty rows are dropped by the server on save.
  if (!getLineItems().length) addManualLineItem();
  const brandPopupButton = requestForm.querySelector("[data-open-brand-popup]");
  const syncBrandPopupButton = () => {
    if (brandPopupButton) brandPopupButton.disabled = !brandIdInput.value;
  };
  const brandCreditHint = requestForm.querySelector("[data-brand-credit-hint]");
  const syncBrandCreditHint = () => {
    if (!brandCreditHint) return;
    const brand = state.brands.find((b) => b.id === brandIdInput.value);
    brandCreditHint.innerHTML = brand
      ? `${h(brand.name)} 외상 잔액: ${renderCreditBalance(brand.creditBalance)}`
      : "브랜드를 선택하면 잔액이 표시됩니다.";
  };
  brandSearch.addEventListener("focus", (event) => {
    if (event.target.value) event.target.select();
  });
  brandSearch.addEventListener("click", (event) => {
    if (event.target.value && event.target.selectionStart === event.target.selectionEnd) {
      event.target.select();
    }
  });
  brandSearch.addEventListener("input", () => {
    const brand = findBrandByInput(brandSearch.value);
    brandIdInput.value = brand?.id || "";
    syncBrandPopupButton();
    syncBrandCreditHint();
    refreshLineItemOptions();
    updateRequestCalculation(requestForm);
  });
  brandSearch.addEventListener("change", () => {
    const brand = findBrandByInput(brandSearch.value);
    brandIdInput.value = brand?.id || "";
    if (brand) {
      pushRecentBrand(brand.id);
      applyBrandDefaults(requestForm, brand);
    }
    syncBrandPopupButton();
    syncBrandCreditHint();
    setUnmatchedItems([]);
    refreshLineItemOptions();
    updateRequestCalculation(requestForm);
  });
  brandPopupButton?.addEventListener("click", () => {
    const brandId = brandIdInput.value;
    if (!brandId) return;
    window.open(
      `/?brand-popup=1&brand-id=${encodeURIComponent(brandId)}`,
      `wooofpay-brand-${brandId}`,
      "width=860,height=940,resizable=yes,scrollbars=yes"
    );
  });
  extraShippingToggle?.addEventListener("change", () => {
    const enabled = extraShippingToggle.checked;
    if (extraShippingFields) extraShippingFields.style.display = enabled ? "" : "none";
    requestForm.querySelectorAll("[name='extraShippingFee'], [name='extraShippingNote']").forEach((input) => {
      if (!enabled) input.value = input.name === "extraShippingFee" ? "0" : "";
    });
    updateRequestCalculation(requestForm);
  });
  const addPriceItemLine = (priceItem) => {
    const quantity = Math.max(1, Number(lineItemQty.value || 1));
    setLineItems(mergeLineItem(getLineItems(), priceItem, quantity));
    lineItemSearch.value = "";
    lineItemQty.value = "1";
    if (bulkResult) bulkResult.textContent = "";
    setUnmatchedItems([]);
    updateRequestCalculation(requestForm);
    lineItemSearch.focus();
  };
  const addSelectedLineItem = () => {
    const brand = getSelectedBrand();
    const priceItem = findPriceCatalogByInput(lineItemSearch.value, brand?.id || "", getEffectiveDate());
    if (!priceItem) {
      alert("현재 브랜드에 해당하는 품목을 찾지 못했습니다.");
      return;
    }
    addPriceItemLine(priceItem);
  };
  // Custom autocomplete — replaces the native <datalist> which does not refilter
  // mid-Korean-IME-composition (user had to type a trailing space to commit).
  const lineItemMenu = requestForm.querySelector("[data-line-item-menu]");
  let acMatches = [];
  let acActive = -1;
  const buildMatches = (rawQuery) => {
    const query = normalizeSearchText(rawQuery);
    if (!query) return [];
    const brand = getSelectedBrand();
    return state.priceCatalog
      .filter((item) => !brand || item.brandId === brand.id)
      .filter((item) => normalizeSearchText(`${item.itemCode || ""} ${item.itemName || ""}`).includes(query))
      .slice(0, 20);
  };
  const renderMenu = () => {
    if (!lineItemMenu) return;
    if (!acMatches.length) {
      lineItemMenu.hidden = true;
      lineItemMenu.innerHTML = "";
      return;
    }
    lineItemMenu.innerHTML = acMatches
      .map((item, i) => `<div class="autocomplete-item${i === acActive ? " active" : ""}" data-ac-index="${i}">${h(formatPriceOption(item))}</div>`)
      .join("");
    lineItemMenu.hidden = false;
  };
  const closeMenu = () => {
    acMatches = [];
    acActive = -1;
    if (lineItemMenu) {
      lineItemMenu.hidden = true;
      lineItemMenu.innerHTML = "";
    }
  };
  const refreshMenu = () => {
    acMatches = buildMatches(lineItemSearch.value);
    acActive = acMatches.length ? 0 : -1;
    renderMenu();
  };
  lineItemSearch.addEventListener("input", refreshMenu);
  lineItemSearch.addEventListener("compositionend", refreshMenu);
  lineItemSearch.addEventListener("focus", refreshMenu);
  lineItemSearch.addEventListener("blur", () => setTimeout(closeMenu, 150));
  lineItemMenu?.addEventListener("mousedown", (event) => {
    const target = event.target.closest("[data-ac-index]");
    if (!target) return;
    event.preventDefault();
    const picked = acMatches[Number(target.dataset.acIndex)];
    if (picked) {
      closeMenu();
      addPriceItemLine(picked);
    }
  });
  lineItemSearch.addEventListener("keydown", (event) => {
    if (event.isComposing) return;
    if (event.key === "ArrowDown" && acMatches.length) {
      event.preventDefault();
      acActive = (acActive + 1) % acMatches.length;
      renderMenu();
    } else if (event.key === "ArrowUp" && acMatches.length) {
      event.preventDefault();
      acActive = (acActive - 1 + acMatches.length) % acMatches.length;
      renderMenu();
    } else if (event.key === "Escape") {
      closeMenu();
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (acMatches.length && acActive >= 0) {
        const picked = acMatches[acActive];
        closeMenu();
        addPriceItemLine(picked);
      } else {
        addSelectedLineItem();
      }
    }
  });
  requestForm.querySelector("[data-add-line-item]").addEventListener("click", () => {
    addSelectedLineItem();
  });
  requestForm.querySelector("[data-add-manual-line-item]")?.addEventListener("click", () => {
    addManualLineItem();
  });
  lineItemQty.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addSelectedLineItem();
    }
  });
  requestForm
    .querySelectorAll("[name='productSalesAmount'], [name='extraShippingFee'], [name='commissionRate'], [name='supplyAmount'], [name='expectedDepositDate'], [name='overpaidAmount'], [name='creditUsedAmount'], [name='cancelledAmount'], [name='priorPaidAmount'], [name='promotionRuleId']")
    .forEach((input) => input.addEventListener("input", () => updateRequestCalculation(requestForm)));
  requestForm.querySelector("[name='baseShippingFee']")?.addEventListener("input", (event) => {
    event.target.dataset.manual = "1";
    updateRequestCalculation(requestForm);
  });
  // 최종입금액을 직접 고치면 수동 고정 — 업체 절사/반올림에 맞춰야 할 때.
  // 칸을 비우면 자동계산으로 되돌아간다 (updateRequestCalculation 에서 해제).
  requestForm.querySelector("[name='depositAmount']")?.addEventListener("input", (event) => {
    event.target.dataset.manual = "1";
    updateRequestCalculation(requestForm);
  });
  requestForm.querySelector("[name='paidAmount']")?.addEventListener("input", (event) => {
    event.target.dataset.manual = "1";
  });
  requestForm.querySelector("[name='directTotalAmount']")?.addEventListener("input", (event) => {
    event.target.dataset.userTyping = "1";
    const total = parseAmount(event.target.value || 0);
    const brand = state.brands.find((b) => b.id === requestForm.querySelector("[name='brandId']")?.value);
    const split = splitDirectTotal(total, brand);
    const product = requestForm.querySelector("[name='productSalesAmount']");
    const base = requestForm.querySelector("[name='baseShippingFee']");
    if (product) product.value = formatAmount(split.product);
    if (base) {
      base.value = formatAmount(split.shipping);
      base.dataset.manual = "";
    }
    updateRequestCalculation(requestForm);
    delete event.target.dataset.userTyping;
  });
  updateRequestCalculation(requestForm);
  // Reformat any amount field with thousands separators when it loses focus.
  requestForm.addEventListener("focusout", (event) => {
    const el = event.target;
    if (el?.classList?.contains("money-input") && !el.readOnly) {
      el.value = formatAmount(el.value);
    }
  });
  requestForm.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    const tag = event.target.tagName;
    if (tag === "TEXTAREA" || tag === "BUTTON") return;
    if (event.target.type === "submit") return;
    event.preventDefault();
  });
  requestForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submitBtn = event.currentTarget.querySelector('[type="submit"]');
    // Guard against accidental double-submit: ignore while a save is in flight.
    if (submitBtn?.disabled) return;
    if (submitBtn) submitBtn.disabled = true;
    const body = formObject(event.currentTarget);
    // 최종입금액을 손으로 고쳤는지는 input 의 data-manual 에만 있다 — 서버가
    // 재계산으로 덮지 않도록 플래그를 함께 보낸다.
    const depositManualEl = event.currentTarget.querySelector("[name='depositAmount']");
    body.depositAmountManual =
      depositManualEl?.dataset.manual === "1" && parseAmount(depositManualEl.value || 0) > 0;
    const brand = state.brands.find((item) => item.id === body.brandId) || findBrandByInput(body.brandSearch);
    if (brand) body.brandName = brand.name;
    body.brandId = brand?.id || "";
    if (body.brandId) pushRecentBrand(body.brandId);
    body.lineItems = body.lineItemsJson || "[]";
    delete body.brandSearch;
    delete body.lineItemsJson;
    const wasEditing = Boolean(state.editingRequest?.id);

    // 정가 기준 브랜드인데 단가표에 없는 품목이 있으면, 저장 전에 등록/별칭
    // 연결부터 하도록 확인 패널을 띄운다. 확인은 보조 기능이라 실패해도 저장은
    // 막지 않는다.
    if (brand?.priceBasis === "catalog") {
      try {
        const check = await api("/api/price-entries/match-check", {
          method: "POST",
          body: { brandId: brand.id, lineItems: body.lineItems }
        });
        if (check.unmatched?.length) {
          state.catalogResolve = {
            brandId: brand.id,
            brandName: brand.name,
            items: check.unmatched.map((u) => ({ ...u, status: "pending" })),
            pendingBody: body,
            wasEditing
          };
          showCatalogResolvePanel();
          if (submitBtn) submitBtn.disabled = false;
          return;
        }
      } catch {
        // 확인 API 자체가 실패해도 원래 저장 흐름은 그대로 진행한다.
      }
    }
    await submitRequestPayload(event.currentTarget, body, wasEditing);
  });
  app.querySelector("[data-cancel-edit]")?.addEventListener("click", () => {
    state.editingRequest = null;
    state.catalogResolve = null;
    if (isRequestPopup) history.replaceState({}, "", "/?request-popup=1");
    renderApp();
    focusRequestForm();
  });
}

function findBrandByInput(value) {
  const query = String(value || "").trim().toLowerCase();
  if (!query) return null;
  return (
    state.brands.find((brand) => brand.isActive !== false && brand.name.toLowerCase() === query) ||
    state.brands.find((brand) => brand.isActive !== false && brand.name.toLowerCase().includes(query))
  );
}

function applyBrandDefaults(form, brand) {
  const setIfEmpty = (name, value) => {
    const input = form.querySelector(`[name='${name}']`);
    if (input && !input.value && value) input.value = value;
  };
  const setValue = (name, value) => {
    const input = form.querySelector(`[name='${name}']`);
    if (input && value !== undefined && value !== null) input.value = value;
  };
  const promotion = findActivePromotionRule(brand.id, form.querySelector("[name='expectedDepositDate']")?.value);
  setValue("settlementType", brand.settlementType || "prepay_fee");
  setValue("commissionRate", promotion?.commissionRate ?? brand.commissionRate ?? "");
  setValue("promotionRuleId", "");
  setValue("cutoffNote", brand.cutoffNote || "");
  setValue("requiredMemo", brand.requiredMemo || "");
  setValue("sourceSheet", brand.rawSheetName || brand.name || "");
  setValue("businessName", brand.businessName || "");
  setValue("businessNumber", brand.businessNumber || "");
  setValue("depositorName", brand.depositorName || "");
  // 브랜드를 바꾸면 출금통장표시도 그 브랜드 기본값으로 바꾼다. 건별로 손댄
  // 값(또는 이미 저장된 요청의 값)은 덮지 않는다.
  const withdrawInput = form.querySelector("[name='withdrawMemo']");
  if (withdrawInput && withdrawInput.dataset.manual !== "1") {
    withdrawInput.value = brand.withdrawMemoDefault || `${brand.name || ""}선매입`;
  }
  const baseShippingInput = form.querySelector("[name='baseShippingFee']");
  if (baseShippingInput) baseShippingInput.dataset.manual = "";
  updateRequestCalculation(form);
}

function updateRequestCalculation(form) {
  const value = (name) => parseAmount(form.querySelector(`[name='${name}']`)?.value || 0);
  const brandId = form.querySelector("[name='brandId']")?.value || "";
  const brandSearch = form.querySelector("[name='brandSearch']")?.value || "";
  const brand = state.brands.find((item) => item.id === brandId) || findBrandByInput(brandSearch);
  const lineItems = (() => {
    try {
      const parsed = JSON.parse(form.querySelector("[name='lineItemsJson']")?.value || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  })();
  const settlementType = form.querySelector("[name='settlementType']")?.value || "prepay_fee";
  const derivedProductSalesAmount = lineItems.reduce((sum, item) => sum + Number(item.totalSaleAmount || 0), 0);
  const productSalesAmount = derivedProductSalesAmount > 0 ? derivedProductSalesAmount : value("productSalesAmount");
  const supplyAmount = lineItems.length
    ? lineItems.reduce((sum, item) => sum + Number(item.totalSupplyPrice || 0), 0)
    : value("supplyAmount");
  const baseShippingInputEl = form.querySelector("[name='baseShippingFee']");
  const baseManual = baseShippingInputEl?.dataset.manual === "1";
  const shippingBase = shippingThresholdBaseAmount(brand, { salesAmount: productSalesAmount, supplyAmount });
  const baseShippingFee = baseManual ? value("baseShippingFee") : calculateBrandShippingFee(brand, shippingBase);
  const extraShippingFee = value("extraShippingFee");
  const shippingFee = baseShippingFee + extraShippingFee;
  const promotionContext = buildPromotionPreview(
    brand, lineItems,
    form.querySelector("[name='expectedDepositDate']")?.value,
    form.querySelector("[name='promotionRuleId']")?.value || ""
  );
  const promotion = promotionContext?.primaryRule || null;
  const commissionRate = Number(promotionContext?.commissionRate ?? brand?.commissionRate ?? value("commissionRate"));
  const discountAmount = Number.isFinite(promotionContext?.discountAmount)
    ? Number(promotionContext.discountAmount)
    : (() => {
        const dv = Number(promotionContext?.discountValue || 0);
        if (!dv) return 0;
        if (promotionContext?.discountValueType === "percent") return Math.round(productSalesAmount * dv / 100);
        if (promotionContext?.discountValueType === "fixed") return Math.min(dv, productSalesAmount);
        return 0;
      })();
  const adjustedProductSales = Math.max(0, productSalesAmount - discountAmount);
  const commissionAmount = Number.isFinite(promotionContext?.commissionAmount)
    ? Number(promotionContext.commissionAmount)
    : Math.round(adjustedProductSales * (commissionRate / 100));
  const hasReceivable = Boolean(brand?.hasReceivable || settlementType === "prepay_debt");
  const isDirect = settlementType === "direct_purchase";
  let depositAmount = 0;
  if (settlementType === "prepay_debt") {
    depositAmount = adjustedProductSales + shippingFee;
  } else if (settlementType === "prepay_supply") {
    depositAmount = hasReceivable ? adjustedProductSales + extraShippingFee : supplyAmount + shippingFee;
  } else if (isDirect) {
    depositAmount = adjustedProductSales + shippingFee;
  } else {
    depositAmount = adjustedProductSales - commissionAmount + shippingFee;
  }
  // 최종입금액 수동 고정 — 서버(calculateSettlement)와 같은 규칙. 고정된 동안은
  // 이 값이 아래 모든 계산(실 지급액·기지급 안내 등)에 쓰이고, 비우면 해제된다.
  const depositInputEl = form.querySelector("[name='depositAmount']");
  let depositManual = depositInputEl?.dataset.manual === "1";
  const manualDeposit = depositManual ? parseAmount(depositInputEl.value || 0) : 0;
  if (depositManual && manualDeposit <= 0 && depositInputEl.value.trim() === "") {
    depositManual = false;
    depositInputEl.dataset.manual = "";
  }
  const calcDepositAmount = depositAmount;
  if (depositManual && manualDeposit > 0) depositAmount = manualDeposit;
  const cancelledAmount = value("cancelledAmount");
  const receivableDeduction =
    settlementType === "prepay_debt"
      ? Math.round(productSalesAmount * Number(brand?.commissionRate || 0) / 100)
        + Math.round(cancelledAmount * (1 - Number(brand?.commissionRate || 0) / 100))
      : (settlementType === "prepay_supply" && hasReceivable ? Math.max(0, adjustedProductSales - supplyAmount - baseShippingFee) : 0);
  const commissionInput = form.querySelector("[name='commissionAmount']");
  const depositInput = form.querySelector("[name='depositAmount']");
  const deductionInput = form.querySelector("[name='receivableDeduction']");
  const supplyInput = form.querySelector("[name='supplyAmount']");
  const statusInput = form.querySelector("[name='status']");
  const baseShippingInput = form.querySelector("[name='baseShippingFee']");
  const totalShippingInput = form.querySelector("[name='shippingFee']");
  const commissionRateInput = form.querySelector("[name='commissionRate']");
  const promotionPreview = form.querySelector("[data-promotion-preview]");
  const productSalesInput = form.querySelector("[name='productSalesAmount']");
  const receivableField = form.querySelector("[data-receivable-deduction-field]");
  const supplyAmountField = form.querySelector("[data-supply-amount-field]");
  const fixedSettlementType = form.querySelector("[data-fixed-settlement-type]");
  const fixedCommissionRate = form.querySelector("[data-fixed-commission-rate]");
  const fixedBaseShipping = form.querySelector("[data-fixed-base-shipping]");
  const fixedCutoff = form.querySelector("[data-fixed-cutoff]");
  const fixedSourceSheet = form.querySelector("[data-fixed-source-sheet]");
  const fixedDepositor = form.querySelector("[data-fixed-depositor]");
  const fixedBusiness = form.querySelector("[data-fixed-business]");
  const fixedRequiredMemo = form.querySelector("[data-fixed-required-memo]");
  const fixedCutoffNote = form.querySelector("[data-fixed-cutoff-note]");
  const receivableLabel = form.querySelector("[data-receivable-deduction-label]");
  const specialSettlementNoteEl = form.querySelector("[data-special-settlement-note]");
  let displayedCommissionAmount;
  if (isDirect) {
    displayedCommissionAmount = 0;
  } else if (hasReceivable && settlementType === "prepay_debt") {
    displayedCommissionAmount = receivableDeduction;
  } else if (hasReceivable) {
    displayedCommissionAmount = Math.round(productSalesAmount * Number(brand?.commissionRate || 0) / 100);
  } else {
    displayedCommissionAmount = Math.max(0, adjustedProductSales + shippingFee - depositAmount);
  }
  if (commissionInput) commissionInput.value = formatAmount(displayedCommissionAmount);
  const commissionHint = form.querySelector("[data-commission-display-hint]");
  if (commissionHint) {
    commissionHint.textContent = isDirect
      ? ""
      : hasReceivable
        ? "(채권 기준 — 프로모션 무시)"
        : "(실제 차감액)";
  }
  if (commissionRateInput) commissionRateInput.value = String(commissionRate || "");
  if (promotionPreview) promotionPreview.textContent = promotionContext?.name || "없음";
  if (productSalesInput && derivedProductSalesAmount > 0) productSalesInput.value = formatAmount(productSalesAmount);
  if (supplyInput && lineItems.length) supplyInput.value = formatAmount(supplyAmount);
  if (baseShippingInput && !baseManual) baseShippingInput.value = formatAmount(baseShippingFee);
  if (totalShippingInput) totalShippingInput.value = formatAmount(shippingFee);
  // 수동 고정 중에는 입력 중인 값을 덮어쓰지 않는다. 대신 자동계산과의 차이를
  // 바로 아래에 보여줘, 몇 원을 강제로 더/덜 보내는지 눈에 남긴다.
  if (depositInput && !(depositManual && manualDeposit > 0)) depositInput.value = formatAmount(depositAmount);
  const depositHint = form.querySelector("[data-deposit-manual-hint]");
  if (depositHint) {
    if (depositManual && manualDeposit > 0) {
      const diff = depositAmount - calcDepositAmount;
      depositHint.style.display = "";
      depositHint.innerHTML = `수동 고정됨 — 자동계산 <strong>${money.format(calcDepositAmount)}원</strong>`
        + (diff ? ` (${diff > 0 ? "+" : "−"}${money.format(Math.abs(diff))}원)` : " (차이 없음)")
        + " · 칸을 비우면 자동계산으로 복귀";
    } else {
      depositHint.style.display = "none";
    }
  }
  if (deductionInput) deductionInput.value = formatAmount(receivableDeduction);
  const creditUsedAmount = value("creditUsedAmount");
  const priorPaidAmount = value("priorPaidAmount");
  const paidAmountInput = form.querySelector("[name='paidAmount']");
  const paidManual = paidAmountInput?.dataset.manual === "1";
  const finalPaidAmount = Math.max(0, depositAmount - creditUsedAmount - priorPaidAmount);
  if (paidAmountInput && !paidManual) paidAmountInput.value = formatAmount(finalPaidAmount);
  const priorPaidHint = form.querySelector("[data-prior-paid-hint]");
  if (priorPaidHint) {
    if (priorPaidAmount > 0) {
      priorPaidHint.style.display = "";
      priorPaidHint.innerHTML = `총 지급대상 <strong>${money.format(depositAmount)}원</strong> · 기지급 <strong>${money.format(priorPaidAmount)}원</strong> → 이번 추가 지급 <strong style="color:var(--red)">${money.format(finalPaidAmount)}원</strong>`;
    } else {
      priorPaidHint.style.display = "none";
      priorPaidHint.innerHTML = "";
    }
  }
  const creditHint = form.querySelector("[data-brand-credit-hint]");
  if (creditHint) {
    if (brand) {
      const prior = state.editingRequest && state.editingRequest.brandId === brand.id ? state.editingRequest : null;
      const liveBalance =
        Number(brand.creditBalance || 0)
        + (value("overpaidAmount") - Number(prior?.overpaidAmount || 0))
        - (creditUsedAmount - Number(prior?.creditUsedAmount || 0));
      const baseline = `${h(brand.name)} 외상 잔액: ${renderCreditBalance(brand.creditBalance)}`;
      const adjustedNote = creditUsedAmount || value("overpaidAmount") || prior
        ? ` <span class="muted">→ 이번 건 반영 시 ${renderCreditBalance(liveBalance)}</span>`
        : "";
      creditHint.innerHTML = baseline + adjustedNote;
    } else {
      creditHint.innerHTML = "브랜드를 선택하면 잔액이 표시됩니다.";
    }
  }
  if (receivableField) receivableField.style.display = !isDirect && (settlementType === "prepay_debt" || (settlementType === "prepay_supply" && hasReceivable)) ? "" : "none";
  if (receivableLabel) receivableLabel.textContent = receivableDeductionLabel(settlementType, brand);
  if (supplyAmountField) supplyAmountField.style.display = !isDirect && settlementType === "prepay_supply" ? "" : "none";
  form.querySelectorAll("[data-hide-direct]").forEach((el) => {
    el.style.display = isDirect ? "none" : "";
  });
  form.querySelectorAll("[data-show-direct]").forEach((el) => {
    el.style.display = isDirect ? "" : "none";
  });
  if (isDirect) {
    if (commissionInput) commissionInput.value = "";
    if (commissionRateInput) commissionRateInput.value = "";
    if (promotionPreview) promotionPreview.textContent = "";
    if (supplyInput) supplyInput.value = "";
    const directInput = form.querySelector("[name='directTotalAmount']");
    const directBreakdown = form.querySelector("[data-direct-breakdown]");
    if (directBreakdown) {
      directBreakdown.innerHTML = depositAmount
        ? `→ 상품 ₩${money.format(productSalesAmount)} + 배송 ₩${money.format(baseShippingFee)}`
        : "총액을 입력하면 자동으로 분할됩니다.";
    }
    if (directInput && !directInput.dataset.userTyping) directInput.value = formatAmount(depositAmount);
  }
  if (fixedSettlementType) fixedSettlementType.textContent = settlementLabel(settlementType);
  if (fixedCommissionRate) fixedCommissionRate.textContent = commissionRate ? `${commissionRate}%` : "-";
  if (fixedBaseShipping) fixedBaseShipping.textContent = `${money.format(Number(baseShippingFee || 0))}원`;
  if (fixedCutoff) fixedCutoff.textContent = cutoffLabel(brand) || "-";
  if (fixedSourceSheet) fixedSourceSheet.textContent = form.querySelector("[name='sourceSheet']")?.value || "-";
  if (fixedDepositor) fixedDepositor.textContent = form.querySelector("[name='depositorName']")?.value || "-";
  const fixedAccount = form.querySelector("[data-fixed-account]");
  if (fixedAccount) {
    fixedAccount.textContent = [brand?.bankName, brand?.bankAccount].filter(Boolean).join(" ") || "-";
  }
  if (fixedBusiness) {
    const name = form.querySelector("[name='businessName']")?.value || "";
    const numberText = form.querySelector("[name='businessNumber']")?.value || "";
    fixedBusiness.textContent = name ? `${name}${numberText ? ` (${numberText})` : ""}` : "-";
  }
  if (fixedRequiredMemo) fixedRequiredMemo.textContent = form.querySelector("[name='requiredMemo']")?.value || "-";
  if (fixedCutoffNote) fixedCutoffNote.textContent = form.querySelector("[name='cutoffNote']")?.value || "-";
  if (specialSettlementNoteEl) {
    const noteText = specialSettlementNote(settlementType, brand);
    specialSettlementNoteEl.textContent = noteText || "-";
    specialSettlementNoteEl.closest("div")?.style.setProperty("display", noteText ? "" : "none");
  }
  if (statusInput && settlementType === "consignment" && statusInput.value === "pending") statusInput.value = "consignment_unpaid";
  if (statusInput && settlementType !== "consignment" && statusInput.value === "consignment_unpaid") statusInput.value = "pending";
}

function showToast(text, kind = "success") {
  let el = document.getElementById("toast");
  if (!el) {
    el = document.createElement("div");
    el.id = "toast";
    Object.assign(el.style, {
      position: "fixed", bottom: "24px", left: "50%", transform: "translateX(-50%)",
      padding: "14px 22px", borderRadius: "14px", color: "#fff", fontSize: "14px",
      fontWeight: "600", zIndex: "9999", boxShadow: "0 8px 24px rgba(0,0,0,0.2)", maxWidth: "min(92vw, 560px)",
      opacity: "0", transition: "opacity 180ms ease-out", pointerEvents: "none"
    });
    document.body.appendChild(el);
  }
  // 토스처럼 어두운 상자, 오류만 빨간 점으로 구분한다.
  el.style.background = "rgba(25,31,40,0.94)";
  el.textContent = kind === "error" ? `⚠ ${text}` : text;
  el.style.opacity = "1";
  clearTimeout(el._t);
  el._t = setTimeout(() => { el.style.opacity = "0"; }, 1800);
}

function focusRequestForm() {
  requestAnimationFrame(() => {
    const input = app.querySelector("[data-request-form] [name='brandSearch']");
    input?.focus();
    input?.scrollIntoView({ block: "center", behavior: "smooth" });
  });
}

function formatPriceOption(item) {
  const code = item.itemCode ? `${item.itemCode} | ` : "";
  return `${code}${item.itemName}`;
}

function summarizeAppliedPromotions(item) {
  if (Array.isArray(item.appliedPromotionRules) && item.appliedPromotionRules.length) {
    return item.appliedPromotionRules.map((rule) => rule.name).filter(Boolean).join(", ");
  }
  return item.promotionRuleName || "";
}

function calculateBrandShippingFee(brand, baseAmount = 0) {
  if (!brand) return 0;
  if (brand.shippingPolicyType === "flat") return Number(brand.shippingFlatFee || 0);
  if (brand.shippingPolicyType === "threshold") {
    return Number(baseAmount || 0) < Number(brand.shippingThresholdAmount || 0)
      ? Number(brand.shippingThresholdFee || 0)
      : 0;
  }
  return 0;
}

// 배송비 N-미만 기준을 어느 금액으로 잴지: 기본은 제품매출(고객 기준),
// 브랜드 설정이 supply면 공급가 합계(할인 반영 후 실입금 기준, 예: 펫페이스).
function shippingThresholdBaseAmount(brand, { salesAmount = 0, supplyAmount = 0 } = {}) {
  return brand?.shippingThresholdBase === "supply" ? Number(supplyAmount || 0) : Number(salesAmount || 0);
}

function findActivePromotionRule(brandId = "", effectiveDate = "") {
  if (!brandId) return null;
  const targetDate = effectiveDate || new Date().toISOString().slice(0, 10);
  return state.promotionRules.find((item) => {
    if (item.brandId !== brandId || item.isActive === false || (item.scopeType || "all") !== "all") return false;
    const from = item.validFrom || "0000-01-01";
    const to = item.validTo || "9999-12-31";
    return from <= targetDate && targetDate <= to;
  }) || null;
}

function normalizeItemKey(itemCode, itemName) {
  return `${String(itemCode || "").trim().toLowerCase()}::${String(itemName || "").trim().toLowerCase()}`;
}

function buildPromotionPreview(brand, lineItems = [], effectiveDate = "", manualRuleId = "") {
  if (!brand?.id) return null;
  const targetDate = effectiveDate || new Date().toISOString().slice(0, 10);
  const activeRules = state.promotionRules.filter((item) => {
    if (item.brandId !== brand.id || item.isActive === false) return false;
    const from = item.validFrom || "0000-01-01";
    const to = item.validTo || "9999-12-31";
    return from <= targetDate && targetDate <= to;
  }).sort((a, b) => {
    if ((a.scopeType || "all") !== (b.scopeType || "all")) return (a.scopeType || "all") === "items" ? -1 : 1;
    return (b.validFrom || "").localeCompare(a.validFrom || "");
  });
  // Price-discount rules are pick-only (never auto-apply); baseline rules keep auto behavior.
  const autoRules = activeRules.filter((item) => !(Number(item.discountValue || 0) > 0));
  const allRule = autoRules.find((item) => (item.scopeType || "all") === "all") || null;
  const itemRules = autoRules.filter((item) => (item.scopeType || "all") === "items");
  const salesLines = lineItems.filter((item) => Number(item.totalSaleAmount || 0) > 0);
  if (!salesLines.length) {
    // No per-line breakdown — this is the whole-request "적용 프로모션" picker.
    // A manual pick overrides the date-active guess regardless of period, as
    // long as an admin hasn't turned the rule off.
    const manualRule = manualRuleId
      ? state.promotionRules.find((item) => item.id === manualRuleId && item.brandId === brand.id && item.isActive !== false)
      : null;
    const rule = manualRule || allRule;
    return rule ? {
      primaryRule: rule,
      name: rule.name,
      commissionRate: Number(rule.commissionRate ?? brand.commissionRate ?? 0),
      commissionAmount: null,
      discountValueType: rule.discountValueType || "",
      discountValue: Number(rule.discountValue || 0)
    } : null;
  }
  // Explicit per-line picks may name a rule whose period already ended (a late
  // deposit request being corrected after the fact) — resolve those against all
  // of the brand's rules, not just activeRules. Auto-matching above stays
  // restricted to activeRules so an expired rule never re-attaches on its own.
  const explicitLookupRules = state.promotionRules.filter(
    (item) => item.brandId === brand.id && item.isActive !== false
  );
  const rulesById = new Map(explicitLookupRules.map((rule) => [rule.id, rule]));
  let salesTotal = 0;
  let commissionTotal = 0;
  let discountTotal = 0;
  const applied = [];
  const seen = new Set();
  for (const line of salesLines) {
    const sales = Number(line.totalSaleAmount || 0);
    salesTotal += sales;
    // Priority: explicit per-line pick (ignores targetItems) > auto-match > all-rule.
    const key = normalizeItemKey(line.itemCode, line.itemName);
    const explicitRule = line.promotionRuleId ? rulesById.get(line.promotionRuleId) || null : null;
    const matchedItemRule = explicitRule || itemRules.find((rule) => (rule.targetItems || []).some((target) => normalizeItemKey(target.itemCode, target.itemName) === key)) || null;
    const rule = matchedItemRule || allRule;
    const lineDiscount = previewDiscountAmount(rule, sales);
    const rate = previewRuleRate(rule, Number(brand.commissionRate || 0));
    discountTotal += lineDiscount;
    commissionTotal += Math.round(Math.max(0, sales - lineDiscount) * (rate / 100));
    if (rule && !seen.has(rule.id)) {
      seen.add(rule.id);
      applied.push(rule);
    }
  }
  const netSalesTotal = Math.max(0, salesTotal - discountTotal);
  return {
    primaryRule: applied.length === 1 ? applied[0] : null,
    name: applied.length === 1 ? applied[0].name : applied.length > 1 ? `품목별 프로모션 ${applied.length}건` : "",
    commissionRate: netSalesTotal > 0 ? Number(((commissionTotal / netSalesTotal) * 100).toFixed(2)) : Number(brand.commissionRate || 0),
    commissionAmount: commissionTotal,
    discountAmount: discountTotal,
    discountValueType: allRule?.discountValueType || "",
    discountValue: allRule ? Number(allRule.discountValue || 0) : 0,
    appliedRules: applied
  };
}

// Client mirrors of server effectiveRuleRate / computeDiscountAmount.
function previewRuleRate(rule, brandRate) {
  if (!rule) return brandRate;
  if (rule.commissionRate === null || rule.commissionRate === undefined || rule.commissionRate === "") return brandRate;
  return Number(rule.commissionRate) || 0;
}
function previewDiscountAmount(rule, sales) {
  if (!rule) return 0;
  const value = Number(rule.discountValue || 0);
  if (!value) return 0;
  if (rule.discountValueType === "percent") return Math.round((Number(sales || 0) * value) / 100);
  if (rule.discountValueType === "fixed") return Math.min(value, Number(sales || 0));
  return 0;
}

function describeShippingRule(brand = {}) {
  if (brand.shippingPolicyType === "flat") return brand.shippingFlatFee ? `무조건 ${money.format(Number(brand.shippingFlatFee))}원` : "무조건 0원";
  if (brand.shippingPolicyType === "threshold") {
    const base = brand.shippingThresholdBase === "supply" ? "공급가" : "제품매출";
    return `${base} ${money.format(Number(brand.shippingThresholdAmount || 0))}원 미만 ${money.format(Number(brand.shippingThresholdFee || 0))}원`;
  }
  return "무료배송";
}

function promotionRuleStatusLabel(item) {
  const today = new Date().toISOString().slice(0, 10);
  if (item.isActive === false) return "중지";
  if (item.validTo && item.validTo < today) return "만료";
  if (item.validFrom && item.validFrom > today) return "예정";
  return "적용중";
}

function normalizeSearchText(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function makePriceKey(item) {
  return `${String(item?.itemCode || "").trim().toLowerCase()}::${String(item?.itemName || "").trim().toLowerCase()}`;
}

function isAliasActive(alias, effectiveDate = "") {
  const targetDate = effectiveDate || new Date().toISOString().slice(0, 10);
  const from = alias.validFrom || "0000-01-01";
  const to = alias.validTo || "9999-12-31";
  return alias.isActive !== false && from <= targetDate && targetDate <= to;
}

function resolveAliasTarget(alias) {
  const entry = state.priceEntries.find((item) => item.id === alias.priceEntryId);
  if (!entry) return null;
  const key = makePriceKey(entry);
  return state.priceCatalog.find((item) => item.brandId === entry.brandId && makePriceKey(item) === key) || entry;
}

function findPriceCatalogByInput(value, brandId = "", effectiveDate = "") {
  const query = normalizeSearchText(value);
  if (!query) return null;
  const aliasMatch = state.aliasEntries.find((item) => {
    if (brandId && item.brandId !== brandId) return false;
    return isAliasActive(item, effectiveDate) && normalizeSearchText(item.aliasText || item.aliasKey) === query;
  });
  if (aliasMatch) {
    return resolveAliasTarget(aliasMatch);
  }
  return state.priceCatalog.find((item) => {
    if (brandId && item.brandId !== brandId) return false;
    const text = normalizeSearchText(`${item.itemCode || ""} ${item.itemName || ""}`);
    return text === query || normalizeSearchText(formatPriceOption(item)) === query || text.includes(query);
  }) || null;
}

function parseBulkLine(columns) {
  const safe = columns.map((value) => String(value || "").trim()).filter(Boolean);
  if (!safe.length) {
    return { itemCode: "", itemName: "", quantity: 1, searchText: "" };
  }
  if (safe.length >= 3) {
    return {
      itemCode: safe[0],
      itemName: safe[1],
      quantity: Math.max(1, Number(safe[2] || 1)),
      searchText: `${safe[0]} ${safe[1]}`.trim()
    };
  }
  if (safe.length === 2) {
    const qty = Number(safe[1]);
    if (Number.isFinite(qty)) {
      const codeLike = /[A-Za-z0-9_-]{3,}/.test(safe[0]) && !/[가-힣]/.test(safe[0]);
      return {
        itemCode: codeLike ? safe[0] : "",
        itemName: codeLike ? "" : safe[0],
        quantity: Math.max(1, qty),
        searchText: safe[0]
      };
    }
    return {
      itemCode: safe[0],
      itemName: safe[1],
      quantity: 1,
      searchText: `${safe[0]} ${safe[1]}`.trim()
    };
  }
  const codeLike = /[A-Za-z0-9_-]{3,}/.test(safe[0]) && !/[가-힣]/.test(safe[0]);
  return {
    itemCode: codeLike ? safe[0] : "",
    itemName: codeLike ? "" : safe[0],
    quantity: 1,
    searchText: safe[0]
  };
}

function cryptoRandomId() {
  return `tmp_${Math.random().toString(16).slice(2, 10)}`;
}

function bindPrices() {
  app.querySelector("[data-price-brand-filter]").addEventListener("change", (event) => {
    state.priceFilters.brandId = event.target.value;
    state.priceImportStatus = null;
    renderApp();
  });
  app.querySelector("[data-new-price-entry]").addEventListener("click", () => {
    state.editingPriceEntry = { brandId: state.priceFilters.brandId || "" };
    state.editingPriceAlias = null;
    renderApp();
  });
  app.querySelectorAll("[data-clone-price-entry]").forEach((button) => {
    button.addEventListener("click", () => {
      const source = state.priceEntries.find((item) => item.id === button.dataset.clonePriceEntry);
      state.editingPriceEntry = source ? {
        brandId: source.brandId,
        itemCode: source.itemCode,
        itemName: source.itemName,
        spec: source.spec,
        unit: source.unit,
        barcode: source.barcode,
        originalPrice: source.originalPrice ?? source.consumerPrice,
        discountPrice: source.discountPrice,
        salePrice: source.salePrice,
        supplyPrice: source.supplyPrice,
        note: source.note,
        isActive: source.isActive,
        effectiveFrom: new Date().toISOString().slice(0, 10)
      } : null;
      state.editingPriceAlias = null;
      renderApp();
    });
  });
  app.querySelectorAll("[data-edit-price-entry]").forEach((button) => {
    button.addEventListener("click", () => {
      state.editingPriceEntry = state.priceEntries.find((item) => item.id === button.dataset.editPriceEntry);
      state.editingPriceAlias = null;
      renderApp();
    });
  });
  app.querySelectorAll("[data-edit-price-alias]").forEach((button) => {
    button.addEventListener("click", () => {
      state.editingPriceAlias = state.aliasEntries.find((item) => item.id === button.dataset.editPriceAlias);
      state.editingPriceEntry = null;
      renderApp();
    });
  });
  app.querySelectorAll("[data-delete-price-entry]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("이 단가 이력을 삭제할까요?")) return;
      await api(`/api/price-entries/${button.dataset.deletePriceEntry}`, { method: "DELETE" });
      state.editingPriceEntry = null;
      await refreshAndRender();
    });
  });
  app.querySelectorAll("[data-delete-price-alias]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("이 기간 별칭을 삭제할까요?")) return;
      await api(`/api/price-aliases/${button.dataset.deletePriceAlias}`, { method: "DELETE" });
      await refreshAndRender();
    });
  });
  app.querySelector("[data-download-price-template]")?.addEventListener("click", () => {
    if (!state.priceFilters.brandId) {
      state.priceImportStatus = { kind: "error", text: "브랜드를 먼저 선택하세요." };
      renderApp();
      return;
    }
    location.href = `/api/price-entries/template?brandId=${encodeURIComponent(state.priceFilters.brandId)}`;
  });
  app.querySelector("[data-upload-price-template]")?.addEventListener("click", async () => {
    const fileInput = app.querySelector("[data-price-import-file]");
    const file = fileInput?.files?.[0];
    if (!state.priceFilters.brandId) {
      state.priceImportStatus = { kind: "error", text: "브랜드를 먼저 선택하세요." };
      renderApp();
      return;
    }
    if (!file) {
      state.priceImportStatus = { kind: "error", text: "업로드할 Excel 파일을 선택하세요." };
      renderApp();
      return;
    }
    try {
      const fileBase64 = await readFileAsBase64(file);
      const response = await api("/api/price-entries/import", {
        method: "POST",
        body: {
          brandId: state.priceFilters.brandId,
          fileName: file.name,
          fileBase64
        }
      });
      const result = response.result || {};
      state.priceImportStatus = {
        kind: "ok",
        text: `반영 완료: 신규 ${result.created || 0}건, 수정 ${result.updated || 0}건, 개정 ${result.revised || 0}건, 삭제 ${result.deleted || 0}건`
      };
      state.editingPriceEntry = null;
      state.editingPriceAlias = null;
      await refreshAndRender();
    } catch (error) {
      state.priceImportStatus = {
        kind: "error",
        text: error.message || "Excel 업로드 반영에 실패했습니다.",
        details: Array.isArray(error.details) ? error.details : []
      };
      renderApp();
    } finally {
      if (fileInput) fileInput.value = "";
    }
  });
  app.querySelector("[data-price-entry-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = formObject(event.currentTarget);
    body.isActive = body.isActive === "true";
    if (state.editingPriceEntry?.id) {
      await api(`/api/price-entries/${state.editingPriceEntry.id}`, { method: "PUT", body });
    } else {
      await api("/api/price-entries", { method: "POST", body });
    }
    state.editingPriceEntry = null;
    await refreshAndRender();
  });
  app.querySelector("[data-price-alias-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.editingPriceAlias) return;
    const body = formObject(event.currentTarget);
    body.isActive = body.isActive === "true";
    await api(`/api/price-aliases/${state.editingPriceAlias.id}`, { method: "PUT", body });
    state.editingPriceAlias = null;
    await refreshAndRender();
  });
  app.querySelector("[data-cancel-price-entry]")?.addEventListener("click", () => {
    state.editingPriceEntry = null;
    renderApp();
  });
  app.querySelector("[data-cancel-price-alias]")?.addEventListener("click", () => {
    state.editingPriceAlias = null;
    renderApp();
  });
}

function bindBrands() {
  bindShipSettings();
  bindSearchInput("[data-brand-filter-q]", (value) => {
    state.brandFilterQ = value;
  });
  if (!state.brandActivity && !state.brandActivityLoading) {
    state.brandActivityLoading = true;
    api("/api/brands/activity").then((r) => { state.brandActivity = r; }).catch(() => { state.brandActivity = { dormant: [], lastRequest: {} }; })
      .finally(() => { state.brandActivityLoading = false; renderApp(); });
  }
  app.querySelectorAll("[data-brand-dormant]").forEach((b) => b.addEventListener("click", () => { state.brandDormantFilter = b.dataset.brandDormant; renderApp(); }));
  app.querySelector("[data-brand-entity]")?.addEventListener("click", (e) => { const id = e.currentTarget.dataset.brandEntity; goTrade("partners"); openPartnerHub(id); });
  app.querySelector("[data-brand-info-upload]")?.addEventListener("click", () => app.querySelector("[data-brand-info-file]")?.click());
  app.querySelector("[data-brand-info-file]")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fileBase64 = await new Promise((ok, bad) => { const r = new FileReader(); r.onload = () => ok(String(r.result)); r.onerror = bad; r.readAsDataURL(file); });
    try {
      const r = await api("/api/brands/info-upload", { method: "POST", body: { fileBase64, fileName: file.name } });
      showToast(`응답 ${r.responses}곳을 읽어 ${r.filled}곳의 빈 정보를 채웠습니다. 값이 다른 ${r.conflicts}곳·새 브랜드 ${r.newBrands}곳은 '확인 필요'에서 확인하세요.`);
      state.brands = (await api("/api/brands")).brands || state.brands;
      renderApp();
    } catch (error) { showToast(error.message || "올리지 못했습니다.", "error"); }
  });
  app.querySelector("[data-new-brand]")?.addEventListener("click", () => {
    state.editingBrand = null;
    state.editingPromotionRule = null;
    renderApp();
  });
  app.querySelectorAll("[data-edit-brand]").forEach((button) => {
    button.addEventListener("click", () => {
      state.editingBrand = state.brands.find((item) => item.id === button.dataset.editBrand);
      state.editingPromotionRule = null;
      renderApp();
    });
  });
  app.querySelectorAll("[data-edit-promotion-rule]").forEach((button) => {
    button.addEventListener("click", () => {
      state.editingPromotionRule = state.promotionRules.find((item) => item.id === button.dataset.editPromotionRule);
      renderApp();
    });
  });
  app.querySelectorAll("[data-delete-promotion-rule]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("이 프로모션 수수료 규칙을 삭제할까요?")) return;
      await api(`/api/promotion-rules/${button.dataset.deletePromotionRule}`, { method: "DELETE" });
      state.editingPromotionRule = null;
      if (isBrandPopup) {
        const brandId = state.editingBrand?.id || "";
        window.opener?.postMessage({ type: "brandSaved", brandId }, location.origin);
        showToast("프로모션 규칙 삭제 완료");
        await loadAll();
        state.editingBrand = state.brands.find((b) => b.id === brandId) || state.editingBrand;
        renderApp();
        return;
      }
      await refreshAndRender();
    });
  });
  app.querySelectorAll("[data-delete-brand]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("브랜드를 삭제할까요? 연결된 요청은 브랜드 연결만 해제됩니다.")) return;
      await api(`/api/brands/${button.dataset.deleteBrand}`, { method: "DELETE" });
      await refreshAndRender();
    });
  });
  app.querySelector("[data-brand-transfer-account]")?.addEventListener("change", (event) => {
    const account = (state.transferAccounts || []).find((a) => a.id === event.target.value);
    if (!account) return;
    const form = event.target.closest("[data-brand-form]");
    const set = (name, value) => { const el = form?.querySelector(`[name='${name}']`); if (el) el.value = value; };
    set("bankName", account.bankName);
    set("bankAccount", account.accountNumber);
    if (account.holder) set("depositorName", account.holder);
  });
  // 목록에서 계좌를 고른 동안은 은행·계좌번호를 손으로 못 고치게 한다 — 저장하면
  // 서버가 고른 계좌 값으로 맞추므로, 입력해도 사라진다.
  const lockBankFields = () => {
    const form = app.querySelector("[data-brand-form]");
    const picked = Boolean(form?.querySelector("[data-brand-transfer-account]")?.value);
    for (const name of ["bankName", "bankAccount"]) {
      const el = form?.querySelector(`[name='${name}']`);
      if (el) el.readOnly = picked;
    }
  };
  lockBankFields();
  app.querySelector("[data-brand-transfer-account]")?.addEventListener("change", lockBankFields);
  app.querySelector("[data-brand-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = formObject(event.currentTarget);
    body.isActive = body.isActive === "true";
    body.hasReceivable = body.hasReceivable === "true";
    body.payAfterShipping = body.payAfterShipping === "true";
    // 체크 해제된 체크박스는 FormData에 아예 담기지 않는다 -- 폼에서 직접
    // 읽지 않으면 "끄기"가 저장되지 않는다.
    body.autoCreateRequests = Boolean(
      event.currentTarget.querySelector("[name=autoCreateRequests]")?.checked
    );
    body.starred = false;
    let savedId = state.editingBrand?.id || "";
    if (state.editingBrand) {
      await api(`/api/brands/${state.editingBrand.id}`, { method: "PUT", body });
    } else {
      const created = await api("/api/brands", { method: "POST", body });
      savedId = created?.brand?.id || savedId;
    }
    if (isBrandPopup) {
      window.opener?.postMessage({ type: "brandSaved", brandId: savedId }, location.origin);
      showToast("브랜드 정보 수정 완료");
      setTimeout(() => window.close(), 700);
      return;
    }
    state.editingBrand = null;
    await refreshAndRender();
  });
  // 과거 버전을 고쳐야 하는 경우가 실제로 있다 — 계약이 바뀐 뒤에야 이력 기능을
  // 쓰기 시작하면, 지금 저장된 값은 새 계약이고 옛 계약은 어디에도 없다.
  // 행의 값을 폼에 실어주고 시작일을 그 버전 날짜로 맞춰두면, 저장 시 같은
  // 날짜의 버전을 덮어쓴다.
  app.querySelectorAll("[data-edit-brand-rule]").forEach((button) => {
    button.addEventListener("click", () => {
      const rule = (state.editingBrand?.ruleHistory || []).find((item) => item.id === button.dataset.editBrandRule);
      if (!rule) return;
      const form = app.querySelector("[data-brand-form]");
      if (!form) return;
      const set = (name, value) => {
        const input = form.querySelector(`[name='${name}']`);
        if (input) input.value = value ?? "";
      };
      set("commissionRate", rule.commissionRate);
      set("shippingPolicyType", rule.shippingPolicyType || "free");
      set("shippingFlatFee", rule.shippingFlatFee || "");
      set("shippingThresholdAmount", rule.shippingThresholdAmount || "");
      set("shippingThresholdFee", rule.shippingThresholdFee || "");
      set("shippingThresholdBase", rule.shippingThresholdBase || "sales");
      set("ruleValidFrom", rule.validFrom);
      set("ruleNote", rule.note || "");
      showToast(`${rule.validFrom} 버전을 폼에 불러왔습니다. 수정 후 저장하세요.`);
    });
  });
  app.querySelectorAll("[data-remove-brand-rule]").forEach((button) => {
    button.addEventListener("click", async () => {
      const brandId = state.editingBrand?.id;
      if (!brandId) return;
      if (!confirm("이 계약 규칙 버전을 삭제할까요? 해당 기간의 과거 정산 결과가 달라집니다.")) return;
      try {
        const result = await api(`/api/brands/${brandId}/rules/${button.dataset.removeBrandRule}`, { method: "DELETE" });
        state.editingBrand = result.brand;
        await loadAll();
        showToast("규칙 버전을 삭제했습니다.");
        renderApp();
      } catch (error) {
        showToast(error.message || "규칙 삭제 실패", "error");
      }
    });
  });
  app.querySelector("[data-brand-form] [name='hasReceivable']")?.addEventListener("change", (event) => {
    const wrap = app.querySelector("[data-brand-receivable-fields]");
    const enabled = event.target.value === "true";
    if (wrap) wrap.style.display = enabled ? "" : "none";
    const input = app.querySelector("[data-brand-form] [name='receivableTotal']");
    if (input) {
      if (!enabled) input.value = "";
    }
  });
  app.querySelector("[data-promotion-rule-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = formObject(event.currentTarget);
    body.isActive = body.isActive === "true";
    try {
      if (state.editingPromotionRule) {
        await api(`/api/promotion-rules/${state.editingPromotionRule.id}`, { method: "PUT", body });
      } else {
        await api("/api/promotion-rules", { method: "POST", body });
      }
    } catch (error) {
      // Surface the server reason (e.g. overlap conflict) instead of failing silently.
      showToast(error.message || "프로모션 규칙 저장에 실패했습니다.", "error");
      return;
    }
    state.editingPromotionRule = null;
    if (isBrandPopup) {
      const brandId = state.editingBrand?.id || "";
      window.opener?.postMessage({ type: "brandSaved", brandId }, location.origin);
      showToast("프로모션 규칙 저장 완료");
      await loadAll();
      state.editingBrand = state.brands.find((b) => b.id === brandId) || state.editingBrand;
      renderApp();
      return;
    }
    showToast("프로모션 규칙 저장 완료");
    await refreshAndRender();
  });
  const promotionForm = app.querySelector("[data-promotion-rule-form]");
  if (promotionForm) {
    const targetWrap = promotionForm.querySelector("[data-promotion-target-wrap]");
    const targetInput = promotionForm.querySelector("[name='targetItems']");
    const targetSearch = promotionForm.querySelector("[name='promotionTargetSearch']");
    const readTargets = () => {
      try {
        const parsed = JSON.parse(targetInput?.value || "[]");
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    };
    const writeTargets = (items) => {
      if (targetInput) targetInput.value = JSON.stringify(items);
      const list = promotionForm.querySelector("[data-promotion-target-list]");
      if (list) list.innerHTML = renderPromotionTargetList(items);
      promotionForm.querySelectorAll("[data-remove-promotion-target]").forEach((button) => {
        button.addEventListener("click", () => {
          const next = readTargets().filter((_, index) => index !== Number(button.dataset.removePromotionTarget));
          writeTargets(next);
        });
      });
    };
    writeTargets(readTargets());
    promotionForm.querySelector("[name='scopeType']")?.addEventListener("change", (event) => {
      if (targetWrap) targetWrap.style.display = event.target.value === "items" ? "" : "none";
    });
    promotionForm.querySelector("[name='brandId']")?.addEventListener("change", () => {
      state.editingPromotionRule = { ...formObject(promotionForm), isActive: formObject(promotionForm).isActive === "true" };
      renderApp();
    });
    promotionForm.querySelector("[data-add-promotion-target]")?.addEventListener("click", () => {
      const brandId = promotionForm.querySelector("[name='brandId']")?.value || "";
      const priceItem = findPriceCatalogByInput(targetSearch?.value || "", brandId);
      if (!priceItem) return;
      const targets = readTargets();
      const exists = targets.some((item) => normalizeItemKey(item.itemCode, item.itemName) === normalizeItemKey(priceItem.itemCode, priceItem.itemName));
      if (exists) return;
      targets.push({
        itemCode: priceItem.itemCode,
        itemName: priceItem.itemName,
        label: formatPromotionTargetLabel(priceItem)
      });
      writeTargets(targets);
      if (targetSearch) targetSearch.value = "";
    });
  }
  app.querySelector("[data-cancel-edit]")?.addEventListener("click", () => {
    state.editingBrand = null;
    renderApp();
  });
  app.querySelector("[data-cancel-promotion-rule]")?.addEventListener("click", () => {
    state.editingPromotionRule = null;
    renderApp();
  });
}

function filteredPartners() {
  const pr = state.procurement;
  const role = pr.partnerFilterCategory || "";
  const status = pr.partnerStatus || "active";
  const q = String(pr.partnerSearch || "").trim().toLowerCase();
  return (state.partners || []).filter((item) => (role === "issuer" ? isIssuer(item) : (!role || partnerRoles(item).includes(role)) && (role || !isIssuer(item)))
    && (status === "all" || (status === "active" ? item.isActive !== false : item.isActive === false))
    && (!q || [item.name, item.businessName, item.businessNumber, item.code, item.note, item.notionCategory, ...(item.aliases || [])].some((v) => String(v || "").toLowerCase().includes(q))))
    .sort((a, b) => String(b.notion?.last || "").localeCompare(String(a.notion?.last || "")) || String(a.name).localeCompare(String(b.name), "ko"));
}

// 문서에서 거래처 고르기: 발행자는 구분으로, 나머지는 1차 분류 태그로(여러 개 가능) 거른다. 보관 거래처는 빼고.
function partnersByCategory(category) {
  return (state.partners || []).filter((item) => item.isActive !== false
    && (category === "issuer" ? isIssuer(item) : !isIssuer(item) && (partnerRoles(item).includes(category) || item.category === category)));
}

function productionPartners() {
  return partnersByCategory("production");
}

function issuerPartners() {
  return partnersByCategory("issuer");
}

// 현재 선택된 거래처가 사용 안 함으로 전환됐어도 옵션 목록에서 사라지면 안 된다 —
// 폼을 그대로 저장하면 partnerId가 빈 값으로 날아가 기존 연결이 끊긴다.
function partnerSelectOptions(selectedPartnerId, category = "production") {
  const active = partnersByCategory(category);
  const options = active.map((p) => `<option value="${p.id}" ${selectedPartnerId === p.id ? "selected" : ""}>${h(p.name)}</option>`);
  if (selectedPartnerId && !active.some((p) => p.id === selectedPartnerId)) {
    const inactive = (state.partners || []).find((p) => p.id === selectedPartnerId);
    if (inactive) {
      options.push(`<option value="${inactive.id}" selected>${h(inactive.name)} (사용 안 함)</option>`);
    }
  }
  return options;
}

// 목록 화면의 "새 창으로 입력" 버튼과 각 행의 "새 창" 수정 버튼이 공통으로
// 쓰는 열기 함수. 같은 kind는 같은 창 이름을 써서, 이미 떠 있으면 그 창을
// 다시 쓰고 새로 겹쳐 띄우지 않는다.
function openProcurementPopup(kind, recordId = "") {
  const query = recordId
    ? `/?procurement-popup=${kind}&record-id=${encodeURIComponent(recordId)}`
    : `/?procurement-popup=${kind}`;
  const popup = window.open(query, `wooofpay-${kind}`, "width=720,height=900,resizable=yes,scrollbars=yes");
  popup?.focus();
}

function bindProcurementPopupButtons(kind) {
  app.querySelector(`[data-open-procurement-popup="${kind}"]`)?.addEventListener("click", () => {
    openProcurementPopup(kind);
  });
  app.querySelectorAll(`[data-edit-procurement-popup="${kind}"]`).forEach((button) => {
    button.addEventListener("click", () => {
      openProcurementPopup(kind, button.dataset.recordId);
    });
  });
}

// 거래처/원부자재/납품지 세 목록 화면이 똑같은 "엑셀 다운로드 / 엑셀 업로드"
// 도구를 쓴다 -- prefix로 어느 화면의 상태(importStatus)인지 가른다.
function renderBulkExcelTools(prefix, exportUrl) {
  const status = state.procurement.importStatus;
  const showStatus = status && status.prefix === prefix;
  return `
    <details class="menu-pop"><summary class="button">엑셀<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></summary>
      <div class="menu-list">
        <button type="button" class="menu-item" data-template-download-open="${prefix}">양식 내려받기</button>
        <button type="button" class="menu-item" data-bulk-import-trigger="${prefix}">엑셀로 한꺼번에 올리기</button>
      </div>
    </details>
    <input type="file" data-bulk-import-file="${prefix}" accept=".xlsx" style="display:none">
    ${showStatus ? `
      <div class="notice ${status.kind === "error" ? "notice-danger" : "notice-info"} list-actions-status">
        ${h(status.text)}
        ${(status.details || []).length ? `<br>${status.details.slice(0, 20).map((d) => h(`${d.row}행: ${d.reason}`)).join("<br>")}` : ""}
        ${(status.details || []).length > 20 ? `<br>...외 ${status.details.length - 20}건` : ""}
      </div>` : ""}
    ${state.procurement.templateDownloadFor === prefix ? renderTemplateDownloadDialog(prefix, exportUrl) : ""}
  `;
}

// 「양식다운로드」를 누르면 뜨는 선택 창. 두 파일은 열 구성이 같고 내용만
// 다르다 -- 그래서 현재 양식 파일을 받아 고친 뒤 그대로 올리면, 같은 ID의
// 행은 수정으로, ID가 빈 행은 신규로 들어간다.
function renderTemplateDownloadDialog(prefix, exportUrl) {
  return `
    <div class="po-preview-overlay" data-template-dialog-overlay="${prefix}">
      <div class="po-preview-modal" style="max-width:520px">
        <div class="po-preview-toolbar">
          <strong>양식 다운로드</strong>
          <div><button type="button" data-template-dialog-close>닫기</button></div>
        </div>
        <div style="padding:20px 22px 24px">
          <p class="muted" style="margin:0 0 14px;line-height:1.6">
            두 파일의 열 구성은 같습니다. 받은 파일에서 <strong>바꿀 값만 고쳐 그대로 올리면</strong>,
            ID가 같은 행은 수정되고 손대지 않은 행은 그대로 유지됩니다.
            ID가 빈 행은 새로 등록됩니다. (업로드는 xlsx 파일만 받습니다)
          </p>
          <div class="toolbar" style="flex-direction:column;align-items:stretch;gap:10px">
            <a href="${exportUrl}?mode=blank" data-template-dialog-pick>
              <button class="primary" type="button" style="width:100%">신규 파일 받기</button>
            </a>
            <span class="muted" style="margin:-4px 0 6px">머리글만 있는 빈 양식 — 새로 한꺼번에 등록할 때</span>
            <a href="${exportUrl}" data-template-dialog-pick>
              <button type="button" style="width:100%">현재 양식 파일 받기</button>
            </a>
            <span class="muted" style="margin-top:-4px">지금 등록된 내용이 모두 채워진 파일 — 기존 건을 고칠 때</span>
          </div>
        </div>
      </div>
    </div>`;
}

function bindBulkExcelTools(prefix, importUrl) {
  app.querySelector(`[data-template-download-open="${prefix}"]`)?.addEventListener("click", () => {
    state.procurement.templateDownloadFor = prefix;
    renderApp();
  });
  const closeTemplateDialog = () => {
    state.procurement.templateDownloadFor = null;
    renderApp();
  };
  app.querySelector("[data-template-dialog-close]")?.addEventListener("click", closeTemplateDialog);
  // 파일을 고르면 그대로 내려받고 창은 닫는다. 링크 기본 동작(다운로드)을
  // 막으면 안 되므로 닫기만 다음 틱으로 미룬다.
  app.querySelectorAll("[data-template-dialog-pick]").forEach((link) => {
    link.addEventListener("click", () => setTimeout(closeTemplateDialog, 0));
  });
  app.querySelector(`[data-template-dialog-overlay="${prefix}"]`)?.addEventListener("click", (event) => {
    if (event.target.dataset.templateDialogOverlay !== undefined) closeTemplateDialog();
  });
  app.querySelector(`[data-bulk-import-trigger="${prefix}"]`)?.addEventListener("click", () => {
    app.querySelector(`[data-bulk-import-file="${prefix}"]`)?.click();
  });
  app.querySelector(`[data-bulk-import-file="${prefix}"]`)?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const fileBase64 = await readFileAsBase64(file);
      const response = await api(importUrl, { method: "POST", body: { fileName: file.name, fileBase64 } });
      const result = response.result || {};
      const skipped = result.skipped || [];
      state.procurement.importStatus = {
        prefix,
        kind: skipped.length ? "error" : "ok",
        text: `반영 완료: 생성 ${result.created || 0}건, 수정 ${result.updated || 0}건${skipped.length ? `, 건너뜀 ${skipped.length}건` : ""}`,
        details: skipped
      };
      await refreshAndRender();
    } catch (error) {
      state.procurement.importStatus = { prefix, kind: "error", text: error.message || "엑셀 업로드에 실패했습니다." };
      renderApp();
    } finally {
      event.target.value = "";
    }
  });
}

// 양식에 맞는 분류를 먼저 보여주되(발주서->생산업체, 나머지->판매납품처)
// 다른 분류도 고를 수 있게 그룹으로 나눠 전부 싣는다.
function partnerSelectOptionsForDoc(selectedPartnerId, defaultCategory) {
  const groups = [defaultCategory]
    .concat(Object.keys(PARTNER_ROLE_LABELS).filter((key) => key !== defaultCategory));
  const seen = new Set();
  const options = groups.map((category) => {
    const rows = partnersByCategory(category).filter((p) => !seen.has(p.id) && seen.add(p.id));
    if (!rows.length) return "";
    const items = rows
      .map((p) => `<option value="${p.id}" ${selectedPartnerId === p.id ? "selected" : ""}>${h(p.name)}</option>`)
      .join("");
    return `<optgroup label="${h(PARTNER_ROLE_LABELS[category] || PARTNER_CATEGORY_LABELS[category] || category)}">${items}</optgroup>`;
  });
  // 사용 안 함으로 바뀐 거래처를 고른 문서를 열었을 때 선택이 풀리면 안 된다.
  const known = new Set(groups.flatMap((c) => partnersByCategory(c).map((p) => p.id)));
  if (selectedPartnerId && !known.has(selectedPartnerId)) {
    const inactive = (state.partners || []).find((p) => p.id === selectedPartnerId);
    if (inactive) options.push(`<option value="${inactive.id}" selected>${h(inactive.name)} (사용 안 함)</option>`);
  }
  return options;
}

function renderProcurement() {
  const p = state.procurement;
  // 화면 이동(거래처관리/원부자재관리/…)은 좌측 사이드바로 옮겼다. 여기
  // 가로 탭 자리는 이제 화면별 분류 탭 — 거래처관리에서는 거래처 분류를
  // 고르는 자리로 쓴다.
  let body = "";
  if (p.screen === "materials") body = renderMaterials();
  else if (p.screen === "deliveryPlaces") body = renderDeliveryPlaces();
  else if (p.screen === "accounts") body = renderTransferAccounts();
  else if (p.screen === "orders") body = renderPurchaseOrders();
  else body = renderPartners();
  return `
    ${pageHead(state.tab === "trade" ? "거래" : "거래관리", "생산업체·판매납품처·매입공급처 거래처와 발주서를 관리합니다.")}
    ${p.screen === "partners" ? renderPartnerCategoryTabs() : ""}
    ${body}
    ${state.partnerHub ? v2Modal(renderPartnerHub(), "data-hub-close") : ""}
  `;
}

// 역할 탭 + 활성/보관 + 검색(예전 이름·노션 분류까지).
function renderPartnerCategoryTabs() {
  const pr = state.procurement;
  const current = pr.partnerFilterCategory || "";
  const status = pr.partnerStatus || "active";
  const pool = (state.partners || []).filter((x) => status === "all" || (status === "active" ? x.isActive !== false : x.isActive === false));
  const counts = {};
  for (const p of pool) for (const r of partnerRoles(p)) counts[r] = (counts[r] || 0) + 1;
  const tabs = [["", "거래처 전체", pool.filter((x) => !isIssuer(x)).length], ...Object.entries(PARTNER_ROLE_LABELS).map(([k, l]) => [k, l, counts[k] || 0]), ["issuer", "발행자(자사)", pool.filter(isIssuer).length]];
  const active = (state.partners || []).filter((x) => x.isActive !== false).length;
  return `
    <div class="npb-subnav" style="flex-wrap:wrap">
      ${[["active", "활성", active], ["archived", "보관", (state.partners || []).length - active], ["all", "전체", (state.partners || []).length]].map(([k, l, n]) => `<button data-partner-status="${k}" class="npb-subtab ${status === k ? "active" : ""}">${l} <span class="muted">${n}</span></button>`).join("")}
      <span class="chip-divider" aria-hidden="true"></span>
      ${tabs.map(([key, label, count]) => `<button data-partner-category-tab="${key}" class="npb-subtab ${current === key ? "active" : ""}">${label} <span class="muted">${count}</span></button>`).join("")}
      <input data-partner-search placeholder="이름·예전 이름·사업자번호 검색" value="${h(pr.partnerSearch || "")}" style="margin-left:auto;min-width:220px">
    </div>`;
}

function bindProcurement() {
  bindPartnerHub();
  app.querySelectorAll("[data-partner-category-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.procurement.partnerFilterCategory = btn.dataset.partnerCategoryTab;
      renderApp();
    });
  });
  app.querySelectorAll("[data-partner-status]").forEach((btn) => btn.addEventListener("click", () => { state.procurement.partnerStatus = btn.dataset.partnerStatus; renderApp(); }));
  bindSearchInput("[data-partner-search]", (v) => { state.procurement.partnerSearch = v; });
  if (state.procurement.screen === "materials") bindMaterials();
  else if (state.procurement.screen === "deliveryPlaces") bindDeliveryPlaces();
  else if (state.procurement.screen === "accounts") bindTransferAccounts();
  else if (state.procurement.screen === "orders") bindPurchaseOrders();
  else bindPartners();
}

function renderPartners() {
  if (!state.partnerOptions) ensurePartnerOptions();
  const rows = filteredPartners();
  return `
    <section class="layout">
      <div class="panel">
        <div class="panel-head"><h2>거래처 목록</h2><span class="muted">${money.format(rows.length)}개</span></div>
        <div class="panel-body list-actions">
          <button class="primary" data-new-partner>새 거래처</button>
          <button type="button" data-open-procurement-popup="partner">새 창으로 입력</button>
          ${renderBulkExcelTools("partner", "/api/partners/export")}
        </div>
        <div class="table-wrap">
          <table class="partners-table">
            <thead><tr><th>거래처명</th><th>상호명</th><th>담당자</th><th>발주방식</th><th>계좌</th><th>작업</th></tr></thead>
            <tbody>${rows.map(renderPartnerRow).join("") || `<tr><td colspan="6" class="empty">등록된 거래처가 없습니다.</td></tr>`}</tbody>
          </table>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>${state.procurement.editingPartner ? "거래처 수정" : "거래처 입력"}</h2></div>
        <div class="panel-body">${renderPartnerForm()}</div>
      </div>
    </section>
  `;
}

// ===========================================================================
// v2 거래처(사업자) 허브 — 한 사업자와 이어진 브랜드·명세서·판매·생산비·지급·판매처·원부자재·회생채권
// ===========================================================================
const HUB_TABS = [["overview", "개요"], ["brands", "브랜드"], ["docs", "명세서·발주서"], ["sales", "판매 주문"], ["production", "생산비"], ["payments", "지급요청"], ["links", "판매처·원부자재"]];
function renderPartnerHub() {
  const hub = state.partnerHub;
  const d = hub?.data;
  if (!d) return `<div class="panel-head"><h2>거래처</h2><button data-hub-close>닫기</button></div><div class="panel-body"><p class="muted">불러오는 중…</p></div>`;
  const p = d.partner;
  const count = { brands: d.brands.length, docs: d.docs.length, sales: d.salesOrders.length, production: d.production ? 1 : 0, payments: d.payments.length, links: d.channels.length + d.materials.length };
  const tab = hub.tab || "overview";
  const row = (cells, attrs = "") => `<tr ${attrs}>${cells.map((c) => `<td${c.num ? ' class="num"' : c.wrap ? ' class="wrap"' : ""}>${c.v}</td>`).join("")}</tr>`;
  let body = "";
  if (tab === "overview") {
    const kv = [["분류", partnerTagText(p) + (p.isActive === false ? " (보관)" : "")], ["검색 태그", (p.aliases || []).join(", ")],
      ["사업자명", p.businessName], ["사업자등록번호", formatBizNo(p.businessNumber)], ["사업자상 대표명", p.representativeName], ["사업자등록 주소", p.address],
      ["전자세금계산서 수취용 이메일", p.invoiceEmail], ["결제계좌 방식", p.payoutAccountType === "virtual" ? "가상계좌(매번 다름)" : ""],
      ["결제정보", [p.bankName, p.bankAccount, p.depositorName].filter(Boolean).join(" ")], ["발주방식", p.orderMethod], ["증빙구분", p.invoiceTiming],
      ["금액 계산 방식", p.priceMode === "gross" ? "부가세 포함" : p.priceMode ? "부가세 별도" : ""],
      ["담당자", [p.contactName, p.contactPhone, p.contactEmail].filter(Boolean).join(" · ")], ["노션 분류", p.notionCategory], ["메모", p.note]].filter(([, v]) => v);
    const bal = d.balance || {};
    const tile = (label, v, sub = "") => `<div class="stat"><span>${label}</span><strong>${money.format(Math.round(v || 0))}원</strong>${sub ? `<small class="muted">${sub}</small>` : ""}</div>`;
    body = `<div class="stats hub-balance">
        ${tile("받을 돈 (판매 미수)", bal.receivable, bal.receivableOverdue ? `<span class="danger-text">기한 지남 ${money.format(bal.receivableOverdue)}원</span>` : "")}
        ${tile("줄 돈 (생산비 미지급)", bal.productionUnpaid)}
        ${tile("처리 전 지급요청", bal.openPayments, bal.openPaymentCount ? `${bal.openPaymentCount}건` : "")}
        ${bal.brandClaims ? tile("브랜드 채권잔액", bal.brandClaims) : ""}
      </div>
      <table class="kv compact"><tbody>${kv.map(([k, v]) => `<tr><th style="text-align:left;width:130px">${k}</th><td class="wrap">${h(v)}</td></tr>`).join("")}</tbody></table>
      ${d.notion?.count ? `<p style="margin-top:10px">노션 결제 기록 <strong>${money.format(d.notion.count)}건 · ${money.format(d.notion.total)}원</strong> <span class="muted">(${h(String(d.notion.first).slice(0, 10))} ~ ${h(String(d.notion.last).slice(0, 10))})</span> <button class="small" data-hub-notion>기록 보기</button></p>` : ""}
      ${(p.notionAttachments || []).length ? `<p class="muted" style="font-size:12px">노션 첨부: ${h(p.notionAttachments.join(", "))} — 원본은 노션에 있습니다.</p>` : ""}
      ${p.hasNotionLogin ? `<p class="muted" style="font-size:12px">노션에 협력사 사이트 로그인 정보가 있습니다(ERP 로 옮기지 않음).</p>` : ""}
      ${can("procurement", "edit") ? `<div class="toolbar" style="margin-top:8px"><select data-hub-merge><option value="">이 거래처를 다른 거래처에 합치기…</option>${(d.mergeTargets || []).map((x) => `<option value="${h(x.id)}">${h(x.code ? `${x.code} · ` : "")}${h(x.name)}${x.isActive ? "" : " (보관)"}</option>`).join("")}</select></div>` : ""}
      ${d.rehab ? `<p class="muted" style="margin-top:10px">회생채권자: ${h(d.rehab.creditor)} · ${h(d.rehab.cat)} · 채권 ${money.format(d.rehab.total)}원 · 현금변제 ${money.format(d.rehab.cash)}원</p>` : ""}
      ${can("procurement", "edit") ? `<div class="toolbar" style="margin-top:10px"><button class="primary" data-hub-edit>정보 고치기</button></div>` : ""}`;
  } else if (tab === "brands") {
    body = `<p class="muted" style="font-size:12px">사업자와 브랜드는 다릅니다. 같은 사업자번호의 브랜드는 저절로 이어지고, 다른 것은 아래에서 직접 잇습니다.</p>
      <table class="compact" data-unit="원"><thead><tr><th>브랜드</th><th>정산유형</th><th>채권잔액</th><th>연결</th><th></th></tr></thead><tbody>
      ${d.brands.map((b) => row([{ v: `${b.code ? `<span class="code-tag">${h(b.code)}</span> ` : ""}${h(b.name)}` }, { v: h(settlementLabel(b.settlementType)) }, { v: b.hasReceivable ? money.format(b.receivableRemaining) : "", num: true },
        { v: b.linked === "manual" ? "직접 연결" : "사업자번호" }, { v: `${b.linked === "manual" ? `<button class="small" data-hub-unlink="${h(b.id)}">해제</button>` : ""}` }], `class="hub-go" data-hub-brand="${h(b.id)}"`)).join("") || `<tr><td colspan="5" class="empty">연결된 브랜드가 없습니다.</td></tr>`}
      </tbody></table>
      ${can("procurement", "edit") ? `<div class="toolbar" style="margin-top:8px"><select data-hub-link-brand><option value="">브랜드 연결하기…</option>${d.linkableBrands.map((b) => `<option value="${h(b.id)}">${h(b.code ? `${b.code} · ` : "")}${h(b.name)}</option>`).join("")}</select></div>` : ""}`;
  } else if (tab === "docs") {
    body = `<table class="compact" data-unit="원"><thead><tr><th>번호</th><th>종류</th><th>날짜</th><th>품목</th><th>합계</th></tr></thead><tbody>
      ${d.docs.map((x) => row([{ v: h(x.docNo) }, { v: h({ statement: "거래명세서", purchase: "발주서" }[x.docType] || x.docType || "") }, { v: h(x.date) }, { v: h(x.title), wrap: true }, { v: money.format(x.total || 0), num: true }], `class="hub-go" data-hub-doc="${h(x.id)}"`)).join("") || `<tr><td colspan="5" class="empty">명세서·발주서가 없습니다.</td></tr>`}</tbody></table>`;
  } else if (tab === "sales") {
    body = `<table class="compact" data-unit="원"><thead><tr><th>번호</th><th>주문일</th><th>내용</th><th>금액</th><th>남은 돈</th></tr></thead><tbody>
      ${d.salesOrders.map((x) => row([{ v: h(x.code) }, { v: h(x.date) }, { v: h(x.title), wrap: true }, { v: money.format(x.total || 0), num: true }, { v: x.remaining ? money.format(x.remaining) : "", num: true }], `class="hub-go" data-hub-sale="${h(x.id)}"`)).join("") || `<tr><td colspan="5" class="empty">판매 주문이 없습니다.</td></tr>`}</tbody></table>`;
  } else if (tab === "production") {
    const s = d.production;
    body = s ? `<p>미지급 <strong>${money.format(s.balance)}원</strong> · 청구 ${money.format(s.billed)}원 · 지급 ${money.format(s.paid)}원 · 가장 오래된 미지급 ${h(s.oldestDate || "-")}</p>
      <button class="primary" data-hub-prod>생산비 원장 열기</button>` : `<p class="muted">생산비 기록이 없습니다.</p>`;
  } else if (tab === "payments") {
    body = `<table class="compact" data-unit="원"><thead><tr><th>번호</th><th>내용</th><th>금액</th><th>상태</th><th>기한</th></tr></thead><tbody>
      ${d.payments.map((x) => row([{ v: h(x.code || "") }, { v: h(x.title), wrap: true }, { v: money.format(x.amount || 0), num: true }, { v: h(x.status) }, { v: h(x.dueDate) }])).join("") || `<tr><td colspan="5" class="empty">지급요청이 없습니다.</td></tr>`}</tbody></table>`;
  } else {
    body = `<h3>판매처(가격)</h3>${d.channels.map((c) => `<button class="ghost small" data-hub-channel="${h(c.id)}">${h(c.code)} ${h(c.name)}</button>`).join(" ") || `<p class="muted">이 거래처로 이어진 판매처가 없습니다.</p>`}
      <h3>원부자재</h3>${d.materials.map((m) => `<button class="ghost small" data-hub-material="${h(m.id)}">${h(m.code)} ${h(m.name)}</button>`).join(" ") || `<p class="muted">이 거래처의 원부자재가 없습니다.</p>`}`;
  }
  return `<div class="panel-head"><h2>${codeTag(p)}${h(p.name)}</h2><button data-hub-close>닫기</button></div>
    <div class="panel-body">
      <div class="npb-subnav">${HUB_TABS.map(([k, l]) => `<button class="npb-subtab ${tab === k ? "active" : ""}" data-hub-tab="${k}">${l}${count[k] ? ` ${count[k]}` : ""}</button>`).join("")}</div>
      ${body}
    </div>`;
}
async function openPartnerHub(id, tab = "overview") {
  state.partnerHub = { id, tab, data: null };
  renderApp();
  try { const data = await api(`/api/partners/${encodeURIComponent(id)}/hub`); if (state.partnerHub?.id === id) { state.partnerHub.data = data; renderApp(); } }
  catch (e) { showToast(e.message, "error"); state.partnerHub = null; renderApp(); }
}
// 허브에서 다른 화면으로 넘어가기
function goTrade(screen) { state.tab = "trade"; tradeState().screen = screen; state.partnerHub = null; }
function bindPartnerHub() {
  bindV2Modal();
  app.querySelectorAll("[data-partner-hub]").forEach((tr) => tr.addEventListener("click", (e) => {
    if (e.target.closest("button, a, input, select")) return;
    openPartnerHub(tr.dataset.partnerHub);
  }));
  const hub = state.partnerHub;
  if (!hub) return;
  app.querySelector("[data-hub-close]")?.addEventListener("click", () => { state.partnerHub = null; renderApp(); });
  app.querySelectorAll("[data-hub-tab]").forEach((b) => b.addEventListener("click", () => { hub.tab = b.dataset.hubTab; renderApp(); }));
  app.querySelector("[data-hub-edit]")?.addEventListener("click", () => {
    state.procurement.editingPartner = (state.partners || []).find((x) => x.id === hub.id) || null;
    state.partnerHub = null; renderApp();
  });
  app.querySelector("[data-hub-notion]")?.addEventListener("click", () => {
    const ns = notionState(); ns.partnerId = hub.id; ns.partnerName = hub.data?.partner?.name || ""; ns.q = ""; ns.data = null;
    state.partnerHub = null; state.tab = "notion"; renderApp();
  });
  app.querySelector("[data-hub-merge]")?.addEventListener("change", async (e) => {
    const intoId = e.target.value;
    if (!intoId) return;
    const into = (hub.data?.mergeTargets || []).find((x) => x.id === intoId);
    if (!confirm(`'${hub.data?.partner?.name}'의 모든 기록(브랜드·명세서·생산비·판매·지급요청·입금계좌)을 '${into?.name}'(으)로 옮기고 이 거래처를 지울까요? 이름은 '${into?.name}'의 예전 이름으로 남습니다.`)) { e.target.value = ""; return; }
    try {
      const r = await api(`/api/partners/${encodeURIComponent(hub.id)}/merge`, { method: "POST", body: { intoId } });
      showToast(`합쳤습니다: ${Object.entries(r.moved || {}).map(([k, n]) => `${k} ${n}`).join(", ") || "옮길 기록 없음"}`);
      state.partnerHub = null; await refreshAndRender(); openPartnerHub(intoId);
    } catch (err) { showToast(err.message, "error"); e.target.value = ""; }
  });
  app.querySelectorAll("[data-hub-brand]").forEach((tr) => tr.addEventListener("click", (e) => {
    if (e.target.closest("button")) return;
    state.tab = "brands"; state.editingBrand = state.brands.find((b) => b.id === tr.dataset.hubBrand) || null; state.partnerHub = null; renderApp();
  }));
  app.querySelectorAll("[data-hub-unlink]").forEach((b) => b.addEventListener("click", async () => {
    await api(`/api/partners/${encodeURIComponent(hub.id)}/brands`, { method: "POST", body: { brandId: b.dataset.hubUnlink, unlink: true } }).catch((e) => showToast(e.message, "error"));
    openPartnerHub(hub.id, "brands");
  }));
  app.querySelector("[data-hub-link-brand]")?.addEventListener("change", async (e) => {
    if (!e.target.value) return;
    await api(`/api/partners/${encodeURIComponent(hub.id)}/brands`, { method: "POST", body: { brandId: e.target.value } }).catch((err) => showToast(err.message, "error"));
    openPartnerHub(hub.id, "brands");
  });
  app.querySelectorAll("[data-hub-doc]").forEach((tr) => tr.addEventListener("click", () => {
    const po = (state.purchaseOrders || []).find((x) => x.id === tr.dataset.hubDoc);
    goTrade("orders"); if (po) state.procurement.editingPurchaseOrder = JSON.parse(JSON.stringify(po)); renderApp();
  }));
  app.querySelectorAll("[data-hub-sale]").forEach((tr) => tr.addEventListener("click", () => { goTrade("sales"); const ss = salesState(); ss.view = "orders"; ss.selectedId = tr.dataset.hubSale; renderApp(); }));
  app.querySelector("[data-hub-prod]")?.addEventListener("click", () => { const id = hub.id; goTrade("stock"); const st = stockState(); st.screen = "cost"; st.prodSel = id; st.prod = null; renderApp(); });
  app.querySelectorAll("[data-hub-channel]").forEach((b) => b.addEventListener("click", () => { goTrade("sales"); const ss = salesState(); ss.view = "pricing"; ss.pricingSel = b.dataset.hubChannel; ss.pricing = null; renderApp(); }));
  app.querySelectorAll("[data-hub-material]").forEach((b) => b.addEventListener("click", () => {
    goTrade("materials"); state.procurement.editingMaterial = (state.materials || []).find((m) => m.id === b.dataset.hubMaterial) || null; renderApp();
  }));
}

function renderPartnerRow(item) {
  return `
    <tr class="hub-go ${item.isActive === false ? "is-archived" : ""}" data-partner-hub="${item.id}" title="누르면 이 거래처와 이어진 브랜드·명세서·판매·생산비가 보입니다">
      <td>${codeTag(item)}${h(item.name)}${item.isActive === false ? ARCHIVE_ICON : ""}${item.payoutAccountType === "virtual" ? ' <span class="pill">가상계좌</span>' : ""}<div class="row-tags">${partnerTagChips(item, state.partnerOptions)}<span class="muted" style="font-size:12px">${[item.notion?.last ? `마지막 결제 ${h(item.notion.last)}` : "", (item.aliases || []).length ? `검색 태그 ${h(item.aliases.join(", "))}` : ""].filter(Boolean).join(" · ")}</span></div></td>
      <td>${h(item.businessName)}${item.businessNumber ? `<br><span class="muted" style="font-size:11px">${h(formatBizNo(item.businessNumber))}</span>` : ""}</td>
      <td>${h(item.contactName)}${item.contactPhone ? ` · ${h(item.contactPhone)}` : ""}</td>
      <td>${item.orderMethod ? tagChip(item.orderMethod) : ""}</td>
      <td>${h(item.bankName)} ${h(item.bankAccount)}</td>
      <td><div class="row-actions"><button data-edit-partner="${item.id}">수정</button><button data-edit-procurement-popup="partner" data-record-id="${item.id}">새 창</button><button class="danger icon-btn" data-delete-partner="${item.id}" aria-label="삭제" title="삭제">×</button></div></td>
    </tr>`;
}

function renderPartnerForm() {
  const p = state.procurement.editingPartner || {};
  const opt = state.partnerOptions;
  if (!opt) { ensurePartnerOptions(); return `<p class="muted">불러오는 중…</p>`; }
  const issuer = isIssuer(p);
  const roles = partnerRoles(p);
  const subs = new Set(p.subRoles || []);
  // 발주방식·증빙구분: 노션식 단일 선택(없는 값은 쳐서 만들기)
  const select = (name, list, cur, addList) => notionSelect({
    id: `partner-${name}`, multi: false, label: name, placeholder: "선택",
    options: [...new Set([...(list || []), ...(cur ? [cur] : [])])].map((v) => ({ value: v, label: v })),
    selected: cur ? [cur] : [],
    onCreate: async (text) => {
      try { state.partnerOptions = await api("/api/partner-options", { method: "POST", body: { list: addList, value: text } }); }
      catch (err) { showToast(err.message, "error"); return null; }
      return { value: text, label: text };
    },
    hidden: (sel) => `<input type="hidden" name="${name}" value="${h(sel[0] || "")}">`
  });
  return `
    <form class="form-grid" data-partner-form>
      <div class="field"><label>구분</label><select name="kind" data-partner-kind><option value="partner" ${issuer ? "" : "selected"}>거래처</option><option value="issuer" ${issuer ? "selected" : ""}>발행자(자사 — 우리 사업자)</option></select></div>
      <div class="field" data-partner-tags ${issuer ? 'style="display:none"' : ""}>
        <label>분류 태그 <span class="muted" style="font-weight:400">(1차 · 2차 여러 개 가능 — 칸을 눌러 고르거나, 없는 이름은 쳐서 만드세요)</span></label>
        ${notionSelect({
          id: "partner-tags", multi: true, label: "분류 태그", placeholder: "분류 선택",
          options: Object.entries(PARTNER_ROLE_LABELS).flatMap(([k, l]) => [
            { value: `role:${k}`, label: l, color: PARTNER_ROLE_COLORS[k], hint: "1차" },
            ...(opt.sub[k] || []).map((sub) => ({ value: `sub:${k}:${sub}`, label: sub, color: PARTNER_ROLE_COLORS[k], hint: l }))
          ]),
          selected: [...roles.map((k) => `role:${k}`), ...Object.keys(PARTNER_ROLE_LABELS).flatMap((k) => (opt.sub[k] || []).filter((sub) => subs.has(sub)).map((sub) => `sub:${k}:${sub}`))],
          createChoices: Object.entries(PARTNER_ROLE_LABELS).map(([k, l]) => [k, l, PARTNER_ROLE_COLORS[k]]),
          onCreate: async (text, role) => {
            if (!role) return null;
            try { state.partnerOptions = await api("/api/partner-options", { method: "POST", body: { list: "sub", role, value: text } }); }
            catch (err) { showToast(err.message, "error"); return null; }
            return { value: `sub:${role}:${text}`, label: text, color: PARTNER_ROLE_COLORS[role], hint: PARTNER_ROLE_LABELS[role] };
          },
          hidden: (sel) => sel.map((v) => {
            const [kind, k, ...rest] = v.split(":");
            return kind === "role" ? `<input type="hidden" name="role_${h(k)}" value="on">`
              : `<input type="checkbox" name="sub" value="${h(rest.join(":"))}" data-sub-of="${h(k)}" checked hidden>`;
          }).join("")
        })}
      </div>
      <div class="field"><label>거래처명 (관리용 라벨)</label><input name="name" value="${h(p.name)}" required></div>
      <div class="field"><label>거래처명 (검색 태그 추가) <span class="muted" style="font-weight:400">— 예전 이름·다른 이름, 쉼표로 구분</span></label><input name="aliases" value="${h((p.aliases || []).join(", "))}"></div>
      <div class="field two">
        <div><label>사업자명</label><input name="businessName" value="${h(p.businessName)}"></div>
        <div><label>사업자등록번호</label><input name="businessNumber" value="${h(formatBizNo(p.businessNumber))}" placeholder="000-00-00000" data-bizno></div>
      </div>
      <div class="field"><label>사업자상 대표명</label><input name="representativeName" value="${h(p.representativeName)}"></div>
      <div class="field"><label>사업자등록 주소</label><input name="address" value="${h(p.address)}"></div>
      <div class="field"><label>전자세금계산서 수취용 이메일</label><input name="invoiceEmail" type="email" value="${h(p.invoiceEmail)}"></div>
      <div class="field"><label>결제계좌 방식</label><select name="payoutAccountType"><option value="fixed" ${p.payoutAccountType !== "virtual" ? "selected" : ""}>고정 계좌</option><option value="virtual" ${p.payoutAccountType === "virtual" ? "selected" : ""}>가상계좌(매번 다름 — 지급요청마다 입력)</option></select></div>
      <div class="field two">
        <div><label>결제정보 (은행)</label><input name="bankName" value="${h(p.bankName)}"></div>
        <div><label>결제정보 (계좌번호)</label><input name="bankAccount" value="${h(p.bankAccount)}"></div>
      </div>
      <div class="field"><label>결제정보 (예금주명)</label><input name="depositorName" value="${h(p.depositorName)}"></div>
      <div class="field two">
        <div><label>발주방식</label>${select("orderMethod", opt.orderMethods, p.orderMethod, "orderMethods")}</div>
        <div><label>증빙구분</label>${select("invoiceTiming", opt.evidenceTypes, p.invoiceTiming, "evidenceTypes")}</div>
      </div>
      <div class="field">
        <label>금액 계산 방식 <span class="muted" style="font-weight:400">(발주서 단가 기본값 — 문서별로 변경 가능)</span></label>
        <select name="priceMode">
          <option value="supply" ${p.priceMode === "gross" ? "" : "selected"}>부가세 별도 (공급가 기준 — 생산처 일반)</option>
          <option value="gross" ${p.priceMode === "gross" ? "selected" : ""}>부가세 포함 (제품가에 부가세 포함)</option>
        </select>
      </div>
      <div class="field two">
        <div><label>담당자명</label><input name="contactName" value="${h(p.contactName)}"></div>
        <div><label>담당자 연락처</label><input name="contactPhone" value="${h(p.contactPhone)}"></div>
      </div>
      <div class="field"><label>담당자 이메일</label><input name="contactEmail" type="email" value="${h(p.contactEmail)}"></div>
      <div class="field"><label>메모</label><textarea name="note">${h(p.note)}</textarea></div>
      <div class="field">
        <label>첨부 링크</label>
        <div data-attachments-list>${(p.attachments || []).map(renderAttachmentRow).join("")}</div>
        <button type="button" data-add-attachment style="margin-top:6px">링크 추가</button>
      </div>
      <div class="field"><label>사용 상태</label><select name="isActive"><option value="true" ${p.isActive !== false ? "selected" : ""}>사용(활성)</option><option value="false" ${p.isActive === false ? "selected" : ""}>보관</option></select></div>
      <div class="toolbar">
        <button class="primary" type="submit">${p.id ? "수정 저장" : "거래처 추가"}</button>
        ${state.procurement.editingPartner ? `<button type="button" data-cancel-edit-partner>취소</button>` : ""}
      </div>
    </form>
  `;
}

function renderAttachmentRow(url) {
  return `
    <div class="attachment-row" data-attachment-row>
      <input type="text" class="attachment-input" value="${h(url)}" placeholder="https://...">
      <button type="button" class="danger icon-btn" data-remove-attachment aria-label="삭제" title="삭제">×</button>
    </div>`;
}

function bindPartnerFormExtras() {
  const form = app.querySelector("[data-partner-form]");
  if (!form) return;
  bindNotionSelects(form);
  form.querySelector("[data-partner-kind]")?.addEventListener("change", (e) => {
    const tags = form.querySelector("[data-partner-tags]");
    if (tags) tags.style.display = e.target.value === "issuer" ? "none" : "";
  });
  form.querySelector("[data-bizno]")?.addEventListener("blur", (e) => { e.target.value = formatBizNo(e.target.value); });
  const addOption = async (body) => {
    try { state.partnerOptions = await api("/api/partner-options", { method: "POST", body }); return true; } catch (err) { showToast(err.message, "error"); return false; }
  };
  form.querySelectorAll("[data-add-sub]").forEach((b) => b.addEventListener("click", async () => {
    const value = prompt(`'${PARTNER_ROLE_LABELS[b.dataset.addSub]}' 아래에 추가할 2차 분류 이름`);
    if (!value?.trim()) return;
    // 지금 고른 값은 다시 그려도 남게 잠깐 담아 둔다
    const p = state.procurement.editingPartner || (state.procurement.editingPartner = null);
    if (await addOption({ list: "sub", role: b.dataset.addSub, value: value.trim() })) renderApp();
  }));
  form.querySelectorAll("[data-opt-select]").forEach((sel) => sel.addEventListener("change", async () => {
    if (sel.value !== "__add") return;
    const value = prompt("추가할 항목 이름");
    if (!value?.trim()) { sel.value = ""; return; }
    if (await addOption({ list: sel.dataset.optSelect, value: value.trim() })) {
      const o = document.createElement("option");
      o.textContent = value.trim();
      sel.insertBefore(o, sel.lastElementChild);
      sel.value = value.trim();
    }
  }));
}

function bindPartners() {
  bindPartnerFormExtras();
  bindBulkExcelTools("partner", "/api/partners/import");
  bindProcurementPopupButtons("partner");
  app.querySelector("[data-new-partner]")?.addEventListener("click", () => {
    state.procurement.editingPartner = null;
    renderApp();
  });
  app.querySelectorAll("[data-edit-partner]").forEach((button) => {
    button.addEventListener("click", () => {
      state.procurement.editingPartner = state.partners.find((item) => item.id === button.dataset.editPartner);
      renderApp();
    });
  });
  app.querySelector("[data-cancel-edit-partner]")?.addEventListener("click", () => {
    state.procurement.editingPartner = null;
    renderApp();
  });
  app.querySelectorAll("[data-delete-partner]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("이 거래처를 삭제할까요?")) return;
      try {
        await api(`/api/partners/${button.dataset.deletePartner}`, { method: "DELETE" });
      } catch (error) {
        alert(error.message);
        return;
      }
      await refreshAndRender();
    });
  });
  const attachmentsList = app.querySelector("[data-attachments-list]");
  const bindAttachmentRemovers = () => {
    attachmentsList?.querySelectorAll("[data-remove-attachment]").forEach((button) => {
      button.addEventListener("click", () => {
        button.closest("[data-attachment-row]")?.remove();
      });
    });
  };
  bindAttachmentRemovers();
  app.querySelector("[data-add-attachment]")?.addEventListener("click", () => {
    attachmentsList?.insertAdjacentHTML("beforeend", renderAttachmentRow(""));
    bindAttachmentRemovers();
  });

  app.querySelector("[data-partner-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = formObject(event.currentTarget);
    body.isActive = body.isActive === "true";
    const formEl = event.currentTarget;
    body.subRoles = Array.from(formEl.querySelectorAll("[name=sub]:checked")).map((x) => x.value);
    // 2차를 고르면 그 1차도 고른 것으로
    const subRoleOf = Array.from(formEl.querySelectorAll("[name=sub]:checked")).map((x) => x.dataset.subOf);
    body.roles = Object.keys(PARTNER_ROLE_LABELS).filter((k) => body[`role_${k}`] || subRoleOf.includes(k));
    for (const k of Object.keys(PARTNER_ROLE_LABELS)) delete body[`role_${k}`];
    delete body.sub;
    if (body.orderMethod === "__add") body.orderMethod = "";
    if (body.invoiceTiming === "__add") body.invoiceTiming = "";
    body.attachments = Array.from(attachmentsList?.querySelectorAll(".attachment-input") || [])
      .map((input) => input.value.trim())
      .filter(Boolean);
    const editing = state.procurement.editingPartner;
    if (editing) {
      await api(`/api/partners/${editing.id}`, { method: "PUT", body });
    } else {
      await api("/api/partners", { method: "POST", body });
    }
    state.procurement.editingPartner = null;
    afterProcurementSave("partner", editing ? "수정되었습니다." : "저장되었습니다.");
    await refreshAndRender();
  });
}

// 새 창에서 저장했으면 목록 창에도 알려 같이 갱신되게 하고, 창 주소에서
// 편집 중이던 레코드 id를 떼어 다음 입력이 새 건으로 시작하게 한다.
function afterProcurementSave(kind, message) {
  if (procurementPopupKind !== kind) return;
  history.replaceState({}, "", `/?procurement-popup=${kind}`);
  window.opener?.postMessage({ type: "procurementSaved" }, location.origin);
  showToast(message);
}

// 품목: ① 자재(종류별) · ② 제품(우리 완제품) · ④ 거래처 상품. 한 저장소를 종류별로 따로 보여 준다.
const ITEM_KIND_LABELS = { material: "자재", product: "제품(우리 완제품)", vendorProduct: "거래처 상품" };
const MATERIAL_TYPE_LABELS = { RM: "원자재(원단)", SB: "부자재", PK: "포장재", LB: "공임", OP: "외주가공", FR: "운임", OT: "1회성 비용" };
const itemKindOf = (m) => m.itemKind || "material";
const OWNER_LABELS = { wooof: "우프컴퍼니", betters: "Betters(예전 귀속)", npb: "NPB", other: "기타" };
const UNIT_LABELS = { pb: "PB", npb: "NPB" };
// 셀메이트 내보내기는 .xlsx 이름이어도 CSV(cp949)다. UTF-8 로 먼저 읽고 깨지면 EUC-KR 로.
async function readSellmateFile(file) {
  const buf = await file.arrayBuffer();
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch { return new TextDecoder("euc-kr").decode(buf); }
}
function itemView() {
  const pr = state.procurement;
  if (!pr.itemKind) pr.itemKind = "material";
  return pr;
}
function renderMaterials() {
  const pr = itemView();
  const all = state.materials || [];
  const kind = pr.itemKind;
  const type = pr.materialType || "";
  const q = String(pr.itemSearch || "").trim().toLowerCase();
  const sub = pr.itemSub || "";
  const rows = all.filter((m) => itemKindOf(m) === kind && (kind !== "material" || !type || m.materialType === type)
    && (!sub || (sub === "review" ? m.needsReview : sub === "discontinued" ? m.discontinued : sub === "instock" ? Number(m.stock || 0) > 0 : sub.startsWith("own:") ? m.owner === sub.slice(4) : sub.startsWith("unit:") ? m.businessUnit === sub.slice(5) : true))
    && (pr.itemShowInactive || m.isActive !== false)
    && (!q || [m.itemName, m.code, m.itemCode, m.barcode, m.group, m.note, ...(m.legacyCodes || []), (state.partners || []).find((x) => x.id === m.partnerId)?.name].some((v) => String(v || "").toLowerCase().includes(q))))
    .sort((a, b) => String(a.group || "").localeCompare(String(b.group || ""), "ko") || String(a.code || "").localeCompare(String(b.code || "")));
  const kindCount = (k) => all.filter((m) => itemKindOf(m) === k && m.isActive !== false).length;
  const typeCount = (t) => all.filter((m) => itemKindOf(m) === "material" && m.materialType === t && m.isActive !== false).length;
  const isMat = kind === "material";
  return `
    <div class="npb-subnav" style="flex-wrap:wrap">
      ${Object.entries(ITEM_KIND_LABELS).map(([k, l]) => `<button class="npb-subtab ${kind === k ? "active" : ""}" data-item-kind="${k}">${l} <span class="muted">${kindCount(k)}</span></button>`).join("")}
      ${isMat ? `<span class="chip-divider" aria-hidden="true"></span><button class="npb-subtab ${!type ? "active" : ""}" data-item-type="">전체</button>${Object.entries(MATERIAL_TYPE_LABELS).map(([t, l]) => `<button class="npb-subtab ${type === t ? "active" : ""}" data-item-type="${t}">${l} <span class="muted">${typeCount(t)}</span></button>`).join("")}` : ""}
      ${!isMat ? (() => {
        const pool = all.filter((m) => itemKindOf(m) === kind && m.isActive !== false);
        const chip = (k, l, n) => (n ? `<button class="npb-subtab ${sub === k ? "active" : ""}" data-item-sub="${k}">${l} <span class="muted">${n}</span></button>` : "");
        return `<span class="chip-divider" aria-hidden="true"></span>${chip("", "전체", pool.length)}${chip("instock", "재고 있음", pool.filter((m) => Number(m.stock || 0) > 0).length)}${chip("review", "⚠ 분류 확인 필요", pool.filter((m) => m.needsReview).length)}${chip("discontinued", "단종·마지막 재고", pool.filter((m) => m.discontinued).length)}
          ${kind === "product" ? Object.entries(UNIT_LABELS).map(([u, l]) => chip(`unit:${u}`, l, pool.filter((m) => m.businessUnit === u).length)).join("") : ""}
          ${Object.entries(OWNER_LABELS).map(([o, l]) => chip(`own:${o}`, `귀속 ${l}`, pool.filter((m) => m.owner === o).length)).join("")}`;
      })() : ""}
      <input data-item-search placeholder="이름·코드·예전 코드·거래처·묶음 검색" value="${h(pr.itemSearch || "")}" style="margin-left:auto;min-width:220px">
      <label class="muted" style="font-size:12px"><input type="checkbox" data-item-inactive ${pr.itemShowInactive ? "checked" : ""}> 안 쓰는 것도</label>
    </div>
    <section class="layout">
      <div class="panel">
        <div class="panel-head"><h2>${h(ITEM_KIND_LABELS[kind])}${isMat && type ? ` · ${h(MATERIAL_TYPE_LABELS[type])}` : ""}</h2><span class="muted">${money.format(rows.length)}개</span></div>
        <div class="panel-body list-actions">
          <button class="primary" data-new-material>새 ${h(isMat ? (MATERIAL_TYPE_LABELS[type] || "자재") : ITEM_KIND_LABELS[kind])}</button>
          ${renderBulkExcelTools("material", "/api/materials/export")}
          ${!isMat ? `<details class="sellmate-box" ${pr.sellmateOpen ? "open" : ""}><summary>셀메이트 재고 올리기 ${pr.sellmateLast ? `<span class="muted">— 마지막 ${h(fmtDate(pr.sellmateLast.takenAt))} · ${money.format(pr.sellmateLast.totals.units)}개 · 원가합 ${money.format(pr.sellmateLast.totals.costValue)}원</span>` : ""}</summary>
            <p class="muted" style="font-size:12px">셀메이트 '재고 내보내기' 파일(재고 0 포함)을 그대로 올리세요. SKU 를 맞추고(없으면 새 품목), 그날 재고를 저장합니다.</p>
            <div class="toolbar"><input type="file" data-sellmate-file accept=".csv,.xlsx,.xls"><button data-sellmate-go="dry">미리 보기</button><button class="primary" data-sellmate-go="apply">올리기</button></div>
            ${pr.sellmateResult ? `<pre class="muted" style="white-space:pre-wrap;font-size:12px">${h(pr.sellmateResult)}</pre>` : ""}
          </details>` : ""}
        </div>
        <div class="table-wrap">
          <table class="materials-table compact" data-unit="원">
            <thead><tr>${isMat ? `<th>품목</th><th>종류</th><th>거래처</th><th>발주단위 / MOQ</th><th>기본단가</th><th>리드타임</th><th></th>` : `<th>품목</th><th>귀속</th><th data-nounit="1">재고 / 가용</th><th>위치</th><th>원가 / 셀메이트</th><th>바코드 · 카페24</th><th></th>`}</tr></thead>
            <tbody>${rows.map((m) => renderMaterialRow(m, isMat)).join("") || `<tr><td colspan="7" class="empty">등록된 품목이 없습니다.</td></tr>`}</tbody>
          </table>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>${state.procurement.editingMaterial ? "품목 수정" : "품목 입력"}</h2></div>
        <div class="panel-body">${renderMaterialForm()}</div>
      </div>
    </section>
  `;
}

function renderMaterialRow(item, isMat) {
  if (!isMat) {
    const unit = UNIT_LABELS[item.businessUnit];
    return `
    <tr class="hub-go" data-row-edit="[data-edit-material]">
      <td>${codeTag(item)}${h(item.itemName)}${unit ? ` <span class="pill">${unit}</span>` : ""}${item.discontinued ? ' <span class="pill" title="다시 주문하지 않는 마지막 재고">단종</span>' : ""}${item.isActive === false ? ' <span class="pill">안 씀</span>' : ""}${item.needsReview ? `<br><span class="danger-text" style="font-size:11px">⚠ 분류 확인:</span> <select class="small" data-item-reclass="${h(item.id)}"><option value="">고르기…</option><option value="product:pb">제품 PB</option><option value="product:npb">제품 NPB</option><option value="vendorProduct:">거래처 상품</option></select>` : ""}</td>
      <td>${h(OWNER_LABELS[item.owner] || "")}</td>
      <td class="num">${item.stock != null ? `${money.format(item.stock)}${item.available != null && item.available !== item.stock ? ` / ${money.format(item.available)}` : ""}` : "-"}${item.lastInbound ? `<br><span class="muted" style="font-size:11px">입고 ${h(String(item.lastInbound).slice(0, 10))}</span>` : ""}</td>
      <td>${h(item.storage || "")}</td>
      <td class="num">${item.basePrice ? money.format(item.basePrice) : "-"}${item.sellmateCost ? `<br><span class="muted" style="font-size:11px">셀메이트 ${money.format(item.sellmateCost)}</span>` : ""}</td>
      <td style="font-size:12px">${h(item.barcode || item.itemCode || "")}${item.cafe24VariantCode || item.cafe24Code ? `<br><span class="muted">${h(item.cafe24VariantCode || item.cafe24Code)}</span>` : ""}</td>
      <td><div class="row-actions"><button data-edit-material="${item.id}">수정</button><button class="danger icon-btn" data-delete-material="${item.id}" aria-label="삭제" title="삭제">×</button></div></td>
    </tr>`;
  }
  const partner = (state.partners || []).find((p) => p.id === item.partnerId);
  const alt = (item.altPartnerIds || []).map((id) => (state.partners || []).find((p) => p.id === id)?.name).filter(Boolean);
  return `
    <tr class="hub-go" data-row-edit="[data-edit-material]">
      <td>${codeTag(item)}${h(item.itemName)}${item.isActive === false ? ' <span class="pill">안 씀</span>' : ""}${item.group ? `<br><span class="muted" style="font-size:11px">묶음 ${h(item.group)}</span>` : ""}${item.orderNote ? `<br><span class="muted" style="font-size:11px">⚠ ${h(item.orderNote.slice(0, 40))}${item.orderNote.length > 40 ? "…" : ""}</span>` : ""}</td>
      ${isMat ? `<td>${h(MATERIAL_TYPE_LABELS[item.materialType] || "")}</td>` : ""}
      <td>${h(partner?.name || "")}${alt.length ? `<br><span class="muted" style="font-size:11px">대체 ${h(alt.join(", "))}</span>` : ""}</td>
      <td>${h(item.orderUnit || item.baseUnit || "")}${item.moq ? ` · MOQ ${money.format(item.moq)}` : ""}${item.orderMultiple ? ` · ${money.format(item.orderMultiple)}단위` : ""}</td>
      <td class="num">${item.basePrice ? money.format(item.basePrice) : "-"}</td>
      ${isMat ? `<td>${item.leadTimeDays ? `${item.leadTimeDays}일` : "-"}</td>` : `<td>${h(item.barcode || item.itemCode || "")}</td>`}
      <td><div class="row-actions"><button data-edit-material="${item.id}">수정</button><button class="danger icon-btn" data-delete-material="${item.id}" aria-label="삭제" title="삭제">×</button></div></td>
    </tr>`;
}

function renderMaterialForm() {
  const pr = itemView();
  const m = state.procurement.editingMaterial || { itemKind: pr.itemKind, materialType: pr.materialType || "SB" };
  const kind = itemKindOf(m);
  const isMat = kind === "material";
  const prices = pr.itemPrices && pr.itemPrices.itemId === m.id ? pr.itemPrices.list : null;
  const partnerName = (id) => (state.partners || []).find((p) => p.id === id)?.name || "";
  return `
    <form class="form-grid" data-material-form>
      <div class="field two">
        <div><label>종류</label><select name="itemKind">${Object.entries(ITEM_KIND_LABELS).map(([k, l]) => `<option value="${k}" ${kind === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <div><label>자재 종류</label><select name="materialType" ${isMat ? "" : "disabled"}>${Object.entries(MATERIAL_TYPE_LABELS).map(([k, l]) => `<option value="${k}" ${m.materialType === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      </div>
      ${kind === "product" ? `<div class="field"><label>사업부</label><select name="businessUnit"><option value="pb" ${m.businessUnit !== "npb" ? "selected" : ""}>PB (베럴즈 등 우리 브랜드)</option><option value="npb" ${m.businessUnit === "npb" ? "selected" : ""}>NPB (픽키도기클럽·도톤·공감캣)</option></select></div>` : ""}
      ${!isMat && (m.owner || m.sellmateCode) ? `<p class="muted" style="font-size:12px">셀메이트: ${h(m.sellmateCode || "")} · 귀속 ${h(OWNER_LABELS[m.owner] || "-")} · 재고 ${money.format(m.stock || 0)}${m.stockAt ? ` (${h(fmtDate(m.stockAt))})` : ""}</p>` : ""}
      <div class="field"><label>품목명</label><input name="itemName" value="${h(m.itemName)}" required></div>
      <div class="field two">
        <div><label>기본 거래처(공급처)</label><select name="partnerId"><option value="">선택 안 함</option>${partnerSelectOptionsForDoc(m.partnerId, kind === "vendorProduct" ? "purchase" : "production").join("")}</select></div>
        <div><label>묶음(그룹)</label><input name="group" value="${h(m.group)}" placeholder="예: 이케코 ML 체크블루 부자재"></div>
      </div>
      <div class="field"><label>대체 공급처 <span class="muted" style="font-weight:400">(가격·수급에 따라 바뀌는 곳)</span></label><select name="altPartnerIds" multiple size="3">${(state.partners || []).filter((p) => p.isActive !== false).map((p) => `<option value="${h(p.id)}" ${(m.altPartnerIds || []).includes(p.id) ? "selected" : ""}>${h(p.name)}</option>`).join("")}</select></div>
      <div class="field two">
        <div><label>${isMat ? "규격·사양" : "옵션·규격"}</label><input name="spec" value="${h(m.spec)}" placeholder="${isMat ? "예: 비바와샤2 N100/56'' 36번 그레이" : "예: ML / 체크블루"}"></div>
        <div><label>${isMat ? "공급처 품번" : "바코드"}</label><input name="${isMat ? "itemCode" : "barcode"}" value="${h(isMat ? m.itemCode : m.barcode || m.itemCode)}" placeholder="${isMat ? "" : "880… (없으면 비워 둠)"}"></div>
      </div>
      <div class="field two">
        <div><label>기본 단위</label><input name="baseUnit" value="${h(m.baseUnit)}" placeholder="예: 야드, 개, m"></div>
        <div><label>발주 단위</label><input name="orderUnit" value="${h(m.orderUnit)}" placeholder="예: 롤, 박스"></div>
      </div>
      ${isMat ? `<div class="field two">
        <div><label>발주 단위당 수량</label><input name="unitPerOrder" inputmode="decimal" value="${h(m.unitPerOrder ?? "")}" placeholder="예: 1롤 = 100(야드)"></div>
        <div><label>MOQ(최소 발주)</label><input name="moq" inputmode="decimal" value="${h(m.moq ?? "")}"></div>
      </div>
      <div class="field two">
        <div><label>권장 발주 단위(배수)</label><input name="orderMultiple" inputmode="decimal" value="${h(m.orderMultiple ?? "")}" placeholder="예: 100개씩"></div>
        <div><label>리드타임(일)</label><input name="leadTimeDays" type="number" min="0" value="${h(m.leadTimeDays || "")}"></div>
      </div>
      <div class="field"><label>보관 위치</label><input name="storage" value="${h(m.storage)}" placeholder="예: 세림통상, 동광섬유, 물류센터, 본사"></div>
      <div class="field"><label>발주 시 꼭 확인할 것</label><textarea name="orderNote" rows="2" placeholder="예: 염색비 별도(1회 70,000원), 원단과 컬러감 확인">${h(m.orderNote)}</textarea></div>` : `
      <div class="field two">
        <div><label>입수(박스당)</label><input name="packQty" inputmode="decimal" value="${h(m.packQty ?? "")}"></div>
        <div><label>중량(g)</label><input name="weightG" inputmode="decimal" value="${h(m.weightG ?? "")}"></div>
      </div>
      <div class="field"><label>포장 크기(mm) 가로 · 세로 · 높이</label><div class="toolbar"><input name="widthMm" inputmode="decimal" value="${h(m.widthMm ?? "")}" style="width:90px"><input name="depthMm" inputmode="decimal" value="${h(m.depthMm ?? "")}" style="width:90px"><input name="heightMm" inputmode="decimal" value="${h(m.heightMm ?? "")}" style="width:90px"></div></div>`}
      <div class="field two">
        <div><label>기본 단가 ${m.id ? '<span class="muted" style="font-weight:400">(바꾸려면 아래 단가 이력에서)</span>' : ""}</label><input name="basePrice" type="number" min="0" value="${h(m.basePrice || "")}" placeholder="부가세 별도" ${m.id ? "readonly" : ""}></div>
        <div><label>소비자가</label><input name="consumerPrice" type="number" min="0" value="${h(m.consumerPrice || "")}"></div>
      </div>
      <div class="field"><label>메모</label><textarea name="note" rows="2">${h(m.note)}</textarea></div>
      <div class="field"><label>사용 상태</label><select name="isActive"><option value="true" ${m.isActive !== false ? "selected" : ""}>사용</option><option value="false" ${m.isActive === false ? "selected" : ""}>안 씀</option></select></div>
      ${!isMat ? `<div class="field"><label class="chip"><input type="checkbox" name="discontinued" ${m.discontinued ? "checked" : ""}> 단종 · 마지막 재고 (다시 주문 안 함)</label></div>` : ""}
      ${(m.legacyCodes || []).length ? `<p class="muted" style="font-size:12px">예전 코드: ${h(m.legacyCodes.join(", "))}</p>` : ""}
      <div class="toolbar">
        <button class="primary" type="submit">${m.id ? "수정 저장" : "품목 추가"}</button>
        ${state.procurement.editingMaterial ? `<button type="button" data-cancel-edit-material>취소</button>` : ""}
      </div>
    </form>
    ${m.id ? `<div class="price-history" style="margin-top:14px">
      <h3 style="font-size:14px;margin:0 0 6px">단가 이력 <span class="muted" style="font-weight:400;font-size:12px">— 바뀌면 '새 단가'를 더합니다. 이미 만든 발주·청구는 그때 단가 그대로.</span></h3>
      ${prices ? `<div class="table-wrap"><table class="compact" data-unit="원"><thead><tr><th>적용 시작</th><th>거래처</th><th>단가</th><th>부가세</th><th>사유</th><th>누가</th></tr></thead><tbody>
        ${prices.map((x) => `<tr><td>${h(x.effectiveFrom)}</td><td>${h(x.partnerName)}</td><td class="num">${money.format(x.price)}</td><td>${x.vatMode === "included" ? "포함" : "별도"}</td><td class="wrap">${h(x.reason)}</td><td>${h(x.by)}</td></tr>`).join("") || `<tr><td colspan="6" class="empty">이력이 없습니다. 지금 기본 단가 ${m.basePrice ? `${money.format(m.basePrice)}원` : "없음"}.</td></tr>`}
      </tbody></table></div>` : `<p class="muted">불러오는 중…</p>`}
      ${can("procurement", "edit") ? `<form class="toolbar" data-item-price style="flex-wrap:wrap;margin-top:6px">
        <input name="price" inputmode="numeric" placeholder="새 단가" style="width:110px" required>
        <select name="vatMode"><option value="excluded">부가세 별도</option><option value="included">부가세 포함</option></select>
        <input type="date" name="effectiveFrom" value="${new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)}">
        <select name="partnerId"><option value="${h(m.partnerId || "")}">${h(partnerName(m.partnerId) || "기본 거래처")}</option>${(m.altPartnerIds || []).map((id) => `<option value="${h(id)}">${h(partnerName(id))}</option>`).join("")}</select>
        <input name="reason" placeholder="사유(예: 26/4/28 인상)" style="min-width:160px">
        <button class="small primary" type="submit">새 단가 추가</button></form>` : ""}
    </div>` : ""}
  `;
}

function bindMaterials() {
  bindBulkExcelTools("material", "/api/materials/import");
  bindProcurementPopupButtons("material");
  const pr = itemView();
  app.querySelectorAll("[data-item-kind]").forEach((b) => b.addEventListener("click", () => { pr.itemKind = b.dataset.itemKind; pr.materialType = ""; pr.itemSub = ""; state.procurement.editingMaterial = null; renderApp(); }));
  app.querySelectorAll("[data-item-type]").forEach((b) => b.addEventListener("click", () => { pr.materialType = b.dataset.itemType; renderApp(); }));
  app.querySelectorAll("[data-item-sub]").forEach((b) => b.addEventListener("click", () => { pr.itemSub = b.dataset.itemSub; renderApp(); }));
  app.querySelectorAll("[data-item-reclass]").forEach((sel) => sel.addEventListener("change", async () => {
    if (!sel.value) return;
    const [itemKind, businessUnit] = sel.value.split(":");
    try {
      const r = await api(`/api/materials/${encodeURIComponent(sel.dataset.itemReclass)}`, { method: "PUT", body: { itemKind, businessUnit, needsReview: false } });
      const i = state.materials.findIndex((x) => x.id === r.material.id);
      if (i >= 0) state.materials[i] = r.material;
      showToast("분류했습니다.");
      renderApp();
    } catch (e) { showToast(e.message, "error"); }
  }));
  if (pr.itemKind !== "material" && pr.sellmateLast === undefined && !pr.sellmateLoading) {
    pr.sellmateLoading = true;
    api("/api/sellmate/snapshots").then((r) => { pr.sellmateLast = r.snapshots[0] || null; }).catch(() => { pr.sellmateLast = null; }).finally(() => { pr.sellmateLoading = false; renderApp(); });
  }
  app.querySelectorAll("[data-sellmate-go]").forEach((b) => b.addEventListener("click", async (e) => {
    e.preventDefault();
    const file = app.querySelector("[data-sellmate-file]")?.files[0];
    if (!file) { showToast("셀메이트 재고 파일을 고르세요.", "error"); return; }
    const dryRun = b.dataset.sellmateGo === "dry";
    try {
      const text = await readSellmateFile(file);
      const r = await api("/api/sellmate/import", { method: "POST", body: { text, dryRun, fileName: file.name } });
      const sm = r.summary;
      const own = Object.entries(sm.totals.byOwner || {}).map(([o, v]) => `${OWNER_LABELS[o] || o} ${money.format(v.units)}개 · ${money.format(v.costValue)}원`).join(" / ");
      pr.sellmateResult = `${dryRun ? "[미리 보기] " : ""}${sm.rows}줄 · 새 품목 ${sm.creates}(${Object.entries(sm.kinds).map(([k, n]) => `${k} ${n}`).join(", ") || "-"}) · 갱신 ${sm.updates}\n재고 ${money.format(sm.totals.units)}개(재고 있는 SKU ${sm.totals.inStock}) · 셀메이트 원가 기준 ${money.format(sm.totals.costValue)}원\n${own}`;
      pr.sellmateOpen = true;
      if (!dryRun) { pr.sellmateLast = undefined; showToast("올렸습니다."); await refreshAndRender(); return; }
      renderApp();
    } catch (err) { showToast(err.message, "error"); }
  }));
  bindSearchInput("[data-item-search]", (v) => { pr.itemSearch = v; });
  app.querySelector("[data-item-inactive]")?.addEventListener("change", (e) => { pr.itemShowInactive = e.target.checked; renderApp(); });
  app.querySelector('[data-material-form] [name=itemKind]')?.addEventListener("change", (e) => {
    const t = app.querySelector('[data-material-form] [name=materialType]');
    if (t) t.disabled = e.target.value !== "material";
  });
  const editingItem = state.procurement.editingMaterial;
  if (editingItem?.id && (!pr.itemPrices || pr.itemPrices.itemId !== editingItem.id) && !pr.itemPricesLoading) {
    pr.itemPricesLoading = true;
    api(`/api/materials/${encodeURIComponent(editingItem.id)}/prices`).then((r) => { pr.itemPrices = { itemId: editingItem.id, list: r.prices || [] }; })
      .catch(() => { pr.itemPrices = { itemId: editingItem.id, list: [] }; }).finally(() => { pr.itemPricesLoading = false; renderApp(); });
  }
  app.querySelector("[data-item-price]")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = formObject(e.currentTarget);
    try {
      const r = await api(`/api/materials/${encodeURIComponent(editingItem.id)}/prices`, { method: "POST", body });
      if (r.material) { Object.assign(editingItem, r.material); const i = state.materials.findIndex((x) => x.id === r.material.id); if (i >= 0) state.materials[i] = r.material; }
      pr.itemPrices = null;
      showToast("새 단가를 더했습니다.");
      renderApp();
    } catch (err) { showToast(err.message, "error"); }
  });
  app.querySelector("[data-new-material]")?.addEventListener("click", () => {
    state.procurement.editingMaterial = null;
    renderApp();
  });
  app.querySelectorAll("[data-edit-material]").forEach((button) => {
    button.addEventListener("click", () => {
      state.procurement.editingMaterial = state.materials.find((item) => item.id === button.dataset.editMaterial);
      renderApp();
    });
  });
  app.querySelector("[data-cancel-edit-material]")?.addEventListener("click", () => {
    state.procurement.editingMaterial = null;
    renderApp();
  });
  app.querySelectorAll("[data-delete-material]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("이 원부자재를 삭제할까요?")) return;
      try {
        await api(`/api/materials/${button.dataset.deleteMaterial}`, { method: "DELETE" });
      } catch (error) {
        alert(error.message);
        return;
      }
      await refreshAndRender();
    });
  });
  app.querySelector("[data-material-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = formObject(event.currentTarget);
    body.isActive = body.isActive === "true";
    body.altPartnerIds = Array.from(event.currentTarget.querySelector("[name=altPartnerIds]")?.selectedOptions || []).map((o) => o.value);
    if (event.currentTarget.querySelector("[name=discontinued]")) body.discontinued = Boolean(event.currentTarget.querySelector("[name=discontinued]").checked);
    if (body.itemKind !== "material") delete body.materialType;
    const editing = state.procurement.editingMaterial;
    if (editing) {
      await api(`/api/materials/${editing.id}`, { method: "PUT", body });
    } else {
      await api("/api/materials", { method: "POST", body });
    }
    state.procurement.editingMaterial = null;
    afterProcurementSave("material", editing ? "수정되었습니다." : "저장되었습니다.");
    await refreshAndRender();
  });
}

// 입금계좌에 이어진 브랜드(BR-)·거래처(PT-). 연결은 브랜드의 transferAccountId 와 계좌의 partnerId 한 칸씩에만 둔다.
function accountLinks(acc) {
  const brands = state.brands.filter((b) => b.transferAccountId === acc.id);
  const partner = (state.partners || []).find((p) => p.id === acc.partnerId) || null;
  const kind = brands.length && partner ? "both" : brands.length ? "brand" : partner ? "partner" : "none";
  const codes = [...brands.map((b) => b.code || ""), partner?.code || ""].filter(Boolean).sort();
  return { brands, partner, kind, codeKey: codes[0] || "ZZZ" };
}
const ACCOUNT_KIND = { brand: "브랜드", partner: "거래처", both: "브랜드+거래처", none: "미연결" };
function renderTransferAccounts() {
  const q = String(state.procurement.accountQuery || "").trim().toLowerCase();
  const f = state.procurement.accountFilter || "";
  const sort = state.procurement.accountSort || "alias";
  const all = (state.transferAccounts || []).map((acc) => ({ acc, link: accountLinks(acc) }));
  const counts = all.reduce((m, x) => { m[x.link.kind] = (m[x.link.kind] || 0) + 1; return m; }, {});
  const sorters = {
    alias: (x, y) => String(x.acc.alias || "").localeCompare(String(y.acc.alias || ""), "ko"),
    code: (x, y) => x.link.codeKey.localeCompare(y.link.codeKey) || String(x.acc.alias || "").localeCompare(String(y.acc.alias || ""), "ko"),
    bank: (x, y) => String(x.acc.bankName || "").localeCompare(String(y.acc.bankName || ""), "ko") || String(x.acc.alias || "").localeCompare(String(y.acc.alias || ""), "ko"),
    holder: (x, y) => String(x.acc.holder || "").localeCompare(String(y.acc.holder || ""), "ko"),
    recent: (x, y) => String(y.acc.registeredAt || y.acc.createdAt || "").localeCompare(String(x.acc.registeredAt || x.acc.createdAt || ""))
  };
  const rowsAll = all
    .filter((x) => !f || (f === "brand" ? ["brand", "both"].includes(x.link.kind) : f === "partner" ? ["partner", "both"].includes(x.link.kind) : x.link.kind === f))
    .filter((x) => !q || [x.acc.alias, x.acc.holder, x.acc.bankName, x.acc.accountNumber, x.acc.code, ...x.link.brands.flatMap((b) => [b.name, b.code]), x.link.partner?.name, x.link.partner?.code]
      .some((v) => String(v || "").toLowerCase().includes(q)))
    .sort(sorters[sort] || sorters.alias);
  const a = state.procurement.editingAccount || {};
  return `
    <section class="layout">
      <div class="panel">
        <div class="panel-head"><h2>자주 쓰는 입금계좌</h2><span class="muted">${money.format(all.length)}개</span></div>
        <div class="panel-body" style="padding-bottom:0">
          <div class="toolbar">
            <label>하나은행 목록 업로드 <input type="file" accept=".xlsx,.xls" data-account-import></label>
            <input data-account-q placeholder="별칭·예금주·계좌번호·브랜드·코드 검색" value="${h(state.procurement.accountQuery || "")}">
          </div>
          <div class="toolbar" style="margin-top:6px">
            ${[["", "전체", all.length], ["brand", "브랜드 연결", (counts.brand || 0) + (counts.both || 0)], ["partner", "거래처 연결", (counts.partner || 0) + (counts.both || 0)], ["none", "미연결", counts.none || 0]]
              .map(([k, l, n]) => `<button class="npb-subtab ${f === k ? "active" : ""}" data-account-filter="${k}">${l} ${n}</button>`).join("")}
            <span style="flex:1"></span>
            <label class="muted" style="font-size:12px">정렬 <select data-account-sort style="width:auto">${[["alias", "별칭"], ["code", "회사 코드"], ["bank", "은행"], ["holder", "예금주"], ["recent", "최근 등록"]].map(([k, l]) => `<option value="${k}" ${sort === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
          </div>
          <p class="muted">하나은행 '자주쓰는입금계좌관리'에서 내려받은 엑셀을 올리면 목록이 그 파일로 바뀝니다.
            같은 계좌번호는 브랜드 연결이 그대로 유지됩니다.</p>
        </div>
        <div class="table-wrap">
          <table class="compact accounts-table">
            <thead><tr><th>별칭</th><th>은행</th><th>계좌번호</th><th>예금주</th><th>구분</th><th>연결(회사 코드)</th><th></th></tr></thead>
            <tbody>${rowsAll.map(({ acc, link }) => `
              <tr class="hub-go ${state.procurement.editingAccount?.id === acc.id ? "selected" : ""}" data-row-edit="[data-edit-account]">
                <td>${codeTag(acc)}${h(acc.alias)}</td>
                <td>${h(acc.bankName)}</td>
                <td><code>${h(acc.accountNumber)}</code></td>
                <td>${h(acc.holder)}</td>
                <td><span class="badge ${link.kind === "none" ? "muted" : ""}">${ACCOUNT_KIND[link.kind]}</span></td>
                <td class="wrap">${link.brands.map((b) => `${b.code ? `<span class="code-tag">${h(b.code)}</span>` : ""}${h(b.name)}`).join("<br>")}${link.partner ? `${link.brands.length ? "<br>" : ""}${link.partner.code ? `<span class="code-tag">${h(link.partner.code)}</span>` : ""}${h(link.partner.name)} <span class="muted" style="font-size:11px">거래처</span>` : ""}</td>
                <td><div class="row-actions"><button data-edit-account="${h(acc.id)}">수정</button><button class="danger icon-btn" data-delete-account="${h(acc.id)}" aria-label="삭제" title="삭제">×</button></div></td>
              </tr>`).join("") || `<tr><td colspan="7" class="empty">해당하는 계좌가 없습니다.</td></tr>`}</tbody>
          </table>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>${a.id ? "계좌 수정" : "계좌 추가"}</h2></div>
        <div class="panel-body">
          <form class="form-grid" data-account-form>
            <div class="field"><label>별칭</label><input name="alias" value="${h(a.alias)}" placeholder="예: (주)안스펫"></div>
            <div class="field two">
              <div><label>은행</label><input name="bankName" value="${h(a.bankName)}" required placeholder="예: 기업은행"></div>
              <div><label>계좌번호 <span class="muted" style="font-weight:400">(하이픈은 자동으로 뺍니다)</span></label><input name="accountNumber" value="${h(a.accountNumber)}" required inputmode="numeric"></div>
            </div>
            <div class="field"><label>예금주</label><input name="holder" value="${h(a.holder)}"></div>
            ${a.id ? (() => {
              const linked = state.procurement.accountBrandIds ?? state.brands.filter((b) => b.transferAccountId === a.id).map((b) => b.id);
              const others = state.brands.filter((b) => (b.type || "brand") === "brand" && !linked.includes(b.id));
              return `<div class="field"><label>연결 브랜드 <span class="muted" style="font-weight:400">(브랜드 화면의 입금계좌와 같은 연결 — 어느 쪽에서 바꿔도 같습니다)</span></label>
                <div class="chip-list">${linked.map((id) => { const b = state.brands.find((x) => x.id === id); return b ? `<span class="chip">${b.code ? `<span class="code-tag">${h(b.code)}</span>` : ""}${h(b.name)}${b.transferAccountId && b.transferAccountId !== a.id ? ' <span class="muted" style="font-size:11px">(다른 계좌에서 옮겨 옴)</span>' : ""} <button type="button" class="chip-x" data-account-unlink="${h(id)}" title="연결 해제">×</button></span>` : ""; }).join("") || '<span class="muted">없음</span>'}</div>
                <select data-account-link style="margin-top:6px"><option value="">브랜드 추가…</option>${others.map((b) => `<option value="${h(b.id)}">${h(b.code ? `${b.code} · ` : "")}${h(b.name)}${b.transferAccountId ? " (다른 계좌 사용 중)" : ""}</option>`).join("")}</select></div>
                <div class="field"><label>거래처(사업자) 연결 <span class="muted" style="font-weight:400">(생산처·매입처 등 — 그 거래처 지급 계좌로 맞춰짐)</span></label>
                <select name="partnerId"><option value="">없음</option>${(state.partners || []).filter((p) => p.isActive !== false).map((p) => `<option value="${h(p.id)}" ${a.partnerId === p.id ? "selected" : ""}>${h(p.code ? `${p.code} · ` : "")}${h(p.name)}</option>`).join("")}</select></div>`;
            })() : `<p class="muted" style="font-size:12px">계좌를 추가한 뒤 브랜드·거래처를 연결할 수 있습니다.</p>`}
            <div class="toolbar">
              <button class="primary" type="submit">${a.id ? "수정 저장" : "계좌 추가"}</button>
              ${a.id ? `<button type="button" data-cancel-edit-account>취소</button>` : ""}
            </div>
          </form>
        </div>
      </div>
    </section>`;
}

function bindTransferAccounts() {
  const reload = async () => {
    state.transferAccounts = (await api("/api/transfer-accounts")).transferAccounts || [];
    state.brands = (await api("/api/brands")).brands;
    state.partners = (await api("/api/partners")).partners || state.partners;
    renderApp();
  };
  app.querySelector("[data-account-q]")?.addEventListener("change", (e) => {
    state.procurement.accountQuery = e.target.value;
    renderApp();
  });
  app.querySelectorAll("[data-account-filter]").forEach((b) => b.addEventListener("click", () => { state.procurement.accountFilter = b.dataset.accountFilter; renderApp(); }));
  app.querySelector("[data-account-sort]")?.addEventListener("change", (e) => { state.procurement.accountSort = e.target.value; renderApp(); });
  const linkedNow = () => state.procurement.accountBrandIds ?? state.brands.filter((b) => b.transferAccountId === state.procurement.editingAccount?.id).map((b) => b.id);
  app.querySelector("[data-account-link]")?.addEventListener("change", (e) => {
    if (!e.target.value) return;
    state.procurement.accountBrandIds = [...new Set([...linkedNow(), e.target.value])];
    renderApp();
  });
  app.querySelectorAll("[data-account-unlink]").forEach((b) => b.addEventListener("click", () => {
    state.procurement.accountBrandIds = linkedNow().filter((x) => x !== b.dataset.accountUnlink);
    renderApp();
  }));
  app.querySelector("[data-account-import]")?.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!confirm(`'${file.name}' 내용으로 계좌 목록을 바꿀까요?`)) { e.target.value = ""; return; }
    try {
      const res = await api("/api/transfer-accounts/import", {
        method: "POST",
        body: { fileBase64: await readFileAsBase64(file), fileName: file.name }
      });
      showToast(`계좌 ${res.total}개로 바꿨습니다 (추가 ${res.added} · 빠짐 ${res.removed}).`);
      await reload();
    } catch (error) {
      showToast(error.message || "계좌 목록을 올리지 못했습니다.", "error");
    }
  });
  app.querySelectorAll("[data-edit-account]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.procurement.editingAccount = (state.transferAccounts || []).find((x) => x.id === btn.dataset.editAccount) || null;
      state.procurement.accountBrandIds = null;
      renderApp();
    });
  });
  app.querySelector("[data-cancel-edit-account]")?.addEventListener("click", () => {
    state.procurement.editingAccount = null;
    state.procurement.accountBrandIds = null;
    renderApp();
  });
  app.querySelectorAll("[data-delete-account]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("이 계좌를 목록에서 삭제할까요? 브랜드에 입력된 은행·계좌번호는 그대로 남습니다.")) return;
      try {
        await api(`/api/transfer-accounts/${btn.dataset.deleteAccount}`, { method: "DELETE" });
        await reload();
      } catch (error) {
        showToast(error.message || "삭제하지 못했습니다.", "error");
      }
    });
  });
  app.querySelector("[data-account-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = formObject(event.currentTarget);
    const editing = state.procurement.editingAccount;
    if (editing) body.brandIds = linkedNow();
    try {
      if (editing) await api(`/api/transfer-accounts/${editing.id}`, { method: "PUT", body });
      else await api("/api/transfer-accounts", { method: "POST", body });
      state.procurement.editingAccount = null;
      state.procurement.accountBrandIds = null;
      showToast(editing ? "수정했습니다." : "추가했습니다.");
      await reload();
    } catch (error) {
      showToast(error.message || "저장하지 못했습니다.", "error");
    }
  });
}

function renderDeliveryPlaces() {
  const rows = (state.deliveryPlaces || []).slice().sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ko"));
  return `
    <section class="layout">
      <div class="panel">
        <div class="panel-head"><h2>납품지 목록</h2><span class="muted">${money.format(rows.length)}개</span></div>
        <div class="panel-body list-actions">
          <button class="primary" data-new-delivery-place>새 납품지</button>
          <button type="button" data-open-procurement-popup="deliveryPlace">새 창으로 입력</button>
          ${renderBulkExcelTools("deliveryPlace", "/api/delivery-places/export")}
        </div>
        <div class="table-wrap">
          <table class="delivery-places-table">
            <thead><tr><th>납품지명</th><th>주소</th><th>담당자</th><th>작업</th></tr></thead>
            <tbody>${rows.map(renderDeliveryPlaceRow).join("") || `<tr><td colspan="4" class="empty">등록된 납품지가 없습니다.</td></tr>`}</tbody>
          </table>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>${state.procurement.editingDeliveryPlace ? "납품지 수정" : "납품지 입력"}</h2></div>
        <div class="panel-body">${renderDeliveryPlaceForm()}</div>
      </div>
    </section>
  `;
}

function renderDeliveryPlaceRow(item) {
  return `
    <tr class="hub-go" data-row-edit="[data-edit-delivery-place]">
      <td>${codeTag(item)}${h(item.name)}</td>
      <td>${h(item.address)}</td>
      <td>${h(item.contactName)}${item.contactPhone ? ` · ${h(item.contactPhone)}` : ""}</td>
      <td><div class="row-actions"><button data-edit-delivery-place="${item.id}">수정</button><button data-edit-procurement-popup="deliveryPlace" data-record-id="${item.id}">새 창</button><button class="danger icon-btn" data-delete-delivery-place="${item.id}" aria-label="삭제" title="삭제">×</button></div></td>
    </tr>`;
}

function renderDeliveryPlaceForm() {
  const d = state.procurement.editingDeliveryPlace || {};
  return `
    <form class="form-grid" data-delivery-place-form>
      <div class="field"><label>납품지명</label><input name="name" value="${h(d.name)}" required></div>
      <div class="field"><label>주소</label><input name="address" value="${h(d.address)}"></div>
      <div class="field two">
        <div><label>담당자명</label><input name="contactName" value="${h(d.contactName)}"></div>
        <div><label>전화번호</label><input name="contactPhone" value="${h(d.contactPhone)}"></div>
      </div>
      <div class="field"><label>메모</label><textarea name="note">${h(d.note)}</textarea></div>
      <div class="toolbar">
        <button class="primary" type="submit">${d.id ? "수정 저장" : "납품지 추가"}</button>
        ${state.procurement.editingDeliveryPlace ? `<button type="button" data-cancel-edit-delivery-place>취소</button>` : ""}
      </div>
    </form>
  `;
}

function bindDeliveryPlaces() {
  bindBulkExcelTools("deliveryPlace", "/api/delivery-places/import");
  bindProcurementPopupButtons("deliveryPlace");
  app.querySelector("[data-new-delivery-place]")?.addEventListener("click", () => {
    state.procurement.editingDeliveryPlace = null;
    renderApp();
  });
  app.querySelectorAll("[data-edit-delivery-place]").forEach((button) => {
    button.addEventListener("click", () => {
      state.procurement.editingDeliveryPlace = (state.deliveryPlaces || []).find((item) => item.id === button.dataset.editDeliveryPlace);
      renderApp();
    });
  });
  app.querySelector("[data-cancel-edit-delivery-place]")?.addEventListener("click", () => {
    state.procurement.editingDeliveryPlace = null;
    renderApp();
  });
  app.querySelectorAll("[data-delete-delivery-place]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("이 납품지를 삭제할까요?")) return;
      try {
        await api(`/api/delivery-places/${button.dataset.deleteDeliveryPlace}`, { method: "DELETE" });
      } catch (error) {
        alert(error.message);
        return;
      }
      await refreshAndRender();
    });
  });
  app.querySelector("[data-delivery-place-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = formObject(event.currentTarget);
    const editing = state.procurement.editingDeliveryPlace;
    try {
      if (editing) {
        await api(`/api/delivery-places/${editing.id}`, { method: "PUT", body });
      } else {
        await api("/api/delivery-places", { method: "POST", body });
      }
    } catch (error) {
      alert(error.message);
      return;
    }
    state.procurement.editingDeliveryPlace = null;
    afterProcurementSave("deliveryPlace", editing ? "수정되었습니다." : "저장되었습니다.");
    await refreshAndRender();
  });
}

function renderPurchaseOrders() {
  const filter = state.procurement.docTypeFilter || "";
  const all = (state.purchaseOrders || []).slice()
    .sort((a, b) => (b.orderDate || "").localeCompare(a.orderDate || ""));
  const rows = filter ? all.filter((item) => (item.docType || "purchase_order") === filter) : all;
  const counts = all.reduce((acc, item) => {
    const key = item.docType || "purchase_order";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const tabs = [["", "전체", all.length]]
    .concat(TRADE_DOC_TYPES.map(([key, label]) => [key, label, counts[key] || 0]));
  const editing = state.procurement.editingPurchaseOrder;
  const formDocType = editing?.docType || state.procurement.formDocType || "purchase_order";
  const formLabel = TRADE_DOC_LABELS[formDocType] || "발주서";
  return `
    <div class="npb-subnav">
      ${tabs
        .map(([key, label, count]) =>
          `<button data-doc-type-tab="${key}" class="npb-subtab ${filter === key ? "active" : ""}">${label} <span class="muted">${count}</span></button>`)
        .join("")}
    </div>
    <section class="layout">
      <div class="panel">
        <div class="panel-head"><h2>${filter ? `${TRADE_DOC_LABELS[filter]} 목록` : "발행 문서 목록"}</h2><span class="muted">${money.format(rows.length)}건</span></div>
        <div class="panel-body list-actions">
          <button class="primary" data-new-purchase-order>새 ${formLabel}</button>
        </div>
        <div class="table-wrap">
          <table class="purchase-orders-table m-cards">
            <thead><tr><th>문서번호</th><th>양식</th><th>거래처</th><th>일자</th><th>상태</th><th>합계</th><th>작업</th></tr></thead>
            <tbody>${rows.map(renderPurchaseOrderRow).join("") || `<tr><td colspan="7" class="empty">등록된 문서가 없습니다.</td></tr>`}</tbody>
          </table>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>${editing ? `${formLabel} 수정` : `${formLabel} 작성`}</h2></div>
        <div class="panel-body">${renderPurchaseOrderForm()}</div>
      </div>
    </section>
    ${state.procurement.previewPurchaseOrder ? renderPurchaseOrderPreviewOverlay(state.procurement.previewPurchaseOrder) : ""}
  `;
}

// 다운로드하기 전에 실제로 어떤 내용이 들어가는지 한눈에 보여주는 미리보기다
// -- 엑셀 파일 자체를 그대로 렌더링하는 게 아니라(브라우저에서 xlsx를 보여줄
// 방법이 마땅치 않다), 같은 데이터를 발주서 양식과 비슷한 모양의 HTML로
// 보여준다. "일금 ○○원 정" 한글 금액 표기처럼 화면 확인에는 꼭 필요하지
// 않은 서식용 디테일은 뺐다 -- 실제 파일에는 그대로 들어간다.
// PDF는 서버에서 엑셀을 만든 뒤 LibreOffice로 변환하느라 몇 초 걸린다.
// 그냥 링크로 두면 눌러도 아무 반응이 없어 보여서 연타하게 되므로,
// 받아오는 동안 버튼을 잠그고 상태를 보여준다.
async function downloadTradeDocPdf(button, poId) {
  if (!poId || button.disabled) return;
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = "PDF 생성 중…";
  try {
    const res = await fetch(`/api/purchase-orders/${encodeURIComponent(poId)}/pdf`, {
      credentials: "same-origin"
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "PDF를 내려받지 못했습니다.");
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filenameFromResponse(res) || `${poId}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    showToast(error.message || "PDF를 내려받지 못했습니다.", "error");
  } finally {
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

// 채널별 업로드 샘플 양식. 파서가 찾는 열 이름으로 서버가 만들어 준다 —
// 매달 판매처 파일을 손으로 가공하다 열 이름이 어긋나 파싱이 깨지는 걸 막는
// 것이 목적이다. 양식이 정해져 있지 않은 채널은 서버가 그 사실을 알려 준다.
async function downloadNpbSampleForm(button, code) {
  if (!code || button.disabled) return;
  const label = button.textContent;
  button.disabled = true;
  button.textContent = "준비 중…";
  try {
    const res = await fetch(`/api/npb/sample-form?channel=${encodeURIComponent(code)}`, {
      credentials: "same-origin"
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "샘플양식을 내려받지 못했습니다.");
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filenameFromResponse(res) || `샘플양식_${code}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    showToast(error.message || "샘플양식을 내려받지 못했습니다.", "error");
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

// 서버가 붙인 한글 파일명(발주서_PO-20260929-001.pdf)을 그대로 쓴다.
// 한글은 RFC 5987 형식(filename*)으로 오므로 그쪽을 먼저 본다.
function filenameFromResponse(res) {
  const header = res.headers.get("content-disposition") || "";
  const encoded = header.match(/filename\*=UTF-8''([^;]+)/i);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1]);
    } catch {}
  }
  const plain = header.match(/filename="([^"]+)"/i);
  return plain ? plain[1] : "";
}

function renderPurchaseOrderPreviewOverlay(poId) {
  const po = (state.purchaseOrders || []).find((item) => item.id === poId);
  if (!po) return "";
  const partner = (state.partners || []).find((p) => p.id === po.partnerId) || {};
  const issuer = po.issuer || {};
  const items = Array.isArray(po.lineItems) ? po.lineItems : [];
  const docType = po.docType || "purchase_order";
  const docLabel = TRADE_DOC_LABELS[docType] || "발주서";
  const meta = tradeDocMeta(docType);
  // 실제 엑셀과 같은 규칙 -- 견적서/청구서에는 납품장소를 싣지 않는다.
  const showDelivery = docType === "purchase_order" || docType === "statement";
  const deliveryFields = showDelivery ? deliveryPlaceFields(po.deliveryPlace) : [];
  const priceMode = po.priceMode || "supply";
  // 돈이 들어오는 양식(거래명세서/청구서)만 입금요청으로 이어진다 — 발주서는
  // 우리가 지급하는 쪽이라 해당 없음.
  const canHandoffToRequest = docType === "statement" || docType === "invoice";
  const closing = {
    purchase_order: "위와 같이 발주합니다.",
    quote: "위와 같이 견적합니다.",
    statement: "위와 같이 거래명세서를 발행합니다.",
    invoice: "위와 같이 청구합니다."
  }[docType] || "위와 같이 발주합니다.";
  return `
    <div class="po-preview-overlay" data-po-preview-overlay>
      <div class="po-preview-modal">
        <div class="po-preview-toolbar">
          <strong>${h(docLabel)} 미리보기 · ${h(po.docNo)}</strong>
          <div>
            ${canHandoffToRequest ? `<button type="button" data-po-to-request="${po.id}">입금요청 생성</button>` : ""}
            <button class="primary" type="button" data-po-pdf="${po.id}">PDF 다운로드</button>
            <a href="/api/purchase-orders/${po.id}/excel"><button type="button">엑셀 다운로드</button></a>
            <button type="button" data-close-po-preview>닫기</button>
          </div>
        </div>
        <div class="po-doc">
          <div class="po-doc-header">
            <div class="po-doc-issuer">${h(issuer.businessName || "")}</div>
            <div>
              <div class="po-doc-docno">${h(po.docNo)}</div>
              <div class="po-doc-title">${h(docLabel.split("").join("\u2009"))}</div>
            </div>
          </div>
          <div class="po-doc-info">
            <div class="po-doc-info-block">
              <div class="po-doc-info-label">수신 To</div>
              <div class="po-doc-info-row"><span>수신</span><strong>${h(partner.businessName || partner.name || "")}</strong></div>
              <div class="po-doc-info-row"><span>사업자번호</span>${h(partner.businessNumber)}</div>
              <div class="po-doc-info-row"><span>대표자</span>${h(partner.representativeName)}</div>
              <div class="po-doc-info-row"><span>주소</span>${h(partner.address)}</div>
              <div class="po-doc-info-row"><span>담당자</span>${[partner.contactName, partner.contactEmail].filter(Boolean).map(h).join(" ")}</div>
              <div class="po-doc-info-row"><span>이메일</span>${h(partner.invoiceEmail)}</div>
              <div class="po-doc-info-row"><span>${h(meta.dateLabel)}</span>${h(po.orderDate)}</div>\n              ${meta.dueLabel && po.dueDate ? `<div class="po-doc-info-row"><span>${h(meta.dueLabel)}</span>${h(po.dueDate)}</div>` : ""}
            </div>
            <div class="po-doc-info-block">
              <div class="po-doc-info-label">${docType === "purchase_order" ? "발주처" : "공급자"} Provider</div>
              <div class="po-doc-info-row"><span>사업자번호</span>${h(issuer.businessNumber)}</div>
              <div class="po-doc-info-row"><span>상호</span><strong>${h(issuer.businessName)}</strong></div>
              <div class="po-doc-info-row"><span>대표자</span>${h(issuer.representativeName)}</div>
              <div class="po-doc-info-row"><span>주소</span>${h(issuer.address)}</div>
              <div class="po-doc-info-row"><span>이메일</span>${h(issuer.invoiceEmail)}</div>
              <div class="po-doc-info-row"><span>계좌</span>${h(issuer.bankInfo)}</div>
            </div>
          </div>
          ${deliveryFields.length ? `
          <div class="po-doc-delivery">
            ${deliveryFields.map(([label, value]) => `<div class="po-doc-info-row"><span>${h(label)}</span>${h(value)}</div>`).join("")}
          </div>` : ""}
          <table class="po-doc-table">
            <thead><tr><th>순번</th><th>상품코드</th><th>품목명</th><th>규격</th><th>소비자정가</th><th>수량</th><th>단가</th><th>공급가합계</th></tr></thead>
            <tbody>
              ${items.map((item, i) => {
                const prices = poItemDisplayPrices(item, priceMode);
                return `
                <tr>
                  <td class="po-doc-center">${i + 1}</td>
                  <td>${h(item.itemCode)}</td>
                  <td>${h(item.itemName)}</td>
                  <td>${h(item.spec)}</td>
                  <td class="num">${item.consumerPrice ? money.format(item.consumerPrice) : ""}</td>
                  <td class="po-doc-center">${money.format(item.quantity || 0)}</td>
                  <td class="num">${money.format(prices.unitPrice)}</td>
                  <td class="num po-doc-amount">${money.format(prices.totalPrice)}</td>
                </tr>`;
              }).join("") || `<tr><td colspan="8" class="empty">추가된 품목이 없습니다.</td></tr>`}
            </tbody>
          </table>
          <div class="po-doc-footer">
            <div class="po-doc-notes">
              <div class="po-doc-notes-label">Notes</div>
              <div class="po-doc-notes-body">${h(po.note || "").replace(/\n/g, "<br>")}</div>
            </div>
            <div class="po-doc-totals">
              <div class="po-doc-total-row"><span>총 공급가액</span><span class="num">${money.format(po.subtotal || 0)}</span></div>
              <div class="po-doc-total-row"><span>총 부가세</span><span class="num">${money.format(po.vat || 0)}</span></div>
              <div class="po-doc-total-row po-doc-total-row-grand"><span>총 합계금액</span><span class="num">${money.format(po.total || 0)}</span></div>
            </div>
          </div>
          <div class="po-doc-closing">${h(closing)}</div>
        </div>
      </div>
    </div>
  `;
}

// deliveryPlace 스냅샷을 [라벨, 값] 줄 목록으로 편다 -- 값이 있는 필드만.
// 엑셀 생성 스크립트(trade_doc_common.py)의 delivery_fields와 같은 규칙이고,
// 구조화 이전에 저장된 옛 발주서의 문자열 형태는 '납품장소' 한 줄로 통과한다.
function deliveryPlaceFields(delivery) {
  if (typeof delivery === "string") {
    return delivery.trim() ? [["납품장소", delivery]] : [];
  }
  if (!delivery || typeof delivery !== "object") return [];
  return [
    ["납품장소명", delivery.name],
    ["주소", delivery.address],
    ["담당자명", delivery.contactName],
    ["전화번호", delivery.contactPhone],
    ["배송메모", delivery.note]
  ].filter(([, value]) => value && String(value).trim());
}

function renderPurchaseOrderRow(item) {
  const partner = (state.partners || []).find((p) => p.id === item.partnerId);
  return `
    <tr>
      <td class="m-sub"><span class="code-tag">${h(item.docNo)}</span></td>
      <td class="m-hide">${h(TRADE_DOC_LABELS[item.docType || "purchase_order"] || "발주서")}</td>
      <td class="m-title">${h(partner?.name || "")}</td>
      <td class="m-sub">${h(item.orderDate)}${item.dueDate ? `<br><span class="muted" style="font-size:11px">${h(tradeDocMeta(item.docType).dueLabel)} ${h(item.dueDate)}</span>` : ""}</td>
      <td class="m-status"><span class="pill po-st-${h(item.status)}">${PO_STATUS_LABELS[item.status] || item.status}</span></td>
      <td class="num m-amount"><strong>${money.format(item.total)}원</strong><br><span class="muted" style="font-size:11px">공급가 ${money.format(Number(item.subtotal || 0))} · 부가세 ${money.format(Number(item.vat || 0))}</span></td>
      <td class="m-actions"><div class="row-actions">
        <button data-edit-purchase-order="${item.id}">수정</button>
        <button type="button" data-preview-purchase-order="${item.id}">미리보기</button>
        <a href="/api/purchase-orders/${item.id}/excel"><button type="button">엑셀</button></a>
        <button type="button" data-po-pdf="${item.id}">PDF</button>
        <button class="danger icon-btn" data-delete-purchase-order="${item.id}" aria-label="삭제" title="삭제">×</button>
      </div></td>
    </tr>`;
}

// 문서 종류별 품목 고르기(섞여 보이지 않게): 발주서 = 자재·거래처 상품, 명세서·청구서·견적서 = 제품·거래처 상품.
// 받는 거래처의 품목을 먼저, 안 쓰는 품목은 뺀다.
function poItemOptions(docType, partnerId) {
  const kinds = docType === "purchase_order" ? ["material", "vendorProduct"] : ["product", "vendorProduct"];
  return (state.materials || []).filter((m) => m.isActive !== false && kinds.includes(itemKindOf(m)))
    .sort((a, b) => Number(b.partnerId === partnerId) - Number(a.partnerId === partnerId) || String(a.itemName).localeCompare(String(b.itemName), "ko"))
    .map((m) => `<option value="${h(m.itemName)}">${h([m.code, m.barcode, m.discontinued ? "단종" : ""].filter(Boolean).join(" · "))}</option>`).join("");
}

function renderPurchaseOrderForm() {
  const po = state.procurement.editingPurchaseOrder || {};
  const lineItems = Array.isArray(po.lineItems) ? po.lineItems : [];
  const docType = po.docType || state.procurement.formDocType || "purchase_order";
  const meta = tradeDocMeta(docType);
  // 금액 기준: 문서에 저장된 값 > 수신처 거래처의 기본값 > 공급가 기준.
  const selectedPartner = (state.partners || []).find((p) => p.id === po.partnerId);
  const priceMode = po.priceMode || selectedPartner?.priceMode || "supply";
  return `
    <form class="form-grid" data-purchase-order-form>
      <div class="field two">
        <div>
          <label>양식</label>
          <select name="docType" data-po-doc-type>
            ${TRADE_DOC_TYPES.map(([key, label]) => `<option value="${key}" ${docType === key ? "selected" : ""}>${label}</option>`).join("")}
          </select>
        </div>
        <div>
          <label>발행자(우리 회사)</label>
          <select name="issuerPartnerId" required>
            <option value="">발행자 선택</option>
            ${partnerSelectOptions(po.issuerPartnerId, "issuer").join("")}
          </select>
        </div>
      </div>
      <div class="field two">
        <div>
          <label>수신처</label>
          <select name="partnerId" required>
            <option value="">거래처 선택</option>
            ${partnerSelectOptionsForDoc(po.partnerId, meta.defaultCategory).join("")}
          </select>
        </div>
        <div>
          <label>금액 기준</label>
          <select name="priceMode" data-po-price-mode>
            <option value="supply" ${priceMode === "gross" ? "" : "selected"}>부가세 별도 (공급가)</option>
            <option value="gross" ${priceMode === "gross" ? "selected" : ""}>부가세 포함</option>
          </select>
        </div>
      </div>
      <div class="field two">
        <div><label>${h(meta.dateLabel)}</label><input name="orderDate" type="date" value="${h(po.orderDate || new Date().toISOString().slice(0, 10))}"></div>
        ${meta.dueLabel
          ? `<div><label>${h(meta.dueLabel)}</label><input name="dueDate" type="date" value="${h(po.dueDate || "")}"></div>`
          : `<div>
              <label>상태</label>
              <select name="status">
                ${Object.entries(PO_STATUS_LABELS).map(([key, label]) => `<option value="${key}" ${(po.status || "ordered") === key ? "selected" : ""}>${label}</option>`).join("")}
              </select>
            </div>`}
      </div>
      ${meta.dueLabel ? `
        <div class="field">
          <label>상태</label>
          <select name="status">
            ${Object.entries(PO_STATUS_LABELS).map(([key, label]) => `<option value="${key}" ${(po.status || "ordered") === key ? "selected" : ""}>${label}</option>`).join("")}
          </select>
        </div>` : ""}
      <div class="field">
        <label>납품장소 <span class="muted" style="font-weight:400">(선택 입력)</span></label>
        <datalist id="po-delivery-place-options">
          ${(state.deliveryPlaces || []).map((d) => `<option value="${h(d.name)}">`).join("")}
        </datalist>
        <input name="deliveryPlaceName" list="po-delivery-place-options" placeholder="납품장소명 (검색 또는 신규 입력)" value="${h(po.deliveryPlace?.name)}">
        <div class="field four" style="margin-top:6px">
          <div><input name="deliveryPlaceAddress" placeholder="주소" value="${h(po.deliveryPlace?.address)}"></div>
          <div><input name="deliveryPlaceContactName" placeholder="담당자명" value="${h(po.deliveryPlace?.contactName)}"></div>
          <div><input name="deliveryPlaceContactPhone" placeholder="전화번호" value="${h(po.deliveryPlace?.contactPhone)}"></div>
          <div><input name="deliveryPlaceNote" placeholder="배송 메모" value="${h(po.deliveryPlace?.note)}"></div>
        </div>
        <label class="muted" style="display:flex;align-items:center;gap:6px;margin-top:6px;font-weight:400">
          <input type="checkbox" name="saveDeliveryPlace"> 이 납품장소 저장 (다음부터 목록에서 선택 가능)
        </label>
      </div>
      <input type="hidden" name="lineItemsJson" value='${h(JSON.stringify(lineItems))}'>
      <div class="field">
        <label>품목 추가</label>
        <datalist id="po-material-options">
          ${poItemOptions(docType, po.partnerId)}
        </datalist>
        <div class="field four">
          <div><input data-po-item-name list="po-material-options" placeholder="${docType === "purchase_order" ? "자재·거래처 상품" : "제품·거래처 상품"} (검색 또는 신규 입력)"></div>
          <div><input data-po-item-code placeholder="상품코드 (카탈로그 매칭 시 자동)"></div>
          <div><input data-po-item-spec placeholder="규격"></div>
          <div><input data-po-item-qty type="number" min="1" value="1" placeholder="수량"></div>
        </div>
        <div class="field four" style="margin-top:8px">
          <div>
            <label class="sub-label">소비자정가 (개당)</label>
            <input data-po-item-consumer type="number" min="0" step="1" placeholder="선택 입력">
          </div>
          <div>
            <label class="sub-label">공급가 (개당)</label>
            <input data-po-item-price type="number" min="0" step="1" placeholder="부가세 제외">
          </div>
          <div>
            <label class="sub-label">세액 (10%)</label>
            <input data-po-item-vat type="number" min="0" step="1" placeholder="자동 계산">
          </div>
          <div>
            <label class="sub-label">합계 (개당)</label>
            <input data-po-item-gross type="number" min="0" step="1" placeholder="부가세 포함">
          </div>
        </div>
        <p class="muted" style="margin:6px 0 0;font-size:11px">
          공급가를 넣으면 세액·합계가 채워지고, 합계를 넣으면 공급가·세액을 거꾸로 계산합니다.
        </p>
        <button type="button" data-add-po-line-item style="margin-top:8px">품목 추가</button>
      </div>
      <div data-po-line-items-table>${renderPurchaseOrderLineItems(lineItems, priceMode)}</div>
      <div data-po-summary>${renderPurchaseOrderSummary(lineItems, priceMode)}</div>
      <div class="field"><label>메모</label><textarea name="note">${h(po.note)}</textarea></div>
      <div class="toolbar">
        <button class="primary" type="submit">${po.id ? "수정 저장" : "발주서 생성"}</button>
        ${state.procurement.editingPurchaseOrder ? `<button type="button" data-cancel-edit-purchase-order>취소</button>` : ""}
      </div>
    </form>
  `;
}

// 품목의 부가세 포함 단가. grossUnitPrice가 없는(이 필드 이전에 저장된)
// 품목은 공급가에 10%를 붙여 되살린다 — 서버 sanitize와 같은 규칙.
function poItemGrossUnitPrice(item) {
  const gross = Math.round(Number(item.grossUnitPrice) || 0);
  if (gross > 0) return gross;
  const supply = Math.round(Number(item.unitPrice) || 0);
  return supply + Math.round(supply * 0.1);
}

// 문서의 금액 기준(priceMode)에 따라 그 줄의 표시 단가/합계를 고른다.
function poItemDisplayPrices(item, priceMode) {
  // 단가·합계는 1원 단위 정수로만 다룬다 — 이 규칙 이전에 소수점으로
  // 저장된 품목도 여기서 반올림되어 소수점 없이 표기된다.
  const unitPrice = priceMode === "gross"
    ? poItemGrossUnitPrice(item)
    : Math.round(Number(item.unitPrice) || 0);
  return { unitPrice, totalPrice: Math.round((Number(item.quantity) || 0) * unitPrice) };
}

function renderPurchaseOrderLineItems(items, priceMode) {
  if (!items.length) return `<div class="empty">추가된 품목이 없습니다.</div>`;
  return `
    <table class="line-items-table">
      <thead><tr><th>작업</th><th>상품코드</th><th>품목명</th><th>규격</th><th>소비자정가</th><th>수량</th><th>단가</th><th>공급가합계</th></tr></thead>
      <tbody>
        ${items.map((item) => {
          const prices = poItemDisplayPrices(item, priceMode);
          return `
          <tr data-po-line-row="${item.id}">
            <td><button type="button" class="danger icon-btn" data-remove-po-line-item="${item.id}" aria-label="삭제" title="삭제">×</button></td>
            <td>${h(item.itemCode)}</td>
            <td>${h(item.itemName)}</td>
            <td>${h(item.spec)}</td>
            <td>${item.consumerPrice ? money.format(item.consumerPrice) : ""}</td>
            <td>${h(item.quantity)}</td>
            <td>${money.format(prices.unitPrice)}</td>
            <td>${money.format(prices.totalPrice)}</td>
          </tr>`;
        }).join("")}
      </tbody>
    </table>
  `;
}

// 부가세 포함 금액에서 공급가를 되돌린다. 세액은 이 값을 10%로 다시 구하지
// 말고 "합계 - 공급가"로 쓸 것 — 반올림 때문에 1원이 어긋나면, 거래처가 준
// 합계 금액과 우리 문서의 금액이 달라진다.
function supplyFromGross(gross) {
  return Math.round(Math.max(0, Number(gross) || 0) / 1.1);
}

function renderPurchaseOrderSummary(items, priceMode) {
  // 서버 purchaseOrderTotals와 같은 규칙 — 사용자가 입력한 기준 금액이
  // 1원도 틀어지지 않는 방향으로 반올림한다.
  let subtotal, vat, total;
  if (priceMode === "gross") {
    total = items.reduce((sum, item) => sum + poItemDisplayPrices(item, "gross").totalPrice, 0);
    subtotal = Math.round(total / 1.1);
    vat = total - subtotal;
  } else {
    subtotal = items.reduce((sum, item) => sum + Number(item.totalPrice || 0), 0);
    vat = Math.round(subtotal * 0.1);
    total = subtotal + vat;
  }
  return `
    <div class="line-items-summary">
      <span><b>공급가 합계</b> ${money.format(subtotal)}원</span>
      <span><b>부가세(10%)</b> ${money.format(vat)}원</span>
      <span><b>최종 합계</b> ${money.format(total)}원</span>
    </div>
  `;
}

function bindPurchaseOrders() {
  app.querySelectorAll("[data-doc-type-tab]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const key = btn.dataset.docTypeTab;
      state.procurement.docTypeFilter = key;
      // 탭에서 양식을 고르면 작성 폼도 그 양식으로 맞춘다 -- 목록과 폼이
      // 따로 놀면 "견적서 탭인데 발주서가 써지는" 혼란이 생긴다.
      if (key) state.procurement.formDocType = key;
      state.procurement.editingPurchaseOrder = null;
      renderApp();
    });
  });
  // 폼에서 양식을 바꾸면 날짜 라벨과 수신처 기본 분류가 달라지므로 다시 그린다.
  app.querySelector("[data-po-doc-type]")?.addEventListener("change", (event) => {
    state.procurement.formDocType = event.target.value;
    if (state.procurement.editingPurchaseOrder) {
      state.procurement.editingPurchaseOrder = {
        ...state.procurement.editingPurchaseOrder,
        docType: event.target.value
      };
    }
    renderApp();
  });
  app.querySelector("[data-new-purchase-order]")?.addEventListener("click", () => {
    state.procurement.editingPurchaseOrder = null;
    renderApp();
  });
  app.querySelectorAll("[data-edit-purchase-order]").forEach((button) => {
    button.addEventListener("click", () => {
      state.procurement.editingPurchaseOrder = state.purchaseOrders.find((item) => item.id === button.dataset.editPurchaseOrder);
      renderApp();
    });
  });
  app.querySelector("[data-cancel-edit-purchase-order]")?.addEventListener("click", () => {
    state.procurement.editingPurchaseOrder = null;
    renderApp();
  });
  app.querySelectorAll("[data-delete-purchase-order]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("이 발주서를 삭제할까요?")) return;
      try {
        await api(`/api/purchase-orders/${button.dataset.deletePurchaseOrder}`, { method: "DELETE" });
      } catch (error) {
        alert(error.message);
        return;
      }
      await refreshAndRender();
    });
  });
  app.querySelectorAll("[data-preview-purchase-order]").forEach((button) => {
    button.addEventListener("click", () => {
      state.procurement.previewPurchaseOrder = button.dataset.previewPurchaseOrder;
      renderApp();
    });
  });
  app.querySelectorAll("[data-po-pdf]").forEach((button) => {
    button.addEventListener("click", () => downloadTradeDocPdf(button, button.dataset.poPdf));
  });
  // 거래명세서/청구서 금액을 그대로 입금요청 초안으로 넘긴다 — 파이프라인
  // 확인 표가 쓰는 것과 같은 localStorage 다리. 브랜드는 요청 창에서 고른다.
  app.querySelectorAll("[data-po-to-request]").forEach((button) => {
    button.addEventListener("click", () => {
      const po = (state.purchaseOrders || []).find((item) => item.id === button.dataset.poToRequest);
      if (!po) return;
      const partner = (state.partners || []).find((p) => p.id === po.partnerId);
      const draft = {
        orderNo: po.docNo,
        customerName: partner?.name || partner?.businessName || "",
        quantity: (po.lineItems || []).reduce((sum, item) => sum + Number(item.quantity || 0), 0),
        depositAmount: po.total || 0,
        productSalesAmount: po.total || 0,
        notes: `${TRADE_DOC_LABELS[po.docType] || "발주서"} ${po.docNo} 금액 기준으로 생성`
      };
      try {
        localStorage.setItem(DRAFT_PREFILL_KEY, JSON.stringify(draft));
      } catch {
        showToast("입금요청 창으로 넘기지 못했습니다.", "error");
        return;
      }
      window.open("/?request-popup=1&draft-prefill=1", "wooofpay-request", "width=760,height=940,resizable=yes,scrollbars=yes");
    });
  });
  app.querySelector("[data-close-po-preview]")?.addEventListener("click", () => {
    state.procurement.previewPurchaseOrder = null;
    renderApp();
  });
  // 배경(오버레이 자체) 클릭은 닫고, 모달 내용 클릭은 전파를 막아 안 닫히게 한다.
  app.querySelector("[data-po-preview-overlay]")?.addEventListener("click", (event) => {
    if (event.target.dataset.poPreviewOverlay !== undefined) {
      state.procurement.previewPurchaseOrder = null;
      renderApp();
    }
  });

  const form = app.querySelector("[data-purchase-order-form]");
  if (!form) return;
  const lineItemsInput = form.querySelector("[name=lineItemsJson]");
  const lineItemsSlot = form.querySelector("[data-po-line-items-table]");
  const summarySlot = form.querySelector("[data-po-summary]");
  const getLineItems = () => {
    try {
      return JSON.parse(lineItemsInput.value || "[]");
    } catch {
      return [];
    }
  };
  const bindPoLineItemRemovers = () => {
    lineItemsSlot.querySelectorAll("[data-remove-po-line-item]").forEach((button) => {
      button.addEventListener("click", () => {
        setLineItems(getLineItems().filter((item) => item.id !== button.dataset.removePoLineItem));
      });
    });
  };
  const priceModeSelect = form.querySelector("[data-po-price-mode]");
  const currentPriceMode = () => (priceModeSelect?.value === "gross" ? "gross" : "supply");
  const setLineItems = (items) => {
    lineItemsInput.value = JSON.stringify(items);
    lineItemsSlot.innerHTML = renderPurchaseOrderLineItems(items, currentPriceMode());
    if (summarySlot) summarySlot.innerHTML = renderPurchaseOrderSummary(items, currentPriceMode());
    bindPoLineItemRemovers();
  };
  bindPoLineItemRemovers();
  // 금액 기준을 바꾸면 품목 표와 합계의 표시 금액이 달라지므로 다시 그린다.
  priceModeSelect?.addEventListener("change", () => setLineItems(getLineItems()));
  // 수신처를 바꾸면 그 거래처의 기본 금액 기준을 따라간다 — 이후에 다시
  // 수동으로 바꾸는 것은 자유.
  form.querySelector("[name=partnerId]")?.addEventListener("change", (event) => {
    const partner = (state.partners || []).find((p) => p.id === event.target.value);
    if (partner && priceModeSelect) {
      priceModeSelect.value = partner.priceMode === "gross" ? "gross" : "supply";
      setLineItems(getLineItems());
    }
  });

  // 거래처마다 단가를 주는 기준이 다르다 — 어떤 곳은 공급가(부가세 별도),
  // 어떤 곳은 합계(부가세 포함)로 준다. 둘 중 아는 쪽을 넣으면 나머지를
  // 채워준다. 저장되는 값은 예전과 똑같이 공급가(unitPrice) 하나뿐이고,
  // 세액·합계 칸은 입력을 돕는 계산기일 뿐이다.
  const priceInput = form.querySelector("[data-po-item-price]");
  const vatInput = form.querySelector("[data-po-item-vat]");
  const grossInput = form.querySelector("[data-po-item-gross]");

  const clearMoneyInputs = () => {
    if (priceInput) priceInput.value = "";
    if (vatInput) vatInput.value = "";
    if (grossInput) grossInput.value = "";
  };

  // 공급가가 비어 있고 합계만 적혀 있으면 합계에서 거꾸로 계산한다.
  const resolveUnitPrice = (fallback) => {
    if (priceInput && priceInput.value !== "") return Math.round(Math.max(0, Number(priceInput.value) || 0));
    if (grossInput && grossInput.value !== "") return supplyFromGross(Number(grossInput.value) || 0);
    return Math.round(Math.max(0, Number(fallback) || 0));
  };

  if (priceInput && vatInput && grossInput) {
    priceInput.addEventListener("input", () => {
      if (priceInput.value === "") {
        vatInput.value = "";
        grossInput.value = "";
        return;
      }
      const supply = Math.round(Math.max(0, Number(priceInput.value) || 0));
      const vat = Math.round(supply * 0.1);
      vatInput.value = String(vat);
      grossInput.value = String(supply + vat);
    });
    grossInput.addEventListener("input", () => {
      if (grossInput.value === "") {
        priceInput.value = "";
        vatInput.value = "";
        return;
      }
      const gross = Math.round(Math.max(0, Number(grossInput.value) || 0));
      const supply = supplyFromGross(gross);
      priceInput.value = String(supply);
      // 세액을 따로 10%로 다시 구하지 않고 차액으로 둔다 — 그래야 거래처가
      // 알려준 합계 금액이 1원도 틀어지지 않는다.
      vatInput.value = String(gross - supply);
    });
  }

  // 품목명이 카탈로그와 정확히 일치하면(datalist에서 고른 경우) 상품코드와
  // 소비자정가를 바로 채워서, 추가하기 전에 눈으로 확인할 수 있게 한다.
  const poItemNameInput = form.querySelector("[data-po-item-name]");
  poItemNameInput?.addEventListener("input", () => {
    const matched = (state.materials || []).find((m) => m.itemName.trim() === poItemNameInput.value.trim());
    if (!matched) return;
    const codeInput = form.querySelector("[data-po-item-code]");
    const consumerInput = form.querySelector("[data-po-item-consumer]");
    if (codeInput && !codeInput.value.trim()) codeInput.value = matched.itemCode || "";
    if (consumerInput && consumerInput.value === "" && Number(matched.consumerPrice)) {
      consumerInput.value = String(matched.consumerPrice);
    }
  });

  form.querySelector("[data-add-po-line-item]")?.addEventListener("click", async () => {
    const nameInput = form.querySelector("[data-po-item-name]");
    const codeInput = form.querySelector("[data-po-item-code]");
    const specInput = form.querySelector("[data-po-item-spec]");
    const qtyInput = form.querySelector("[data-po-item-qty]");
    const consumerInput = form.querySelector("[data-po-item-consumer]");
    const name = nameInput.value.trim();
    if (!name) return;
    const material = (state.materials || []).find((m) => m.itemName.trim() === name);
    const quantity = Math.max(1, Number(qtyInput.value) || 1);
    const unitPrice = resolveUnitPrice(material?.basePrice);
    // 포함 단가는 합계 칸에 적힌 값을 그대로 보존한다 — 공급가에서 10%를
    // 다시 붙이면 입력한 포함가와 1원이 어긋날 수 있다.
    const grossUnitPrice = grossInput && grossInput.value !== ""
      ? Math.round(Math.max(0, Number(grossInput.value) || 0))
      : unitPrice + Math.round(unitPrice * 0.1);
    // 상품코드·소비자정가는 직접 입력이 우선, 비어 있으면 카탈로그 값.
    const itemCode = codeInput.value.trim() || material?.itemCode || "";
    const consumerPrice = consumerInput.value !== ""
      ? Math.round(Math.max(0, Number(consumerInput.value) || 0))
      : Math.round(Number(material?.consumerPrice) || 0);
    const newItemId = cryptoRandomId();
    const items = getLineItems();
    items.push({
      id: newItemId,
      materialId: material?.id || "",
      itemCode,
      itemName: name,
      spec: specInput.value.trim(),
      consumerPrice,
      quantity,
      unit: material?.orderUnit || "",
      unitPrice,
      grossUnitPrice,
      totalPrice: Math.round(quantity * unitPrice)
    });
    setLineItems(items);
    nameInput.value = "";
    codeInput.value = "";
    specInput.value = "";
    qtyInput.value = "1";
    consumerInput.value = "";
    clearMoneyInputs();
    nameInput.focus();
    const formDocType = form.querySelector("[name=docType]")?.value || "purchase_order";
    if (!material && confirm(`"${name}" 품목을 품목 목록에 등록할까요?`)) {
      const partnerId = form.querySelector("[name=partnerId]").value;
      // 발주서에서 새로 쓴 품목은 자재, 명세서·청구서·견적서는 거래처 상품(분류 확인 표시)으로 둔다.
      const kindBody = formDocType === "purchase_order" ? { itemKind: "material", materialType: "SB" } : { itemKind: "vendorProduct", needsReview: true };
      const created = await api("/api/materials", {
        method: "POST",
        body: { itemName: name, itemCode, orderUnit: "", basePrice: unitPrice, consumerPrice, partnerId, ...kindBody }
      });
      state.materials.push(created.material);
      // await 뒤에는 items가 stale할 수 있다(그 사이 사용자가 품목을 더
      // 추가했을 수 있음) — getLineItems()로 현재값을 다시 읽어서, 방금 추가한
      // 그 줄(newItemId)만 콕 집어 수정한다. 전체 배열을 통째로 덮어쓰면
      // 동시에 추가된 다른 품목이 조용히 사라진다.
      const currentItems = getLineItems();
      const target = currentItems.find((item) => item.id === newItemId);
      if (target) target.materialId = created.material.id;
      setLineItems(currentItems);
      const datalist = form.querySelector("#po-material-options");
      if (datalist) {
        datalist.innerHTML = poItemOptions(formDocType, form.querySelector("[name=partnerId]")?.value || "");
      }
    }
  });

  const deliveryNameInput = form.querySelector("[name=deliveryPlaceName]");
  const deliveryAddressInput = form.querySelector("[name=deliveryPlaceAddress]");
  const deliveryContactNameInput = form.querySelector("[name=deliveryPlaceContactName]");
  const deliveryContactPhoneInput = form.querySelector("[name=deliveryPlaceContactPhone]");
  const deliveryNoteInput = form.querySelector("[name=deliveryPlaceNote]");
  let lastAutofillName = null;
  deliveryNameInput?.addEventListener("input", () => {
    const typed = deliveryNameInput.value.trim();
    const match = (state.deliveryPlaces || []).find((d) => d.name === typed);
    if (match) {
      lastAutofillName = match.name;
      deliveryAddressInput.value = match.address || "";
      deliveryContactNameInput.value = match.contactName || "";
      deliveryContactPhoneInput.value = match.contactPhone || "";
      deliveryNoteInput.value = match.note || "";
      return;
    }
    // 이전에 목록에서 자동 채워졌던 값인데, 사용자가 이름을 바꿔서 더 이상
    // 매칭되지 않으면 그 자동 채움 값이 새 이름과 함께 그대로 남아있으면 안 된다.
    if (lastAutofillName !== null) {
      lastAutofillName = null;
      deliveryAddressInput.value = "";
      deliveryContactNameInput.value = "";
      deliveryContactPhoneInput.value = "";
      deliveryNoteInput.value = "";
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = formObject(event.currentTarget);
    body.lineItems = getLineItems();
    body.deliveryPlace = {
      name: String(body.deliveryPlaceName || "").trim(),
      address: String(body.deliveryPlaceAddress || "").trim(),
      contactName: String(body.deliveryPlaceContactName || "").trim(),
      contactPhone: String(body.deliveryPlaceContactPhone || "").trim(),
      note: String(body.deliveryPlaceNote || "").trim()
    };
    const saveDeliveryPlace = body.saveDeliveryPlace === "on";
    delete body.deliveryPlaceName;
    delete body.deliveryPlaceAddress;
    delete body.deliveryPlaceContactName;
    delete body.deliveryPlaceContactPhone;
    delete body.deliveryPlaceNote;
    delete body.saveDeliveryPlace;
    if (saveDeliveryPlace && body.deliveryPlace.name) {
      try {
        const created = await api("/api/delivery-places", { method: "POST", body: body.deliveryPlace });
        if (!Array.isArray(state.deliveryPlaces)) state.deliveryPlaces = [];
        if (created.deliveryPlace && !state.deliveryPlaces.some((d) => d.id === created.deliveryPlace.id)) {
          state.deliveryPlaces.push(created.deliveryPlace);
        }
      } catch (error) {
        alert(`납품장소 저장 실패: ${error.message}`);
      }
    }
    const editing = state.procurement.editingPurchaseOrder;
    if (editing) {
      await api(`/api/purchase-orders/${editing.id}`, { method: "PUT", body });
    } else {
      await api("/api/purchase-orders", { method: "POST", body });
    }
    state.procurement.editingPurchaseOrder = null;
    await refreshAndRender();
  });
}

function bindAdmins() {
  app.querySelector("[data-new-admin]").addEventListener("click", () => {
    state.editingAdmin = null;
    state.editingPermissions = null;
    state.adminDraft = null;
    renderApp();
  });
  app.querySelectorAll("[data-edit-admin]").forEach((button) => {
    button.addEventListener("click", () => {
      state.editingAdmin = state.admins.find((item) => item.id === button.dataset.editAdmin);
      state.editingPermissions = null;
      state.adminDraft = null;
      renderApp();
    });
  });
  app.querySelectorAll("[data-delete-admin]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!confirm("관리자를 삭제할까요?")) return;
      await api(`/api/admins/${button.dataset.deleteAdmin}`, { method: "DELETE" });
      await refreshAndRender();
    });
  });
  // 다시 그리기 전에 입력 중이던 이름·역할·상태·비밀번호를 붙잡아 둔다.
  const saveAdminDraft = () => {
    const form = app.querySelector("[data-admin-form]");
    if (!form) return;
    const draft = formObject(form);
    state.adminDraft = {
      name: draft.name,
      role: draft.role,
      isActive: draft.isActive === "true",
      password: draft.password || ""
    };
  };
  // 체크박스를 그릴 때마다 폼을 통째로 다시 그리면 입력 중이던 값이 날아가므로,
  // 편집 중 권한은 state 에 따로 들고 다닌다.
  const currentPermissions = () => {
    const base = state.editingPermissions?.permissions
      || state.editingAdmin?.permissions
      || {};
    return JSON.parse(JSON.stringify(base));
  };
  app.querySelectorAll("[data-perm-menu]").forEach((box) => {
    box.addEventListener("change", () => {
      const perms = currentPermissions();
      const menuKey = box.dataset.permMenu;
      const action = box.dataset.permAction;
      const set = new Set(perms[menuKey] || []);
      if (box.checked) {
        set.add(action);
        set.add("view");
      } else {
        set.delete(action);
        // 접근을 빼면 그 메뉴는 통째로 못 쓴다.
        if (action === "view") set.clear();
      }
      perms[menuKey] = [...set];
      saveAdminDraft();
      state.editingPermissions = {
        role: app.querySelector("[data-admin-form] [name=role]")?.value || state.editingAdmin?.role || "operator",
        permissions: perms
      };
      renderApp();
    });
  });
  app.querySelector("[data-admin-form] [name=role]")?.addEventListener("change", (event) => {
    // 메뉴 권한은 역할이 아니라 체크박스로 정한다. 역할을 바꿔도 체크해 둔
    // 권한은 그대로 둔다.
    saveAdminDraft();
    const kept = state.editingPermissions?.permissions || state.editingAdmin?.permissions || null;
    state.editingPermissions = { role: event.target.value, permissions: kept ? currentPermissions() : null };
    renderApp();
  });
  app.querySelector("[data-admin-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = formObject(event.currentTarget);
    body.isActive = body.isActive === "true";
    if (body.role !== "owner") {
      body.permissions = state.editingPermissions?.permissions
        || state.editingAdmin?.permissions
        || undefined;
    }
    if (state.editingAdmin) {
      await api(`/api/admins/${state.editingAdmin.id}`, { method: "PUT", body });
    } else {
      await api("/api/admins", { method: "POST", body });
    }
    state.editingAdmin = null;
    state.editingPermissions = null;
    state.adminDraft = null;
    await refreshAndRender();
  });
  app.querySelector("[data-cancel-edit]")?.addEventListener("click", () => {
    state.editingAdmin = null;
    state.editingPermissions = null;
    state.adminDraft = null;
    renderApp();
  });
}

function bindArchive() {
  app.querySelector("[data-sync-all]").addEventListener("click", async () => {
    await api("/api/archives/google-sync", { method: "POST", body: {} });
    state.archivesLoaded = false;
    await refreshAndRender();
  });
  app.querySelectorAll("[data-sync-brand]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api("/api/archives/google-sync", { method: "POST", body: { brandId: button.dataset.syncBrand } });
      await refreshAndRender();
    });
  });
}

function priceAliasStatusLabel(item) {
  const today = new Date().toISOString().slice(0, 10);
  if (item.isActive === false) return "중지";
  if (item.validTo && item.validTo < today) return "만료";
  if (item.validFrom && item.validFrom > today) return "예정";
  return "적용중";
}

function renderSettlement() {
  const s = state.settlement;
  // Operators cannot reach clobe, so they always settle from an uploaded file.
  if (!canUseClobe()) s.useClobe = false;
  const ym = `${s.year}-${String(s.month).padStart(2, "0")}`;
  const brands = [...state.brands].sort((a, b) => a.name.localeCompare(b.name, "ko"));
  // 스캔을 돌렸으면 목록에서 바로 "이 달에 내역이 있는 업체"를 알 수 있게 한다.
  const scanByBrand = new Map(((s.scan && s.scan.targets) || []).map((t) => [t.brandId, t]));
  const scanSuffix = (brandId) => {
    const t = scanByBrand.get(brandId);
    if (!t) return "";
    if (t.status === "ready") return ` · 주문 ${t.orderCount}건`;
    if (t.status === "unmapped") return " · 공급사 매핑 없음";
    return " · 내역 없음";
  };
  const brandOptions = brands
    .map((b) => `<option value="${b.id}" ${s.brandId === b.id ? "selected" : ""}>${h(b.name)} · ${h(settlementLabel(b.settlementType))}${h(scanSuffix(b.id))}</option>`)
    .join("");
  return `
    ${pageHead("월 정산 생성", "카페24 주문내역 · 은행 거래내역 · 입금요청(자동)을 대조하여 월별 정산서를 생성합니다.")}
    <section class="panel">
      <div class="panel-head"><h2>정산 조건</h2></div>
      <div class="panel-body">
        <div class="field two">
          <div><label>정산 연/월</label><input type="month" data-settlement-ym value="${ym}"></div>
          <div><label>공급사(브랜드)</label><select data-settlement-brand><option value="">브랜드 선택</option>${brandOptions}</select></div>
        </div>
        <div class="field two">
          <div><label>카페24 주문내역</label>
            ${canUseClobe()
              ? `<label class="check-row"><input type="checkbox" data-settlement-usecafe24 ${s.useCafe24 ? "checked" : ""}>
                  카페24에서 자동 조회 (파일 업로드 없이)</label>`
              : ""}
            ${s.useCafe24
              ? `<span class="muted">정산월을 브랜드 기준일(주문일/배송완료일)로 조회합니다.</span>`
              : `<input type="file" accept=".csv" data-settlement-cafe24>
                 <span class="muted">${s.cafe24 ? h(s.cafe24.name) : "월 전체 공급사 포함 파일"}</span>`}
          </div>
          <div><label>은행 거래내역</label>
            ${canUseClobe()
              ? `<label class="check-row"><input type="checkbox" data-settlement-useclobe ${s.useClobe ? "checked" : ""}>
                  클로브ai에서 자동 조회 (파일 업로드 없이)</label>`
              : ""}
            ${s.useClobe
              ? `<span class="muted">정산월 전후 범위를 자동 조회합니다. 계좌 범위는 클로브ai 탭에서 설정합니다.</span>`
              : `<input type="file" accept=".xlsx" data-settlement-bank>
                 <span class="muted">${s.bank ? h(s.bank.name) : "출금 대조용 (선택)"}</span>`}
          </div>
        </div>
        <div class="toolbar">
          <button class="primary" data-settlement-run ${s.running ? "disabled" : ""}>${s.running ? "정산 중…" : "정산 시작"}</button>
          <button data-settlement-scan ${s.scanning ? "disabled" : ""}>${s.scanning ? "스캔 중…" : "이 달 정산 대상 스캔"}</button>
          ${canUseClobe() && s.cafe24 && !s.useCafe24
            ? `<button data-settlement-compare ${s.comparing ? "disabled" : ""}>${s.comparing ? "대조 중…" : "카페24 API와 대조"}</button>`
            : ""}
          <span class="muted">입금요청 데이터는 시스템에서 자동 조회됩니다.</span>
        </div>
        ${renderCafe24Compare(s.compare)}
      </div>
    </section>
    ${renderSettlementScan(s)}
    ${renderSettlementResult(s.result)}
  `;
}

// 브랜드를 하나씩 돌려 보지 않고 그 달에 정산할 내역이 있는 업체만 골라 준다.
// 카페24 조회 한 번(기준일이 갈리면 두 번)으로 전 브랜드를 세므로, 정산을
// 42번 돌리는 것과 비용이 다르다.
function renderSettlementScan(s) {
  const scan = s.scan;
  if (!scan) return "";
  if (scan.error) return `<section class="panel"><div class="panel-body">${notice("danger", "대상 스캔 실패", h(scan.error))}</div></section>`;
  const targets = scan.targets || [];
  const ready = targets.filter((t) => t.status === "ready");
  const unmapped = targets.filter((t) => t.status === "unmapped");
  const empty = targets.filter((t) => t.status === "empty");
  const shown = s.scanShowEmpty ? [...ready, ...unmapped, ...empty] : [...ready, ...unmapped];
  const row = (t) => {
    const isEmpty = t.status === "empty";
    const isUnmapped = t.status === "unmapped";
    return `<tr>
      <td>${h(t.name)}${t.brandId === s.brandId ? ' <span class="muted">(선택됨)</span>' : ""}</td>
      <td><span class="muted">${h(settlementLabel(t.settlementType))}</span></td>
      <td class="num">${isUnmapped ? "-" : money.format(t.orderCount)}</td>
      <td class="num">${isUnmapped ? "-" : money.format(t.itemCount)}</td>
      <td class="num">${isUnmapped ? "-" : (t.cancelCount ? money.format(t.cancelCount) : "")}</td>
      <td>${isUnmapped
        ? '<span style="color:var(--red)">공급사 매핑 없음</span>'
        : t.missingRequestCount
          ? `<span style="color:var(--red)">입금요청 없음 ${money.format(t.missingRequestCount)}건</span>`
          : isEmpty ? '<span class="muted">내역 없음</span>' : '<span style="color:#137333">정산 가능</span>'}</td>
      <td>${isEmpty || isUnmapped ? "" : `<button data-scan-pick="${t.brandId}">정산 실행</button>`}</td>
    </tr>`;
  };
  const range = (scan.ranges || []).map((r) => `${r.startDate}~${r.endDate} (${r.dateType === "shipend_date" ? "배송완료일" : "주문일"} 기준)`).join(" · ");
  return `
    <section class="panel">
      <div class="panel-head"><h2>${scan.year}년 ${scan.month}월 정산 대상</h2>
        <span class="muted">${h(scan.source === "cafe24" ? `카페24 API ${range}` : "업로드 CSV 기준")}</span></div>
      <div class="panel-body">
        <p class="muted">정산 대상 ${ready.length}곳 · 내역 없음 ${empty.length}곳 · 공급사 매핑 없음 ${unmapped.length}곳</p>
        <div class="table-wrap" style="max-height:420px"><table class="collect-summary-table">
          <thead><tr><th>브랜드</th><th>정산유형</th><th class="num">주문</th><th class="num">품목</th><th class="num">취소</th><th>상태</th><th></th></tr></thead>
          <tbody>${shown.map(row).join("")}</tbody>
        </table></div>
        <div class="toolbar">
          <button data-scan-toggle-empty>${s.scanShowEmpty ? "내역 없는 업체 숨기기" : `내역 없는 업체 ${empty.length}곳 보기`}</button>
        </div>
      </div>
    </section>
  `;
}

// Makes the bank data's provenance visible on the result, so an unexpected
// 은행 출금합 can be traced to the source before anyone edits a spreadsheet.
// 변환기가 기존 CSV 내보내기를 그대로 재현하는지 눈으로 확인하는 자리.
// 차이가 0이어야 CSV 업로드를 API 조회로 바꿔도 정산 금액이 그대로다.
function renderCafe24Compare(compare) {
  if (!compare) return "";
  if (compare.error) {
    return notice("danger", "대조 실패", h(compare.error));
  }
  const fields = Object.entries(compare.diffsByField || {});
  const clean = compare.diffCount === 0 && !compare.onlyInCsvCount;
  return `
    <div class="panel-body" style="border-top:1px solid var(--line);margin-top:8px">
      <h3 style="color:${clean ? "#137333" : "var(--red)"}">
        ${clean ? "대조 일치 — API 데이터가 CSV와 동일합니다" : `차이 ${compare.diffCount}건`}
      </h3>
      <p class="muted">
        API 주문 ${money.format(compare.orderCount || 0)}건 · 변환 행 ${money.format(compare.apiRowCount || 0)} ·
        CSV 행 ${money.format(compare.csvRowCount || 0)} · 대조한 품목 ${money.format(compare.compared || 0)}
      </p>
      ${compare.onlyInCsvCount ? `<p class="muted">CSV에만 있는 품목 ${compare.onlyInCsvCount}건 — 조회 기간/기준일을 확인하세요.</p>` : ""}
      ${compare.onlyInApiCount ? `<p class="muted">API에만 있는 품목 ${compare.onlyInApiCount}건 (CSV 내려받은 뒤 생긴 주문일 수 있습니다).</p>` : ""}
      ${fields.length
        ? `<div class="table-wrap" style="max-height:260px"><table class="collect-diff-table">
            <thead><tr><th>필드</th><th>차이</th><th>예시 (품목 / API / CSV)</th></tr></thead>
            <tbody>${fields.map(([field, count]) => {
              const ex = (compare.diffs || []).find((d) => d.field === field);
              return `<tr><td>${h(field)}</td><td class="num">${count}건</td>
                <td><span class="muted">${ex ? `${h(ex.itemNo)} · API ${h(ex.api)} · CSV ${h(ex.csv)}` : ""}</span></td></tr>`;
            }).join("")}</tbody></table></div>`
        : ""}
    </div>
  `;
}

// 주문 데이터의 출처를 결과에 남긴다. 자동조회로 바꾼 뒤 숫자가 달라 보이면
// 어느 소스로 계산된 건지부터 확인할 수 있어야 한다.
function orderSourceLabel(orderSource) {
  if (!orderSource) return "";
  if (orderSource.source === "cafe24") {
    const r = orderSource.range;
    const basis = r?.dateType === "shipend_date" ? "배송완료일" : "주문일";
    return `주문내역: 카페24 API ${r ? `${r.startDate}~${r.endDate}` : ""} (${basis} 기준) · 주문 ${money.format(orderSource.orderCount || 0)}건 / ${money.format(orderSource.rowCount || 0)}행`;
  }
  return `주문내역: 업로드 CSV · ${money.format(orderSource.rowCount || 0)}행`;
}

function bankSourceLabel(bankSource) {
  if (!bankSource) return "";
  if (bankSource.source === "clobe") {
    const range = bankSource.range ? ` ${bankSource.range.startDate}~${bankSource.range.endDate}` : "";
    return `은행내역: 클로브ai${range} · ${bankSource.rowCount}건`;
  }
  if (bankSource.source === "upload") return `은행내역: 업로드 파일 · ${bankSource.rowCount}건`;
  return "은행내역 없음 — 출금 대조를 건너뜁니다";
}

function renderSettlementResult(result) {
  if (!result) return "";
  if (result.needsMapping) {
    const opts = (result.suppliers || [])
      .map((sup) => `<option value="${h(sup.code || sup.name)}">${h(sup.name)} (${h(sup.code)}) · ${sup.count}건</option>`)
      .join("");
    return `
      <section class="panel">
        <div class="panel-head"><h2>카페24 공급사 매핑 필요</h2></div>
        <div class="panel-body">
          <p class="muted">이 브랜드에 연결된 카페24 공급사를 한 번만 지정하면 다음부터 자동 적용됩니다.</p>
          <div class="field"><label>카페24 공급사</label><select data-settlement-supplier>${opts}</select></div>
          <div class="toolbar"><button class="primary" data-settlement-save-supplier>매핑 저장 후 재정산</button></div>
        </div>
      </section>`;
  }
  const sum = result.summary || {};
  const errs = result.errors || [];
  const warns = result.warnings || [];
  const money0 = (n) => `${money.format(Math.round(Number(n || 0)))}원`;
  const errorBlock = errs.length
    ? `<div class="panel-body"><h3 style="color:var(--red)">오류 ${errs.length}건 — 데이터 확인 후 다시 업로드하세요</h3>
        <ul>${errs.map((e) => `<li style="color:var(--red)">${h(e.message)}</li>`).join("")}</ul></div>`
    : `<div class="panel-body"><h3 style="color:#137333">오류 없음 — 정산서를 출력할 수 있습니다</h3></div>`;
  const cancelBlock = (result.cancels || []).length
    ? `<div class="panel-body"><h3>취소/교환 ${result.cancels.length}건 (정산 제외)</h3>
        <ul>${result.cancels.map((c) => `<li>${h(c.itemNo)} ${h(c.name)} · ${money0(c.saleTotal)} · ${h(c.reason)}</li>`).join("")}</ul></div>`
    : "";
  return `
    <section class="panel">
      <div class="panel-head">
        <h2>정산 결과</h2>
        <span class="muted">${orderSourceLabel(result.orderSource)}${result.orderSource ? " · " : ""}${bankSourceLabel(result.bankSource)}</span>
      </div>
      <div class="panel-body">
        <div class="fixed-summary-grid">
          <div class="fixed-card"><span>포함 주문</span><strong>${sum.orderCount || 0}건</strong></div>
          <div class="fixed-card"><span>판매합계</span><strong>${money0(sum.salesTotal)}</strong></div>
          <div class="fixed-card"><span>수수료${result.settlementType === "prepay_debt" ? "(미공제)" : ""}</span><strong>${money0(sum.commissionTotal)}</strong></div>
          <div class="fixed-card"><span>배송비</span><strong>${money0(sum.shipTotal)}</strong></div>
          <div class="fixed-card"><span>최종 정산금액</span><strong>${money0(sum.finalAmount)}</strong></div>
          <div class="fixed-card"><span>은행 출금합</span><strong>${money0(sum.bankTotal)}</strong></div>
        </div>
        ${result.excludedCount ? `<p class="muted">미배송/기간외 제외: ${result.excludedCount}건</p>` : ""}
      </div>
      ${warns.length ? `<div class="panel-body">${warns.map((w) => `<p class="muted">⚠ ${h(w)}</p>`).join("")}</div>` : ""}
      ${errorBlock}
      ${cancelBlock}
      <div class="panel-body toolbar">
        <button class="primary" data-settlement-export ${errs.length ? "disabled" : ""}>정산서 엑셀 다운로드</button>
        ${errs.length
          ? `<button data-settlement-export-force>오류 무시하고 출력 (${errs.length}건)</button>
             <span class="muted">엑셀에서 직접 고치는 편이 빠른 업체용입니다. 오류 건은 정산서에 그대로 실립니다.</span>`
          : ""}
      </div>
    </section>`;
}

function bindSettlement() {
  const s = state.settlement;
  app.querySelector("[data-settlement-ym]")?.addEventListener("change", (e) => {
    const [y, m] = e.target.value.split("-");
    s.year = Number(y); s.month = Number(m);
    // 스캔 결과는 그 달의 것이다. 달을 바꾸고 남겨 두면 목록의 건수가 거짓말을 한다.
    s.scan = null;
    renderApp();
  });
  app.querySelector("[data-settlement-brand]")?.addEventListener("change", (e) => {
    s.brandId = e.target.value; s.result = null; renderApp();
  });
  app.querySelector("[data-settlement-cafe24]")?.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    s.cafe24 = file ? { name: file.name, base64: await readFileAsBase64(file) } : null;
    renderApp();
  });
  app.querySelector("[data-settlement-bank]")?.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    s.bank = file ? { name: file.name, base64: await readFileAsBase64(file) } : null;
    renderApp();
  });
  app.querySelector("[data-settlement-usecafe24]")?.addEventListener("change", (e) => {
    s.useCafe24 = e.target.checked;
    if (s.useCafe24) s.cafe24 = null;
    s.compare = null;
    renderApp();
  });
  app.querySelector("[data-settlement-useclobe]")?.addEventListener("change", (e) => {
    s.useClobe = e.target.checked;
    if (s.useClobe) s.bank = null;
    renderApp();
  });
  // 브랜드를 고르면 그 공급사만, 아니면 전체를 대조한다. 기준일은 브랜드
  // 설정을 따라가 정산이 실제로 쓰는 범위와 같은 조건으로 비교한다.
  app.querySelector("[data-settlement-compare]")?.addEventListener("click", async () => {
    const brand = state.brands.find((b) => b.id === s.brandId);
    const basis = brand?.settlementDateBasis || (brand?.settlementType === "consignment" ? "delivered" : "order");
    const pad = (n) => String(n).padStart(2, "0");
    const startDate = `${s.year}-${pad(s.month)}-01`;
    const endDate = new Date(Date.UTC(s.year, s.month, 0)).toISOString().slice(0, 10);
    s.comparing = true;
    s.compare = null;
    renderApp();
    try {
      s.compare = await api("/api/cafe24/compare", {
        method: "POST",
        body: {
          cafe24Csv: s.cafe24.base64,
          startDate,
          endDate,
          dateType: basis === "delivered" ? "shipend_date" : "order_date",
          supplierId: brand?.cafe24Supplier || ""
        }
      });
    } catch (error) {
      s.compare = { error: error.message || "대조에 실패했습니다." };
    } finally {
      s.comparing = false;
      renderApp();
    }
  });

  const runSettlement = async () => {
    if (!s.brandId) return showToast("브랜드를 선택하세요.", "error");
    if (!s.useCafe24 && !s.cafe24) return showToast("카페24 CSV를 업로드하거나 자동 조회를 켜세요.", "error");
    s.running = true; renderApp();
    try {
      s.result = await api("/api/settlement/run", {
        method: "POST",
        body: {
          brandId: s.brandId, year: s.year, month: s.month,
          useCafe24: s.useCafe24,
          cafe24Csv: s.useCafe24 ? "" : s.cafe24?.base64 || "",
          useClobe: s.useClobe,
          bankXlsx: s.useClobe ? "" : s.bank?.base64 || ""
        }
      });
    } catch (error) {
      showToast(error.message || "정산 실행 실패", "error");
    } finally {
      s.running = false; renderApp();
    }
  };

  // 브랜드별로 정산을 돌려 보지 않고 이 달에 내역이 있는 업체를 한 번에 센다.
  app.querySelector("[data-settlement-scan]")?.addEventListener("click", async () => {
    if (!s.useCafe24 && !s.cafe24) return showToast("카페24 CSV를 업로드하거나 자동 조회를 켜세요.", "error");
    s.scanning = true; s.scan = null; renderApp();
    try {
      s.scan = await api("/api/settlement/scan", {
        method: "POST",
        body: {
          year: s.year, month: s.month,
          useCafe24: s.useCafe24,
          cafe24Csv: s.useCafe24 ? "" : s.cafe24?.base64 || ""
        }
      });
    } catch (error) {
      s.scan = { error: error.message || "대상 스캔에 실패했습니다." };
    } finally {
      s.scanning = false; renderApp();
    }
  });
  app.querySelector("[data-scan-toggle-empty]")?.addEventListener("click", () => {
    s.scanShowEmpty = !s.scanShowEmpty;
    renderApp();
  });
  app.querySelectorAll("[data-scan-pick]").forEach((button) => {
    button.addEventListener("click", () => {
      s.brandId = button.dataset.scanPick;
      s.result = null;
      runSettlement();
    });
  });

  app.querySelector("[data-settlement-run]")?.addEventListener("click", runSettlement);
  app.querySelector("[data-settlement-save-supplier]")?.addEventListener("click", async () => {
    const sel = app.querySelector("[data-settlement-supplier]");
    if (!sel?.value) return;
    try {
      await api(`/api/brands/${s.brandId}`, { method: "PUT", body: { cafe24Supplier: sel.value } });
      await loadAll();
      showToast("공급사 매핑을 저장했습니다.");
      app.querySelector("[data-settlement-run]")?.click();
    } catch (error) {
      showToast(error.message || "매핑 저장 실패", "error");
    }
  });
  // force=true 는 서버의 오류 게이트를 건너뛴다. 오류 건을 고쳐서 다시 돌리는
  // 것보다 엑셀에서 직접 손보는 편이 빠른 업체가 있어 필요한 출구다.
  const exportSettlement = async (force = false) => {
    try {
      const res = await fetch("/api/settlement/export", {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          brandId: s.brandId, year: s.year, month: s.month,
          useCafe24: s.useCafe24,
          cafe24Csv: s.useCafe24 ? "" : s.cafe24?.base64 || "",
          useClobe: s.useClobe,
          bankXlsx: s.useClobe ? "" : s.bank?.base64 || "",
          ...(force ? { force: true } : {})
        })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return showToast(err.error || "정산서 생성 실패", "error");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const brand = state.brands.find((b) => b.id === s.brandId);
      const suffix = force ? "_오류포함" : "";
      a.download = `(우프) ${brand?.name || brand?.cafe24Supplier}_${s.year}${String(s.month).padStart(2, "0")}${suffix}.xlsx`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      showToast(force ? "오류를 포함한 정산서를 다운로드했습니다. 엑셀에서 확인 후 사용하세요." : "정산서를 다운로드했습니다.");
    } catch (error) {
      showToast(error.message || "다운로드 실패", "error");
    }
  };
  app.querySelector("[data-settlement-export]")?.addEventListener("click", () => exportSettlement(false));
  app.querySelector("[data-settlement-export-force]")?.addEventListener("click", () => {
    const count = (s.result?.errors || []).length;
    if (!confirm(`오류 ${count}건을 무시하고 정산서를 출력할까요?\n오류 건이 그대로 실리므로 엑셀에서 반드시 확인하세요.`)) return;
    exportSettlement(true);
  });
}

// ---------------------------------------------------------------------------
// npb정산 (DOTEON) — 6-screen settlement workflow.
// ---------------------------------------------------------------------------
// 채널 코드 -> 화면에 쓰는 이름. 이 함수가 아예 없어서, 여러 파일을 한 번에
// 올리는 경로가 업로드 직후 ReferenceError 로 죽었다. 서버에는 저장됐는데
// 화면은 갱신되지 않아 "올라간 게 없다" 로 보이던 원인이다.
function npbChannelName(code) {
  const channel = (state.npb.config?.channels || []).find((c) => c.code === code);
  return channel?.name || code || "(채널 미상)";
}

function npbWon(value) {
  return `${money.format(Math.round(Number(value || 0)))}원`;
}

function npbStatusBadge(status) {
  const map = {
    draft: ["pending", "작성중"],
    open: ["pending", "진행중"],
    computed: ["await_deposit", "계산완료"],
    finalized: ["paid", "확정"],
    final: ["paid", "확정"]
  };
  const [cls, label] = map[status] || ["", status || "-"];
  return `<span class="badge ${cls}">${h(label)}</span>`;
}

function npbWarnBadges(warnings) {
  const arr = Array.isArray(warnings) ? warnings : (warnings ? [warnings] : []);
  if (!arr.length) return `<span class="muted">-</span>`;
  return arr.map((w) => `<span class="badge error">${h(w)}</span>`).join(" ");
}

function npbNeedSelect() {
  return `
    <section class="panel">
      <div class="panel-body empty">먼저 [월 목록/이력]에서 정산을 선택하거나 생성하세요.</div>
    </section>`;
}

function npbSeedParties(parties) {
  const base = (parties && parties.length ? parties : []).map((p) => ({
    party: p.party || p.partyName || "",
    ratio: Number(p.ratio || 0),
    excluded: !!p.excluded,
    note: p.note || ""
  }));
  while (base.length < 3) base.push({ party: "", ratio: 0, excluded: false, note: "" });
  return base;
}

function npbPrevSettlement() {
  const n = state.npb;
  const list = Array.isArray(n.settlements) ? n.settlements : [];
  const cur = n.current?.periodMonth
    || list.find((s) => s.key === n.currentKey)?.periodMonth;
  if (!cur) return null;
  const prior = list
    .filter((s) => s.periodMonth < cur)
    .sort((a, b) => b.periodMonth.localeCompare(a.periodMonth));
  return prior[0] || null;
}

async function npbReloadSettlements() {
  const resp = await api(`/api/npb/settlements?brand=${npbBrand()}`);
  state.npb.settlements = (resp && resp.settlements) || [];
}

async function npbLoadDetail(key) {
  const resp = await api(`/api/npb/settlements/${encodeURIComponent(key)}`);
  const detail = (resp && resp.settlement) || resp || {};
  const n = state.npb;
  n.current = detail;
  n.currentKey = key;
  n.profitParties = npbSeedParties(detail.profitSplit || detail.parties);
  // 유형별 건수. 예전 정산은 소형/대형만 갖고 있으므로 옮겨 담는다.
  n.adCost = detail.adCost || null;
  n.logisticsCounts = detail.logistics?.counts || {
    small: Number(detail.logistics?.smallCount || 0),
    large: Number(detail.logistics?.largeCount || 0)
  };
  n.worksheet = npbBuildWorksheet(n.config, detail.lines || []);
  n.inventory = npbBuildInventory(n.config, detail.inventory || []);
  // 실비 청구서는 정산과 별개로 살아 있으므로 따로 읽어 온다.
  try {
    const list = await api(`/api/npb/invoices?brand=${encodeURIComponent(detail.brand || "")}`);
    n.invoices = list.invoices || [];
  } catch {
    n.invoices = n.invoices || [];
  }
  // 월 목록의 합계도 같이 맞춘다. 업로드해 놓고 [월 목록/이력] 으로 가면
  // 예전 숫자가 그대로 있어, 반영이 안 된 것으로 보인다.
  try {
    await npbReloadSettlements();
  } catch {
    // 목록 갱신은 실패해도 나머지 화면은 그대로 쓴다.
  }
}

// Build the editable worksheet: one block per channel, seeded from
// channelLineConfigs (so blocks are visible pre-upload), overlaid with any
// qty/price/fee already stored on settlement.lines (parsed or hand-edited).
// 채널의 워크시트 행을 만든다.
//
// 행은 채널과 상품에서 직접 파생시킨다 — 저장된 channelLineConfigs 를 조건으로
// 걸면, 화면에서 새로 추가한 채널은 라인 설정이 없어서 워크시트에 아예 나타나지
// 않는다(채널 설정 저장은 channels 만 갱신한다). 도톤은 판매 SKU 가 두 개뿐이고
// 팔렸든 안 팔렸든 모든 채널에 있어야 하므로, 파생이 곧 올바른 규칙이다.
// 저장된 라인 설정은 가격·수수료 덮어쓰기로만 쓴다.
function npbChannelSeeds(channel, products, lineConfigs) {
  const saved = lineConfigs.filter((lc) => lc.channelCode === channel.code);
  const savedFor = (productId, tier) =>
    saved.find((lc) => lc.productId === productId && (!tier || (lc.lineLabel || "").includes(tier)));

  // 채널 단위 티어(도톤 공구의 2개세트·3개세트)
  if (channel.tiers && channel.tiers.length) {
    return channel.tiers.map((t) => {
      const override = savedFor("os", t.tier);
      return {
        productId: "os",
        lineLabel: override?.lineLabel || `DOTEON Outdoor Spray ${t.tier}`,
        tier: t.tier,
        salePrice: override?.salePrice ?? t.salePrice ?? channel.salePrice ?? 0,
        feeRate: override?.feeRate ?? channel.feeRate ?? 0
      };
    });
  }

  // 상품이 자기 번들을 갖는 브랜드(픽키 필바이츠). 45g 은 1·3·5·10개 묶음이
  // 있고 180g 은 낱개뿐이라, 번들을 브랜드에 두면 없는 조합이 생긴다.
  // 팔렸든 안 팔렸든 모든 채널에 전 SKU 가 깔려야 한다.
  if (products.some((p) => (p.packTiers || []).length)) {
    const rows = [];
    // 채널이 취급 상품을 한정해 두면 그것만 깐다. 쿠팡은 아직 치킨만 판매등록
    // 돼 있어, 전 SKU 를 깔면 팔 수 없는 줄이 절반이다. 목록에 없는 상품이라도
    // 파일에서 실제로 팔려 온 줄은 지우지 않는다 — 여긴 빈 줄 생성만 한다.
    const allow = Array.isArray(channel.productIds) && channel.productIds.length
      ? new Set(channel.productIds)
      : null;
    for (const p of products) {
      if (allow && !allow.has(p.id)) continue;
      const tiers = (p.packTiers || []).length ? p.packTiers : [{ tier: "", ea: 1, listPrice: p.listPrice }];
      for (const t of tiers) {
        const override = savedFor(p.id, t.tier);
        rows.push({
          productId: p.id,
          lineLabel: override?.lineLabel || `${p.name}${t.tier ? ` ${t.tier}` : ""}`,
          tier: t.tier || "",
          listPrice: t.listPrice ?? p.listPrice ?? 0,
          eaPerUnit: t.ea ?? 1,
          salePrice: override?.salePrice ?? t.listPrice ?? 0,
          feeRate: override?.feeRate ?? channel.feeRate ?? 0
        });
      }
    }
    return rows;
  }

  return products.map((p) => {
    const override = savedFor(p.id, "");
    return {
      productId: p.id,
      lineLabel: override?.lineLabel
        || (p.id === "fc" ? "DOTEON Foot Cleaner" : "DOTEON Outdoor Spray"),
      tier: "",
      salePrice: override?.salePrice ?? channel.salePrice ?? 0,
      feeRate: override?.feeRate ?? channel.feeRate ?? 0
    };
  });
}

function npbBuildWorksheet(config, lines) {
  const cfg = config || {};
  const channels = cfg.channels || [];
  const products = (cfg.products || []).filter((p) => p.active !== false);
  const lineConfigs = cfg.channelLineConfigs || [];
  const byChannel = new Map(channels.map((c) => [c.code, c]));
  // Index stored lines by channel|productId|tier for overlay lookup.
  const stored = new Map();
  for (const l of lines || []) {
    const pid = npbProductId(l.productKey || l.productId);
    const tier = l.tier || "";
    stored.set(`${l.channel}|${pid}|${tier}`, l);
  }
  const order = NPB_WS_ORDER.slice();
  channels.forEach((c) => { if (!order.includes(c.code)) order.push(c.code); });
  const used = new Set();
  const blocks = [];
  for (const code of order) {
    const channel = byChannel.get(code);
    if (!channel || channel.active === false) continue;
    // 합계만 적는 채널은 품목 줄을 만들지 않는다.
    if ((channel.entryMode || "review") === "summary") {
      const line = (lines || []).find((l) => l.channel === code && l.summary)
        || (lines || []).find((l) => l.channel === code);
      (line ? [line] : []).forEach((l) => used.add(`${code}|${npbProductId(l.productKey)}|${l.tier || ""}`));
      blocks.push({
        code,
        name: channel.name,
        settleBy: channel.settleBy || "",
        category: channel.category || "",
        summary: true,
        note: channel.note || "",
        totals: {
          listTotal: Number(line?.listAmount ?? 0),
          shippingTotal: Number(line?.shippingAmount ?? 0),
          discountTotal: Number(line?.discountAmount ?? 0),
          saleTotal: Number(line?.saleAmount ?? 0),
          feeTotal: Number(line?.feeAmount ?? 0)
        },
        rows: []
      });
      continue;
    }
    const seeds = npbChannelSeeds(channel, products, lineConfigs);
    const rows = seeds.map((seed) => {
      const tierLabel = seed.tier || "";
      // 묶음까지 정확히 같은 줄만 가져온다. 예전에는 못 찾으면 "묶음 없음" 줄을
      // 대신 집었는데, 그 바람에 45g 1개·3개·5개 칸이 모두 같은 수량을 보였다.
      const key = `${code}|${seed.productId}|${tierLabel}`;
      const stLine = stored.get(key);
      if (stLine) used.add(key);
      return {
        productKey: seed.productId,
        label: seed.lineLabel,
        listPrice: Number(stLine?.listPrice ?? seed.listPrice ?? 0),
        salePrice: Number(stLine?.salePrice ?? seed.salePrice ?? 0),
        feeRate: Number(stLine?.feeRate ?? seed.feeRate ?? 0),
        qty: Number(stLine?.qty ?? stLine?.qtyEa ?? 0),
        // 1 로 고정한다. 정가·기준가가 이미 묶음 단가이고(낱개정가 × 배수),
        // 낱개 수는 multiplier 가 들고 있다. 여기에 묶음 수를 또 곱하면
        // 3팩·5팩 줄의 정가가 3배·5배로 부푼다. 서버도 1 로 둔다.
        eaPerUnit: 1,
        tier: tierLabel,
        // 끝자리 처리는 저장된 줄의 값이 먼저다 — 확정한 달은 확정 당시의
        // 기준으로 계산되어야 한다.
        rounding: String(stLine?.rounding ?? channel.rounding ?? ""),
        // 업로드로 들어온 원본을 그대로 들고 있는다. 저장할 때 이걸 되돌려주지
        // 않으면 파일에서 읽은 금액이 통째로 날아간다.
        source: stLine || null
      };
    });
    // 상품표에 없는 조합(B2B 의 "수량=100개" 옵션, 네이버 배송비 줄)은 씨앗이
    // 없어 화면에 안 뜬다. 안 뜬 채로 저장하면 그대로 사라지므로 뒤에 붙인다.
    const extras = [];
    for (const [key, line] of stored) {
      if (used.has(key) || !key.startsWith(`${code}|`)) continue;
      used.add(key);
      extras.push({
        productKey: line.productKey || line.productId || "",
        label: line.label || line.productKey || "(이름 없음)",
        listPrice: Number(line.listPrice ?? 0),
        salePrice: Number(line.salePrice ?? 0),
        feeRate: Number(line.feeRate ?? channel.feeRate ?? 0),
        qty: Number(line.qty ?? line.qtyEa ?? 0),
        eaPerUnit: Number(line.eaPerUnit ?? 1),
        tier: line.tier || "",
        rounding: String(line.rounding ?? channel.rounding ?? ""),
        extra: true,
        source: line
      });
    }
    if (!rows.length && !extras.length) continue;
    blocks.push({
      code,
      name: channel.name,
      settleBy: channel.settleBy || "",
      category: channel.category || "",
      priceLabel: channel.priceLabel || "기준가",
      // 행사 할인을 판매처와 반반 부담하는 채널은 그 달의 할인율을 받아야 한다.
      promoSplit: channel.promoSplit === true,
      rows: [...rows, ...extras]
    });
  }
  return blocks;
}

// 발행한 청구서를 엑셀로 내려받는다.
async function npbDownloadInvoice(invoice) {
  if (!invoice?.id) return;
  const res = await fetch(`/api/npb/invoices/${encodeURIComponent(invoice.id)}/xlsx`, {
    credentials: "same-origin"
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "청구서를 내려받지 못했습니다.");
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${invoice.brandName || "청구서"}_${invoice.periodMonth || ""}_${invoice.typeLabel || ""}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// 기초재고는 정산월 전월의 마지막 날 기준, 기말은 정산월의 마지막 날 기준이다.
function npbMonthLastDay(year, month) {
  if (!year || !month) return "";
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

function npbPeriodLastDay() {
  const p = state.npb.current?.period || {};
  return npbMonthLastDay(Number(p.year), Number(p.month));
}

function npbPrevMonthLastDay() {
  const p = state.npb.current?.period || {};
  const year = Number(p.year);
  const month = Number(p.month);
  if (!year || !month) return "";
  return month === 1 ? npbMonthLastDay(year - 1, 12) : npbMonthLastDay(year, month - 1);
}

// Seed the 재고현황 table from config products, overlaying any stored rows.
function npbBuildInventory(config, stored) {
  // 감춘 품목은 재고에도 뜨면 안 된다. 첫 시드의 pb_chicken/pb_vegan 처럼 g 수
  // 없이 맛으로만 갈랐던 옛 품목이 SKU 목록과 나란히 보여 6줄이 됐다.
  const products = (config?.products || []).filter((p) => p.active !== false);
  const byKey = new Map(
    (stored || []).map((r) => [npbProductId(r.productKey || r.productId || r.key), r])
  );
  return products.map((p) => {
    const r = byKey.get(p.id) || {};
    const opening = Number(r.opening || 0);
    const inbound = Number(r.inbound || 0);
    const outbound = Number(r.outbound || 0);
    return {
      productKey: p.id,
      name: p.name,
      // 기초(전월 말) + 입고 − 출고 = 기말(정산월 말). 판매/비매출은 출고에서
      // 갈라낼 방법이 없어 쓰지 않는다.
      opening,
      inbound,
      outbound,
      closing: opening + inbound - outbound
    };
  });
}

// Roll the worksheet blocks up client-side (mirrors npbComputeRollup) so the
// summary card and 이익 update instantly as the user edits.
function npbWorksheetRollup() {
  const n = state.npb;
  const blocks = n.worksheet || [];
  let qtyTotal = 0;
  let listTotal = 0;
  let realSaleTotal = 0;
  let feeTotal = 0;
  let shippingTotal = 0;
  // 합계 방식 채널은 품목 줄이 없고 블록의 totals 가 곧 그 채널의 값이다.
  // 이걸 빼먹어서 스마트스토어·스파크펫·파마스퀘어가 종합정산에도, 정산주체별
  // 소계에도 통째로 안 잡히고 있었다.
  const blockTotals = (block) => {
    if (block.summary) {
      const t = block.totals || {};
      const sale = Number(t.saleTotal || 0);
      const fee = Number(t.feeTotal || 0);
      return { qty: 0, list: Number(t.listTotal || 0), revenue: sale, fee,
        shipping: Number(t.shippingTotal || 0) };
    }
    return block.rows.reduce((acc, row) => {
      const m = npbRowMath(row);
      acc.qty += Number(row.qty || 0) * (Number(row.eaPerUnit || 1) || 1);
      acc.list += m.list;
      acc.revenue += m.revenue;
      acc.fee += m.fee;
      acc.shipping += Number(row.source?.shippingAmount || 0);
      return acc;
    }, { qty: 0, list: 0, revenue: 0, fee: 0, shipping: 0 });
  };
  for (const block of blocks) {
    const t = blockTotals(block);
    qtyTotal += t.qty;
    listTotal += t.list;
    realSaleTotal += t.revenue;
    feeTotal += t.fee;
    shippingTotal += t.shipping || 0;
  }
  const revenueTotal = realSaleTotal - feeTotal;
  const cost = npbLogisticsCost();
  // 정산 주체별 소계. 거래 주체가 픽키파크인 채널은 그쪽으로 계산서가 나가고,
  // 우프 채널만 우리가 계산서 발행·수금해 합쳐서 청구한다. 월 총판매를 함께
  // 집계하되 청구 대상이 얼마인지 바로 보여야 한다.
  const bySettleBy = {};
  for (const block of blocks) {
    const who = block.settleBy || "";
    if (!who) continue;
    const acc = bySettleBy[who] || (bySettleBy[who] = { realSaleTotal: 0, feeTotal: 0, revenueTotal: 0 });
    const t = blockTotals(block);
    acc.realSaleTotal += t.revenue;
    acc.feeTotal += t.fee;
    acc.revenueTotal += t.revenue - t.fee;
  }
  return {
    bySettleBy,
    qtyTotal,
    listTotal,
    // 정가 - 할인 + 배송비 = 실판매. 서버 집계와 같은 식이다.
    discountTotal: listTotal + shippingTotal - realSaleTotal,
    shippingTotal,
    realSaleTotal,
    feeTotal,
    revenueTotal,
    logisticsCost: cost,
    profit: revenueTotal - cost
  };
}

// 서버 npbComputeShipping 과 같은 규칙. 유형 목록이 없는 예전 브랜드는
// 소형/대형 단가로 자동 구성한다.
// 서버 npbCostConfigForMonth 와 같은 규칙: 정산월에 맞는 실비 기준을 고른다.
function npbCostConfigForMonth(cc, month) {
  const periods = Array.isArray(cc?.periods) ? cc.periods : [];
  const m = String(month || "");
  const hit = m
    ? periods.filter((p) => p && p.from && String(p.from) <= m)
      .sort((a, b) => String(a.from).localeCompare(String(b.from))).pop()
    : null;
  return hit ? { ...cc, ...hit } : (cc || {});
}

function npbShipTypes() {
  const cc = npbCostConfigForMonth(state.npb.config?.costConfig || {}, state.npb.current?.periodMonth);
  if (Array.isArray(cc.shipTypes) && cc.shipTypes.length) return cc.shipTypes;
  const pick = Number(cc.pickPack || 0);
  return [
    { key: "small", label: "소형 출고", freight: Number(cc.smallShip || 0), handling: pick },
    { key: "large", label: "대형 출고", freight: Number(cc.largeShip || 0), handling: pick }
  ];
}

function npbShipRow(type) {
  const raw = state.npb.logisticsCounts?.[type.key];
  const entry = raw && typeof raw === "object" ? raw : { count: raw };
  const count = Number(entry.count || 0);
  const unit = Number(type.freight || 0) + Number(type.handling || 0);
  return {
    ...type,
    count,
    unit,
    amount: type.manual ? Number(entry.amount || 0) : count * unit
  };
}

function npbLogisticsCost() {
  // 용달·퀵처럼 개별 기재하는 유형은 합계에서 뺀다.
  return npbShipTypes()
    .map(npbShipRow)
    .filter((r) => !r.excludeFromTotal)
    .reduce((sum, r) => sum + r.amount, 0);
}

async function npbDownloadXlsx(key) {
  try {
    const res = await fetch(`/api/npb/settlements/${encodeURIComponent(key)}/xlsx`, {
      credentials: "same-origin"
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return showToast(err.error || "다운로드 실패", "error");
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `npb_${key}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast("정산서를 다운로드했습니다.");
  } catch (error) {
    showToast(error.message || "다운로드 실패", "error");
  }
}

// --- 입금대사 (클로브ai 연동) ---------------------------------------------

const CONFIDENCE_LABEL = { high: "확실", medium: "확인 권장", low: "직접 확인" };

// Banking data — owner/manager only. The server enforces this on every
// /api/clobe/* route; hiding the tab keeps operators from hitting a dead end.
// 서버의 can() 과 같은 규칙. 화면을 숨기는 것은 편의일 뿐이고 진짜 차단은
// 서버에서 한다.
function can(menuKey, action = "view") {
  const me = state.admin;
  if (!me) return false;
  if (me.role === "owner") return true;
  const granted = me.permissions?.[menuKey];
  return Array.isArray(granted) && granted.includes(action);
}

// 알림 박스 — 빨간 글자 한 줄 대신, 놓치지 않게 아이콘·제목·할 일을 묶어 보여준다.
const NOTICE_ICONS = {
  danger: '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 5.8v5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="10" cy="13.9" r="1.1" fill="currentColor"/></svg>',
  warn: '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><path d="M10 2.8 18 16.6H2z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M10 8v4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="10" cy="14.2" r="1" fill="currentColor"/></svg>',
  info: '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true"><circle cx="10" cy="10" r="8" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M10 9v5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="10" cy="6.2" r="1.1" fill="currentColor"/></svg>'
};
function notice(kind, title, body = "", action = "") {
  return `<div class="notice notice-${kind}" role="${kind === "danger" ? "alert" : "status"}">
    <span class="notice-ic">${NOTICE_ICONS[kind] || NOTICE_ICONS.info}</span>
    <div class="notice-body"><strong>${title}</strong>${body ? `<p>${body}</p>` : ""}</div>
    ${action ? `<div class="notice-action">${action}</div>` : ""}
  </div>`;
}
// 내려받기 버튼 여러 개를 하나로 묶는다(링크 그대로, 동작은 같다).
function downloadMenu(items, label = "내려받기") {
  return `<details class="menu-pop"><summary class="button">${label}<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></summary>
    <div class="menu-list">${items.map(([href, text]) => `<a href="${href}">${text}</a>`).join("")}</div></details>`;
}
// ---- 노션식 선택(태그) 칸 ----------------------------------------------------
// 칸을 누르면 목록이 뜨고, 고른 값은 색 칩으로 한 칸에 여러 개 보인다. 목록에 없는
// 이름을 치면 바로 만들 수 있다. 값은 숨은 입력으로 폼에 실린다(onSync 가 채운다).
const TAG_COLORS = ["grey", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"];
function tagColorOf(text) {
  let n = 0;
  for (const ch of String(text || "")) n = (n * 31 + ch.charCodeAt(0)) >>> 0;
  return TAG_COLORS[n % TAG_COLORS.length];
}
function tagChip(label, color, removeValue) {
  return `<span class="ntag ntag-${color || tagColorOf(label)}">${h(label)}${removeValue != null ? `<button type="button" class="ntag-x" data-ns-remove="${h(removeValue)}" aria-label="${h(label)} 빼기">×</button>` : ""}</span>`;
}
const notionSelects = new Map();
function notionSelect(cfg) {
  notionSelects.set(cfg.id, cfg);
  return `<div class="nsel ${cfg.multi ? "is-multi" : ""}" data-nsel="${h(cfg.id)}">
    <div class="nsel-box" tabindex="-1">${nselChips(cfg)}<input class="nsel-input" data-nsel-input autocomplete="off" placeholder="${cfg.selected.length ? "" : h(cfg.placeholder || "선택")}" aria-label="${h(cfg.label || "선택")}"></div>
    <div class="nsel-pop" hidden></div>
    <div class="nsel-hidden">${cfg.hidden(cfg.selected)}</div>
  </div>`;
}
function nselChips(cfg) {
  return cfg.selected.map((v) => { const o = cfg.options.find((x) => x.value === v) || { label: v }; return tagChip(o.label, o.color, v); }).join("");
}
function nselPop(cfg, q) {
  const text = q.trim();
  const list = cfg.options.filter((o) => !text || o.label.includes(text) || (o.hint || "").includes(text));
  const exact = cfg.options.some((o) => o.label === text);
  const items = list.map((o) => `<button type="button" class="nsel-opt ${cfg.selected.includes(o.value) ? "is-on" : ""}" data-ns-pick="${h(o.value)}">${tagChip(o.label, o.color)}${o.hint ? `<span class="nsel-hint">${h(o.hint)}</span>` : ""}${cfg.selected.includes(o.value) ? '<span class="nsel-check" aria-hidden="true">✓</span>' : ""}</button>`).join("");
  const create = cfg.onCreate && text && !exact ? cfg.createChoices
    ? `<div class="nsel-create"><span>‘${h(text)}’ 만들기 —</span>${cfg.createChoices.map(([k, l, c]) => `<button type="button" class="nsel-create-btn" data-ns-create="${h(k)}">${tagChip(l, c)} 아래에</button>`).join("")}</div>`
    : `<button type="button" class="nsel-opt nsel-new" data-ns-create="">만들기 ${tagChip(text)}</button>` : "";
  return `<div class="nsel-title">${cfg.multi ? "옵션 선택 또는 생성" : "하나 선택 또는 생성"}</div>${items || (create ? "" : `<p class="nsel-empty">맞는 항목이 없습니다</p>`)}${create}`;
}
function bindNotionSelects(root) {
  root.querySelectorAll("[data-nsel]").forEach((el) => {
    const cfg = notionSelects.get(el.dataset.nsel);
    if (!cfg) return;
    const box = el.querySelector(".nsel-box"), input = el.querySelector("[data-nsel-input]"), pop = el.querySelector(".nsel-pop");
    const sync = () => {
      box.querySelectorAll(".ntag").forEach((n) => n.remove());
      input.insertAdjacentHTML("beforebegin", nselChips(cfg));
      input.placeholder = cfg.selected.length ? "" : (cfg.placeholder || "선택");
      el.querySelector(".nsel-hidden").innerHTML = cfg.hidden(cfg.selected);
    };
    const open = () => { pop.innerHTML = nselPop(cfg, input.value); pop.hidden = false; el.classList.add("is-open"); };
    const close = () => { pop.hidden = true; el.classList.remove("is-open"); input.value = ""; };
    const toggle = (v) => {
      if (cfg.multi) cfg.selected = cfg.selected.includes(v) ? cfg.selected.filter((x) => x !== v) : [...cfg.selected, v];
      else cfg.selected = cfg.selected[0] === v ? [] : [v];
      sync();
      if (cfg.multi) { input.value = ""; open(); input.focus(); } else close();
    };
    box.addEventListener("click", (e) => { if (e.target.closest("[data-ns-remove]")) return; input.focus(); open(); });
    input.addEventListener("input", open);
    input.addEventListener("keydown", async (e) => {
      if (e.key === "Escape") { close(); input.blur(); }
      else if (e.key === "Backspace" && !input.value && cfg.selected.length) { cfg.selected = cfg.selected.slice(0, -1); sync(); open(); }
      else if (e.key === "Enter") {
        e.preventDefault();
        const text = input.value.trim(); if (!text) return;
        const hit = cfg.options.find((o) => o.label === text) || cfg.options.find((o) => o.label.includes(text));
        if (hit) toggle(hit.value);
        else if (cfg.onCreate && !cfg.createChoices) { const o = await cfg.onCreate(text, ""); if (o) { cfg.options.push(o); toggle(o.value); } }
      }
    });
    el.addEventListener("click", async (e) => {
      const rm = e.target.closest("[data-ns-remove]");
      if (rm) { e.stopPropagation(); cfg.selected = cfg.selected.filter((x) => x !== rm.dataset.nsRemove); sync(); return; }
      const pick = e.target.closest("[data-ns-pick]");
      if (pick) { toggle(pick.dataset.nsPick); return; }
      const mk = e.target.closest("[data-ns-create]");
      if (mk && cfg.onCreate) {
        const o = await cfg.onCreate(input.value.trim(), mk.dataset.nsCreate);
        if (o) { cfg.options.push(o); toggle(o.value); }
      }
    });
    document.addEventListener("click", (e) => { if (!el.contains(e.target)) close(); });
  });
}

// 바깥을 누르면 열린 내려받기 메뉴를 닫는다.
document.addEventListener("click", (e) => {
  document.querySelectorAll("details.menu-pop[open]").forEach((d) => { if (!d.contains(e.target)) d.removeAttribute("open"); });
});
// 접어 두는 도움말 — 매일 쓰는 사람에게는 접힌 채로, 처음 쓰는 사람만 펼쳐 본다.
function helpNote(text) {
  return `<details class="help-note"><summary>도움말</summary><div>${text}</div></details>`;
}

// 클로브(은행 입금내역) 사용 여부. 역할이 아니라 관리자 화면에서 체크한
// 메뉴 권한(주문매칭(클로브))을 따른다 — 서버의 /api/clobe/* 검사와 같다.
// 카페24 무통장 입금전 → 은행 입금 확인 → 카페24 입금확인. 통장 내역이 보이므로 클로브 권한자(경영관리·대표)만.
const DEPOSIT_MODES = { off: "끔", preview: "맞춰 보기만", auto: "자동 입금확인" };
function renderDepositConfirm() {
  const dc = state.depositConfirm;
  const head = `<div class="panel-head"><h2>카페24 입금전 주문 자동 입금확인</h2>${dc?.data ? `<span class="pill">${h(DEPOSIT_MODES[dc.data.settings.mode] || dc.data.settings.mode)}</span>` : ""}</div>`;
  if (!dc?.data) return `<section class="panel flow-section" id="flow-deposit">${head}<div class="panel-body"><p class="muted">불러오는 중…</p></div></section>`;
  const d = dc.data;
  const r = d.lastRun;
  const row = (x, extra = "") => `<tr><td>${h(x.orderId)}</td><td>${h(fmtDate(x.orderDate))}</td><td>${h(x.depositor || x.buyer || "")}</td><td class="num">${money.format(x.amount || 0)}</td>${extra}</tr>`;
  const txText = (t) => `${h(t.name || "-")} · ${money.format(t.amount)}원 · ${h(fmtDate(t.at))}`;
  const sure = (r?.sure || []).filter((x) => !(r.confirmed || []).some((c) => c.orderId === x.orderId));
  return `<section class="panel flow-section" id="flow-deposit">${head}<div class="panel-body">
    <p class="section-lead">무통장 입금전 주문 중 <strong>금액·입금자명이 같고 짝이 하나뿐인 건</strong>을 카페24에 입금확인합니다.</p>
    ${helpNote("애매한 건은 아래 '확인 필요'에서 직접 처리합니다. 운영 직원은 통장 내역 없이 결과 알림(주문번호·입금자·금액)만 메신저 공유함에서 봅니다.")}
    ${!d.writeScope ? notice("warn", "카페24 주문 쓰기 권한이 없습니다", "지금은 '맞춰 보기만' 할 수 있습니다. 카페24를 다시 연결할 때 주문 쓰기(mall.write_order) 권한을 함께 승인해 주세요.") : ""}
    ${r && r.ok === false ? notice("danger", "마지막 맞춰 보기가 실패했습니다", h(r.error)) : ""}
    <div class="action-row">
      ${d.isOwner ? `<label class="inline-field"><span>운영 방식</span><select data-dc-mode aria-label="입금확인 운영 방식">${Object.entries(DEPOSIT_MODES).map(([k, l]) => `<option value="${k}" ${d.settings.mode === k ? "selected" : ""} ${k === "auto" && !d.writeScope ? "disabled" : ""}>${l}</option>`).join("")}</select></label>` : ""}
      <button data-dc-run>지금 맞춰 보기</button>
      ${d.canApply && d.writeScope && sure.length ? `<button class="primary" data-dc-apply>확실한 ${sure.length}건 입금확인</button>` : ""}
      <span class="meta">${r ? `마지막 확인 ${h(fmtDate(r.at))} · ${h(r.by)}${r.ok === false ? "" : ` · 입금전 ${money.format(r.unpaidCount || 0)}건`}` : "아직 확인하지 않았습니다."}</span>
    </div>
    ${sure.length ? `<h3 class="dc-h">확실한 짝 ${sure.length}건</h3><div class="table-wrap"><table class="compact" data-unit="원"><thead><tr><th>주문번호</th><th>주문일</th><th>입금자</th><th>금액</th><th>통장 입금</th></tr></thead><tbody>
      ${sure.map((x) => row(x, `<td class="wrap">${txText(x.tx)}</td>`)).join("")}</tbody></table></div>` : ""}
    ${(r?.check || []).length ? `<h3 class="dc-h">확인 필요 ${r.check.length}건</h3><div class="table-wrap"><table class="compact" data-unit="원"><thead><tr><th>주문번호</th><th>주문일</th><th>입금자</th><th>금액</th><th>후보 입금</th></tr></thead><tbody>
      ${r.check.map((x) => row(x, `<td class="wrap"><span class="meta">${h(x.reason)}</span>${(x.txs || []).map((t) => `<div>${txText(t)} ${d.canApply && d.writeScope ? `<button class="small" data-dc-confirm="${h(x.orderId)}" data-dc-tx="${h(t.txId)}">이 입금으로 확인</button>` : ""}</div>`).join("")}</td>`)).join("")}</tbody></table></div>` : ""}
    ${(r?.errors || []).length ? notice("danger", `입금확인 실패 ${r.errors.length}건`, r.errors.map((e) => `${h(e.orderId)} ${h(e.error)}`).join(", ")) : ""}
    ${d.history.length ? `<details class="history-note"><summary>입금확인 기록 ${d.history.length}건</summary><div class="table-wrap"><table class="compact" data-unit="원"><thead><tr><th>처리</th><th>주문번호</th><th>입금자</th><th>금액</th><th>통장 입금</th><th>누가</th></tr></thead><tbody>
      ${d.history.map((x) => `<tr><td>${h(fmtDate(x.at))}</td><td>${h(x.orderId)}</td><td>${h(x.depositor)}</td><td class="num">${money.format(x.amount || 0)}</td><td>${h(x.txName || "")} ${h(fmtDate(x.txAt))}</td><td>${h(x.by)}${x.manual ? " (직접)" : ""}</td></tr>`).join("")}</tbody></table></div></details>` : ""}
  </div></section>`;
}
function bindDepositConfirm() {
  if (!state.depositConfirm) state.depositConfirm = { data: null, loading: false };
  const dc = state.depositConfirm;
  const load = async () => { dc.loading = true; try { dc.data = await api("/api/deposit-confirm"); } catch (e) { dc.data = null; showToast(e.message, "error"); } finally { dc.loading = false; } renderApp(); };
  if (!dc.data && !dc.loading) { load(); return; }
  const run = async (apply) => {
    try { const r = await api("/api/deposit-confirm/run", { method: "POST", body: { apply } }); showToast(r.lastRun.ok ? (apply ? `${r.lastRun.confirmed.length}건 입금확인했습니다.` : "맞춰 봤습니다.") : r.lastRun.error, r.lastRun.ok ? "" : "error"); }
    catch (e) { showToast(e.message, "error"); }
    load();
  };
  app.querySelector("[data-dc-run]")?.addEventListener("click", () => run(false));
  app.querySelector("[data-dc-apply]")?.addEventListener("click", () => { if (confirm("확실한 짝을 카페24에 입금확인할까요?")) run(true); });
  app.querySelector("[data-dc-mode]")?.addEventListener("change", async (e) => {
    const mode = e.target.value;
    if (mode === "auto" && !confirm("10분마다 확실한 짝을 카페24에 자동으로 입금확인합니다. 켤까요?")) { e.target.value = dc.data.settings.mode; return; }
    try { await api("/api/deposit-confirm/settings", { method: "PUT", body: { mode } }); showToast(`${DEPOSIT_MODES[mode]}(으)로 바꿨습니다.`); } catch (err) { showToast(err.message, "error"); }
    load();
  });
  app.querySelectorAll("[data-dc-confirm]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm(`${b.dataset.dcConfirm} 주문을 이 입금으로 입금확인할까요?`)) return;
    try { await api("/api/deposit-confirm/confirm", { method: "POST", body: { orderId: b.dataset.dcConfirm, txId: b.dataset.dcTx } }); showToast("입금확인했습니다."); } catch (e) { showToast(e.message, "error"); }
    load();
  }));
}

// 카페24 배송준비중 넘김 결과를 알림 문구로.
function prepareNote(prepared) {
  if (!prepared) return "";
  const parts = [];
  if (prepared.ok) parts.push(`카페24 배송준비중 ${prepared.ok}건`);
  if (prepared.failed?.length) parts.push(`배송준비중 실패 ${prepared.failed.length}건(${prepared.failed.slice(0, 3).map((f) => `${f.orderNo}: ${f.error}`).join(", ")})`);
  if (prepared.skipped?.length) parts.push(`이미 진행된 주문 ${prepared.skipped.length}건은 그대로`);
  return parts.length ? ` · ${parts.join(" · ")}` : "";
}

function canUseClobe() {
  return can("reconcile");
}

// --- 반자동 파이프라인 ------------------------------------------------------
// 단계마다 버튼이 하나씩 있고, 각 버튼은 먼저 "무엇을 하게 될지"만 보여준다.
// 실제 생성·상태변경은 확인한 뒤 별도 버튼으로만 일어난다.
// 입금요청을 만들 때 카페24 주문을 배송준비중으로 같이 넘길지(대표만 바꿈).
function renderPipelinePrepareSetting(cfg) {
  if (!cfg) return "";
  const on = cfg.markPrepare === true;
  if (!cfg.isOwner) return `<p class="hint">카페24 배송준비중 자동 넘김: <b>${on ? "켜짐" : "꺼짐"}</b></p>`;
  return `<label class="switch-line"><input type="checkbox" data-pipe-prepare ${on ? "checked" : ""} ${cfg.writeScope ? "" : "disabled"}>
    <span>입금요청을 만들면 카페24 주문을 <b>배송준비중</b>으로 같이 넘기기</span>
    ${cfg.writeScope ? "" : `<span class="meta">카페24 주문 쓰기 권한이 있어야 켤 수 있습니다</span>`}</label>`;
}

function renderPipelineSteps(p) {
  const drafts = p.collect?.drafts || [];
  const steps = [
    { id: "flow-collect", label: "주문 수집", state: p.collect ? "done" : "current" },
    { id: "flow-collect", label: "요청 확인", state: !p.collect ? "todo" : drafts.length ? "current" : "done", note: p.collect ? (drafts.length ? `${drafts.length}건 남음` : "완료") : "" },
    { id: "flow-match", label: "입금매칭", state: "todo", note: canUseClobe() ? "클로브" : "" },
    { id: "flow-collect", label: "카페24 반영", state: p.settings?.markPrepare ? "done" : "later", note: p.settings?.markPrepare ? "생성 시 배송준비중" : "꺼짐" }
  ];
  return `<nav class="stepper" aria-label="주문매칭 단계"><ol>${steps.map((st, i) => {
    const inner = `<span class="step-no">${st.state === "done" ? '<svg viewBox="0 0 12 12" width="12" height="12" aria-hidden="true"><path d="M2.5 6.2 5 8.6l4.6-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>' : i + 1}</span>
      <span class="step-text"><b>${st.label}</b>${st.note ? `<small>${h(st.note)}</small>` : ""}</span>`;
    return `<li class="step is-${st.state}"${st.state === "current" ? ' aria-current="step"' : ""}>${st.id ? `<a href="#${st.id}">${inner}</a>` : `<span>${inner}</span>`}</li>`;
  }).join("")}</ol></nav>`;
}

// --- 반자동 파이프라인 ------------------------------------------------------
// 단계마다 버튼이 하나씩 있고, 각 버튼은 먼저 "무엇을 하게 될지"만 보여준다.
// 실제 생성·상태변경은 확인한 뒤 별도 버튼으로만 일어난다.
function renderPipeline() {
  const p = state.pipeline;
  const head = pageHead("주문매칭", "카페24 주문을 입금요청으로 만들고, 은행 입금과 맞춥니다.");
  if (!can("pipeline")) {
    return `${head}<section class="panel"><div class="panel-body"><p class="muted">주문매칭 권한이 없습니다. 관리자 메뉴에서 권한을 받아 주세요.</p></div></section>`;
  }
  return `
    ${head}
    ${renderPipelineSteps(p)}
    <section class="panel flow-section" id="flow-collect">
      <div class="panel-head"><h2>주문 수집</h2><span class="meta">카페24 결제 주문 → 입금요청</span></div>
      <div class="panel-body">
        <div class="action-row align-end">
          <div class="date-pair" role="group" aria-label="조회 기간">
            <label class="inline-field stacked"><span>시작일</span><input type="date" data-pipe-start value="${h(p.startDate)}" aria-label="조회 시작일"></label>
            <span class="range-sep" aria-hidden="true">~</span>
            <label class="inline-field stacked"><span>종료일</span><input type="date" data-pipe-end value="${h(p.endDate)}" aria-label="조회 종료일"></label>
          </div>
          <button class="primary" data-pipe-collect ${p.collecting ? "disabled" : ""}>${p.collecting ? "수집 중…" : "수집하기"}</button>
        </div>
        <p class="hint">결제된 주문만 가져오고, 이미 등록된 건은 건너뜁니다.</p>
        ${renderPipelinePrepareSetting(p.settings)}
        ${helpNote("확인 목록에 올라온 건은 <b>생성</b>을 눌러야 저장됩니다. 단, 자동 등록으로 설정한 브랜드는 수집과 동시에 등록됩니다.")}
        ${p.error ? notice("danger", "수집하지 못했습니다", h(p.error)) : ""}
        ${renderPipelineCollect(p.collect)}
      </div>
    </section>
    <section class="panel flow-section" id="flow-shipped">
      <div class="panel-head"><h2>출고 확인</h2><span class="meta">출고 후 입금 브랜드 · 입금대기 → 입금요청</span></div>
      <div class="panel-body">
        <div class="action-row">
          <button data-pipe-shipped ${p.shipping ? "disabled" : ""}>${p.shipping ? "확인 중…" : "출고 확인하기"}</button>
          <span class="meta">입금대기 건 중 카페24에 송장이 찍힌 것을 찾습니다.</span>
        </div>
        ${renderPipelineShipped(p.shipped)}
      </div>
    </section>
    ${canUseClobe() ? renderClobeFreshness(p.scraping) : ""}
  `;
}

// 클로브 데이터가 언제까지 반영된 것인지 보여준다. MCP 로는 재수집을 시킬 수
// 없어서(도구 자체가 없다) 최신화는 app.clobe.ai 에서 해야 한다 — 그 사실을
// 숨기지 말고 바로 갈 수 있게 링크를 둔다.
function renderClobeFreshness(scraping) {
  const assets = scraping?.assets || scraping?.content || [];
  const rows = (Array.isArray(assets) ? assets : []).map((a) => {
    const at = String(a.scrapedAt || "").slice(0, 16).replace("T", " ");
    const stale = a.scrapedAt ? (Date.now() - new Date(a.scrapedAt).getTime()) > 24 * 3600 * 1000 : true;
    const badge = a.status === "ERROR"
      ? `<span class="badge clobe-low">오류</span>`
      : stale ? `<span class="badge clobe-medium">오래됨</span>` : `<span class="badge clobe-high">최신</span>`;
    return `<tr><td>${badge}</td><td>${h(a.assetName || a.name || a.assetType || "")}</td>
      <td>${h(at || "-")}</td><td><span class="muted">${h(a.failureMessage || "")}</span></td></tr>`;
  }).join("");
  return `
    <section class="panel flow-section" id="flow-match">
      <div class="panel-head">
        <h2>입금매칭 준비 · 은행 내역 최신성</h2>
        <span class="meta">은행·카드 내역이 언제까지 수집됐는지</span>
      </div>
      <div class="panel-body">
        <div class="action-row">
          <button data-pipe-scraping>수집 상태 확인</button>
          <a class="button" href="https://app.clobe.ai" target="_blank" rel="noreferrer">클로브ai에서 최신화 ↗</a>
        </div>
        ${helpNote("최신화(재수집)는 클로브 쪽에서만 실행할 수 있습니다(클로브 MCP에 해당 기능이 없음). 링크로 이동해 실행한 뒤 돌아와서 대조하세요.")}
        ${rows ? `<div class="table-wrap" style="max-height:220px"><table class="collect-assets-table">
            <thead><tr><th>상태</th><th>자산</th><th>마지막 수집</th><th>비고</th></tr></thead>
            <tbody>${rows}</tbody></table></div>` : ""}
      </div>
    </section>
  `;
}

// 월정산 브랜드는 수집과 동시에 등록되므로 확인 목록에 없다. 소리 없이
// 사라진 것처럼 보이면 안 되니, 몇 건이 들어갔는지는 항상 알려주고 주문번호는
// 접어둔다.
function renderPipelineAutoCreated(autoCreated) {
  const rows = autoCreated || [];
  if (!rows.length) return "";
  const byBrand = new Map();
  for (const row of rows) byBrand.set(row.brandName, (byBrand.get(row.brandName) || 0) + 1);
  const summary = [...byBrand.entries()].map(([name, count]) => `${h(name)} ${count}`).join(" · ");
  return `
    <details class="auto-created">
      <summary>자동 등록됨 ${rows.length}건 <span class="muted">(${summary})</span></summary>
      <div class="table-wrap" style="max-height:220px;margin-top:8px">
        <table class="pipeline-drafts-table">
          <thead><tr><th>주문</th><th>브랜드</th><th>입금액</th></tr></thead>
          <tbody>${rows.map((row) => `<tr>
            <td>${h(row.orderNo)}<br><span class="muted">${h(row.customerName)}</span></td>
            <td>${h(row.brandName)}</td>
            <td class="num">${money.format(row.depositAmount || 0)}원</td>
          </tr>`).join("")}</tbody>
        </table>
      </div>
    </details>`;
}

function renderPipelineCollect(collect) {
  if (!collect) return "";
  const drafts = collect.drafts || [];
  const auto = renderPipelineAutoCreated(collect.autoCreated);
  if (!drafts.length) {
    return `<div class="collect-result">${auto}<p class="empty-line">확인이 필요한 입금요청은 없습니다. <span class="meta">조회 주문 ${money.format(collect.orderCount || 0)}건 ·
      이미 등록 ${collect.skipped?.duplicate || 0} · 미결제 제외 ${collect.skipped?.unpaid || 0}</span></p></div>`;
  }
  const selected = new Set(state.pipeline.selected);
  const rows = drafts.map((d, i) => {
    const lines = d.lineItems.map((l) => `${h(l.itemName)} ×${l.quantity}`).join("<br>");
    const codes = d.lineItems.map((l) => `<span class="muted">${h(l.orderItemCode)}</span>`).join("<br>");
    return `<tr>
      <td class="cell-check"><input type="checkbox" data-pipe-draft="${i}" ${selected.has(i) ? "checked" : ""} aria-label="${h(d.orderNo)} 선택"></td>
      <td data-label="주문">${h(d.orderNo)}<br><span class="muted">${h(d.customerName)}</span></td>
      <td data-label="브랜드">${h(d.brandName)}<br><span class="muted">${d.payAfterShipping ? "출고후입금 → 입금대기" : "입금요청"}</span></td>
      <td data-label="품목">${lines}</td>
      <td data-label="품목번호" class="cell-codes">${codes}</td>
      <td data-label="입금액" class="num"><strong>${money.format(d.depositAmount || 0)}원</strong><br>
        <span class="muted">판매 ${money.format(d.productSalesAmount || 0)} · 배송 ${money.format(d.baseShippingFee || 0)}</span></td>
      <td data-label="비고">
        ${d.shippingMismatch
          ? `<span class="badge clobe-medium">배송비 확인</span><br><span class="muted">카페24 ${money.format(d.cafe24ShippingFee || 0)}원</span>`
          : ""}
        ${d.catalogMismatch
          ? `<span class="badge clobe-medium">단가표 확인</span><br><span class="muted">${h(d.catalogNote || `미매칭: ${(d.catalogUnmatched || []).join(", ")}`)}</span>`
          : ""}
        ${!d.shippingMismatch && !d.catalogMismatch ? `<span class="muted">-</span>` : ""}
      </td>
      <td class="cell-action"><div class="cell-action-btns"><button type="button" class="small" data-pipe-draft-request="${i}">입금요청 입력</button><button type="button" class="small ghost" data-pipe-monthly="${i}" title="위탁(월 정산 후 입금) 업체로 바꾸고 바로 등록합니다">월단위입금</button></div></td>
    </tr>`;
  }).join("");
  return `
    <div class="collect-result">
      <div class="sub-head">
        <h3>요청 확인 <span class="count">${drafts.length}건</span></h3>
        <span class="meta">조회 주문 ${money.format(collect.orderCount || 0)}건 · 이미 등록 ${collect.skipped?.duplicate || 0} ·
          미결제 제외 ${collect.skipped?.unpaid || 0} · 취소만 ${collect.skipped?.cancelled || 0}</span>
      </div>
      ${(collect.unmappedSuppliers || []).length
        ? notice("warn", `브랜드가 지정되지 않은 공급사 ${collect.unmappedSuppliers.length}곳 — 이번 수집에서 빠졌습니다`,
            `${collect.unmappedSuppliers.slice(0, 5).map((s) => `${h(s.supplierName)}(${h(s.supplierId)}) ${s.orderCount}건`).join(", ")}<br>브랜드 화면에서 카페24 공급사코드를 지정하면 다음 수집부터 포함됩니다.`)
        : ""}
      ${auto}
      ${helpNote("행별 <b>입금요청 입력</b>은 그 건의 계산된 초안을 입금요청 창에 채워 보여줍니다. 수동 확인이 필요한 건(룰루키친 등)은 이 버튼으로 열어 필요한 값만 고쳐서 바로 등록하세요.")}
      <div class="table-wrap" style="max-height:420px"><table class="pipeline-drafts-table drafts-cards">
        <thead><tr><th class="cell-check"><input type="checkbox" data-pipe-all aria-label="모두 선택" ${drafts.length && selected.size === drafts.length ? "checked" : ""}></th><th>주문</th><th>브랜드</th><th>품목</th><th>품목번호</th><th>입금액</th><th>비고</th><th>동작</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <div class="action-row">
        <button class="primary" data-pipe-apply>선택한 ${state.pipeline.selected.length}건 입금요청 생성</button>
        <span class="meta">배송비·단가표가 어긋나는 건은 기본 선택에서 빼뒀습니다.</span>
      </div>
    </div>
  `;
}

function renderPipelineShipped(shipped) {
  if (!shipped) return "";
  const items = shipped.items || [];
  if (!items.length) return `<p class="empty-line">송장이 찍힌 입금대기 건이 없습니다.</p>`;
  const selected = new Set(state.pipeline.shippedSelected);
  const rows = items.map((it) => `<tr>
    <td class="cell-check"><input type="checkbox" data-pipe-ship="${h(it.requestId)}" ${selected.has(it.requestId) ? "checked" : ""} aria-label="${h(it.orderNo)} 선택"></td>
    <td>${h(it.orderNo)}</td><td>${h(it.brandName)}</td>
    <td class="num">${money.format(it.amount || 0)}원</td>
    <td><span class="muted">송장 ${h(it.trackingNo)}</span></td>
  </tr>`).join("");
  return `
    <div class="table-wrap" style="max-height:300px"><table class="pipeline-ship-table">
      <thead><tr><th class="cell-check"><input type="checkbox" data-pipe-ship-all aria-label="모두 선택"></th><th>주문</th><th>브랜드</th><th>금액</th><th>송장</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="action-row">
      <button class="primary" data-pipe-ship-apply>선택한 ${state.pipeline.shippedSelected.length}건 입금요청으로 전환</button>
    </div>
  `;
}

function renderReconcile(embedded = false) {
  const c = state.clobe;
  const head = embedded
    ? `<div class="section-title"><h2>입금매칭 · 클로브ai 대조</h2><p>은행 입금과 미입금 요청을 맞춥니다. 제안된 짝을 확인한 뒤 입금완료 처리하세요.</p></div>`
    : pageHead(
      "클로브ai",
      "클로브ai의 은행 입금내역과 미입금 요청을 대조합니다. 제안된 매칭을 확인 후 입금완료 처리하세요."
    );
  if (!canUseClobe()) {
    return `${head}<section class="panel"><div class="panel-body"><p class="muted">주문매칭(클로브) 권한이 없습니다. 관리자 메뉴에서 권한을 받아 주세요.</p></div></section>`;
  }
  if (c.loading || !c.status) {
    return `${head}<section class="panel"><div class="panel-body"><p class="muted">연동 상태를 불러오는 중…</p></div></section>`;
  }
  const clobeBody = c.status.connected
    ? `
      ${renderReconcileSettings()}
      ${c.error ? notice("danger", "대조하지 못했습니다", h(c.error)) : ""}
      ${renderReconcileResult(c.result)}
    `
    : renderReconcileConnect();
  return `${head}${clobeBody}${renderCafe24Panel()}`;
}

// 카페24 주문내역 자동 조회 연결. 클로브와 같은 자리에 두어 외부 연동을 한
// 화면에서 관리한다. 카페24는 https 리다이렉트만 허용하므로 배포된 주소에서만
// 연결이 성립한다.
function renderCafe24Panel() {
  const state24 = state.cafe24 || {};
  const status = state24.status;
  if (!status) {
    return `<section class="panel"><div class="panel-head"><h2>카페24 연동</h2></div>
      <div class="panel-body"><p class="muted">상태를 불러오는 중…</p></div></section>`;
  }
  if (!status.configured) {
    return `<section class="panel">
      <div class="panel-head"><h2>카페24 연동</h2></div>
      <div class="panel-body">
        ${notice("danger", "카페24 연동 설정이 없습니다", "서버 환경변수 CAFE24_MALL_ID / CAFE24_CLIENT_ID / CAFE24_CLIENT_SECRET 가 설정되지 않았습니다. 개발 담당에게 알려 주세요.")}
      </div></section>`;
  }
  if (!status.connected) {
    return `<section class="panel">
      <div class="panel-head"><h2>카페24 연동</h2><span class="muted">쇼핑몰 ${h(status.mallId)}</span></div>
      <div class="panel-body">
        <p class="muted">
          연결하면 카페24 주문내역을 직접 조회합니다. 정산할 때 CSV를 내려받아 올리는 단계가 없어지고,
          내려받은 시점 이후에 배송완료된 주문이 누락되는 문제도 사라집니다. <strong>읽기 전용</strong>으로만 접근합니다.
        </p>
        <div class="action-row"><button class="primary" data-cafe24-connect>카페24 연결하기</button></div>
      </div></section>`;
  }
  const expiryText = status.refreshTokenExpiresAt
    ? h(String(status.refreshTokenExpiresAt).slice(0, 16).replace("T", " "))
    : "";
  return `<section class="panel">
    <div class="panel-head">
      <h2>카페24 연동</h2>
      <span class="muted">쇼핑몰 ${h(status.mallId)}${status.connectedBy ? ` · ${h(status.connectedBy)} 연결` : ""}</span>
    </div>
    <div class="panel-body">
      ${status.expired
        ? notice("danger", `카페24 연결이 ${expiryText}에 만료됐습니다`, "주문 조회와 정산 자동조회가 모두 실패합니다. 아래 <strong>다시 연결하기</strong>를 눌러 카페24 관리자로 재승인해 주세요.")
        : `<p class="muted">
             연결됨. 주문내역을 조회할 수 있습니다.
             ${expiryText ? `갱신 토큰 만료 ${expiryText} (만료 전 자동 연장)` : "갱신 토큰은 2주마다 자동 연장됩니다."}
           </p>`}
      ${state24.sample ? `<pre class="table-wrap" style="max-height:260px;padding:12px;font-size:12px">${h(state24.sample)}</pre>` : ""}
      <div class="action-row">
        <button class="${status.expired ? "primary" : "ghost"}" data-cafe24-connect>다시 연결하기</button>
        <button data-cafe24-sample ${state24.sampling || status.expired ? "disabled" : ""}>${state24.sampling ? "조회 중…" : "주문 응답 샘플 보기"}</button>
        <button class="ghost" data-cafe24-disconnect>연결 해제</button>
      </div>
      ${state24.error ? notice("danger", "카페24 요청이 실패했습니다", h(state24.error)) : ""}
    </div></section>`;
}

function renderReconcileConnect() {
  return `
    <section class="panel">
      <div class="panel-head"><h2>클로브ai 연결</h2></div>
      <div class="panel-body">
        <p class="muted">
          연결하면 클로브에 등록된 회사 계좌의 입금내역을 읽어와 미입금 요청과 자동 대조합니다.
          WOOOF ERP는 <strong>읽기 전용</strong> 도구만 호출하며, 장부·전표를 수정하지 않습니다.
        </p>
        <div class="action-row"><button class="primary" data-clobe-connect>클로브ai 연결하기</button></div>
      </div>
    </section>
  `;
}

const BANK_NAMES = {
  "004": "국민", "003": "기업", "007": "수협", "011": "농협", "020": "우리",
  "023": "SC제일", "027": "씨티", "031": "대구", "032": "부산", "034": "광주",
  "035": "제주", "037": "전북", "039": "경남", "045": "새마을", "048": "신협",
  "071": "우체국", "081": "하나", "088": "신한", "089": "케이뱅크",
  "090": "카카오뱅크", "092": "토스뱅크"
};

// 계좌가 열 개 넘게 한 줄로 깔리면 어느 걸 골랐는지 읽히지 않는다. 실제로는
// 두세 개만 쓰므로 고른 계좌를 위로 올리고, 나머지는 접어둔다.
function renderClobeAccounts(accounts, selectedIds) {
  if (!accounts.length) return "";
  const selected = new Set((selectedIds || []).map(Number));
  const sorted = [...accounts].sort((a, b) => {
    const pick = Number(selected.has(Number(b.bankAccountId))) - Number(selected.has(Number(a.bankAccountId)));
    if (pick) return pick;
    return Number(b.krwBalance || 0) - Number(a.krwBalance || 0);
  });
  const showAll = state.clobe.showAllAccounts || !selected.size;
  const visible = showAll ? sorted : sorted.filter((a) => selected.has(Number(a.bankAccountId)));
  const hidden = sorted.length - visible.length;

  const card = (account) => {
    const id = Number(account.bankAccountId);
    const on = selected.has(id);
    const bank = BANK_NAMES[String(account.bankCode)] || "";
    const title = account.aliasName || account.accountName || "계좌";
    const fx = account.currencyCode && account.currencyCode !== "KRW" ? ` · ${h(account.currencyCode)}` : "";
    return `
      <label class="acct ${on ? "on" : ""}">
        <input type="checkbox" data-clobe-account value="${id}" ${on ? "checked" : ""}>
        <span class="acct-main">
          <span class="acct-title">${h(title)}</span>
          <span class="acct-sub">${h(bank)} ${h(account.displayAccountNumber || "")}${fx}</span>
        </span>
        <span class="acct-bal">${money.format(Math.round(Number(account.krwBalance || 0)))}원</span>
      </label>`;
  };

  return `
    <div class="acct-head">
      <span class="muted">전체 ${sorted.length}개 중 <b>${selected.size || sorted.length}개</b> 대사 대상${selected.size ? "" : " (미선택 = 전체)"}</span>
      <button type="button" class="ghost" data-clobe-toggle-accounts>${showAll ? "선택한 계좌만 보기" : `전체 보기 (+${hidden})`}</button>
    </div>
    <div class="acct-list">${visible.map(card).join("")}</div>
  `;
}

function renderReconcileSettings() {
  const c = state.clobe;
  const status = c.status;
  const accountRows = renderClobeAccounts(c.accounts || [], status.accountIds || []);
  return `
    <section class="panel">
      <div class="panel-head">
        <h2>연동 상태</h2>
        <span class="muted">${h(status.companyName || "회사 미선택")}${status.connectedBy ? ` · ${h(status.connectedBy)} 연결` : ""}</span>
      </div>
      <div class="panel-body">
        ${status.encryptedAtRest ? "" : notice("warn", "클로브 토큰이 암호화되지 않은 채 저장됩니다", "서버 환경변수 CLOBE_TOKEN_SECRET 가 설정되지 않았습니다.")}
        ${status.needsReauth
          ? notice("danger", "클로브 인증이 끊겼습니다", `${h(String(status.reauthRequiredAt).slice(0, 16).replace("T", " "))}에 갱신이 거부되어 입금내역 대조가 실패합니다. 아래 <strong>다시 인증하기</strong>를 눌러 다시 로그인해 주세요.`)
          : ""}
        <div class="field two">
          <div><label>대사 대상 회사</label>
            <input type="text" readonly value="${h(status.companyName || "주식회사 우프컴퍼니")}">
            <span class="muted">우프컴퍼니 법인으로 고정됩니다.</span></div>
          <div><label>입금예정일 허용 오차 (일)</label>
            <input type="number" min="0" max="60" data-clobe-window value="${Number(status.windowDays)}"></div>
        </div>
        ${accountRows ? `<div class="field"><label>대사에 포함할 계좌</label>${accountRows}</div>` : ""}
        <div class="action-row align-end">
          <div class="date-pair" role="group" aria-label="대조 기간">
            <label class="inline-field stacked"><span>시작일</span><input type="date" data-clobe-start value="${h(state.clobe.startDate)}" aria-label="대조 시작일"></label>
            <span class="range-sep" aria-hidden="true">~</span>
            <label class="inline-field stacked"><span>종료일</span><input type="date" data-clobe-end value="${h(state.clobe.endDate)}" aria-label="대조 종료일"></label>
          </div>
          <button class="${status.needsReauth ? "ghost" : "primary"}" data-clobe-run ${state.clobe.running || status.needsReauth ? "disabled" : ""}>${state.clobe.running ? "대조 중…" : "입금내역 대조"}</button>
          <button class="${status.needsReauth ? "primary" : "ghost"}" data-clobe-connect>다시 인증하기</button>
          <button class="ghost" data-clobe-disconnect>연결 해제</button>
          <span class="meta">${status.lastSyncAt ? `마지막 대조 ${h(status.lastSyncAt.slice(0, 16).replace("T", " "))}` : "아직 대조하지 않았습니다."}</span>
        </div>
        <p class="hint">은행 내역은 실시간이 아니라 클로브의 마지막 수집 시점 기준입니다.</p>
      </div>
    </section>
  `;
}

function renderReconcileResult(result) {
  if (!result) return "";
  const summary = result.summary || {};
  const matchRows = (result.matches || [])
    .map((match, index) => {
      const orders = match.requests
        .map((request) => `${h(request.brandName || "-")} · ${h(request.orderNo)} · ${money.format(Number(request.expectedAmount || 0))}원`)
        .join("<br>");
      const busy = state.clobe.confirming === String(index);
      return `
        <tr>
          <td><span class="badge clobe-${match.confidence}">${CONFIDENCE_LABEL[match.confidence] || match.confidence}</span></td>
          <td>${h((match.transaction.transactionAt || "").slice(0, 16).replace("T", " "))}<br>
            <span class="muted">${h(match.transaction.transactionName || "")}</span></td>
          <td class="num"><strong>${money.format(match.amount)}원</strong><br>
            <span class="muted">${
              match.kind === "memo" ? `메모 지정${match.requests.length > 1 ? ` ${match.requests.length}건` : ""}`
              : match.kind === "many_to_one" ? `${match.requests.length}건 합산`
              : "1:1"
            }</span></td>
          <td>${orders}</td>
          <td><span class="muted">${match.reasons.map((reason) => h(reason)).join(" · ")}</span></td>
          <td><button class="primary" data-clobe-confirm="${index}" ${busy ? "disabled" : ""}>${busy ? "처리 중…" : "입금완료"}</button></td>
        </tr>`;
    })
    .join("");

  const unmatchedDeposits = (result.unmatchedDeposits || [])
    .map((tx) => `<tr>
      <td>${h((tx.transactionAt || "").slice(0, 16).replace("T", " "))}</td>
      <td>${h(tx.transactionName || "")}</td>
      <td class="num">${money.format(Math.round(Number(tx.inAmount || 0)))}원</td>
      <td><span class="muted">${h(tx.category || "")}</span></td>
    </tr>`)
    .join("");

  return `
    <section class="panel">
      <div class="panel-head">
        <h2>대조 결과</h2>
        <span class="muted">입금 ${summary.depositCount || 0}건 · 미입금 요청 ${summary.requestCount || 0}건 ·
          매칭 ${summary.matchedCount || 0}건(요청 ${summary.matchedRequestCount || 0}건) · 확실 ${summary.highConfidenceCount || 0}건</span>
      </div>
      <div class="panel-body">
        ${matchRows
          ? `<div class="table-wrap"><table class="deposit-match-table"><thead><tr>
              <th>신뢰도</th><th>입금</th><th>금액</th><th>대응 요청</th><th>근거</th><th></th>
            </tr></thead><tbody>${matchRows}</tbody></table></div>`
          : `<p class="muted">매칭된 입금이 없습니다. 기간이나 계좌 설정을 확인하세요.</p>`}
      </div>
    </section>
    <section class="panel">
      <div class="panel-head">
        <h2>미매칭 입금 ${(result.unmatchedDeposits || []).length}건</h2>
        <span class="muted">요청과 짝이 없는 입금 — 수동 확인이 필요합니다.</span>
      </div>
      <div class="panel-body">
        ${unmatchedDeposits
          ? `<div class="table-wrap"><table class="deposit-unmatched-table"><thead><tr><th>일시</th><th>입금자</th><th>금액</th><th>분류</th></tr></thead>
             <tbody>${unmatchedDeposits}</tbody></table></div>`
          : `<p class="muted">미매칭 입금이 없습니다.</p>`}
      </div>
    </section>
  `;
}

function bindPipeline() {
  const p = state.pipeline;
  app.querySelector("[data-pipe-start]")?.addEventListener("change", (e) => { p.startDate = e.target.value; });
  app.querySelector("[data-pipe-end]")?.addEventListener("change", (e) => { p.endDate = e.target.value; });

  app.querySelector("[data-pipe-scraping]")?.addEventListener("click", async () => {
    try {
      p.scraping = await api("/api/clobe/scraping");
      renderApp();
    } catch (error) {
      showToast(error.message || "수집 상태를 불러오지 못했습니다.", "error");
    }
  });

  app.querySelector("[data-pipe-collect]")?.addEventListener("click", async () => {
    p.collecting = true; p.error = ""; p.collect = null; p.selected = [];
    renderApp();
    try {
      p.collect = await api("/api/pipeline/collect", { method: "POST", body: { startDate: p.startDate, endDate: p.endDate } });
      if (p.collect.prepared) showToast(`자동 등록 ${p.collect.autoCreated?.length || 0}건${prepareNote(p.collect.prepared)}`, p.collect.prepared.failed?.length ? "error" : "");
      // 배송비가 어긋나거나 단가표 매칭이 안 된 건은 사람이 먼저 보게 기본 선택에서 뺀다.
      p.selected = (p.collect.drafts || [])
        .map((d, i) => (d.shippingMismatch || d.catalogMismatch ? null : i))
        .filter((v) => v !== null);
    } catch (error) {
      p.error = error.message || "수집에 실패했습니다.";
    } finally {
      p.collecting = false; renderApp();
    }
  });

  app.querySelectorAll("[data-pipe-draft]").forEach((box) => {
    box.addEventListener("change", () => {
      const i = Number(box.dataset.pipeDraft);
      p.selected = box.checked ? [...new Set([...p.selected, i])] : p.selected.filter((x) => x !== i);
      renderApp();
    });
  });
  const pipeAll = app.querySelector("[data-pipe-all]");
  if (pipeAll) {
    // 일부만 골라져 있을 때는 '중간' 표시를 해둔다 -- 체크가 꺼져 보이면
    // 다음 클릭이 전체 해제인지 전체 선택인지 헷갈린다. (HTML 속성으로는
    // 표현할 수 없어 그린 뒤에 직접 넣는다.)
    const total = (p.collect?.drafts || []).length;
    pipeAll.indeterminate = p.selected.length > 0 && p.selected.length < total;
    pipeAll.addEventListener("change", (e) => {
      p.selected = e.target.checked ? (p.collect?.drafts || []).map((_, i) => i) : [];
      renderApp();
    });
  }

  app.querySelectorAll("[data-pipe-draft-request]").forEach((button) => {
    button.addEventListener("click", () => {
      const draft = p.collect?.drafts?.[Number(button.dataset.pipeDraftRequest)];
      if (!draft) return;
      try {
        localStorage.setItem(DRAFT_PREFILL_KEY, JSON.stringify(draft));
      } catch {
        showToast("초안을 입금요청 창으로 넘기지 못했습니다.", "error");
        return;
      }
      window.open("/?request-popup=1&draft-prefill=1", "wooofpay-request", "width=760,height=940,resizable=yes,scrollbars=yes");
    });
  });

  if (!p.settings && !p.settingsLoading) {
    p.settingsLoading = true;
    api("/api/pipeline/settings").then((cfg) => { p.settings = cfg; renderApp(); }).catch(() => {}).finally(() => { p.settingsLoading = false; });
  }
  app.querySelector("[data-pipe-prepare]")?.addEventListener("change", async (e) => {
    const on = e.target.checked;
    if (on && !confirm("이제부터 주문매칭에서 입금요청을 만들면, 그 주문(해당 브랜드 품목)이 카페24에서 배송준비중으로 바뀝니다. 켤까요?")) { e.target.checked = false; return; }
    try { const cfg = await api("/api/pipeline/settings", { method: "PUT", body: { markPrepare: on } }); p.settings = { ...p.settings, ...cfg }; showToast(on ? "배송준비중 자동 넘김을 켰습니다." : "배송준비중 자동 넘김을 껐습니다."); }
    catch (err) { showToast(err.message, "error"); e.target.checked = !on; }
    renderApp();
  });
  app.querySelectorAll("[data-pipe-monthly]").forEach((button) => button.addEventListener("click", async () => {
    const all = p.collect?.drafts || [];
    const draft = all[Number(button.dataset.pipeMonthly)];
    if (!draft) return;
    const same = all.filter((d) => d.brandId === draft.brandId);
    if (!confirm(`${draft.brandName}을(를) 월단위입금 업체로 바꿀까요?\n\n· 위탁(월 정산 후 입금)으로 분류됩니다.\n· 지금 목록의 ${draft.brandName} 주문 ${same.length}건이 위탁-입금전으로 바로 등록됩니다.\n· 앞으로 이 브랜드 주문은 확인 목록 없이 수집할 때 바로 등록됩니다.`)) return;
    try {
      const r = await api("/api/pipeline/monthly/apply", { method: "POST", body: { brandId: draft.brandId, drafts: same } });
      const keep = all.filter((d) => d.brandId !== draft.brandId);
      const selectedDrafts = new Set(p.selected.map((i) => all[i]));
      p.collect.autoCreated = [...(p.collect.autoCreated || []), ...same.map((d) => ({ orderNo: d.orderNo, brandName: d.brandName, customerName: d.customerName, depositAmount: d.depositAmount }))];
      p.collect.drafts = keep;
      p.selected = keep.map((d, i) => (selectedDrafts.has(d) ? i : null)).filter((v) => v !== null);
      showToast(`${r.brandName}: 월단위입금으로 바꾸고 ${r.createdCount}건 등록했습니다.${prepareNote(r.prepared)}`, r.prepared?.failed?.length ? "error" : "");
      await loadAll();
      renderApp();
    } catch (error) { showToast(error.message || "바꾸지 못했습니다.", "error"); }
  }));

  app.querySelector("[data-pipe-apply]")?.addEventListener("click", async () => {
    const drafts = p.selected.map((i) => p.collect?.drafts?.[i]).filter(Boolean);
    if (!drafts.length) return showToast("생성할 요청을 선택하세요.", "error");
    if (!confirm(`${drafts.length}건의 입금요청을 생성할까요?`)) return;
    try {
      const result = await api("/api/pipeline/collect/apply", { method: "POST", body: { drafts } });
      showToast(`${result.createdCount}건 생성했습니다.${result.skipped?.length ? ` (중복 ${result.skipped.length}건 제외)` : ""}${prepareNote(result.prepared)}`, result.prepared?.failed?.length ? "error" : "");
      p.collect = null; p.selected = [];
      await loadAll();
      renderApp();
    } catch (error) {
      showToast(error.message || "생성에 실패했습니다.", "error");
    }
  });

  app.querySelector("[data-pipe-shipped]")?.addEventListener("click", async () => {
    p.shipping = true; p.shipped = null; p.shippedSelected = [];
    renderApp();
    try {
      p.shipped = await api("/api/pipeline/shipped", { method: "POST", body: {} });
      p.shippedSelected = (p.shipped.items || []).map((it) => it.requestId);
    } catch (error) {
      showToast(error.message || "출고 확인에 실패했습니다.", "error");
    } finally {
      p.shipping = false; renderApp();
    }
  });

  app.querySelectorAll("[data-pipe-ship]").forEach((box) => {
    box.addEventListener("change", () => {
      const id = box.dataset.pipeShip;
      p.shippedSelected = box.checked
        ? [...new Set([...p.shippedSelected, id])]
        : p.shippedSelected.filter((x) => x !== id);
      renderApp();
    });
  });
  app.querySelector("[data-pipe-ship-all]")?.addEventListener("change", (e) => {
    p.shippedSelected = e.target.checked ? (p.shipped?.items || []).map((it) => it.requestId) : [];
    renderApp();
  });

  app.querySelector("[data-pipe-ship-apply]")?.addEventListener("click", async () => {
    if (!p.shippedSelected.length) return showToast("전환할 건을 선택하세요.", "error");
    try {
      const result = await api("/api/pipeline/shipped/apply", { method: "POST", body: { requestIds: p.shippedSelected } });
      showToast(`${result.updatedCount}건을 입금요청으로 전환했습니다.`);
      p.shipped = null; p.shippedSelected = [];
      await loadAll();
      renderApp();
    } catch (error) {
      showToast(error.message || "전환에 실패했습니다.", "error");
    }
  });
}

function bindReconcile() {
  const c = state.clobe;
  // 클로브 권한이 없으면 클로브 상태를 부르지 않는다. 부르면 403 이 나고
  // status 가 계속 비어 있어 화면을 그릴 때마다 다시 요청하게 된다.
  if (!canUseClobe()) {
    if (!state.cafe24.status && !state.cafe24.requested) {
      state.cafe24.requested = true;
      loadCafe24Status().then(renderApp).catch(() => {});
    }
    return;
  }
  if (!c.status && !c.loading) {
    c.loading = true;
    Promise.all([loadClobeStatus(), loadCafe24Status()]).finally(() => {
      c.loading = false;
      renderApp();
    });
    return;
  }
  if (!state.cafe24.status) {
    loadCafe24Status().then(renderApp);
  }

  app.querySelector("[data-cafe24-connect]")?.addEventListener("click", async () => {
    try {
      const { authorizeUrl } = await api("/api/cafe24/connect", { method: "POST" });
      window.location.href = authorizeUrl;
    } catch (error) {
      showToast(error.message || "카페24 연결 준비 실패", "error");
    }
  });

  app.querySelector("[data-cafe24-disconnect]")?.addEventListener("click", async () => {
    if (!confirm("카페24 연결을 해제할까요? 저장된 토큰이 삭제됩니다.")) return;
    await api("/api/cafe24/disconnect", { method: "POST" });
    state.cafe24.status = null;
    state.cafe24.sample = "";
    await loadCafe24Status();
    renderApp();
  });

  // 정산 엔진이 읽는 한글 컬럼과 매핑하려면 실제 응답의 필드명이 필요하다.
  app.querySelector("[data-cafe24-sample]")?.addEventListener("click", async () => {
    state.cafe24.sampling = true;
    state.cafe24.error = "";
    renderApp();
    try {
      const end = new Date().toISOString().slice(0, 10);
      const start = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const payload = await api(`/api/cafe24/sample?startDate=${start}&endDate=${end}&limit=1`);
      state.cafe24.sample = JSON.stringify(payload, null, 2).slice(0, 20000);
    } catch (error) {
      state.cafe24.error = error.message || "샘플 조회 실패";
      // 토큰이 죽어서 실패한 거라면 패널이 계속 "연결됨"으로 보이면 안 된다.
      if (/재연결|만료/.test(state.cafe24.error)) await loadCafe24Status();
    } finally {
      state.cafe24.sampling = false;
      renderApp();
    }
  });

  app.querySelector("[data-clobe-connect]")?.addEventListener("click", async () => {
    try {
      const { authorizeUrl } = await api("/api/clobe/connect", { method: "POST" });
      // Full-page navigation, not a popup: the OAuth callback needs to land
      // back on this origin with the session cookie attached.
      window.location.href = authorizeUrl;
    } catch (error) {
      showToast(error.message || "클로브 연결 준비 실패", "error");
    }
  });

  app.querySelector("[data-clobe-disconnect]")?.addEventListener("click", async () => {
    if (!confirm("클로브 연결을 해제할까요? 저장된 토큰이 삭제됩니다.")) return;
    await api("/api/clobe/disconnect", { method: "POST" });
    state.clobe.status = null;
    state.clobe.result = null;
    state.clobe.companies = null;
    state.clobe.accounts = null;
    renderApp();
  });

  app.querySelector("[data-clobe-window]")?.addEventListener("change", async (event) => {
    await saveClobeSettings({ windowDays: Number(event.target.value) });
  });

  app.querySelector("[data-clobe-toggle-accounts]")?.addEventListener("click", () => {
    state.clobe.showAllAccounts = !state.clobe.showAllAccounts;
    renderApp();
  });

  app.querySelectorAll("[data-clobe-account]").forEach((box) => {
    box.addEventListener("change", async () => {
      const accountIds = Array.from(app.querySelectorAll("[data-clobe-account]"))
        .filter((item) => item.checked)
        .map((item) => Number(item.value));
      await saveClobeSettings({ accountIds });
    });
  });

  app.querySelector("[data-clobe-start]")?.addEventListener("change", (event) => {
    state.clobe.startDate = event.target.value;
  });
  app.querySelector("[data-clobe-end]")?.addEventListener("change", (event) => {
    state.clobe.endDate = event.target.value;
  });

  app.querySelector("[data-clobe-run]")?.addEventListener("click", async () => {
    if (!state.clobe.status?.companyId) return showToast("대사 대상 회사를 먼저 선택하세요.", "error");
    state.clobe.running = true;
    state.clobe.error = "";
    renderApp();
    try {
      state.clobe.result = await api("/api/clobe/reconcile", {
        method: "POST",
        body: { startDate: state.clobe.startDate, endDate: state.clobe.endDate }
      });
      await loadClobeStatus();
      const matched = state.clobe.result.summary?.matchedCount || 0;
      showToast(matched ? `${matched}건의 입금을 매칭했습니다.` : "매칭된 입금이 없습니다.");
    } catch (error) {
      state.clobe.error = error.message || "대조에 실패했습니다.";
      showToast(state.clobe.error, "error");
      // 재인증이 필요해서 실패한 거라면 패널이 그 사실을 바로 보여줘야 한다.
      if (/재인증/.test(state.clobe.error)) await loadClobeStatus();
    } finally {
      state.clobe.running = false;
      renderApp();
    }
  });

  app.querySelectorAll("[data-clobe-confirm]").forEach((button) => {
    button.addEventListener("click", async () => {
      const index = button.dataset.clobeConfirm;
      const match = state.clobe.result?.matches?.[Number(index)];
      if (!match) return;
      const orders = match.requests.map((request) => request.orderNo).join(", ");
      if (!confirm(`${money.format(match.amount)}원 입금을 다음 요청에 입금완료 처리할까요?\n${orders}`)) return;
      state.clobe.confirming = String(index);
      renderApp();
      try {
        // paidAmount is intentionally omitted so each request keeps its own
        // amount — mark-paid falls back to the request's depositAmount, which
        // is what an N:1 lump deposit needs.
        await api("/api/requests/mark-paid", {
          method: "POST",
          body: {
            requestIds: match.requests.map((request) => request.id),
            paidAt: match.transaction.transactionAt || state.clobe.endDate
          }
        });
        state.clobe.result.matches.splice(Number(index), 1);
        await loadAll();
        showToast(`${match.requests.length}건 입금완료 처리했습니다.`);
      } catch (error) {
        showToast(error.message || "입금완료 처리 실패", "error");
      } finally {
        state.clobe.confirming = "";
        renderApp();
      }
    });
  });
}

async function loadClobeStatus() {
  const status = await api("/api/clobe/status");
  state.clobe.status = status;
  if (!status.connected) return;
  try {
    // 두 목록을 한꺼번에 받는다(차례로 받으면 왕복이 두 번).
    const [companies, accounts] = await Promise.all([
      state.clobe.companies ? null : api("/api/clobe/companies"),
      status.companyId && !state.clobe.accounts ? api("/api/clobe/accounts") : null
    ]);
    if (companies) state.clobe.companies = companies.companies || [];
    if (accounts) state.clobe.accounts = accounts.accounts || [];
  } catch (error) {
    state.clobe.error = error.message || "클로브 데이터를 불러오지 못했습니다.";
  }
}

async function loadCafe24Status() {
  try {
    state.cafe24.status = await api("/api/cafe24/status");
  } catch (error) {
    state.cafe24.error = error.message || "카페24 상태를 불러오지 못했습니다.";
    // 상태를 못 받아도 status 는 채워 둔다. null 로 두면 패널이 "불러오는 중…"
    // 에 멈춘 채 bindReconcile 이 매 렌더마다 다시 부른다.
    state.cafe24.status = { configured: false, connected: false, expired: false, mallId: "" };
  }
}

async function saveClobeSettings(patch) {
  try {
    state.clobe.status = await api("/api/clobe/settings", { method: "POST", body: patch });
  } catch (error) {
    showToast(error.message || "설정 저장 실패", "error");
  }
}

function renderNpb() {
  const n = state.npb;
  if (n.loading) {
    return `
      ${pageHead("npb정산", "채널별 매출·수수료·물류비를 집계합니다.")}
      <section class="panel"><div class="panel-body empty">불러오는 중…</div></section>`;
  }
  // 화면 이동은 좌측 사이드바의 하위 메뉴로 옮겼다.
  let body = "";
  if (n.screen === "upload") body = renderNpbUpload();
  else if (n.screen === "expenses") body = renderNpbExpenses();
  else if (n.screen === "worksheet") body = renderNpbWorksheet();
  else if (n.screen === "channels") body = renderNpbChannels();
  else if (n.screen === "preview") body = renderNpbPreview();
  else body = renderNpbList();
  const brand = (n.brands || []).find((b) => b.id === npbBrand());
  const picker = `
    <select data-npb-brand>
      ${(n.brands || []).map((b) => `<option value="${h(b.id)}" ${b.id === npbBrand() ? "selected" : ""}>${h(b.name)}</option>`).join("")}
    </select>`;
  const ctx = `${picker}${n.currentKey
    ? `<span class="muted">선택: ${h(n.currentKey)}</span>`
    : `<span class="muted">정산 미선택</span>`}`;
  const desc = brand
    ? `${brand.name}${brand.productLine ? ` · ${brand.productLine}` : ""} 채널별 매출·수수료·물류비를 집계하여 월 정산과 이익분배를 계산합니다.`
    : "채널별 매출·수수료·물류비를 집계하여 월 정산과 이익분배를 계산합니다.";
  return `
    ${pageHead("npb정산", desc, ctx)}
    ${body}
  `;
}

function renderNpbList() {
  const n = state.npb;
  const list = Array.isArray(n.settlements) ? n.settlements : [];
  const rows = list
    .map((s) => {
      const r = s.rollup || {};
      return `
        <tr>
          <td>${npbStatusBadge(s.status)}</td>
          <td>${h(s.periodMonth
            || (s.period?.year ? `${s.period.year}-${String(s.period.month).padStart(2, "0")}` : "")
            || String(s.key || "").split("_").pop())}</td>
          <td class="num">${money.format(Math.round(Number(r.qtyTotal || 0)))}</td>
          <td class="num">${npbWon(r.revenueTotal)}</td>
          <td class="num">${npbWon(r.profit)}</td>
          <td>
            <div class="row-actions">
              <button data-npb-view="${h(s.key)}">보기</button>
              <button data-npb-download="${h(s.key)}">다운로드</button>
              <button data-npb-reissue="${h(s.key)}">재발행</button>
            </div>
          </td>
        </tr>`;
    })
    .join("") || `<tr><td colspan="6" class="empty">생성된 정산이 없습니다.</td></tr>`;
  return `
    <section class="panel">
      <div class="panel-head"><h2>월 정산 생성</h2></div>
      <div class="panel-body">
        <div class="field two">
          <div><label>정산 월</label><input type="month" data-npb-period value="${h(n.periodMonth)}"></div>
          <div style="align-self:end"><button class="primary" data-npb-create>정산 생성</button></div>
        </div>
      </div>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>정산 이력</h2><span class="muted">${list.length}건</span></div>
      <div class="table-wrap">
        <table class="npb-months-table">
          <thead><tr><th>상태</th><th>정산월</th><th>총수량</th><th>매출계</th><th>이익</th><th>작업</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>
  `;
}

// 거래관리에 발행해 둔 거래명세서를 골라 채널 자료로 가져오는 선택표.
// 명세서마다 납품단가가 다를 수 있어 전부 자동이 아니라 골라서 가져온다.
function renderNpbTradeDocs() {
  const n = state.npb;
  const t = n.tradeDocs;
  if (!t) return "";
  const picked = new Set(t.picked || []);
  const docs = t.docs || [];
  const rows = docs.map((d) => `
    <label class="npb-tdoc-row ${d.importedTo ? "imported" : ""}">
      <input type="checkbox" data-npb-tdoc-pick="${h(d.id)}" ${picked.has(d.id) ? "checked" : ""}>
      <span class="npb-tdoc-main">
        <b>${h(d.orderDate || "")}</b> · ${h(d.docNo || "")} · ${h(d.partnerName || "(거래처 없음)")}
        ${d.importedTo ? `<span class="badge ok">불러옴 → ${h(npbChannelName(d.importedTo))}</span>` : ""}
      </span>
      <span class="muted">${h((d.items || []).join(", "))}</span>
      <span class="npb-tdoc-amt">공급가 ${npbWon(d.subtotal)} · 합계(VAT포함) ${npbWon(d.total)}</span>
    </label>`).join("");
  return `
    <div class="npb-pending-wrap npb-tdoc">
      <div class="toolbar">
        <b>거래관리 명세서 — ${h(t.periodMonth || "")}</b>
        <select data-npb-tdoc-channel>
          ${(t.channels || []).map((c) =>
            `<option value="${h(c.code)}" ${c.code === t.channel ? "selected" : ""}>${h(c.name)}</option>`).join("")}
        </select>
        <button class="primary" data-npb-tdoc-go ${picked.size ? "" : "disabled"}>
          선택 ${picked.size}건 이 채널로 가져오기
        </button>
        <button class="ghost" data-npb-tdoc-close>닫기</button>
      </div>
      ${docs.length ? rows : `<p class="muted">이 정산 월(${h(t.periodMonth || "")})에 발행된 거래명세서가 없습니다.
        거래관리에서 양식을 '거래명세서'로 저장해야 여기 보입니다.</p>`}
      <p class="muted" style="margin:6px 0 0">
        명세서의 공급가(부가세 미포함)에 10%를 더한 납품액이 정산액으로 들어가고,
        매출은 소비자정가(없으면 상품표 정가) × 수량으로 잡습니다. 가져온 뒤 검수표에서 확인하세요.
      </p>
    </div>`;
}

function renderNpbUpload() {
  const n = state.npb;
  if (!n.currentKey) return npbNeedSelect();
  const channels = (n.config?.channels || []).filter((c) => c.active !== false);
  const uploads = n.current?.uploads || {};

  // 채널별 업로드 칸을 늘어놓는 대신, 어느 채널이 들어왔고 무엇이 비었는지만
  // 보여준다. 파일은 한 곳에 올리고 파일명이 채널을 결정한다.
  const done = channels.filter((c) => uploads[c.code]);
  const todo = channels.filter((c) => !uploads[c.code]);
  const modeSelect = (c) => `
    <select data-npb-entry="${h(c.code)}" title="업로드한 파일을 어디까지 자동 반영할지">
      ${NPB_ENTRY_MODES.map(([value, label]) =>
        `<option value="${value}" ${(c.entryMode || "review") === value ? "selected" : ""}>${label}</option>`).join("")}
    </select>`;
  const noSales = n.current?.noSales || {};
  const picked = new Set(n.uploadPicked || []);
  const chip = (c, isDone) => {
    const up = uploads[c.code];
    // 판매가 없던 달과 파일을 깜빡한 달이 똑같이 "미업로드"로 보이면,
    // 마감할 때마다 그 채널을 다시 뒤져봐야 한다.
    const isNoSales = !isDone && Boolean(noSales[c.code]);
    // 사용안함으로 둔 채널은 제목만 남기고 접는다 -- 쓰지 않기로 한 것이
    // 쓰는 것과 같은 자리를 차지하면 목록이 읽히지 않는다.
    if (isDone && up.disabled) {
      return `<div class="npb-ch-chip off">
        <label class="npb-chip-pick">
          <input type="checkbox" data-npb-pick="${h(c.code)}" ${picked.has(c.code) ? "checked" : ""}>
          <strong>${h(c.name)}</strong>
        </label>
        <span class="muted">사용안함 · ${h(up.fileName || "업로드됨")}</span>
        <div class="npb-chip-actions">
          <button data-npb-enable="${h(c.code)}">다시 사용</button>
        </div>
      </div>`;
    }
    return `<div class="npb-ch-chip ${isDone ? "on" : ""} ${isNoSales ? "none" : ""}">
      ${isDone
        ? `<label class="npb-chip-pick">
             <input type="checkbox" data-npb-pick="${h(c.code)}" ${picked.has(c.code) ? "checked" : ""}>
             <strong>${h(c.name)}</strong>
           </label>`
        : `<strong>${h(c.name)}</strong>`}
      ${modeSelect(c)}
      <span class="muted">${isDone
        ? `${h(up.fileName || "업로드됨")}${up.lines ? ` · ${up.lines.length}개 품목` : ""}`
        : isNoSales ? "이달 내역 없음" : "미업로드"}</span>
      ${isDone ? `<div class="npb-chip-actions">
        ${up.pendingRemove
          ? `<span class="badge" style="color:var(--red)">삭제 대기</span>`
          : up.confirmed === false
            ? `<span class="badge" style="color:var(--red)">반영 대기</span>`
            : `<span class="badge ok">반영됨</span>`}
        ${up.confirmed === false
          ? `<button class="primary" data-npb-apply="${h(c.code)}">반영</button>`
          : ""}
        ${(c.entryMode || "review") === "review" && !up.pendingRemove
          ? `<button data-npb-review-open="${h(c.code)}">검수</button>`
          : ""}
        <button class="ghost" data-npb-upload-del="${h(c.code)}" title="올린 파일 빼기">✕</button>
      </div>` : `<div class="npb-chip-actions">
        ${isNoSales
          ? `<span class="badge ok">확인함</span>
             <button class="ghost" data-npb-nosales-undo="${h(c.code)}" title="표시 취소">✕</button>`
          : `<button class="ghost" data-npb-sample="${h(c.code)}"
               title="파서가 찾는 열 그대로의 빈 양식">샘플양식</button>
             <button class="ghost" data-npb-nosales="${h(c.code)}">이달 내역 없음</button>`}
      </div>`}
    </div>`;
  };

  // 올렸지만 아직 확정하지 않은 채널. 올려놓고 잊으면 워크시트가 비어 있어
  // 업로드가 안 된 것처럼 보인다.
  const waiting = channels.filter((c) => uploads[c.code] && uploads[c.code].confirmed === false);
  const applyAll = waiting.length > 1;

  const pending = (n.pendingUploads || []).map((f, i) => `
    <div class="npb-pending">
      <span>${h(f.fileName)}</span>
      <select data-npb-assign="${i}">
        <option value="">채널 선택…</option>
        ${channels.map((c) => `<option value="${h(c.code)}">${h(c.name)}</option>`).join("")}
      </select>
      <button data-npb-assign-go="${i}">이 채널로 처리</button>
    </div>`).join("");

  return `
    <section class="panel">
      <div class="panel-head">
        <h2>채널 파일 업로드</h2>
        <span class="muted">${done.length} / ${channels.length} 채널 수집됨</span>
      </div>
      <div class="panel-body">
        <div class="npb-dropzone">
          <input type="file" accept=".csv,.xlsx,.xls" multiple data-npb-upload-any>
          <span class="muted">
            여러 파일을 한 번에 올릴 수 있습니다. <b>파일명으로 채널을 자동 인식</b>합니다
            (채널 설정의 '파일명 키워드' 또는 채널명·코드 기준).
          </span>
        </div>
        <div class="toolbar" style="margin-top:8px">
          <button data-npb-tdoc-open>거래관리 명세서 불러오기</button>
          <span class="muted">
            wooofpay 거래관리에서 이 정산 월에 발행한 거래명세서를 파일 없이 바로 가져옵니다
            (테일릿처럼 우리가 명세서를 발행하는 채널).
          </span>
        </div>
        ${renderNpbTradeDocs()}
        ${waiting.length ? `<div class="npb-pending-wrap">
          ${notice("warn", `반영 대기 ${waiting.length}개 채널 — ${h(waiting.map((c) => c.name).join(", "))}`, "채널별 <b>[반영]</b>을 눌러야 워크시트에 들어갑니다. 누른 채널만 바뀌므로, 워크시트에서 손으로 고쳐 둔 다른 채널은 그대로입니다.")}
          <div class="toolbar">
            ${waiting.map((c) => `<button class="primary" data-npb-apply="${h(c.code)}">${h(c.name)} 반영</button>`).join("")}
          </div>
        </div>` : ""}
        ${renderNpbUnresolved()}
        ${pending ? `<div class="npb-pending-wrap">
          ${notice("warn", "채널을 알 수 없는 파일이 있습니다", "직접 지정하세요.")}
          ${pending}</div>` : ""}
        ${done.length ? `<div class="npb-bulk">
          <label><input type="checkbox" data-npb-pick-all
            ${picked.size && picked.size === done.length ? "checked" : ""}> 전체 선택</label>
          <span class="muted">${picked.size ? `${picked.size}개 선택됨` : "올린 파일을 골라 한 번에 처리합니다"}</span>
          <div class="toolbar">
            <button class="primary" data-npb-bulk="apply" ${picked.size ? "" : "disabled"}>선택 반영</button>
            <button data-npb-bulk="disable" ${picked.size ? "" : "disabled"}>선택 사용안함</button>
            <button class="danger" data-npb-bulk="delete" ${picked.size ? "" : "disabled"}>선택 삭제</button>
          </div>
        </div>` : ""}
        <div class="npb-ch-chips">
          ${done.map((c) => chip(c, true)).join("")}
          ${todo.map((c) => chip(c, false)).join("")}
        </div>
      </div>
    </section>
    ${renderNpbReview()}
  `;
}

// 판매처마다 상품명이 달라 자동으로 못 맞춘 것들. 한 번 지정하면 별칭으로
// 저장돼 다음 업로드부터는 그대로 인식된다.
// 판매처 상품명 매칭. 셀메이트의 두 단계를 그대로 따른다.
//   1. 상품명매칭 — 어느 기본 SKU 인가
//   2. 재고매칭   — 한 건이 그 SKU 를 몇 개 빼는가 (주문수량 × 배수)
// 조합형(치킨2+고구마1)을 위해 한 이름에 SKU 를 여럿 걸 수 있다.
const NPB_MULTIPLIERS = [1, 2, 3, 4, 5, 6, 10, 12, 20, 24, 50, 100];

function npbAliasDraftFor(i) {
  const n = state.npb;
  if (!n.aliasDraft) n.aliasDraft = {};
  if (!n.aliasDraft[i]) {
    // 이름으로 짐작한 값을 기본 선택으로 깔아 둔다. 조용히 적용하지는 않고,
    // 사람이 보고 [매칭 저장] 을 눌러야 규칙이 된다.
    const guess = (n.unresolved || [])[i]?.suggestion;
    n.aliasDraft[i] = {
      targets: [guess
        ? { productId: guess.productId, multiplier: Number(guess.multiplier || 1) }
        : { productId: "", multiplier: 1 }]
    };
  }
  const draft = n.aliasDraft[i];
  if (!Array.isArray(draft.targets)) draft.targets = [{ productId: "", multiplier: 1 }];
  return draft;
}

function renderNpbUnresolved() {
  const n = state.npb;
  const list = n.unresolved || [];
  if (!list.length) return "";
  const products = (n.config?.products || []).filter((p) => p.active !== false);

  const rows = list.map((u, i) => {
    const draft = npbAliasDraftFor(i);
    const targetRows = draft.targets.map((t, ti) => `
      <div class="npb-match-target">
        <select data-npb-alias="${i}" data-npb-at="${ti}" data-npb-af="productId">
          <option value="">상품 선택…</option>
          ${products.map((p) =>
            `<option value="${h(p.id)}" ${t.productId === p.id ? "selected" : ""}>${h(p.name)}</option>`).join("")}
          ${ti === 0 ? `<option value="__ignore" ${t.productId === "__ignore" ? "selected" : ""}>— 이 브랜드 상품 아님 (무시)</option>` : ""}
        </select>
        <select data-npb-alias="${i}" data-npb-at="${ti}" data-npb-af="multiplier" title="한 건이 재고에서 몇 개 빠지는가">
          ${NPB_MULTIPLIERS.map((m) =>
            `<option value="${m}" ${Number(t.multiplier || 1) === m ? "selected" : ""}>주문수량${m > 1 ? ` × ${m}` : ""}</option>`).join("")}
        </select>
        ${ti > 0 ? `<button class="ghost" data-npb-alias-del="${i}:${ti}">−</button>` : ""}
      </div>`).join("");
    return `
      <tr>
        <td class="wrap">${h(u.sourceName)}
          ${u.sourceCode ? `<div class="muted">코드 ${h(u.sourceCode)}</div>` : ""}
          ${u.option ? `<div class="muted">옵션 ${h(u.option)}</div>` : ""}
          ${u.suggestion ? `<span class="badge">추정</span>` : ""}</td>
        <td class="num">${money.format(u.qty || 0)}</td>
        <td>
          ${targetRows}
          <button class="ghost" data-npb-alias-add="${i}">+ 상품 추가 (조합형)</button>
        </td>
      </tr>`;
  }).join("");

  return `
    <div class="npb-pending-wrap">
      <h3 style="color:var(--red)">상품을 알 수 없는 이름 ${list.length}건</h3>
      ${helpNote(`판매처가 상품코드를 주면 그 코드로 기억합니다 — 이름이 바뀌어도 계속 인식됩니다.
        <b>어느 상품</b>인지 고르고, 그 한 건이
        <b>재고에서 몇 개 빠지는지</b> 배수를 정하세요. 3팩이면 <b>주문수량 × 3</b> 입니다.
        치킨2+고구마1 처럼 섞인 묶음은 <b>[+ 상품 추가]</b> 로 여러 개를 걸면 됩니다.
        한 번 지정하면 <b>다음부터 자동으로 인식</b>됩니다.`)}
      <div class="table-wrap" style="max-height:340px"><table class="npb-skumatch-table">
        <thead><tr><th>판매처 상품명</th><th>수량</th><th>매칭 상품 · 재고 배수</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      <div class="toolbar">
        <button class="primary" data-npb-alias-save>매칭 저장</button>
        <button class="ghost" data-npb-alias-clear>목록 비우기</button>
      </div>
    </div>`;
}

// 파싱 결과 검수. 파일이 기준금액을 빼먹고 오는 일이 잦아, 워크시트로 바로
// 밀어 넣지 않고 여기서 행별로 고친 뒤 [확정/반영] 을 눌러 반영한다.
// 열 구성은 브랜드가 쓰던 '채널별 판매데이터 정리' 시트와 맞췄다.
// 할인을 어떻게 읽을지. 사람이 적는 프로모션 할인은 "개당 얼마"나 "몇 %"가
// 자연스럽고(그래서 수량보다 먼저 적용된다), 판매처 파일이 주는 할인액은
// 이미 그 줄 전체의 합계다. 둘을 같은 칸에서 구분 없이 쓰면 한쪽이 반드시
// 틀리므로 행마다 어느 쪽인지 들고 있는다.
function npbDiscountMode(row) {
  if (row.discountMode) return row.discountMode;
  // 파일이 할인액을 준 행은 예전처럼 줄 합계로 본다 — 바꾸면 이미 맞아 있던
  // 채널의 금액이 조용히 달라진다.
  return row.money && row.money.discount != null ? "line" : "unit";
}

function npbReviewMath(row) {
  const qty = Number(row.qty || 0);
  const listTotal = Number(row.listPrice || 0) * qty;
  // 기준가 = 그 판매처에서 실제로 팔린 단가. 정가는 상품표 값이라 고정이고,
  // 할인·계약가가 반영된 실제 단가는 여기에 적는다.
  const unit = row.unitPrice != null && row.unitPrice !== ""
    ? Number(row.unitPrice)
    : Number(row.listPrice || 0);
  const entered = Number(row.discountAmount || 0);
  const mode = npbDiscountMode(row);
  // 개당 할인은 수량을 곱하기 전에 단가에서 뺀다.
  const perUnit = mode === "rate" ? Math.round(unit * (entered / 100))
    : mode === "unit" ? entered
    : 0;
  const lineDiscount = mode === "line" ? entered : 0;
  const discount = mode === "line" ? lineDiscount : perUnit * qty;
  const shipping = Number(row.shippingAmount || 0);
  const sale = row.saleAmount != null && row.saleAmount !== ""
    ? Number(row.saleAmount)
    : Math.max(0, unit - perUnit) * qty - lineDiscount + shipping;
  // 정산금이 확정된 채널(쿠팡)은 공제를 역산한다 — 서버 계산과 같은 규칙이다.
  if (row.settleAmount != null && row.settleAmount !== "") {
    const settle = Number(row.settleAmount);
    return { listTotal, discount, shipping, sale, fee: sale - settle, settle };
  }
  const fee = row.feeAmount != null && row.feeAmount !== ""
    ? Number(row.feeAmount)
    : Math.round(sale * Number(row.feeRate || 0));
  return { listTotal, discount, shipping, sale, fee, settle: sale - fee };
}

function renderNpbExpenses() {
  const n = state.npb;
  if (!n.currentKey) return npbNeedSelect();
  const log = n.current?.logistics || {};
  const shipFiles = n.current?.shipFiles || {};
  const breakdown = log.breakdown || [];

  // 청구서에는 운임과 물류사용비를 따로 적어야 한다. 계산은 이미 둘을 나눠
  // 갖고 있으므로 화면에서만 풀어 준다 — 합쳐 놓으면 무엇으로 얼마가 나갔는지
  // 확인할 방법이 없다.
  const shipParts = (row) => (row.manual ? [] : [
    ["택배운임비", Number(row.freight || 0)],
    [row.handlingLabel || "물류사용비", Number(row.handling || 0)]
  ].filter(([, price]) => price > 0));

  const shipRows = breakdown.map((row) => {
    const file = shipFiles[row.key];
    const detail = shipParts(row).map(([label, price]) => `
      <tr class="npb-ship-detail">
        <td class="muted">└ ${label}</td>
        <td></td>
        <td class="num muted">${money.format(row.count)}${h(row.unitLabel || "건")}</td>
        <td class="num muted">${money.format(price)}</td>
        <td class="num muted">${money.format(price * Number(row.count || 0))}</td>
        <td></td>
      </tr>`).join("");
    return `
      <tr>
        <td>${h(row.label)}</td>
        <td>
          ${row.source
            ? `<div class="muted">${h(breakdown.find((b) => b.key === row.source)?.label || row.source)} 파일에서 자동 계산 · 숫자는 고칠 수 있습니다.</div>`
            : `<input type="file" accept=".csv,.xls,.xlsx" data-npb-shipfile="${h(row.key)}">
          ${file
            ? (file.parcelCount
              ? `<div class="muted">${h(file.fileName)} · 일반 ${money.format(file.parcelCount.parcels)}건 · 박스단위 ${money.format(file.parcelCount.boxParcels)}송장(${money.format(file.parcelCount.boxes)}박스) · 합포 ${money.format(file.parcelCount.extraUnits)}개 (${money.format(file.rowCount)}행)</div>`
              : `<div class="muted">${h(file.fileName)} · ${h(file.basisLabel)} 기준 ${money.format(file.autoCount)}건 (${money.format(file.rowCount)}행)</div>`)
            : `<div class="muted">출고내역 파일을 올리면 건수를 셉니다.</div>`}`}
        </td>
        <td><input class="num" type="number" min="0" data-npb-ship="${h(row.key)}" value="${h(row.count)}"></td>
        <td class="num">${row.manual ? "-" : money.format(Number(row.freight || 0) + Number(row.handling || 0))}</td>
        <td class="num">${row.manual
          ? `<input class="num" type="number" min="0" data-npb-ship-amt="${h(row.key)}" value="${h(row.amount)}">`
          : money.format(row.amount)}</td>
        <td class="muted">${row.excludeFromTotal ? "합계 제외 · 개별청구" : ""}</td>
      </tr>${detail}`;
  }).join("");

  // 항목별 합계. 합계에서 뺀 유형(용달·퀵)은 여기서도 뺀다.
  const counted = breakdown.filter((row) => !row.excludeFromTotal);
  const partTotal = (field) => counted.reduce(
    (sum, row) => sum + (row.manual ? 0 : Number(row[field] || 0) * Number(row.count || 0)), 0
  );
  const freightTotal = partTotal("freight");
  const handlingTotal = partTotal("handling");

  // 핸들러는 n.adCost 에 쓴다. 저장된 값(n.current)은 처음 화면을 열 때만 쓴다.
  const ad = n.adCost || n.current?.adCost || {};
  const adRows = (ad.items || []).map((item) => `
    <tr><td>${h(item.medium)}</td><td class="muted">${h(item.period || "")}</td>
    <td class="num">${money.format(item.amount)}</td></tr>`).join("")
    || `<tr><td colspan="3" class="empty">불러온 광고비가 없습니다.</td></tr>`;

  const invoices = (n.invoices || []).filter((inv) => inv.settlementKey === n.currentKey);
  const invoiceRows = invoices.map((inv) => `
    <tr>
      <td>${h(inv.typeLabel)}</td>
      <td class="num">${money.format(inv.total)}</td>
      <td>${h(inv.dueDate || "")}</td>
      <td>${inv.paidAt
        ? `<span class="badge ok">입금 ${h(String(inv.paidAt).slice(0, 10))}</span>`
        : `<button data-npb-invoice-paid="${h(inv.id)}">입금 확인</button>`}</td>
      <td><button data-npb-invoice-dl="${h(inv.id)}">청구서 받기</button></td>
    </tr>`).join("")
    || `<tr><td colspan="5" class="empty">발행한 청구서가 없습니다.</td></tr>`;

  return `
    ${renderNpbCostSection()}
    ${renderNpbInventorySection()}
    <section class="panel">
      <div class="panel-head">
        <h2>운임/물류 실비</h2>
        <span class="muted">출고내역을 올리면 송장 기준으로 건수를 셉니다. 숫자는 고칠 수 있습니다.</span>
      </div>
      <div class="table-wrap"><table class="npb-ship-table">
        <thead><tr><th>유형</th><th>출고내역 파일</th><th>건수</th><th>건당</th><th>금액</th><th></th></tr></thead>
        <tbody>${shipRows}</tbody>
        <tfoot>
          <tr class="npb-ship-detail">
            <td class="muted">택배운임비 계</td><td></td><td></td><td></td>
            <td class="num muted">${money.format(freightTotal)}</td><td></td>
          </tr>
          <tr class="npb-ship-detail">
            <td class="muted">물류사용비 계</td><td></td><td></td><td></td>
            <td class="num muted">${money.format(handlingTotal)}</td><td></td>
          </tr>
          <tr>
            <th>합계</th><th></th><th class="num">${money.format(log.countTotal || 0)}</th><th></th>
            <th class="num">${money.format(log.grandTotal || 0)}</th>
            <th class="muted">${log.separateTotal ? `별도 ${money.format(log.separateTotal)}` : ""}</th>
          </tr>
        </tfoot>
      </table></div>
      <div class="toolbar">
        <button data-npb-ship-save>건수 저장</button>
        <button class="primary" data-npb-invoice="logistics">운임 청구서 발행</button>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head"><h2>광고홍보 실비</h2><span class="muted">구글시트 누적분</span></div>
      <div class="table-wrap"><table class="npb-ads-table">
        <thead><tr><th>매체</th><th>기간</th><th>금액</th></tr></thead>
        <tbody>${adRows}</tbody>
        <tfoot><tr><th>합계</th><th></th><th class="num">${money.format(ad.total || 0)}</th></tr></tfoot>
      </table></div>
      <div class="toolbar">
        <button data-npb-adcost ${n.adCostLoading ? "disabled" : ""}>${n.adCostLoading ? "불러오는 중…" : "광고비 불러오기"}</button>
        <button class="primary" data-npb-invoice="ad">광고비 청구서 발행</button>
      </div>
    </section>

    <section class="panel">
      <div class="panel-head">
        <h2>청구서</h2>
        <span class="muted">정산서와 별도로 발행합니다 — 정산 계산에는 들어가지 않습니다.</span>
      </div>
      <div class="table-wrap"><table class="npb-invoice-table">
        <thead><tr><th>구분</th><th>금액</th><th>입금 기한</th><th>입금</th><th></th></tr></thead>
        <tbody>${invoiceRows}</tbody>
      </table></div>
    </section>`;
}

function renderNpbReview() {
  const n = state.npb;
  const review = n.review;
  if (!review || !review.rows) return "";
  const name = npbChannelName(review.channel);
  const total = review.rows.reduce((acc, row) => {
    if (row.dropped) return acc;
    const m = npbReviewMath(row);
    acc.qty += Number(row.qty || 0);
    acc.list += m.listTotal; acc.sale += m.sale; acc.fee += m.fee; acc.settle += m.settle;
    return acc;
  }, { qty: 0, list: 0, sale: 0, fee: 0, settle: 0 });

  const rows = review.rows.map((row, i) => {
    const m = npbReviewMath(row);
    const dmode = npbDiscountMode(row);
    const feePct = (Number(row.feeRate || 0) * 100).toFixed(2).replace(/\.?0+$/, "");
    const fromFile = row.money && Object.keys(row.money).length ? "파일" : "";
    return `
      <tr class="${row.dropped ? "npb-row-dropped" : ""}">
        <td class="num">${i + 1}</td>
        <td class="wrap">${h(row.label || row.productKey || "")}
          ${fromFile ? `<span class="badge">${fromFile}</span>` : ""}</td>
        <td class="num">${money.format(row.listPrice ?? 0)}</td>
        <td><input class="num" type="number" data-npb-rv="${i}" data-npb-rf="unitPrice"
          value="${h(row.unitPrice ?? row.listPrice ?? 0)}">
          ${row.priceChanged
            ? `<div class="muted" style="color:var(--red)">파일은 ${money.format(row.priceChanged.to)}
               (지난번 ${money.format(row.priceChanged.from)})</div>`
            : ""}</td>
        <td><input class="num" type="number" data-npb-rv="${i}" data-npb-rf="qty"
          value="${h(row.qty ?? 0)}"></td>
        <td><div class="npb-discount-cell">
          <input class="num" type="number" data-npb-rv="${i}" data-npb-rf="discountAmount"
            value="${h(row.discountAmount ?? 0)}">
          <select data-npb-rv="${i}" data-npb-rf="discountMode" title="할인을 읽는 기준">
            <option value="unit" ${dmode === "unit" ? "selected" : ""}>원</option>
            <option value="rate" ${dmode === "rate" ? "selected" : ""}>%</option>
            <option value="line" ${dmode === "line" ? "selected" : ""}>원(줄)</option>
          </select>
        </div></td>
        <td><input class="num" type="number" data-npb-rv="${i}" data-npb-rf="shippingAmount"
          value="${h(row.shippingAmount ?? 0)}"></td>
        <td class="num">${money.format(m.sale)}</td>
        <td><input class="num npb-pct" type="number" step="0.01" data-npb-rv="${i}"
          data-npb-rf="feeRate" value="${h(feePct)}"></td>
        <td class="num">${money.format(m.fee)}</td>
        <td class="num">${money.format(m.settle)}</td>
        <td><button class="ghost" data-npb-rv-drop="${i}">${row.dropped ? "되살리기" : "제외"}</button></td>
      </tr>`;
  }).join("");

  const warns = (review.warnings || []).map((w) => `<p class="muted">⚠ ${h(w)}</p>`).join("");
  return `
    <section class="panel">
      <div class="panel-head">
        <h2>파싱 검수 — ${h(name)}</h2>
        <span class="muted">${review.rows.length}행 · 확정 전</span>
      </div>
      ${warns ? `<div class="panel-body">${warns}</div>` : ""}
      <div class="panel-body">
        ${helpNote(`<b>기준가</b>는 그 판매처에서 실제로 팔린 단가입니다 — 확정하면 기억해 두었다가
          다음 달 같은 코드에 자동으로 채웁니다. 파일이 다른 단가를 말하면 빨간 글씨로 알려드립니다.
          기준가·수량·할인·수수료율을 여기서 고칠 수 있습니다. 고치면 그 행은 <b>파일 금액 대신
          계산식</b>을 씁니다. <b>[확정/반영]</b> 을 눌러야 워크시트와 정산서에 들어갑니다.<br>
          <b>할인</b>은 기본이 <b>개당</b>입니다 — <code>(기준가 − 할인) × 수량 + 배송비</code> 로 계산합니다.
          <b>%</b> 를 고르면 기준가의 몇 %인지로 읽고, <b>원(줄)</b> 은 그 줄 전체에서 한 번만 뺍니다
          (판매처 파일이 할인액을 합계로 주는 경우).`)}
      </div>
      <div class="table-wrap" style="max-height:420px"><table class="npb-lines-table">
        <thead><tr>
          <th>순번</th><th>품목</th><th>정가</th><th>기준가</th><th>수량</th><th>할인</th>
          <th>배송비</th><th>최종결제</th><th>수수료(%)</th><th>수수료(원)</th><th>정산</th><th></th>
        </tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr>
          <th></th><th>합계</th><th></th><th></th><th class="num">${money.format(total.qty)}</th>
          <th></th><th></th><th class="num">${money.format(total.sale)}</th><th></th>
          <th class="num">${money.format(total.fee)}</th><th class="num">${money.format(total.settle)}</th><th></th>
        </tr></tfoot>
      </table></div>
      <div class="panel-body toolbar">
        <button class="primary" data-npb-confirm>확정 / 반영</button>
        <button class="ghost" data-npb-review-cancel>닫기</button>
        <span class="muted">확정하면 워크시트·정산서·월 목록에 함께 반영됩니다.</span>
      </div>
    </section>`;
}

function renderNpbWorksheet() {
  const n = state.npb;
  if (!n.currentKey) return npbNeedSelect();
  if (!n.worksheet) n.worksheet = npbBuildWorksheet(n.config, n.current?.lines || []);
  if (!n.inventory) n.inventory = npbBuildInventory(n.config, n.current?.inventory || []);
  return `
    ${renderNpbRollupCard()}
    <section class="panel">
      <div class="panel-head">
        <h2>채널별 워크시트</h2>
        <span class="muted">채널별 판매데이터 정리 · 정가·기준가·수량·수수료율을 직접 고칠 수 있습니다</span>
        <button data-npb-reload>새로고침</button>
      </div>
      <div class="panel-body npb-ws">
        ${n.worksheet.map((b, bi) => (b.summary ? renderNpbWsSummaryBlock(b, bi) : renderNpbWsBlock(b, bi))).join("")}
      </div>
    </section>
    ${renderNpbSettleBy()}
    ${n.config?.profitSplitEnabled === false ? "" : renderNpbProfitSection()}
    <section class="panel">
      <div class="panel-body toolbar">
        <button class="primary" data-npb-ws-save>저장 (계산)</button>
        <button data-npb-download="${h(n.currentKey)}">엑셀 다운로드</button>
        <span class="muted">라인·출고건수 저장 후 집계(compute)를 실행합니다.</span>
      </div>
    </section>
  `;
}

function renderNpbRollupCard() {
  const r = npbWorksheetRollup();
  const cell = (label, value) =>
    `<div class="fixed-card"><span>${label}</span><strong>${value}</strong></div>`;
  return `
    <section class="panel">
      <div class="panel-head"><h2>종합정산 (실시간)</h2></div>
      <div class="panel-body">
        <div class="npb-rollup-grid ${state.npb.config?.profitSplitEnabled === false ? "five" : ""}">
          ${state.npb.config?.profitSplitEnabled === false
            ? // 브랜드에 나가는 종합정산서의 '[판매내역 종합]' 과 같은 항목·같은 이름.
              cell("소비자정가계", npbWon(r.listTotal))
              + cell("할인계", npbWon(r.discountTotal))
              + cell("매출계", npbWon(r.realSaleTotal))
              + cell("수수료 (공제계)", npbWon(r.feeTotal))
              + cell("정산합계", npbWon(r.realSaleTotal - r.feeTotal))
            : cell("실판매수량", money.format(Math.round(r.qtyTotal)))
              + cell("판매정가계", npbWon(r.listTotal))
              + cell("할인계", npbWon(r.discountTotal))
              + cell("실판매계", npbWon(r.realSaleTotal))
              + cell("공제수수료", npbWon(r.feeTotal))
              + cell("매출계", npbWon(r.revenueTotal))
              + cell("실비", npbWon(r.logisticsCost))
              + cell("이익", npbWon(r.profit))}
        </div>
      </div>
    </section>`;
}

// 합계만 적는 채널. 품목 표 대신 여섯 칸이다 — 종합정산서의 '채널별 정산 합계'
// 한 줄과 같은 구성.
function renderNpbWsSummaryBlock(block, bi) {
  const t = block.totals || {};
  const settle = Number(t.saleTotal || 0) - Number(t.feeTotal || 0);
  const cell = (field, label) => `
    <label class="npb-sum-cell">
      <span class="muted">${label}</span>
      <input class="num" type="number" data-npb-sum="${bi}" data-npb-sf="${field}"
        value="${h(t[field] ?? 0)}">
    </label>`;
  return `
    <section class="panel npb-ws-block" data-npb-summary-block="${bi}">
      <div class="panel-head">
        <h2>${h(block.name)} <span class="badge">합계 입력</span></h2>
        <span class="muted">${h(block.note || "정산서 별도 전달")}</span>
      </div>
      <div class="panel-body npb-sum-grid">
        ${cell("listTotal", "기준가합계(정가)")}
        ${cell("shippingTotal", "배송비합계")}
        ${cell("discountTotal", "할인합계")}
        ${cell("saleTotal", "판매가합계(최종결제)")}
        ${cell("feeTotal", "수수료합계(공제)")}
        <div class="npb-sum-cell">
          <span class="muted">정산합계</span>
          <strong>${money.format(settle)}</strong>
        </div>
      </div>
      <div class="panel-body">
        <p class="muted">
          품목 내역을 맞추지 않고 총계만 적습니다. 파일은 업로드해 두면 근거로 남습니다.
          판매가합계를 비워 두면 <b>기준가합계 − 할인 + 배송비</b>로 채웁니다.
        </p>
      </div>
    </section>`;
}

function renderNpbWsBlock(block, bi) {
  // 내역이 없는 달은 접어 둔다. 채널이 열둘이라 빈 표가 화면을 가린다.
  const empty = block.rows.every((row) => !Number(row.qty));
  const collapsed = state.npb.wsCollapsed?.[block.code] ?? empty;
  let subQty = 0;
  let subRevenue = 0;
  let subFee = 0;
  let subSettle = 0;
  let subList = 0;
  let subDiscount = 0;
  const rows = block.rows
    .map((row, ri) => {
      const m = npbRowMath(row);
      // 할인은 따로 저장하지 않고 정가와 기준가의 차이로 드러난다. 개당
       // 금액들(정가·기준가) 사이에 두므로 여기도 개당으로 적는다.
      const unitDiscount = Number(row.listPrice || 0) - Number(row.salePrice || 0);
      const discount = m.list - m.revenue;
      subQty += Number(row.qty || 0);
      subRevenue += m.revenue;
      subFee += m.fee;
      subSettle += m.settle;
      subList += m.list;
      subDiscount += discount;
      const feePct = (Number(row.feeRate || 0) * 100).toFixed(2).replace(/\.?0+$/, "");
      return `
        <tr>
          <td>${h(row.label)}${m.fromFile
            ? ` <span class="badge" title="업로드한 파일의 금액을 씁니다">파일</span>`
            : ""}${row.extra ? ` <span class="badge">추가</span>` : ""}</td>
          <td><input class="num" type="number" data-npb-ws="${bi}" data-npb-wr="${ri}"
            data-npb-wf="listPrice" value="${h(row.listPrice)}"></td>
          <td><input class="num" type="number" data-npb-ws="${bi}" data-npb-wr="${ri}"
            data-npb-wf="salePrice" value="${h(row.salePrice)}"></td>
          <td class="num${unitDiscount > 0 ? " npb-ws-discount" : ""}" data-npb-cell="discount">${unitDiscount > 0 ? `−${money.format(unitDiscount)}` : "-"}</td>
          <td><input class="num" type="number" data-npb-ws="${bi}" data-npb-wr="${ri}"
            data-npb-wf="qty" value="${h(row.qty)}"></td>
          <td class="num" data-npb-cell="list">${money.format(m.list)}</td>
          <td class="num" data-npb-cell="revenue">${money.format(m.revenue)}</td>
          <td><input class="num npb-pct" type="number" step="0.01" data-npb-ws="${bi}"
            data-npb-wr="${ri}" data-npb-wf="feeRate" value="${h(feePct)}"></td>
          <td class="num" data-npb-cell="fee">${money.format(m.fee)}</td>
          <td class="num" data-npb-cell="settle">${money.format(m.settle)}</td>
        </tr>`;
    })
    .join("");
  const tag = block.category
    ? `<span class="badge">${h(block.category)}</span>`
    : "";
  // 행사 할인은 판매처와 반반 부담한다. 20% 행사면 우프가 10% — 그 달에만
  // 해당하는 값이라 채널 설정이 아니라 이 정산에 붙는다.
  const promoRate = Number(state.npb.current?.promoRates?.[block.code] || 0);
  const promoPct = promoRate ? String(Math.round(promoRate * 1000) / 10) : "";
  const promo = block.promoSplit
    ? `<span class="npb-promo">
        행사 할인
        <input class="num npb-pct" type="number" step="1" min="0" max="99"
          placeholder="0" data-npb-promo="${h(block.code)}" value="${h(promoPct)}">%
        <button class="ghost" data-npb-promo-save="${h(block.code)}">적용</button>
        ${promoRate
          ? `<span class="muted">우프 부담 ${Math.round(promoRate * 500) / 10}%</span>`
          : `<span class="muted">행사 없음</span>`}
      </span>`
    : "";
  return `
    <div class="npb-ws-block">
      <div class="npb-ws-title">
        <button class="ghost" data-npb-ws-toggle="${h(block.code)}">${collapsed ? "▸" : "▾"}</button>
        <strong>${h(block.name)}</strong> ${tag}
        ${collapsed ? `<span class="muted">${empty ? "내역 없음" : `수량 ${money.format(subQty)}`}</span>` : ""}
        ${promo}
      </div>
      <div class="table-wrap" ${collapsed ? 'style="display:none"' : ""}>
        <table class="npb-ws-table">
          <thead>
            <tr>
              <th>제품</th><th>정가</th><th>기준가</th>
              <th title="정가 − 기준가 (개당). 합계 줄은 금액 합계입니다.">할인</th><th>판매수량</th>
              <th>정가계</th><th>매출계</th><th>수수료율(%)</th><th>수수료계</th><th>정산계</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr>
              <th>합계</th>
              <td class="num">-</td><td class="num">-</td>
              <td class="num${subDiscount > 0 ? " npb-ws-discount" : ""}" data-npb-foot="discount">${subDiscount > 0 ? `−${money.format(subDiscount)}` : "-"}</td>
              <td class="num" data-npb-foot="qty">${money.format(subQty)}</td>
              <td class="num" data-npb-foot="list">${money.format(subList)}</td>
              <td class="num" data-npb-foot="revenue">${money.format(subRevenue)}</td>
              <td class="num">-</td>
              <td class="num" data-npb-foot="fee">${money.format(subFee)}</td>
              <td class="num" data-npb-foot="settle">${money.format(subSettle)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>`;
}

// 정산 주체별 소계 — 누구에게 계산서가 나가는지가 갈린다.
function renderNpbSettleBy() {
  const by = npbWorksheetRollup().bySettleBy || {};
  const keys = Object.keys(by).filter((k) => k);
  if (!keys.length) return "";
  const rows = keys.map((k) => `
    <tr><td><strong>${h(k)}</strong></td>
      <td class="num">${npbWon(by[k].realSaleTotal)}</td>
      <td class="num">${npbWon(by[k].feeTotal)}</td>
      <td class="num"><strong>${npbWon(by[k].revenueTotal)}</strong></td></tr>`).join("");
  return `
    <section class="panel">
      <div class="panel-head"><h2>정산 주체별 소계</h2>
        <span class="muted">계산서를 누가 발행하는지에 따라 나뉩니다</span></div>
      <div class="panel-body">
        <div class="table-wrap"><table class="npb-party-table">
          <thead><tr><th>주체</th><th>매출</th><th>공제</th><th>정산계</th></tr></thead>
          <tbody>${rows}</tbody></table></div>
        <p class="muted">
          우프 건은 우리가 계산서 발행·수금 후 우프 판매건과 합쳐 청구하고,
          픽키파크 건은 해당 업체가 직접 발행합니다. 월 총판매 집계를 위해 함께 표시합니다.
        </p>
      </div>
    </section>`;
}

function renderNpbCostSection() {
  const n = state.npb;
  const billSeparately = n.config?.costConfig?.billSeparately === true;
  const rows = npbShipTypes().map(npbShipRow);
  const total = rows.filter((r) => !r.excludeFromTotal).reduce((s, r) => s + r.amount, 0);
  const separate = rows.filter((r) => r.excludeFromTotal).reduce((s, r) => s + r.amount, 0);

  const inputs = rows.map((r) => `
    <div>
      <label>${h(r.label)} ${r.manual ? "(실비 직접 입력)" : `(단가 ${money.format(r.unit)}원)`}</label>
      <div class="npb-ship-row">
        <input class="num" type="number" min="0" data-npb-ship="${h(r.key)}" value="${h(r.count)}" placeholder="건수">
        ${r.manual
          ? `<input class="num" type="number" min="0" data-npb-ship-amt="${h(r.key)}" value="${h(r.amount)}" placeholder="금액">`
          : `<span class="muted">= ${money.format(r.amount)}원</span>`}
      </div>
      ${r.excludeFromTotal ? `<span class="muted">합계에 넣지 않고 개별 기재합니다.</span>` : ""}
    </div>`).join("");

  return `
    <section class="panel">
      <div class="panel-head"><h2>실비 (운임/물류)</h2>
        <span class="muted">단가 VAT포함${billSeparately ? " · 정산에서 공제하지 않고 별도 청구" : ""}</span></div>
      <div class="panel-body">
        <div class="field two">${inputs}</div>
        <p class="muted">
          물류 실비 합계 <strong>${npbWon(total)}</strong>
          ${separate ? ` · 별도 기재 ${npbWon(separate)}` : ""}
          ${billSeparately
            ? " — 이 금액은 정산 이익에서 차감하지 않습니다. 별도 청구하세요."
            : " — 정산 이익에서 차감됩니다."}
        </p>
      </div>
    </section>`;
}

// 광고비는 구글시트에 누적된다. 정산에는 넣지 않고 별도 청구 근거로 보여준다.
function renderNpbProfitSection() {
  const n = state.npb;
  const profit = npbWorksheetRollup().profit;
  const parties = n.profitParties;
  const activeRatio = parties
    .filter((p) => !p.excluded)
    .reduce((s, p) => s + Number(p.ratio || 0), 0);
  const rows = parties
    .map((p, i) => {
      const ratio = p.excluded || activeRatio <= 0
        ? 0
        : Number(p.ratio || 0) / activeRatio;
      const amount = ratio * profit;
      return `
        <tr>
          <td><input type="text" data-npb-party="${i}" data-npb-pfield="party" value="${h(p.party || "")}"></td>
          <td><input class="num" type="number" step="0.01" data-npb-party="${i}" data-npb-pfield="ratio" value="${h(p.ratio ?? "")}"></td>
          <td><label class="checkbox-line"><input type="checkbox" data-npb-party="${i}" data-npb-pfield="excluded" ${p.excluded ? "checked" : ""}> 제외</label></td>
          <td class="num">${npbWon(amount)}</td>
          <td><input type="text" data-npb-party="${i}" data-npb-pfield="note" value="${h(p.note || "")}"></td>
        </tr>`;
    })
    .join("");
  const ratioOk = Math.abs(activeRatio - 1) < 1e-9;
  return `
    <section class="panel">
      <div class="panel-head"><h2>이익분배</h2><span class="muted">이익 ${npbWon(profit)}</span></div>
      <div class="table-wrap">
        <table class="npb-split-table">
          <thead><tr><th>파티</th><th>비율</th><th>제외</th><th>배분액</th><th>비고</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="panel-body">
        <p class="${ratioOk ? "muted" : "error-text"}">활성 비율 합계: ${activeRatio.toFixed(4)} ${ratioOk ? "✓" : "(1이어야 함)"}</p>
        <div class="toolbar"><button data-npb-profit-seed>지난달 불러오기</button></div>
      </div>
    </section>`;
}

function renderNpbInventorySection() {
  const n = state.npb;
  const inv = n.inventory || [];
  // 기말은 기초 + 입고 − 출고 라 손으로 적을 값이 아니다.
  const cols = [["opening", "기초"], ["inbound", "입고"], ["outbound", "출고"]];
  const rows = inv
    .map((r, i) => `
      <tr>
        <td>${h(r.name)}</td>
        ${cols.map(([f]) => `<td><input class="num" type="number" data-npb-inv="${i}" data-npb-ifield="${f}" value="${h(r[f] ?? 0)}"></td>`).join("")}
        <td class="num"><strong>${money.format(Number(r.closing || 0))}</strong></td>
      </tr>`)
    .join("") || `<tr><td colspan="5" class="empty">제품이 없습니다.</td></tr>`;
  // 조회기준일은 파일에서 읽지 않는다 — 파일을 뽑은 시각과 어느 시점 재고로
  // 볼지는 다르므로 사람이 정한다.
  const stock = n.current?.stockFile || {};
  const inout = n.current?.inoutFile || {};
  return `
    <section class="panel">
      <div class="panel-head">
        <h2>재고현황</h2>
        <span class="muted">기초(전월 말) + 입고 − 출고 = 기말(${h(npbPeriodLastDay())})</span>
      </div>
      <div class="npb-stock-bar">
        <label>기초재고 기준일
          <input type="date" data-npb-stock-asof value="${h(stock.asOf || npbPrevMonthLastDay())}">
        </label>
        <label>기초재고 파일
          <input type="file" accept=".csv" data-npb-stockfile>
        </label>
        <button data-npb-stock-save>저장</button>
        <span class="muted">${stock.fileName
          ? `${h(stock.fileName)} · ${money.format(stock.matched || 0)}/${money.format(stock.rowCount || 0)}건 반영`
          : "셀메이트 재고조회 CSV 를 고른 뒤 저장을 누르면 기초재고로 들어갑니다."}</span>
        <label>입출고 내역 파일
          <input type="file" accept=".csv,.xls,.xlsx" data-npb-inoutfile>
        </label>
        <button data-npb-inout-save>저장</button>
        <span class="muted">${inout.fileName
          ? `${h(inout.fileName)} · ${money.format(inout.rowCount || 0)}행 → 입고·출고 반영`
          : "셀메이트 입출고내역·출고내역(CSV 또는 엑셀 .xls)을 올리면 당월 입고·출고가 채워집니다."}</span>
      </div>
      <div class="table-wrap">
        <table class="npb-inventory-table">
          <thead><tr><th>품목</th>${cols.map(([, l]) => `<th>${l}</th>`).join("")}<th>기말</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="panel-body">
        <div class="toolbar">
          <button data-npb-inv-save>재고 저장</button>
          <button class="primary" data-npb-inv-confirm>재고 확정</button>
          ${n.current?.inventoryConfirmedAt
            ? `<span class="muted">확정됨 · ${h(String(n.current.inventoryConfirmedAt).slice(0, 10))}</span>`
            : ""}
        </div>
      </div>
    </section>`;
}

function renderNpbChannels() {
  const n = state.npb;
  const channels = n.config?.channels || [];
  const rows = channels
    .map((c, i) => `
      <tr>
        <td><input type="text" data-npb-ch="${i}" data-npb-cfield="code" value="${h(c.code || "")}"></td>
        <td><input type="text" data-npb-ch="${i}" data-npb-cfield="name" value="${h(c.name || "")}"></td>
        <td><input type="text" data-npb-ch="${i}" data-npb-cfield="calcType" value="${h(c.calcType || "")}"></td>
        <td><input class="num" type="number" data-npb-ch="${i}" data-npb-cfield="salePrice" value="${h(c.salePrice ?? "")}"></td>
        <td><input class="num" type="number" data-npb-ch="${i}" data-npb-cfield="feeRate" value="${h(c.feeRate ?? "")}"></td>
        <td><input class="num" type="number" data-npb-ch="${i}" data-npb-cfield="supplyPrice" value="${h(c.supplyPrice ?? "")}"></td>
        <td><input type="text" data-npb-ch="${i}" data-npb-cfield="archetype" value="${h(c.archetype || "")}"></td>
        <td><input type="text" data-npb-ch="${i}" data-npb-cfield="filenameKeywords"
              value="${h((c.filenameKeywords || []).join(", "))}" placeholder="예: bmw, 조이몰"></td>
        <td><select data-npb-ch="${i}" data-npb-cfield="settleBy">
          ${["우프", "픽키파크"].map((v) =>
            `<option value="${v}" ${(c.settleBy || "우프") === v ? "selected" : ""}>${v}</option>`).join("")}
        </select></td>
        <td><select data-npb-ch="${i}" data-npb-cfield="entryMode">
          ${NPB_ENTRY_MODES.map(([value, label]) =>
            `<option value="${value}" ${(c.entryMode || "review") === value ? "selected" : ""}>${label}</option>`).join("")}
        </select></td>
        <td><select data-npb-ch="${i}" data-npb-cfield="rounding"
              title="판매처 정산서가 소수로 오는 채널만 설정하세요. 이미 확정한 달은 확정 당시 기준으로 그대로 계산됩니다.">
          ${NPB_ROUNDING_MODES.map(([value, label]) =>
            `<option value="${value}" ${(c.rounding || "") === value ? "selected" : ""}>${label}</option>`).join("")}
        </select></td>
        <td><button class="danger icon-btn" data-npb-ch-del="${i}" aria-label="삭제" title="삭제">×</button></td>
      </tr>`)
    .join("") || `<tr><td colspan="12" class="empty">등록된 채널이 없습니다.</td></tr>`;
  return `
    <section class="panel">
      <div class="panel-head"><h2>채널 설정</h2><span class="muted">${channels.length}개</span></div>
      <div class="table-wrap">
        <table class="npb-channels-table">
          <thead><tr><th>코드</th><th>이름</th><th>계산방식</th><th>판매가</th><th>수수료율</th><th>공급가</th><th>아키타입</th><th>파일명 키워드</th><th>정산주체</th><th>업로드 반영</th><th>끝자리</th><th></th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="panel-body toolbar">
        <button data-npb-ch-add>채널 추가</button>
        <button class="primary" data-npb-config-save>설정 저장</button>
        <span class="muted">파일명 키워드를 등록하면 업로드할 때 채널이 자동으로 인식됩니다. 쉼표로 여러 개.</span>
      </div>
    </section>
    ${renderNpbProductEditor()}
    ${renderNpbCostEditor()}
  `;
}

// 상품 원장. 셀메이트 상품정보의 값들을 그대로 들고 있어야 공헌이익을 낼 때
// 원가 쪽 입력이 생긴다. 판매가는 정산의 정가 기준이기도 하다.
function renderNpbProductEditor() {
  const n = state.npb;
  const products = (n.config?.products || []).filter((p) => p.active !== false);
  const rows = products.map((p, i) => `
    <tr>
      <td class="wrap">${h(p.name)}</td>
      <td>${h(p.barcode || "")}</td>
      <td><input class="num" type="number" data-npb-pr="${i}" data-npb-pf="listPrice" value="${h(p.listPrice ?? 0)}"></td>
      <td><input class="num" type="number" data-npb-pr="${i}" data-npb-pf="costPrice" value="${h(p.costPrice ?? 0)}"></td>
      <td><input class="num" type="number" data-npb-pr="${i}" data-npb-pf="supplyPrice" value="${h(p.supplyPrice ?? 0)}"></td>
      <td class="num">${money.format(Number(p.listPrice || 0) - Number(p.costPrice || 0))}</td>
      <td><input class="num" type="number" data-npb-pr="${i}" data-npb-pf="safetyStock" value="${h(p.safetyStock ?? 0)}"></td>
      <td class="num">${h(p.piecesPerUnit ?? "")}</td>
    </tr>`).join("") || `<tr><td colspan="8" class="empty">등록된 상품이 없습니다.</td></tr>`;
  return `
    <section class="panel">
      <div class="panel-head">
        <h2>상품 원장</h2>
        <span class="muted">기본 SKU 단위 — 재고매칭의 배수가 이 단위로 환산됩니다</span>
      </div>
      <div class="table-wrap"><table class="npb-products-table">
        <thead><tr>
          <th>상품명</th><th>바코드</th><th>판매가(정가)</th><th>원가</th><th>공급가</th>
          <th>마진</th><th>안전재고</th><th>낱개/단위</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <div class="panel-body">
        <p class="muted">
          원가는 공헌이익을 낼 때 쓰입니다. 고친 뒤 아래 <b>[설정 저장]</b> 을 눌러주세요.
        </p>
      </div>
    </section>`;
}

function renderNpbCostEditor() {
  const cost = state.npb.config?.costConfig || {};
  const scalars = Object.entries(cost).filter(([, v]) => typeof v !== "object" || v === null);
  const tableKey = Object.keys(cost).find((k) => Array.isArray(cost[k]));
  const scalarFields = scalars
    .map(([k, v]) => `
      <div><label>${h(k)}</label><input type="text" data-npb-cost="${h(k)}" value="${h(v ?? "")}"></div>`)
    .join("") || `<p class="muted">실비 단가 항목이 없습니다.</p>`;
  let tpl = "";
  if (tableKey) {
    const rowsArr = cost[tableKey] || [];
    const cols = rowsArr.length ? Object.keys(rowsArr[0]) : ["tier", "price"];
    const head = cols.map((c) => `<th>${h(c)}</th>`).join("") + "<th></th>";
    const body = rowsArr
      .map((row, i) => `
        <tr>
          ${cols.map((c) => `<td><input type="text" data-npb-3pl="${i}" data-npb-3col="${h(c)}" value="${h(row[c] ?? "")}"></td>`).join("")}
          <td><button class="danger icon-btn" data-npb-3pl-del="${i}" aria-label="삭제" title="삭제">×</button></td>
        </tr>`)
      .join("") || `<tr><td colspan="${cols.length + 1}" class="empty">단가표가 비어 있습니다.</td></tr>`;
    tpl = `
      <h3>3PL 단가표 (${h(tableKey)})</h3>
      <div class="table-wrap"><table class="npb-3pl-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
      <div class="toolbar"><button data-npb-3pl-add>단가 행 추가</button></div>`;
  }
  return `
    <section class="panel">
      <div class="panel-head"><h2>실비 단가 & 3PL 단가표</h2></div>
      <div class="panel-body">
        <h3>실비 단가</h3>
        <div class="field three">${scalarFields}</div>
        ${tpl}
      </div>
    </section>`;
}


function renderNpbPreview() {
  const n = state.npb;
  if (!n.currentKey) return npbNeedSelect();
  const r = n.current?.rollup || {};
  const ps = n.current?.profitSplit;
  const profit = Number(r.profit || 0);
  // 정산서에 실리는 항목만 세운다. 판매수량은 뺐다 — 합계금액으로 넣는 채널이
  // 있어(스마트스토어) 수량을 더한 값에 뜻이 없다.
  //
  // "매출계"에 정산합계를 담고 그 옆에 "이익"을 또 세우면, 실비를 빼지 않는
  // 브랜드에서는 두 칸이 같은 숫자가 되어 어느 쪽이 무엇인지 알 수 없다.
  const items = [
    ["소비자정가계", r.listTotal],
    ["매출계", r.realSaleTotal],
    ["수수료 (공제계)", r.feeTotal],
    ["정산합계", r.revenueTotal]
  ];
  // 실비를 정산에서 공제하는 브랜드만 이익이 정산합계와 갈린다.
  if (n.config?.costConfig?.billSeparately !== true) {
    items.push(["실비", r.logisticsCost], ["이익", profit]);
  }
  const cards = `
    <div class="fixed-summary-grid">
      ${items.map(([label, value]) =>
        `<div class="fixed-card"><span>${label}</span><strong>${npbWon(value)}</strong></div>`).join("")}
    </div>`;
  // 저장된 profitSplit 은 파티 배열이다 ({parties} 로 감싸 오지 않는다).
  const splitRows = (Array.isArray(ps) ? ps : ps?.parties || [])
    .map((p) => `
      <tr>
        <td>${h(p.party)}</td>
        <td class="num">${h(p.ratio)}</td>
        <td class="num">${npbWon(p.amount ?? (p.excluded ? 0 : profit * Number(p.ratio || 0)))}</td>
        <td>${p.excluded ? "제외" : h(p.note || "")}</td>
      </tr>`)
    .join("") || `<tr><td colspan="4" class="empty">이익분배 정보가 없습니다.</td></tr>`;
  // 이익분배가 없는 브랜드(픽키)의 정산서는 그 자리에 정산주체별 소계를 싣는다.
  const splitEnabled = n.config?.profitSplitEnabled !== false;
  return `
    <section class="panel">
      <div class="panel-head"><h2>미리보기</h2>${npbStatusBadge(n.current?.status)}</div>
      <div class="panel-body">${cards}</div>
      ${splitEnabled ? `
      <div class="table-wrap">
        <table class="npb-split-result-table">
          <thead><tr><th>파티</th><th>비율</th><th>배분액</th><th>비고</th></tr></thead>
          <tbody>${splitRows}</tbody>
        </table>
      </div>` : ""}
      <div class="panel-body toolbar">
        <button class="primary" data-npb-download="${h(n.currentKey)}">엑셀 다운로드</button>
        ${n.current?.status === "final"
          ? `<button data-npb-reopen>확정 해제</button>
             <span class="muted">확정 시점의 기준(실비 단가·수수료율·정가)으로 고정됩니다${
               n.current?.bases?.takenAt ? ` · ${h(String(n.current.bases.takenAt).slice(0, 10))}` : ""}</span>`
          : `<button data-npb-finalize>정산 확정</button>
             <span class="muted">확정하면 그때의 기준이 이 달에 고정되어, 나중에 설정을 바꿔도 금액이 달라지지 않습니다.</span>`}
      </div>
    </section>
    ${splitEnabled ? "" : renderNpbSettleBy()}`;
}

function bindNpb() {
  app.querySelector("[data-npb-brand]")?.addEventListener("change", async (e) => {
    const n = state.npb;
    n.brandId = e.target.value;
    // 브랜드가 바뀌면 이전 브랜드의 정산·워크시트가 남아 있으면 안 된다.
    Object.assign(n, {
      loaded: false, current: null, currentKey: "", worksheet: null,
      inventory: null, parsePreview: null, review: null, pendingUploads: [], screen: "list"
    });
    // 로딩은 아래 인라인 블록이 loaded=false 를 보고 다시 돈다.
    renderApp();
  });
  const n = state.npb;
  if (!n.loaded && !n.loading) {
    n.loading = true;
    Promise.all([
      api(`/api/npb/config?brand=${npbBrand()}`),
      api(`/api/npb/settlements?brand=${npbBrand()}`)
    ])
      .then(([config, settlements]) => {
        n.config = config || {};
        n.brands = config?.brands || n.brands || [];
        n.settlements = (settlements && settlements.settlements) || [];
        n.loaded = true;
        n.loading = false;
        renderApp();
      })
      .catch((error) => {
        n.loading = false;
        showToast(error.message || "npb 데이터 로드 실패", "error");
        renderApp();
      });
    return;
  }
  if (n.screen === "list") bindNpbList();
  else if (n.screen === "upload") bindNpbUpload();
  // 실비·재고·광고비·청구서를 워크시트에서 실비/청구 화면으로 옮겼는데, 그
  // 버튼들의 동작은 여전히 여기에 묶여 있다. 두 화면 모두에서 걸어 준다 —
  // 없는 요소는 그냥 안 걸리므로 서로 방해하지 않는다.
  else if (n.screen === "worksheet" || n.screen === "expenses") bindNpbWorksheet();
  else if (n.screen === "channels") bindNpbChannels();
  else if (n.screen === "preview") bindNpbPreview();
}

function bindNpbList() {
  const n = state.npb;
  app.querySelector("[data-npb-period]")?.addEventListener("change", (e) => {
    n.periodMonth = e.target.value;
  });
  app.querySelector("[data-npb-create]")?.addEventListener("click", async () => {
    if (!n.periodMonth) return showToast("정산 월을 선택하세요.", "error");
    try {
      await api("/api/npb/settlements", {
        method: "POST",
        body: { brand: npbBrand(), periodMonth: n.periodMonth }
      });
      await npbReloadSettlements();
      showToast("정산을 생성했습니다.");
      renderApp();
    } catch (error) {
      showToast(error.message || "생성 실패", "error");
    }
  });
  app.querySelectorAll("[data-npb-view]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await npbLoadDetail(btn.dataset.npbView);
        n.parsePreview = null;
        n.review = null;
        n.screen = "worksheet";
        renderApp();
      } catch (error) {
        showToast(error.message || "불러오기 실패", "error");
      }
    });
  });
  app.querySelectorAll("[data-npb-download]").forEach((btn) => {
    btn.addEventListener("click", () => npbDownloadXlsx(btn.dataset.npbDownload));
  });
  app.querySelectorAll("[data-npb-reissue]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const key = btn.dataset.npbReissue;
      try {
        await api(`/api/npb/settlements/${encodeURIComponent(key)}/compute`, { method: "POST" });
        await npbReloadSettlements();
        showToast("재계산(재발행)했습니다.");
        renderApp();
      } catch (error) {
        showToast(error.message || "재발행 실패", "error");
      }
    });
  });
}

function bindNpbUpload() {
  const n = state.npb;
  app.querySelectorAll("[data-npb-alias]").forEach((sel) => {
    sel.addEventListener("change", () => {
      const draft = npbAliasDraftFor(Number(sel.getAttribute("data-npb-alias")));
      const target = draft.targets[Number(sel.getAttribute("data-npb-at"))];
      if (!target) return;
      const field = sel.getAttribute("data-npb-af");
      target[field] = field === "multiplier" ? Number(sel.value || 1) : sel.value;
    });
  });
  app.querySelectorAll("[data-npb-alias-add]").forEach((btn) => {
    btn.addEventListener("click", () => {
      npbAliasDraftFor(Number(btn.getAttribute("data-npb-alias-add")))
        .targets.push({ productId: "", multiplier: 1 });
      renderApp();
    });
  });
  app.querySelectorAll("[data-npb-alias-del]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const [i, ti] = btn.getAttribute("data-npb-alias-del").split(":").map(Number);
      npbAliasDraftFor(i).targets.splice(ti, 1);
      renderApp();
    });
  });
  app.querySelector("[data-npb-alias-save]")?.addEventListener("click", async () => {
    const aliases = (n.unresolved || [])
      .map((u, i) => {
        const draft = n.aliasDraft?.[i];
        const targets = (draft?.targets || []).filter((t) => t.productId);
        if (!targets.length) return null;
        const channel = n.review?.channel || "";
        if (targets[0].productId === "__ignore") {
          return { brandId: npbBrand(), channel, sourceName: u.sourceName, sourceCode: u.sourceCode || "", ignore: true };
        }
        return {
          brandId: npbBrand(),
          channel,
          sourceName: u.sourceName,
          sourceCode: u.sourceCode || "",
          targets: targets.map((t) => ({
            productId: t.productId,
            multiplier: Math.max(1, Number(t.multiplier || 1))
          }))
        };
      })
      .filter(Boolean);
    if (!aliases.length) return showToast("지정할 상품을 선택하세요.", "error");
    try {
      const res = await api("/api/npb/aliases", { method: "POST", body: { aliases } });
      showToast(`${res.saved}건 저장했습니다. 같은 이름은 다음부터 자동으로 인식됩니다.`);
      const done = new Set(aliases.map((a) => a.sourceName));
      n.unresolved = (n.unresolved || []).filter((u) => !done.has(u.sourceName));
      n.aliasDraft = {};
      renderApp();
    } catch (error) {
      showToast(error.message || "매칭 저장 실패", "error");
    }
  });
  // silent 는 일괄 반영용 -- 채널마다 알림을 띄우고 다시 그리면 화면이 깜빡이고
  // 느리다. 부르는 쪽이 끝나고 한 번만 정리한다.
  const npbApplyChannel = async (code, opts = {}) => {
    try {
      const res = await api(`/api/npb/settlements/${encodeURIComponent(n.currentKey)}/confirm`, {
        method: "POST", body: { channel: code }
      });
      if (opts.silent) return res;
      n.review = null;
      await npbLoadDetail(n.currentKey);
      showToast(res.removed
        ? `${npbChannelName(code)} 내역을 워크시트에서 뺐습니다.`
        : `${npbChannelName(code)} 반영 완료 — ${res.rows.length}개 품목. 다른 채널은 그대로입니다.`);
      renderApp();
      return res;
    } catch (error) {
      if (opts.silent) throw error;
      showToast(error.message || "반영 실패", "error");
    }
    return null;
  };
  app.querySelectorAll("[data-npb-apply]").forEach((btn) => {
    btn.addEventListener("click", () => npbApplyChannel(btn.getAttribute("data-npb-apply")));
  });
  app.querySelectorAll("[data-npb-upload-del]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const code = btn.getAttribute("data-npb-upload-del");
      try {
        await api(`/api/npb/settlements/${encodeURIComponent(n.currentKey)}/upload?channel=${encodeURIComponent(code)}`,
          { method: "DELETE" });
        await npbLoadDetail(n.currentKey);
        showToast(`${npbChannelName(code)} 파일을 뺐습니다. [반영] 을 눌러야 워크시트에서도 빠집니다.`);
        renderApp();
      } catch (error) {
        showToast(error.message || "삭제 실패", "error");
      }
    });
  });

  // 올린 파일 고르기 + 일괄 처리
  const doneCodes = () =>
    Object.keys(n.current?.uploads || {}).filter((code) => code !== "logistics");
  app.querySelectorAll("[data-npb-pick]").forEach((box) => {
    box.addEventListener("change", () => {
      const code = box.getAttribute("data-npb-pick");
      const set = new Set(n.uploadPicked || []);
      if (box.checked) set.add(code); else set.delete(code);
      n.uploadPicked = [...set];
      renderApp();
    });
  });
  app.querySelector("[data-npb-pick-all]")?.addEventListener("change", (e) => {
    n.uploadPicked = e.target.checked ? doneCodes() : [];
    renderApp();
  });
  app.querySelectorAll("[data-npb-bulk]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const kind = btn.getAttribute("data-npb-bulk");
      const codes = [...(n.uploadPicked || [])];
      if (!codes.length) return;
      const names = codes.map(npbChannelName).join(", ");
      if (kind === "delete" && !confirm(`${codes.length}개 채널의 파일을 지울까요?\n${names}`)) return;
      const key = encodeURIComponent(n.currentKey);
      try {
        if (kind === "apply") {
          // 반영은 채널마다 검수 내용이 달라 한 건씩 보낸다.
          for (const code of codes) await npbApplyChannel(code, { silent: true });
          showToast(`${codes.length}개 채널을 반영했습니다.`);
        } else if (kind === "disable") {
          await api(`/api/npb/settlements/${key}/upload-disable`, {
            method: "POST", body: { channels: codes, disabled: true }
          });
          showToast(`${codes.length}개 채널을 사용안함으로 두었습니다. 파일은 남아 있습니다.`);
        } else {
          await api(`/api/npb/settlements/${key}/upload-bulk-delete`, {
            method: "POST", body: { channels: codes }
          });
          showToast(`${codes.length}개 채널의 파일을 지웠습니다.`);
        }
        n.uploadPicked = [];
        await npbLoadDetail(n.currentKey);
        renderApp();
      } catch (error) {
        showToast(error.message || "처리에 실패했습니다.", "error");
      }
    });
  });
  app.querySelectorAll("[data-npb-enable]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const code = btn.getAttribute("data-npb-enable");
      try {
        await api(`/api/npb/settlements/${encodeURIComponent(n.currentKey)}/upload-disable`, {
          method: "POST", body: { channels: [code], disabled: false }
        });
        await npbLoadDetail(n.currentKey);
        showToast(`${npbChannelName(code)} — 다시 사용합니다. [반영] 을 눌러야 워크시트에 들어갑니다.`);
        renderApp();
      } catch (error) {
        showToast(error.message || "처리에 실패했습니다.", "error");
      }
    });
  });

  const markNoSales = async (code, remove) => {
    try {
      await api(
        `/api/npb/settlements/${encodeURIComponent(n.currentKey)}/no-sales?channel=${encodeURIComponent(code)}`,
        { method: remove ? "DELETE" : "POST" }
      );
      await npbLoadDetail(n.currentKey);
      showToast(remove
        ? `${npbChannelName(code)} 표시를 지웠습니다.`
        : `${npbChannelName(code)} — 이달 내역 없음으로 표시했습니다.`);
      renderApp();
    } catch (error) {
      showToast(error.message || "표시에 실패했습니다.", "error");
    }
  };
  app.querySelectorAll("[data-npb-nosales]").forEach((btn) => {
    btn.addEventListener("click", () => markNoSales(btn.getAttribute("data-npb-nosales"), false));
  });
  app.querySelectorAll("[data-npb-nosales-undo]").forEach((btn) => {
    btn.addEventListener("click", () => markNoSales(btn.getAttribute("data-npb-nosales-undo"), true));
  });
  app.querySelectorAll("[data-npb-sample]").forEach((btn) => {
    btn.addEventListener("click", () => downloadNpbSampleForm(btn, btn.getAttribute("data-npb-sample")));
  });
  app.querySelectorAll("[data-npb-entry]").forEach((sel) => {
    sel.addEventListener("change", async () => {
      const code = sel.getAttribute("data-npb-entry");
      const channel = (n.config?.channels || []).find((c) => c.code === code);
      if (!channel) return;
      channel.entryMode = sel.value;
      try {
        await api("/api/npb/config", {
          method: "PUT",
          body: {
            brand: npbBrand(),
            channels: n.config.channels,
            costConfig: n.config?.costConfig || {},
            products: n.config?.products || []
          }
        });
        const mode = NPB_ENTRY_MODES.find(([v]) => v === sel.value);
        showToast(`${channel.name} — ${mode?.[1] || sel.value}. ${mode?.[2] || ""}`);
        // 합계 방식으로 바꾸면 워크시트 모양이 달라진다.
        n.worksheet = npbBuildWorksheet(n.config, n.current?.lines || []);
        renderApp();
      } catch (error) {
        showToast(error.message || "저장 실패", "error");
      }
    });
  });
  app.querySelectorAll("[data-npb-review-open]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const code = btn.getAttribute("data-npb-review-open");
      const up = n.current?.uploads?.[code];
      if (!up) return;
      n.review = {
        channel: code,
        rows: (up.lines || []).map((row) => ({ ...row, qty: Number(row.qty ?? row.qtyEa ?? 0) })),
        warnings: up.warnings || []
      };
      renderApp();
    });
  });
  app.querySelectorAll("[data-npb-rv]").forEach((input) => {
    input.addEventListener("input", () => {
      const i = Number(input.getAttribute("data-npb-rv"));
      const field = input.getAttribute("data-npb-rf");
      const row = n.review?.rows?.[i];
      if (!row) return;
      if (field === "discountMode") {
        row.discountMode = input.value;
      } else {
        const value = Number(input.value || 0);
        row[field] = field === "feeRate" ? value / 100 : value;
      }
      // 손대는 순간 그 행은 파일 금액 대신 계산식을 쓴다. 파일 추출이 기준금액을
      // 빠뜨리고 오는 경우가 있어, 고친 값이 이기지 않으면 고칠 방법이 없다.
      const manual = new Set(row.manualFields || []);
      manual.add("listPrice");
      if (["unitPrice", "qty", "discountAmount", "discountMode", "shippingAmount"].includes(field)) {
        delete row.saleAmount;
        delete row.settleAmount;
        manual.add("saleAmount");
      }
      if (field === "feeRate") {
        delete row.feeAmount;
        delete row.settleAmount;
      }
      row.manualFields = [...manual];
      npbRepaintReview();
    });
  });
  app.querySelectorAll("[data-npb-rv-drop]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const row = n.review?.rows?.[Number(btn.getAttribute("data-npb-rv-drop"))];
      if (!row) return;
      row.dropped = !row.dropped;
      renderApp();
    });
  });
  app.querySelector("[data-npb-review-cancel]")?.addEventListener("click", () => {
    n.review = null;
    renderApp();
  });
  app.querySelector("[data-npb-confirm]")?.addEventListener("click", async () => {
    const review = n.review;
    if (!review) return;
    // 서버의 npbComputeLine 은 할인을 빼지 않는다(단가 x 수량). 검수표에서 본
    // 금액을 그대로 실어 보내지 않으면, 화면에 뜬 최종결제와 정산서에 들어가는
    // 매출이 달라진다 -- 사람이 적은 프로모션 할인이 통째로 무시된다.
    const rows = review.rows.map((row) => {
      if (row.dropped) return row;
      const m = npbReviewMath(row);
      const qty = Number(row.qty || 0);
      // 워크시트는 '기준가 x 수량' 으로 매출을 구한다. 할인이 녹은 단가를
      // salePrice 로 넘겨야 검수표에서 본 금액이 그대로 따라간다.
      // unitPrice(할인 전)는 건드리지 않는다 -- 다음 달 기본값으로 쓰인다.
      const shipping = Number(row.shippingAmount || 0);
      const effectiveUnit = qty > 0 ? Math.round((m.sale - shipping) / qty) : 0;
      return {
        ...row,
        salePrice: effectiveUnit,
        saleAmount: m.sale,
        discountAmount: m.discount,
        discountMode: "line"
      };
    });
    try {
      const res = await api(`/api/npb/settlements/${encodeURIComponent(n.currentKey)}/confirm`, {
        method: "POST",
        body: { channel: review.channel, rows }
      });
      n.review = null;
      await npbLoadDetail(n.currentKey);
      showToast(
        `${npbChannelName(review.channel)} 반영 완료 — ${res.rows.length}개 품목, ` +
        `매출 ${npbWon(res.rollup?.realSaleTotal)}. 워크시트·정산서에 함께 들어갔습니다.`
      );
      renderApp();
    } catch (error) {
      showToast(error.message || "확정 실패", "error");
    }
  });
  app.querySelector("[data-npb-alias-clear]")?.addEventListener("click", () => {
    n.unresolved = [];
    n.aliasDraft = {};
    renderApp();
  });
  app.querySelector("[data-npb-tdoc-open]")?.addEventListener("click", async () => {
    try {
      const res = await api(`/api/npb/settlements/${encodeURIComponent(n.currentKey)}/trade-docs`);
      // 기본 채널: 거래처명으로 짐작한 채널 중 아직 안 가져온 문서가 있는 것.
      const docs = res.docs || [];
      const channel = docs.find((d) => d.channelGuess && !d.importedTo)?.channelGuess
        || docs.find((d) => d.channelGuess)?.channelGuess
        || (res.channels?.[0]?.code || "");
      n.tradeDocs = {
        ...res,
        channel,
        picked: docs
          .filter((d) => !d.importedTo && (!d.channelGuess || d.channelGuess === channel))
          .map((d) => d.id)
      };
      renderApp();
    } catch (error) {
      showToast(error.message || "거래명세서 목록을 읽지 못했습니다.", "error");
    }
  });
  app.querySelector("[data-npb-tdoc-close]")?.addEventListener("click", () => {
    n.tradeDocs = null;
    renderApp();
  });
  app.querySelector("[data-npb-tdoc-channel]")?.addEventListener("change", (e) => {
    const t = n.tradeDocs;
    if (!t) return;
    t.channel = e.target.value;
    // 채널을 바꾸면 그 채널로 짐작되는 문서로 선택을 다시 잡는다.
    t.picked = (t.docs || [])
      .filter((d) => !d.importedTo && (!d.channelGuess || d.channelGuess === t.channel))
      .map((d) => d.id);
    renderApp();
  });
  app.querySelectorAll("[data-npb-tdoc-pick]").forEach((input) => {
    input.addEventListener("change", () => {
      const t = n.tradeDocs;
      if (!t) return;
      const docId = input.getAttribute("data-npb-tdoc-pick");
      const picked = new Set(t.picked || []);
      if (input.checked) picked.add(docId);
      else picked.delete(docId);
      t.picked = [...picked];
      renderApp();
    });
  });
  app.querySelector("[data-npb-tdoc-go]")?.addEventListener("click", async () => {
    const t = n.tradeDocs;
    if (!t || !(t.picked || []).length) return;
    try {
      const res = await api(`/api/npb/settlements/${encodeURIComponent(n.currentKey)}/trade-docs`, {
        method: "POST",
        body: { channel: t.channel, docIds: t.picked }
      });
      const parsedRows = res.rows || [];
      // 파일 업로드와 같은 흐름 — 워크시트로 바로 밀지 않고 검수표로 띄운다.
      n.review = {
        channel: res.channel,
        rows: parsedRows.map((row) => ({ ...row, qty: Number(row.qty ?? row.qtyEa ?? 0) })),
        warnings: res.warnings || []
      };
      if (res.unresolved?.length) {
        const seen = new Set(n.unresolved.map((u) => u.sourceName));
        n.unresolved = [...n.unresolved, ...res.unresolved.filter((u) => !seen.has(u.sourceName))];
      }
      n.tradeDocs = null;
      showToast(
        `${npbChannelName(res.channel)} 로 거래명세서를 가져왔습니다 — ${parsedRows.length}개 품목. ` +
        `검수표에서 확인 후 [확정/반영] 을 눌러주세요.`
      );
      try {
        await npbLoadDetail(n.currentKey);
      } catch (error) {
        showToast(`가져오기는 됐지만 화면을 새로 읽지 못했습니다: ${error.message}`, "error");
      }
      renderApp();
    } catch (error) {
      showToast(error.message || "거래명세서 가져오기 실패", "error");
    }
  });
  app.querySelector("[data-npb-upload-any]")?.addEventListener("change", async (e) => {
    const files = [...(e.target.files || [])];
    if (!files.length) return;
    const ok = [];
    const unknown = [];
    for (const file of files) {
      const result = await npbDoUpload({ kind: "channel", file, quiet: true });
      if (result?.needsChannel) unknown.push(result.pending);
      else if (result?.ok) {
        const name = npbChannelName(result.channel);
        ok.push(`${name}(${result.rowCount}행)`);
        if (result.alternatives?.length) {
          showToast(
            `"${result.fileName}" 은(는) ${name} 로 넣었습니다. ` +
            `${result.alternatives.map((a) => a.name).join(", ")} 에도 해당돼 보이니 확인하세요.`,
            "error"
          );
        }
      }
    }
    n.pendingUploads = [...(n.pendingUploads || []), ...unknown];
    if (ok.length) {
      showToast(
        `파일을 읽었습니다 — ${ok.join(", ")}. 검수표에서 확인 후 [확정/반영] 을 눌러주세요.`
      );
    }
    if (unknown.length) showToast(`채널을 알 수 없는 파일 ${unknown.length}건 — 직접 지정하세요.`, "error");
    try {
      await npbLoadDetail(n.currentKey);
    } catch (error) {
      showToast(`업로드는 됐지만 화면을 새로 읽지 못했습니다: ${error.message}`, "error");
    }
    renderApp();
  });

  app.querySelectorAll("[data-npb-assign-go]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const i = Number(btn.dataset.npbAssignGo);
      const pending = (n.pendingUploads || [])[i];
      const channel = app.querySelector(`[data-npb-assign="${i}"]`)?.value;
      if (!pending || !channel) return showToast("채널을 선택하세요.", "error");
      const result = await npbDoUpload({
        kind: "channel", channel, preread: pending, quiet: true
      });
      if (result?.ok) {
        n.pendingUploads.splice(i, 1);
        showToast(`업로드 완료 (${result.rowCount}행)`);
        await npbLoadDetail(n.currentKey);
      }
      renderApp();
    });
  });

}

async function npbDoUpload({ kind, channel, file, preread, quiet = false }) {
  const n = state.npb;
  try {
    const fileName = preread ? preread.fileName : file.name;
    const fileBase64 = preread ? preread.fileBase64 : await readFileAsBase64(file);
    const body = { kind, fileBase64, fileName };
    if (channel) body.channel = channel;
    const res = await api(`/api/npb/settlements/${encodeURIComponent(n.currentKey)}/upload`, {
      method: "POST",
      body
    });
    const parsedRows = res.rows || res.lines || [];
    // 워크시트로 바로 밀어 넣지 않고 검수표로 띄운다.
    n.review = {
      channel: res.channel || channel,
      rows: parsedRows.map((row) => ({ ...row, qty: Number(row.qty ?? row.qtyEa ?? 0) })),
      warnings: res.warnings || []
    };
    // 응답으로 바로 반영한다. 다시 읽어오는 데 기대면 그 호출이 실패하거나
    // 늦을 때 화면이 '미업로드' 인 채로 남아, 올린 사람은 실패한 줄 안다.
    if (n.current) {
      const code = res.channel || channel;
      if (kind === "channel" && code) {
        n.current.uploads = { ...(n.current.uploads || {}),
          [code]: { channel: code, fileName, lines: parsedRows, uploadedAt: new Date().toISOString() } };
      }
    }
    if (res.unresolved?.length) {
      // 이름이 겹치면 한 번만 남긴다 — 같은 이름을 여러 번 지정할 이유가 없다.
      const seen = new Set(n.unresolved.map((u) => u.sourceName));
      n.unresolved = [...n.unresolved, ...res.unresolved.filter((u) => !seen.has(u.sourceName))];
    }
    if (!quiet) {
      try {
        await npbLoadDetail(n.currentKey);
      } catch (error) {
        showToast(`업로드는 됐지만 화면을 새로 읽지 못했습니다: ${error.message}`, "error");
      }
      showToast(
        `${npbChannelName(res.channel || channel)} 파일을 읽었습니다 — ${parsedRows.length}개 품목. ` +
        `아래 검수표에서 확인하고 [확정/반영] 을 눌러주세요.`
      );
      renderApp();
    }
    return {
      ok: true,
      channel: res.channel || channel,
      rowCount: parsedRows.length,
      alternatives: res.alternatives || [],
      fileName
    };
  } catch (error) {
    // 채널을 못 찾은 파일은 버리지 않고 들고 있다가 사용자가 지정하게 한다 —
    // 다시 고르게 하면 여러 파일을 올린 의미가 없다.
    if (error.payload?.needsChannel) {
      return {
        needsChannel: true,
        pending: {
          fileName: preread ? preread.fileName : file.name,
          fileBase64: preread ? preread.fileBase64 : await readFileAsBase64(file)
        }
      };
    }
    showToast(error.message || "업로드 실패", "error");
    return { ok: false };
  }
}

// Flatten the worksheet blocks into settlement line objects for PUT /lines.
function npbWorksheetLines() {
  const n = state.npb;
  const lines = [];
  for (const block of n.worksheet || []) {
    if (block.summary) continue;
    for (const row of block.rows) {
      // 업로드 원본 위에 화면에서 고친 값만 얹는다. 예전에는 화면에 보이는
      // 필드만 새로 만들어 보냈기 때문에, 저장 한 번에 파일에서 읽은 금액
      // (money/amounts/saleAmount)과 정가가 전부 사라졌다.
      const source = row.source || {};
      lines.push({
        ...source,
        channel: block.code,
        productKey: row.productKey,
        label: row.label,
        listPrice: Number(row.listPrice || 0),
        salePrice: Number(row.salePrice || 0),
        feeRate: Number(row.feeRate || 0),
        qty: Number(row.qty || 0),
        qtyEa: Number(row.qty || 0),
        eaPerUnit: Number(row.eaPerUnit || 1),
        tier: row.tier || "",
        // 그 줄이 어느 끝자리 규칙으로 계산됐는지 함께 저장한다 — 나중에 채널
        // 설정을 바꿔도 이미 확정한 달의 금액이 달라지지 않는다.
        rounding: String(row.rounding ?? source.rounding ?? ""),
        manualFields: row.manualFields || source.manualFields || []
      });
    }
  }
  return lines;
}

function bindNpbWorksheet() {
  const n = state.npb;
  // Worksheet cell edits: salePrice/qty as numbers, feeRate entered as a percent.
  app.querySelectorAll("[data-npb-ws-toggle]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const code = btn.getAttribute("data-npb-ws-toggle");
      if (!n.wsCollapsed) n.wsCollapsed = {};
      const block = (n.worksheet || []).find((b) => b.code === code);
      const empty = block ? block.rows.every((row) => !Number(row.qty)) : false;
      n.wsCollapsed[code] = !(n.wsCollapsed[code] ?? empty);
      renderApp();
    });
  });
  // 행사 할인율. 서버가 그 달의 정산을 다시 계산해 돌려주므로 화면은 받은
  // 값으로 갈아끼우기만 한다.
  app.querySelectorAll("[data-npb-promo-save]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const code = btn.getAttribute("data-npb-promo-save");
      const input = app.querySelector(`[data-npb-promo="${code}"]`);
      try {
        const res = await api(
          `/api/npb/settlements/${encodeURIComponent(n.currentKey)}/promo`,
          { method: "PUT", body: { channel: code, rate: Number(input?.value || 0) } }
        );
        // 몽슈슈 줄의 기준가·수수료율이 서버에서 바뀌므로 워크시트를 다시 받는다.
        await npbLoadDetail(n.currentKey);
        showToast(res?.rate ? `행사 할인 ${Math.round(res.rate * 100)}% 적용` : "행사 할인 해제");
        renderApp();
      } catch (error) {
        showToast(error.message || "행사 할인 저장 실패", "error");
      }
    });
  });
  app.querySelector("[data-npb-reload]")?.addEventListener("click", async () => {
    try {
      await npbLoadDetail(n.currentKey);
      showToast("새로 읽었습니다.");
      renderApp();
    } catch (error) {
      showToast(error.message || "새로고침 실패", "error");
    }
  });
  app.querySelectorAll("[data-npb-sum]").forEach((inp) => {
    inp.addEventListener("input", () => {
      const block = n.worksheet?.[Number(inp.dataset.npbSum)];
      if (!block?.totals) return;
      block.totals[inp.dataset.npbSf] = Number(inp.value || 0);
      const el = inp.closest(".npb-sum-grid")?.querySelector(".npb-sum-cell strong");
      if (el) {
        el.textContent = money.format(
          Number(block.totals.saleTotal || 0) - Number(block.totals.feeTotal || 0)
        );
      }
    });
  });
  app.querySelectorAll("[data-npb-ws]").forEach((inp) => {
    inp.addEventListener("input", (e) => {
      const bi = Number(inp.dataset.npbWs);
      const ri = Number(inp.dataset.npbWr);
      const f = inp.dataset.npbWf;
      const row = n.worksheet?.[bi]?.rows?.[ri];
      if (!row) return;
      const raw = Number(e.target.value);
      row[f] = f === "feeRate" ? (Number.isFinite(raw) ? raw / 100 : 0) : raw;
      // 손댄 행은 파일 금액 대신 화면 값을 쓴다. 파일이 기준금액을 빠뜨리고
      // 오는 일이 있어, 고친 값이 이기지 않으면 고칠 방법이 없다.
      const manual = new Set(row.manualFields || []);
      manual.add("listPrice");
      if (row.source) {
        row.source = { ...row.source };
        if (f === "feeRate") {
          delete row.source.feeAmount;
          delete row.source.settleAmount;
        } else {
          delete row.source.saleAmount;
          delete row.source.settleAmount;
          delete row.source.listAmount;
        }
      }
      row.manualFields = [...manual];
      renderNpbWorksheetLive();
    });
  });
  const setShip = (key, field, value) => {
    const cur = n.logisticsCounts[key];
    const entry = cur && typeof cur === "object" ? { ...cur } : { count: Number(cur) || 0 };
    entry[field] = Number(value) || 0;
    n.logisticsCounts[key] = entry;
  };
  app.querySelectorAll("[data-npb-adcost]").forEach((btn) => btn.addEventListener("click", async () => {
    n.adCostLoading = true;
    renderApp();
    try {
      n.adCost = await api(`/api/npb/settlements/${encodeURIComponent(n.currentKey)}/adcost`);
    } catch (error) {
      showToast(error.message || "광고비를 불러오지 못했습니다.", "error");
    } finally {
      n.adCostLoading = false;
      renderApp();
    }
  }));
  // 기초재고: 파일과 기준일을 고른 뒤 저장을 눌러야 반영된다. 파일을 고르는
  // 즉시 덮어쓰면 기준일을 잘못 둔 채로 들어간다.
  app.querySelector("[data-npb-stock-save]")?.addEventListener("click", async () => {
    const input = app.querySelector("[data-npb-stockfile]");
    const file = input?.files?.[0];
    const asOf = app.querySelector("[data-npb-stock-asof]")?.value || "";
    try {
      if (!file) {
        await api(`/api/npb/settlements/${encodeURIComponent(n.currentKey)}/stock-asof`, {
          method: "PUT", body: { asOf }
        });
        if (n.current) n.current.stockFile = { ...(n.current.stockFile || {}), asOf };
        showToast("기초재고 기준일을 저장했습니다.");
        renderApp();
        return;
      }
      const res = await api(`/api/npb/settlements/${encodeURIComponent(n.currentKey)}/stock-file`, {
        method: "POST",
        body: { fileBase64: await readFileAsBase64(file), fileName: file.name, asOf }
      });
      await npbLoadDetail(n.currentKey);
      const missed = (res.unmatched || []).length;
      showToast(missed
        ? `기초재고 ${res.matched.length}건 반영 · 매칭 실패 ${missed}건`
        : `기초재고 ${res.matched.length}건 반영`, missed ? "error" : undefined);
      renderApp();
    } catch (error) {
      showToast(error.message || "기초재고를 저장하지 못했습니다.", "error");
    }
  });
  app.querySelector("[data-npb-inout-save]")?.addEventListener("click", async () => {
    const file = app.querySelector("[data-npb-inoutfile]")?.files?.[0];
    if (!file) return showToast("입출고 내역 파일(CSV 또는 엑셀)을 선택하세요.", "error");
    try {
      const res = await api(`/api/npb/settlements/${encodeURIComponent(n.currentKey)}/inout-file`, {
        method: "POST",
        body: { fileBase64: await readFileAsBase64(file), fileName: file.name }
      });
      await npbLoadDetail(n.currentKey);
      const warn = (res.warnings || []).join(" ");
      showToast(warn
        ? `입출고 ${res.inoutFile?.rowCount || 0}행 반영 · ${warn}`
        : `입출고 ${res.inoutFile?.rowCount || 0}행 반영`, warn ? "error" : undefined);
      renderApp();
    } catch (error) {
      showToast(error.message || "입출고 내역을 저장하지 못했습니다.", "error");
    }
  });
  app.querySelector("[data-npb-inv-save]")?.addEventListener("click", async () => {
    try {
      await api(`/api/npb/settlements/${encodeURIComponent(n.currentKey)}/inventory`, {
        method: "PUT", body: { inventory: n.inventory || [] }
      });
      await npbLoadDetail(n.currentKey);
      showToast("재고를 저장했습니다.");
      renderApp();
    } catch (error) {
      showToast(error.message || "재고 저장 실패", "error");
    }
  });
  app.querySelector("[data-npb-inv-confirm]")?.addEventListener("click", async () => {
    try {
      await api(`/api/npb/settlements/${encodeURIComponent(n.currentKey)}/inventory`, {
        method: "PUT", body: { inventory: n.inventory || [], confirm: true }
      });
      await npbLoadDetail(n.currentKey);
      showToast("재고를 확정했습니다.");
      renderApp();
    } catch (error) {
      showToast(error.message || "재고 확정 실패", "error");
    }
  });
  // 실비 건수 저장 = 확정. 버튼이 연결돼 있지 않아 눌러도 아무 일이 없었다.
  app.querySelector("[data-npb-ship-save]")?.addEventListener("click", async () => {
    try {
      await api(`/api/npb/settlements/${encodeURIComponent(n.currentKey)}/logistics`, {
        method: "PUT",
        body: { counts: n.logisticsCounts || {}, confirm: true }
      });
      await npbLoadDetail(n.currentKey);
      showToast("운임/물류를 확정했습니다.");
      renderApp();
    } catch (error) {
      showToast(error.message || "저장 실패", "error");
    }
  });
  // 청구서 발행 → 그 자리에서 엑셀로 내려받는다. 발행만 하고 파일이 안 나오면
  // 어디서 받는지 알 길이 없다.
  app.querySelectorAll("[data-npb-invoice]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const type = btn.getAttribute("data-npb-invoice");
      try {
        const res = await api(`/api/npb/settlements/${encodeURIComponent(n.currentKey)}/invoice`, {
          method: "POST", body: { type }
        });
        await npbDownloadInvoice(res.invoice);
        await npbLoadDetail(n.currentKey);
        showToast("청구서를 발행했습니다.");
        renderApp();
      } catch (error) {
        showToast(error.message || "청구서 발행 실패", "error");
      }
    });
  });
  // 출고내역 파일. 입력칸만 있고 아무 데도 연결돼 있지 않아 올려도 반응이 없었다.
  app.querySelectorAll("[data-npb-shipfile]").forEach((inp) => {
    inp.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const shipType = inp.getAttribute("data-npb-shipfile");
      try {
        const res = await api(`/api/npb/settlements/${encodeURIComponent(n.currentKey)}/shipping-file`, {
          method: "POST",
          body: { shipType, fileBase64: await readFileAsBase64(file), fileName: file.name }
        });
        await npbLoadDetail(n.currentKey);
        const warn = (res.warnings || []).join(" ");
        showToast(warn ? `출고내역을 반영했습니다. ${warn}` : "출고내역을 반영했습니다.", warn ? "error" : undefined);
        renderApp();
      } catch (error) {
        showToast(error.message || "출고내역을 읽지 못했습니다.", "error");
      }
    });
  });
  app.querySelectorAll("[data-npb-ship]").forEach((inp) => {
    inp.addEventListener("input", (e) => {
      setShip(inp.dataset.npbShip, "count", e.target.value);
      renderNpbWorksheetLive();
    });
  });
  app.querySelectorAll("[data-npb-ship-amt]").forEach((inp) => {
    inp.addEventListener("input", (e) => {
      setShip(inp.dataset.npbShipAmt, "amount", e.target.value);
      renderNpbWorksheetLive();
    });
  });
  app.querySelectorAll("[data-npb-inv]").forEach((inp) => {
    inp.addEventListener("input", (e) => {
      const i = Number(inp.dataset.npbInv);
      const row = n.inventory?.[i];
      if (row) row[inp.dataset.npbIfield] = Number(e.target.value) || 0;
    });
  });
  bindNpbProfitInline();
  app.querySelector("[data-npb-ws-save]")?.addEventListener("click", npbSaveWorksheet);
  app.querySelectorAll("[data-npb-download]").forEach((btn) => {
    btn.addEventListener("click", () => npbDownloadXlsx(btn.dataset.npbDownload));
  });
}

// Re-render only the worksheet screen in place for instant feedback (avoids a
// full renderApp so focus/caret stay in the edited input).
// 검수표의 계산 칸만 다시 그린다. 통째로 렌더하면 입력 중이던 칸에서
// 커서가 튕겨 나가 숫자를 이어서 못 친다.
function npbRepaintReview() {
  const rows = state.npb.review?.rows || [];
  const table = app.querySelector("[data-npb-rv]")?.closest("table");
  if (!table) return;
  const total = { qty: 0, sale: 0, fee: 0, settle: 0 };
  table.querySelectorAll("tbody tr").forEach((tr, i) => {
    const row = rows[i];
    if (!row) return;
    const m = npbReviewMath(row);
    const tds = tr.querySelectorAll("td");
    if (tds[7]) tds[7].textContent = money.format(m.sale);
    if (tds[9]) tds[9].textContent = money.format(m.fee);
    if (tds[10]) tds[10].textContent = money.format(m.settle);
    if (row.dropped) return;
    total.qty += Number(row.qty || 0);
    total.sale += m.sale; total.fee += m.fee; total.settle += m.settle;
  });
  const foot = table.querySelectorAll("tfoot th");
  if (foot[4]) foot[4].textContent = money.format(total.qty);
  if (foot[7]) foot[7].textContent = money.format(total.sale);
  if (foot[9]) foot[9].textContent = money.format(total.fee);
  if (foot[10]) foot[10].textContent = money.format(total.settle);
}

function renderNpbWorksheetLive() {
  const container = app.querySelector(".npb-rollup-grid");
  if (!container) return;
  const r = npbWorksheetRollup();
  const cells = [
    money.format(Math.round(r.qtyTotal)), npbWon(r.listTotal),
    npbWon(r.discountTotal), npbWon(r.realSaleTotal), npbWon(r.feeTotal),
    npbWon(r.revenueTotal), npbWon(r.logisticsCost), npbWon(r.profit)
  ];
  container.querySelectorAll(".fixed-card strong").forEach((el, i) => {
    if (cells[i] != null) el.textContent = cells[i];
  });
  // Update each block's row totals and the channel 합계 row.
  app.querySelectorAll(".npb-ws-block").forEach((blockEl, bi) => {
    const block = state.npb.worksheet?.[bi];
    if (!block) return;
    let sq = 0, sr = 0, sf = 0, ss = 0, sl = 0, sd = 0;
    // 칸 번호가 아니라 이름으로 찾는다. 번호로 짚으면 칸 순서를 바꾸는 순간
    // 금액이 엉뚱한 칸에 덮어써지고, 입력칸 위에 쓰면 그 칸이 통째로 사라진다.
    const put = (el, text) => { if (el) el.textContent = text; };
    const discountText = (v) => (v > 0 ? `−${money.format(v)}` : "-");
    blockEl.querySelectorAll("tbody tr").forEach((tr, ri) => {
      const row = block.rows[ri];
      if (!row) return;
      const m = npbRowMath(row);
      const unitDiscount = Number(row.listPrice || 0) - Number(row.salePrice || 0);
      sq += Number(row.qty || 0); sr += m.revenue; sf += m.fee; ss += m.settle;
      sl += m.list; sd += m.list - m.revenue;
      put(tr.querySelector('[data-npb-cell="list"]'), money.format(m.list));
      put(tr.querySelector('[data-npb-cell="revenue"]'), money.format(m.revenue));
      put(tr.querySelector('[data-npb-cell="fee"]'), money.format(m.fee));
      put(tr.querySelector('[data-npb-cell="settle"]'), money.format(m.settle));
      const dc = tr.querySelector('[data-npb-cell="discount"]');
      put(dc, discountText(unitDiscount));
      if (dc) dc.classList.toggle("npb-ws-discount", unitDiscount > 0);
    });
    put(blockEl.querySelector('[data-npb-foot="qty"]'), money.format(sq));
    put(blockEl.querySelector('[data-npb-foot="list"]'), money.format(sl));
    put(blockEl.querySelector('[data-npb-foot="revenue"]'), money.format(sr));
    put(blockEl.querySelector('[data-npb-foot="fee"]'), money.format(sf));
    put(blockEl.querySelector('[data-npb-foot="settle"]'), money.format(ss));
    const fd = blockEl.querySelector('[data-npb-foot="discount"]');
    put(fd, discountText(sd));
    if (fd) fd.classList.toggle("npb-ws-discount", sd > 0);
  });
}

async function npbSaveWorksheet() {
  const n = state.npb;
  try {
    await api(`/api/npb/settlements/${encodeURIComponent(n.currentKey)}/lines`, {
      method: "PUT",
      body: { lines: npbWorksheetLines() }
    });
    // 합계만 적는 채널은 품목 줄이 없으므로 따로 보낸다. lines 저장이 그 채널을
    // 비워 놓고 지나가므로 순서가 중요하다.
    for (const block of n.worksheet || []) {
      if (!block.summary) continue;
      await api(`/api/npb/settlements/${encodeURIComponent(n.currentKey)}/summary`, {
        method: "PUT",
        body: { channel: block.code, ...block.totals }
      });
    }
    const computed = await api(
      `/api/npb/settlements/${encodeURIComponent(n.currentKey)}/compute`,
      {
        method: "POST",
        body: {
          logistics: {
            counts: n.logisticsCounts || {}
          },
          inventory: n.inventory || []
        }
      }
    );
    // Persist the edited profit-split alongside the compute pass.
    await api(`/api/npb/settlements/${encodeURIComponent(n.currentKey)}/profit-split`, {
      method: "PUT",
      body: {
        parties: n.profitParties.map((p) => ({
          party: p.party,
          ratio: Number(p.ratio || 0),
          excluded: !!p.excluded,
          note: p.note || ""
        }))
      }
    });
    if (computed) n.current = { ...n.current, ...computed };
    await npbReloadSettlements();
    showToast(`저장 및 계산 완료 · 이익 ${npbWon(computed?.rollup?.profit)}`);
    renderApp();
  } catch (error) {
    showToast(error.message || "계산 실패", "error");
  }
}

function bindNpbProfitInline() {
  const n = state.npb;
  const parties = n.profitParties;
  app.querySelectorAll("[data-npb-party]").forEach((inp) => {
    const i = Number(inp.dataset.npbParty);
    const f = inp.dataset.npbPfield;
    if (f === "excluded") {
      inp.addEventListener("change", (e) => {
        parties[i][f] = e.target.checked;
        renderApp();
      });
    } else if (f === "ratio") {
      inp.addEventListener("input", (e) => {
        parties[i][f] = Number(e.target.value);
      });
      inp.addEventListener("change", () => renderApp());
    } else {
      inp.addEventListener("input", (e) => {
        parties[i][f] = e.target.value;
      });
    }
  });
  app.querySelector("[data-npb-profit-seed]")?.addEventListener("click", async () => {
    try {
      const prev = npbPrevSettlement();
      if (!prev) return showToast("지난달 정산이 없습니다.", "error");
      const detail = await api(`/api/npb/settlements/${encodeURIComponent(prev.key)}`);
      const d = detail?.settlement || detail;
      n.profitParties = npbSeedParties(d?.profitSplit || d?.parties);
      showToast("지난달 분배를 불러왔습니다.");
      renderApp();
    } catch (error) {
      showToast(error.message || "불러오기 실패", "error");
    }
  });
}

function bindNpbChannels() {
  const n = state.npb;
  const channels = n.config?.channels || [];
  app.querySelectorAll("[data-npb-pr]").forEach((inp) => {
    inp.addEventListener("input", () => {
      const products = (n.config?.products || []).filter((p) => p.active !== false);
      const product = products[Number(inp.dataset.npbPr)];
      if (!product) return;
      product[inp.dataset.npbPf] = Number(inp.value || 0);
      const cell = inp.closest("tr")?.querySelectorAll("td")[5];
      if (cell) cell.textContent = money.format(Number(product.listPrice || 0) - Number(product.costPrice || 0));
    });
  });
  app.querySelectorAll("[data-npb-ch]").forEach((inp) => {
    inp.addEventListener("input", (e) => {
      const i = Number(inp.dataset.npbCh);
      const f = inp.dataset.npbCfield;
      const num = ["salePrice", "feeRate", "supplyPrice"].includes(f);
      if (f === "filenameKeywords") {
        channels[i][f] = e.target.value.split(",").map((k) => k.trim()).filter(Boolean);
      } else {
        channels[i][f] = num ? Number(e.target.value) : e.target.value;
      }
    });
  });
  app.querySelectorAll("[data-npb-ch-del]").forEach((btn) => {
    btn.addEventListener("click", () => {
      channels.splice(Number(btn.dataset.npbChDel), 1);
      renderApp();
    });
  });
  app.querySelector("[data-npb-ch-add]")?.addEventListener("click", () => {
    if (!n.config) n.config = {};
    if (!n.config.channels) n.config.channels = channels;
    n.config.channels.push({
      code: "",
      name: "",
      category: "",
      archetype: "",
      calcType: "",
      salePrice: 0,
      feeRate: 0,
      supplyPrice: 0,
      filenameKeywords: [],
      active: true
    });
    renderApp();
  });
  bindNpbCostConfig();
  app.querySelector("[data-npb-config-save]")?.addEventListener("click", async () => {
    try {
      await api("/api/npb/config", {
        method: "PUT",
        body: {
          brand: npbBrand(),
          channels: n.config?.channels || [],
          costConfig: n.config?.costConfig || {},
          products: n.config?.products || []
        }
      });
      showToast("채널 설정을 저장했습니다.");
    } catch (error) {
      showToast(error.message || "저장 실패", "error");
    }
  });
}

function bindNpbCostConfig() {
  const cost = state.npb.config?.costConfig;
  if (!cost) return;
  const coerce = (raw) => {
    const num = Number(raw);
    return raw !== "" && !Number.isNaN(num) && String(num) === raw.trim() ? num : raw;
  };
  app.querySelectorAll("[data-npb-cost]").forEach((inp) => {
    inp.addEventListener("input", (e) => {
      cost[inp.dataset.npbCost] = coerce(e.target.value);
    });
  });
  const tableKey = Object.keys(cost).find((k) => Array.isArray(cost[k]));
  if (!tableKey) return;
  app.querySelectorAll("[data-npb-3pl]").forEach((inp) => {
    inp.addEventListener("input", (e) => {
      const i = Number(inp.dataset.npb3pl);
      cost[tableKey][i][inp.dataset.npb3col] = coerce(e.target.value);
    });
  });
  app.querySelectorAll("[data-npb-3pl-del]").forEach((btn) => {
    btn.addEventListener("click", () => {
      cost[tableKey].splice(Number(btn.dataset.npb3plDel), 1);
      renderApp();
    });
  });
  app.querySelector("[data-npb-3pl-add]")?.addEventListener("click", () => {
    const arr = cost[tableKey];
    const shape = arr[0] ? Object.keys(arr[0]) : ["tier", "price"];
    const row = {};
    shape.forEach((k) => {
      row[k] = "";
    });
    arr.push(row);
    renderApp();
  });
}


function bindNpbPreview() {
  const n = state.npb;
  app.querySelectorAll("[data-npb-download]").forEach((btn) => {
    btn.addEventListener("click", () => npbDownloadXlsx(btn.dataset.npbDownload));
  });
  app.querySelector("[data-npb-finalize]")?.addEventListener("click", async () => {
    try {
      await api(`/api/npb/settlements/${encodeURIComponent(n.currentKey)}/finalize`, {
        method: "POST"
      });
      await npbReloadSettlements();
      await npbLoadDetail(n.currentKey);
      showToast("정산을 확정했습니다. 이 달의 기준이 고정됩니다.");
      renderApp();
    } catch (error) {
      showToast(error.message || "확정 실패", "error");
    }
  });
  app.querySelector("[data-npb-reopen]")?.addEventListener("click", async () => {
    if (!confirm("확정을 해제하면 지금의 기준(실비 단가·수수료율·정가)으로 다시 계산됩니다. 금액이 달라질 수 있습니다. 해제할까요?")) return;
    try {
      await api(`/api/npb/settlements/${encodeURIComponent(n.currentKey)}/reopen`, {
        method: "POST"
      });
      await npbReloadSettlements();
      await npbLoadDetail(n.currentKey);
      showToast("확정을 해제했습니다. 지금의 기준으로 다시 계산했습니다.");
      renderApp();
    } catch (error) {
      showToast(error.message || "확정 해제 실패", "error");
    }
  });
}

init().catch((error) => {
  app.innerHTML = `<main class="login"><section class="login-panel"><h1>앱 오류</h1><p>${h(error.message)}</p></section></main>`;
});

// =============================================================================
// 상품동기화 — 공급사(브랜드) 공식몰 ↔ 우프 카페24 상품 재고·가격 맞추기, 신상품 등록
// =============================================================================
// 서버: lib/product-sync-service.mjs. 오래 걸리는 일(본사 수집, 반영, 신규 등록)은
// 작업(job)으로 돌고, 화면은 2초마다 진행 상황을 묻는다.

const PS_ISSUE_LABELS = {
  soldout: ["품절 반영", "ps-red"],
  restock: ["재입고", "ps-green"],
  price: ["판매가", "ps-blue"],
  option_price: ["옵션 추가금", "ps-blue"],
  source_removed: ["본사 삭제", "ps-red"],
  source_unlisted: ["본사 진열 중단", "ps-gray"],
  option_unmatched: ["본사 옵션 짝 없음", "ps-yellow"],
  variant_unmatched: ["우프 옵션 짝 없음", "ps-yellow"],
  wooof_missing: ["우프 상품 없음", "ps-yellow"],
  source_unreadable: ["본사 읽기 실패", "ps-gray"],
  filter_empty: ["옵션 필터 확인", "ps-yellow"],
  option_text: ["옵션명", "ps-blue"]
};
const PS_NOTICE_LABELS = { name_changed: "상품명 변경", image_changed: "대표이미지 변경", options_changed: "옵션 구성 변경" };
const PS_HISTORY_LABELS = {
  run: "확인 실행", apply: "반영", auto_apply: "자동 반영", apply_failed: "반영 실패", dismiss: "무시", link: "연결", link_update: "연결 수정",
  unlink: "연결 해제", register: "신규 등록", settings: "설정", scan: "신상품 찾기"
};

function psState() {
  return state.productSync;
}

function psWooofUrl(no) {
  return `https://wooof.co.kr/product/detail.html?product_no=${encodeURIComponent(no)}`;
}

function psFmtTime(iso) {
  if (!iso) return "-";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "-";
  const kst = new Date(d.getTime() + 9 * 3600000).toISOString();
  return `${kst.slice(5, 10).replace("-", "/")} ${kst.slice(11, 16)}`;
}

function psFmtValue(value) {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value === "number") return `${money.format(value)}원`;
  return String(value);
}

function psMapToText(map) {
  return Object.entries(map || {}).map(([from, to]) => `${from} = ${to}`).join("\n");
}

function psTextToMap(text) {
  const out = {};
  for (const line of String(text || "").split("\n")) {
    const idx = line.indexOf("=");
    if (idx < 0) continue;
    const from = line.slice(0, idx).trim();
    const to = line.slice(idx + 1).trim();
    if (from && to) out[from] = to;
  }
  return out;
}

async function loadProductSync({ silent = false } = {}) {
  const ps = psState();
  if (ps.loading) return;
  ps.loading = true;
  if (!silent) renderApp();
  try {
    const [overview, detail] = await Promise.all([
      api("/api/product-sync"),
      api(`/api/product-sync/sources/${encodeURIComponent(ps.sourceId)}`)
    ]);
    ps.overview = overview;
    ps.detail = detail;
    ps.loadedAt = Date.now();
    ps.error = "";
    const valid = new Set((detail.issues || []).map((issue) => issue.key));
    ps.selected = ps.selected.filter((key) => valid.has(key));
    // 서버가 다시 시작되기 전까지 돌던 작업을 이어서 지켜본다.
    for (const job of overview.jobs || []) {
      if (job.status === "running" && !ps.jobs[psJobKey(job)]) watchProductSyncJob(job);
    }
  } catch (error) {
    ps.error = error.message;
  } finally {
    ps.loading = false;
    ps.loaded = true;
    if (state.tab === "productsync") renderApp();
  }
}

// 작업은 브랜드별로 따로 본다(뮤니쿤트 확인 중에 앤블랭크 화면이 그 진행을 보이지 않게).
function psJobKey(job) {
  return `${job.sourceId || ""}:${job.kind}`;
}

function psJob(kind) {
  const ps = psState();
  return ps.jobs[`${ps.sourceId}:${kind}`];
}

function watchProductSyncJob(job, { onDone } = {}) {
  const ps = psState();
  const key = psJobKey(job);
  ps.jobs[key] = job;
  if (state.tab === "productsync") renderApp();
  const tick = async () => {
    try {
      const { job: next } = await api(`/api/product-sync/jobs/${encodeURIComponent(job.id)}`);
      ps.jobs[key] = next;
      if (next.status === "running") {
        if (state.tab === "productsync") renderApp();
        setTimeout(tick, 2000);
        return;
      }
      if (next.status === "failed") showToast(next.error || "작업이 실패했습니다.", "error");
      if (onDone) onDone(next);
      await loadProductSync({ silent: true });
      setTimeout(() => {
        if (ps.jobs[key]?.id === next.id && next.status !== "running") {
          delete ps.jobs[key];
          if (state.tab === "productsync") renderApp();
        }
      }, next.status === "failed" ? 15000 : 6000);
    } catch (error) {
      ps.jobs[key] = { ...job, status: "failed", error: error.message };
      if (state.tab === "productsync") renderApp();
    }
  };
  setTimeout(tick, 1500);
}

function renderPsJob(kind) {
  const job = psJob(kind);
  if (!job) return "";
  const pct = job.progress?.total ? Math.round((job.progress.done / job.progress.total) * 100) : null;
  if (job.status === "running") {
    return `<div class="ps-job">
      <span class="ps-spinner"></span>
      <span>${h(job.message || "진행 중…")}</span>
      ${pct !== null ? `<div class="ps-progress"><div style="width:${pct}%"></div></div>` : ""}
    </div>`;
  }
  if (job.status === "failed") return `<div class="ps-job ps-job-failed">실패: ${h(job.error)}</div>`;
  return `<div class="ps-job ps-job-done">완료</div>`;
}

function renderProductSync() {
  const ps = psState();
  const detail = ps.detail;
  const head = pageHead("상품동기화",
    "공급사 공식몰의 품절·재입고·가격을 우프와 비교해 맞추고, 신상품을 미진열로 등록합니다. 매일 09시 자동 확인.");
  if (!ps.loaded) return `${head}<section class="panel"><div class="panel-body"><p class="muted">불러오는 중…</p></div></section>`;
  if (ps.error && !detail) {
    return `${head}<section class="panel"><div class="panel-body">${notice("danger", "불러오지 못했습니다", h(ps.error))}
      <button data-ps-reload>다시 불러오기</button></div></section>`;
  }
  const screen = ps.screen || "issues";
  const body = screen === "candidates" ? renderPsCandidates()
    : screen === "links" ? renderPsLinks()
      : screen === "settings" ? renderPsSettings()
        : renderPsIssues();
  return `${head}${renderPsBrandTabs()}${renderPsConnection()}${body}`;
}

// 브랜드(공급사)마다 연결표·본사 상태·설정이 따로다. 탭으로 바꿔 본다.
function renderPsBrandTabs() {
  const ps = psState();
  const sources = ps.overview?.sources || [];
  if (sources.length < 2) return "";
  return `<div class="ps-brands" role="tablist">${sources.map((src) => {
    const dismissed = src.dismissed || {};
    const count = (src.issues || []).filter((issue) => dismissed[issue.key] !== issue.fingerprint).length
      + (src.candidates || []).length;
    return `<button role="tab" class="${src.id === ps.sourceId ? "active" : ""}" data-ps-brand="${h(src.id)}">
      ${h(src.name)}${src.platform === "imweb" ? ` <span class="muted">아임웹</span>` : ""}
      ${count ? `<span class="ps-brand-count">${money.format(count)}</span>` : ""}</button>`;
  }).join("")}</div>`;
}

// 카페24 연결·권한 안내. 상품 권한이 없으면 확인(읽기)부터 막힌다.
function renderPsConnection() {
  const ov = psState().overview;
  if (!ov) return "";
  const c = ov.cafe24 || {};
  const problems = [];
  if (!c.configured) problems.push("카페24 연동 환경변수(CAFE24_MALL_ID 등)가 서버에 없습니다.");
  else if (!c.connected) problems.push("카페24가 연결되어 있지 않습니다. 아래 버튼으로 연결하세요.");
  else if (c.expired) problems.push("카페24 연결이 만료됐습니다. 아래 버튼으로 다시 연결하세요.");
  if (!ov.productScope) {
    problems.push(`카페24 상품 권한이 없습니다 (현재 요청 권한: ${h(ov.cafe24Scope || "-")}). 아래 순서로 켜 주세요:
      <ol class="ps-steps">
        <li>카페24 개발자센터 → 앱 → 권한 설정에서 <b>상품(Product) 읽기·쓰기</b>를 켜기</li>
        <li>Render 환경변수 <code>CAFE24_SCOPE</code>에 <code>mall.read_product,mall.write_product</code> 추가
          (예: <code>${h([ov.cafe24Scope || "mall.read_order", "mall.read_product", "mall.write_product"].join(","))}</code>)</li>
        <li>주문매칭 화면에서 카페24 <b>다시 연결</b></li>
      </ol>`);
  }
  const canConnect = c.configured && can("productsync", "apply");
  const connectButton = canConnect
    ? `<button class="${problems.length ? "primary" : ""}" data-ps-cafe24-connect>${c.connected ? "카페24 다시 연결" : "카페24 연결"}</button>`
    : "";
  if (!problems.length) {
    return `<div class="ps-conn muted">카페24 연결됨${c.mallId ? ` (${h(c.mallId)})` : ""}${c.connectedAt ? ` · ${psFmtTime(c.connectedAt)} 연결` : ""}
      ${c.refreshTokenExpiresAt ? ` · 갱신 기한 ${h(String(c.refreshTokenExpiresAt).slice(0, 10))}` : ""} ${connectButton}</div>`;
  }
  return `<div class="ps-warn-wrap">${notice("warn", "우프(카페24) 쪽 확인·반영이 아직 안 됩니다", `본사 수집과 신상품 후보는 지금도 볼 수 있습니다.<br>${problems.join("<br>")}`, connectButton || "")}</div>`;
}

function renderPsRunBar() {
  const detail = psState().detail;
  const last = detail?.lastRun;
  const running = psJob("run")?.status === "running" || Boolean(detail?.running);
  const lastText = last
    ? `마지막 재고 확인 ${psFmtTime(last.at)} (${last.trigger === "schedule" ? "자동" : h(last.by || "수동")}) ·
       본사 연결 상품 ${money.format(last.collectedCount || 0)}개 · 우프 ${money.format(last.wooofChecked || 0)}개 비교
       ${last.durationMs ? ` · ${Math.max(1, Math.round(last.durationMs / 1000))}초` : ""}
       ${last.failedCount ? ` · <span style="color:var(--red)">본사 읽기 실패 ${last.failedCount}개</span>` : ""}
       ${last.wooofError ? `<br><span style="color:var(--red)">우프 조회 실패: ${h(last.wooofError)}</span>` : ""}
       ${last.blocked ? `<br><span style="color:var(--red)">본사 사이트가 잠시 막아서 ${money.format(last.remaining || 0)}개는 이번에 못 읽었습니다(지난 값으로 비교).</span>` : ""}`
    : "아직 재고를 확인한 적이 없습니다.";
  return `<div class="ps-runbar">
    <div><strong>${h(detail?.name || "")}</strong> <a href="${h(detail?.baseUrl || "#")}" target="_blank" rel="noreferrer" class="muted">${h(detail?.baseUrl || "")} ↗</a>
      <div class="muted">${lastText}</div>
      <div class="muted">우프와 연결된 상품만 본사에서 다시 읽어 비교합니다. 매일 ${h((psState().overview?.runHoursKst || []).join("·"))}시 자동.</div></div>
    <div class="ps-runbar-actions">
      ${renderPsJob("run")}
      ${can("productsync", "apply")
        ? `<button class="primary" data-ps-run="stock" ${running ? "disabled" : ""}>${running ? "확인 중…" : "재고 확인하기"}</button>`
        : ""}
    </div>
  </div>`;
}

function renderPsScanBar() {
  const detail = psState().detail;
  const last = detail?.lastScan;
  const running = psJob("scan")?.status === "running" || Boolean(detail?.scanning);
  const lastText = last
    ? `마지막 신상품 찾기 ${psFmtTime(last.at)} (${last.trigger === "schedule" ? "자동" : h(last.by || "수동")}) ·
       본사 진열 ${money.format(last.listedCount || 0)}개 · 새로 읽음 ${money.format(last.fetchedCount || 0)}개
       ${last.failedCount ? ` · <span style="color:var(--red)">읽기 실패 ${last.failedCount}개</span>` : ""}
       ${last.blocked ? `<br><span style="color:var(--red)">본사 사이트가 잠시 막아서 ${money.format(last.remaining || 0)}개를 못 읽었습니다. 30분~1시간 뒤 다시 누르면 남은 것부터 이어서 읽습니다.</span>` : ""}`
    : "아직 본사 상품 목록을 읽은 적이 없습니다. 첫 실행은 본사 전체를 읽어서 몇 분(아임웹 브랜드는 10분 안팎) 걸립니다.";
  return `<div class="ps-runbar">
    <div><div class="muted">${lastText}</div>
      <div class="muted">본사 진열 목록을 훑고, 처음 보는 상품만 상세를 읽습니다. 매일 1회 자동.</div></div>
    <div class="ps-runbar-actions">
      ${renderPsJob("scan")}
      ${can("productsync", "apply")
        ? `<button class="primary" data-ps-run="scan" ${running ? "disabled" : ""}>${running ? "찾는 중…" : "신상품 찾기"}</button>`
        : ""}
    </div>
  </div>`;
}

function psDefaultCandFrom() {
  const days = Number(psState().detail?.recentDays) || 92;
  return new Date(Date.now() + 9 * 3600000 - days * 86400000).toISOString().slice(0, 10);
}

function psCandidates() {
  const ps = psState();
  const from = ps.candFrom || psDefaultCandFrom();
  const to = ps.candTo || "9999-12-31";
  return (ps.detail?.unlinked || [])
    .filter((u) => u.listed && !u.ignored)
    .filter((u) => {
      const date = u.registeredAt || String(u.firstSeenAt || "").slice(0, 10);
      return date && date >= from && date <= to;
    })
    .sort((a, b) => String(b.registeredAt).localeCompare(String(a.registeredAt)) || b.sourceNo - a.sourceNo);
}

function psFilteredIssues() {
  const ps = psState();
  const issues = ps.detail?.issues || [];
  if (ps.issueFilter === "all") return issues;
  if (ps.issueFilter === "info") return issues.filter((issue) => !issue.action);
  if (["soldout", "restock"].includes(ps.issueFilter)) return issues.filter((issue) => issue.type === ps.issueFilter);
  if (ps.issueFilter === "price") return issues.filter((issue) => issue.type === "price" || issue.type === "option_price");
  return issues.filter((issue) => issue.action);
}

function renderPsIssues() {
  const ps = psState();
  const detail = ps.detail || {};
  const all = detail.issues || [];
  const issues = psFilteredIssues();
  const count = (fn) => all.filter(fn).length;
  const chips = [
    ["action", "반영 가능", count((i) => i.action)],
    ["soldout", "품절", count((i) => i.type === "soldout")],
    ["restock", "재입고", count((i) => i.type === "restock")],
    ["price", "가격", count((i) => i.type === "price" || i.type === "option_price")],
    ["info", "확인만", count((i) => !i.action)],
    ["all", "전체", all.length]
  ];
  const selected = new Set(ps.selected);
  const canApply = can("productsync", "apply");
  const actionable = issues.filter((i) => i.action);
  let lastProduct = null;
  const rows = issues.map((issue) => {
    const [label, cls] = PS_ISSUE_LABELS[issue.type] || [issue.type, "ps-gray"];
    const sameProduct = lastProduct === issue.wooofProductNo;
    lastProduct = issue.wooofProductNo;
    // 같은 상품의 옵션이 이어지면 상품명을 흐리게 다시 적는다("〃"만 두면 빈 줄처럼 보인다).
    return `<tr class="${sameProduct ? "ps-cont" : ""}">
      <td>${issue.action && canApply ? `<input type="checkbox" data-ps-issue="${h(issue.key)}" ${selected.has(issue.key) ? "checked" : ""}>` : ""}</td>
      <td><span class="ps-badge ${cls}">${h(label)}</span></td>
      <td class="ps-opt">${h(issue.optionLabel || issue.wooofOptionLabel || "-")}</td>
      <td class="ps-change">${issue.from !== undefined ? `${h(psFmtValue(issue.from))} → <strong>${h(psFmtValue(issue.to))}</strong>` : ""}
        <div class="muted">${h(issue.message)}</div>
        ${issue.autoError ? `<div class="danger-text">자동 변경 실패: ${h(issue.autoError)}</div>` : ""}</td>
      <td>${sameProduct
        ? `<span class="muted">${h(issue.productName)}</span>`
        : `<a href="${psWooofUrl(issue.wooofProductNo)}" target="_blank" rel="noreferrer">${h(issue.productName)}</a>
        <div class="muted">우프 ${h(issue.wooofProductNo)} · 본사 <a href="${h(`${detail.baseUrl}/product/detail.html?product_no=${issue.sourceNo}`)}" target="_blank" rel="noreferrer">${h(issue.sourceNo)}</a>${issue.sourceFilter ? ` (${h(issue.sourceFilter)})` : ""}</div>`}</td>
    </tr>`;
  }).join("");
  const notices = detail.notices || [];
  return `
    <section class="panel">
      <div class="panel-body">${renderPsRunBar()}</div>
    </section>
    <section class="panel">
      <div class="panel-head">
        <h2>본사와 다른 점 ${all.length ? `<span class="muted">${all.length}건</span>` : ""}</h2>
        <div class="ps-chips">${chips.map(([key, label, n]) =>
          `<button class="ps-chip ${ps.issueFilter === key ? "active" : ""}" data-ps-filter="${key}">${label} <span>${n}</span></button>`).join("")}</div>
      </div>
      <div class="panel-body">
        ${!detail.lastRun ? `<p class="muted">아직 확인 결과가 없습니다. <b>재고 확인하기</b>를 누르면 우프와 연결된 본사 상품을 읽고 비교합니다.</p>`
          : !issues.length ? `<p class="muted">이 조건에 해당하는 항목이 없습니다.${ps.issueFilter === "action" ? " 우프가 본사와 같습니다." : ""}</p>`
            : `<div class="table-wrap" style="max-height:560px"><table class="ps-table">
              <thead><tr>
                <th>${canApply && actionable.length ? `<input type="checkbox" data-ps-issue-all ${actionable.every((i) => selected.has(i.key)) ? "checked" : ""}>` : ""}</th>
                <th>구분</th><th>옵션</th><th>우프 → 본사 기준</th><th>우프 상품</th>
              </tr></thead><tbody>${rows}</tbody></table></div>`}
        ${canApply && all.length ? `<div class="toolbar">
          ${renderPsJob("apply")}
          <button class="primary" data-ps-apply ${selected.size && psJob("apply")?.status !== "running" ? "" : "disabled"}>선택 ${selected.size}건 우프에 반영</button>
          <button data-ps-dismiss ${selected.size ? "" : "disabled"}>선택 무시</button>
          <span class="muted">품절 = 재고 0(품절표시), 재입고 = 재고 ${h(detail.restockQuantity || 99)}. 무시한 항목은 값이 또 바뀔 때만 다시 뜹니다.</span>
        </div>` : ""}
      </div>
    </section>
    ${notices.length ? `<section class="panel">
      <div class="panel-head"><h2>본사 변경 알림 <span class="muted">${notices.length}건</span></h2>
        ${canApply ? `<button data-ps-notices-clear>모두 확인</button>` : ""}</div>
      <div class="panel-body">
        <p class="muted">우프 상품명은 한글 번역명이라 자동으로 고치지 않습니다. 필요하면 우프 어드민에서 직접 수정하세요.</p>
        <div class="table-wrap" style="max-height:300px"><table class="ps-table">
          <thead><tr><th>구분</th><th>본사 상품</th><th>이전</th><th>지금</th><th>감지</th><th></th></tr></thead>
          <tbody>${notices.map((n) => `<tr>
            <td><span class="ps-badge ps-gray">${h(PS_NOTICE_LABELS[n.type] || n.type)}</span></td>
            <td><a href="${h(`${detail.baseUrl}/product/detail.html?product_no=${n.sourceNo}`)}" target="_blank" rel="noreferrer">${h(n.sourceNo)}</a></td>
            <td>${n.type === "image_changed" ? `<img src="${h(n.from)}" class="ps-thumb-sm" alt="">` : h(n.from)}</td>
            <td>${n.type === "image_changed" ? `<img src="${h(n.to)}" class="ps-thumb-sm" alt="">` : h(n.to)}</td>
            <td>${psFmtTime(n.at)}</td>
            <td>${canApply ? `<button data-ps-notice-clear="${h(n.id)}">확인</button>` : ""}</td>
          </tr>`).join("")}</tbody></table></div>
      </div></section>` : ""}
  `;
}

function renderPsCandidates() {
  const ps = psState();
  const detail = ps.detail || {};
  const candidates = psCandidates();
  const canApply = can("productsync", "apply");
  const registering = psJob("register")?.status === "running";
  const prefix = detail.namePrefix ? `${detail.namePrefix} ` : "";
  const cards = candidates.map((c) => {
    const soldOptions = (c.options || []).filter((o) => !o.selling).length;
    const name = ps.candidateNames[c.sourceNo] ?? (c.wooofName || `${prefix}${c.name}`);
    const optionText = (c.options || []).length
      ? `${(c.optionNames || []).join("×") || "옵션"} ${(c.options || []).length}개${soldOptions ? ` · 품절 ${soldOptions}` : ""}`
      : "단일상품";
    const hasNoteInOptions = (c.options || []).some((o) => /\(|\)/.test(o.label));
    const picked = (ps.candPicked || []).includes(String(c.sourceNo));
    return `<article class="ps-card ${picked ? "is-picked" : ""}">
      ${canApply ? `<label class="ps-pick" title="일괄 등록에 넣기"><input type="checkbox" data-ps-pick="${h(c.sourceNo)}" ${picked ? "checked" : ""} aria-label="${h(c.name)} 선택"></label>` : ""}
      <a href="${h(c.url)}" target="_blank" rel="noreferrer"><img src="${h(c.thumbnail)}" alt="" loading="lazy"></a>
      <div class="ps-card-body">
        <div class="muted">본사 ${h(c.sourceNo)} · 등록 ${h(c.registeredAt || "-")}${c.soldOut ? ` · <span style="color:var(--red)">전체 품절</span>` : ""}</div>
        <strong>${h(c.name)}</strong>
        <div>${money.format(c.price || 0)}원${c.salePrice && c.salePrice < c.price ? ` <span class="muted">(본사 할인가 ${money.format(c.salePrice)}원)</span>` : ""}</div>
        <div class="muted">${h(optionText)}</div>
        ${hasNoteInOptions ? `<div class="ps-note">옵션명에 본사 안내 문구가 들어 있습니다 (예: ${h((c.options.find((o) => /\(/.test(o.label)) || {}).label || "")}). 등록 후 우프 어드민에서 정리하세요.</div>` : ""}
        ${canApply ? `
          <label class="muted" style="margin-top:6px">우프 상품명</label>
          <input data-ps-cand-name="${h(c.sourceNo)}" value="${h(name)}">
          <div class="toolbar">
            <button class="primary" data-ps-register="${h(c.sourceNo)}" ${registering ? "disabled" : ""}>미진열로 등록</button>
            <button data-ps-link-existing="${h(c.sourceNo)}">이미 우프에 있음</button>
            <button class="ghost" data-ps-ignore="${h(c.sourceNo)}">등록 안 함</button>
          </div>` : ""}
      </div>
    </article>`;
  }).join("");
  const ignored = (detail.unlinked || []).filter((u) => u.ignored);
  return `
    <section class="panel">
      <div class="panel-body">${renderPsScanBar()}</div>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>신상품 후보 <span class="muted">${candidates.length}개</span></h2>
        <div class="ps-datefilter">
          <label class="muted">본사 등록일</label>
          <input type="date" data-ps-cand-from value="${h(ps.candFrom || psDefaultCandFrom())}">
          <span class="muted">~</span>
          <input type="date" data-ps-cand-to value="${h(ps.candTo)}">
          ${ps.candFrom || ps.candTo ? `<button class="ghost" data-ps-cand-reset>기본(최근 ${h(detail.recentDays || 92)}일)</button>` : ""}
        </div>
      </div>
      <div class="panel-body">
        ${helpNote(`기준: 우프에 연결되지 않은 본사 진열 상품 중 본사 등록일(상세이미지 날짜로 추정)이 위 기간 안인 것.
          등록하면 <b>미진열</b>로 올라가고 <b>기본몰에서만 판매</b>합니다(다른 쇼핑몰은 판매 안 함). 판매가는 본사 정가, 옵션 추가금·품절은 본사와 같게,
          공급사·원산지·공급가 비율은 기존 MUNIKUND 상품에서 복사하고, 분류는 기존 상품들의 <b>공통 분류(브랜드관 등)만</b> 넣습니다 — 상품 종류별 분류는 직접 지정하세요.
          흰 배경 누끼 썸네일은 #${h(detail.thumbnailMultiply || "F7F7F7")} multiply 처리합니다.`)}
        ${renderPsJob("register")}
        ${psJob("register")?.status === "done" && psJob("register").result ? renderPsRegisterResult(psJob("register").result) : ""}
        ${canApply && candidates.length ? (() => {
          const picked = (ps.candPicked || []).filter((no) => candidates.some((c) => String(c.sourceNo) === no));
          return `<div class="bulk-bar ${picked.length ? "is-active" : ""}">
            <label class="inline-field"><input type="checkbox" data-ps-pick-all ${picked.length && picked.length === candidates.length ? "checked" : ""} aria-label="모두 선택"><span>모두 선택</span></label>
            <span class="bulk-count">${picked.length ? `<b>${picked.length}개 선택</b>` : "여러 상품을 골라 한 번에 등록할 수 있습니다"}</span>
            <span class="bulk-spacer"></span>
            <button class="primary" data-ps-register-many ${picked.length && !registering ? "" : "disabled"}>선택한 ${picked.length}개 미진열로 등록</button>
          </div>`;
        })() : ""}
        ${!detail.lastScan && !(detail.unlinked || []).length ? `<p class="muted">위의 <b>신상품 찾기</b>를 먼저 실행하세요.</p>`
          : candidates.length ? `<div class="ps-cards">${cards}</div>` : `<p class="muted">이 기간에 새로 등록할 상품이 없습니다.</p>`}
        ${ignored.length ? `<details style="margin-top:12px"><summary class="muted">등록 안 함으로 넘긴 상품 ${ignored.length}개</summary>
          <ul class="ps-plain">${ignored.map((u) => `<li>${h(u.sourceNo)} ${h(u.name)} ${canApply ? `<button class="ghost" data-ps-unignore="${h(u.sourceNo)}">되돌리기</button>` : ""}</li>`).join("")}</ul>
        </details>` : ""}
      </div>
    </section>`;
}

function renderPsRegisterResult(result) {
  if (result.many) {
    const warnCount = (result.done || []).reduce((n, d) => n + (d.warnings || []).length, 0);
    return `<div class="ps-result">
      <strong>${(result.done || []).length}개 등록 완료 (미진열)${(result.failed || []).length ? ` · 실패 ${result.failed.length}개` : ""}</strong>
      <ul>${(result.done || []).map((d) => `<li>우프 상품 ${h(d.productNo)} — ${h(d.productName || "")}${(d.warnings || []).length ? ` <span class="muted">(확인할 점 ${d.warnings.length}건)</span>` : ""}</li>`).join("")}</ul>
      ${(result.failed || []).length ? notice("danger", `등록 실패 ${result.failed.length}개`, result.failed.map((f) => `본사 ${h(f.sourceNo)} ${h(f.productName || "")}: ${h(f.error)}`).join("<br>")) : ""}
      ${warnCount ? notice("warn", `확인할 점 ${warnCount}건`, (result.done || []).flatMap((d) => (d.warnings || []).map((w) => `${h(d.productNo)}: ${h(w)}`)).join("<br>")) : ""}
      <div class="muted">카페24 어드민 → 상품 목록에서 확인한 뒤 진열하세요.</div>
    </div>`;
  }
  return `<div class="ps-result">
    <strong>우프 상품 ${h(result.productNo)} 등록 완료 (미진열)</strong>
    <ul>${(result.steps || []).map((s) => `<li>${h(s)}</li>`).join("")}</ul>
    ${(result.warnings || []).length ? notice("warn", `확인할 점 ${result.warnings.length}건`, result.warnings.map(h).join("<br>")) : ""}
    <div class="muted">카페24 어드민 → 상품 목록에서 상품번호 ${h(result.productNo)}을(를) 확인한 뒤 진열하세요.</div>
  </div>`;
}

function renderPsLinks() {
  const ps = psState();
  const detail = ps.detail || {};
  const links = detail.links || [];
  const canApply = can("productsync", "apply");
  const form = ps.linkForm;
  const rows = links.map((link) => `<tr>
    <td><a href="${psWooofUrl(link.wooofProductNo)}" target="_blank" rel="noreferrer">${h(link.wooofProductNo)}</a></td>
    <td>${h(link.wooofName || "-")}${link.note ? `<div class="ps-note">${h(link.note)}</div>` : ""}</td>
    <td><a href="${h(link.sourceUrl)}" target="_blank" rel="noreferrer">${h(link.sourceNo)}</a></td>
    <td>${h(link.sourceName || "-")}${link.sourceFilter ? `<div class="muted">옵션 필터: ${h(link.sourceFilter)}</div>` : ""}
      ${link.sourceMissing ? `<span class="ps-badge ps-red">본사 삭제</span>` : !link.sourceListed ? `<span class="ps-badge ps-gray">본사 진열 중단</span>` : ""}
      ${link.sourceSoldOut ? `<span class="ps-badge ps-red">본사 전체 품절</span>` : ""}</td>
    <td class="num">${link.issueCount ? `<a href="#" data-ps-goto-issues>${link.issueCount}건</a>` : `<span class="muted">0</span>`}</td>
    <td>${canApply ? `<button data-ps-link-edit="${h(link.wooofProductNo)}">수정·확인</button>` : ""}</td>
  </tr>`).join("");
  return `
    ${form ? renderPsLinkForm() : ""}
    ${renderPsSuggestions()}
    <section class="panel">
      <div class="panel-head"><h2>상품 연결표 <span class="muted">${links.length}개</span></h2>
        <div class="toolbar">
          ${canApply ? `<button data-ps-suggest ${ps.suggest?.loading ? "disabled" : ""}>${ps.suggest?.loading ? "찾는 중…" : "우프 기존 상품 자동 연결 찾기"}</button>` : ""}
          ${canApply ? `<button class="primary" data-ps-link-new>연결 추가</button>` : ""}
        </div></div>
      <div class="panel-body">
        ${helpNote(`우프 상품 하나가 본사 상품 하나에 대응합니다. 본사 한 상품(색상×사이즈)을 우프에서 색상별로 나눠 올렸으면 <b>옵션 필터</b>에 그 색상(예: M-Band Yellow)을 적습니다.
          옵션값 번역(Bloom Blue → 블룸 블루)은 설정의 번역표를 씁니다.`)}
        <div class="table-wrap" style="max-height:620px"><table class="ps-table">
          <thead><tr><th>우프</th><th>우프 상품명</th><th>본사</th><th>본사 상품명</th><th>확인필요</th><th></th></tr></thead>
          <tbody>${rows}</tbody></table></div>
        ${renderPsUnlinked()}
      </div>
    </section>`;
}

const PS_CONFIDENCE = {
  exact: ["이름 일치", "ps-green"],
  option: ["옵션으로 나눔", "ps-green"],
  similar: ["비슷한 이름", "ps-gray"]
};

function renderPsSuggestions() {
  const ps = psState();
  const sg = ps.suggest;
  if (!sg || sg.sourceId !== ps.sourceId) return "";
  if (sg.error) {
    return `<section class="panel ps-warn"><div class="panel-body">${h(sg.error)} <button data-ps-suggest-close>닫기</button></div></section>`;
  }
  if (!sg.data) return "";
  const d = sg.data;
  const picked = sg.picked || new Set();
  const rows = d.suggestions.map((s) => {
    const [label, cls] = PS_CONFIDENCE[s.confidence] || PS_CONFIDENCE.similar;
    return `<tr>
      <td><input type="checkbox" data-ps-suggest-pick="${h(s.wooofProductNo)}" ${picked.has(s.wooofProductNo) ? "checked" : ""}></td>
      <td><a href="${psWooofUrl(s.wooofProductNo)}" target="_blank" rel="noreferrer">${h(s.wooofProductNo)}</a></td>
      <td>${h(s.wooofName)}${s.wooofDisplay === "F" ? ` <span class="ps-badge ps-gray">미진열</span>` : ""}</td>
      <td><a href="${h(s.sourceUrl)}" target="_blank" rel="noreferrer">${h(s.sourceNo)}</a></td>
      <td>${h(s.sourceName)}${s.sourceFilter ? `<div class="muted">옵션 필터: ${h(s.sourceFilter)}</div>` : ""}</td>
      <td><span class="ps-badge ${cls}">${label}</span>${s.confidence === "similar" ? ` <span class="muted">${Math.round(s.score * 100)}%</span>` : ""}</td>
    </tr>`;
  }).join("");
  return `<section class="panel" data-ps-suggest-panel>
    <div class="panel-head"><h2>자동 연결 추천 <span class="muted">${d.suggestions.length}개</span></h2>
      <div class="toolbar">
        <button data-ps-suggest-close>닫기</button>
        <button class="primary" data-ps-suggest-save ${picked.size && !sg.saving ? "" : "disabled"}>선택 ${picked.size}개 연결하고 재고 확인</button>
      </div></div>
    <div class="panel-body">
      <p class="muted">우프에서 이름이 "${h(ps.detail?.namePrefix || "")}"로 시작하는 상품 ${money.format(d.wooofCount)}개를 본사 상품 ${money.format(d.sourceCount)}개와 이름으로 맞춰 봤습니다.
        ${d.alreadyLinked ? `이미 연결된 ${money.format(d.alreadyLinked)}개는 뺐습니다.` : ""}
        <b>이름 일치·옵션으로 나눔</b>은 미리 골라 두었고, <b>비슷한 이름</b>은 본사 링크를 열어 확인한 뒤 고르세요.</p>
      ${!d.sourceCount ? notice("warn", "본사 상품을 아직 읽지 않았습니다", "신상품 등록 화면에서 <b>신상품 찾기</b>를 먼저 한 번 돌려 주세요.") : ""}
      ${rows ? `<div class="table-wrap" style="max-height:520px"><table class="ps-table">
        <thead><tr><th><input type="checkbox" data-ps-suggest-all ${picked.size === d.suggestions.length ? "checked" : ""}></th><th>우프</th><th>우프 상품명</th><th>본사</th><th>본사 상품명</th><th>근거</th></tr></thead>
        <tbody>${rows}</tbody></table></div>` : ""}
      ${d.unmatched.length ? `<details style="margin-top:12px"><summary class="muted">짝을 못 찾은 우프 상품 ${d.unmatched.length}개 (본사에서 내렸거나 이름이 많이 다름 — 필요하면 "연결 추가"로 직접)</summary>
        <ul class="ps-plain">${d.unmatched.map((w) => `<li><a href="${psWooofUrl(w.wooofProductNo)}" target="_blank" rel="noreferrer">${h(w.wooofProductNo)}</a> ${h(w.wooofName)}</li>`).join("")}</ul></details>` : ""}
    </div></section>`;
}

function renderPsUnlinked() {
  const ps = psState();
  const unlinked = (ps.detail?.unlinked || []).filter((u) => u.listed);
  if (!unlinked.length) return "";
  return `<details style="margin-top:12px" ${ps.showUnlinked ? "open" : ""} data-ps-unlinked-toggle>
    <summary class="muted">우프에 연결되지 않은 본사 상품 ${unlinked.length}개</summary>
    <div class="table-wrap" style="max-height:360px;margin-top:8px"><table class="ps-table">
      <thead><tr><th>본사</th><th>상품명</th><th class="num">정가</th><th>등록(추정)</th><th></th></tr></thead>
      <tbody>${unlinked.map((u) => `<tr>
        <td><a href="${h(u.url)}" target="_blank" rel="noreferrer">${h(u.sourceNo)}</a></td>
        <td>${h(u.name)}${u.soldOut ? ` <span class="ps-badge ps-red">품절</span>` : ""}${u.ignored ? ` <span class="ps-badge ps-gray">등록 안 함</span>` : ""}</td>
        <td class="num">${money.format(u.price || 0)}</td>
        <td>${h(u.registeredAt || "-")}</td>
        <td>${can("productsync", "apply") ? `<button data-ps-link-existing="${h(u.sourceNo)}">우프 상품과 연결</button>` : ""}</td>
      </tr>`).join("")}</tbody></table></div>
  </details>`;
}

function renderPsLinkForm() {
  const ps = psState();
  const f = ps.linkForm;
  const check = ps.linkCheck;
  const search = ps.linkSearch;
  return `<section class="panel ps-form">
    <div class="panel-head"><h2>${f.existing ? `연결 수정 — 우프 ${h(f.wooofProductNo)}` : "연결 추가"}</h2>
      <button class="ghost" data-ps-link-close>닫기</button></div>
    <div class="panel-body">
      <form data-ps-link-form>
        <div class="field two">
          <div><label>우프 상품번호</label><input name="wooofProductNo" value="${h(f.wooofProductNo || "")}" ${f.existing ? "readonly" : ""} required></div>
          <div><label>본사 상품번호</label><input name="sourceNo" value="${h(f.sourceNo || "")}" required></div>
        </div>
        ${!f.existing ? `<div class="ps-search">
          <input data-ps-search-q placeholder="우프 상품명으로 찾기 (예: 뮤니쿤트 써멀업)" value="${h(search?.q || "")}">
          <button type="button" data-ps-search>찾기</button>
          ${search?.loading ? `<span class="muted">찾는 중…</span>` : ""}
          ${search?.error ? `<span style="color:var(--red)">${h(search.error)}</span>` : ""}
          ${(search?.results || []).length ? `<ul class="ps-plain">${search.results.map((p) => `<li>
            <button type="button" class="ghost" data-ps-search-pick="${h(p.product_no)}">선택</button>
            ${h(p.product_no)} · ${h(p.product_name)} <span class="muted">${money.format(p.price || 0)}원 · ${p.display === "T" ? "진열" : "미진열"}</span></li>`).join("")}</ul>` : ""}
        </div>` : ""}
        <div class="field"><label>옵션 필터 <span class="muted">(본사 한 상품을 우프가 색상별로 나눴을 때만. 예: M-Band Yellow)</span></label>
          <input name="sourceFilter" value="${h(f.sourceFilter || "")}"></div>
        <div class="field two">
          <div><label>옵션 대응표 <span class="muted">(짝이 안 맞을 때만, 한 줄에 "본사 옵션 = 우프 옵션")</span></label>
            <textarea name="optionMap" rows="3" placeholder="L  (10/21 순차배송) = L">${h(psMapToText(f.optionMap))}</textarea></div>
          <div><label>옵션값 번역 <span class="muted">(이 상품에만 쓰는 번역, 한 줄에 "본사 = 우프")</span></label>
            <textarea name="valueMap" rows="3" placeholder="Pale Blue = 페일 블루">${h(psMapToText(f.valueMap))}</textarea></div>
        </div>
        <div class="field"><label>메모</label><input name="note" value="${h(f.note || "")}"></div>
        <div class="toolbar">
          <button class="primary" type="submit" ${f.saving ? "disabled" : ""}>${f.saving ? "저장 중…" : "저장하고 비교해 보기"}</button>
          ${f.existing ? `<button type="button" data-ps-link-check>저장 없이 비교</button>
            <button type="button" class="danger" data-ps-link-remove="${h(f.wooofProductNo)}">연결 해제</button>` : ""}
        </div>
      </form>
      ${check ? renderPsLinkCheck(check) : ""}
    </div>
  </section>`;
}

function renderPsLinkCheck(check) {
  if (check.loading) return `<p class="muted">비교 중…</p>`;
  if (check.error || check.wooofError) return notice("danger", "확인하지 못했습니다", h(check.error || check.wooofError));
  const pairs = check.pairs || [];
  return `<div class="ps-result">
    <strong>${h(check.wooof?.product_name || "")}</strong> ↔ <strong>${h(check.snap?.name || "")}</strong>
    <div class="muted">옵션 짝 ${pairs.length}개${(check.unmatchedSource || []).length ? ` · 본사만 있음 ${check.unmatchedSource.length}` : ""}${(check.unmatchedWooof || []).length ? ` · 우프만 있음 ${check.unmatchedWooof.length}` : ""}
      · 확인필요 ${(check.issues || []).length}건</div>
    <div class="table-wrap" style="max-height:260px;margin-top:6px"><table class="ps-table">
      <thead><tr><th>본사 옵션</th><th>우프 옵션</th></tr></thead>
      <tbody>
        ${pairs.map((p) => `<tr><td>${h(p.source)}</td><td>${h(p.wooof)}</td></tr>`).join("")}
        ${(check.unmatchedSource || []).map((label) => `<tr><td>${h(label)}</td><td><span class="ps-badge ps-yellow">짝 없음</span></td></tr>`).join("")}
        ${(check.unmatchedWooof || []).map((label) => `<tr><td><span class="ps-badge ps-yellow">짝 없음</span></td><td>${h(label)}</td></tr>`).join("")}
      </tbody></table></div>
    ${(check.issues || []).filter((i) => i.action).length ? `<div class="muted" style="margin-top:6px">반영할 항목은 <b>확인 필요</b> 화면에 올라가 있습니다.</div>` : ""}
  </div>`;
}

function renderPsSettings() {
  const ps = psState();
  const d = ps.detail || {};
  const ov = ps.overview || {};
  const canApply = can("productsync", "apply");
  const history = d.history || [];
  return `
    <section class="panel">
      <div class="panel-head"><h2>${h(d.name || "")} 설정</h2></div>
      <div class="panel-body">
        <form data-ps-settings>
          <div class="field two">
            <div><label>우프 상품명 앞에 붙일 브랜드명</label><input name="namePrefix" value="${h(d.namePrefix || "")}"></div>
            <div><label>재입고 때 넣을 재고 수량 <span class="muted">(본사 실제 수량은 공개되지 않음)</span></label><input name="restockQuantity" type="number" min="1" value="${h(d.restockQuantity || 99)}"></div>
          </div>
          <div class="field two">
            <div><label>신상품 기준 (본사 등록 후 며칠 이내)</label><input name="recentDays" type="number" min="1" value="${h(d.recentDays || 92)}"></div>
            <div><label>기준 상품번호 <span class="muted">(공급사·카테고리·공급가 비율 복사. 비우면 연결된 최근 상품)</span></label><input name="templateProductNo" value="${h(d.templateProductNo || "")}"></div>
          </div>
          <div class="field two">
            <div><label>썸네일 multiply 색 (흰 배경 누끼만)</label><input name="thumbnailMultiply" value="${h(d.thumbnailMultiply || "F7F7F7")}"></div>
            <div><label>본사 진열 카테고리 번호</label><input name="categoryNos" value="${h((d.categoryNos || []).join(", "))}"></div>
          </div>
          <div class="field two">
            <div><label>자동 확인 시각 (한국시간, 쉼표로)</label><input name="runHoursKst" value="${h((ov.runHoursKst || []).join(", "))}"></div>
            <div><label>자동 확인</label><label class="ps-inline"><input type="checkbox" name="enabled" ${d.enabled ? "checked" : ""}> 사용</label></div>
          </div>
          <div class="field"><label>옵션값 번역표 <span class="muted">(브랜드 공통, 한 줄에 "본사 = 우프")</span></label>
            <textarea name="valueMap" rows="6">${h(psMapToText(d.valueMap))}</textarea></div>
          ${canApply ? `<div class="toolbar"><button class="primary" type="submit">설정 저장</button></div>` : ""}
        </form>
      </div>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>기록 <span class="muted">최근 ${history.length}건</span></h2></div>
      <div class="panel-body">
        <div class="table-wrap" style="max-height:480px"><table class="ps-table">
          <thead><tr><th>시각</th><th>구분</th><th>내용</th><th>작업자</th></tr></thead>
          <tbody>${history.map((item) => `<tr>
            <td>${psFmtTime(item.at)}</td>
            <td><span class="ps-badge ${item.type === "apply_failed" ? "ps-red" : "ps-gray"}">${h(PS_HISTORY_LABELS[item.type] || item.type)}</span></td>
            <td>${item.wooofProductNo ? `<a href="${psWooofUrl(item.wooofProductNo)}" target="_blank" rel="noreferrer">우프 ${h(item.wooofProductNo)}</a> · ` : ""}${h(item.summary || "")}</td>
            <td>${h(item.by || "")}</td>
          </tr>`).join("")}</tbody></table></div>
      </div>
    </section>`;
}

function openPsLinkForm(values) {
  const ps = psState();
  ps.linkForm = { valueMap: {}, optionMap: {}, ...values };
  ps.linkCheck = null;
  ps.linkSearch = null;
  ps.screen = "links";
  renderApp();
  requestAnimationFrame(() => app.querySelector("[data-ps-link-form]")?.scrollIntoView({ behavior: "smooth", block: "start" }));
}

function bindProductSync() {
  const ps = psState();
  if (!ps.loaded && !ps.loading) {
    loadProductSync();
    return;
  }
  // 다른 메뉴에 갔다가 돌아오면 그사이 자동 확인 결과가 있을 수 있다.
  if (!ps.loading && Date.now() - (ps.loadedAt || 0) > 60000) loadProductSync({ silent: true });
  const on = (selector, event, handler) => app.querySelectorAll(selector).forEach((el) => el.addEventListener(event, handler));
  const sourcePath = `/api/product-sync/sources/${encodeURIComponent(ps.sourceId)}`;

  on("[data-ps-reload]", "click", () => loadProductSync());
  on("[data-ps-brand]", "click", (event) => {
    const next = event.currentTarget.dataset.psBrand;
    if (!next || next === ps.sourceId) return;
    ps.sourceId = next;
    ps.selected = [];
    ps.linkForm = null;
    ps.detail = null;
    try { localStorage.setItem("wooofpay.productSync.source", next); } catch {}
    loadProductSync();
  });
  on("[data-ps-suggest]", "click", async () => {
    const sourceId = ps.sourceId;
    ps.suggest = { sourceId, loading: true };
    renderApp();
    try {
      const data = await api(`${sourcePath}/link-suggestions`);
      ps.suggest = {
        sourceId,
        data,
        picked: new Set(data.suggestions.filter((s) => s.confidence !== "similar").map((s) => s.wooofProductNo))
      };
    } catch (error) {
      ps.suggest = { sourceId, error: error.message };
    }
    renderApp();
  });
  on("[data-ps-suggest-close]", "click", () => {
    ps.suggest = null;
    renderApp();
  });
  on("[data-ps-suggest-pick]", "change", (event) => {
    const no = Number(event.currentTarget.dataset.psSuggestPick);
    if (event.currentTarget.checked) ps.suggest.picked.add(no);
    else ps.suggest.picked.delete(no);
    renderApp();
  });
  on("[data-ps-suggest-all]", "change", (event) => {
    ps.suggest.picked = event.currentTarget.checked
      ? new Set(ps.suggest.data.suggestions.map((s) => s.wooofProductNo))
      : new Set();
    renderApp();
  });
  on("[data-ps-suggest-save]", "click", async () => {
    const sg = ps.suggest;
    const items = sg.data.suggestions
      .filter((s) => sg.picked.has(s.wooofProductNo))
      .map((s) => ({ wooofProductNo: s.wooofProductNo, sourceNo: s.sourceNo, sourceFilter: s.sourceFilter, wooofName: s.wooofName }));
    sg.saving = true;
    renderApp();
    try {
      const result = await api(`${sourcePath}/links/bulk`, { method: "POST", body: { items } });
      showToast(`${result.saved}개 연결했습니다. 이어서 재고 확인을 돌립니다.`);
      ps.suggest = null;
      if (result.job) {
        watchProductSyncJob(result.job, {
          onDone: (done) => {
            if (done.status === "done") showToast(`재고 확인 완료 — 확인필요 ${done.result?.issueCount ?? 0}건`);
          }
        });
      }
      await loadProductSync({ silent: true });
    } catch (error) {
      sg.saving = false;
      showToast(error.message, "error");
      renderApp();
    }
  });
  on("[data-ps-cafe24-connect]", "click", async () => {
    try {
      const { authorizeUrl } = await api("/api/cafe24/connect", { method: "POST", body: { returnTo: "productsync" } });
      window.location.href = authorizeUrl;
    } catch (error) {
      showToast(error.message || "카페24 연결 준비 실패", "error");
    }
  });
  on("[data-ps-run]", "click", async (event) => {
    const mode = event.currentTarget.dataset.psRun === "scan" ? "scan" : "stock";
    try {
      const { job } = await api(`${sourcePath}/run`, { method: "POST", body: { mode } });
      watchProductSyncJob(job, {
        onDone: (done) => {
          if (done.status !== "done") return;
          if (mode === "scan") showToast(`신상품 찾기 완료 — 처음 본 상품 ${done.result?.newCount ?? 0}개`);
          else showToast(`재고 확인 완료 — 확인필요 ${done.result?.issueCount ?? 0}건`);
        }
      });
    } catch (error) {
      showToast(error.message, "error");
    }
  });
  on("[data-ps-filter]", "click", (event) => {
    ps.issueFilter = event.currentTarget.dataset.psFilter;
    renderApp();
  });
  on("[data-ps-issue]", "change", (event) => {
    const key = event.currentTarget.dataset.psIssue;
    const set = new Set(ps.selected);
    if (event.currentTarget.checked) set.add(key);
    else set.delete(key);
    ps.selected = [...set];
    renderApp();
  });
  on("[data-ps-issue-all]", "change", (event) => {
    const keys = psFilteredIssues().filter((i) => i.action).map((i) => i.key);
    const set = new Set(ps.selected);
    for (const key of keys) {
      if (event.currentTarget.checked) set.add(key);
      else set.delete(key);
    }
    ps.selected = [...set];
    renderApp();
  });
  on("[data-ps-apply]", "click", async () => {
    const keys = [...ps.selected];
    if (!keys.length) return;
    const issues = (ps.detail?.issues || []).filter((i) => keys.includes(i.key));
    const products = new Set(issues.map((i) => i.wooofProductNo)).size;
    if (!confirm(`우프 상품 ${products}개, ${keys.length}건을 카페24에 반영합니다.\n반영 직전에 본사·우프를 다시 확인해서, 그사이 바뀐 항목은 건너뜁니다.`)) return;
    try {
      const items = issues.map((i) => ({ key: i.key, fingerprint: i.fingerprint }));
      const { job } = await api(`${sourcePath}/apply`, { method: "POST", body: { items } });
      ps.selected = [];
      watchProductSyncJob(job, {
        onDone: (done) => {
          if (done.status !== "done") return;
          const failed = done.result?.failed || [];
          const skipped = done.result?.skipped || [];
          const parts = [`반영 ${done.result.applied}건`];
          if (skipped.length) parts.push(`건너뜀 ${skipped.length}건(다시 확인해 보니 바뀜)`);
          if (failed.length) parts.push(`실패 ${failed.length}건`);
          showToast(parts.join(" · "), failed.length ? "error" : "success");
        }
      });
    } catch (error) {
      showToast(error.message, "error");
    }
  });
  on("[data-ps-dismiss]", "click", async () => {
    const keys = [...ps.selected];
    if (!keys.length || !confirm(`${keys.length}건을 무시합니다. 값이 또 바뀌면 다시 표시됩니다.`)) return;
    try {
      await api(`${sourcePath}/dismiss`, { method: "POST", body: { keys } });
      ps.selected = [];
      await loadProductSync({ silent: true });
    } catch (error) {
      showToast(error.message, "error");
    }
  });
  on("[data-ps-notices-clear]", "click", async () => {
    await api(`${sourcePath}/notices/clear`, { method: "POST", body: { ids: [] } }).catch((e) => showToast(e.message, "error"));
    loadProductSync({ silent: true });
  });
  on("[data-ps-notice-clear]", "click", async (event) => {
    await api(`${sourcePath}/notices/clear`, { method: "POST", body: { ids: [event.currentTarget.dataset.psNoticeClear] } }).catch((e) => showToast(e.message, "error"));
    loadProductSync({ silent: true });
  });

  // 신상품
  on("[data-ps-cand-from]", "change", (event) => {
    ps.candFrom = event.currentTarget.value;
    renderApp();
  });
  on("[data-ps-cand-to]", "change", (event) => {
    ps.candTo = event.currentTarget.value;
    renderApp();
  });
  on("[data-ps-cand-reset]", "click", () => {
    ps.candFrom = "";
    ps.candTo = "";
    renderApp();
  });
  on("[data-ps-cand-name]", "input", (event) => {
    ps.candidateNames[event.currentTarget.dataset.psCandName] = event.currentTarget.value;
  });
  on("[data-ps-pick]", "change", (event) => {
    const no = event.currentTarget.dataset.psPick;
    const set = new Set(ps.candPicked || []);
    if (event.currentTarget.checked) set.add(no); else set.delete(no);
    ps.candPicked = [...set];
    renderApp();
  });
  on("[data-ps-pick-all]", "change", (event) => {
    ps.candPicked = event.currentTarget.checked ? psCandidates().map((c) => String(c.sourceNo)) : [];
    renderApp();
  });
  on("[data-ps-register-many]", "click", async () => {
    const picked = (ps.candPicked || []).filter((no) => psCandidates().some((c) => String(c.sourceNo) === no));
    const items = picked.map((no) => ({ sourceNo: no, productName: (app.querySelector(`[data-ps-cand-name="${no}"]`)?.value || "").trim() }));
    const empty = items.filter((it) => !it.productName);
    if (empty.length) { showToast(`우프 상품명이 빈 상품이 ${empty.length}개 있습니다.`, "error"); return; }
    if (!confirm(`${items.length}개 상품을 우프에 미진열로 등록합니다.\n하나에 1~2분씩, 차례로 등록합니다(약 ${items.length * 2}분). 등록하는 동안 이 화면을 닫아도 계속됩니다.`)) return;
    try {
      const { job } = await api(`${sourcePath}/candidates/register-many`, { method: "POST", body: { items } });
      ps.candPicked = [];
      watchProductSyncJob(job, {
        onDone: (done) => {
          if (done.status === "done") showToast(`${done.result?.done?.length || 0}개 등록 완료 (미진열)${done.result?.failed?.length ? ` · 실패 ${done.result.failed.length}개` : ""}`, done.result?.failed?.length ? "error" : "");
        }
      });
    } catch (error) {
      showToast(error.message, "error");
    }
  });
  on("[data-ps-register]", "click", async (event) => {
    const sourceNo = event.currentTarget.dataset.psRegister;
    const input = app.querySelector(`[data-ps-cand-name="${sourceNo}"]`);
    const productName = (input?.value || "").trim();
    if (!productName) {
      showToast("우프 상품명을 입력하세요.", "error");
      return;
    }
    if (!confirm(`"${productName}"을(를) 우프에 미진열로 등록합니다.\n이미지 업로드 때문에 1~2분 걸립니다.`)) return;
    try {
      const { job } = await api(`${sourcePath}/candidates/${sourceNo}/register`, { method: "POST", body: { productName } });
      watchProductSyncJob(job, {
        onDone: (done) => {
          if (done.status === "done") showToast(`우프 상품 ${done.result?.productNo} 등록 완료 (미진열)`);
        }
      });
    } catch (error) {
      showToast(error.message, "error");
    }
  });
  on("[data-ps-ignore]", "click", async (event) => {
    await api(`${sourcePath}/candidates/${event.currentTarget.dataset.psIgnore}/ignore`, { method: "POST", body: { ignored: true } })
      .catch((e) => showToast(e.message, "error"));
    loadProductSync({ silent: true });
  });
  on("[data-ps-unignore]", "click", async (event) => {
    await api(`${sourcePath}/candidates/${event.currentTarget.dataset.psUnignore}/ignore`, { method: "POST", body: { ignored: false } })
      .catch((e) => showToast(e.message, "error"));
    loadProductSync({ silent: true });
  });
  on("[data-ps-link-existing]", "click", (event) => {
    openPsLinkForm({ sourceNo: event.currentTarget.dataset.psLinkExisting });
  });

  // 연결표
  on("[data-ps-goto-issues]", "click", (event) => {
    event.preventDefault();
    ps.screen = "issues";
    ps.issueFilter = "all";
    renderApp();
  });
  on("[data-ps-unlinked-toggle]", "toggle", (event) => {
    ps.showUnlinked = event.currentTarget.open;
  });
  on("[data-ps-link-new]", "click", () => openPsLinkForm({}));
  on("[data-ps-link-close]", "click", () => {
    ps.linkForm = null;
    ps.linkCheck = null;
    renderApp();
  });
  on("[data-ps-link-edit]", "click", async (event) => {
    const no = Number(event.currentTarget.dataset.psLinkEdit);
    const link = (ps.detail?.links || []).find((l) => l.wooofProductNo === no);
    if (!link) return;
    openPsLinkForm({ ...link, existing: true });
    ps.linkCheck = { loading: true };
    renderApp();
    try {
      const { check } = await api(`${sourcePath}/links/${no}/check`);
      ps.linkCheck = check || { error: "비교 결과가 없습니다." };
    } catch (error) {
      ps.linkCheck = { error: error.message };
    }
    renderApp();
  });
  on("[data-ps-link-check]", "click", async () => {
    const no = ps.linkForm?.wooofProductNo;
    ps.linkCheck = { loading: true };
    renderApp();
    try {
      ps.linkCheck = (await api(`${sourcePath}/links/${no}/check`)).check;
    } catch (error) {
      ps.linkCheck = { error: error.message };
    }
    renderApp();
  });
  on("[data-ps-search]", "click", async () => {
    const q = app.querySelector("[data-ps-search-q]")?.value?.trim() || "";
    if (!q) return;
    ps.linkForm = { ...ps.linkForm, ...formObject(app.querySelector("[data-ps-link-form]")), optionMap: ps.linkForm.optionMap, valueMap: ps.linkForm.valueMap };
    ps.linkSearch = { q, loading: true };
    renderApp();
    try {
      ps.linkSearch = { q, results: (await api(`/api/product-sync/wooof-search?q=${encodeURIComponent(q)}`)).products };
    } catch (error) {
      ps.linkSearch = { q, error: error.message };
    }
    renderApp();
  });
  on("[data-ps-search-pick]", "click", (event) => {
    ps.linkForm = { ...ps.linkForm, wooofProductNo: event.currentTarget.dataset.psSearchPick };
    ps.linkSearch = null;
    renderApp();
  });
  on("[data-ps-link-form]", "submit", async (event) => {
    event.preventDefault();
    const data = formObject(event.currentTarget);
    const body = {
      wooofProductNo: Number(data.wooofProductNo),
      sourceNo: Number(data.sourceNo),
      sourceFilter: data.sourceFilter || "",
      optionMap: psTextToMap(data.optionMap),
      valueMap: psTextToMap(data.valueMap),
      note: data.note || ""
    };
    ps.linkForm = { ...ps.linkForm, ...body, saving: true };
    ps.linkCheck = { loading: true };
    renderApp();
    try {
      const { check } = await api(`${sourcePath}/links`, { method: "POST", body });
      ps.linkForm = { ...ps.linkForm, saving: false, existing: true };
      ps.linkCheck = check || { error: "저장했지만 비교하지 못했습니다." };
      showToast(check?.autoOptionTexts?.applied
        ? `연결을 저장했고, 바뀐 옵션명 ${check.autoOptionTexts.applied}개를 본사에 맞췄습니다.`
        : "연결을 저장했습니다.");
      await loadProductSync({ silent: true });
    } catch (error) {
      ps.linkForm = { ...ps.linkForm, saving: false };
      ps.linkCheck = { error: error.message };
      renderApp();
    }
  });
  on("[data-ps-link-remove]", "click", async (event) => {
    const no = event.currentTarget.dataset.psLinkRemove;
    if (!confirm(`우프 ${no} 연결을 해제합니다. 이 상품은 더 이상 동기화되지 않습니다.`)) return;
    try {
      await api(`${sourcePath}/links/${no}`, { method: "DELETE" });
      ps.linkForm = null;
      ps.linkCheck = null;
      await loadProductSync({ silent: true });
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  // 설정
  on("[data-ps-settings]", "submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = formObject(form);
    const body = {
      namePrefix: data.namePrefix,
      restockQuantity: Number(data.restockQuantity),
      recentDays: Number(data.recentDays),
      templateProductNo: data.templateProductNo,
      thumbnailMultiply: data.thumbnailMultiply,
      categoryNos: data.categoryNos,
      runHoursKst: String(data.runHoursKst || "").split(/[,\s]+/).filter(Boolean).map(Number),
      enabled: Boolean(form.querySelector("[name=enabled]")?.checked),
      valueMap: psTextToMap(data.valueMap)
    };
    try {
      await api(`${sourcePath}/settings`, { method: "PUT", body });
      showToast("설정을 저장했습니다.");
      await loadProductSync({ silent: true });
    } catch (error) {
      showToast(error.message, "error");
    }
  });
}


// --- 상품동기화 메뉴 빨간 점 -------------------------------------------------
// 자동 확인 등으로 새로 생긴 변경(반영할 항목·본사 변경 알림·신상품)이 마지막으로
// 메뉴를 본 뒤에 생겼으면 메뉴 옆에 점을 찍는다. 본 시각은 이 브라우저에 계정별로 둔다.
const PS_BADGE_POLL_MS = 5 * 60 * 1000;
let psBadgeTimer = null;

function psSeenKey() {
  return `wooofpay_ps_seen_${state.admin?.id || ""}`;
}

function psSeenAt() {
  try {
    return localStorage.getItem(psSeenKey()) || "";
  } catch {
    return "";
  }
}

function markPsSeen() {
  try {
    localStorage.setItem(psSeenKey(), new Date().toISOString());
  } catch {
    // 저장이 막힌 브라우저에서는 점이 계속 보일 수 있다 — 기능에는 지장 없다.
  }
}

function psDotVisible() {
  const badge = state.psBadge;
  if (!badge || state.tab === "productsync") return false;
  const pending = (badge.actionCount || 0) + (badge.noticeCount || 0) + (badge.candidateCount || 0);
  return pending > 0 && Boolean(badge.latestChangeAt) && badge.latestChangeAt > psSeenAt();
}

function renderPsNavDot() {
  if (!psDotVisible()) return "";
  const b = state.psBadge;
  const parts = [];
  if (b.actionCount) parts.push(`반영할 항목 ${b.actionCount}건`);
  if (b.noticeCount) parts.push(`본사 변경 알림 ${b.noticeCount}건`);
  if (b.candidateCount) parts.push(`신상품 후보 ${b.candidateCount}개`);
  return `<span class="nav-dot" title="새 변경사항이 있습니다 — ${h(parts.join(", "))}" aria-label="새 변경사항 있음"></span>`;
}

// 화면 전체를 다시 그리지 않고 메뉴 버튼의 점만 고친다(입력 중인 폼을 지우지 않게).
function refreshPsNavDot() {
  const button = app.querySelector('[data-tab="productsync"]');
  if (!button) return;
  button.querySelector(".nav-dot")?.remove();
  const dot = renderPsNavDot();
  if (dot) button.insertAdjacentHTML("beforeend", dot);
}

async function loadPsBadge() {
  if (!state.admin || !can("productsync", "view")) return;
  try {
    state.psBadge = await api("/api/product-sync/badge");
    if (state.tab === "productsync") markPsSeen();
    refreshPsNavDot();
  } catch {
    // 점은 보조 안내일 뿐이라 실패해도 조용히 넘어간다.
  }
}

function startPsBadgePolling() {
  if (state.tab === "productsync") markPsSeen();
  if (psBadgeTimer || !state.admin || !can("productsync", "view")) return;
  loadPsBadge();
  psBadgeTimer = setInterval(loadPsBadge, PS_BADGE_POLL_MS);
}

// ===========================================================================
// v2 지급요청 — 채널톡 한 줄 요청 + 노션 결제요청 DB 를 대신한다.
// ===========================================================================
const PAYMENT_STATUS_BADGE = {
  requested: "", confirmed: "ok", awaiting_approval: "warn", paid: "muted", on_hold: "warn", cancelled: "muted"
};
const PAYMENT_FILTERS = [
  ["open", "처리 전", ["requested", "confirmed", "awaiting_approval"]],
  ["paid", "처리완료", ["paid"]],
  ["held", "보류·취소", ["on_hold", "cancelled"]],
  ["all", "전체", null]
];

function paymentState() {
  if (!state.payments) {
    state.payments = { list: null, loading: false, filter: "open", q: "", editing: null, draft: null, selected: [] };
  }
  return state.payments;
}

async function loadPayments() {
  const ps = paymentState();
  ps.loading = true;
  try {
    const res = await api("/api/payments");
    ps.list = res.payments || [];
    ps.settings = res.settings || {};
    ps.statuses = res.statuses || {};
    ps.categories = res.categories || [];
    ps.upcoming = res.upcoming || null;
  } catch (error) {
    ps.error = error.message;
    ps.list = [];
  } finally {
    ps.loading = false;
  }
}

function renderPayments() {
  const ps = paymentState();
  const head = pageHead("지급요청", "택배비·외주·생산비 등 선매입 외 결제 요청을 한곳에서 받고, 확인·처리하고, 영수증을 남깁니다.");
  if (ps.list === null) return `${head}<section class="panel"><div class="panel-body"><p class="muted">불러오는 중…</p></div></section>`;
  const statuses = ps.statuses || {};
  const filter = PAYMENT_FILTERS.find(([k]) => k === ps.filter) || PAYMENT_FILTERS[0];
  const q = String(ps.q || "").trim();
  const rows = ps.list
    .filter((p) => !filter[2] || filter[2].includes(p.status))
    .filter((p) => !q || [p.code, p.title, p.payeeName, p.holder, p.accountNumber, p.memo].some((v) => String(v || "").includes(q)))
    .sort((a, b) => String(a.plannedDate || a.dueDate || "9").localeCompare(String(b.plannedDate || b.dueDate || "9")) || String(b.createdAt).localeCompare(String(a.createdAt)));
  const up = ps.upcoming || {};
  const card = (label, amount, tone = "") => `<div class="fixed-card"><span>${label}</span><strong class="${tone}">${money.format(amount || 0)}원</strong></div>`;
  const selectedTotal = ps.list.filter((p) => ps.selected.includes(p.id)).reduce((s, p) => s + Number(p.amount || 0), 0);
  const actionsFor = (p) => {
    const b = [];
    if (["requested", "on_hold"].includes(p.status) && can("payments", "confirm")) b.push(`<button data-pay-act="confirm" data-id="${p.id}">확인</button>`);
    if (p.status === "awaiting_approval" && can("payments", "approve")) b.push(`<button class="primary" data-pay-act="approve" data-id="${p.id}">허가</button>`);
    if (p.status === "confirmed" && can("payments", "pay")) b.push(`<button class="primary" data-pay-act="pay" data-id="${p.id}">처리완료</button>`);
    if (["requested", "confirmed", "awaiting_approval"].includes(p.status) && can("payments", "confirm")) b.push(`<button data-pay-act="hold" data-id="${p.id}">보류</button>`);
    if (["on_hold", "cancelled", "paid"].includes(p.status) && can("payments", "confirm")) b.push(`<button data-pay-act="reopen" data-id="${p.id}">다시 요청</button>`);
    if (can("payments", "edit")) b.push(`<button data-pay-edit="${p.id}">수정</button>`);
    return b.join("");
  };
  const list = rows.map((p) => `
    <tr>
      <td class="m-check"><input type="checkbox" aria-label="${h(p.code)} 선택" data-pay-select="${p.id}" ${ps.selected.includes(p.id) ? "checked" : ""}></td>
      <td class="m-status"><span class="code-tag">${h(p.code)}</span><br><span class="badge ${PAYMENT_STATUS_BADGE[p.status] || ""}">${h(statuses[p.status] || p.status)}</span></td>
      <td class="m-sub">${h(String(p.createdAt || "").slice(5, 10))}<br><span class="muted">${h(p.requestedBy?.name || "")}</span></td>
      <td class="m-sub">${h(p.payeeName || p.holder || "")}<br><span class="muted" style="font-size:11px">${h(p.bankName || "")} ${h(p.accountNumber || "")}</span></td>
      <td class="wrap m-title">${h(p.title)}${p.memo ? `<br><span class="muted">${h(p.memo)}</span>` : ""}</td>
      <td class="num m-amount"><strong>${money.format(p.amount || 0)}원</strong></td>
      <td class="m-sub">${p.plannedDate ? `예정 ${h(p.plannedDate.slice(5))}` : ""}${p.dueDate ? `<br><span class="muted">기한 ${h(p.dueDate.slice(5))}</span>` : ""}${p.paidAt ? `<br><span class="muted">지급 ${h(p.paidAt.slice(5))}</span>` : ""}</td>
      <td class="m-hide">${h(p.category || "")}${p.withdrawAccount ? `<br><span class="muted" style="font-size:11px">${h(p.withdrawAccount)}</span>` : ""}</td>
      <td class="m-sub">${(p.files || []).map((f) => `<a href="/api/payments/files/${h(f.id)}" target="_blank" rel="noreferrer">📎</a>`).join(" ")}
        ${can("payments", "create") ? `<label class="file-mini" title="영수증·견적서 첨부">＋<input type="file" data-pay-file="${p.id}" hidden></label>` : ""}</td>
      <td class="m-actions"><div class="row-actions">${actionsFor(p)}</div></td>
    </tr>`).join("") || `<tr><td colspan="10" class="empty">해당하는 지급요청이 없습니다.</td></tr>`;

  return `
    ${head}
    <section class="fixed-summary">
      <div class="fixed-summary-title">나갈 돈 (지급요청 기준 · ${h(up.start || "")} ~ ${h(up.end || "")})</div>
      <div class="fixed-summary-grid cols-4">
        ${card("기한 지남", up.overdueTotal, up.overdueTotal ? "danger-text" : "")}
        ${card("오늘", up.todayTotal)}
        ${card("7일 안", up.windowTotal)}
        ${card("날짜 없음", up.undatedTotal)}
      </div>
    </section>
    <section class="layout">
      <div class="panel">
        <div class="panel-head list-head">
          <div class="npb-subnav" style="margin:0">${PAYMENT_FILTERS.map(([k, l, st]) => `<button class="npb-subtab ${ps.filter === k ? "active" : ""}" data-pay-filter="${k}">${l} <span class="muted">${ps.list.filter((p) => !st || st.includes(p.status)).length}</span></button>`).join("")}</div>
          <input data-pay-q class="list-search" placeholder="번호·내용·받는곳·계좌 검색" value="${h(q)}" aria-label="지급요청 검색">
        </div>
        <div class="bulk-bar ${ps.selected.length ? "is-active" : ""}" style="margin:4px 24px 8px">
          <span class="bulk-count">${ps.selected.length ? `<b>${ps.selected.length}건 선택</b> · 합계 <strong>${money.format(selectedTotal)}원</strong>` : "선택한 요청 일괄 처리"}</span>
          ${can("payments", "pay") ? `<button data-pay-transfer ${ps.selected.length ? "" : "disabled"}>하나은행 이체양식</button>` : ""}
        </div>
        <div class="table-wrap"><table class="compact payments-table m-cards" data-unit="원">
          <thead><tr><th></th><th>번호·상태</th><th>작성</th><th>받는 곳</th><th>내용</th><th>금액</th><th>일정</th><th>분류</th><th>영수증</th><th>처리</th></tr></thead>
          <tbody>${list}</tbody>
        </table></div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>${ps.editing ? `지급요청 수정 · ${h(ps.editing.code)}` : "새 지급요청"}</h2></div>
        <div class="panel-body">${can("payments", ps.editing ? "edit" : "create") ? renderPaymentForm() : `<p class="muted">요청 권한이 없습니다.</p>`}</div>
      </div>
    </section>`;
}

function renderPaymentForm() {
  const ps = paymentState();
  const p = { ...(ps.editing || {}), ...(ps.draft || {}) };
  const accounts = state.transferAccounts || [];
  const opt = (list, cur) => list.map((x) => `<option value="${h(x)}" ${cur === x ? "selected" : ""}>${h(x)}</option>`).join("");
  return `
    ${ps.editing ? "" : `
    <div class="field">
      <label>빠른 입력 <span class="muted" style="font-weight:400">(채널톡에 쓰던 대로 붙여넣기)</span></label>
      <textarea data-pay-quick rows="2" placeholder="예: 041302 04 196113 국민 김성준 로젠택배 8,000원 세림 택배 착불비"></textarea>
      <div class="toolbar" style="margin-top:4px"><button type="button" data-pay-parse>칸 채우기</button></div>
    </div>
    <div class="form-divider"></div>`}
    <form class="form-grid" data-pay-form>
      <div class="field"><label>내용</label><input name="title" value="${h(p.title || "")}" required placeholder="예: 세림 택배 착불비"></div>
      <div class="field two">
        <div><label>금액(원)</label><input name="amount" inputmode="numeric" value="${h(p.amount ? money.format(p.amount) : "")}" required></div>
        <div><label>분류</label><select name="category"><option value="">선택</option>${opt(ps.categories || [], p.category)}</select></div>
      </div>
      <div class="field">
        <label>받는 곳 <span class="muted" style="font-weight:400">(계좌관리 목록에서 고르거나 직접 입력)</span></label>
        <input name="payeeName" list="pay-account-options" value="${h(p.payeeName || "")}" data-pay-payee>
        <datalist id="pay-account-options">${accounts.map((a) => `<option value="${h(a.alias || a.holder)}">${h(a.bankName)} ${h(a.accountNumber)}</option>`).join("")}</datalist>
      </div>
      <div class="field two">
        <div><label>은행</label><input name="bankName" value="${h(p.bankName || "")}"></div>
        <div><label>계좌번호</label><input name="accountNumber" inputmode="numeric" value="${h(p.accountNumber || "")}"></div>
      </div>
      <div class="field two">
        <div><label>예금주</label><input name="holder" value="${h(p.holder || "")}"></div>
        <div><label>계산서</label><select name="invoice">${opt(["", "발행", "미발행", "영수증", "해당없음"], p.invoice || "")}</select></div>
      </div>
      <div class="field two">
        <div><label>요청 입금기한</label><input type="date" name="dueDate" value="${h(p.dueDate || "")}"></div>
        <div><label>입금예정일 <span class="muted" style="font-weight:400">(담당자)</span></label><input type="date" name="plannedDate" value="${h(p.plannedDate || "")}"></div>
      </div>
      <div class="field two">
        <div><label>사업부</label><select name="businessUnit">${[["", "미지정"], ["wooof", "우프(입점)"], ["pb", "PB"], ["npb", "NPB"], ["service", "용역"]].map(([k, l]) => `<option value="${k}" ${p.businessUnit === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
        <div><label>사용 출금계좌</label><select name="withdrawAccount"><option value="">선택</option>${opt(ps.settings?.withdrawAccounts || [], p.withdrawAccount)}</select></div>
      </div>
      <div class="field two">
        <div><label>출금통장표시</label><input name="withdrawMemo" value="${h(p.withdrawMemo || "")}" placeholder="비우면 받는 곳 이름"></div>
        <div><label>입금통장표시</label><input name="depositMemo" value="${h(p.depositMemo || "")}"></div>
      </div>
      <div class="field"><label>메모 <span class="muted" style="font-weight:400">(당시 단가·기준 등)</span></label><textarea name="memo" rows="2">${h(p.memo || "")}</textarea></div>
      ${ps.editing?.history?.length ? `<details><summary class="muted">처리 기록 ${ps.editing.history.length}건</summary>${ps.editing.history.map((x) => `<div class="muted" style="font-size:12px">${h(String(x.at).slice(0, 16).replace("T", " "))} · ${h(x.by)} · ${h(x.action)} ${x.note ? `· ${h(x.note)}` : ""}</div>`).join("")}</details>` : ""}
      <div class="toolbar">
        <button class="primary" type="submit">${ps.editing ? "수정 저장" : "요청 올리기"}</button>
        ${ps.editing || ps.draft ? `<button type="button" data-pay-cancel>취소</button>` : ""}
        ${ps.editing && can("payments", "delete") ? `<button type="button" class="danger" data-pay-delete="${ps.editing.id}">삭제</button>` : ""}
      </div>
    </form>`;
}

function bindPayments() {
  const ps = paymentState();
  if (ps.list === null && !ps.loading) {
    loadPayments().then(renderApp);
    return;
  }
  const reload = async () => { await loadPayments(); renderApp(); };
  const formDraft = () => {
    const form = app.querySelector("[data-pay-form]");
    return form ? formObject(form) : {};
  };
  app.querySelectorAll("[data-pay-filter]").forEach((b) => b.addEventListener("click", () => { ps.filter = b.dataset.payFilter; renderApp(); }));
  app.querySelector("[data-pay-q]")?.addEventListener("change", (e) => { ps.q = e.target.value; renderApp(); });
  app.querySelectorAll("[data-pay-select]").forEach((box) => box.addEventListener("change", () => {
    const set = new Set(ps.selected);
    if (box.checked) set.add(box.dataset.paySelect); else set.delete(box.dataset.paySelect);
    ps.selected = [...set];
    renderApp();
  }));
  app.querySelector("[data-pay-parse]")?.addEventListener("click", async () => {
    const text = app.querySelector("[data-pay-quick]")?.value || "";
    if (!text.trim()) return;
    try {
      const { parsed } = await api("/api/payments/parse", { method: "POST", body: { text } });
      ps.draft = { ...formDraft(), ...Object.fromEntries(Object.entries(parsed).filter(([, v]) => v)) };
      renderApp();
      showToast("칸을 채웠습니다. 확인 후 '요청 올리기'를 누르세요.");
    } catch (error) {
      showToast(error.message || "읽지 못했습니다.", "error");
    }
  });
  // 계좌관리 목록에서 받는 곳을 고르면 은행·계좌·예금주를 채운다.
  app.querySelector("[data-pay-payee]")?.addEventListener("change", (e) => {
    const acc = (state.transferAccounts || []).find((a) => (a.alias || a.holder) === e.target.value);
    if (!acc) return;
    const form = e.target.closest("form");
    form.querySelector("[name=bankName]").value = acc.bankName;
    form.querySelector("[name=accountNumber]").value = acc.accountNumber;
    form.querySelector("[name=holder]").value = acc.holder || "";
  });
  app.querySelector("[data-pay-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = formObject(event.currentTarget);
    try {
      if (ps.editing) await api(`/api/payments/${ps.editing.id}`, { method: "PUT", body });
      else {
        try { await api("/api/payments", { method: "POST", body }); }
        catch (dupErr) {
          if (!dupErr.payload?.duplicate) throw dupErr;
          if (!confirm(`${dupErr.message}\n\n그래도 새로 올릴까요?`)) return;
          await api("/api/payments", { method: "POST", body: { ...body, allowDuplicate: true } });
        }
      }
      showToast(ps.editing ? "수정했습니다." : "지급요청을 올렸습니다.");
      ps.editing = null;
      ps.draft = null;
      await reload();
    } catch (error) {
      showToast(error.message || "저장하지 못했습니다.", "error");
    }
  });
  app.querySelector("[data-pay-cancel]")?.addEventListener("click", () => { ps.editing = null; ps.draft = null; renderApp(); });
  app.querySelectorAll("[data-pay-edit]").forEach((b) => b.addEventListener("click", () => {
    ps.editing = ps.list.find((p) => p.id === b.dataset.payEdit) || null;
    ps.draft = null;
    renderApp();
  }));
  app.querySelector("[data-pay-delete]")?.addEventListener("click", async (e) => {
    if (!confirm("이 지급요청을 삭제할까요? 첨부파일도 함께 지워집니다.")) return;
    try {
      await api(`/api/payments/${e.target.dataset.payDelete}`, { method: "DELETE" });
      ps.editing = null;
      await reload();
    } catch (error) {
      showToast(error.message || "삭제하지 못했습니다.", "error");
    }
  });
  app.querySelectorAll("[data-pay-act]").forEach((b) => b.addEventListener("click", async () => {
    const action = b.dataset.payAct;
    const body = { action };
    if (action === "pay") {
      const rec = ps.list.find((p) => p.id === b.dataset.id);
      const paidAt = prompt("지급일 (YYYY-MM-DD)", new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10));
      if (paidAt === null) return;
      body.paidAt = paidAt;
      const acct = prompt(`사용 출금계좌\n${(ps.settings?.withdrawAccounts || []).join(", ")}`, rec?.withdrawAccount || "");
      if (acct === null) return;
      body.withdrawAccount = acct;
    }
    if (action === "hold") {
      const note = prompt("보류 사유");
      if (note === null) return;
      body.note = note;
    }
    try {
      const res = await api(`/api/payments/${b.dataset.id}/action`, { method: "POST", body });
      const st = res.payment?.status;
      showToast(st === "awaiting_approval" ? "확인했습니다. 고액이라 대표 허가가 필요합니다." : "처리했습니다.");
      await reload();
    } catch (error) {
      showToast(error.message || "처리하지 못했습니다.", "error");
    }
  }));
  app.querySelectorAll("[data-pay-file]").forEach((inp) => inp.addEventListener("change", async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      await api(`/api/payments/${inp.dataset.payFile}/files`, {
        method: "POST",
        body: { fileBase64: await readFileAsBase64(file), fileName: file.name, type: file.type }
      });
      showToast("첨부했습니다.");
      await reload();
    } catch (error) {
      showToast(error.message || "첨부하지 못했습니다.", "error");
    }
  }));
  app.querySelector("[data-pay-transfer]")?.addEventListener("click", async () => {
    try {
      const res = await fetch("/api/payments/transfer-xlsx", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids: ps.selected })
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        return showToast(err.error || "이체 양식을 만들지 못했습니다.", "error");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `하나은행_이체등록_지급요청.xlsx`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      showToast(error.message || "이체 양식을 만들지 못했습니다.", "error");
    }
  });
}

// ===========================================================================
// v2 자금 — 일일 자금보고 + 자금 일정(정기 나갈 돈/들어올 돈)
// ===========================================================================
function cashState() {
  if (!state.cash) state.cash = { screen: "report", company: "wooof", data: null, schedules: null, editing: null, loading: false };
  return state.cash;
}

async function loadCash() {
  const cs = cashState();
  cs.loading = true;
  try {
    const [rep, sch] = await Promise.all([
      api(`/api/cash/report?company=${encodeURIComponent(cs.company)}&days=7`),
      api("/api/cash/schedules")
    ]);
    cs.data = rep;
    cs.schedules = sch.schedules || [];
    cs.meta = sch;
  } catch (error) {
    cs.error = error.message;
    cs.data = cs.data || { report: null };
    cs.schedules = cs.schedules || [];
  } finally {
    cs.loading = false;
  }
}

const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"];
const cashDay = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}(${WEEKDAY_KO[new Date(`${d}T00:00:00Z`).getUTCDay()]})`;

// ===========================================================================
// v2 대출금 원장 — 시트 기준 잔액 − 상환 원금, 매월 상환 예정, 클로브 자동 반영
// ===========================================================================
const LOAN_STATUS = { active: ["정상", ""], "due-soon": ["만기 임박", "warn"], matured: ["만기 지남", "warn"], closed: ["종료", "muted"], rehab: ["회생채권", "muted"] };

function renderLoans() {
  const cs = cashState();
  const d = cs.loans;
  if (!d) return `<section class="panel"><div class="panel-body"><p class="muted">불러오는 중…</p></div></section>`;
  const sync = d.lastSync;
  const unconnected = new Set(sync?.unconnected || []);
  const group = (key) => d.loans.filter((l) => l.company === key && (cs.loanShowClosed || l.status !== "closed"));
  const table = (key) => `
    <div class="panel" style="margin-bottom:14px">
      <div class="panel-head"><h2>${h(d.companies[key])}</h2><span class="muted">남은 대출금 <strong>${money.format(d.totals[key] || 0)}원</strong>${d.rehabTotals?.[key] ? ` · 회생채권으로 전환 ${money.format(d.rehabTotals[key])}원` : ""}</span></div>
      <div class="table-wrap"><table class="compact" data-unit="원">
        <thead><tr><th>대출</th><th>남은 금액</th><th>다음 상환(추정)</th><th>만기</th></tr></thead>
        <tbody>${group(key).map((l) => `<tr class="${cs.loanSel === l.id ? "selected" : ""}" data-loan-open="${h(l.id)}">
          <td>${h(l.bank)} ${h(l.name)}<br><span class="muted" style="font-size:11px">연 ${l.rate || 0}% · 매월 ${h(l.payDay || "-")} · ${h(l.account || "")}${unconnected.has(l.id) ? ' · <span class="danger-text">클로브 미연결</span>' : ""}</span></td>
          <td class="num">${l.status === "rehab" ? `<span class="muted">원래 대출 ${money.format(l.currentBalance)}</span><br><span class="muted" style="font-size:11px">회생계획으로 변제</span>` : `<strong>${money.format(l.currentBalance)}</strong>${l.paymentCount ? `<br><span class="muted" style="font-size:11px">상환 ${l.paymentCount}건 반영</span>` : `<br><span class="muted" style="font-size:11px">${h(l.asOf || "")} 기준</span>`}`}</td>
          <td>${l.nextDate ? `${h(l.nextDate.slice(5))}<br><span class="muted" style="font-size:11px">${money.format(l.nextAmount)}원</span>` : ""}</td>
          <td>${l.status === "rehab" ? `<span class="badge muted">회생채권</span><br><span class="muted" style="font-size:11px">${h(l.rehabCreditor)}${l.rehabPlan ? ` · 계획 채권 ${money.format(l.rehabPlan.total)} · 현금변제 ${money.format(l.rehabPlan.cash)}` : ""}</span>` : `${h(l.maturity || "")}<br><span class="badge ${LOAN_STATUS[l.status][1]}">${LOAN_STATUS[l.status][0]}</span>`}</td></tr>`).join("") || `<tr><td colspan="4" class="empty">대출이 없습니다.</td></tr>`}</tbody>
      </table></div>
    </div>`;
  return `
    <div class="toolbar" style="margin:8px 0">
      ${d.canEdit ? `<button data-loan-sync>클로브에서 상환 찾기</button><button data-loan-import>대출금 관리대장에서 가져오기</button>` : ""}
      <label class="check"><input type="checkbox" data-loan-closed ${cs.loanShowClosed ? "checked" : ""}> 종료된 대출도 보기</label>
      <span class="muted" style="font-size:12px">${sync ? `마지막 상환 찾기 ${h(String(sync.at || "").slice(0, 16).replace("T", " "))} · ${sync.matched}건 반영${sync.unconnected?.length ? ` · 클로브에 출금계좌가 없는 대출 ${sync.unconnected.length}건은 직접 입력하세요` : ""}` : "상환은 클로브 출금 거래에서 자동으로 찾습니다. 출금계좌가 클로브에 없으면 직접 입력합니다."}</span>
    </div>
    <section class="v2-wide">${Object.keys(d.companies).map(table).join("")}</section>
    ${cs.loanDetail ? v2Modal(renderLoanDetail(), "data-loan-close") : ""}`;
}

function renderLoanDetail() {
  const cs = cashState();
  const { loan: l, payments = [] } = cs.loanDetail;
  const canEdit = cs.loans?.canEdit;
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  return `
    <div class="panel-head"><h2>${h(l.bank)} ${h(l.name)}</h2><button data-loan-close>닫기</button></div>
    <div class="panel-body">
      ${l.status === "rehab" ? `<p class="muted">회생채권으로 전환(${h(l.rehabCreditor)} 대위변제)${l.rehabNote ? ` · ${h(l.rehabNote)}` : ""}. 은행 상환·이자 일정에서 빠지고 회생계획 변제로 갚습니다.</p>` : ""}
      <p>남은 금액 <strong>${money.format(l.currentBalance)}원</strong> (${h(l.asOf || "")} 기준 ${money.format(l.balance)}원 − 이후 상환 원금)<br>
      <span class="muted">원금 ${money.format(l.principal || 0)} · 실행 ${h(l.startDate || "")} · 연 ${l.rate}% · 매월 ${h(l.payDay || "")} · 예상 ${money.format(l.expected?.total || 0)}원(이자 ${money.format(l.expected?.interest || 0)}) · ${h(l.term || "")} ${h(l.memo || "")}</span></p>
      ${canEdit ? `<h3>상환 직접 기록</h3><form class="form-grid" data-loan-pay>
        <div class="field two"><div><label>날짜</label><input type="date" name="date" value="${today}"></div><div><label>메모</label><input name="memo"></div></div>
        <div class="field two"><div><label>원금</label><input name="principal" inputmode="numeric" value="${l.expected?.principal ? money.format(l.expected.principal) : ""}"></div><div><label>이자</label><input name="interest" inputmode="numeric" value="${l.expected?.interest ? money.format(l.expected.interest) : ""}"></div></div>
        <div class="toolbar"><button class="primary" type="submit">기록</button></div></form>` : ""}
      <h3 style="margin-top:12px">상환 기록</h3>
      <div class="table-wrap"><table class="compact" data-unit="원"><thead><tr><th>날짜</th><th>원금</th><th>이자</th><th>근거</th><th></th></tr></thead><tbody>
        ${payments.map((p) => `<tr class="${p.voided ? "muted" : ""}"><td>${h(p.date)}</td><td class="num">${money.format(p.principal || 0)}</td><td class="num">${money.format(p.interest || 0)}</td>
          <td class="muted" style="font-size:11px">${h(p.source || "")} ${h(p.memo || "")}${p.voided ? " · 취소됨" : ""}</td>
          <td>${canEdit && !p.voided ? `<button data-loan-pay-void="${h(p.id)}">취소</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">아직 기록이 없습니다.</td></tr>`}
      </tbody></table></div>
      ${canEdit ? `<details style="margin-top:12px"><summary>대출 정보 고치기</summary><form class="form-grid" data-loan-edit>
        <div class="field two"><div><label>남은 금액(지금)</label><input name="balance" inputmode="numeric" value="${money.format(l.currentBalance)}"></div><div><label>만기</label><input type="date" name="maturity" value="${h(l.maturity || "")}"></div></div>
        <div class="field two"><div><label>이율 %</label><input name="rate" value="${h(l.rate)}"></div><div><label>매월 상환일</label><input name="payDay" value="${h(l.payDay || "")}" placeholder="15일 / 말일"></div></div>
        <div class="field two"><div><label>매월 원금상환</label><input name="principalPayment" inputmode="numeric" value="${h(l.principalPayment || "")}"></div><div><label>출금계좌</label><input name="account" value="${h(l.account || "")}"></div></div>
        <div class="field two"><div><label>회생채권 전환 — 대위변제 기관</label><input name="rehabCreditor" value="${h(l.rehabCreditor || "")}" placeholder="예: 기술보증기금 (비우면 일반 대출)"></div><div><label>전환 메모</label><input name="rehabNote" value="${h(l.rehabNote || "")}"></div></div>
        <label class="check"><input type="checkbox" name="closed" ${l.closed ? "checked" : ""}> 종료(다 갚음)</label>
        <div class="toolbar"><button type="submit">저장</button><span class="muted" style="font-size:12px">남은 금액을 고치면 오늘 기준 잔액이 됩니다.</span></div></form></details>` : ""}
    </div>`;
}

function bindLoans() {
  const cs = cashState();
  const load = async (sel) => {
    cs.loans = await api("/api/loans");
    const id = sel ?? cs.loanSel ?? "";
    cs.loanSel = id;
    cs.loanDetail = id ? await api(`/api/loans/item/${encodeURIComponent(id)}`) : null;
  };
  if (!cs.loans && !cs.loansLoading) {
    cs.loansLoading = true;
    load().catch((e) => showToast(e.message, "error")).finally(() => { cs.loansLoading = false; renderApp(); });
    return;
  }
  const refresh = async (sel) => { await load(sel); renderApp(); };
  const run = async (fn, ok) => { try { const r = await fn(); if (ok) showToast(typeof ok === "function" ? ok(r) : ok); await refresh(); } catch (e) { showToast(e.message || "처리하지 못했습니다.", "error"); } };
  bindV2Modal();
  app.querySelectorAll("[data-loan-open]").forEach((tr) => tr.addEventListener("click", () => refresh(tr.dataset.loanOpen).catch((e) => showToast(e.message, "error"))));
  app.querySelector("[data-loan-close]")?.addEventListener("click", () => { cs.loanSel = ""; cs.loanDetail = null; renderApp(); });
  app.querySelector("[data-loan-closed]")?.addEventListener("change", (e) => { cs.loanShowClosed = e.target.checked; renderApp(); });
  app.querySelector("[data-loan-import]")?.addEventListener("click", () => {
    if (!confirm("대출금 관리대장(구글시트)을 읽어 대출 목록과 기준일 잔액을 가져옵니다. 여기서 고친 대출은 그대로 둡니다. 진행할까요?")) return;
    run(() => api("/api/loans/import-sheet", { method: "POST", body: {} }), (r) => `대출 ${r.loans}건을 가져왔습니다. 확인 필요 질문 ${r.questions}건.`);
  });
  app.querySelector("[data-loan-sync]")?.addEventListener("click", () => run(() => api("/api/loans/sync", { method: "POST", body: {} }),
    (r) => `상환 ${r.matched}건을 반영했습니다.${r.unconnected.length ? ` 클로브에 출금계좌가 없는 대출 ${r.unconnected.length}건.` : ""}${r.errors.length ? ` 오류: ${r.errors.join(", ")}` : ""}`));
  app.querySelector("[data-loan-pay]")?.addEventListener("submit", (e) => { e.preventDefault(); run(() => api(`/api/loans/item/${encodeURIComponent(cs.loanSel)}/payments`, { method: "POST", body: formObject(e.currentTarget) }), "기록했습니다."); });
  app.querySelectorAll("[data-loan-pay-void]").forEach((b) => b.addEventListener("click", () => { if (confirm("이 상환 기록을 취소할까요?")) run(() => api(`/api/loans/payments/${encodeURIComponent(b.dataset.loanPayVoid)}/void`, { method: "POST", body: {} }), "취소했습니다."); }));
  app.querySelector("[data-loan-edit]")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = formObject(e.currentTarget);
    f.closed = e.currentTarget.querySelector('[name="closed"]').checked;
    const before = cs.loanDetail.loan;
    if (Number(String(f.balance).replace(/,/g, "")) === before.currentBalance) delete f.balance; // 안 고쳤으면 기준일 유지
    run(() => api(`/api/loans/item/${encodeURIComponent(cs.loanSel)}`, { method: "PUT", body: f }), "저장했습니다.");
  });
}

// ===========================================================================
// v2 회생계획 변제 — 연도별 계획·미리 낸 돈·남은 돈, 채권자별 금액, 지급 기록
// ===========================================================================
const REHAB_STATUS = { paid: ["완료", "muted"], overdue: ["기한 지남", "warn"], "this-year": ["올해 연말까지", ""], planned: ["예정", "muted"] };
function renderRehab() {
  const cs = cashState();
  const d = cs.rehab;
  if (!d) return `<section class="panel"><div class="panel-body"><p class="muted">불러오는 중…</p></div></section>`;
  if (!d.hasPlan) return `<section class="panel"><div class="panel-body"><p class="muted">회생 변제계획표를 아직 가져오지 않았습니다.</p>${state.admin?.role === "owner" ? `<button class="primary" data-rehab-import>회생 변제계획표 가져오기</button>` : ""}</div></section>`;
  const t = d.totals;
  const cur = d.years.find((y) => y.year === d.year) || {};
  const cats = d.byCategory.map(([k, v]) => `${h(k)} ${v.count}곳 · 현금변제 ${money.format(v.cash)}`).join(" / ");
  return `
    <div class="toolbar" style="margin:8px 0">
      ${state.admin?.role === "owner" ? `<button data-rehab-import>변제계획표 다시 가져오기</button>` : ""}
      <span class="muted" style="font-size:12px">채권총액 ${money.format(t.total)}원 · 80% 출자전환(특수관계인 100%), 나머지를 2026~2035년 해마다 연말까지 현금변제(조세는 2028년까지) · ${cats}</span>
    </div>
    <section class="panel"><div class="table-wrap"><table class="compact fit" data-unit="원">
      <thead><tr><th>연도</th><th>계획 변제액</th><th>미리 낸 돈</th><th>지급 기록</th><th>남은 금액</th><th>기한</th><th>상태</th></tr></thead>
      <tbody>${d.years.map((y) => `<tr class="${y.year === d.year ? "selected" : ""}" data-rehab-year="${y.year}">
        <td>${y.year}년</td><td class="num">${money.format(y.planned)}</td>
        <td class="num">${y.prepaid ? `<span title="2025년에 2026년분 50% 선변제(조기졸업 조건). 실제 낸 돈 ${money.format(y.prepaidPaid)}원(현가할인 4.4%)">${money.format(y.prepaid)} <span class="muted">*</span></span>` : ""}</td>
        <td class="num">${y.paid ? money.format(y.paid) : ""}</td><td class="num"><strong>${money.format(y.due)}</strong></td>
        <td>${h(y.dueDate)}</td><td><span class="badge ${REHAB_STATUS[y.status][1]}">${REHAB_STATUS[y.status][0]}</span></td></tr>`).join("")}</tbody>
    </table></div>
    ${d.years.some((y) => y.prepaid) ? `<p class="muted" style="font-size:12px;margin:6px 12px">* 2026년분 50%를 2025년에 미리 냄(조기졸업 조건). 실제 낸 돈은 현가할인 4.4%를 적용한 ${money.format(d.years.find((y) => y.prepaid).prepaidPaid)}원.</p>` : ""}</section>
    <section class="rehab-bottom">
      <div class="panel">
        <div class="panel-head"><h2>${h(d.year)}년 채권자별</h2><span class="muted">${d.creditors.length}곳 · 연도를 누르면 바뀝니다</span></div>
        <div class="table-wrap" style="max-height:560px"><table class="compact" data-unit="원">
          <thead><tr><th>채권자</th><th>구분</th><th>계획</th><th>미리 낸 돈</th><th>남은 금액</th></tr></thead>
          <tbody>${d.creditors.map((c) => `<tr><td class="wrap">${h(c.creditor)}${c.biz ? `<br><span class="muted" style="font-size:11px">${h(c.biz)}</span>` : ""}</td>
            <td style="font-size:12px">${h(c.cat)}</td><td class="num">${money.format(c.planned)}</td><td class="num">${c.prepaid ? money.format(c.prepaid) : ""}</td>
            <td class="num"><strong>${money.format(c.remaining)}</strong></td></tr>`).join("")}</tbody>
        </table></div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>지급 기록</h2></div>
        <div class="panel-body">
          ${d.canEdit ? `<form class="form-grid" data-rehab-pay>
            <div class="field two"><div><label>연도</label><input name="year" value="${h(d.year)}"></div><div><label>지급일</label><input type="date" name="date" value="${new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)}"></div></div>
            <div class="field two"><div><label>금액</label><input name="amount" inputmode="numeric" value="${cur.due ? money.format(cur.due) : ""}"></div><div><label>메모</label><input name="memo" placeholder="예: 채권자 67곳 일괄 이체"></div></div>
            <div class="toolbar"><button class="primary" type="submit">지급 기록</button></div></form>` : ""}
          <div class="table-wrap"><table class="compact tight" data-unit="원"><thead><tr><th>연도</th><th>지급일</th><th>금액</th><th>메모</th><th></th></tr></thead><tbody>
            ${d.payments.map((p) => `<tr><td>${h(p.year)}</td><td>${h(p.date)}</td><td class="num">${money.format(p.amount)}</td><td class="wrap">${h(p.memo || "")}</td>
              <td>${d.canEdit ? `<button data-rehab-void="${h(p.id)}">취소</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">2025년 선변제는 계획표 값으로 반영돼 있습니다. 연말에 낸 뒤 여기에 기록하세요.</td></tr>`}
          </tbody></table></div>
        </div>
      </div>
    </section>`;
}
function bindRehab() {
  const cs = cashState();
  const load = async (year) => { cs.rehab = await api(`/api/rehab${year ? `?year=${year}` : ""}`); };
  if (!cs.rehab && !cs.rehabLoading) {
    cs.rehabLoading = true;
    load().catch((e) => showToast(e.message, "error")).finally(() => { cs.rehabLoading = false; renderApp(); });
    return;
  }
  const run = async (fn, ok) => { try { await fn(); if (ok) showToast(ok); await load(cs.rehab?.year); renderApp(); } catch (e) { showToast(e.message || "처리하지 못했습니다.", "error"); } };
  app.querySelectorAll("[data-rehab-year]").forEach((tr) => tr.addEventListener("click", () => run(() => load(tr.dataset.rehabYear))));
  app.querySelectorAll("[data-rehab-import]").forEach((b) => b.addEventListener("click", () => {
    if (!confirm("회생채권 변제계획표(구글시트)를 다시 읽어 옵니다. 지급 기록은 그대로 둡니다. 진행할까요?")) return;
    run(() => api("/api/rehab/import-sheet", { method: "POST", body: {} }), "변제계획표를 가져왔습니다.");
  }));
  app.querySelector("[data-rehab-pay]")?.addEventListener("submit", (e) => { e.preventDefault(); run(() => api("/api/rehab/payments", { method: "POST", body: formObject(e.currentTarget) }), "기록했습니다."); });
  app.querySelectorAll("[data-rehab-void]").forEach((b) => b.addEventListener("click", () => { if (confirm("이 지급 기록을 취소할까요?")) run(() => api(`/api/rehab/payments/${encodeURIComponent(b.dataset.rehabVoid)}/void`, { method: "POST", body: {} }), "취소했습니다."); }));
}

// ===========================================================================
// v2 현금흐름표 — 구글시트(2026_현금흐름표)와 같은 모양: 행=현금IN/OUT 항목, 열=날짜
// ===========================================================================
const CF_KIND = { manual: "직접 입력", actual: "실제(클로브)", sheet: "시트 값", plan: "예정" };
function cfState() {
  const cs = cashState();
  if (!cs.cf) cs.cf = { month: new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 7), company: "", data: null, loading: false, cell: null, rowEdit: null };
  return cs.cf;
}
const cfNum = (n) => (n ? money.format(n) : "");
function renderCashFlow() {
  const cf = cfState();
  const d = cf.data;
  if (!d) return `<section class="panel"><div class="panel-body"><p class="muted">불러오는 중…</p></div></section>`;
  if (!d.hasRows) return `<section class="panel"><div class="panel-body"><p>현금흐름표 행이 아직 없습니다. 쓰시던 구글시트(2026_현금흐름표)를 그대로 가져오면 행 이름·지난 값·고정비 목록이 들어옵니다.</p>
    ${d.isOwner ? `<button class="primary" data-cf-import>현금흐름표 시트 가져오기</button>` : `<p class="muted">오너가 가져오기를 해야 합니다.</p>`}</div></section>`;
  const days = d.days;
  const sumRow = (side) => days.reduce((s, x) => s + (d.totals[x.date]?.[side] || 0), 0);
  const monthIn = sumRow("in");
  const monthOut = sumRow("out");
  const head = `<tr><th class="cf-label">항목</th>${days.map((x) => `<th class="cf-day ${x.date === d.today ? "today" : ""} ${["토", "일"].includes(x.dow) ? "weekend" : ""}">${x.day}<br><small>${x.dow}</small></th>`).join("")}<th class="cf-total">월 합계</th></tr>`;
  const rowHtml = (r) => {
    const cells = d.grid[r.id] || {};
    const total = Object.values(cells).reduce((s, c) => s + c.amount, 0);
    return `<tr><th class="cf-label" data-cf-row="${h(r.id)}" title="행 이름·맞춤 낱말 고치기">${h(r.label)}</th>${days.map((x) => {
      const c = cells[x.date];
      return `<td class="cf-cell ${c ? `k-${c.kind}` : ""} ${x.date === d.today ? "today" : ""}" data-cf-cell="${h(r.id)}|${x.date}" ${c?.memo ? `title="${h(c.memo)}"` : ""}>${c ? cfNum(c.amount) : ""}</td>`;
    }).join("")}<td class="cf-total">${cfNum(total)}</td></tr>`;
  };
  const section = (side, title) => {
    const rows = d.rows.filter((r) => r.side === side);
    return `<tr class="cf-section"><th class="cf-label">${title}</th><td colspan="${days.length + 1}"></td></tr>${rows.map(rowHtml).join("")}
      <tr class="cf-sum"><th class="cf-label">${side === "in" ? "입금 합계" : "출금 합계"}</th>${days.map((x) => `<td class="${x.date === d.today ? "today" : ""}">${cfNum(d.totals[x.date]?.[side])}</td>`).join("")}<td class="cf-total">${cfNum(sumRow(side))}</td></tr>`;
  };
  const netRow = `<tr class="cf-sum"><th class="cf-label">순현금(입금−출금)</th>${days.map((x) => { const n = (d.totals[x.date]?.in || 0) - (d.totals[x.date]?.out || 0); return `<td class="${n < 0 ? "neg" : ""} ${x.date === d.today ? "today" : ""}">${n ? money.format(n) : ""}</td>`; }).join("")}<td class="cf-total ${monthIn - monthOut < 0 ? "neg" : ""}">${money.format(monthIn - monthOut)}</td></tr>`;
  const balRow = Object.keys(d.balances || {}).length ? `<tr class="cf-sum cf-bal"><th class="cf-label">예상 잔액</th>${days.map((x) => { const b = d.balances[x.date]; return `<td class="${b < 0 ? "neg" : ""} ${x.date === d.today ? "today" : ""}">${b == null ? "" : money.format(b)}</td>`; }).join("")}<td class="cf-total"></td></tr>` : "";
  const ym = (delta) => { const [y, m] = cf.month.split("-").map(Number); const dt = new Date(Date.UTC(y, m - 1 + delta, 1)); return dt.toISOString().slice(0, 7); };
  return `
    <div class="toolbar" style="margin:8px 0">
      <button data-cf-month="${ym(-1)}">‹</button><strong style="min-width:90px;text-align:center">${cf.month.replace("-", "년 ")}월</strong><button data-cf-month="${ym(1)}">›</button>
      ${[["", "전체(두 사업자)"], ["wooof", "우프컴퍼니"], ["betters", "Betters(개인사업자)"]].map(([k, l]) => `<button class="npb-subtab ${cf.company === k ? "active" : ""}" data-cf-company="${k}">${l}</button>`).join("")}
      <span style="flex:1"></span>
      ${d.canEdit ? `<button data-cf-sync title="지난 날의 실제 입출금을 클로브에서 가져옵니다">클로브 실제 내역 불러오기</button><button data-cf-addrow>행 추가</button>` : ""}
      ${d.isOwner ? `<button data-cf-import title="옛 구글시트 값을 다시 가져옵니다(직접 입력한 칸은 그대로)">시트 다시 가져오기</button>` : ""}
    </div>
    <section class="sales-flow">
      <div class="sales-step"><span>이달 입금</span><strong>${money.format(monthIn)}원</strong></div>
      <div class="sales-step"><span>이달 출금</span><strong>${money.format(monthOut)}원</strong></div>
      <div class="sales-step"><span>순현금</span><strong class="${monthIn - monthOut < 0 ? "danger-text" : ""}">${money.format(monthIn - monthOut)}원</strong></div>
      ${d.opening != null ? `<div class="sales-step"><span>오늘 잔액(클로브)</span><strong>${money.format(d.opening)}원</strong></div>` : d.balanceError ? `<div class="sales-step"><span>잔액</span><em class="muted" style="font-size:12px;font-style:normal">${h(d.balanceError)}</em></div>` : ""}
    </section>
    <p class="cf-legend muted">단위: 원 · <span class="k-actual">실제(클로브)</span> <span class="k-sheet">시트 값</span> <span class="k-plan">예정</span> <span class="k-manual">직접 입력</span> · 칸을 누르면 내역을 보고 고칠 수 있습니다${d.actualSyncedAt ? ` · 클로브 ${h(String(d.actualSyncedAt).slice(5, 16).replace("T", " "))} 기준` : " · 지난 날은 클로브 실제 내역을 불러오기 전까지 시트 값으로 보입니다"}</p>
    <section class="panel"><div class="cf-wrap"><table class="cf-grid"><thead>${head}</thead><tbody>${section("in", "현금 IN")}${section("out", "현금 OUT")}${netRow}${balRow}</tbody></table></div></section>
    ${cf.cell ? v2Modal(renderCashFlowCell(), "data-cf-close") : ""}
    ${cf.rowEdit ? v2Modal(renderCashFlowRow(), "data-cf-close") : ""}`;
}
function renderCashFlowCell() {
  const cf = cfState();
  const { rowId, date } = cf.cell;
  const r = cf.data.rows.find((x) => x.id === rowId);
  const c = cf.data.grid[rowId]?.[date];
  const parts = c?.parts || { actual: [], plan: [], sheet: null };
  // 실제(클로브) 줄은 '이 행으로 보내기'로 거래처 이름을 다른 행의 맞춤 낱말로 넣을 수 있다(다음부터 자동 분류).
  const sameSide = cf.data.rows.filter((x) => x.side === r?.side && x.id !== rowId);
  const sendTo = (p) => cf.data.canEdit && p.title ? `<select data-cf-send="${h(p.title)}"><option value="">이 행으로 보내기…</option>${sameSide.map((x) => `<option value="${h(x.id)}">${h(x.label)}</option>`).join("")}</select>` : "";
  const list = (title, items, withSend) => items.length ? `<h3>${title}</h3><table class="compact" data-unit="원"><tbody>${items.map((p) => `<tr><td class="wrap">${h(p.title || "")}</td><td class="num">${money.format(p.amount)}</td>${withSend ? `<td>${sendTo(p)}</td>` : ""}</tr>`).join("")}</tbody></table>` : "";
  return `<div class="panel-head"><h2>${h(r?.label || "")} · ${h(date)}</h2><button data-cf-close>닫기</button></div>
    <div class="panel-body">
      <p>지금 값: <strong>${c ? `${money.format(c.amount)}원` : "없음"}</strong>${c ? ` <span class="badge muted">${CF_KIND[c.kind]}</span>` : ""}${c?.memo ? ` · ${h(c.memo)}` : ""}</p>
      ${list("실제(클로브)", parts.actual, true)}${list("예정(v2)", parts.plan, false)}${parts.sheet != null ? `<p class="muted">옛 시트 값: ${money.format(parts.sheet)}원</p>` : ""}
      ${cf.data.canEdit ? `<form class="form-grid" data-cf-cell-form>
        <div class="field two"><div><label>직접 입력(원)</label><input name="amount" inputmode="numeric" value="${c?.kind === "manual" ? money.format(c.amount) : ""}" placeholder="비우고 저장하면 직접 입력을 지웁니다"></div>
        <div><label>메모</label><input name="memo" value="${h(c?.kind === "manual" ? c.memo || "" : "")}"></div></div>
        <div class="toolbar"><button class="primary" type="submit">저장</button><span class="muted" style="font-size:12px">직접 입력한 값이 실제·시트·예정보다 먼저 보입니다.</span></div></form>` : ""}
    </div>`;
}
function renderCashFlowRow() {
  const cf = cfState();
  const r = cf.rowEdit.id ? cf.data.rows.find((x) => x.id === cf.rowEdit.id) : { side: "out", label: "", match: [] };
  return `<div class="panel-head"><h2>${r.id ? "행 고치기" : "행 추가"}</h2><button data-cf-close>닫기</button></div>
    <div class="panel-body"><form class="form-grid" data-cf-row-form="${h(r.id || "")}">
      <div class="field two"><div><label>이름</label><input name="label" value="${h(r.label)}" required></div>
        <div><label>구분</label><select name="side" ${r.id ? "disabled" : ""}><option value="in" ${r.side === "in" ? "selected" : ""}>현금 IN</option><option value="out" ${r.side === "out" ? "selected" : ""}>현금 OUT</option></select></div></div>
      ${r.id ? `<div class="field"><label>맞춤 낱말(쉼표) — 클로브 거래·v2 예정의 이름에 이 낱말이 있으면 이 행으로 모읍니다</label><input name="match" value="${h((r.match || []).join(", "))}" placeholder="예: 네이버파이낸셜, 스마트스토어"></div>
      <div class="field two"><div><label>회사</label><select name="company"><option value="">두 사업자</option><option value="wooof" ${r.company === "wooof" ? "selected" : ""}>우프컴퍼니</option><option value="betters" ${r.company === "betters" ? "selected" : ""}>Betters(개인사업자)</option></select></div>
        <div><label>순서</label><input name="order" inputmode="numeric" value="${h(r.order ?? "")}"></div></div>
      <div class="field"><label>매출 유형 <span class="muted" style="font-weight:400">— 대행 판매분·재발행 전달분은 우프 매출로 세지 않음</span></label><select name="revenueType"><option value="">(없음/출금)</option>${Object.entries(cf.data.revenueTypes || {}).map(([k, l]) => `<option value="${k}" ${r.revenueType === k ? "selected" : ""}>${h(l)}</option>`).join("")}</select></div>
      <label class="check"><input type="checkbox" name="hide"> 이 행 숨기기</label>` : ""}
      <div class="toolbar"><button class="primary" type="submit">저장</button></div></form></div>`;
}
function bindCashFlow() {
  const cf = cfState();
  const load = async () => {
    cf.loading = true;
    try { cf.data = await api(`/api/cashflow?month=${cf.month}${cf.company ? `&company=${cf.company}` : ""}`); } catch (e) { showToast(e.message, "error"); cf.data = cf.data || { hasRows: false }; } finally { cf.loading = false; renderApp(); }
  };
  if (!cf.data && !cf.loading) { load(); return; }
  bindV2Modal();
  const run = async (fn, ok) => { try { const r = await fn(); if (ok) showToast(typeof ok === "function" ? ok(r) : ok); cf.cell = null; cf.rowEdit = null; await load(); } catch (e) { showToast(e.message || "처리하지 못했습니다.", "error"); } };
  app.querySelectorAll("[data-cf-month]").forEach((b) => b.addEventListener("click", () => { cf.month = b.dataset.cfMonth; cf.data = null; load(); }));
  app.querySelectorAll("[data-cf-company]").forEach((b) => b.addEventListener("click", () => { cf.company = b.dataset.cfCompany; cf.data = null; load(); }));
  app.querySelectorAll("[data-cf-cell]").forEach((td) => td.addEventListener("click", () => { const [rowId, date] = td.dataset.cfCell.split("|"); cf.cell = { rowId, date }; renderApp(); }));
  app.querySelectorAll("[data-cf-row]").forEach((th) => th.addEventListener("click", () => { if (cf.data.canEdit) { cf.rowEdit = { id: th.dataset.cfRow }; renderApp(); } }));
  app.querySelector("[data-cf-addrow]")?.addEventListener("click", () => { cf.rowEdit = { id: "" }; renderApp(); });
  app.querySelector("[data-cf-close]")?.addEventListener("click", () => { cf.cell = null; cf.rowEdit = null; renderApp(); });
  app.querySelectorAll("[data-cf-import]").forEach((b) => b.addEventListener("click", () => {
    if (!confirm("구글시트(2026_현금흐름표)의 행·1~11월 값·고정비 목록을 가져옵니다. 직접 입력한 칸과 고친 일정은 그대로 둡니다. 진행할까요?")) return;
    run(() => api("/api/cashflow/import-sheet", { method: "POST", body: {} }), (r) => `행 ${r.rows}개, 칸 ${r.cells}개, 고정비 ${r.fixed}건을 가져왔습니다.`);
  }));
  app.querySelector("[data-cf-sync]")?.addEventListener("click", () => run(() => api("/api/cashflow/sync-clobe", { method: "POST", body: { month: cf.month } }),
    (r) => `클로브 거래 ${r.lines}건을 불러왔습니다.${r.errors?.length ? ` (${r.errors.join(", ")})` : ""}`));
  app.querySelectorAll("[data-cf-send]").forEach((sel) => sel.addEventListener("change", () => {
    const target = cf.data.rows.find((x) => x.id === sel.value);
    if (!target) return;
    // 거래처 이름에서 지점·괄호 꼬리를 떼고 앞부분을 맞춤 낱말로 쓴다.
    const term = sel.dataset.cfSend.replace(/\(.*$/, "").replace(/주식회사|㈜/g, "").trim().slice(0, 20);
    if (!term || !confirm(`'${term}' 거래를 앞으로 '${target.label}' 행으로 모읍니다. 진행할까요?`)) { sel.value = ""; return; }
    run(() => api(`/api/cashflow/rows/${encodeURIComponent(target.id)}`, { method: "PUT", body: { match: [...(target.match || []), term].join(",") } }), `'${term}' → ${target.label}`);
  }));
  app.querySelector("[data-cf-cell-form]")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = formObject(e.currentTarget);
    run(() => api("/api/cashflow/cell", { method: "PUT", body: { ...cf.cell, ...f } }), "저장했습니다.");
  });
  app.querySelector("[data-cf-row-form]")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = formObject(form);
    const rid = form.dataset.cfRowForm;
    if (rid) run(() => api(`/api/cashflow/rows/${encodeURIComponent(rid)}`, { method: "PUT", body: { label: f.label, match: f.match, company: f.company, order: f.order, revenueType: f.revenueType, active: !form.querySelector('[name="hide"]').checked } }), "저장했습니다.");
    else run(() => api("/api/cashflow/rows", { method: "POST", body: { label: f.label, side: f.side } }), "행을 추가했습니다.");
  });
}

function renderCash() {
  const cs = cashState();
  const head = pageHead("자금", "오늘과 7일 안에 들어올 돈·나갈 돈, 계좌 잔액을 한 장으로 봅니다. 매일 아침 이 화면을 보고 채널톡에 공유하세요.");
  const tabs = `<div class="npb-subnav">${[["report", "일일 자금보고"], ["cashflow", "현금흐름표"], ["schedules", "고정비·자금 일정"], ["loans", "대출금"], ["rehab", "회생변제"], ["receivables", "채권원장"]].map(([k, l]) => `<button class="npb-subtab ${cs.screen === k ? "active" : ""}" data-cash-screen="${k}">${l}</button>`).join("")}
    <span style="flex:1"></span>
    ${(cs.meta?.companies || [{ key: "wooof", name: "우프컴퍼니" }, { key: "betters", name: "Betters(개인사업자)" }]).map((c) => `<button class="npb-subtab ${cs.company === c.key ? "active" : ""}" data-cash-company="${c.key}">${h(c.name)}</button>`).join("")}</div>`;
  if (cs.screen === "loans") return `${head}${tabs}${renderLoans()}`;
  if (cs.screen === "rehab") return `${head}${tabs}${renderRehab()}`;
  if (cs.screen === "cashflow") return `${head}${tabs}${renderCashFlow()}`;
  if (!cs.data) return `${head}${tabs}<section class="panel"><div class="panel-body"><p class="muted">불러오는 중…</p></div></section>`;
  return `${head}${tabs}${cs.screen === "schedules" ? renderCashSchedules() : cs.screen === "receivables" ? renderReceivableLedger() : renderCashReport()}`;
}

function renderAccountDetail() {
  const cs = cashState();
  const a = (cs.data?.accounts || []).find((x) => String(x.id) === String(cs.accDetail?.id));
  if (!a) return "";
  const tx = cs.accDetail.transactions;
  return `<div class="panel-head"><h2>${h(a.name)}</h2><button data-acc-close>닫기</button></div>
    <div class="panel-body">
      <p>${h(a.bank || "")} ${h(a.number || "")} · 잔액 <strong>${money.format(a.balance)}원</strong>${a.clobeName && a.clobeName !== a.name ? ` <span class="muted">(클로브 이름: ${h(a.clobeName)})</span>` : ""}</p>
      ${can("cash", "edit") ? `<form class="form-grid" data-acc-form>
        <div class="field two"><div><label>별칭(우리가 부르는 이름)</label><input name="alias" value="${h(a.name === a.clobeName ? "" : a.name)}" placeholder="${h(a.clobeName || "")}"></div>
          <div class="toolbar" style="align-items:flex-end"><label class="check"><input type="checkbox" name="favorite" ${a.favorite ? "checked" : ""}> 즐겨찾기(보고에 표시)</label><label class="check"><input type="checkbox" name="hidden" ${a.hidden ? "checked" : ""}> 숨기기</label></div></div>
        <div class="toolbar"><button class="primary" type="submit">저장</button></div></form>` : ""}
      <h3>최근 30일 거래</h3>
      ${tx == null ? `<p class="muted">불러오는 중…</p>` : cs.accDetail.error ? `<p class="muted">${h(cs.accDetail.error)}</p>` : `<div class="table-wrap" style="max-height:420px"><table class="compact" data-unit="원">
        <thead><tr><th>일시</th><th>거래처·적요</th><th>입금</th><th>출금</th><th>잔액</th><th>분류</th></tr></thead>
        <tbody>${tx.map((t) => `<tr><td>${h(t.at.slice(5))}</td><td class="wrap">${h(t.name)}${t.desc && t.desc !== t.name ? `<br><span class="muted" style="font-size:11px">${h(t.desc)}</span>` : ""}${t.memo ? `<br><span class="muted" style="font-size:11px">메모: ${h(t.memo)}</span>` : ""}</td>
          <td class="num">${t.inAmount ? money.format(t.inAmount) : ""}</td><td class="num">${t.outAmount ? money.format(t.outAmount) : ""}</td><td class="num">${money.format(t.balance)}</td><td style="font-size:12px">${h(t.category)}</td></tr>`).join("") || `<tr><td colspan="6" class="empty">거래가 없습니다.</td></tr>`}</tbody></table></div>`}
    </div>`;
}

// --- 일일 자금보고: 날짜 이동(‹ ›·달력)과 기간(일·7일·주·월·직접) 조회 ---
const isoAdd = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const kstTodayIso = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const PERIOD_UNITS = [["day", "일"], ["7d", "7일"], ["week", "주"], ["month", "월"], ["range", "기간"]];
function periodState() {
  const cs = cashState();
  if (!cs.period) cs.period = { unit: "7d", anchor: kstTodayIso(), from: kstTodayIso(), to: isoAdd(kstTodayIso(), 6), open: "" };
  return cs.period;
}
function periodRange(p) {
  const a = p.anchor;
  if (p.unit === "day") return [a, a];
  if (p.unit === "7d") return [a, isoAdd(a, 6)];
  if (p.unit === "week") { const dow = (new Date(`${a}T00:00:00Z`).getUTCDay() + 6) % 7; const mon = isoAdd(a, -dow); return [mon, isoAdd(mon, 6)]; }
  if (p.unit === "month") { const [y, m] = a.split("-").map(Number); return [`${a.slice(0, 7)}-01`, new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)]; }
  return [p.from <= p.to ? p.from : p.to, p.from <= p.to ? p.to : p.from];
}
function shiftPeriod(p, dir) {
  if (p.unit === "day") p.anchor = isoAdd(p.anchor, dir);
  else if (p.unit === "7d" || p.unit === "week") p.anchor = isoAdd(p.anchor, 7 * dir);
  else if (p.unit === "month") { const [y, m, d] = p.anchor.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1 + dir, 1)); const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate(); p.anchor = `${t.toISOString().slice(0, 7)}-${String(Math.min(d, last)).padStart(2, "0")}`; }
  else { const len = Math.round((Date.parse(`${p.to}T00:00:00Z`) - Date.parse(`${p.from}T00:00:00Z`)) / 86400000) + 1; p.from = isoAdd(p.from, len * dir); p.to = isoAdd(p.to, len * dir); p.anchor = p.from; }
}
async function loadCashPeriod() {
  const cs = cashState();
  const p = periodState();
  const [from, to] = periodRange(p);
  cs.periodLoading = true;
  try { cs.periodData = await api(`/api/cash/period?company=${encodeURIComponent(cs.company)}&from=${from}&to=${to}`); }
  catch (e) { cs.periodData = { days: [], totals: { cashIn: 0, cashOut: 0 }, clobeError: e.message }; }
  finally { cs.periodLoading = false; }
}
function renderCashPeriod() {
  const cs = cashState();
  const p = periodState();
  const d = cs.periodData;
  const today = kstTodayIso();
  const [from, to] = periodRange(p);
  const label = p.unit === "day" ? cashDay(from) : `${cashDay(from)} ~ ${cashDay(to)}`;
  const nav = `<div class="toolbar period-nav">
      <button data-period-shift="-1" title="이전">‹</button>
      <input type="date" data-period-date value="${h(p.anchor)}" title="날짜 고르기">
      <button data-period-shift="1" title="다음">›</button>
      <button class="ghost small" data-period-today>오늘</button>
      <span class="period-label">${h(label)}</span>
      <span style="flex:1"></span>
      ${PERIOD_UNITS.map(([k, l]) => `<button class="npb-subtab ${p.unit === k ? "active" : ""}" data-period-unit="${k}">${l}</button>`).join("")}
      ${p.unit === "range" ? `<input type="date" data-period-from value="${h(p.from)}"> ~ <input type="date" data-period-to value="${h(p.to)}">` : ""}
    </div>`;
  if (!d || cs.periodLoading) return `<section class="panel">${nav}<div class="panel-body"><p class="muted">불러오는 중…</p></div></section>`;
  const net = d.totals.cashIn - d.totals.cashOut;
  const card = (t, v, cls = "") => `<div class="sales-step"><span>${t}</span><strong class="${cls}">${v == null ? "-" : `${money.format(v)}원`}</strong></div>`;
  const rows = [];
  let wIn = 0; let wOut = 0;
  const long = d.days.length > 14;
  for (const day of d.days) {
    const open = p.open === day.date;
    rows.push(`<tr class="hub-go ${day.date === today ? "today-row" : ""} ${day.balance != null && day.balance < 0 ? "cash-short" : ""}" data-period-day="${day.date}">
      <td>${h(cashDay(day.date))}${day.date === today ? ' <span class="badge">오늘</span>' : ""}</td><td><span class="badge ${day.past ? "muted" : ""}">${day.past ? "실제" : "예정"}</span></td>
      <td class="num">${day.cashIn ? money.format(day.cashIn) : ""}</td><td class="num">${day.cashOut ? money.format(day.cashOut) : ""}</td>
      <td class="num">${day.balance == null ? "-" : money.format(day.balance)}</td>
      <td class="wrap muted" style="font-size:12px">${day.items.length ? `${day.items.length}건 · ${h(day.items.slice(0, 3).map((l) => l.title).join(", "))}${day.items.length > 3 ? " 외" : ""}` : ""}</td></tr>`);
    if (open) rows.push(`<tr class="period-items"><td colspan="6"><table class="compact" data-unit="원"><tbody>${day.items.map((l) => `<tr><td class="${l.direction === "in" ? "cash-in" : "cash-out"}" style="width:1%">${l.direction === "in" ? "입금" : "출금"}</td>
      <td class="wrap">${l.overdue ? '<span class="badge warn">기한지남</span> ' : ""}${h(l.title)}${l.memo ? ` <span class="muted" style="font-size:11px">${h(l.memo)}</span>` : ""}</td><td style="font-size:12px" class="muted">${h(l.category || "")}</td><td class="num">${money.format(l.amount)}</td></tr>`).join("") || `<tr><td class="empty">내역 없음</td></tr>`}</tbody></table></td></tr>`);
    wIn += day.cashIn; wOut += day.cashOut;
    const isSunday = new Date(`${day.date}T00:00:00Z`).getUTCDay() === 0;
    if (long && (isSunday || day === d.days.at(-1))) {
      rows.push(`<tr class="period-sub"><td colspan="2">주간 합계</td><td class="num">${money.format(wIn)}</td><td class="num">${money.format(wOut)}</td><td class="num">${money.format(wIn - wOut)}</td><td class="muted" style="font-size:12px">순현금</td></tr>`);
      wIn = 0; wOut = 0;
    }
  }
  return `<section class="panel">${nav}
    ${d.clobeError ? `<div style="margin:0 16px 8px">${notice("warn", "지난 날 실제 내역·잔액을 못 불러왔습니다", h(d.clobeError))}</div>` : ""}
    <section class="sales-flow" style="padding:0 12px">
      ${card("기초 잔액", d.opening)}${card("입금 합계", d.totals.cashIn)}${card("출금 합계", d.totals.cashOut)}${card("순현금", net, net < 0 ? "danger-text" : "")}${card("기말 잔액", d.closing, d.closing != null && d.closing < 0 ? "danger-text" : "")}
      ${d.shortfallDate ? `<div class="sales-step"><span>잔액 부족 예상</span><strong class="danger-text">${h(cashDay(d.shortfallDate))}</strong></div>` : ""}
    </section>
    <div class="table-wrap"><table class="compact cash-table" data-unit="원">
      <thead><tr><th>날짜</th><th>구분</th><th>입금</th><th>출금</th><th>잔액</th><th>내역 (누르면 펼침)</th></tr></thead>
      <tbody>${rows.join("")}</tbody></table></div>
    <p class="muted" style="font-size:11px;margin:6px 16px 12px">지난 날 = 클로브 실제 입출금(내 계좌끼리 옮긴 돈 제외), 오늘부터 = 예정(고정비·지급요청·생산비·대출·회생·선매입·받을 돈). 잔액은 지금 클로브 잔액에서 이어 계산.</p>
  </section>`;
}

function renderCashReport() {
  const cs = cashState();
  const { report: r, accounts = [], fund, clobeError } = cs.data || {};
  if (!r) return `<section class="panel"><div class="panel-body"><p class="muted">${h(cs.error || "보고서를 만들지 못했습니다.")}</p></div></section>`;
  const itemRows = (items, dir) => items.filter((l) => l.direction === dir).map((l) => `
    <tr><td>${l.overdue ? `<span class="badge warn">기한지남</span> ` : ""}${h(l.title)}<br><span class="muted" style="font-size:11px">${(() => { const src = { schedule: "자금일정", payment: "지급요청", request: "선매입", sales: "받을 돈" }[l.source] || ""; return h(l.category && l.category !== src ? `${l.category} · ${src}` : src); })()}</span></td>
    <td class="num">${money.format(l.amount)}</td></tr>`).join("") || `<tr><td colspan="2" class="empty">없음</td></tr>`;
  return `
    ${clobeError ? notice("warn", "계좌 잔액을 못 불러왔습니다", h(clobeError)) : ""}
    ${renderCashPeriod()}
    <section class="layout">
      <div class="panel">
        ${(() => {
          // 위 칸은 고른 날(‹ › 로 옮긴 날). 지난 날이면 실제(클로브), 오늘부터는 예정.
          const p = periodState();
          const want = p.unit === "day" ? p.anchor : (p.selected && (cs.periodData?.days || []).some((x) => x.date === p.selected) ? p.selected : (cs.periodData?.days || []).some((x) => x.date === kstTodayIso()) ? kstTodayIso() : p.anchor);
          const sel = (cs.periodData?.days || []).find((x) => x.date === want);
          const day = sel || { date: r.start, past: false, cashIn: r.today.cashIn, cashOut: r.today.cashOut, items: r.today.items };
          const isToday = day.date === kstTodayIso();
          return `<div class="panel-head"><h2>${isToday ? "오늘 " : ""}${h(cashDay(day.date))}${day.past ? ' <span class="badge muted">실제</span>' : ""}</h2><span class="muted">현 잔액 <strong>${r.openingBalance == null ? "-" : `${money.format(r.openingBalance)}원`}</strong>${sel?.balance != null && !isToday ? ` · 그날 잔액 ${money.format(sel.balance)}원` : ""}</span></div>
          <div class="panel-body cash-two">
            <div><h3 class="cash-in">${day.past ? "들어온 돈" : "들어올 돈"} ${money.format(day.cashIn)}원</h3><table class="compact cash-table" data-unit="원"><tbody>${itemRows(day.items, "in")}</tbody></table></div>
            <div><h3 class="cash-out">${day.past ? "나간 돈" : "나갈 돈"} ${money.format(day.cashOut)}원</h3><table class="compact cash-table" data-unit="원"><tbody>${itemRows(day.items, "out")}</tbody></table></div>
          </div>`;
        })()}
      </div>
      <div class="panel">
        <div class="panel-head"><h2>계좌 잔액</h2><span class="muted">클로브 · ${fund ? `${h(fund.transactionDate)} 기준 어제 +${money.format(fund.cashIn || 0)} / ${money.format(fund.cashOut || 0)}` : ""}</span></div>
        <div class="table-wrap"><table class="compact cash-table" data-unit="원"><tbody>
          ${(() => {
            const shown = accounts.filter((a) => !a.hidden);
            const hidden = accounts.filter((a) => a.hidden);
            const row = (a) => `<tr class="acc-row ${a.hidden ? "muted" : ""}" data-acc-open="${h(a.id)}">
              <td style="width:1%">${can("cash", "edit") ? `<button class="star ${a.favorite ? "on" : ""}" data-acc-star="${h(a.id)}" title="${a.favorite ? "즐겨찾기 해제" : "즐겨찾기(일일 보고에 표시)"}">${a.favorite ? "★" : "☆"}</button>` : (a.favorite ? "★" : "")}</td>
              <td>${h(a.name)}<br><span class="muted" style="font-size:11px">${h(a.bank || "")} ${h(a.number || "")}</span></td><td class="num">${money.format(a.balance)}</td></tr>`;
            const hiddenSum = hidden.reduce((s2, a) => s2 + a.balance, 0);
            return (shown.map(row).join("") || `<tr><td class="empty" colspan="3">잔액 정보 없음</td></tr>`)
              + (hidden.length ? `<tr><td colspan="3"><button class="ghost small" data-acc-toggle-hidden>${cs.showHiddenAccounts ? "숨긴 계좌 접기" : `숨긴 계좌 ${hidden.length}개 보기 (합계 ${money.format(hiddenSum)}원)`}</button></td></tr>${cs.showHiddenAccounts ? hidden.map(row).join("") : ""}` : "");
          })()}
        </tbody></table></div>
        <p class="muted" style="font-size:11px;margin:6px 12px">★ 즐겨찾는 계좌만 일일 보고 문구에 나옵니다. 계좌를 누르면 최근 거래와 설정이 보입니다.</p>
        ${fund?.summaryText ? `<div class="panel-body"><p class="muted" style="white-space:pre-line;font-size:12px">${h(fund.summaryText)}</p></div>` : ""}
      </div>
    </section>
    <section class="panel">
      <div class="toolbar" style="padding:12px 16px">
        <button class="primary" data-cash-copy>채널톡 보고 문구 복사</button>
        <button data-cash-notice>공유함에 올리기</button>
        <button data-cash-print>인쇄·이미지 저장</button>
        <button data-cash-reload>새로고침</button>
      </div>
      <details style="padding:0 16px 16px"><summary class="muted">보고 문구 미리보기</summary><pre class="cash-text">${h(cs.data.text || "")}</pre></details>
    </section>
    ${cs.accDetail ? v2Modal(renderAccountDetail(), "data-acc-close") : ""}`;
}

function renderCashSchedules() {
  const cs = cashState();
  const meta = cs.meta || {};
  // 현금흐름표 시트 왼쪽 고정비 목록과 같은 순서: 나감 먼저, 날짜(일정) 순.
  const dayKey = (s) => s.repeat === "monthly" ? Number(s.dayOfMonth || 0) : s.repeat === "weekly" ? 0 : 99;
  const list = (cs.schedules || []).filter((s) => !s.company || s.company === cs.company)
    .sort((a, b) => String(b.direction).localeCompare(String(a.direction)) || dayKey(a) - dayKey(b) || String(a.category).localeCompare(String(b.category), "ko"));
  const when = (s) => s.repeat === "monthly" ? `매월 ${s.dayOfMonth}일` : s.repeat === "weekly" ? `매주 ${WEEKDAY_KO[s.weekday ?? 1]}요일` : (s.date || "");
  const e = { direction: "out", repeat: "monthly", dayOfMonth: 25, company: cs.company, ...(cs.editing || {}) };
  const cats = (meta.categories || {})[e.direction] || [];
  return `
    <section class="layout">
      <div class="panel">
        <div class="panel-head"><h2>고정비·자금 일정</h2><span class="muted">${list.length}건 · 현금흐름표 시트 왼쪽 고정비 목록과 같은 것 · 현금흐름표와 일일 자금보고에 예정으로 들어갑니다</span></div>
        <div class="table-wrap"><table class="compact cash-table" data-unit="원">
          <thead><tr><th>No.</th><th>구분</th><th>유형</th><th>분류</th><th>항목</th><th>금액</th><th>결제방식</th><th>일정</th><th></th></tr></thead>
          <tbody>${list.map((s, i) => `<tr class="${s.active === false ? "muted" : ""}">
            <td class="center">${h(s.sheetNo || i + 1)}</td>
            <td>${s.direction === "in" ? `<span class="cash-in">들어옴</span>` : `<span class="cash-out">나감</span>`}</td>
            <td>${h(s.kind || "")}</td><td>${h(s.category || "")}</td>
            <td class="wrap">${h(s.title)}${s.memo ? `<br><span class="muted" style="font-size:11px">${h(s.memo)}</span>` : ""}${s.active === false ? ` <span class="badge muted">꺼짐</span>` : ""}</td>
            <td class="num">${s.variable && !s.amount ? "변동" : money.format(s.amount || 0)}</td><td>${h(s.method || "")}</td>
            <td>${h(when(s))}${s.endDate ? `<br><span class="muted" style="font-size:11px">~${h(s.endDate)}</span>` : ""}</td>
            <td><div class="row-actions">${can("cash", "edit") ? `<button data-cash-edit="${s.id}">수정</button><button class="danger icon-btn" data-cash-del="${s.id}" title="삭제">×</button>` : ""}</div></td></tr>`).join("") || `<tr><td colspan="9" class="empty">등록된 일정이 없습니다. 현금흐름표 화면에서 시트를 가져오면 고정비 목록이 들어옵니다.</td></tr>`}</tbody>
        </table></div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>${cs.editing?.id ? "일정 수정" : "일정 추가"}</h2></div>
        <div class="panel-body">${can("cash", "edit") ? `
          <form class="form-grid" data-cash-form>
            <input type="hidden" name="company" value="${h(e.company)}">
            <div class="field two">
              <div><label>구분</label><select name="direction" data-cash-dir><option value="out" ${e.direction === "out" ? "selected" : ""}>나갈 돈</option><option value="in" ${e.direction === "in" ? "selected" : ""}>들어올 돈</option></select></div>
              <div><label>분류</label><select name="category"><option value="">선택</option>${cats.map((c) => `<option ${e.category === c ? "selected" : ""}>${h(c)}</option>`).join("")}</select></div>
            </div>
            <div class="field"><label>항목</label><input name="title" value="${h(e.title || "")}" required placeholder="예: 사무실 임대료"></div>
            <div class="field two">
              <div><label>금액(원)</label><input name="amount" inputmode="numeric" value="${h(e.amount ? money.format(e.amount) : "")}" required></div>
              <div><label>결제방식</label><input name="method" value="${h(e.method || "")}" placeholder="자동이체 / 계좌이체 / 카드"></div>
            </div>
            <div class="field two">
              <div><label>반복</label><select name="repeat" data-cash-repeat>${Object.entries(meta.repeats || { once: "1회", monthly: "매월", weekly: "매주" }).map(([k, l]) => `<option value="${k}" ${e.repeat === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
              <div>${e.repeat === "monthly" ? `<label>매월 며칠</label><input name="dayOfMonth" type="number" min="1" max="31" value="${h(e.dayOfMonth || 25)}">`
                : e.repeat === "weekly" ? `<label>요일</label><select name="weekday">${WEEKDAY_KO.map((w, i) => `<option value="${i}" ${Number(e.weekday ?? 1) === i ? "selected" : ""}>${w}</option>`).join("")}</select>`
                : `<label>날짜</label><input type="date" name="date" value="${h(e.date || "")}" required>`}</div>
            </div>
            ${e.repeat !== "once" ? `<div class="field two"><div><label>시작일</label><input type="date" name="startDate" value="${h(e.startDate || "")}"></div><div><label>종료일 <span class="muted" style="font-weight:400">(대출 만기 등)</span></label><input type="date" name="endDate" value="${h(e.endDate || "")}"></div></div>` : ""}
            <div class="field"><label>메모</label><input name="memo" value="${h(e.memo || "")}"></div>
            <div class="toolbar"><button class="primary" type="submit">${cs.editing?.id ? "수정 저장" : "일정 추가"}</button>${cs.editing ? `<button type="button" data-cash-cancel>취소</button>` : ""}</div>
          </form>` : `<p class="muted">자금 수정 권한이 없습니다.</p>`}</div>
      </div>
    </section>`;
}

function bindCash() {
  const cs = cashState();
  if (cs.screen === "loans" || cs.screen === "rehab" || cs.screen === "cashflow") {
    app.querySelectorAll("[data-cash-screen]").forEach((b) => b.addEventListener("click", () => { cs.screen = b.dataset.cashScreen; renderApp(); }));
    if (cs.screen === "loans") bindLoans(); else if (cs.screen === "rehab") bindRehab(); else bindCashFlow();
    return;
  }
  if (!cs.data && !cs.loading) {
    loadCash().then(renderApp);
    return;
  }
  const reload = async () => { await loadCash(); renderApp(); };
  app.querySelectorAll("[data-cash-screen]").forEach((b) => b.addEventListener("click", () => { cs.screen = b.dataset.cashScreen; renderApp(); }));
  if (cs.screen === "receivables" && !cs.rec && !cs.recLoading) {
    cs.recLoading = true;
    api("/api/receivables").then((r) => { cs.rec = r.brands || []; }).catch(() => { cs.rec = []; }).finally(() => { cs.recLoading = false; renderApp(); });
  }
  app.querySelectorAll("[data-rec-open]").forEach((tr) => tr.addEventListener("click", async () => {
    cs.recDetail = await api(`/api/receivables/${tr.dataset.recOpen}`);
    renderApp();
  }));
  app.querySelector("[data-rec-close]")?.addEventListener("click", () => { cs.recDetail = null; renderApp(); });
  bindV2Modal();
  app.querySelectorAll("[data-cash-company]").forEach((b) => b.addEventListener("click", async () => { cs.company = b.dataset.cashCompany; cs.editing = null; await reload(); }));
  app.querySelector("[data-cash-reload]")?.addEventListener("click", reload);
  // 기간 조회: 처음 열 때와 회사를 바꿨을 때 불러온다.
  const per = periodState();
  const periodKey = `${cs.company}|${periodRange(per).join("~")}`;
  if (cs.periodKey !== periodKey && !cs.periodLoading) { cs.periodKey = periodKey; loadCashPeriod().then(renderApp); }
  const repaint = () => { cs.periodKey = ""; per.selected = per.unit === "day" ? per.anchor : per.selected; renderApp(); };
  app.querySelectorAll("[data-period-shift]").forEach((b) => b.addEventListener("click", () => { shiftPeriod(per, Number(b.dataset.periodShift)); repaint(); }));
  app.querySelector("[data-period-today]")?.addEventListener("click", () => { per.anchor = kstTodayIso(); if (per.unit === "range") { per.from = per.anchor; per.to = isoAdd(per.anchor, 6); } repaint(); });
  app.querySelector("[data-period-date]")?.addEventListener("change", (e) => { if (!e.target.value) return; per.anchor = e.target.value; if (per.unit === "range") { per.from = per.anchor; } repaint(); });
  app.querySelectorAll("[data-period-unit]").forEach((b) => b.addEventListener("click", () => { per.unit = b.dataset.periodUnit; if (per.unit === "range") { [per.from, per.to] = periodRange({ ...per, unit: "7d" }); } repaint(); }));
  app.querySelector("[data-period-from]")?.addEventListener("change", (e) => { per.from = e.target.value || per.from; repaint(); });
  app.querySelector("[data-period-to]")?.addEventListener("change", (e) => { per.to = e.target.value || per.to; repaint(); });
  app.querySelectorAll("[data-period-day]").forEach((tr) => tr.addEventListener("click", () => { per.open = per.open === tr.dataset.periodDay ? "" : tr.dataset.periodDay; per.selected = tr.dataset.periodDay; renderApp(); }));
  // 계좌: 즐겨찾기 별, 숨긴 계좌 펼치기, 누르면 상세(최근 거래·설정)
  bindV2Modal();
  const accSave = async (accId, body) => {
    try { await api(`/api/cash/accounts/${cs.company}/${encodeURIComponent(accId)}`, { method: "PUT", body }); await reload(); } catch (e) { showToast(e.message || "저장하지 못했습니다.", "error"); }
  };
  app.querySelectorAll("[data-acc-star]").forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    const a = (cs.data?.accounts || []).find((x) => String(x.id) === b.dataset.accStar);
    accSave(b.dataset.accStar, { favorite: !a?.favorite });
  }));
  app.querySelector("[data-acc-toggle-hidden]")?.addEventListener("click", () => { cs.showHiddenAccounts = !cs.showHiddenAccounts; renderApp(); });
  app.querySelectorAll("[data-acc-open]").forEach((tr) => tr.addEventListener("click", async () => {
    const id = tr.dataset.accOpen;
    cs.accDetail = { id, transactions: null };
    renderApp();
    const r = await api(`/api/cash/accounts/${cs.company}/${encodeURIComponent(id)}/transactions?days=30`).catch((e) => ({ transactions: [], error: e.message }));
    if (cs.accDetail?.id === id) { cs.accDetail = { id, transactions: r.transactions || [], error: r.error || "" }; renderApp(); }
  }));
  app.querySelector("[data-acc-close]")?.addEventListener("click", () => { cs.accDetail = null; renderApp(); });
  app.querySelector("[data-acc-form]")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const keep = cs.accDetail;
    await accSave(keep.id, { alias: form.alias.value, favorite: form.favorite.checked, hidden: form.hidden.checked });
    cs.accDetail = keep;
    renderApp();
    showToast("저장했습니다.");
  });
  app.querySelector("[data-cash-print]")?.addEventListener("click", () => window.print());
  app.querySelector("[data-cash-notice]")?.addEventListener("click", async () => {
    try {
      await api("/api/notices", { method: "POST", body: { kind: "daily", title: `일일 자금보고 ${cs.data?.report?.today || ""}`.trim(), text: cs.data?.text || "" } });
      showToast("메신저 공유함에 올렸습니다.");
    } catch (e) { showToast(e.message, "error"); }
  });
  app.querySelector("[data-cash-copy]")?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(cs.data?.text || "");
      showToast("보고 문구를 복사했습니다. 채널톡에 붙여 넣으세요.");
    } catch {
      showToast("복사하지 못했습니다. 아래 미리보기를 길게 눌러 복사하세요.", "error");
    }
  });
  // 구분·반복을 바꾸면 그에 맞는 칸을 다시 그린다(입력값은 유지).
  const keep = (patch) => {
    const form = app.querySelector("[data-cash-form]");
    cs.editing = { ...(cs.editing || {}), ...(form ? formObject(form) : {}), ...patch };
    renderApp();
  };
  app.querySelector("[data-cash-dir]")?.addEventListener("change", (e) => keep({ direction: e.target.value, category: "" }));
  app.querySelector("[data-cash-repeat]")?.addEventListener("change", (e) => keep({ repeat: e.target.value }));
  app.querySelector("[data-cash-cancel]")?.addEventListener("click", () => { cs.editing = null; renderApp(); });
  app.querySelectorAll("[data-cash-edit]").forEach((b) => b.addEventListener("click", () => {
    cs.editing = (cs.schedules || []).find((s) => s.id === b.dataset.cashEdit) || null;
    renderApp();
  }));
  app.querySelectorAll("[data-cash-del]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("이 일정을 삭제할까요?")) return;
    await api(`/api/cash/schedules/${b.dataset.cashDel}`, { method: "DELETE" });
    await reload();
  }));
  app.querySelector("[data-cash-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = formObject(event.currentTarget);
    try {
      if (cs.editing?.id) await api(`/api/cash/schedules/${cs.editing.id}`, { method: "PUT", body });
      else await api("/api/cash/schedules", { method: "POST", body });
      cs.editing = null;
      showToast("저장했습니다.");
      await reload();
    } catch (error) {
      showToast(error.message || "저장하지 못했습니다.", "error");
    }
  });
}

// ===========================================================================
// v2 판매 파이프라인 — 주문접수 → 명세서 → 업체전달 → 청구·계산서 → 입금확인
// ===========================================================================
function salesState() {
  if (!state.sales) state.sales = { list: null, loading: false, filter: "open", selectedId: "", draft: null };
  return state.sales;
}

async function loadSales() {
  const ss = salesState();
  ss.loading = true;
  try {
    const res = await api("/api/sales");
    Object.assign(ss, { list: res.orders || [], meta: res });
  } catch (error) {
    ss.list = [];
    ss.error = error.message;
  } finally {
    ss.loading = false;
  }
}

// 품목 이름 → 최근 단가. 이 거래처에 예전에 낸 명세서에서 찾는다.
function salesItemHints(partnerId) {
  const map = new Map();
  for (const po of state.purchaseOrders || []) {
    if (po.docType !== "statement" || (partnerId && po.partnerId !== partnerId)) continue;
    for (const li of po.lineItems || []) {
      if (li.itemName && !map.has(li.itemName)) map.set(li.itemName, li);
    }
  }
  for (const m of state.materials || []) {
    if (m.itemName && !map.has(m.itemName)) map.set(m.itemName, { itemName: m.itemName, unitPrice: m.basePrice || 0, materialId: m.id });
  }
  return map;
}

// 서버와 같은 규칙: 거래처 기본값 → 지난 명세서 방식 → 부가세 별도.
function salesGrossMode(partner) {
  if (!partner) return false;
  const mode = partner.priceMode || (state.purchaseOrders || []).find((p) => p.partnerId === partner.id && p.docType === "statement")?.priceMode;
  return mode === "gross";
}

const SALES_NEXT_LABEL = { statement: "명세서 만들기", send: "업체 전달 표시", invoice: "청구·계산서 요청", issue: "계산서 발행 완료", receive: "입금 확인" };

function salesViewNav(ss) {
  return `<div class="npb-subnav">${[["orders", "주문"], ["pricing", "판매처 가격"]].map(([k, l]) => `<button class="npb-subtab ${(ss.view || "orders") === k ? "active" : ""}" data-sales-view="${k}">${l}</button>`).join("")}</div>`;
}

function renderSales() {
  const ss = salesState();
  if (ss.view === "pricing") return renderPricing();
  const head = pageHead("판매", "주문이 들어오면 여기서 명세서 → 업체 전달 → 청구·계산서 → 입금 확인까지 한 번에 진행합니다.") + salesViewNav(ss);
  if (ss.list === null) return `${head}<section class="panel"><div class="panel-body"><p class="muted">불러오는 중…</p></div></section>`;
  const meta = ss.meta || {};
  const labels = meta.stageLabels || {};
  const counts = {};
  for (const o of ss.list) counts[o.stage] = (counts[o.stage] || 0) + 1;
  const rec = meta.receivables || [];
  const recTotal = rec.reduce((s, r) => s + r.remaining, 0);
  const recOver = rec.filter((r) => r.overdue).reduce((s, r) => s + r.remaining, 0);
  const filters = [["open", "진행 중"], ...(meta.stages || []), ["on_hold", "보류"], ["cancelled", "취소"], ["all", "전체"]];
  const rows = ss.list
    .filter((o) => ss.filter === "all" || (ss.filter === "open" ? !["paid", "cancelled"].includes(o.stage) : o.stage === ss.filter))
    .sort((a, b) => String(b.orderDate || "").localeCompare(String(a.orderDate || "")) || String(b.createdAt).localeCompare(String(a.createdAt)));
  return `
    ${head}
    <section class="sales-flow">
      ${(meta.stages || []).map(([k, l], i) => `<button class="sales-step ${ss.filter === k ? "active" : ""}" data-sales-filter="${k}"><span>${i + 1}. ${l}</span><strong>${counts[k] || 0}</strong></button>`).join('<span class="sales-arrow">›</span>')}
      <div class="sales-step sales-rec"><span>받을 돈</span><strong>${money.format(recTotal)}원</strong>${recOver ? `<em class="danger-text">기한지남 ${money.format(recOver)}원</em>` : ""}</div>
    </section>
    <section class="layout">
      <div class="panel">
        <div class="panel-head">
          <div class="npb-subnav" style="margin:0">${filters.filter(([k]) => ["open", "on_hold", "cancelled", "all"].includes(k)).map(([k, l]) => `<button class="npb-subtab ${ss.filter === k ? "active" : ""}" data-sales-filter="${k}">${l}</button>`).join("")}</div>
          ${can("sales", "create") ? `<button class="primary" data-sales-new>새 주문</button>` : ""}
        </div>
        <div class="table-wrap"><table class="compact sales-table" data-unit="원">
          <thead><tr><th>번호</th><th>주문일</th><th>거래처</th><th>내용</th><th>금액</th><th>단계</th><th>다음 할 일</th></tr></thead>
          <tbody>${rows.map((o) => `<tr class="${ss.selectedId === o.id ? "selected" : ""}" data-sales-open="${o.id}">
            <td><span class="code-tag">${h(o.code)}</span></td><td>${h(String(o.orderDate || "").slice(5))}</td>
            <td>${h(o.partnerName)}</td><td class="wrap">${h(o.title)}${o.statementNo ? `<br><span class="muted" style="font-size:11px">${h(o.statementNo)}</span>` : ""}</td>
            <td class="num">${money.format(o.total || 0)}${o.paid && o.remaining ? `<br><span class="muted" style="font-size:11px">남음 ${money.format(o.remaining)}</span>` : ""}</td>
            <td><span class="badge ${o.stage === "paid" ? "muted" : o.stage === "on_hold" ? "warn" : ""}">${h(labels[o.stage] || o.stage)}</span></td>
            <td>${o.next ? `<span class="muted">${h(SALES_NEXT_LABEL[o.next] || "")}</span>` : ""}</td></tr>`).join("") || `<tr><td colspan="7" class="empty">해당하는 주문이 없습니다.</td></tr>`}</tbody>
        </table></div>
      </div>
      <div class="panel">${ss.selectedId ? renderSalesDetail() : renderSalesForm()}</div>
    </section>`;
}

function renderSalesForm() {
  const ss = salesState();
  if (!can("sales", "create")) return `<div class="panel-body"><p class="muted">주문을 고르면 진행 상황이 보입니다.</p></div>`;
  const d = ss.draft || { orderDate: new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10), lines: [{}, {}, {}] };
  const partners = (state.partners || []).filter((p) => p.isActive !== false && p.category !== "issuer");
  const partner = partners.find((p) => p.id === d.partnerId);
  const gross = salesGrossMode(partner);
  const hints = salesItemHints(d.partnerId);
  const pricingData = ss.pricing || {};
  const channels = (pricingData.channels || []).filter((c) => c.active !== false);
  for (const it of pricingData.items || []) if (!hints.has(it.name)) hints.set(it.name, { itemName: it.name });
  return `
    <div class="panel-head"><h2>새 주문</h2></div>
    <div class="panel-body">
      <form class="form-grid" data-sales-form>
        <div class="field two">
          <div><label>거래처</label><select name="partnerId" data-sales-partner required><option value="">선택</option>
          ${partners.map((p) => `<option value="${p.id}" ${d.partnerId === p.id ? "selected" : ""}>${h(p.code ? `${p.code} · ` : "")}${h(p.name)}</option>`).join("")}</select></div>
          <div><label>판매처 <span class="muted" style="font-weight:400">(가격 자동)</span></label><select name="salesChannelId" data-sales-channel><option value="">없음</option>
          ${channels.map((c) => `<option value="${c.id}" ${d.salesChannelId === c.id ? "selected" : ""}>${h(c.code ? `${c.code} · ` : "")}${h(c.name)}</option>`).join("")}</select></div>
        </div>
        <div class="field two">
          <div><label>주문일</label><input type="date" name="orderDate" value="${h(d.orderDate || "")}"></div>
          <div><label>입금기한</label><input type="date" name="dueDate" value="${h(d.dueDate || "")}"></div>
        </div>
        <div class="field two">
          <div><label>주문 경로</label><input name="channel" value="${h(d.channel || "")}" placeholder="전화 / 카톡 / 메일 / 발주서"></div>
          <div><label>납품지</label><input name="deliveryPlaceName" list="sales-dp" value="${h(d.deliveryPlaceName || "")}">
            <datalist id="sales-dp">${(state.deliveryPlaces || []).map((p) => `<option value="${h(p.name)}">`).join("")}</datalist></div>
        </div>
        <div class="field">
          <label>품목 <span class="muted" style="font-weight:400">(${gross ? "단가는 부가세 포함" : "단가는 부가세 별도"} · 예전 명세서 품목을 고르면 단가가 채워집니다)</span></label>
          <datalist id="sales-items">${[...hints.keys()].map((n) => `<option value="${h(n)}">`).join("")}</datalist>
          <table class="sales-lines"><thead><tr><th>품목명</th><th>수량</th><th>단가</th><th>금액</th></tr></thead><tbody>
            ${d.lines.map((l, i) => `<tr>
              <td><input data-sl-name="${i}" list="sales-items" value="${h(l.itemName || "")}"></td>
              <td><input data-sl-qty="${i}" inputmode="numeric" value="${h(l.quantity || "")}" aria-label="수량"></td>
              <td><input data-sl-price="${i}" inputmode="numeric" value="${h(l.price ? money.format(l.price) : "")}" aria-label="단가"></td>
              <td class="num">${l.quantity && l.price ? money.format(Number(l.quantity) * Number(l.price)) : ""}${l.priceNote ? `<br><span class="muted" style="font-size:11px">${h(l.priceNote)}</span>` : ""}</td></tr>`).join("")}
          </tbody></table>
          <button type="button" data-sl-add>줄 추가</button>
        </div>
        <div class="field"><label>메모</label><input name="memo" value="${h(d.memo || "")}"></div>
        <div class="toolbar"><button class="primary" type="submit">주문 등록</button></div>
      </form>
    </div>`;
}

function renderSalesDetail() {
  const ss = salesState();
  const o = (ss.list || []).find((x) => x.id === ss.selectedId);
  if (!o) return `<div class="panel-body"><p class="muted">주문을 찾을 수 없습니다.</p></div>`;
  const meta = ss.meta || {};
  const done = (k) => {
    const order = ["received", "statement", "sent", "invoiced", "paid"];
    return order.indexOf(o.stage) >= order.indexOf(k) && !["on_hold", "cancelled"].includes(o.stage);
  };
  const step = (k, label, body) => `<div class="sales-stage ${done(k) ? "done" : ""}"><div class="sales-stage-title">${done(k) ? "✓" : "○"} ${label}</div><div>${body}</div></div>`;
  const partner = (state.partners || []).find((p) => p.id === o.partnerId);
  const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  return `
    <div class="panel-head"><h2>${h(o.code)} · ${h(o.partnerName)}</h2><button data-sales-close>닫기</button></div>
    <div class="panel-body">
      <p><strong>${money.format(o.total || 0)}원</strong> <span class="muted">(공급가 ${money.format(o.subtotal || 0)} + 부가세 ${money.format(o.vat || 0)})</span><br>
        <span class="muted">${h(o.title)} · 주문일 ${h(o.orderDate || "")}${o.dueDate ? ` · 입금기한 ${h(o.dueDate)}` : ""}</span></p>
      ${step("statement", "명세서", o.statementId
        ? `${h(o.statementNo)} <a href="/api/purchase-orders/${h(o.statementId)}/excel">엑셀</a> · <a href="/api/purchase-orders/${h(o.statementId)}/pdf" target="_blank">PDF</a>`
        : can("sales", "edit") ? `<button class="primary" data-sales-step="statement">명세서 만들기</button>` : "")}
      ${step("sent", "업체 전달", o.sentAt ? `${h(o.sentAt)} · ${h(o.sentMethod || "")}`
        : o.statementId && can("sales", "edit") ? `<select data-sales-send-method>${(meta.sendMethods || []).map((m) => `<option>${h(m)}</option>`).join("")}</select> <button data-sales-step="send">전달했음</button>` : "")}
      ${step("invoiced", "청구·계산서", o.invoice?.requestedAt
        ? `${h(o.invoice.type)} · <span class="badge ${o.invoice.status === "issued" ? "muted" : "warn"}">${h((meta.invoiceStatuses || {})[o.invoice.status] || o.invoice.status)}</span>
           ${o.invoice.issuedAt ? ` ${h(o.invoice.issuedAt)} 발행` : ""}${o.invoice.email ? `<br><span class="muted">${h(o.invoice.email)}</span>` : ""}${o.invoice.content ? `<br><span class="muted">${h(o.invoice.content)}</span>` : ""}
           ${o.invoice.status === "requested" && can("sales", "invoice") ? `<br><button data-sales-step="issue">발행 완료</button>` : ""}`
        : o.sentAt && can("sales", "edit") ? `
          <div class="field two"><div><select data-sales-inv-type>${(meta.invoiceTypes || []).map((t) => `<option>${h(t)}</option>`).join("")}</select></div>
          <div><input type="date" data-sales-inv-due value="${h(o.dueDate || "")}" title="입금기한"></div></div>
          <input data-sales-inv-email value="${h(partner?.invoiceEmail || "")}" placeholder="발행용 이메일">
          <input data-sales-inv-content placeholder="발행내용(필요시)">
          <button data-sales-step="invoice">청구·계산서 요청</button>` : "")}
      ${step("paid", "입금 확인", `${(o.receipts || []).map((r) => `<div>${h(r.date)} ${money.format(r.amount)}원 ${r.memo ? `· ${h(r.memo)}` : ""}</div>`).join("")}
        ${o.remaining > 0 && o.stage !== "cancelled" && can("sales", "receive") ? `<div class="toolbar"><input data-sales-rcv-amount inputmode="numeric" value="${money.format(o.remaining)}" style="width:120px"><input type="date" data-sales-rcv-date value="${today}"><button data-sales-step="receive">입금 확인</button></div>` : ""}`)}
      <div class="toolbar" style="margin-top:12px">
        ${can("sales", "edit") && !["paid", "cancelled", "on_hold"].includes(o.stage) ? `<button data-sales-step="hold">보류</button>` : ""}
        ${can("sales", "edit") && ["on_hold", "cancelled"].includes(o.stage) ? `<button data-sales-step="reopen">다시 진행</button>` : ""}
        ${can("sales", "edit") && !["paid", "cancelled"].includes(o.stage) ? `<button class="danger" data-sales-step="cancel">취소</button>` : ""}
      </div>
      ${(o.history || []).length ? `<details><summary class="muted">기록 ${o.history.length}건</summary>${o.history.map((x) => `<div class="muted" style="font-size:12px">${h(String(x.at).slice(0, 16).replace("T", " "))} · ${h(x.by)} · ${h(x.action)} ${x.note ? `· ${h(x.note)}` : ""}</div>`).join("")}</details>` : ""}
    </div>`;
}

function bindSales() {
  const ss = salesState();
  app.querySelectorAll("[data-sales-view]").forEach((b) => b.addEventListener("click", () => { ss.view = b.dataset.salesView; renderApp(); }));
  if (ss.view === "pricing") { bindPricing(); return; }
  if (!ss.pricing && !ss.pricingLoading) {
    // 주문 입력에서 판매처를 고를 수 있게 판매처 목록도 불러 둔다.
    ss.pricingLoading = true;
    api("/api/pricing").then((r) => { ss.pricing = r; }).catch(() => { ss.pricing = { channels: [] }; }).finally(() => { ss.pricingLoading = false; renderApp(); });
  }
  if (ss.list === null && !ss.loading) {
    loadSales().then(renderApp);
    return;
  }
  const reload = async () => { await loadSales(); renderApp(); };
  const readDraft = () => {
    const form = app.querySelector("[data-sales-form]");
    if (!form) return ss.draft;
    const f = formObject(form);
    const lines = [...form.querySelectorAll("[data-sl-name]")].map((el) => {
      const i = el.dataset.slName;
      return {
        itemName: el.value.trim(),
        quantity: Number(String(form.querySelector(`[data-sl-qty="${i}"]`).value).replace(/,/g, "")) || "",
        price: Number(String(form.querySelector(`[data-sl-price="${i}"]`).value).replace(/,/g, "")) || "",
        priceNote: ss.draft?.lines?.[i]?.priceNote || ""
      };
    });
    return { ...f, lines };
  };
  app.querySelectorAll("[data-sales-filter]").forEach((b) => b.addEventListener("click", () => { ss.filter = b.dataset.salesFilter; renderApp(); }));
  app.querySelector("[data-sales-new]")?.addEventListener("click", () => { ss.selectedId = ""; ss.draft = null; renderApp(); });
  app.querySelector("[data-sales-close]")?.addEventListener("click", () => { ss.selectedId = ""; renderApp(); });
  app.querySelectorAll("[data-sales-open]").forEach((tr) => tr.addEventListener("click", () => { ss.selectedId = tr.dataset.salesOpen; renderApp(); }));
  app.querySelector("[data-sales-partner]")?.addEventListener("change", () => { ss.draft = readDraft(); renderApp(); });
  app.querySelector("[data-sales-channel]")?.addEventListener("change", () => {
    const d = readDraft();
    const ch = (ss.pricing?.channels || []).find((c) => c.id === d.salesChannelId);
    if (ch?.partnerId && !d.partnerId) d.partnerId = ch.partnerId;
    ss.draft = d;
    renderApp();
  });
  app.querySelector("[data-sl-add]")?.addEventListener("click", () => { const d = readDraft(); d.lines.push({}); ss.draft = d; renderApp(); });
  // 품목을 고르면 예전 단가를 채운다.
  app.querySelectorAll("[data-sl-name]").forEach((el) => el.addEventListener("change", async () => {
    const d = readDraft();
    const partner = (state.partners || []).find((p) => p.id === d.partnerId);
    const gross = salesGrossMode(partner);
    const hint = salesItemHints(d.partnerId).get(el.value.trim());
    const i = Number(el.dataset.slName);
    // 판매처를 골랐으면 판매처 가격 체계에서 먼저 찾는다.
    if (d.salesChannelId && el.value.trim() && !d.lines[i].price) {
      try {
        const q = new URLSearchParams({ channelId: d.salesChannelId, itemName: el.value.trim(), date: d.orderDate || "" });
        const r = await api(`/api/pricing/lookup?${q}`);
        if (r.found) {
          d.lines[i].price = gross ? r.gross : r.supply;
          d.lines[i].priceNote = `판매처 가격 · ${r.note}`;
        }
      } catch { /* fall back to past statements */ }
    }
    if (hint && !d.lines[i].price && hint.unitPrice != null) d.lines[i].price = gross ? (hint.grossUnitPrice || hint.unitPrice) : hint.unitPrice;
    if (hint) d.lines[i].materialId = hint.materialId || "";
    ss.draft = d;
    renderApp();
  }));
  app.querySelectorAll("[data-sl-qty], [data-sl-price]").forEach((el) => el.addEventListener("change", () => { ss.draft = readDraft(); renderApp(); }));
  app.querySelector("[data-sales-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const d = readDraft();
    const partner = (state.partners || []).find((p) => p.id === d.partnerId);
    const gross = salesGrossMode(partner);
    const dp = (state.deliveryPlaces || []).find((p) => p.name === d.deliveryPlaceName) || (d.deliveryPlaceName ? { name: d.deliveryPlaceName } : null);
    const lineItems = d.lines.filter((l) => l.itemName && l.quantity).map((l) => ({
      itemName: l.itemName, quantity: l.quantity, materialId: l.materialId || "",
      unitPrice: gross ? Math.round(Number(l.price || 0) / 1.1) : Number(l.price || 0),
      grossUnitPrice: gross ? Number(l.price || 0) : Math.round(Number(l.price || 0) * 1.1)
    }));
    try {
      const res = await api("/api/sales", { method: "POST", body: { partnerId: d.partnerId, salesChannelId: d.salesChannelId || "", orderDate: d.orderDate, dueDate: d.dueDate, channel: d.channel, memo: d.memo, deliveryPlace: dp, lineItems } });
      ss.draft = null;
      ss.selectedId = res.order.id;
      showToast(`${res.order.code} 주문을 등록했습니다. 이어서 명세서를 만드세요.`);
      await reload();
    } catch (error) {
      showToast(error.message || "등록하지 못했습니다.", "error");
    }
  });
  app.querySelectorAll("[data-sales-step]").forEach((b) => b.addEventListener("click", async () => {
    const step = b.dataset.salesStep;
    const q = (sel) => app.querySelector(sel)?.value;
    const body = {};
    if (step === "send") body.method = q("[data-sales-send-method]");
    if (step === "invoice") Object.assign(body, { type: q("[data-sales-inv-type]"), dueDate: q("[data-sales-inv-due]"), email: q("[data-sales-inv-email]"), content: q("[data-sales-inv-content]") });
    if (step === "receive") Object.assign(body, { amount: q("[data-sales-rcv-amount]"), date: q("[data-sales-rcv-date]") });
    if (step === "cancel" && !confirm("이 주문을 취소할까요?")) return;
    if (step === "hold") { const note = prompt("보류 사유"); if (note === null) return; body.note = note; }
    try {
      await api(`/api/sales/${ss.selectedId}/${step}`, { method: "POST", body });
      if (step === "statement") state.purchaseOrders = (await api("/api/purchase-orders")).purchaseOrders;
      showToast("처리했습니다.");
      await reload();
    } catch (error) {
      showToast(error.message || "처리하지 못했습니다.", "error");
    }
  }));
}

// ===========================================================================
// v2 판매처 가격 — 판매처 기본 규칙 + 판매처 × 품목 예외 (docs/v2 §9)
// ===========================================================================
const PRICE_SOURCE_LABEL = { exception: "예외", rule: "규칙", list: "정가" };

// v2 화면 공통: 상세는 팝업으로 띄운다(목록은 넓게, 좌우 스크롤 없이). closeAttr 은 닫기 버튼의 data- 속성.
function v2Modal(inner, closeAttr) {
  return `<div class="v2-modal-backdrop" data-modal-close="${closeAttr}"><div class="v2-modal panel" role="dialog" aria-modal="true">${inner}</div></div>`;
}
// 팝업 바깥을 누르거나 Esc 를 누르면 닫기 버튼을 누른 것처럼.
function bindV2Modal() {
  const bd = app.querySelector(".v2-modal-backdrop");
  if (!bd) return;
  const close = () => bd.querySelector(`[${bd.dataset.modalClose}]`)?.click();
  bd.addEventListener("click", (e) => { if (e.target === bd) close(); });
  if (!window.__v2EscBound) {
    window.__v2EscBound = true;
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      const b = document.querySelector(".v2-modal-backdrop");
      b?.querySelector(`[${b.dataset.modalClose}]`)?.click();
    });
  }
}
// 표 머리글을 값 정렬에 맞춘다: 숫자 열이면 머리글도 오른쪽, 금액 표(data-unit)면 '원' 표시.
function alignV2Tables(root = app) {
  root.querySelectorAll("table.compact").forEach((t) => {
    const head = t.tHead?.rows?.[0];
    const body = t.tBodies?.[0];
    if (!head || !body) return;
    [...head.cells].forEach((th, i) => {
      const cells = [...body.rows].map((r) => r.cells[i]).filter(Boolean);
      const nums = cells.filter((c) => c.classList.contains("num")).length;
      if (cells.length && nums >= cells.length / 2) {
        th.classList.add("num");
        // 클로브처럼 금액 칸마다 '원'을 붙인다(머리글이 아니라 값에).
        if (t.dataset.unit && !th.dataset.nounit) {
          for (const c of cells) {
            if (!c.classList.contains("num") || c.dataset.unitDone) continue;
            c.dataset.unitDone = "1";
            const walker = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
            const first = walker.nextNode();
            if (first && /^\s*[+-]?[\d,]+\s*$/.test(first.nodeValue) && /\d/.test(first.nodeValue)) first.nodeValue = `${first.nodeValue.trim()}${t.dataset.unit}`;
          }
        }
      }
    });
  });
}

async function loadPricing(selectId) {
  const ss = salesState();
  ss.pricing = await api("/api/pricing");
  const id = selectId ?? ss.pricingSel ?? "";
  ss.pricingSel = id;
  ss.pricingSheet = id ? await api(`/api/pricing/channels/${id}/sheet`) : null;
}

function renderPricing() {
  const ss = salesState();
  const head = pageHead("판매", "판매처마다 기본 가격 규칙을 정하고, 다른 품목만 예외로 적습니다. 값은 예외 → 판매처 규칙 → 정가 순서로 찾습니다.") + salesViewNav(ss);
  const p = ss.pricing;
  if (!p) return `${head}<section class="panel"><div class="panel-body"><p class="muted">불러오는 중…</p></div></section>`;
  const modes = p.modes || {};
  const types = p.types || {};
  const rows = (p.channels || []).map((c) => `<tr class="${ss.pricingSel === c.id ? "selected" : ""}" data-pricing-open="${c.id}">
    <td><span class="code-tag">${h(c.code || "")}</span></td><td>${h(c.name)}${c.active === false ? ' <span class="badge muted">중지</span>' : ""}</td>
    <td>${c.pricingMode ? `${h(modes[c.pricingMode])}${c.rate ? ` ${c.rate}%` : ""}` : '<span class="badge warn">미지정</span>'}<br><span class="muted" style="font-size:11px">${h(types[c.type] || "")} · VAT ${c.vatMode === "excluded" ? "별도" : "포함"}${c.exceptionCount ? ` · 예외 ${c.exceptionCount}` : ""}</span></td>
    <td class="num">${c.feeRate ? `${Math.round(c.feeRate * 100) / 100}%` : ""}</td>
    <td class="num">${c.missing ? `<span class="danger-text">${c.missing}</span>` : ""}</td></tr>`).join("");
  return `${head}
    <section class="v2-wide">
      <div class="panel">
        <div class="panel-head"><h2>판매처</h2>
          ${p.canEdit ? `<div class="toolbar"><button data-pricing-seed>NPB 채널에서 가져오기</button><button class="primary" data-pricing-new>판매처 추가</button></div>` : ""}</div>
        <div class="table-wrap"><table class="compact">
          <thead><tr><th>코드</th><th>판매처</th><th>기본 가격</th><th>수수료</th><th>가격 없음</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="5" class="empty">판매처가 없습니다. 'NPB 채널에서 가져오기'로 시작하세요. 모르는 칸은 '확인 필요'에 질문으로 쌓입니다.</td></tr>`}</tbody>
        </table></div>
      </div>
    </section>
    ${ss.pricingSel === "new" ? v2Modal(`<div class="panel-head"><h2>판매처 추가</h2><button data-pricing-close>닫기</button></div><div class="panel-body">${renderPricingChannelForm({})}</div>`, "data-pricing-close")
      : ss.pricingSheet ? v2Modal(renderPricingSheet(), "data-pricing-close") : ""}`;
}

function renderPricingChannelForm(c) {
  const p = salesState().pricing;
  const opt = (obj, cur) => Object.entries(obj).map(([k, l]) => `<option value="${k}" ${cur === k ? "selected" : ""}>${h(l)}</option>`).join("");
  const partners = (state.partners || []).filter((x) => x.isActive !== false && x.category !== "issuer");
  return `<form class="form-grid" data-pricing-channel-form="${h(c.id || "")}">
    <div class="field two"><div><label>판매처 이름</label><input name="name" value="${h(c.name || "")}" required></div>
      <div><label>유형</label><select name="type">${opt(p.types, c.type)}</select></div></div>
    <div class="field two"><div><label>기본 가격 방식</label><select name="pricingMode"><option value="">미지정</option>${opt(p.modes, c.pricingMode)}</select></div>
      <div><label>할인율·공급률 %</label><input name="rate" inputmode="decimal" value="${h(c.rate || "")}"></div></div>
    <div class="field two"><div><label>금액 기준</label><select name="vatMode">${opt({ included: "VAT 포함", excluded: "VAT 별도" }, c.vatMode)}</select></div>
      <div><label>판매수수료 %</label><input name="feeRate" inputmode="decimal" value="${h(c.feeRate || "")}"></div></div>
    <div class="field two"><div><label>끝전 단위</label><select name="roundUnit">${(p.roundUnits || [1]).map((u) => `<option value="${u}" ${Number(c.roundUnit || 1) === u ? "selected" : ""}>${u}원</option>`).join("")}</select></div>
      <div><label>끝전 처리</label><select name="roundMethod">${opt(p.roundMethods, c.roundMethod || "round")}</select></div></div>
    <div class="field two"><div><label>거래처(명세서 상대)</label><select name="partnerId"><option value="">없음</option>
      ${partners.map((x) => `<option value="${x.id}" ${c.partnerId === x.id ? "selected" : ""}>${h(x.name)}</option>`).join("")}</select></div>
      <div><label>NPB 채널 코드 <span class="muted" style="font-weight:400">(쉼표)</span></label><input name="npbChannelCodes" value="${h((c.npbChannelCodes || []).join(", "))}"></div></div>
    ${c.id ? `<label class="check"><input type="checkbox" name="active" ${c.active !== false ? "checked" : ""}> 사용 중</label>` : ""}
    <div class="toolbar"><button class="primary" type="submit">${c.id ? "규칙 저장" : "추가"}</button></div>
  </form>`;
}

function renderPricingSheet() {
  const ss = salesState();
  const { channel: c, rows = [], exceptions = [], date } = ss.pricingSheet;
  const canEdit = ss.pricing?.canEdit;
  const items = ss.pricing?.items || [];
  return `
    <div class="panel-head"><h2>${h(c.code || "")} ${h(c.name)}</h2><button data-pricing-close>닫기</button></div>
    <div class="panel-body">
      ${canEdit ? `<details ${c.pricingMode ? "" : "open"}><summary>기본 규칙 고치기</summary>${renderPricingChannelForm(c)}</details>` : ""}
      <h3 style="margin-top:16px">품목별 가격 <span class="muted" style="font-weight:400;font-size:12px">${h(date)} 기준 · ${c.vatMode === "excluded" ? "단가는 VAT 별도" : "단가는 VAT 포함"}</span></h3>
      <div class="table-wrap"><table class="compact" data-unit="원">
        <thead><tr><th>품목</th><th>정가</th><th>단가</th><th>공급가</th><th>세액</th><th data-nounit="1">수수료</th><th>근거</th></tr></thead>
        <tbody>${rows.map((r) => `<tr>
          <td class="wrap pricing-item">${h(r.name)}</td><td class="num">${money.format(r.listPrice || 0)}</td>
          ${r.status === "ok" ? `<td class="num"><strong>${money.format(r.unitPrice)}</strong></td><td class="num">${money.format(r.supply)}</td><td class="num">${money.format(r.vat)}</td>`
            : `<td colspan="3"><span class="badge warn">${h(r.note)}</span></td>`}
          <td class="num">${r.feeRate ? `${Math.round(r.feeRate * 100) / 100}%` : ""}</td>
          <td>${r.source ? `<span class="badge ${r.source === "exception" ? "" : "muted"}">${h(PRICE_SOURCE_LABEL[r.source])}</span> <span class="muted" style="font-size:11px">${h(r.status === "ok" && r.source !== "list" ? r.note : "")}</span>` : ""}</td></tr>`).join("")
          || `<tr><td colspan="7" class="empty">값을 매길 품목이 없습니다. NPB 제품과, 사업부가 PB·NPB인 브랜드의 단가표 품목이 여기 나옵니다.</td></tr>`}</tbody>
      </table></div>
      ${canEdit ? `<h3 style="margin-top:16px">예외 추가</h3>
      <form class="form-grid" data-pricing-ex-form>
        <div class="field"><label>품목</label><select name="itemRef" required><option value="">선택</option>${items.map((it) => `<option value="${h(it.ref)}">${h(it.name)}</option>`).join("")}</select></div>
        <div class="field two"><div><label>방식</label><select name="mode"><option value="fixed">고정가</option><option value="discount">할인율 %</option><option value="supply_rate">공급률 %</option><option value="">가격은 규칙대로(수수료만)</option></select></div>
          <div><label>고정가 또는 %</label><input name="value" inputmode="decimal"></div></div>
        <div class="field two"><div><label>고정가 기준</label><select name="vatMode"><option value="">판매처 기준 따름</option><option value="included">VAT 포함</option><option value="excluded">VAT 별도</option></select></div>
          <div><label>수수료 % (다를 때만)</label><input name="feeRate" inputmode="decimal"></div></div>
        <div class="field two"><div><label>시작일 (행사)</label><input type="date" name="from"></div><div><label>종료일</label><input type="date" name="to"></div></div>
        <div class="field"><label>메모</label><input name="note"></div>
        <div class="toolbar"><button class="primary" type="submit">예외 저장</button></div>
      </form>` : ""}
      <h3 style="margin-top:16px">예외 목록</h3>
      <div class="table-wrap"><table class="compact">
        <thead><tr><th>품목</th><th>내용</th><th>기간</th><th>근거</th><th></th></tr></thead>
        <tbody>${exceptions.map((x) => `<tr class="${x.active === false ? "muted" : ""}">
          <td class="wrap">${h(x.itemName || (items.find((it) => it.ref === x.itemRef) || {}).name || x.itemRef)}</td>
          <td>${x.mode === "fixed" ? `${money.format(x.price)}원${x.vatMode === "excluded" ? "(VAT별도)" : x.vatMode === "included" ? "(VAT포함)" : ""}` : x.mode ? `${h((ss.pricing.modes || {})[x.mode])} ${x.rate}%` : ""}${x.feeRate !== undefined ? ` · 수수료 ${x.feeRate}%` : ""}</td>
          <td>${x.from || x.to ? `${h(x.from || "")}~${h(x.to || "")}` : "상시"}</td>
          <td class="muted" style="font-size:11px">${h(x.source || "")}${x.active === false ? " · 해제됨" : ""}</td>
          <td>${canEdit && x.active !== false ? `<button data-pricing-ex-off="${h(x.id)}">해제</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="5" class="empty">예외가 없습니다.</td></tr>`}</tbody>
      </table></div>
    </div>`;
}

function bindPricing() {
  const ss = salesState();
  if (!ss.pricing && !ss.pricingLoading) {
    ss.pricingLoading = true;
    loadPricing().catch((e) => showToast(e.message, "error")).finally(() => { ss.pricingLoading = false; renderApp(); });
    return;
  }
  const refresh = async (sel) => { await loadPricing(sel); renderApp(); };
  bindV2Modal();
  app.querySelectorAll("[data-pricing-open]").forEach((tr) => tr.addEventListener("click", () => refresh(tr.dataset.pricingOpen).catch((e) => showToast(e.message, "error"))));
  app.querySelector("[data-pricing-close]")?.addEventListener("click", () => { ss.pricingSel = ""; ss.pricingSheet = null; renderApp(); });
  app.querySelector("[data-pricing-new]")?.addEventListener("click", () => { ss.pricingSel = "new"; ss.pricingSheet = null; renderApp(); });
  app.querySelector("[data-pricing-seed]")?.addEventListener("click", async () => {
    if (!confirm("NPB 채널 설정에서 판매처·공급가·수수료를 가져옵니다. 이미 있는 판매처와 고친 예외는 그대로 둡니다. 진행할까요?")) return;
    try {
      const r = await api("/api/pricing/seed", { method: "POST", body: {} });
      showToast(`판매처 ${r.channels}곳, 예외 ${r.exceptions}건을 만들었습니다. 확인 필요 질문 ${r.questions}건(새 질문 ${r.newQuestions}건).`);
      await refresh();
    } catch (e) { showToast(e.message || "가져오지 못했습니다.", "error"); }
  });
  app.querySelector("[data-pricing-channel-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = formObject(form);
    body.active = form.querySelector('[name="active"]') ? form.querySelector('[name="active"]').checked : true;
    const cid = form.dataset.pricingChannelForm;
    try {
      const r = await api(cid ? `/api/pricing/channels/${cid}` : "/api/pricing/channels", { method: cid ? "PUT" : "POST", body });
      showToast("저장했습니다.");
      await refresh(r.channel.id);
    } catch (e) { showToast(e.message || "저장하지 못했습니다.", "error"); }
  });
  app.querySelector("[data-pricing-ex-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const f = formObject(event.currentTarget);
    const body = { channelId: ss.pricingSel, itemRef: f.itemRef, mode: f.mode, vatMode: f.vatMode, from: f.from, to: f.to, note: f.note, feeRate: f.feeRate };
    if (f.mode === "fixed") body.price = f.value; else if (f.mode) body.rate = f.value;
    try {
      await api("/api/pricing/exceptions", { method: "POST", body });
      showToast("예외를 저장했습니다.");
      await refresh();
    } catch (e) { showToast(e.message || "저장하지 못했습니다.", "error"); }
  });
  app.querySelectorAll("[data-pricing-ex-off]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("이 예외를 해제할까요? 기록은 남습니다.")) return;
    try {
      await api(`/api/pricing/exceptions/${encodeURIComponent(b.dataset.pricingExOff)}`, { method: "DELETE" });
      await refresh();
    } catch (e) { showToast(e.message, "error"); }
  }));
}

// ===========================================================================
// v2 생산·재고 — 원부자재 재고 / 입출고 / 생산 기록 / 제품 구성(BOM)
// ===========================================================================
function stockState() {
  if (!state.stock) state.stock = { screen: "status", data: null, loading: false, editingProduct: null, settingFor: "" };
  return state.stock;
}
async function loadStock() {
  const st = stockState();
  st.loading = true;
  try { st.data = await api("/api/stock"); } catch (error) { st.error = error.message; st.data = { status: [], moves: [], runs: [], products: [], locations: [], settings: {} }; } finally { st.loading = false; }
}
const qtyFmt = (n) => (Number(n || 0) % 1 ? Number(n).toLocaleString("ko-KR", { maximumFractionDigits: 3 }) : money.format(Number(n || 0)));

// ===========================================================================
// v2 입점사 월정산 보드 — 브랜드별 매출·배송비·회수·마진 + 확인/발행요청/발송 체크
// ===========================================================================
// ===========================================================================
// 노션 기록 — 옛 결제업무 요청·세금계산서 발행 요청(2022~) 검색. 가져오기는 대표.
// ===========================================================================
function notionState() {
  if (!state.notionArchive) state.notionArchive = { kind: "payments", q: "", year: "", partnerId: "", partnerName: "", data: null, loading: false };
  return state.notionArchive;
}
async function loadNotionArchive() {
  const ns = notionState();
  ns.loading = true;
  const qs = new URLSearchParams({ kind: ns.kind, q: ns.q, year: ns.year, partnerId: ns.partnerId });
  try { ns.data = await api(`/api/archive/notion?${qs}`); } catch (e) { ns.data = { rows: [], years: [], count: 0, total: 0, imported: 0 }; showToast(e.message, "error"); }
  finally { ns.loading = false; }
}
function renderNotionArchive() {
  const ns = notionState();
  const head = pageHead("노션 기록", "노션의 결제업무 요청·세금계산서 발행 요청(2022~)을 찾아봅니다. 거래처는 예전 이름까지 함께 찾습니다. 첨부파일은 노션 원본에 있습니다.");
  const d = ns.data;
  if (!d) return `${head}<section class="panel"><div class="panel-body"><p class="muted">불러오는 중…</p></div></section>`;
  const isPay = ns.kind === "payments";
  const rows = d.rows.map((r) => isPay
    ? `<tr><td class="nowrap">${h(String(r.createdAt).slice(0, 10))}</td><td>${h(r.vendorName)}</td><td class="wrap">${h(r.title)}${r.files?.length ? ` <span class="muted" title="${h(r.files.join(", "))}">📎${r.files.length}</span>` : ""}</td><td class="num">${money.format(r.amount || 0)}</td><td>${h(r.status)}</td><td class="wrap muted" style="font-size:12px">${h([r.category, r.midCategory, r.subCategory].filter(Boolean).join(" › "))}</td><td class="muted" style="font-size:12px">${h(r.withdrawAccount)}</td><td>${r.vendorUrl ? `<a href="${h(r.vendorUrl)}" target="_blank" rel="noopener">노션</a>` : ""}</td></tr>`
    : `<tr><td class="nowrap">${h(r.issuedAt)}</td><td>${h(r.partnerName)}</td><td class="wrap">${h(r.title)}</td><td class="num">${money.format(r.amount || 0)}</td><td>${h(r.status)}</td><td class="muted" style="font-size:12px">${h(r.kind)}</td><td class="muted">${h(r.paidOrDue)}</td><td>${r.partnerUrl ? `<a href="${h(r.partnerUrl)}" target="_blank" rel="noopener">노션</a>` : ""}</td></tr>`).join("");
  const importer = state.admin?.role === "owner" ? `<details style="margin-top:14px"><summary>노션 내보내기(CSV) 가져오기 ${d.imported ? `<span class="muted">— 지금 ${money.format(d.imported)}건 있음, 다시 가져와도 겹치지 않음</span>` : ""}</summary>
      <form data-notion-import class="form-grid" style="margin-top:8px">
        <div class="field"><label>결제업무 요청 CSV (_all.csv)</label><input type="file" name="payments" accept=".csv"></div>
        <div class="field"><label>발주 및 정산 업체 정보 CSV</label><input type="file" name="vendors" accept=".csv"></div>
        <div class="field"><label>세금계산서 발행 요청 CSV</label><input type="file" name="invoices" accept=".csv"></div>
        <div class="field"><label>영업거래처 대장 CSV</label><input type="file" name="salesPartners" accept=".csv"></div>
        <div class="toolbar"><button type="submit" data-dry="1">미리 보기</button><button class="primary" type="submit">가져오기</button></div>
      </form>${ns.preview ? `<pre class="muted" style="white-space:pre-wrap;font-size:12px">${h(ns.preview)}</pre>` : ""}</details>` : "";
  return `${head}
    <section class="panel"><div class="panel-body">
      <div class="toolbar chip-row">
        <button class="npb-subtab ${isPay ? "active" : ""}" data-notion-kind="payments">결제업무 요청</button>
        <button class="npb-subtab ${!isPay ? "active" : ""}" data-notion-kind="invoices">세금계산서 발행 요청</button>
        <select data-notion-year><option value="">전체 연도</option>${d.years.map((y) => `<option ${ns.year === y ? "selected" : ""}>${h(y)}</option>`).join("")}</select>
        <input data-notion-q placeholder="내용·거래처·분류·금액 검색" value="${h(ns.q)}" style="min-width:240px">
        ${ns.partnerId ? `<span class="pill">거래처: ${h(ns.partnerName)} <button class="small ghost" data-notion-clear-partner>✕</button></span>` : ""}
      </div>
      <p class="muted">${money.format(d.count)}건 · ${money.format(d.total)}원${d.count > d.rows.length ? ` (최근 ${d.rows.length}건만 표시)` : ""}</p>
      <div class="table-wrap"><table class="compact" data-unit="원"><thead><tr>${isPay ? "<th>작성일</th><th>거래처</th><th>내용</th><th>금액</th><th>상태</th><th>분류</th><th>출금계좌</th><th></th>" : "<th>발행일</th><th>거래처</th><th>내용</th><th>금액</th><th>상태</th><th>구분</th><th>입금일/기한</th><th></th>"}</tr></thead>
      <tbody>${rows || `<tr><td colspan="8" class="empty">${d.imported ? "찾는 기록이 없습니다." : "아직 노션 기록을 가져오지 않았습니다."}</td></tr>`}</tbody></table></div>
      ${importer}
    </div></section>`;
}
function bindNotionArchive() {
  const ns = notionState();
  if (!ns.data && !ns.loading) { loadNotionArchive().then(renderApp); return; }
  const reload = () => { ns.data = null; renderApp(); };
  app.querySelectorAll("[data-notion-kind]").forEach((b) => b.addEventListener("click", () => { ns.kind = b.dataset.notionKind; reload(); }));
  app.querySelector("[data-notion-year]")?.addEventListener("change", (e) => { ns.year = e.target.value; reload(); });
  app.querySelector("[data-notion-clear-partner]")?.addEventListener("click", () => { ns.partnerId = ""; ns.partnerName = ""; reload(); });
  const qi = app.querySelector("[data-notion-q]");
  qi?.addEventListener("keydown", (e) => { if (e.key === "Enter") { ns.q = qi.value; reload(); } });
  qi?.addEventListener("change", () => { if (ns.q !== qi.value) { ns.q = qi.value; reload(); } });
  app.querySelector("[data-notion-import]")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const dryRun = Boolean(e.submitter?.dataset.dry);
    const form = e.currentTarget;
    const files = {};
    for (const k of ["payments", "vendors", "invoices", "salesPartners"]) {
      const f = form.querySelector(`[name=${k}]`).files[0];
      if (f) files[k] = await f.text();
    }
    if (!Object.keys(files).length) { showToast("CSV 파일을 고르세요.", "error"); return; }
    try {
      const r = await api("/api/archive/notion/import", { method: "POST", body: { files, dryRun } });
      const sm = r.summary;
      ns.preview = `${dryRun ? "[미리 보기] " : ""}결제 ${sm.payments}건 · 계산서 ${sm.invoices}건 · 새 거래처 ${sm.partnersNew}곳(활성 ${sm.partnersNewActive}) · 기존 거래처 보완 ${sm.partnersUpdated}곳`
        + (r.preview ? `\n새로: ${r.preview.creates.map((c) => `${c.name}${c.active ? "" : "(보관)"}`).join(", ")}\n보완: ${r.preview.updates.join(", ")}` : "");
      if (!dryRun) { showToast("가져왔습니다."); await refreshAndRender(); }
      reload();
    } catch (err) { showToast(err.message, "error"); }
  });
}

// ===========================================================================
// v2 메신저 공유함 — 담당자가 봐야 할 알림(입금요청·지급요청·입금 완료·월 마감·일일 보고)을 모아
// [복사]로 채널톡 팀챗에 붙여 넣는다. 채널톡 키·유료 플랜이 생기면 [채널톡 보내기]·자동 발송을 켠다.
// ===========================================================================
function messengerState() {
  if (!state.messenger) state.messenger = { data: null, loading: false, filter: "unshared", writing: false, settingsOpen: false };
  return state.messenger;
}
async function loadMessenger() {
  const ms = messengerState();
  ms.loading = true;
  try { ms.data = await api("/api/notices"); ms.error = ""; } catch (e) { ms.error = e.message; ms.data = { notices: [], kinds: {}, settings: {} }; }
  finally { ms.loading = false; }
}
function renderMessenger() {
  const ms = messengerState();
  const head = pageHead("메신저 공유", "담당자가 확인할 일을 한곳에 모읍니다. [복사]를 눌러 채널톡 팀챗에 붙여 넣으세요. (채널톡 무료 플랜은 자동 발송이 안 됩니다)");
  const d = ms.data;
  if (!d) return `${head}<section class="panel"><div class="panel-body"><p class="muted">불러오는 중…</p></div></section>`;
  const unshared = d.notices.filter((n) => !(n.shares || []).length);
  const list = ms.filter === "unshared" ? unshared : ms.filter === "all" ? d.notices : d.notices.filter((n) => n.kind === ms.filter);
  const kindsUsed = [...new Set(d.notices.map((n) => n.kind))];
  const chip = (key, label, n) => `<button class="npb-subtab ${ms.filter === key ? "active" : ""}" data-msg-filter="${h(key)}">${h(label)}${n != null ? ` <span class="muted">${n}</span>` : ""}</button>`;
  const rows = list.map((n) => {
    const last = (n.shares || []).slice(-1)[0];
    return `<tr>
      <td class="nowrap">${h(fmtDate(n.createdAt))}</td>
      <td class="nowrap"><span class="pill">${h(d.kinds[n.kind] || n.kind)}</span></td>
      <td class="wrap"><strong>${h(n.title)}</strong><div class="msg-text">${h(n.text)}</div></td>
      <td class="wrap muted" style="font-size:12px">${last ? `${h(last.via)} · ${h(last.by)}<br>${h(fmtDate(last.at))}${last.error ? `<br><span class="danger-text">${h(last.error)}</span>` : ""}` : "안 보냄"}</td>
      <td class="nowrap"><button class="small" data-msg-copy="${h(n.id)}">복사</button>${d.channelReady ? ` <button class="small" data-msg-send="${h(n.id)}">채널톡</button>` : ""}</td></tr>`;
  }).join("");
  const cfg = d.settings || {};
  const kindsList = Object.entries(d.kinds || {}).filter(([k]) => !["manual", "daily"].includes(k));
  const settings = d.isOwner ? `<section class="panel" style="margin-top:14px"><div class="panel-head"><h2>채널톡 연결 설정</h2><button class="small" data-msg-settings-toggle>${ms.settingsOpen ? "접기" : "펼치기"}</button></div>
    ${ms.settingsOpen ? `<div class="panel-body"><form data-msg-settings class="form-grid">
      <p class="${d.keysPresent ? "" : "danger-text"}" style="grid-column:1/-1">${d.keysPresent ? "채널톡 키·비밀값이 서버에 있습니다." : "채널톡 키·비밀값이 없습니다. 무료 플랜은 Open API 를 쓸 수 없어 지금은 [복사]만 됩니다. (Startup 이상 + 설정 › 보안 및 개발 › API 키에서 키·비밀값 발급 → 서버 환경변수 CHANNEL_ACCESS_KEY / CHANNEL_ACCESS_SECRET)"}</p>
      <div class="field"><label>보내기</label><select name="mode">
        <option value="off" ${cfg.mode === "off" ? "selected" : ""}>끔 (복사만)</option>
        <option value="test" ${cfg.mode === "test" ? "selected" : ""}>시험 — 내 계정에만 공지</option>
        <option value="live" ${cfg.mode === "live" ? "selected" : ""}>실제 — 팀챗 그룹에 보냄</option></select></div>
      <div class="field"><label>팀챗 그룹 ID</label><input name="groupId" value="${h(cfg.groupId || "")}" inputmode="numeric"></div>
      <div class="field"><label>보내는 이름(봇)</label><input name="botName" value="${h(cfg.botName || "")}" maxlength="30"></div>
      <div class="field"><label>시험용 내 매니저 ID</label><input name="testManagerId" value="${h(cfg.testManagerId || "")}" inputmode="numeric"></div>
      <div class="field" style="grid-column:1/-1"><label>자동으로 보낼 알림</label><div class="chip-list">${kindsList.map(([k, label]) => `<label class="chip"><input type="checkbox" name="auto_${k}" ${(cfg.autoKinds || []).includes(k) ? "checked" : ""}> ${h(label)}</label>`).join("")}</div></div>
      <div class="toolbar" style="grid-column:1/-1"><button class="primary" type="submit">저장</button></div>
    </form></div>` : ""}</section>` : "";
  const writer = ms.writing ? v2Modal(`<div class="panel-head"><h2>직접 써서 올리기</h2><button data-msg-close>닫기</button></div>
    <div class="panel-body"><form data-msg-write class="form-grid"><div class="field" style="grid-column:1/-1"><label>내용</label><textarea name="text" rows="8" required></textarea></div>
    <div class="toolbar" style="grid-column:1/-1"><button class="primary" type="submit">공유함에 올리기</button></div></form></div>`, "data-msg-close") : "";
  return `${head}
    <section class="panel"><div class="panel-head"><h2>알림</h2>
      <div class="toolbar">${unshared.length ? `<button class="primary" data-msg-copy-all>안 보낸 것 ${unshared.length}건 한꺼번에 복사</button>` : ""}<button data-msg-write-open>+ 직접 쓰기</button></div></div>
      <div class="panel-body">
        ${ms.error ? `<p class="error-text">${h(ms.error)}</p>` : ""}
        <div class="toolbar chip-row">${chip("unshared", "안 보낸 것", unshared.length)}${chip("all", "전체", d.notices.length)}${kindsUsed.map((k) => chip(k, d.kinds[k] || k, d.notices.filter((n) => n.kind === k).length)).join("")}</div>
        <div class="table-wrap"><table class="compact msg-table"><thead><tr><th>시각</th><th>종류</th><th>내용</th><th>공유</th><th></th></tr></thead>
        <tbody>${rows || `<tr><td colspan="5" class="empty">${ms.filter === "unshared" ? "안 보낸 알림이 없습니다." : "알림이 없습니다."}</td></tr>`}</tbody></table></div>
      </div></section>${settings}${writer}`;
}
function bindMessenger() {
  const ms = messengerState();
  if (!ms.data && !ms.loading) { loadMessenger().then(renderApp); return; }
  const reload = async () => { await loadMessenger(); renderApp(); };
  const mark = (id, via) => api(`/api/notices/${encodeURIComponent(id)}/share`, { method: "POST", body: { via } });
  app.querySelectorAll("[data-msg-filter]").forEach((b) => b.addEventListener("click", () => { ms.filter = b.dataset.msgFilter; renderApp(); }));
  app.querySelectorAll("[data-msg-copy]").forEach((b) => b.addEventListener("click", async () => {
    const n = ms.data.notices.find((x) => x.id === b.dataset.msgCopy);
    try { await navigator.clipboard.writeText(n.text); } catch { showToast("복사하지 못했습니다. 글을 직접 선택해 복사하세요.", "error"); return; }
    await mark(n.id, "copy").catch(() => {});
    showToast("복사했습니다. 채널톡 팀챗에 붙여 넣으세요.");
    reload();
  }));
  app.querySelector("[data-msg-copy-all]")?.addEventListener("click", async () => {
    const list = ms.data.notices.filter((n) => !(n.shares || []).length).slice().reverse();
    try { await navigator.clipboard.writeText(list.map((n) => n.text).join("\n\n")); } catch { showToast("복사하지 못했습니다.", "error"); return; }
    for (const n of list) await mark(n.id, "copy").catch(() => {});
    showToast(`${list.length}건을 복사했습니다. 채널톡 팀챗에 붙여 넣으세요.`);
    reload();
  });
  app.querySelectorAll("[data-msg-send]").forEach((b) => b.addEventListener("click", async () => {
    if (!confirm("채널톡으로 보낼까요?")) return;
    try { await mark(b.dataset.msgSend, "channel"); showToast("채널톡으로 보냈습니다."); reload(); } catch (e) { showToast(e.message, "error"); }
  }));
  app.querySelector("[data-msg-write-open]")?.addEventListener("click", () => { ms.writing = true; renderApp(); });
  app.querySelectorAll("[data-msg-close]").forEach((b) => b.addEventListener("click", () => { ms.writing = false; renderApp(); }));
  bindV2Modal();
  app.querySelector("[data-msg-write]")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = new FormData(e.currentTarget).get("text");
    try { await api("/api/notices", { method: "POST", body: { text } }); ms.writing = false; showToast("올렸습니다."); reload(); } catch (err) { showToast(err.message, "error"); }
  });
  app.querySelector("[data-msg-settings-toggle]")?.addEventListener("click", () => { ms.settingsOpen = !ms.settingsOpen; renderApp(); });
  app.querySelector("[data-msg-settings]")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const autoKinds = Object.keys(ms.data.kinds).filter((k) => f.get(`auto_${k}`));
    if (f.get("mode") === "live" && !confirm("실제 모드는 팀챗 그룹 전체에 알림이 갑니다. 저장할까요?")) return;
    try { await api("/api/messenger/settings", { method: "PUT", body: { mode: f.get("mode"), groupId: f.get("groupId"), botName: f.get("botName"), testManagerId: f.get("testManagerId"), autoKinds } }); showToast("저장했습니다."); reload(); }
    catch (err) { showToast(err.message, "error"); }
  });
}

// ===========================================================================
// v2 월 마감 — 그 달에 끝나지 않은 일 점검 → 대표가 마감(잠금). 마감한 달은 서버가 수정을 거부한다.
// ===========================================================================
function closingUiState() {
  if (!state.closingUi) {
    const d = new Date(Date.now() + 9 * 3600 * 1000);
    d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1);
    state.closingUi = { month: d.toISOString().slice(0, 7), data: null, loading: false };
  }
  return state.closingUi;
}
async function loadClosing() {
  const cs = closingUiState();
  cs.loading = true;
  try { cs.data = await api(`/api/closing/check?month=${cs.month}`); cs.error = ""; }
  catch (e) { cs.error = e.message; cs.data = { items: [], closing: { history: [] } }; }
  finally { cs.loading = false; }
}
function renderClosing() {
  const cs = closingUiState();
  const head = pageHead("월 마감", "그 달에 끝나지 않은 일을 모아 보고, 다 정리되면 대표가 마감합니다. 마감한 달의 입금요청·처리완료 지급요청·월 정산 현황·현금흐름표는 고칠 수 없습니다(이카운트의 편집제한과 같은 방식).");
  const d = cs.data;
  if (!d) return `${head}<section class="panel"><div class="panel-body"><p class="muted">불러오는 중…</p></div></section>`;
  const c = d.closing || {};
  const locked = c.lockedThrough && cs.month <= c.lockedThrough;
  const rows = (d.items || []).map((it) => `<tr class="${it.count ? "" : "row-done"}">
      <td><span class="status-dot ${it.count ? "is-warn" : "is-ok"}" aria-label="${it.count ? "남은 일 있음" : "끝남"}"></span>${h(it.label)}</td><td class="num">${money.format(it.count)}건</td>
      <td class="wrap muted" style="font-size:12px">${h((it.sample || []).join(", "))}${it.count > (it.sample || []).length ? " …" : ""}</td>
      <td class="wrap" style="font-size:12px">${it.count ? h(it.hint) : ""}</td>
      <td>${it.count && it.go ? `<button class="small" data-closing-go="${h(it.go.tab)}${it.go.sub ? `:${h(it.go.sub)}` : ""}">가기</button>` : ""}</td></tr>`).join("");
  const hist = (c.history || []).slice(0, 12).map((x) => `<tr><td>${h(fmtDate(x.at))}</td><td>${x.action === "lock" ? "마감" : "해제"}</td><td>${h(x.month)}</td><td>${h(x.by)}</td><td class="wrap">${h(x.note || "")}${x.open ? ` (남은 일 ${x.open}건)` : ""}</td></tr>`).join("");
  return `${head}
    <section class="panel"><div class="panel-head"><h2>점검할 달</h2>
      <div class="toolbar"><input type="month" data-closing-month value="${h(cs.month)}">
      <span class="${c.lockedThrough ? "pill" : "muted"}">${c.lockedThrough ? `${h(c.lockedThrough)} 까지 마감됨` : "마감한 달 없음"}</span></div></div>
      <div class="panel-body">
        ${cs.error ? `<p class="error-text">${h(cs.error)}</p>` : ""}
        <p>${locked ? `🔒 <strong>${h(cs.month)}</strong> 은(는) 마감된 달입니다.` : d.open ? `<strong>${h(cs.month)}</strong>: 끝나지 않은 일 <strong>${money.format(d.open)}건</strong>` : `<strong>${h(cs.month)}</strong>: 끝나지 않은 일이 없습니다. 마감할 수 있습니다.`}</p>
        <div class="table-wrap"><table class="compact"><thead><tr><th>점검 항목</th><th>건수</th><th>예시</th><th>할 일</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>
        ${d.canClose ? `<div class="toolbar" style="margin-top:12px">
          ${locked ? `<button data-closing-unlock>${h(cs.month)} 마감 풀기</button>` : `<button class="primary" data-closing-lock>${h(cs.month)} 마감하기</button>`}
          <span class="muted" style="font-size:12px">마감은 그 달까지 한꺼번에 잠급니다. 풀 때는 이유를 남깁니다.</span></div>` : `<p class="muted" style="margin-top:10px">마감·해제는 대표만 할 수 있습니다.</p>`}
      </div></section>
    <section class="panel" style="margin-top:14px"><div class="panel-head"><h2>마감 기록</h2></div><div class="panel-body">
      <div class="table-wrap"><table class="compact"><thead><tr><th>시각</th><th>구분</th><th>달</th><th>누가</th><th>메모</th></tr></thead><tbody>${hist || `<tr><td colspan="5" class="empty">기록이 없습니다.</td></tr>`}</tbody></table></div>
    </div></section>`;
}
function bindClosing() {
  const cs = closingUiState();
  if (!cs.data && !cs.loading) { loadClosing().then(renderApp); return; }
  const reload = async () => { await loadClosing(); renderApp(); };
  app.querySelector("[data-closing-month]")?.addEventListener("change", (e) => { if (/^\d{4}-\d{2}$/.test(e.target.value)) { cs.month = e.target.value; reload(); } });
  app.querySelectorAll("[data-closing-go]").forEach((b) => b.addEventListener("click", () => {
    const [tab, sub] = b.dataset.closingGo.split(":");
    state.tab = tab;
    if (tab === "trade") tradeState();
    const conf = TAB_SUBMENUS[tab];
    if (sub && conf) state[conf.stateKey].screen = sub;
    if (tab === "monthly") { monthlyState().month = cs.month; monthlyState().data = null; }
    renderApp();
  }));
  app.querySelector("[data-closing-lock]")?.addEventListener("click", async () => {
    let note = "";
    if (cs.data.open) {
      note = prompt(`${cs.month}에 끝나지 않은 일이 ${cs.data.open}건 있습니다. 그래도 마감하려면 이유를 적어 주세요.`) || "";
      if (!note.trim()) return;
    } else if (!confirm(`${cs.month} 까지 마감할까요? 마감한 달은 고칠 수 없습니다.`)) return;
    try { await api("/api/closing/lock", { method: "POST", body: { month: cs.month, note, open: cs.data.open } }); showToast(`${cs.month} 마감했습니다.`); await reload(); }
    catch (e) { showToast(e.message, "error"); }
  });
  app.querySelector("[data-closing-unlock]")?.addEventListener("click", async () => {
    const reason = prompt(`${cs.month} 마감을 푸는 이유를 적어 주세요. (이 달부터 뒤의 마감이 풀립니다)`) || "";
    if (!reason.trim()) return;
    try { await api("/api/closing/unlock", { method: "POST", body: { month: cs.month, reason } }); showToast("마감을 풀었습니다."); await reload(); }
    catch (e) { showToast(e.message, "error"); }
  });
}

function monthlyState() {
  if (!state.monthly) state.monthly = { data: null, loading: false, month: "", filter: "all", editing: "" };
  return state.monthly;
}
async function loadMonthly() {
  const ms = monthlyState();
  ms.loading = true;
  try {
    ms.data = await api(`/api/monthly${ms.month ? `?month=${ms.month}` : ""}`);
    ms.month = ms.data.month;
  } catch (e) { ms.data = { rows: [], months: [], totals: {}, error: e.message }; } finally { ms.loading = false; }
}

const MONTHLY_FIELD_LABEL = { sales: "매출", shipping: "배송비", recovered: "회수", margin: "마진" };

function renderMonthly() {
  const ms = monthlyState();
  const head = pageHead("월 정산 현황", "입점 브랜드마다 이번 달 매출·배송비·채권 회수·마진을 보고, 확인 → 계산서 발행요청 → 정산서 발송을 체크합니다. 숫자는 입금요청에서 계산하고, 입금요청이 없는 위탁 브랜드는 직접 적습니다.");
  const d = ms.data;
  if (!d) return `${head}<section class="panel"><div class="panel-body"><p class="muted">불러오는 중…</p></div></section>`;
  const t = d.totals || {};
  const rows = d.rows.filter((r) => ms.filter === "all" || (ms.filter === "todo" ? !(r.checked && r.sent) : ms.filter === "diff" ? r.diffs.length : true));
  const cell = (r, f) => {
    const sheet = r.sheet ? r.sheet[f] : null;
    const diff = r.diffs.includes(f);
    return `<td class="num">${money.format(r[f] || 0)}${diff ? `<br><span class="danger-text" style="font-size:11px">시트 ${money.format(sheet || 0)}</span>` : ""}</td>`;
  };
  const chk = (r, k) => `<input type="checkbox" data-monthly-check="${h(r.brandId)}:${k}" ${r[k] ? "checked" : ""} ${d.canEdit ? "" : "disabled"}>`;
  return `${head}
    <div class="toolbar" style="margin:8px 0">
      <select data-monthly-month style="width:auto">${(d.months.includes(d.month) ? d.months : [d.month, ...d.months]).map((m) => `<option value="${m}" ${m === d.month ? "selected" : ""}>${m.replace("-", "년 ")}월</option>`).join("")}</select>
      ${[["all", "전체"], ["todo", "안 끝난 것"], ["diff", "시트와 다른 것"]].map(([k, l]) => `<button class="npb-subtab ${ms.filter === k ? "active" : ""}" data-monthly-filter="${k}">${l}</button>`).join("")}
      <span style="flex:1"></span>
      ${d.canEdit ? `<button data-monthly-add>브랜드 줄 추가</button>` : ""}
      ${state.admin?.role === "owner" ? `<button data-monthly-import>월정산 시트에서 가져오기</button>` : ""}
    </div>
    <section class="sales-flow">
      <div class="sales-step"><span>매출</span><strong>${money.format(t.sales || 0)}원</strong></div>
      <div class="sales-step"><span>채권 회수</span><strong>${money.format(t.recovered || 0)}원</strong></div>
      <div class="sales-step"><span>마진(위탁 등)</span><strong>${money.format(t.margin || 0)}원</strong></div>
      <div class="sales-step"><span>확인 / 정산서 발송</span><strong>${t.checked || 0} / ${t.sent || 0} <span class="muted" style="font-size:12px">(${d.rows.length}곳)</span></strong></div>
      ${t.diffs ? `<div class="sales-step"><span>시트와 다름</span><strong class="danger-text">${t.diffs}곳</strong></div>` : ""}
    </section>
    <section class="panel"><div class="table-wrap"><table class="compact monthly-table" data-unit="원">
      <thead><tr><th>브랜드</th><th data-nounit="1">건수</th><th>매출</th><th>배송비</th><th>회수</th><th>마진</th><th class="center">확인</th><th class="center">발행요청</th><th class="center">정산서 발송</th><th>메모 / 수정요청</th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td>${r.code ? `<span class="code-tag">${h(r.code)}</span> ` : ""}${h(r.brandName)}<br><span class="muted" style="font-size:11px">${h(/^[a-z_]+$/.test(r.kind || "") ? settlementLabel(r.kind) : (r.kind || ""))}${r.source === "manual" ? " · 직접 입력" : r.source === "sheet-only" ? " · 시트 값만" : ""}</span></td>
        <td class="num">${r.count || ""}</td>${cell(r, "sales")}${cell(r, "shipping")}${cell(r, "recovered")}${cell(r, "margin")}
        <td class="center">${chk(r, "checked")}</td><td class="center">${chk(r, "invoiceRequested")}</td><td class="center">${chk(r, "sent")}</td>
        <td class="wrap memo-cell">${h(r.memo)}${r.fixRequest ? `<br><span class="danger-text">${h(r.fixRequest)}</span>` : ""}${d.canEdit ? ` <button class="ghost small" data-monthly-open="${h(r.brandId)}">고치기</button>` : ""}</td>
      </tr>`).join("") || `<tr><td colspan="10" class="empty">이 달 내역이 없습니다.</td></tr>`}</tbody>
    </table></div></section>
    ${(() => {
      const r = d.rows.find((x) => x.brandId === ms.editing);
      if (!r) return "";
      return v2Modal(`<div class="panel-head"><h2>${h(r.brandName)} · ${h(d.month)}</h2><button data-monthly-cancel>닫기</button></div>
        <div class="panel-body"><form data-monthly-edit="${h(r.brandId)}" class="form-grid">
          <div class="field"><label>메모</label><input name="memo" value="${h(r.memo)}"></div>
          <div class="field"><label>수정요청</label><input name="fixRequest" value="${h(r.fixRequest)}"></div>
          ${r.source !== "requests" ? `<p class="muted" style="font-size:12px">입금요청이 없는 브랜드라 숫자를 직접 적습니다(원).</p><div class="field two">${["sales", "shipping", "recovered", "margin"].map((f) => `<div><label>${MONTHLY_FIELD_LABEL[f]}</label><input name="m_${f}" inputmode="numeric" value="${r[f] ? money.format(r[f]) : ""}"></div>`).join("")}</div>` : `<p class="muted" style="font-size:12px">숫자는 입금요청에서 계산합니다. 틀리면 입금요청을 고치세요.</p>`}
          <div class="toolbar"><button class="primary" type="submit">저장</button></div></form></div>`, "data-monthly-cancel");
    })()}`;
}

function bindMonthly() {
  const ms = monthlyState();
  if (!ms.data && !ms.loading) { loadMonthly().then(renderApp); return; }
  const reload = async () => { await loadMonthly(); renderApp(); };
  const put = async (brandId, body) => {
    try { await api(`/api/monthly/${ms.month}/${encodeURIComponent(brandId)}`, { method: "PUT", body }); await reload(); } catch (e) { showToast(e.message || "저장하지 못했습니다.", "error"); }
  };
  app.querySelector("[data-monthly-month]")?.addEventListener("change", (e) => { ms.month = e.target.value; ms.editing = ""; reload(); });
  app.querySelectorAll("[data-monthly-filter]").forEach((b) => b.addEventListener("click", () => { ms.filter = b.dataset.monthlyFilter; renderApp(); }));
  app.querySelectorAll("[data-monthly-check]").forEach((el) => el.addEventListener("change", () => {
    const [brandId, key] = el.dataset.monthlyCheck.split(":");
    put(brandId, { [key]: el.checked });
  }));
  bindV2Modal();
  app.querySelectorAll("[data-monthly-open]").forEach((b) => b.addEventListener("click", () => { ms.editing = b.dataset.monthlyOpen; renderApp(); }));
  app.querySelector("[data-monthly-cancel]")?.addEventListener("click", () => { ms.editing = ""; renderApp(); });
  app.querySelector("[data-monthly-edit]")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = formObject(e.currentTarget);
    const body = { memo: f.memo, fixRequest: f.fixRequest };
    if ("m_sales" in f) body.manual = { sales: f.m_sales, shipping: f.m_shipping, recovered: f.m_recovered, margin: f.m_margin };
    ms.editing = "";
    put(e.currentTarget.dataset.monthlyEdit, body);
  });
  app.querySelector("[data-monthly-add]")?.addEventListener("click", () => {
    const name = prompt("추가할 브랜드 이름(위탁 등 입금요청이 없는 브랜드)");
    if (!name) return;
    const b = (ms.data.brands || []).find((x) => x.name.replace(/\s/g, "").includes(name.replace(/\s/g, "")));
    if (!b) { showToast("그 이름의 브랜드가 없습니다. 브랜드 메뉴에서 먼저 등록하세요.", "error"); return; }
    ms.editing = b.id;
    put(b.id, { memo: "" });
  });
  app.querySelector("[data-monthly-import]")?.addEventListener("click", async () => {
    if (!confirm("월정산 구글시트(2025-08~)를 읽어 체크·메모·시트 값을 가져옵니다. 여기서 고친 줄은 시트 값만 갱신합니다. 진행할까요?")) return;
    try {
      const r = await api("/api/monthly/import-sheet", { method: "POST", body: {} });
      showToast(`${r.months}개월 ${r.records}줄을 가져왔습니다. 확인 필요 질문 ${r.questions}건.`);
      await reload();
    } catch (e) { showToast(e.message || "가져오지 못했습니다.", "error"); }
  });
}

// ===========================================================================
// v2 경영 KPI·손익 — 공헌이익 계산기(kpi.html) + v2에서 모은 이번 달 참고값
// ===========================================================================
function kpiState() {
  if (!state.kpi) state.kpi = { month: new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 7), summary: null, loading: false };
  return state.kpi;
}
function renderKpi() {
  const ks = kpiState();
  const head = pageHead("KPI·손익", "공헌이익 KPI 계산기입니다. 이제 값이 서버에 저장돼 어느 기기에서 열어도 같습니다. 위 칸은 v2에 쌓인 이번 달 숫자로, 계산기에 넣을 때 맞춰 보는 참고값입니다.");
  const s = ks.summary;
  const card = (label, value, sub = "") => `<div class="sales-step"><span>${label}</span><strong>${money.format(value || 0)}원</strong>${sub ? `<em class="muted" style="font-size:11px;font-style:normal">${sub}</em>` : ""}</div>`;
  const months = [];
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  for (let i = 0; i < 12; i += 1) months.push(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1)).toISOString().slice(0, 7));
  return `${head}
    <div class="toolbar" style="margin:8px 0">
      <select data-kpi-month style="width:auto">${months.map((m) => `<option value="${m}" ${m === ks.month ? "selected" : ""}>${m.replace("-", "년 ")}월 참고값</option>`).join("")}</select>
      <a class="button ghost" href="/kpi/" target="_blank" rel="noopener">계산기 새 창으로</a>
    </div>
    ${s ? `<section class="sales-flow">
      ${card("입점 매출(월정산)", s.wooof.sales, `${s.wooof.brands}곳 · 회수 ${money.format(s.wooof.recovered)} · 마진 ${money.format(s.wooof.margin)}`)}
      ${card("판매(B2B 주문)", s.sales.total, `${s.sales.orders}건 · 공급가 ${money.format(s.sales.supply)}`)}
      ${card("생산비 청구", s.production.total, s.production.byPartner.map(([n, v]) => `${n} ${money.format(v)}`).join(" · "))}
      ${card("대출 이자(추정)", s.loans.interest, `대출 ${s.loans.count}건`)}
      ${card("매월 고정 지출(자금 일정)", s.fixedCosts.total, Object.entries(s.fixedCosts.byCategory).map(([k, v]) => `${k} ${money.format(v)}`).join(" · "))}
    </section>` : `<p class="muted">참고값을 불러오는 중…</p>`}
    <iframe class="kpi-frame" src="/kpi/" title="KPI 계산기"></iframe>`;
}
function bindKpi() {
  const ks = kpiState();
  const load = async () => {
    ks.loading = true;
    try { ks.summary = await api(`/api/kpi/v2-summary?month=${ks.month}`); } catch (e) { showToast(e.message, "error"); } finally { ks.loading = false; renderApp(); }
  };
  if (!ks.summary && !ks.loading) { load(); return; }
  app.querySelector("[data-kpi-month]")?.addEventListener("change", (e) => { ks.month = e.target.value; ks.summary = null; load(); });
}

// ===========================================================================
// v2 생산비 — 생산처별 청구·지급 원장, 미지급, 공임 대조
// ===========================================================================
const PROD_KIND_LABEL = { bill: "청구", payment: "지급", adjust: "조정" };

async function loadProdCost(selectId) {
  const st = stockState();
  st.prod = await api("/api/production");
  const pid = selectId ?? st.prodSel ?? "";
  st.prodSel = pid;
  st.prodDetail = pid ? await api(`/api/production/partners/${pid}`) : null;
}

function renderProdCost() {
  const st = stockState();
  const d = st.prod;
  if (!d) return `<section class="panel"><div class="panel-body"><p class="muted">불러오는 중…</p></div></section>`;
  const rows = d.partners.map((p) => `<tr class="${st.prodSel === p.id ? "selected" : ""}" data-prod-open="${p.id}">
    <td>${p.code ? `<span class="code-tag">${h(p.code)}</span> ` : ""}${h(p.name)}${p.company === "betters_personal" ? ' <span class="badge muted">Betters(개인)</span>' : ""}</td>
    <td class="num"><strong>${money.format(p.balance)}</strong></td>
    <td class="num">${p.over60 ? `<span class="danger-text">${money.format(p.over60)}</span>` : ""}</td>
    <td>${h(p.oldestDate || "")}${p.oldestAge ? ` <span class="muted" style="font-size:11px">${p.oldestAge}일</span>` : ""}</td>
    <td>${h(p.lastPayment || "")}</td></tr>`).join("");
  return `
    <section class="sales-flow">
      <div class="sales-step"><span>우프 생산비 미지급</span><strong>${money.format(d.total)}원</strong></div>
      <div class="sales-step"><span>60일 넘은 미지급</span><strong class="${d.over60 ? "danger-text" : ""}">${money.format(d.over60)}원</strong></div>
    </section>
    <section class="v2-wide">
      <div class="panel">
        <div class="panel-head"><h2>생산처</h2>${d.canEdit ? `<button data-prod-import>생산비 시트에서 가져오기</button>` : ""}</div>
        <div class="table-wrap"><table class="compact" data-unit="원">
          <thead><tr><th>생산처</th><th>미지급</th><th>60일 넘음</th><th>가장 오래된 청구</th><th>마지막 지급</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="5" class="empty">아직 기록이 없습니다. '생산비 시트에서 가져오기'로 시작하세요.</td></tr>`}</tbody>
        </table></div>
      </div>
    </section>
    ${st.prodDetail ? v2Modal(renderProdPartner(), "data-prod-close") : ""}`;
}

function renderProdPartner() {
  const st = stockState();
  const { partner: p, summary: s, open = [], entries = [], details = [], rates = [], checks = {} } = st.prodDetail;
  const canEdit = st.prod?.canEdit;
  const tab = st.prodTab || "open";
  const sub = [["open", `미지급 ${open.length}`], ["ledger", "원장"], ["check", `공임 대조 ${(checks.mismatches || []).length + (checks.unknown || []).length}`], ["details", "상세내역"]];
  let body = "";
  if (tab === "open") {
    body = `<div class="table-wrap"><table class="compact" data-unit="원"><thead><tr><th>청구일</th><th>내용</th><th>남은 금액</th><th>경과</th></tr></thead><tbody>
      ${open.map((b) => `<tr><td>${h(b.date)}</td><td class="wrap">${h(b.memo || (b.lines || []).map((l) => l.item).join(", "))}${b.partial ? ' <span class="badge muted">일부 지급</span>' : ""}</td>
        <td class="num">${money.format(b.remaining)}</td><td class="${b.ageDays > 60 ? "danger-text" : ""}">${b.ageDays}일</td></tr>`).join("") || `<tr><td colspan="4" class="empty">미지급 청구가 없습니다.</td></tr>`}
    </tbody></table></div>
    ${st.prod?.canRequestPay && s.balance > 0 ? `<form class="form-grid" data-prod-payreq style="margin-top:12px">
      <div class="field two"><div><label>지급요청 금액</label><input name="amount" inputmode="numeric" value="${money.format(s.balance)}"></div>
        <div><label>지급 기한</label><input type="date" name="dueDate"></div></div>
      <div class="toolbar"><button class="primary" type="submit">지급요청 만들기</button><span class="muted" style="font-size:12px">지급요청이 '지급완료'가 되면 여기 지급으로 자동 기록됩니다.</span></div>
    </form>` : ""}`;
  } else if (tab === "ledger") {
    body = `${canEdit ? `<form class="form-grid" data-prod-add>
      <div class="field two"><div><label>구분</label><select name="kind"><option value="bills">청구(받은 계산서·명세서)</option><option value="payments">지급(보낸 돈)</option><option value="adjustments">조정(± 불량·상계)</option></select></div>
        <div><label>날짜</label><input type="date" name="date" value="${h(new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10))}"></div></div>
      <div class="field two"><div><label>금액(VAT 포함)</label><input name="amount" inputmode="numeric" required></div><div><label>메모</label><input name="memo"></div></div>
      <div class="toolbar"><button class="primary" type="submit">기록</button></div></form>` : ""}
      <div class="table-wrap"><table class="compact" data-unit="원"><thead><tr><th>날짜</th><th>구분</th><th>내용</th><th>금액</th><th>잔액</th><th></th></tr></thead><tbody>
      ${entries.map((e) => `<tr><td>${h(e.date)}</td><td>${PROD_KIND_LABEL[e.kind]}${e.assumed ? ' <span class="badge muted">추정</span>' : ""}</td><td class="wrap">${h(e.memo)}</td>
        <td class="num">${money.format(e.amount)}</td><td class="num">${money.format(e.balance)}</td>
        <td>${canEdit ? `<button data-prod-void="${h({ bill: "prodBills", payment: "prodPayments", adjust: "prodAdjustments" }[e.kind])}:${h(e.id)}">취소</button>` : ""}</td></tr>`).join("")}
      </tbody></table></div>`;
  } else if (tab === "check") {
    const mm = checks.mismatches || [];
    body = `<p class="muted" style="font-size:12px">올해 상세내역 단가를 약속한 공임(VAT 별도)과 맞춰 봅니다. 운임·샘플은 빼고 봅니다.</p>
      <h3>단가가 다른 줄 ${mm.length}</h3>
      <div class="table-wrap"><table class="compact" data-unit="원"><thead><tr><th>날짜</th><th>품목</th><th data-nounit="1">수량</th><th>청구 단가</th><th>약속 단가</th><th>차액</th></tr></thead><tbody>
      ${mm.map((m) => `<tr><td>${h(m.date)}</td><td>${h(m.item)}</td><td class="num">${m.qty}</td><td class="num">${money.format(m.unitPrice)}</td><td class="num">${money.format(m.rate)}</td><td class="num ${m.diff > 0 ? "danger-text" : ""}">${money.format(m.diff)}</td></tr>`).join("") || `<tr><td colspan="6" class="empty">다른 줄이 없습니다.</td></tr>`}
      </tbody></table></div>
      <h3 style="margin-top:12px">공임표에 없는 품목 ${(checks.unknown || []).length}</h3>
      <p>${(checks.unknown || []).map((u) => `<span class="badge muted">${h(u.item)} ${money.format(u.lastPrice)}</span>`).join(" ") || '<span class="muted">없음</span>'}</p>
      <h3 style="margin-top:12px">상세 합계 ≠ 청구 ${(checks.totals || []).length}</h3>
      <p>${(checks.totals || []).map((t) => `${h(t.date)} 상세 ${money.format(t.detail)} / 청구 ${money.format(t.billed)}`).join("<br>") || '<span class="muted">없음</span>'}</p>
      <h3 style="margin-top:12px">공임표</h3>
      <div class="table-wrap"><table class="compact" data-unit="원"><thead><tr><th>품목</th><th>옵션</th><th>단가(VAT별도)</th><th>시작일</th></tr></thead><tbody>
      ${rates.map((r) => `<tr><td>${h(r.item)}</td><td>${h(r.option)}</td><td class="num">${money.format(r.unitPrice)}</td><td>${h(r.from || r.fromText || "")}</td></tr>`).join("")}
      </tbody></table></div>
      ${canEdit ? `<form class="form-grid" data-prod-rate style="margin-top:8px"><div class="field two"><div><label>품목</label><input name="item" required></div><div><label>옵션</label><input name="option"></div></div>
        <div class="field two"><div><label>단가(VAT별도)</label><input name="unitPrice" inputmode="numeric" required></div><div><label>시작일</label><input type="date" name="from"></div></div>
        <div class="toolbar"><button type="submit">공임 단가 추가</button></div></form>` : ""}`;
  } else {
    body = details.map((d) => `<div class="prod-detail"><strong>${h(d.date)}</strong> <span class="muted">합계 ${money.format(d.total || 0)}</span>
      <table class="compact" data-unit="원"><tbody>${(d.lines || []).map((l) => `<tr><td>${h(l.item)}</td><td class="num">${l.qty}</td><td class="num">${money.format(l.unitPrice)}</td><td class="num">${money.format(l.gross || 0)}</td></tr>`).join("")}</tbody></table></div>`).join("")
      || `<p class="muted">상세내역이 없습니다.</p>`;
  }
  return `
    <div class="panel-head"><h2>${h(p.code || "")} ${h(p.name)}</h2><button data-prod-close>닫기</button></div>
    <div class="panel-body">
      <p>미지급 <strong>${money.format(s.balance)}원</strong> · 청구 ${money.format(s.billed)} · 지급 ${money.format(s.paid)}${p.bankAccount ? ` · <span class="muted">${h(p.bankName)} ${h(p.bankAccount)}</span>` : ""}</p>
      <div class="npb-subnav">${sub.map(([k, l]) => `<button class="npb-subtab ${tab === k ? "active" : ""}" data-prod-tab="${k}">${l}</button>`).join("")}</div>
      ${body}
    </div>`;
}

function bindProdCost() {
  const st = stockState();
  if (!st.prod && !st.prodLoading) {
    st.prodLoading = true;
    loadProdCost().catch((e) => showToast(e.message, "error")).finally(() => { st.prodLoading = false; renderApp(); });
    return;
  }
  const refresh = async (sel) => { await loadProdCost(sel); renderApp(); };
  const run = async (fn, ok) => { try { await fn(); if (ok) showToast(ok); await refresh(); } catch (e) { showToast(e.message || "처리하지 못했습니다.", "error"); } };
  bindV2Modal();
  app.querySelectorAll("[data-prod-open]").forEach((tr) => tr.addEventListener("click", () => refresh(tr.dataset.prodOpen).catch((e) => showToast(e.message, "error"))));
  app.querySelector("[data-prod-close]")?.addEventListener("click", () => { st.prodSel = ""; st.prodDetail = null; renderApp(); });
  app.querySelectorAll("[data-prod-tab]").forEach((b) => b.addEventListener("click", () => { st.prodTab = b.dataset.prodTab; renderApp(); }));
  app.querySelector("[data-prod-import]")?.addEventListener("click", async () => {
    if (!confirm("생산비 구글시트를 읽어 청구·지급·상세내역·공임표를 가져옵니다. 이미 가져온 줄은 덮어쓰고, 여기서 고치거나 취소한 줄은 그대로 둡니다. 진행할까요?")) return;
    try {
      const r = await api("/api/production/import-sheet", { method: "POST", body: {} });
      showToast(`청구 ${r.bills}건, 지급 ${r.payments}건을 가져왔습니다. 확인 필요 질문 ${r.questions}건(새 질문 ${r.newQuestions}건).`);
      await refresh();
    } catch (e) { showToast(e.message || "가져오지 못했습니다.", "error"); }
  });
  app.querySelector("[data-prod-add]")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = formObject(e.currentTarget);
    run(() => api(`/api/production/partners/${st.prodSel}/${f.kind}`, { method: "POST", body: f }), "기록했습니다.");
  });
  app.querySelector("[data-prod-rate]")?.addEventListener("submit", (e) => {
    e.preventDefault();
    run(() => api(`/api/production/partners/${st.prodSel}/rates`, { method: "POST", body: formObject(e.currentTarget) }), "공임 단가를 추가했습니다.");
  });
  app.querySelectorAll("[data-prod-void]").forEach((b) => b.addEventListener("click", () => {
    if (!confirm("이 기록을 취소할까요? 기록은 남고 잔액에서만 빠집니다.")) return;
    const [col, rid] = b.dataset.prodVoid.split(/:(.+)/);
    run(() => api(`/api/production/${col}/${encodeURIComponent(rid)}/void`, { method: "POST", body: {} }), "취소했습니다.");
  }));
  app.querySelector("[data-prod-payreq]")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const f = formObject(e.currentTarget);
    run(async () => {
      const r = await api(`/api/production/partners/${st.prodSel}/pay-request`, { method: "POST", body: f });
      showToast(`지급요청 ${r.payment.code}을 만들었습니다. 지급요청 메뉴에서 확인·승인하세요.`);
    });
  });
}

function renderStock() {
  const st = stockState();
  const head = pageHead("생산·재고", "원부자재를 어디에 얼마나 넣었고, 생산에 얼마나 썼고, 얼마나 남았는지, 언제 얼마나 발주해야 하는지 봅니다.");
  const tabs = `<div class="npb-subnav">${[["status", "재고현황"], ["moves", "입출고 기록"], ["runs", "생산 기록"], ["products", "제품 구성(BOM)"], ["cost", "생산비"]].map(([k, l]) => `<button class="npb-subtab ${st.screen === k ? "active" : ""}" data-stock-screen="${k}">${l}</button>`).join("")}</div>`;
  if (st.screen === "cost") return `${head}${tabs}${renderProdCost()}`;
  if (!st.data) return `${head}${tabs}<section class="panel"><div class="panel-body"><p class="muted">불러오는 중…</p></div></section>`;
  const body = { status: renderStockStatus, moves: renderStockMoves, runs: renderStockRuns, products: renderStockProducts }[st.screen] || renderStockStatus;
  return `${head}${tabs}${body()}`;
}

const stockLoc = (key) => (stockState().data?.locations || []).find((l) => l.key === key)?.name || key;
const matName = (id) => (state.materials || []).find((m) => m.id === id)?.itemName || id;
const materialOptions = (cur) => (state.materials || []).filter((m) => m.isActive !== false)
  .map((m) => `<option value="${m.id}" ${cur === m.id ? "selected" : ""}>${h(m.code ? `${m.code} · ` : "")}${h(m.itemName)}</option>`).join("");
const locationOptions = (cur) => (stockState().data?.locations || []).map((l) => `<option value="${h(l.key)}" ${cur === l.key ? "selected" : ""}>${h(l.name)}</option>`).join("");

function renderStockStatus() {
  const st = stockState();
  const d = st.data;
  const need = d.status.filter((r) => r.needOrder);
  const editing = st.settingFor ? (d.settings[st.settingFor] || {}) : null;
  const products = d.products || [];
  return `
    ${need.length ? `<section class="fixed-summary"><div class="fixed-summary-title danger-text">발주 필요 ${need.length}건</div>
      <div class="muted">${need.map((r) => `${h(r.name)} <strong>${qtyFmt(r.suggestOrder)}${h(r.unit)}</strong>`).join(" · ")}</div></section>` : ""}
    ${products.length ? `<section class="fixed-summary"><div class="fixed-summary-title">지금 재고로 만들 수 있는 수량</div><div class="muted">
      ${products.map((p) => { const x = (d.producible || []).find((y) => y.productId === p.id); const best = (x?.byLocation || []).sort((a, b) => b.quantity - a.quantity)[0];
        return `${h(p.name)} <strong>${best ? `${money.format(best.quantity)}${h(p.unit || "개")}` : "0"}</strong>${best ? ` (${h(stockLoc(best.location))}, ${h(matName(best.limitedBy))} 기준)` : ""}`; }).join(" · ")}</div></section>` : ""}
    <section class="layout">
      <div class="panel">
        <div class="panel-head"><h2>재고현황</h2><span class="muted">${d.status.length}개 품목 · 입출고나 제품 구성에 쓰인 원부자재만 보여요</span></div>
        <div class="table-wrap"><table class="compact stock-table">
          <thead><tr><th>원부자재</th><th>보관처별</th><th>보유</th><th>쓸 예정</th><th>쓸 수 있음</th><th>안전재고</th><th>발주</th><th></th></tr></thead>
          <tbody>${d.status.map((r) => `<tr class="${r.needOrder ? "stock-need" : ""}">
            <td>${r.code ? `<span class="code-tag">${h(r.code)}</span>` : ""}${h(r.name)}</td>
            <td class="muted" style="font-size:12px">${r.locations.map((l) => `${h(stockLoc(l.location))} ${qtyFmt(l.qty)}`).join("<br>") || "-"}</td>
            <td class="num">${qtyFmt(r.onHand)}${h(r.unit)}</td><td class="num">${r.plannedUse ? qtyFmt(r.plannedUse) : ""}</td>
            <td class="num"><strong>${qtyFmt(r.available)}</strong></td><td class="num">${r.safetyStock ? qtyFmt(r.safetyStock) : ""}</td>
            <td>${r.needOrder ? `<span class="badge warn">발주 ${qtyFmt(r.suggestOrder)}${h(r.unit)}</span>` : ""}${r.leadTimeDays ? `<br><span class="muted" style="font-size:11px">리드타임 ${r.leadTimeDays}일</span>` : ""}</td>
            <td>${can("stock", "edit") ? `<button data-stock-setting="${r.materialId}">설정</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="8" class="empty">아직 재고 기록이 없습니다. '입출고 기록'에서 입고부터 넣거나, '제품 구성'에 원부자재를 등록하세요.</td></tr>`}</tbody>
        </table></div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>${editing ? `재고 설정 · ${h(matName(st.settingFor))}` : "재고 설정"}</h2></div>
        <div class="panel-body">${editing ? `
          <form class="form-grid" data-stock-setting-form>
            <div class="field two"><div><label>재고단위</label><input name="unit" value="${h(editing.unit || "")}" placeholder="개 / m / kg"></div>
              <div><label>안전재고</label><input name="safetyStock" inputmode="decimal" value="${h(editing.safetyStock ?? "")}"></div></div>
            <div class="field two"><div><label>발주단위(묶음)</label><input name="orderMultiple" inputmode="decimal" value="${h(editing.orderMultiple ?? "")}" placeholder="예: 1000"></div>
              <div><label>리드타임(일)</label><input name="leadTimeDays" inputmode="numeric" value="${h(editing.leadTimeDays ?? "")}"></div></div>
            <p class="muted" style="font-size:12px">쓸 수 있는 양(보유 − 예정 생산에 쓸 양)이 안전재고 아래로 가면 '발주 필요'가 뜨고, 모자란 만큼을 발주단위로 올려 추천합니다.</p>
            <div class="toolbar"><button class="primary" type="submit">저장</button><button type="button" data-stock-setting-close>닫기</button></div>
          </form>` : `<p class="muted">표에서 '설정'을 누르면 안전재고·발주단위·리드타임을 정할 수 있습니다.</p>`}</div>
      </div>
    </section>`;
}

function renderStockMoves() {
  const st = stockState();
  const d = st.data;
  const f = st.moveDraft || { type: "in", date: new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10) };
  return `
    <section class="layout">
      <div class="panel">
        <div class="panel-head"><h2>입출고 기록</h2><span class="muted">최근 ${d.moves.length}건</span></div>
        <div class="table-wrap"><table class="compact stock-table">
          <thead><tr><th>날짜</th><th>구분</th><th>원부자재</th><th>보관처</th><th>수량</th><th>메모</th><th></th></tr></thead>
          <tbody>${d.moves.map((m) => `<tr class="${m.voided ? "muted stock-void" : ""}">
            <td>${h(String(m.date || "").slice(5))}</td><td>${h(d.moveTypes[m.type] || m.type)}</td><td>${h(matName(m.materialId))}</td>
            <td>${h(stockLoc(m.location))}</td><td class="num">${["use", "out", "move_out"].includes(m.type) ? "−" : m.type === "adjust" && m.qty > 0 ? "+" : ""}${qtyFmt(Math.abs(m.qty))}</td>
            <td class="wrap muted" style="font-size:12px">${h(m.memo || "")}${m.voided ? " (무름)" : ""}</td>
            <td>${!m.voided && m.refType !== "production" && can("stock", "edit") ? `<button data-stock-void="${m.id}" title="이 기록 무르기">무르기</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="7" class="empty">기록이 없습니다.</td></tr>`}</tbody>
        </table></div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>기록 추가</h2></div>
        <div class="panel-body">${can("stock", "edit") ? `
          <form class="form-grid" data-stock-move-form>
            <div class="field two">
              <div><label>구분</label><select name="type" data-stock-move-type>${[["in", "입고(구매·넣어줌)"], ["move", "이동(창고→공장 등)"], ["out", "반출·폐기"], ["adjust", "실사 조정"]].map(([k, l]) => `<option value="${k}" ${f.type === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
              <div><label>날짜</label><input type="date" name="date" value="${h(f.date || "")}"></div>
            </div>
            <div class="field"><label>원부자재</label><select name="materialId" required><option value="">선택</option>${materialOptions(f.materialId)}</select></div>
            <div class="field two">
              <div><label>${f.type === "move" ? "보내는 곳" : "보관처"}</label><select name="location" required>${locationOptions(f.location)}</select></div>
              <div>${f.type === "move" ? `<label>받는 곳</label><select name="toLocation">${locationOptions(f.toLocation)}</select>`
                : f.type === "adjust" ? `<label>센 수량(실제 남은 양)</label><input name="counted" inputmode="decimal" required>`
                : `<label>수량</label><input name="qty" inputmode="decimal" required>`}</div>
            </div>
            ${f.type === "move" ? `<div class="field"><label>수량</label><input name="qty" inputmode="decimal" required></div>` : ""}
            <div class="field"><label>메모</label><input name="memo" placeholder="예: 발주서 PO-… / 공장 실사"></div>
            <div class="toolbar"><button class="primary" type="submit">기록</button></div>
          </form>` : `<p class="muted">수정 권한이 없습니다.</p>`}</div>
      </div>
    </section>`;
}

function renderStockRuns() {
  const st = stockState();
  const d = st.data;
  const products = d.products || [];
  const runs = (d.runs || []).slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  const label = { planned: "예정", done: "완료", cancelled: "취소" };
  return `
    <section class="layout">
      <div class="panel">
        <div class="panel-head"><h2>생산 기록</h2><span class="muted">완료하면 제품 구성대로 그 생산처 재고에서 자동으로 빠집니다</span></div>
        <div class="table-wrap"><table class="compact stock-table">
          <thead><tr><th>날짜</th><th>제품</th><th>수량</th><th>생산처</th><th>상태</th><th></th></tr></thead>
          <tbody>${runs.map((r) => `<tr class="${r.status === "cancelled" ? "muted" : ""}">
            <td>${h(r.date || "")}</td><td>${h(r.productName)}${r.memo ? `<br><span class="muted" style="font-size:11px">${h(r.memo)}</span>` : ""}</td>
            <td class="num">${money.format(r.quantity)}</td><td>${h(stockLoc(r.location))}</td>
            <td><span class="badge ${r.status === "planned" ? "warn" : r.status === "done" ? "" : "muted"}">${label[r.status] || r.status}</span></td>
            <td><div class="row-actions">${can("stock", "edit") && r.status === "planned" ? `<button class="primary" data-stock-run="complete" data-id="${r.id}">생산 완료</button>` : ""}
              ${can("stock", "edit") && r.status !== "cancelled" ? `<button data-stock-run="cancel" data-id="${r.id}">취소</button>` : ""}</div></td></tr>`).join("") || `<tr><td colspan="6" class="empty">생산 기록이 없습니다.</td></tr>`}</tbody>
        </table></div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>생산 등록</h2></div>
        <div class="panel-body">${!products.length ? `<p class="muted">먼저 '제품 구성(BOM)'에서 제품을 만드세요.</p>` : can("stock", "edit") ? `
          <form class="form-grid" data-stock-run-form>
            <div class="field"><label>제품</label><select name="productId" required>${products.map((p) => `<option value="${p.id}">${h(p.name)}</option>`).join("")}</select></div>
            <div class="field two"><div><label>수량</label><input name="quantity" inputmode="numeric" required></div>
              <div><label>생산처</label><select name="location">${locationOptions((d.locations || [])[1]?.key)}</select></div></div>
            <div class="field two"><div><label>날짜</label><input type="date" name="date" value="${new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)}"></div>
              <div><label>상태</label><select name="status"><option value="planned">예정(재고 미차감)</option><option value="done">완료(바로 차감)</option></select></div></div>
            <div class="field"><label>메모</label><input name="memo"></div>
            <div class="toolbar"><button class="primary" type="submit">등록</button></div>
          </form>` : ""}</div>
      </div>
    </section>`;
}

function renderStockProducts() {
  const st = stockState();
  const d = st.data;
  const e = st.editingProduct || { name: "", unit: "개", lines: [{}, {}, {}] };
  return `
    <section class="layout">
      <div class="panel">
        <div class="panel-head"><h2>제품 구성(BOM)</h2><span class="muted">완제품 1개를 만들 때 드는 원부자재와 손실률</span></div>
        <div class="table-wrap"><table class="compact stock-table">
          <thead><tr><th>제품</th><th>원부자재 (1${"개"}당)</th><th></th></tr></thead>
          <tbody>${(d.products || []).map((p) => `<tr><td>${h(p.name)}</td>
            <td class="muted" style="font-size:12px">${(p.lines || []).map((l) => `${h(matName(l.materialId))} ${qtyFmt(l.perUnit)}${l.lossRate ? ` (+손실 ${l.lossRate}%)` : ""}`).join("<br>")}</td>
            <td>${can("stock", "edit") ? `<button data-stock-product-edit="${p.id}">수정</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="3" class="empty">등록된 제품이 없습니다. 예: 포포타올 = 스텝온 1 + 옆솜 2 + 앞솜 1</td></tr>`}</tbody>
        </table></div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>${e.id ? "제품 수정" : "제품 추가"}</h2></div>
        <div class="panel-body">${can("stock", "edit") ? `
          <form class="form-grid" data-stock-product-form>
            <div class="field two"><div><label>제품명</label><input name="name" value="${h(e.name || "")}" required placeholder="예: 필바이츠 45g (5P)"></div>
              <div><label>단위</label><input name="unit" value="${h(e.unit || "개")}"></div></div>
            <table class="sales-lines"><thead><tr><th>원부자재</th><th>1개당 수량</th><th>손실률%</th></tr></thead><tbody>
              ${(e.lines || []).map((l, i) => `<tr><td><select data-bom-mat="${i}"><option value="">선택</option>${materialOptions(l.materialId)}</select></td>
                <td><input data-bom-per="${i}" inputmode="decimal" value="${h(l.perUnit ?? "")}" style="width:80px"></td>
                <td><input data-bom-loss="${i}" inputmode="decimal" value="${h(l.lossRate ?? "")}" style="width:60px"></td></tr>`).join("")}
            </tbody></table>
            <div class="toolbar"><button type="button" data-bom-add>줄 추가</button></div>
            <p class="muted" style="font-size:12px">원부자재가 목록에 없으면 거래관리 &gt; 원부자재관리에서 먼저 등록하세요(우프코드가 붙습니다).</p>
            <div class="toolbar"><button class="primary" type="submit">저장</button>${e.id ? `<button type="button" data-stock-product-cancel>취소</button>` : ""}</div>
          </form>` : ""}</div>
      </div>
    </section>`;
}

function bindStock() {
  const st = stockState();
  if (st.screen === "cost") {
    app.querySelectorAll("[data-stock-screen]").forEach((b) => b.addEventListener("click", () => { st.screen = b.dataset.stockScreen; renderApp(); }));
    bindProdCost();
    return;
  }
  if (!st.data && !st.loading) { loadStock().then(renderApp); return; }
  const reload = async () => { await loadStock(); renderApp(); };
  const run = async (fn, ok) => { try { await fn(); if (ok) showToast(ok); await reload(); } catch (error) { showToast(error.message || "처리하지 못했습니다.", "error"); } };
  app.querySelectorAll("[data-stock-screen]").forEach((b) => b.addEventListener("click", () => { st.screen = b.dataset.stockScreen; renderApp(); }));
  app.querySelectorAll("[data-stock-setting]").forEach((b) => b.addEventListener("click", () => { st.settingFor = b.dataset.stockSetting; renderApp(); }));
  app.querySelector("[data-stock-setting-close]")?.addEventListener("click", () => { st.settingFor = ""; renderApp(); });
  app.querySelector("[data-stock-setting-form]")?.addEventListener("submit", (e) => { e.preventDefault(); const body = formObject(e.currentTarget); run(() => api(`/api/stock/settings/${st.settingFor}`, { method: "PUT", body }), "저장했습니다."); });
  app.querySelector("[data-stock-move-type]")?.addEventListener("change", (e) => { st.moveDraft = { ...formObject(e.target.form), type: e.target.value }; renderApp(); });
  app.querySelector("[data-stock-move-form]")?.addEventListener("submit", (e) => { e.preventDefault(); const body = formObject(e.currentTarget); run(async () => { await api("/api/stock/moves", { method: "POST", body }); st.moveDraft = { type: body.type, date: body.date, location: body.location }; }, "기록했습니다."); });
  app.querySelectorAll("[data-stock-void]").forEach((b) => b.addEventListener("click", () => { if (confirm("이 기록을 무를까요? (지워지지 않고 '무름'으로 남습니다)")) run(() => api(`/api/stock/moves/${b.dataset.stockVoid}/void`, { method: "POST", body: {} }), "무렀습니다."); }));
  app.querySelector("[data-stock-run-form]")?.addEventListener("submit", (e) => { e.preventDefault(); const body = formObject(e.currentTarget); run(() => api("/api/stock/runs", { method: "POST", body }), body.status === "done" ? "생산을 기록하고 재고에서 뺐습니다." : "생산 예정을 등록했습니다."); });
  app.querySelectorAll("[data-stock-run]").forEach((b) => b.addEventListener("click", () => {
    const action = b.dataset.stockRun;
    const body = {};
    if (action === "complete") { const q = prompt("실제 생산 수량 (예정과 같으면 그대로)", (st.data.runs.find((r) => r.id === b.dataset.id) || {}).quantity); if (q === null) return; body.quantity = q; }
    if (action === "cancel" && !confirm("이 생산 기록을 취소할까요? 완료된 생산이면 차감한 재고가 되돌아갑니다.")) return;
    run(() => api(`/api/stock/runs/${b.dataset.id}/${action}`, { method: "POST", body }), "처리했습니다.");
  }));
  const readBom = () => {
    const form = app.querySelector("[data-stock-product-form]");
    const f = formObject(form);
    const lines = [...form.querySelectorAll("[data-bom-mat]")].map((el) => ({ materialId: el.value, perUnit: form.querySelector(`[data-bom-per="${el.dataset.bomMat}"]`).value, lossRate: form.querySelector(`[data-bom-loss="${el.dataset.bomMat}"]`).value }));
    return { ...(st.editingProduct || {}), ...f, lines };
  };
  app.querySelector("[data-bom-add]")?.addEventListener("click", () => { const p = readBom(); p.lines.push({}); st.editingProduct = p; renderApp(); });
  app.querySelectorAll("[data-stock-product-edit]").forEach((b) => b.addEventListener("click", () => { const p = st.data.products.find((x) => x.id === b.dataset.stockProductEdit); st.editingProduct = p ? { ...p, lines: [...p.lines, {}] } : null; renderApp(); }));
  app.querySelector("[data-stock-product-cancel]")?.addEventListener("click", () => { st.editingProduct = null; renderApp(); });
  app.querySelector("[data-stock-product-form]")?.addEventListener("submit", (e) => {
    e.preventDefault();
    const p = readBom();
    run(async () => { await api(p.id ? `/api/stock/products/${p.id}` : "/api/stock/products", { method: p.id ? "PUT" : "POST", body: { name: p.name, unit: p.unit, lines: p.lines } }); st.editingProduct = null; }, "저장했습니다.");
  });
}

// ===========================================================================
// v2 확인 필요(질문함) — 시스템이 모르는 값을 질문으로 띄우고 답하면 적용한다.
// ===========================================================================
function setupState() {
  if (!state.setup) state.setup = { list: null, loading: false, show: "open" };
  return state.setup;
}
async function loadSetup() {
  const ss = setupState();
  ss.loading = true;
  try { const res = await api("/api/setup/questions"); ss.list = res.questions || []; ss.brands = res.brands || []; }
  catch (error) { ss.list = []; ss.error = error.message; } finally { ss.loading = false; }
}
const SETUP_KIND_LABEL = { "claim-base": "채권총액", "request-deduction": "채권차감액", "amount-mismatch": "금액 차이", "tab-brand": "시트 탭 연결", "zero-deduction": "차감 방식", "channel-rule": "판매처 가격 방식", "channel-price": "판매처 단가", "prod-balance": "생산비 잔금", "prod-rate-change": "공임 변경", "prod-rate-new": "공임 등록", "prod-total": "상세 합계", "loan-maturity": "대출 만기", proposal: "등록 제안", "monthly-brand": "월정산 브랜드", "monthly-gap": "월정산 매출 차이", "brand-info": "브랜드 정보", "brand-new": "새 브랜드" };

function renderSetup() {
  const ss = setupState();
  const head = pageHead("확인 필요", "시스템이 스스로 정할 수 없는 값을 질문으로 모았습니다. 답하면 바로 적용되고, 누가 언제 무엇으로 답했는지 남습니다.");
  if (ss.list === null) return `${head}<section class="panel"><div class="panel-body"><p class="muted">불러오는 중…</p></div></section>`;
  // 큰돈이 걸린 것부터: 잔금·채권총액 → 차감·가격 방식 → 나머지.
  const order = ["prod-balance", "loan-maturity", "proposal", "brand-info", "claim-base", "zero-deduction", "channel-rule", "prod-rate-change", "request-deduction", "amount-mismatch",
    "tab-brand", "channel-price", "prod-rate-new", "prod-total"];
  const rank = (q) => { const i = order.indexOf(q.kind); return i === -1 ? order.length : i; };
  const open = ss.list.filter((q) => q.status !== "answered").sort((a, b) => rank(a) - rank(b));
  const done = ss.list.filter((q) => q.status === "answered");
  const shown = ss.show === "open" ? open : done;
  const byKind = {};
  for (const q of open) byKind[q.kind] = (byKind[q.kind] || 0) + 1;
  const card = (q) => `
    <div class="setup-card ${q.status === "answered" ? "answered" : ""}">
      <div class="setup-kind">${h(SETUP_KIND_LABEL[q.kind] || q.kind)}</div>
      <strong>${h(q.title)}</strong>
      <p class="muted" style="white-space:pre-line">${h(q.detail || "")}</p>
      ${q.kind === "proposal" && q.status !== "answered" ? `<ul class="setup-actions">${(q.choices || []).filter((c) => (c.actions || []).length).map((c) => `<li><strong>${h(c.label)}</strong>: ${(c.actions || []).map((a) => h(a.type === "cashSchedule" ? `자금일정 '${a.title}' ${a.repeat === "monthly" ? `매월 ${a.dayOfMonth}일(${a.startDate || ""}~${a.endDate || ""})` : a.date} ${money.format(a.amount)}원${a.direction === "in" ? " 받을 돈" : ""}` : a.type === "payment" ? `지급요청 '${a.title}' ${money.format(a.amount)}원` : `생산비 지급 기록 ${a.date} ${money.format(a.amount)}원`)).join(" · ")}</li>`).join("")}</ul>` : ""}
      ${q.status === "answered"
        ? `<div class="muted">✓ ${h(q.answer?.applied || q.answer?.label || "")} · ${h(q.answeredBy || "")} ${h(String(q.answeredAt || "").slice(0, 10))}</div>`
        : `<div class="toolbar">${(q.choices || []).map((c) => c.input === "brand"
            ? `<select data-setup-brand="${h(q.id)}"><option value="">브랜드 선택</option>${(ss.brands || []).map((b) => `<option value="${h(b.id)}">${h(b.code ? `${b.code} · ` : "")}${h(b.name)}</option>`).join("")}</select><button data-setup-answer="${h(q.id)}" data-choice="${h(c.key)}">이 브랜드로</button>`
            : c.input === "date" ? `<input type="date" data-setup-input="${h(q.id)}:${h(c.key)}"><button data-setup-answer="${h(q.id)}" data-choice="${h(c.key)}">${h(c.label)}</button>`
            : c.input ? `<input data-setup-input="${h(q.id)}:${h(c.key)}" inputmode="decimal" placeholder="${c.input === "rate" ? (q.topic === "pricing" ? "%" : "수수료율 %") : "금액"}" value="${c.value != null && c.input === "rate" ? h(c.value) : ""}" style="width:110px"><button data-setup-answer="${h(q.id)}" data-choice="${h(c.key)}">${h(c.label)}</button>`
            : `<button class="${q.suggested === c.key ? "primary" : ""}" data-setup-answer="${h(q.id)}" data-choice="${h(c.key)}">${h(c.label)}</button>`).join("")}</div>`}
    </div>`;
  return `
    ${head}
    <div class="npb-subnav">
      <button class="npb-subtab ${ss.show === "open" ? "active" : ""}" data-setup-show="open">남은 질문 <span class="muted">${open.length}</span></button>
      <button class="npb-subtab ${ss.show === "done" ? "active" : ""}" data-setup-show="done">답한 질문 <span class="muted">${done.length}</span></button>
      <span class="muted" style="align-self:center;margin-left:8px">${Object.entries(byKind).map(([k, n]) => `${SETUP_KIND_LABEL[k] || k} ${n}`).join(" · ")}</span>
    </div>
    <section class="setup-list">${shown.map(card).join("") || `<div class="panel"><div class="panel-body"><p class="muted">${ss.show === "open" ? "남은 질문이 없습니다." : "아직 답한 질문이 없습니다."}</p></div></div>`}</section>`;
}

function bindSetup() {
  const ss = setupState();
  if (ss.list === null && !ss.loading) { loadSetup().then(renderApp); return; }
  app.querySelectorAll("[data-setup-show]").forEach((b) => b.addEventListener("click", () => { ss.show = b.dataset.setupShow; renderApp(); }));
  app.querySelectorAll("[data-setup-answer]").forEach((b) => b.addEventListener("click", async () => {
    const qid = b.dataset.setupAnswer;
    const choice = b.dataset.choice;
    const body = { choice };
    const input = app.querySelector(`[data-setup-input="${CSS.escape(`${qid}:${choice}`)}"]`);
    if (input) body.value = input.value;
    const brandSel = app.querySelector(`[data-setup-brand="${CSS.escape(qid)}"]`);
    if (brandSel) body.brandId = brandSel.value;
    try {
      const res = await api(`/api/setup/questions/${encodeURIComponent(qid)}/answer`, { method: "POST", body });
      showToast(`적용했습니다: ${res.applied || ""}`);
      await loadSetup();
      renderApp();
    } catch (error) {
      showToast(error.message || "적용하지 못했습니다.", "error");
    }
  }));
}

// 자금 > 채권원장
function renderReceivableLedger() {
  const cs = cashState();
  if (!cs.rec) return `<section class="panel"><div class="panel-body"><p class="muted">불러오는 중…</p></div></section>`;
  const detail = cs.recDetail;
  return `
    <section class="v2-wide">
      <div class="panel">
        <div class="panel-head"><h2>채권원장</h2><span class="muted">채권총액 − (수수료 차감 + 회생 현금변제) = 잔액</span></div>
        <div class="table-wrap"><table class="compact" data-unit="원">
          <thead><tr><th>브랜드</th><th>채권총액</th><th>수수료 차감</th><th>회생 현금변제</th><th>잔액</th></tr></thead>
          <tbody>${cs.rec.map((r) => `<tr data-rec-open="${h(r.brandId)}" style="cursor:pointer" class="${detail?.brand?.id === r.brandId ? "selected" : ""}">
            <td>${r.code ? `<span class="code-tag">${h(r.code)}</span>` : ""}${h(r.name)}${r.creditor ? `<br><span class="muted" style="font-size:11px">회생채권 · 계획표: ${h(r.creditor)}</span>`
              : r.claimKind === "separate" ? `<br><span class="muted" style="font-size:11px">회생채권 아님 · 별도 변제${r.claimNote ? ` — ${h(r.claimNote)}` : ""}</span>`
              : r.claimKind === "none" ? `<br><span class="danger-text" style="font-size:11px">채권자 아님${r.claimNote ? ` — ${h(r.claimNote)}` : ""}</span>`
              : `<br><span class="danger-text" style="font-size:11px">계획표 채권자 못 찾음</span>`}</td>
            <td class="num">${money.format(r.base)}</td><td class="num">${money.format(r.commission || 0)}</td><td class="num">${money.format(r.rehabCash || 0)}</td>
            <td class="num"><strong>${money.format(r.balance)}</strong></td></tr>`).join("")}</tbody>
        </table></div>
      </div>
    </section>
    ${detail ? v2Modal(`
        <div class="panel-head"><h2>${h(detail.brand.name)} 채권원장</h2><button data-rec-close>닫기</button></div>
        <div class="panel-body">${detail ? `
          <p>채권총액 ${money.format(detail.ledger.base)} − 수수료 차감 ${money.format(detail.ledger.commission || 0)} − 회생 현금변제 ${money.format(detail.ledger.rehabCash || 0)} = <strong>${money.format(detail.ledger.balance)}원</strong></p>
          ${detail.ledger.split ? `<table class="kv" style="min-width:0;margin-bottom:10px"><tbody>
            <tr><th style="text-align:left">회생계획표(${h(detail.creditor)})</th><td class="num">채권 ${money.format(detail.ledger.split.planTotal)}${detail.ledger.split.planTotal !== detail.ledger.base ? ` <span class="danger-text">(채권총액과 다름)</span>` : ""}</td></tr>
            <tr><th style="text-align:left">20% 현금변제(10년 계획)</th><td class="num">${money.format(detail.ledger.split.cashPlan)} 중 ${money.format(detail.ledger.split.cashPaid)} 냄 · 남음 <strong>${money.format(detail.ledger.split.cashLeft)}</strong></td></tr>
            <tr><th style="text-align:left">80% (수수료 차감으로 갚는 몫)</th><td class="num">${money.format(detail.ledger.split.convertPart)} 중 ${money.format(detail.ledger.split.commission)} 차감 · 남음 <strong>${money.format(detail.ledger.split.convertLeft)}</strong></td></tr>
          </tbody></table>` : `<p class="muted">회생계획표에서 이 브랜드의 채권자를 찾지 못했습니다(회생변제 화면에서 계획표를 가져왔는지 확인).</p>`}
          <div class="table-wrap" style="max-height:520px"><table class="compact" data-unit="원"><thead><tr><th>날짜</th><th>구분</th><th>주문</th><th>차감</th><th>잔액</th></tr></thead><tbody>
            ${detail.ledger.entries.slice().reverse().map((e) => `<tr><td>${h(String(e.date).slice(0, 10))}</td><td>${h(e.kind)}</td><td class="muted" style="font-size:12px">${h(e.orderNo || e.memo || "")}</td>
              <td class="num">${money.format(e.amount)}</td><td class="num">${money.format(e.balance)}</td></tr>`).join("")}
          </tbody></table></div>` : ""}</div>`, "data-rec-close") : ""}`;
}
