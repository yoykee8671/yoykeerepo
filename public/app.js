const state = {
  admin: null,
  tab: "dashboard",
  brands: [],
  requests: [],
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
  settlement: { year: new Date().getFullYear(), month: new Date().getMonth() + 1, brandId: "", cafe24: null, bank: null, useClobe: true, useCafe24: true, result: null, running: false, comparing: false, compare: null },
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
  }
};

// 정산 브랜드는 화면에서 고른다. 도톤 외 브랜드도 같은 방식으로 정산한다.
const NPB_DEFAULT_BRAND = "doteon";
const npbBrand = () => state.npb.brandId || NPB_DEFAULT_BRAND;
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
function npbRowMath(row) {
  const qty = Number(row.qty || 0);
  const ea = Number(row.eaPerUnit || 1) || 1;
  const src = row.source || {};
  const has = (v) => v !== undefined && v !== null && v !== "";
  const list = has(src.listAmount) ? Number(src.listAmount) : Number(row.listPrice || 0) * qty * ea;
  // 기준가(=salePrice)가 있고 수량이 있으면 매출은 그 곱이다. 서버와 같은 규칙.
  const revenue = Number(row.salePrice || 0) > 0 && qty > 0
    ? Number(row.salePrice) * qty
    : (has(src.saleAmount) ? Number(src.saleAmount) : Number(row.salePrice || 0) * qty);
  if (has(src.settleAmount)) {
    const settle = Number(src.settleAmount);
    return { revenue, fee: revenue - settle, settle, list, fromFile: true };
  }
  const fee = has(src.feeAmount)
    ? Number(src.feeAmount)
    : Math.round(revenue * Number(row.feeRate || 0));
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
const money = new Intl.NumberFormat("ko-KR");
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
const RECENT_BRANDS_KEY = "wooofpay_recent_brands";

window.addEventListener("message", async (event) => {
  if (event.origin !== location.origin) return;
  if (!state.admin) return;
  const type = event.data?.type;
  if (type === "requestSaved" && !isRequestPopup) {
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
  if (!response.ok) {
    const error = new Error(data?.error || "요청에 실패했습니다.");
    if (data?.details) error.details = data.details;
    error.payload = data;
    throw error;
  }
  return data;
}

function h(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;");
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

function renderCreditBalance(value) {
  const n = Number(value || 0);
  if (!n) return `<span class="muted">-</span>`;
  const color = n > 0 ? "var(--green)" : "var(--red)";
  const prefix = n > 0 ? "+" : "";
  return `<strong style="color:${color}">${prefix}${money.format(n)}원</strong>`;
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
  const session = await api("/api/session");
  state.admin = session.admin;
  if (!state.admin) {
    renderLogin();
    return;
  }
  await loadAll();
  if (isRequestPopup) {
    state.tab = "requests";
    state.editingRequest = state.requests.find((item) => item.id === popupRequestId) || null;
  }
  if (isBrandPopup) {
    state.tab = "brands";
    state.editingBrand = state.brands.find((item) => item.id === popupBrandId) || null;
    state.editingPromotionRule = null;
  }
  // Landing back from the clobe OAuth redirect. Strip the query so a reload
  // doesn't replay the toast.
  const params = new URLSearchParams(location.search);
  const clobeResult = params.get("clobe");
  const cafe24Result = params.get("cafe24");
  if (clobeResult || cafe24Result) {
    state.tab = "reconcile";
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

async function loadAll() {
  // 이력·아카이브는 화면을 열 때가 아니라 해당 탭을 눌렀을 때 부른다. 감사로그
  // 전체는 2MB가 넘어서, 매번 실어 보내면 나머지 응답까지 같이 밀린다.
  const [dashboard, brands, requests, priceEntries, priceAliases, promotionRules, paymentLogs, admins, menus] = await Promise.all([
    api("/api/dashboard"),
    api("/api/brands"),
    api("/api/requests"),
    api("/api/price-entries"),
    api("/api/price-aliases"),
    api("/api/promotion-rules"),
    api("/api/payment-logs"),
    api("/api/admins"),
    api("/api/menus")
  ]);
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
        <h1>WooofPay</h1>
        <p>입금 요청, 브랜드 아카이브, 관리자 이력을 한 곳에서 관리합니다.</p>
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

function renderApp() {
  if (isRequestPopup) {
    app.innerHTML = renderRequestPopup();
    bindCurrentTab();
    app.querySelector("[data-close-popup]")?.addEventListener("click", () => window.close());
    app.querySelector("[data-reset-popup-form]")?.addEventListener("click", () => {
      state.editingRequest = null;
      history.replaceState({}, "", "/?request-popup=1");
      renderApp();
      focusRequestForm();
    });
    app.querySelector("[data-logout]").addEventListener("click", async () => {
      await api("/api/logout", { method: "POST" });
      state.admin = null;
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
      renderLogin();
    });
    return;
  }
  const tabs = [
    ["dashboard", "대시보드"],
    ["requests", "입금요청"],
    ["prices", "단가표"],
    ["brands", "브랜드"],
    ["admins", "관리자"],
    ["audits", "이력"],
    ["archive", "아카이브"],
    // 자동화(카페24 수집)와 클로브ai(입금대사)는 결국 한 흐름이라 한 화면에서
    // 본다. 권한 키는 pipeline 하나로 묶고, 화면 안에서 두 단계를 이어 보여준다.
    ["pipeline", "주문매칭"],
    ["settlement", "정산"],
    ["npb", "npb정산"]
  ].filter(([key]) => can(key, "view") || (key === "pipeline" && can("reconcile", "view")));
  app.innerHTML = `
    <div class="shell">
      <aside class="sidebar">
        <div class="brandmark">
          <strong>WooofPay</strong>
          <span>선매입 브랜드 입금 관리</span>
        </div>
        <nav class="nav">
          ${tabs.map(([key, label]) => `<button data-tab="${key}" class="${state.tab === key ? "active" : ""}">${label}</button>`).join("")}
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
      clearEditing();
      renderApp();
    });
  });
  app.querySelector("[data-logout]").addEventListener("click", async () => {
    await api("/api/logout", { method: "POST" });
    state.admin = null;
    renderLogin();
  });
  bindCurrentTab();
}

function renderRequestPopup() {
  return `
    <main class="popup-shell">
      ${pageHead(
        state.editingRequest ? "입금요청 수정" : "입금요청 입력",
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
              <table>
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
                      <td><div class="row-actions"><button data-edit-promotion-rule="${item.id}">수정</button><button class="danger" data-delete-promotion-rule="${item.id}">삭제</button></div></td>
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
  state.editingPriceEntry = null;
  state.editingPriceAlias = null;
  state.editingPromotionRule = null;
}

function renderCurrentTab() {
  if (state.tab === "requests") return renderRequests();
  if (state.tab === "prices") return renderPrices();
  if (state.tab === "brands") return renderBrands();
  if (state.tab === "admins") return renderAdmins();
  if (state.tab === "audits") return renderAudits();
  if (state.tab === "archive") return renderArchive();
  if (state.tab === "settlement") return renderSettlement();
  if (state.tab === "pipeline") return renderPipeline() + renderReconcile();
  if (state.tab === "reconcile") return renderPipeline() + renderReconcile();
  if (state.tab === "npb") return renderNpb();
  return renderDashboard();
}

function pageHead(title, subtitle, actions = "") {
  return `
    <div class="topbar">
      <div>
        <h1>${h(title)}</h1>
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

function renderDashboard() {
  const d = state.dashboard;
  return `
    ${pageHead("대시보드", "스프레드시트 집계 구조를 웹앱 데이터로 정리한 운영 화면입니다.")}
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
    <a href="/api/export/payment-log.csv"><button type="button">입금로그 CSV</button></a>
    <a href="/api/export/payment-log.xls"><button type="button">입금로그 Excel</button></a>
    <a href="/api/export/csv"><button type="button">CSV</button></a>
    <a href="/api/export/xls"><button type="button">Excel</button></a>
    <button class="primary" type="button" data-open-request-popup>새 창 입금요청</button>
  `;
  const rows = filteredRequests();
  const selectableRows = rows.filter((item) => item.status !== "deleted");
  const allSelected = selectableRows.length > 0 && selectableRows.every((item) => state.selectedRequestIds.includes(item.id));
  const selectedIdSet = new Set(state.selectedRequestIds);
  const selectedTotal = state.requests
    .filter((item) => selectedIdSet.has(item.id))
    .reduce((sum, item) => sum + finalDepositAmount(item), 0);
  return `
    ${pageHead("입금요청", "주문번호, 업체 실 입금액, 입금 예정일과 정산 메모를 관리합니다.", actions)}
    <section class="layout single">
      <div class="panel">
        <div class="panel-head"><h2>요청 목록</h2><span class="muted">${money.format(rows.length)}건</span></div>
        <div class="panel-body">
          <div class="toolbar" style="margin-bottom:12px">
            <label style="display:flex;align-items:center;gap:6px"><span>일괄 입금일</span><input type="date" data-bulk-paid-at value="${h(state.bulkPaidAt)}"></label>
            <button type="button" data-mark-selected-paid ${state.selectedRequestIds.length ? "" : "disabled"}>선택 입금완료</button>
            <span style="display:flex;align-items:center;gap:4px">
              <select data-bulk-status ${state.selectedRequestIds.length ? "" : "disabled"}>
                <option value="">선택 상태 변경…</option>
                ${STATUS_CHOICES.map((v) => `<option value="${v}">${h(statusLabel(v))}로 변경</option>`).join("")}
              </select>
            </span>
            <button type="button" class="danger" data-delete-selected-requests ${state.selectedRequestIds.length ? "" : "disabled"}>선택 삭제</button>
            <button type="button" data-clear-selection ${state.selectedRequestIds.length ? "" : "disabled"}>선택 해제</button>
            <span class="muted">선택 ${state.selectedRequestIds.length}건</span>
            ${state.selectedRequestIds.length ? `<span class="muted">· 선택 합계 <strong class="amount-emphasis">${money.format(selectedTotal)}원</strong></span>` : ""}
          </div>
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
          <div class="table-wrap">
            <table class="requests-table">
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
    <tr>
      <td><input type="checkbox" data-select-request="${item.id}" ${state.selectedRequestIds.includes(item.id) ? "checked" : ""}></td>
      <td><div class="row-actions">${item.status !== "paid" ? `<button data-pay-request="${item.id}">입금완료</button>` : ""}<button data-open-edit-request-popup="${item.id}">수정</button><button class="danger" data-delete-request="${item.id}">삭제</button></div></td>
      <td>${renderRowStatusSelect(item)}</td>
      <td>${settlementLabel(item.settlementType)}</td>
      <td>${h(item.brandName)}</td>
      <td><a href="#" class="order-link" data-open-edit-request-popup="${item.id}">${h(item.orderNo)}</a></td>
      <td>${h(item.customerName)}</td>
      <td>${money.format(Number(item.productSalesAmount || 0))}원</td>
      <td>${money.format(Number(item.shippingFee || 0))}원</td>
      <td><strong class="amount-emphasis">${money.format(finalDepositAmount(item))}원</strong>${Number(item.creditUsedAmount || 0) > 0 ? `<br><span class="muted" style="font-size:11px">원 ${money.format(Number(item.depositAmount || 0))}원 − 외상 ${money.format(Number(item.creditUsedAmount || 0))}원</span>` : ""}${Number(item.priorPaidAmount || 0) > 0 ? `<br><span class="muted" style="font-size:11px">총 ${money.format(Number(item.depositAmount || 0))}원 − 기지급 ${money.format(Number(item.priorPaidAmount || 0))}원 = 추가 ${money.format(finalDepositAmount(item))}원</span>` : ""}</td>
      <td class="wrap">${h(summarizeAppliedPromotions(item) || "-")}</td>
      <td>${h(item.expectedDepositDate)}</td>
      <td>${formatPaidAtCell(item.paidAt)}</td>
      <td class="wrap">${h(item.cutoffNote || item.requiredMemo)}</td>
      <td class="wrap">${renderRequestMemoCell(item)}</td>
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
    <form class="form-grid" data-request-form>
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
      <div class="field">
        <label>총 배송비</label>
        <input name="shippingFee" type="text" readonly class="money-input" value="${h(formatAmount(defaultShippingFee))}">
      </div>
      <div class="field two" data-hide-direct="1">
        <div><label>수수료율(%)</label><input name="commissionRate" type="number" min="0" max="100" step="0.1" readonly value="${h(item.commissionRate ?? promotion?.commissionRate ?? selectedBrand?.commissionRate ?? "")}"></div>
        <div data-supply-amount-field style="${settlementType === "prepay_supply" ? "" : "display:none"}"><label>공급가 합</label><input name="supplyAmount" type="text" inputmode="numeric" class="money-input" value="${h(formatAmount(item.supplyAmount))}"></div>
      </div>
      <div class="field" data-hide-direct="1"><label>적용 프로모션</label><input name="promotionRuleName" readonly value="${h(item.promotionRuleName || promotion?.name || "")}" placeholder="없음"></div>
      <div class="field" data-hide-direct="1">
        <label>품목별 항목 추가</label>
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
          <span class="muted">최대 30개 행 · 모든 값은 선택 입력, 현재판매가는 원판매가−할인금액 자동(수정 가능)</span>
        </div>
      </div>
      <div class="field two">
        <div><label>업체 실 입금액</label><input name="depositAmount" type="text" readonly class="money-input" value="${h(formatAmount(item.depositAmount))}"></div>
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
      <div class="field">
        <label>입금일시</label>
        <input name="paidAt" type="datetime-local" step="1" value="${h(toDatetimeLocal(item.paidAt))}">
      </div>
      <div class="field">
        <label>주문 메모</label>
        <textarea name="notes" placeholder="해당 입금건에 대한 메모 (예: 통화 내용, 특이사항 등)">${h(item.notes || "")}</textarea>
      </div>
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
      <div class="field"><label>상태</label><select name="status">${["pending", "await_deposit", "consignment_unpaid", "paid", "hold", "error"].map((s) => `<option value="${s}" ${(item.status || (settlementType === "consignment" ? "consignment_unpaid" : "pending")) === s ? "selected" : ""}>${statusLabel(s)}</option>`).join("")}</select></div>
      <div class="field" data-hide-direct="1">
        <label>계산 수수료 <span class="muted" style="font-weight:400" data-commission-display-hint>${selectedBrand?.hasReceivable ? "(채권 기준 — 프로모션 무시)" : "(실제 차감액)"}</span></label>
        <input name="commissionAmount" type="text" readonly class="money-input" value="${h(formatAmount(item.commissionAmount))}">
      </div>
      <div class="toolbar">
        <button class="primary" type="submit">${state.editingRequest ? "수정 저장" : "요청 추가"}</button>
        ${state.editingRequest ? `<button type="button" data-cancel-edit>취소</button>` : ""}
      </div>
    </form>
  `;
}

function renderBrands() {
  const rules = filteredPromotionRules();
  const brandRows = filteredBrands();
  return `
    ${pageHead("브랜드", "시트별 업체 정보를 관리하고 공유 링크와 Google Sheets 아카이브 링크를 지정합니다.", `<button class="primary" data-new-brand>새 브랜드</button>`)}
    <section class="layout">
      <div class="panel">
        <div class="panel-head"><h2>브랜드 목록</h2><span class="muted">${money.format(brandRows.length)}개</span></div>
        <div class="panel-body" style="padding-bottom:0">
          <input data-brand-filter-q placeholder="브랜드명, 사업자명 검색" value="${h(state.brandFilterQ)}">
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>브랜드</th><th>정산유형</th><th>요청</th><th>금액/채권잔액</th><th>외상잔액</th><th>사업자</th><th>프로모션</th><th>공유</th><th>작업</th></tr></thead>
            <tbody>${brandRows.map(renderBrandRow).join("") || `<tr><td colspan="9" class="empty">표시할 브랜드가 없습니다.</td></tr>`}</tbody>
          </table>
        </div>
        <div class="panel-body">
          <h3 style="margin-top:0">프로모션 규칙 (수수료 / 가격할인)</h3>
          <div class="table-wrap" style="max-height:280px">
            <table>
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
                    <td><div class="row-actions"><button data-edit-promotion-rule="${item.id}">수정</button><button class="danger" data-delete-promotion-rule="${item.id}">삭제</button></div></td>
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
          <table>
            <thead><tr><th>브랜드</th><th>코드</th><th>품목명</th><th>옵션</th><th>공급가</th><th>원판매가</th><th>할인금액</th><th>현재 판매가</th><th>적용 시작</th><th>적용 종료</th><th>작업</th></tr></thead>
            <tbody>
              ${rows.map((item) => `
                <tr>
                  <td>${h(item.brandName)}</td>
                  <td>${h(item.itemCode)}</td>
                  <td>${h(item.itemName)}</td>
                  <td>${h(item.spec || item.unit || "")}</td>
                  <td>${money.format(Number(item.supplyPrice || 0))}원</td>
                  <td>${money.format(Number(item.originalPrice || item.consumerPrice || 0))}원</td>
                  <td>${money.format(Number(item.discountPrice || 0))}원</td>
                  <td>${money.format(Number(item.salePrice || 0))}원</td>
                  <td>${h(item.effectiveFrom)}</td>
                  <td>${h(item.effectiveTo || "상시")}</td>
                  <td><div class="row-actions"><button data-clone-price-entry="${item.id}">개정 추가</button><button data-edit-price-entry="${item.id}">수정</button><button class="danger" data-delete-price-entry="${item.id}">삭제</button></div></td>
                </tr>`).join("") || `<tr><td colspan="11" class="empty">등록된 품목이 없습니다.</td></tr>`}
            </tbody>
          </table>
        </div>
        <div class="panel-body">
          <h3 style="margin-top:0">개정 이력</h3>
          <div class="table-wrap" style="max-height:280px">
            <table>
              <thead><tr><th>브랜드</th><th>코드</th><th>품목명</th><th>공급가</th><th>원판매가</th><th>할인금액</th><th>현재 판매가</th><th>적용 시작</th><th>적용 종료</th><th>작업</th></tr></thead>
              <tbody>
                ${revisions.map((item) => `
                  <tr>
                    <td>${h(item.brandName)}</td>
                    <td>${h(item.itemCode)}</td>
                    <td>${h(item.itemName)}</td>
                    <td>${money.format(Number(item.supplyPrice || 0))}원</td>
                    <td>${money.format(Number(item.originalPrice || item.consumerPrice || 0))}원</td>
                    <td>${money.format(Number(item.discountPrice || 0))}원</td>
                    <td>${money.format(Number(item.salePrice || 0))}원</td>
                    <td>${h(item.effectiveFrom)}</td>
                    <td>${h(item.effectiveTo || "상시")}</td>
                    <td><div class="row-actions"><button data-edit-price-entry="${item.id}">수정</button><button class="danger" data-delete-price-entry="${item.id}">삭제</button></div></td>
                  </tr>`).join("") || `<tr><td colspan="10" class="empty">개정 이력이 없습니다.</td></tr>`}
              </tbody>
            </table>
          </div>
          <h3>기간별 품목 별칭</h3>
          <div class="table-wrap" style="max-height:280px">
            <table>
              <thead><tr><th>브랜드</th><th>별칭</th><th>연결 품목</th><th>적용 기간</th><th>상태</th><th>작업</th></tr></thead>
              <tbody>
                ${aliases.map((item) => `
                  <tr>
                    <td>${h(item.brandName)}</td>
                    <td>${h(item.aliasText)}</td>
                    <td>${h(item.targetItemCode ? `${item.targetItemCode} | ` : "")}${h(item.targetItemName)}</td>
                    <td>${h(item.validFrom || "-")}${item.validTo ? ` ~ ${h(item.validTo)}` : " ~ 상시"}</td>
                    <td>${priceAliasStatusLabel(item)}</td>
                    <td><div class="row-actions"><button data-edit-price-alias="${item.id}">수정</button><button class="danger" data-delete-price-alias="${item.id}">삭제</button></div></td>
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
  return state.brands.filter((brand) => {
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
      .concat(promotionOptions.map((rule) => `<option value="${rule.id}" ${item.promotionRuleId === rule.id ? "selected" : ""}>${h(rule.name)}</option>`))
      .join("");
    return `<select data-line-promotion="${item.id}" aria-label="프로모션">${options}</select>`;
  };
  return `
    <div class="table-wrap line-items-wrap" style="max-height:300px">
      <table class="line-items-table">
        <thead><tr><th>작업</th><th>코드</th><th>품목명</th><th>수량</th><th>공급가</th><th>원판매가</th><th>할인금액</th><th>현재판매가</th><th>적용시작</th><th>적용종료</th><th>판매합계</th><th>프로모션</th></tr></thead>
        <tbody>
          ${items.map((item) => `
            <tr data-line-row="${item.id}">
              <td><button type="button" class="danger" data-remove-line-item="${item.id}">삭제</button></td>
              <td><input value="${h(item.itemCode || "")}" data-line-code="${item.id}" aria-label="품목코드" placeholder="코드"></td>
              <td><input value="${h(item.itemName || "")}" data-line-name="${item.id}" aria-label="품목명" placeholder="품목명"></td>
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
    <tr>
      <td>${brand.starred ? "★ " : ""}${h(brand.name)}</td>
      <td><span class="badge">${brand.type === "reference" ? "참고시트" : settlementLabel(brand.settlementType)}</span></td>
      <td>${money.format(brand.requestCount || 0)}건</td>
      <td>${brand.hasReceivable ? `${money.format(brand.receivableRemaining || 0)}원` : `${money.format(brand.totalAmount || 0)}원`}</td>
      <td>${renderCreditBalance(brand.creditBalance)}</td>
      <td class="wrap">${h(brand.businessName || "-")}<br><span class="muted">${h(cutoffLabel(brand))}</span></td>
      <td class="wrap">${h(brand.promotionSummary || "-")}</td>
      <td><a href="${share}" target="_blank" rel="noreferrer">공유 보기</a></td>
      <td><div class="row-actions"><button data-edit-brand="${brand.id}">수정</button><a href="/api/export/brand/${brand.id}.xls"><button>Excel</button></a><button class="danger" data-delete-brand="${brand.id}">삭제</button></div></td>
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
          ${history.length > 1 ? `<button type="button" class="danger" data-remove-brand-rule="${rule.id}">삭제</button>` : ""}
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
        <table><thead><tr><th>상태</th><th>적용 시작</th><th>수수료</th><th>배송비</th><th>사유</th><th></th></tr></thead>
        <tbody>${rows}</tbody></table>
      </div>
    </div>
  `;
}

function renderBrandForm() {
  const b = state.editingBrand || {};
  return `
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
          <option value="order" ${(b.settlementDateBasis || (b.settlementType === "consignment" ? "delivered" : "order")) === "order" ? "selected" : ""}>주문일 기준 (주문번호 앞 8자리) · 배송완료 건만</option>
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
        <div><label>입금은행명</label><input name="bankName" value="${h(b.bankName)}"></div>
        <div><label>통장계좌번호</label><input name="bankAccount" value="${h(b.bankAccount)}"></div>
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
      <div class="field"><label>Google Sheets 아카이브 URL</label><input name="googleSheetUrl" value="${h(b.googleSheetUrl)}" placeholder="브랜드별 공유용 스프레드시트 링크"></div>
      <div class="toolbar">
        <button class="primary" type="submit">${state.editingBrand ? "수정 저장" : "브랜드 추가"}</button>
        ${state.editingBrand ? `<button type="button" data-cancel-edit>취소</button>` : ""}
      </div>
    </form>
  `;
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
      <table>
        <thead><tr><th>대상 품목</th><th>작업</th></tr></thead>
        <tbody>
          ${items.map((item, index) => `
            <tr>
              <td>${h(item.label || formatPromotionTargetLabel(item))}</td>
              <td><button type="button" data-remove-promotion-target="${index}">삭제</button></td>
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
          <table>
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
        <table><thead><tr><th style="width:120px">메뉴</th><th>허용할 동작</th></tr></thead>
        <tbody>${rows}</tbody></table>
      </div>
    </div>
  `;
}

function renderAdminRow(admin) {
  return `
    <tr>
      <td>${h(admin.name)}</td>
      <td>${h(admin.email)}</td>
      <td><span class="badge">${h(admin.role)}</span></td>
      <td>${admin.isActive ? "Y" : "N"}</td>
      <td>${fmtDate(admin.createdAt)}</td>
      <td><div class="row-actions"><button data-edit-admin="${admin.id}">수정</button><button class="danger" data-delete-admin="${admin.id}" ${admin.id === state.admin.id ? "disabled" : ""}>삭제</button></div></td>
    </tr>
  `;
}

function renderAdminForm() {
  const a = state.editingAdmin || {};
  return `
    <form class="form-grid" data-admin-form>
      <div class="field"><label>이름</label><input name="name" value="${h(a.name)}" required></div>
      <div class="field"><label>이메일</label><input name="email" type="email" value="${h(a.email)}" ${state.editingAdmin ? "disabled" : "required"}></div>
      <div class="field two">
        <div><label>역할</label><select name="role">${["owner", "manager", "operator", "viewer"].map((r) => `<option value="${r}" ${(a.role || "operator") === r ? "selected" : ""}>${r}</option>`).join("")}</select></div>
        <div><label>상태</label><select name="isActive"><option value="true" ${a.isActive !== false ? "selected" : ""}>Y</option><option value="false" ${a.isActive === false ? "selected" : ""}>N</option></select></div>
      </div>
      <div class="field"><label>비밀번호 ${state.editingAdmin ? "(변경 시에만 입력)" : ""}</label><input name="password" type="password" ${state.editingAdmin ? "" : "required"}></div>
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
          <table>
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
            <table>
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
  if (state.tab === "requests") bindRequests();
  if (state.tab === "prices") bindPrices();
  if (state.tab === "brands") bindBrands();
  if (state.tab === "admins") bindAdmins();
  if (state.tab === "archive") bindArchive();
  if (state.tab === "settlement") bindSettlement();
  if (state.tab === "pipeline" || state.tab === "reconcile") {
    bindPipeline();
    bindReconcile();
  }
  if (state.tab === "npb") bindNpb();
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

function bindRequests() {
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
  app.querySelector("[data-open-request-popup]")?.addEventListener("click", () => {
    window.open("/?request-popup=1", "wooofpay-request", "width=760,height=940,resizable=yes,scrollbars=yes");
  });
  app.querySelector("[data-bulk-paid-at]")?.addEventListener("input", (event) => {
    state.bulkPaidAt = event.target.value || new Date().toISOString().slice(0, 10);
  });
  app.querySelector("[data-mark-selected-paid]")?.addEventListener("click", async () => {
    await markRequestsPaid(state.selectedRequestIds, state.bulkPaidAt);
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
  const lineItemPromotionOptions = () => {
    const brand = getSelectedBrand();
    if (!brand) return [];
    const targetDate = getEffectiveDate();
    return state.promotionRules.filter((rule) => {
      if (rule.brandId !== brand.id || rule.isActive === false) return false;
      const from = rule.validFrom || "0000-01-01";
      const to = rule.validTo || "9999-12-31";
      return from <= targetDate && targetDate <= to;
    });
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
    .querySelectorAll("[name='productSalesAmount'], [name='extraShippingFee'], [name='commissionRate'], [name='supplyAmount'], [name='expectedDepositDate'], [name='overpaidAmount'], [name='creditUsedAmount'], [name='cancelledAmount'], [name='priorPaidAmount']")
    .forEach((input) => input.addEventListener("input", () => updateRequestCalculation(requestForm)));
  requestForm.querySelector("[name='baseShippingFee']")?.addEventListener("input", (event) => {
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
    const brand = state.brands.find((item) => item.id === body.brandId) || findBrandByInput(body.brandSearch);
    if (brand) body.brandName = brand.name;
    body.brandId = brand?.id || "";
    if (body.brandId) pushRecentBrand(body.brandId);
    body.lineItems = body.lineItemsJson || "[]";
    delete body.brandSearch;
    delete body.lineItemsJson;
    const wasEditing = !!state.editingRequest;
    try {
      if (state.editingRequest) {
        await api(`/api/requests/${state.editingRequest.id}`, { method: "PUT", body });
      } else {
        await api("/api/requests", { method: "POST", body });
      }
      state.editingRequest = null;
      if (isRequestPopup) {
        history.replaceState({}, "", "/?request-popup=1");
        window.opener?.postMessage({ type: "requestSaved" }, location.origin);
      }
      await refreshAndRender();
      showToast(wasEditing ? "수정되었습니다." : "저장되었습니다.");
      focusRequestForm();
    } finally {
      const liveBtn = requestForm.querySelector('[type="submit"]');
      if (liveBtn) liveBtn.disabled = false;
    }
  });
  app.querySelector("[data-cancel-edit]")?.addEventListener("click", () => {
    state.editingRequest = null;
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
  setValue("promotionRuleName", promotion?.name || "");
  setValue("cutoffNote", brand.cutoffNote || "");
  setValue("requiredMemo", brand.requiredMemo || "");
  setValue("sourceSheet", brand.rawSheetName || brand.name || "");
  setValue("businessName", brand.businessName || "");
  setValue("businessNumber", brand.businessNumber || "");
  setValue("depositorName", brand.depositorName || "");
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
  const promotionContext = buildPromotionPreview(brand, lineItems, form.querySelector("[name='expectedDepositDate']")?.value);
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
  const promotionRuleInput = form.querySelector("[name='promotionRuleName']");
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
  if (promotionRuleInput) promotionRuleInput.value = promotionContext?.name || "";
  if (productSalesInput && derivedProductSalesAmount > 0) productSalesInput.value = formatAmount(productSalesAmount);
  if (supplyInput && lineItems.length) supplyInput.value = formatAmount(supplyAmount);
  if (baseShippingInput && !baseManual) baseShippingInput.value = formatAmount(baseShippingFee);
  if (totalShippingInput) totalShippingInput.value = formatAmount(shippingFee);
  if (depositInput) depositInput.value = formatAmount(depositAmount);
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
    if (promotionRuleInput) promotionRuleInput.value = "";
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
      padding: "12px 20px", borderRadius: "8px", color: "#fff", fontSize: "14px",
      fontWeight: "500", zIndex: "9999", boxShadow: "0 10px 26px rgba(0,0,0,0.18)",
      opacity: "0", transition: "opacity 180ms ease-out", pointerEvents: "none"
    });
    document.body.appendChild(el);
  }
  el.style.background = kind === "error" ? "#b42318" : "#287d3c";
  el.textContent = text;
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

function buildPromotionPreview(brand, lineItems = [], effectiveDate = "") {
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
    return allRule ? {
      primaryRule: allRule,
      name: allRule.name,
      commissionRate: Number(allRule.commissionRate ?? brand.commissionRate ?? 0),
      commissionAmount: null,
      discountValueType: allRule.discountValueType || "",
      discountValue: Number(allRule.discountValue || 0)
    } : null;
  }
  const rulesById = new Map(activeRules.map((rule) => [rule.id, rule]));
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
  bindSearchInput("[data-brand-filter-q]", (value) => {
    state.brandFilterQ = value;
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
  app.querySelector("[data-brand-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = formObject(event.currentTarget);
    body.isActive = body.isActive === "true";
    body.hasReceivable = body.hasReceivable === "true";
    body.payAfterShipping = body.payAfterShipping === "true";
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

function bindAdmins() {
  app.querySelector("[data-new-admin]").addEventListener("click", () => {
    state.editingAdmin = null;
    renderApp();
  });
  app.querySelectorAll("[data-edit-admin]").forEach((button) => {
    button.addEventListener("click", () => {
      state.editingAdmin = state.admins.find((item) => item.id === button.dataset.editAdmin);
      state.editingPermissions = null;
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
      state.editingPermissions = {
        role: app.querySelector("[data-admin-form] [name=role]")?.value || state.editingAdmin?.role || "operator",
        permissions: perms
      };
      renderApp();
    });
  });
  app.querySelector("[data-admin-form] [name=role]")?.addEventListener("change", (event) => {
    // 등급을 바꾸면 그 등급의 기본 권한을 보여준다 — 이후 개별 조정은 그대로 가능.
    state.editingPermissions = { role: event.target.value, permissions: null };
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
    await refreshAndRender();
  });
  app.querySelector("[data-cancel-edit]")?.addEventListener("click", () => {
    state.editingAdmin = null;
    state.editingPermissions = null;
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
  const brandOptions = brands
    .map((b) => `<option value="${b.id}" ${s.brandId === b.id ? "selected" : ""}>${h(b.name)} · ${h(settlementLabel(b.settlementType))}</option>`)
    .join("");
  return `
    ${pageHead("정산", "카페24 주문내역 · 은행 거래내역 · 입금요청(자동)을 대조하여 월별 정산서를 생성합니다.")}
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
          ${canUseClobe() && s.cafe24 && !s.useCafe24
            ? `<button data-settlement-compare ${s.comparing ? "disabled" : ""}>${s.comparing ? "대조 중…" : "카페24 API와 대조"}</button>`
            : ""}
          <span class="muted">입금요청 데이터는 시스템에서 자동 조회됩니다.</span>
        </div>
        ${renderCafe24Compare(s.compare)}
      </div>
    </section>
    ${renderSettlementResult(s.result)}
  `;
}

// Makes the bank data's provenance visible on the result, so an unexpected
// 은행 출금합 can be traced to the source before anyone edits a spreadsheet.
// 변환기가 기존 CSV 내보내기를 그대로 재현하는지 눈으로 확인하는 자리.
// 차이가 0이어야 CSV 업로드를 API 조회로 바꿔도 정산 금액이 그대로다.
function renderCafe24Compare(compare) {
  if (!compare) return "";
  if (compare.error) {
    return `<p class="muted" style="color:var(--red)">대조 실패: ${h(compare.error)}</p>`;
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
        ? `<div class="table-wrap" style="max-height:260px"><table>
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

  app.querySelector("[data-settlement-run]")?.addEventListener("click", async () => {
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
  });
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
    finalized: ["paid", "확정"]
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
function npbShipTypes() {
  const cc = state.npb.config?.costConfig || {};
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

function canUseClobe() {
  return state.admin?.role === "owner" || state.admin?.role === "manager";
}

// --- 반자동 파이프라인 ------------------------------------------------------
// 단계마다 버튼이 하나씩 있고, 각 버튼은 먼저 "무엇을 하게 될지"만 보여준다.
// 실제 생성·상태변경은 확인한 뒤 별도 버튼으로만 일어난다.
function renderPipeline() {
  const p = state.pipeline;
  const head = pageHead("주문매칭",
    "카페24 주문 수집 → 확인 → 입금매칭 → 카페24 반영. 단계마다 눌러서 진행합니다. "
    + "아래에서 클로브ai 은행 거래와 대사합니다.");
  if (!canUseClobe()) {
    return `${head}<section class="panel"><div class="panel-body"><p class="muted">이 메뉴는 오너 또는 매니저만 사용할 수 있습니다.</p></div></section>`;
  }
  return `
    ${head}
    ${renderClobeFreshness(p.scraping)}
    <section class="panel">
      <div class="panel-head"><h2>① 수집 — 카페24 주문에서 입금요청 만들기</h2></div>
      <div class="panel-body">
        <div class="field two">
          <div><label>조회 시작일</label><input type="date" data-pipe-start value="${h(p.startDate)}"></div>
          <div><label>조회 종료일</label><input type="date" data-pipe-end value="${h(p.endDate)}"></div>
        </div>
        <div class="toolbar">
          <button class="primary" data-pipe-collect ${p.collecting ? "disabled" : ""}>${p.collecting ? "수집 중…" : "수집하기"}</button>
          <span class="muted">결제된 주문만 가져옵니다. 이미 등록된 건은 건너뜁니다. 여기서는 아무것도 저장하지 않습니다.</span>
        </div>
        ${p.error ? `<p class="muted" style="color:var(--red)">${h(p.error)}</p>` : ""}
        ${renderPipelineCollect(p.collect)}
      </div>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>⑤ 출고 확인 — 입금대기를 입금요청으로</h2></div>
      <div class="panel-body">
        <p class="muted">출고 후 입금 브랜드의 입금대기 건 중, 카페24에 송장이 찍힌 것을 찾습니다.</p>
        <div class="toolbar">
          <button data-pipe-shipped ${p.shipping ? "disabled" : ""}>${p.shipping ? "확인 중…" : "출고 확인하기"}</button>
        </div>
        ${renderPipelineShipped(p.shipped)}
      </div>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>③ 입금매칭 · ④ 카페24 반영</h2></div>
      <div class="panel-body">
        <p class="muted">
          ③ 통장 출금과 입금요청 대조는 <b>클로브ai</b> 탭에서 실행합니다.<br>
          ④ 입금완료 건을 카페24에서 배송준비중으로 바꾸는 단계는 아직 없습니다 — 쓰기 권한이 필요해 마지막에 붙입니다.
        </p>
      </div>
    </section>
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
    <section class="panel">
      <div class="panel-head">
        <h2>클로브 데이터 최신성</h2>
        <span class="muted">은행·카드 내역이 언제까지 수집된 것인지</span>
      </div>
      <div class="panel-body">
        <div class="toolbar">
          <button data-pipe-scraping>수집 상태 확인</button>
          <a class="button" href="https://app.clobe.ai" target="_blank" rel="noreferrer">클로브ai에서 최신화하기 ↗</a>
        </div>
        <p class="muted">
          최신화(재수집)는 클로브 쪽에서만 실행할 수 있습니다. 우프페이에서 대신 눌러줄 방법이 없어
          (클로브 MCP에 해당 기능이 없습니다), 위 링크로 이동해 실행한 뒤 돌아와서 수집하세요.
        </p>
        ${rows ? `<div class="table-wrap" style="max-height:220px"><table>
            <thead><tr><th>상태</th><th>자산</th><th>마지막 수집</th><th>비고</th></tr></thead>
            <tbody>${rows}</tbody></table></div>` : ""}
      </div>
    </section>
  `;
}

function renderPipelineCollect(collect) {
  if (!collect) return "";
  const drafts = collect.drafts || [];
  if (!drafts.length) {
    return `<p class="muted">새로 만들 입금요청이 없습니다. (조회 주문 ${money.format(collect.orderCount || 0)}건 ·
      이미 등록 ${collect.skipped?.duplicate || 0} · 미결제 제외 ${collect.skipped?.unpaid || 0})</p>`;
  }
  const selected = new Set(state.pipeline.selected);
  const rows = drafts.map((d, i) => {
    const lines = d.lineItems.map((l) => `${h(l.itemName)} ×${l.quantity}`).join("<br>");
    const codes = d.lineItems.map((l) => `<span class="muted">${h(l.orderItemCode)}</span>`).join("<br>");
    return `<tr>
      <td><input type="checkbox" data-pipe-draft="${i}" ${selected.has(i) ? "checked" : ""}></td>
      <td>${h(d.orderNo)}<br><span class="muted">${h(d.customerName)}</span></td>
      <td>${h(d.brandName)}<br><span class="muted">${d.payAfterShipping ? "출고후입금 → 입금대기" : "입금요청"}</span></td>
      <td>${lines}</td>
      <td>${codes}</td>
      <td class="num"><strong>${money.format(d.depositAmount || 0)}원</strong><br>
        <span class="muted">판매 ${money.format(d.productSalesAmount || 0)} · 배송 ${money.format(d.baseShippingFee || 0)}</span></td>
      <td>${d.shippingMismatch
        ? `<span class="badge clobe-medium">배송비 확인</span><br><span class="muted">카페24 ${money.format(d.cafe24ShippingFee || 0)}원</span>`
        : `<span class="muted">-</span>`}</td>
    </tr>`;
  }).join("");
  return `
    <div style="border-top:1px solid var(--line);margin-top:12px;padding-top:12px">
      <h3>② 확인 — 만들어질 요청 ${drafts.length}건</h3>
      <p class="muted">
        조회 주문 ${money.format(collect.orderCount || 0)}건 · 이미 등록 ${collect.skipped?.duplicate || 0} ·
        미결제 제외 ${collect.skipped?.unpaid || 0} · 취소만 있는 주문 ${collect.skipped?.cancelled || 0}
      </p>
      ${(collect.unmappedSuppliers || []).length
        ? `<p class="muted" style="color:var(--red)">브랜드 매핑이 없는 공급사 ${collect.unmappedSuppliers.length}곳 —
            ${collect.unmappedSuppliers.slice(0, 5).map((s) => `${h(s.supplierName)}(${h(s.supplierId)}) ${s.orderCount}건`).join(", ")}.
            브랜드 화면에서 카페24 공급사코드를 지정하면 다음 수집부터 포함됩니다.</p>`
        : ""}
      <div class="table-wrap" style="max-height:420px"><table>
        <thead><tr><th><input type="checkbox" data-pipe-all></th><th>주문</th><th>브랜드</th><th>품목</th><th>품목번호</th><th>입금액</th><th>비고</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <div class="toolbar">
        <button class="primary" data-pipe-apply>선택한 ${state.pipeline.selected.length}건 입금요청 생성</button>
        <span class="muted">배송비가 어긋나는 건은 기본 선택에서 빼뒀습니다.</span>
      </div>
    </div>
  `;
}

function renderPipelineShipped(shipped) {
  if (!shipped) return "";
  const items = shipped.items || [];
  if (!items.length) return `<p class="muted">송장이 찍힌 입금대기 건이 없습니다.</p>`;
  const selected = new Set(state.pipeline.shippedSelected);
  const rows = items.map((it) => `<tr>
    <td><input type="checkbox" data-pipe-ship="${h(it.requestId)}" ${selected.has(it.requestId) ? "checked" : ""}></td>
    <td>${h(it.orderNo)}</td><td>${h(it.brandName)}</td>
    <td class="num">${money.format(it.amount || 0)}원</td>
    <td><span class="muted">송장 ${h(it.trackingNo)}</span></td>
  </tr>`).join("");
  return `
    <div class="table-wrap" style="max-height:300px"><table>
      <thead><tr><th><input type="checkbox" data-pipe-ship-all></th><th>주문</th><th>브랜드</th><th>금액</th><th>송장</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <div class="toolbar">
      <button class="primary" data-pipe-ship-apply>선택한 ${state.pipeline.shippedSelected.length}건 입금요청으로 전환</button>
    </div>
  `;
}

function renderReconcile() {
  const c = state.clobe;
  const head = pageHead(
    "클로브ai",
    "클로브ai의 은행 입금내역과 미입금 요청을 대조합니다. 제안된 매칭을 확인 후 입금완료 처리하세요."
  );
  if (!canUseClobe()) {
    return `${head}<section class="panel"><div class="panel-body"><p class="muted">이 메뉴는 오너 또는 매니저만 사용할 수 있습니다.</p></div></section>`;
  }
  if (c.loading || !c.status) {
    return `${head}<section class="panel"><div class="panel-body"><p class="muted">연동 상태를 불러오는 중…</p></div></section>`;
  }
  const clobeBody = c.status.connected
    ? `
      ${renderReconcileSettings()}
      ${c.error ? `<section class="panel"><div class="panel-body"><p style="color:var(--red)">${h(c.error)}</p></div></section>` : ""}
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
        <p class="muted" style="color:var(--red)">
          CAFE24_MALL_ID / CAFE24_CLIENT_ID / CAFE24_CLIENT_SECRET 환경변수가 설정되지 않았습니다.
        </p>
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
        <div class="toolbar"><button class="primary" data-cafe24-connect>카페24 연결하기</button></div>
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
        ? `<p class="muted" style="color:var(--red)">
             갱신 토큰이 ${expiryText} 에 만료됐습니다. 주문 조회와 정산 자동조회가 모두 실패합니다.
             아래 <strong>다시 연결하기</strong>를 눌러 카페24 관리자로 재승인해 주세요.
           </p>`
        : `<p class="muted">
             연결됨. 주문내역을 조회할 수 있습니다.
             ${expiryText ? `갱신 토큰 만료 ${expiryText} (만료 전 자동 연장)` : "갱신 토큰은 2주마다 자동 연장됩니다."}
           </p>`}
      ${state24.sample ? `<pre class="table-wrap" style="max-height:260px;padding:12px;font-size:12px">${h(state24.sample)}</pre>` : ""}
      <div class="toolbar">
        <button class="${status.expired ? "primary" : "ghost"}" data-cafe24-connect>다시 연결하기</button>
        <button data-cafe24-sample ${state24.sampling || status.expired ? "disabled" : ""}>${state24.sampling ? "조회 중…" : "주문 응답 샘플 보기"}</button>
        <button class="ghost" data-cafe24-disconnect>연결 해제</button>
      </div>
      ${state24.error ? `<p class="muted" style="color:var(--red)">${h(state24.error)}</p>` : ""}
    </div></section>`;
}

function renderReconcileConnect() {
  return `
    <section class="panel">
      <div class="panel-head"><h2>클로브ai 연결</h2></div>
      <div class="panel-body">
        <p class="muted">
          연결하면 클로브에 등록된 회사 계좌의 입금내역을 읽어와 미입금 요청과 자동 대조합니다.
          WooofPay는 <strong>읽기 전용</strong> 도구만 호출하며, 장부·전표를 수정하지 않습니다.
        </p>
        <div class="toolbar"><button class="primary" data-clobe-connect>클로브ai 연결하기</button></div>
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
        ${status.encryptedAtRest ? "" : `<p class="muted" style="color:var(--red)">CLOBE_TOKEN_SECRET 미설정 — 토큰이 암호화되지 않은 채 저장됩니다.</p>`}
        <div class="field two">
          <div><label>대사 대상 회사</label>
            <input type="text" readonly value="${h(status.companyName || "주식회사 우프컴퍼니")}">
            <span class="muted">우프컴퍼니 법인으로 고정됩니다.</span></div>
          <div><label>입금예정일 허용 오차 (일)</label>
            <input type="number" min="0" max="60" data-clobe-window value="${Number(status.windowDays)}"></div>
        </div>
        ${accountRows ? `<div class="field"><label>대사에 포함할 계좌</label>${accountRows}</div>` : ""}
        <div class="field two">
          <div><label>조회 시작일</label><input type="date" data-clobe-start value="${h(state.clobe.startDate)}"></div>
          <div><label>조회 종료일</label><input type="date" data-clobe-end value="${h(state.clobe.endDate)}"></div>
        </div>
        <div class="toolbar">
          <button class="primary" data-clobe-run ${state.clobe.running ? "disabled" : ""}>${state.clobe.running ? "대조 중…" : "입금내역 대조"}</button>
          <button class="ghost" data-clobe-disconnect>연결 해제</button>
          <span class="muted">${status.lastSyncAt ? `마지막 대조 ${h(status.lastSyncAt.slice(0, 16).replace("T", " "))}` : "아직 대조하지 않았습니다."}</span>
        </div>
        <p class="muted">클로브 은행데이터는 실시간이 아니라 마지막 수집 시점 기준입니다. 최신화는 app.clobe.ai 에서 직접 실행하세요.</p>
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
          ? `<div class="table-wrap"><table><thead><tr>
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
          ? `<div class="table-wrap"><table><thead><tr><th>일시</th><th>입금자</th><th>금액</th><th>분류</th></tr></thead>
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
      // 배송비가 어긋나는 건은 사람이 먼저 보게 기본 선택에서 뺀다.
      p.selected = (p.collect.drafts || []).map((d, i) => (d.shippingMismatch ? null : i)).filter((v) => v !== null);
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
  app.querySelector("[data-pipe-all]")?.addEventListener("change", (e) => {
    p.selected = e.target.checked ? (p.collect?.drafts || []).map((_, i) => i) : [];
    renderApp();
  });

  app.querySelector("[data-pipe-apply]")?.addEventListener("click", async () => {
    const drafts = p.selected.map((i) => p.collect?.drafts?.[i]).filter(Boolean);
    if (!drafts.length) return showToast("생성할 요청을 선택하세요.", "error");
    if (!confirm(`${drafts.length}건의 입금요청을 생성할까요?`)) return;
    try {
      const result = await api("/api/pipeline/collect/apply", { method: "POST", body: { drafts } });
      showToast(`${result.createdCount}건 생성했습니다.${result.skipped?.length ? ` (중복 ${result.skipped.length}건 제외)` : ""}`);
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
    if (!state.clobe.companies) {
      state.clobe.companies = (await api("/api/clobe/companies")).companies || [];
    }
    if (status.companyId && !state.clobe.accounts) {
      state.clobe.accounts = (await api("/api/clobe/accounts")).accounts || [];
    }
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
  const subnav = NPB_SCREENS
    .map(([key, label]) =>
      `<button data-npb-screen="${key}" class="npb-subtab ${n.screen === key ? "active" : ""}">${label}</button>`)
    .join("");
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
    <div class="npb-subnav">${subnav}</div>
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
        <table>
          <thead><tr><th>상태</th><th>정산월</th><th>총수량</th><th>매출계</th><th>이익</th><th>작업</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </section>
  `;
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
  const chip = (c, isDone) => {
    const up = uploads[c.code];
    return `<div class="npb-ch-chip ${isDone ? "on" : ""}">
      <strong>${h(c.name)}</strong>
      ${modeSelect(c)}
      <span class="muted">${isDone
        ? `${h(up.fileName || "업로드됨")}${up.lines ? ` · ${up.lines.length}개 품목` : ""}`
        : "미업로드"}</span>
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
      </div>` : ""}
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
        ${waiting.length ? `<div class="npb-pending-wrap">
          <p style="color:var(--red);margin:0">
            <b>반영 대기 ${waiting.length}개 채널</b> — ${h(waiting.map((c) => c.name).join(", "))}.
            채널별 <b>[반영]</b> 을 눌러야 워크시트에 들어갑니다. 누른 채널만 바뀌므로,
            워크시트에서 손으로 고쳐 둔 다른 채널은 그대로입니다.
          </p>
          <div class="toolbar">
            ${waiting.map((c) => `<button class="primary" data-npb-apply="${h(c.code)}">${h(c.name)} 반영</button>`).join("")}
          </div>
        </div>` : ""}
        ${renderNpbUnresolved()}
        ${pending ? `<div class="npb-pending-wrap">
          <p class="muted" style="color:var(--red)">채널을 알 수 없는 파일이 있습니다. 직접 지정하세요.</p>
          ${pending}</div>` : ""}
        <div class="npb-ch-chips">
          ${done.map((c) => chip(c, true)).join("")}
          ${todo.map((c) => chip(c, false)).join("")}
        </div>
      </div>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>입출고 원장 (물류)</h2></div>
      <div class="panel-body">
        <div class="npb-upload-card">
          <input type="file" accept=".csv,.xlsx,.xls" data-npb-upload-logistics>
          <span class="muted">${uploads.logistics ? h(uploads.logistics.fileName || "업로드됨") : "미업로드"}</span>
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
      <p class="muted">
        판매처가 상품코드를 주면 그 코드로 기억합니다 — 이름이 바뀌어도 계속 인식됩니다.
        <b>어느 상품</b>인지 고르고, 그 한 건이
        <b>재고에서 몇 개 빠지는지</b> 배수를 정하세요. 3팩이면 <b>주문수량 × 3</b> 입니다.
        치킨2+고구마1 처럼 섞인 묶음은 <b>[+ 상품 추가]</b> 로 여러 개를 걸면 됩니다.
        한 번 지정하면 <b>다음부터 자동으로 인식</b>됩니다.
      </p>
      <div class="table-wrap" style="max-height:340px"><table>
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
function npbReviewMath(row) {
  const qty = Number(row.qty || 0);
  const listTotal = Number(row.listPrice || 0) * qty;
  // 기준가 = 그 판매처에서 실제로 팔린 단가. 정가는 상품표 값이라 고정이고,
  // 할인·계약가가 반영된 실제 단가는 여기에 적는다.
  const unit = row.unitPrice != null && row.unitPrice !== ""
    ? Number(row.unitPrice)
    : Number(row.listPrice || 0);
  const discount = Number(row.discountAmount || 0);
  const shipping = Number(row.shippingAmount || 0);
  const sale = row.saleAmount != null && row.saleAmount !== ""
    ? Number(row.saleAmount)
    : unit * qty - discount + shipping;
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
    ["물류사용비", Number(row.handling || 0)]
  ].filter(([, price]) => price > 0));

  const shipRows = breakdown.map((row) => {
    const file = shipFiles[row.key];
    const detail = shipParts(row).map(([label, price]) => `
      <tr class="npb-ship-detail">
        <td class="muted">└ ${label}</td>
        <td></td>
        <td class="num muted">${money.format(row.count)}건</td>
        <td class="num muted">${money.format(price)}</td>
        <td class="num muted">${money.format(price * Number(row.count || 0))}</td>
        <td></td>
      </tr>`).join("");
    return `
      <tr>
        <td>${h(row.label)}</td>
        <td>
          <input type="file" accept=".csv,.xlsx" data-npb-shipfile="${h(row.key)}">
          ${file
            ? `<div class="muted">${h(file.fileName)} · ${h(file.basisLabel)} 기준 ${money.format(file.autoCount)}건 (${money.format(file.rowCount)}행)</div>`
            : `<div class="muted">출고내역 파일을 올리면 건수를 셉니다.</div>`}
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
      <div class="table-wrap"><table>
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
      <div class="table-wrap"><table>
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
      <div class="table-wrap"><table>
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
        <td><input class="num" type="number" data-npb-rv="${i}" data-npb-rf="discountAmount"
          value="${h(row.discountAmount ?? 0)}"></td>
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
        <p class="muted">
          <b>기준가</b>는 그 판매처에서 실제로 팔린 단가입니다 — 확정하면 기억해 두었다가
          다음 달 같은 코드에 자동으로 채웁니다. 파일이 다른 단가를 말하면 빨간 글씨로 알려드립니다.
          기준가·수량·할인·수수료율을 여기서 고칠 수 있습니다. 고치면 그 행은 <b>파일 금액 대신
          계산식</b>을 씁니다. <b>[확정/반영]</b> 을 눌러야 워크시트와 정산서에 들어갑니다.
        </p>
      </div>
      <div class="table-wrap" style="max-height:420px"><table>
        <thead><tr>
          <th>순번</th><th>품목</th><th>정가</th><th>기준가</th><th>수량</th><th>할인(원)</th>
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
  const rows = block.rows
    .map((row, ri) => {
      const m = npbRowMath(row);
      subQty += Number(row.qty || 0);
      subRevenue += m.revenue;
      subFee += m.fee;
      subSettle += m.settle;
      subList += m.list;
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
          <td><input class="num npb-pct" type="number" step="0.01" data-npb-ws="${bi}"
            data-npb-wr="${ri}" data-npb-wf="feeRate" value="${h(feePct)}"></td>
          <td><input class="num" type="number" data-npb-ws="${bi}" data-npb-wr="${ri}"
            data-npb-wf="qty" value="${h(row.qty)}"></td>
          <td class="num">${money.format(m.revenue)}</td>
          <td class="num">${money.format(m.fee)}</td>
          <td class="num">${money.format(m.settle)}</td>
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
              <th>제품</th><th>정가</th><th>기준가</th><th>수수료율(%)</th>
              <th>판매수량</th><th>매출</th><th>수수료</th><th>정산</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
          <tfoot>
            <tr>
              <th>합계</th>
              <td class="num">-</td><td class="num">-</td><td class="num">-</td>
              <td class="num">${money.format(subQty)}</td>
              <td class="num">${money.format(subRevenue)}</td>
              <td class="num">${money.format(subFee)}</td>
              <td class="num">${money.format(subSettle)}</td>
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
        <div class="table-wrap"><table>
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
        <table>
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
      </div>
      <div class="table-wrap">
        <table>
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
        <td><button class="danger" data-npb-ch-del="${i}">삭제</button></td>
      </tr>`)
    .join("") || `<tr><td colspan="11" class="empty">등록된 채널이 없습니다.</td></tr>`;
  return `
    <section class="panel">
      <div class="panel-head"><h2>채널 설정</h2><span class="muted">${channels.length}개</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>코드</th><th>이름</th><th>계산방식</th><th>판매가</th><th>수수료율</th><th>공급가</th><th>아키타입</th><th>파일명 키워드</th><th>정산주체</th><th>업로드 반영</th><th></th></tr></thead>
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
      <div class="table-wrap"><table>
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
          <td><button class="danger" data-npb-3pl-del="${i}">삭제</button></td>
        </tr>`)
      .join("") || `<tr><td colspan="${cols.length + 1}" class="empty">단가표가 비어 있습니다.</td></tr>`;
    tpl = `
      <h3>3PL 단가표 (${h(tableKey)})</h3>
      <div class="table-wrap"><table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>
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
  const splitRows = (ps?.parties || [])
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
        <table>
          <thead><tr><th>파티</th><th>비율</th><th>배분액</th><th>비고</th></tr></thead>
          <tbody>${splitRows}</tbody>
        </table>
      </div>` : ""}
      <div class="panel-body toolbar">
        <button class="primary" data-npb-download="${h(n.currentKey)}">엑셀 다운로드</button>
        <button data-npb-finalize>정산 확정</button>
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
  app.querySelectorAll("[data-npb-screen]").forEach((btn) => {
    btn.addEventListener("click", () => {
      n.screen = btn.dataset.npbScreen;
      renderApp();
    });
  });
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
      n.aliasDraft = { ...(n.aliasDraft || {}), [sel.dataset.npbAlias]: sel.value };
    });
  });
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
  const npbApplyChannel = async (code) => {
    try {
      const res = await api(`/api/npb/settlements/${encodeURIComponent(n.currentKey)}/confirm`, {
        method: "POST", body: { channel: code }
      });
      n.review = null;
      await npbLoadDetail(n.currentKey);
      showToast(res.removed
        ? `${npbChannelName(code)} 내역을 워크시트에서 뺐습니다.`
        : `${npbChannelName(code)} 반영 완료 — ${res.rows.length}개 품목. 다른 채널은 그대로입니다.`);
      renderApp();
    } catch (error) {
      showToast(error.message || "반영 실패", "error");
    }
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
      const value = Number(input.value || 0);
      row[field] = field === "feeRate" ? value / 100 : value;
      // 손대는 순간 그 행은 파일 금액 대신 계산식을 쓴다. 파일 추출이 기준금액을
      // 빠뜨리고 오는 경우가 있어, 고친 값이 이기지 않으면 고칠 방법이 없다.
      const manual = new Set(row.manualFields || []);
      manual.add("listPrice");
      if (["unitPrice", "qty", "discountAmount", "shippingAmount"].includes(field)) {
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
    try {
      const res = await api(`/api/npb/settlements/${encodeURIComponent(n.currentKey)}/confirm`, {
        method: "POST",
        body: { channel: review.channel, rows: review.rows }
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

  app.querySelector("[data-npb-upload-logistics]")?.addEventListener("change", async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    await npbDoUpload({ kind: "logistics", file });
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
      } else if (kind === "logistics") {
        n.current.uploads = { ...(n.current.uploads || {}),
          logistics: { fileName, uploadedAt: new Date().toISOString() } };
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
        await api(`/api/npb/settlements/${encodeURIComponent(n.currentKey)}/shipping-file`, {
          method: "POST",
          body: { shipType, fileBase64: await readFileAsBase64(file), fileName: file.name }
        });
        await npbLoadDetail(n.currentKey);
        showToast("출고내역을 반영했습니다.");
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
    let sq = 0, sr = 0, sf = 0, ss = 0;
    blockEl.querySelectorAll("tbody tr").forEach((tr, ri) => {
      const row = block.rows[ri];
      if (!row) return;
      const m = npbRowMath(row);
      sq += Number(row.qty || 0); sr += m.revenue; sf += m.fee; ss += m.settle;
      const tds = tr.querySelectorAll("td");
      if (tds[5]) tds[5].textContent = money.format(m.revenue);
      if (tds[6]) tds[6].textContent = money.format(m.fee);
      if (tds[7]) tds[7].textContent = money.format(m.settle);
    });
    const foot = blockEl.querySelectorAll("tfoot td");
    if (foot[3]) foot[3].textContent = money.format(sq);
    if (foot[4]) foot[4].textContent = money.format(sr);
    if (foot[5]) foot[5].textContent = money.format(sf);
    if (foot[6]) foot[6].textContent = money.format(ss);
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
      showToast("정산을 확정했습니다.");
      renderApp();
    } catch (error) {
      showToast(error.message || "확정 실패", "error");
    }
  });
}

init().catch((error) => {
  app.innerHTML = `<main class="login"><section class="login-panel"><h1>앱 오류</h1><p>${h(error.message)}</p></section></main>`;
});
