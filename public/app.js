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
  archives: [],
  dashboard: null,
  filters: { q: "", statusValues: null, brandIds: null, settlementTypes: null, promotionRuleId: "" },
  filtersInitialized: false,
  editingRequest: null,
  editingBrand: null,
  editingAdmin: null,
  editingPriceEntry: null,
  editingPriceAlias: null,
  editingPromotionRule: null,
  priceFilters: { brandId: "" },
  priceImportStatus: null,
  brandFilterQ: "",
  selectedRequestIds: [],
  bulkPaidAt: new Date().toISOString().slice(0, 10)
};

const app = document.querySelector("#app");
const money = new Intl.NumberFormat("ko-KR");
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
    pending: "대기",
    paid: "입금완료",
    hold: "보류",
    error: "오류",
    consignment_unpaid: "위탁-입금전"
  }[status] || status || "대기";
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
  return Math.max(0, Number(item?.depositAmount || 0) - Number(item?.creditUsedAmount || 0));
}

function renderCreditBalance(value) {
  const n = Number(value || 0);
  if (!n) return `<span class="muted">-</span>`;
  const color = n > 0 ? "var(--green)" : "var(--red)";
  const prefix = n > 0 ? "+" : "";
  return `<strong style="color:${color}">${prefix}${money.format(n)}원</strong>`;
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
  renderApp();
}

async function loadAll() {
  const [dashboard, brands, requests, priceEntries, priceAliases, promotionRules, paymentLogs, admins, audits, archives] = await Promise.all([
    api("/api/dashboard"),
    api("/api/brands"),
    api("/api/requests"),
    api("/api/price-entries"),
    api("/api/price-aliases"),
    api("/api/promotion-rules"),
    api("/api/payment-logs"),
    api("/api/admins"),
    api("/api/audits"),
    api("/api/archives")
  ]);
  state.dashboard = dashboard;
  state.brands = brands.brands;
  state.requests = requests.requests;
  state.priceEntries = priceEntries.priceEntries;
  state.priceCatalog = priceEntries.catalog;
  state.aliasEntries = priceAliases.priceAliases;
  state.promotionRules = promotionRules.promotionRules;
  state.paymentLogs = paymentLogs.paymentLogs;
  state.admins = admins.admins;
  state.audits = audits.auditLogs;
  state.archives = archives.archiveHistory;
  ensureRequestFilterDefaults();
  state.selectedRequestIds = state.selectedRequestIds.filter((id) =>
    state.requests.some((item) => item.id === id && item.status !== "deleted")
  );
}

function ensureRequestFilterDefaults() {
  const brandIds = state.brands.filter((b) => b.type === "brand").map((b) => b.id);
  if (!state.filtersInitialized) {
    state.filters.brandIds = brandIds;
    state.filters.settlementTypes = ["prepay_debt", "prepay_fee", "prepay_supply", "direct_purchase"];
    state.filters.statusValues = ["pending"];
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
        <div class="notice">초기 계정: owner@wooofpay.local / change-me-now</div>
        <div class="form-grid" style="margin-top:16px">
          <div class="field">
            <label>이메일</label>
            <input name="email" autocomplete="username" value="owner@wooofpay.local">
          </div>
          <div class="field">
            <label>비밀번호</label>
            <input name="password" type="password" autocomplete="current-password" value="change-me-now">
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
    ["archive", "아카이브"]
  ];
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
                <thead><tr><th>프로모션</th><th>범위</th><th>수수료율</th><th>기간</th><th>상태</th><th>작업</th></tr></thead>
                <tbody>
                  ${brandRules.map((item) => `
                    <tr>
                      <td>${h(item.name)}</td>
                      <td class="wrap">${h(item.scopeType === "items" ? (item.targetItemLabels || []).join(", ") || "특정 품목" : "브랜드 전체")}</td>
                      <td>${h(item.commissionRate)}%</td>
                      <td>${h(item.validFrom || "-")}${item.validTo ? ` ~ ${h(item.validTo)}` : " ~ 상시"}</td>
                      <td>${promotionRuleStatusLabel(item)}</td>
                      <td><div class="row-actions"><button data-edit-promotion-rule="${item.id}">수정</button><button class="danger" data-delete-promotion-rule="${item.id}">삭제</button></div></td>
                    </tr>`).join("") || `<tr><td colspan="6" class="empty">등록된 프로모션 규칙이 없습니다.</td></tr>`}
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
    .filter((b) => b.type === "brand")
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
  return `
    ${pageHead("입금요청", "주문번호, 업체 실 입금액, 입금 예정일과 정산 메모를 관리합니다.", actions)}
    <section class="layout single">
      <div class="panel">
        <div class="panel-head"><h2>요청 목록</h2><span class="muted">${money.format(rows.length)}건</span></div>
        <div class="panel-body">
          <div class="toolbar" style="margin-bottom:12px">
            <label style="display:flex;align-items:center;gap:6px"><span>일괄 입금일</span><input type="date" data-bulk-paid-at value="${h(state.bulkPaidAt)}"></label>
            <button type="button" data-mark-selected-paid ${state.selectedRequestIds.length ? "" : "disabled"}>선택 입금완료</button>
            <button type="button" class="danger" data-delete-selected-requests ${state.selectedRequestIds.length ? "" : "disabled"}>선택 삭제</button>
            <button type="button" data-clear-selection ${state.selectedRequestIds.length ? "" : "disabled"}>선택 해제</button>
            <span class="muted">선택 ${state.selectedRequestIds.length}건</span>
          </div>
          <div class="filters request-filters">
            <input data-filter-q placeholder="주문번호, 주문자, 브랜드 검색" value="${h(state.filters.q)}">
            ${renderMultiFilter({
              key: "brand",
              title: "브랜드",
              allLabel: "전체 브랜드",
              options: state.brands.filter((b) => b.type === "brand").map((b) => ({ value: b.id, label: b.name })),
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
              options: ["pending", "consignment_unpaid", "paid", "hold", "error"].map((value) => ({ value, label: statusLabel(value) })),
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
            <table>
              <thead><tr><th><input type="checkbox" data-select-all-requests ${allSelected ? "checked" : ""}></th><th>상태</th><th>정산유형</th><th>브랜드</th><th>주문번호</th><th>주문자</th><th>제품매출</th><th>배송비</th><th>입금액</th><th>적용 프로모션</th><th>예정일</th><th>입금일시</th><th>출고/정산</th><th>메모</th><th>작업</th></tr></thead>
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
      <td><span class="badge ${h(item.status)}">${statusLabel(item.status)}</span></td>
      <td>${settlementLabel(item.settlementType)}</td>
      <td>${h(item.brandName)}</td>
      <td><a href="#" class="order-link" data-open-edit-request-popup="${item.id}">${h(item.orderNo)}</a></td>
      <td>${h(item.customerName)}</td>
      <td>${money.format(Number(item.productSalesAmount || 0))}원</td>
      <td>${money.format(Number(item.shippingFee || 0))}원</td>
      <td><strong class="amount-emphasis">${money.format(finalDepositAmount(item))}원</strong>${Number(item.creditUsedAmount || 0) > 0 ? `<br><span class="muted" style="font-size:11px">원 ${money.format(Number(item.depositAmount || 0))}원 − 외상 ${money.format(Number(item.creditUsedAmount || 0))}원</span>` : ""}</td>
      <td class="wrap">${h(summarizeAppliedPromotions(item) || "-")}</td>
      <td>${h(item.expectedDepositDate)}</td>
      <td>${formatPaidAtCell(item.paidAt)}</td>
      <td class="wrap">${h(item.cutoffNote || item.requiredMemo)}</td>
      <td class="wrap">${renderRequestMemoCell(item)}</td>
      <td><div class="row-actions">${item.status !== "paid" ? `<button data-pay-request="${item.id}">입금완료</button>` : ""}<button data-open-edit-request-popup="${item.id}">수정</button><button class="danger" data-delete-request="${item.id}">삭제</button></div></td>
    </tr>
  `;
}

function renderRequestForm() {
  const item = state.editingRequest || {};
  const selectedBrand = state.brands.find((brand) => brand.id === item.brandId);
  const brandInputValue = selectedBrand?.name || item.brandName || "";
  const brandOptions = recentSortedBrands();
  const lineItems = item.lineItems || [];
  const settlementType = item.settlementType || selectedBrand?.settlementType || "prepay_fee";
  const showReceivableFields = settlementType === "prepay_debt" || (settlementType === "prepay_supply" && Boolean(selectedBrand?.hasReceivable || Number(item.receivableDeduction || 0) > 0));
  const receivableLabel = receivableDeductionLabel(settlementType, selectedBrand);
  const settlementNote = specialSettlementNote(settlementType, selectedBrand);
  const resolvedSourceSheet = item.sourceSheet || selectedBrand?.rawSheetName || selectedBrand?.name || "";
  const resolvedCutoffNote = item.cutoffNote || selectedBrand?.cutoffNote || "";
  const resolvedRequiredMemo = item.requiredMemo || selectedBrand?.requiredMemo || "";
  const resolvedBusinessName = item.businessName || selectedBrand?.businessName || "";
  const resolvedBusinessNumber = item.businessNumber || selectedBrand?.businessNumber || "";
  const resolvedDepositorName = item.depositorName || selectedBrand?.depositorName || "";
  const extraShippingEnabled = Number(item.extraShippingFee || 0) > 0 || Boolean(item.extraShippingNote);
  const commissionDisplay = item.commissionRate ?? selectedBrand?.commissionRate ?? "";
  const promotion = findActivePromotionRule(selectedBrand?.id, item.expectedDepositDate);
  const autoBaseShippingFee = calculateBrandShippingFee(selectedBrand, Number(item.productSalesAmount || item.depositAmount || 0));
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
          <div class="fixed-card"><span>출고 기준</span><strong data-fixed-cutoff>${h(cutoffLabel(selectedBrand || { cutoffNote: resolvedCutoffNote, cutoffType: item.cutoffType, cutoffHour: item.cutoffHour })) || "-"}</strong></div>
          <div class="fixed-card"><span>원본 시트</span><strong data-fixed-source-sheet>${h(resolvedSourceSheet || "-")}</strong></div>
          <div class="fixed-card"><span>입금자명</span><strong data-fixed-depositor>${h(resolvedDepositorName || "-")}</strong></div>
        </div>
        <div class="fixed-summary-notes">
        <div><span>사업자</span><strong data-fixed-business>${h(resolvedBusinessName || "-")}${resolvedBusinessNumber ? ` (${h(resolvedBusinessNumber)})` : ""}</strong></div>
        <div><span>필수 메모</span><strong data-fixed-required-memo>${h(resolvedRequiredMemo || "-")}</strong></div>
        <div><span>정산 메모</span><strong data-fixed-cutoff-note>${h(resolvedCutoffNote || "-")}</strong></div>
        ${settlementNote ? `<div><span>계산 안내</span><strong data-special-settlement-note>${h(settlementNote)}</strong></div>` : `<div style="display:none"><span>계산 안내</span><strong data-special-settlement-note></strong></div>`}
      </div>
      </section>
      <div class="field two">
        <div><label>주문번호</label><input name="orderNo" value="${h(item.orderNo)}" required></div>
        <div><label>주문자명</label><input name="customerName" value="${h(item.customerName)}" required></div>
      </div>
      <div class="field three">
        <div><label>제품매출</label><input name="productSalesAmount" type="number" min="0" value="${h(item.productSalesAmount || item.depositAmount || "")}"></div>
        <div>
          <label>기본 배송비 <span class="muted" style="font-weight:400">(수동 변경 가능)</span></label>
          <input name="baseShippingFee" type="number" min="0" value="${h(defaultBaseShippingFee || "")}" data-manual="${baseShippingManual ? "1" : ""}">
        </div>
        <div>
          <label>수량</label>
          <input name="quantity" type="number" min="0" step="1" value="${h(item.quantity || "")}" placeholder="총 수량">
        </div>
      </div>
      <div class="field">
        <label class="checkbox-line"><input name="useExtraShippingFee" type="checkbox" ${extraShippingEnabled ? "checked" : ""}> 지역/예외 추가배송비 직접 입력</label>
      </div>
      <div class="field two" data-extra-shipping-fields style="${extraShippingEnabled ? "" : "display:none"}">
        <div><label>지역 추가배송비</label><input name="extraShippingFee" type="number" min="0" value="${h(defaultExtraShippingFee || "")}"></div>
        <div><label>추가배송비 메모</label><input name="extraShippingNote" value="${h(item.extraShippingNote || "")}" placeholder="예: 제주 추가 4,000원"></div>
      </div>
      <div class="field">
        <label>총 배송비</label>
        <input name="shippingFee" type="number" readonly value="${h(defaultShippingFee || "")}">
      </div>
      <div class="field two" data-hide-direct="1">
        <div><label>수수료율(%)</label><input name="commissionRate" type="number" min="0" max="100" step="0.1" readonly value="${h(item.commissionRate ?? promotion?.commissionRate ?? selectedBrand?.commissionRate ?? "")}"></div>
        <div data-supply-amount-field style="${settlementType === "prepay_supply" ? "" : "display:none"}"><label>공급가 합</label><input name="supplyAmount" type="number" min="0" value="${h(item.supplyAmount || "")}"></div>
      </div>
      <div class="field" data-hide-direct="1"><label>적용 프로모션</label><input name="promotionRuleName" readonly value="${h(item.promotionRuleName || promotion?.name || "")}" placeholder="없음"></div>
      <div class="field" data-hide-direct="1">
        <label>품목별 공급가</label>
        <input name="lineItemsJson" type="hidden" value='${h(JSON.stringify(lineItems))}'>
        <div class="field two">
          <div><input name="lineItemSearch" list="request-price-options" placeholder="품목코드 또는 품목명 검색"></div>
          <div><input name="lineItemQty" type="number" min="1" value="1" placeholder="수량"></div>
        </div>
        <datalist id="request-price-options"></datalist>
        <div class="toolbar" style="margin-top:8px">
          <button type="button" data-add-line-item>품목 추가</button>
          <button type="button" data-add-manual-line-item>직접 행 추가</button>
          <span class="muted">최대 30개 행</span>
        </div>
        <div class="bulk-paste">
          <label>품목 일괄 입력</label>
          <textarea
            name="lineItemsBulk"
            placeholder="예시 1) TEST-001[TAB]2&#10;예시 2) 테스트 상품[TAB]3&#10;예시 3) TEST-001[TAB]테스트 상품[TAB]2"
          ></textarea>
          <div class="toolbar">
            <button type="button" data-bulk-add-line-items>붙여넣기 추가</button>
            <span class="muted" data-bulk-result></span>
          </div>
          <div data-bulk-unmatched></div>
        </div>
        <div data-line-items-table>${renderRequestLineItems(lineItems)}</div>
      </div>
      <div class="field two">
        <div><label>업체 실 입금액</label><input name="depositAmount" type="number" readonly value="${h(item.depositAmount || "")}"></div>
        <div data-receivable-deduction-field style="${showReceivableFields ? "" : "display:none"}"><label data-receivable-deduction-label>${h(receivableLabel)}</label><input name="receivableDeduction" type="number" readonly value="${h(item.receivableDeduction || "")}"></div>
      </div>
      <div class="field two">
        <div><label>입금 예정일</label><input name="expectedDepositDate" type="date" value="${h(item.expectedDepositDate)}"></div>
        <div>
          <label>조정 반영 후 최종 입금액 <span class="muted" style="font-weight:400">(자동 계산, 직접 수정 가능)</span></label>
          <input name="paidAmount" type="number" min="0" value="${h(item.paidAmount || "")}" data-manual="${item.paidAmount ? "1" : ""}">
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
      <section class="fixed-summary">
        <div class="fixed-summary-title">외상 처리 <span class="muted" style="font-weight:400">(품절·가격변경·오입금 등 정산 조정용)</span></div>
        <div data-brand-credit-hint class="muted" style="margin-bottom:8px">${
          selectedBrand
            ? `${h(selectedBrand.name)} 외상 잔액: ${renderCreditBalance(selectedBrand.creditBalance)}`
            : "브랜드를 선택하면 잔액이 표시됩니다."
        }</div>
        <div class="field two">
          <div>
            <label>과입금(외상 발생)</label>
            <input name="overpaidAmount" type="number" min="0" value="${h(item.overpaidAmount || "")}" placeholder="0">
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
            <input name="creditUsedAmount" type="number" min="0" value="${h(item.creditUsedAmount || "")}" placeholder="0">
          </div>
          <div>
            <label>외상 차감 메모</label>
            <input name="creditUsedNote" value="${h(item.creditUsedNote || "")}" placeholder="예: 20260518-001 과입금 차감">
          </div>
        </div>
        <div class="muted">실제 송금액 ≒ 업체 실 입금액 − 외상 차감. 차감 금액은 직접 입력하세요.</div>
      </section>
      <div class="field"><label>상태</label><select name="status">${["pending", "consignment_unpaid", "paid", "hold", "error"].map((s) => `<option value="${s}" ${(item.status || ((item.settlementType || selectedBrand?.settlementType) === "consignment" ? "consignment_unpaid" : "pending")) === s ? "selected" : ""}>${statusLabel(s)}</option>`).join("")}</select></div>
      <div class="field" data-hide-direct="1"><label>계산 수수료</label><input name="commissionAmount" type="number" readonly value="${h(item.commissionAmount || "")}"></div>
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
          <h3 style="margin-top:0">기간 프로모션 수수료 규칙</h3>
          <div class="table-wrap" style="max-height:280px">
            <table>
              <thead><tr><th>브랜드</th><th>프로모션</th><th>범위</th><th>수수료율</th><th>기간</th><th>상태</th><th>작업</th></tr></thead>
              <tbody>
                ${rules.map((item) => `
                  <tr>
                    <td>${h(item.brandName)}</td>
                    <td>${h(item.name)}</td>
                    <td class="wrap">${h(item.scopeType === "items" ? (item.targetItemLabels || []).join(", ") || "특정 품목" : "브랜드 전체")}</td>
                    <td>${h(item.commissionRate)}%</td>
                    <td>${h(item.validFrom || "-")}${item.validTo ? ` ~ ${h(item.validTo)}` : " ~ 상시"}</td>
                    <td>${promotionRuleStatusLabel(item)}</td>
                    <td><div class="row-actions"><button data-edit-promotion-rule="${item.id}">수정</button><button class="danger" data-delete-promotion-rule="${item.id}">삭제</button></div></td>
                  </tr>`).join("") || `<tr><td colspan="7" class="empty">등록된 프로모션 규칙이 없습니다.</td></tr>`}
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
            <thead><tr><th>브랜드</th><th>코드</th><th>품목명</th><th>옵션</th><th>공급가</th><th>원판매가</th><th>할인가</th><th>현재 판매가</th><th>적용 시작</th><th>적용 종료</th><th>작업</th></tr></thead>
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
              <thead><tr><th>브랜드</th><th>코드</th><th>품목명</th><th>공급가</th><th>원판매가</th><th>할인가</th><th>현재 판매가</th><th>적용 시작</th><th>적용 종료</th><th>작업</th></tr></thead>
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
        <div><label>공급가</label><input name="supplyPrice" type="number" min="0" value="${h(item.supplyPrice || "")}" required></div>
        <div><label>적용 시작일</label><input name="effectiveFrom" type="date" value="${h(item.effectiveFrom || new Date().toISOString().slice(0, 10))}" required></div>
      </div>
      <div class="field"><label>적용 종료일 (비우면 상시)</label><input name="effectiveTo" type="date" value="${h(item.effectiveTo || "")}"></div>
      <div class="field three">
        <div><label>원판매가</label><input name="originalPrice" type="number" min="0" value="${h((item.originalPrice ?? item.consumerPrice) || "")}"></div>
        <div><label>할인가</label><input name="discountPrice" type="number" min="0" value="${h(item.discountPrice || "")}"></div>
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

function renderRequestLineItems(items) {
  if (!items.length) return `<div class="empty">추가된 품목이 없습니다.</div>`;
  return `
    <div class="table-wrap" style="max-height:220px">
      <table>
        <thead><tr><th>코드</th><th>품목명</th><th>수량</th><th>공급가</th><th>판매단가</th><th>판매합계</th><th>공급가합</th><th>작업</th></tr></thead>
        <tbody>
          ${items.map((item) => `
            <tr>
              <td><input value="${h(item.itemCode || "")}" data-line-code="${item.id}" aria-label="품목코드"></td>
              <td>
                <input value="${h(item.itemName || "")}" data-line-name="${item.id}" aria-label="품목명">
                ${item.spec ? `<br><span class="muted">${h(item.spec)}</span>` : ""}
              </td>
              <td>
                <div class="qty-editor">
                  <button type="button" data-line-step="${item.id}" data-step="-1" aria-label="수량 감소">-</button>
                  <input type="number" min="1" value="${h(item.quantity)}" data-line-qty="${item.id}" aria-label="수량">
                  <button type="button" data-line-step="${item.id}" data-step="1" aria-label="수량 증가">+</button>
                </div>
              </td>
              <td><input type="number" min="0" value="${h(item.unitSupplyPrice || "")}" data-line-supply-price="${item.id}" aria-label="공급가"></td>
              <td><input type="number" min="0" value="${h(item.unitSalePrice || "")}" data-line-sale-price="${item.id}" aria-label="판매단가"></td>
              <td>${money.format(Number(item.totalSaleAmount || 0))}원</td>
              <td>${money.format(Number(item.totalSupplyPrice || 0))}원</td>
              <td><button type="button" data-remove-line-item="${item.id}">삭제</button></td>
            </tr>`).join("")}
        </tbody>
      </table>
    </div>
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
        <div><label>적용 미리보기</label><input value="${h(describeShippingRule(b))}" disabled></div>
      </div>
      <div class="field"><label>배송비 운영 메모</label><input value="지역 추가배송비는 입금요청 입력에서 필요할 때만 별도 기입합니다." disabled></div>
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
      <div class="field two">
        <div><label>계좌예금주명</label><input name="accountHolder" value="${h(b.accountHolder)}"></div>
        <div><label>입금자명</label><input name="depositorName" value="${h(b.depositorName)}"></div>
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
        <div><label>적용 수수료율(%)</label><input name="commissionRate" type="number" min="0" max="100" step="0.1" value="${h(item.commissionRate || "")}" required></div>
        <div><label>상태</label><select name="isActive"><option value="true" ${item.isActive !== false ? "selected" : ""}>Y</option><option value="false" ${item.isActive === false ? "selected" : ""}>N</option></select></div>
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
      <div class="panel-head"><h2>감사 로그</h2><span class="muted">${money.format(state.audits.length)}건</span></div>
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

function bindCurrentTab() {
  if (state.tab === "requests") bindRequests();
  if (state.tab === "prices") bindPrices();
  if (state.tab === "brands") bindBrands();
  if (state.tab === "admins") bindAdmins();
  if (state.tab === "archive") bindArchive();
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
  const bulkInput = requestForm.querySelector("[name='lineItemsBulk']");
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
        const unitSalePrice = Number(item.unitSalePrice || item.salePrice || 0);
        return {
          ...item,
          quantity,
          unitSupplyPrice,
          unitSalePrice,
          totalSupplyPrice: quantity * unitSupplyPrice,
          totalSaleAmount: quantity * unitSalePrice
        };
      })
      .filter((item) => item.itemCode || item.itemName);
  const setLineItems = (items) => {
    const normalized = normalizeLineItems(items);
    lineItemsInput.value = JSON.stringify(normalized);
    lineItemsTable.innerHTML = renderRequestLineItems(normalized);
    lineItemsTable.querySelectorAll("[data-remove-line-item]").forEach((button) => {
      button.addEventListener("click", () => {
        setLineItems(getLineItems().filter((item) => item.id !== button.dataset.removeLineItem));
        updateRequestCalculation(requestForm);
      });
    });
    lineItemsTable.querySelectorAll("[data-line-step]").forEach((button) => {
      button.addEventListener("click", () => {
        const step = Number(button.dataset.step || 0);
        const updated = getLineItems().map((item) =>
          item.id === button.dataset.lineStep
            ? { ...item, quantity: Math.max(1, Number(item.quantity || 1) + step) }
            : item
        );
        setLineItems(updated);
        updateRequestCalculation(requestForm);
      });
    });
    lineItemsTable.querySelectorAll("[data-line-qty]").forEach((input) => {
      input.addEventListener("input", () => {
        const updated = getLineItems().map((item) =>
          item.id === input.dataset.lineQty
            ? { ...item, quantity: Math.max(1, Number(input.value || 1)) }
            : item
        );
        setLineItems(updated);
        updateRequestCalculation(requestForm);
      });
    });
    lineItemsTable.querySelectorAll("[data-line-sale-price]").forEach((input) => {
      input.addEventListener("input", () => {
        const updated = getLineItems().map((item) =>
          item.id === input.dataset.lineSalePrice
            ? { ...item, unitSalePrice: Math.max(0, Number(input.value || 0)) }
            : item
        );
        setLineItems(updated);
        updateRequestCalculation(requestForm);
      });
    });
    lineItemsTable.querySelectorAll("[data-line-supply-price]").forEach((input) => {
      input.addEventListener("input", () => {
        const updated = getLineItems().map((item) =>
          item.id === input.dataset.lineSupplyPrice
            ? { ...item, unitSupplyPrice: Math.max(0, Number(input.value || 0)) }
            : item
        );
        setLineItems(updated);
        updateRequestCalculation(requestForm);
      });
    });
    lineItemsTable.querySelectorAll("[data-line-code]").forEach((input) => {
      input.addEventListener("input", () => {
        const updated = getLineItems().map((item) =>
          item.id === input.dataset.lineCode ? { ...item, itemCode: input.value } : item
        );
        setLineItems(updated);
      });
    });
    lineItemsTable.querySelectorAll("[data-line-name]").forEach((input) => {
      input.addEventListener("input", () => {
        const updated = getLineItems().map((item) =>
          item.id === input.dataset.lineName ? { ...item, itemName: input.value } : item
        );
        setLineItems(updated);
      });
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
      bulkResult.textContent = "품목 행은 최대 30개까지 입력할 수 있습니다.";
      return items;
    }
    const existing = items.find((item) => item.priceEntryId === priceItem.id || (item.itemCode && item.itemCode === priceItem.itemCode && item.itemName === priceItem.itemName));
    if (existing) {
      existing.quantity = Math.max(1, Number(existing.quantity || 1) + quantity);
      existing.unitSupplyPrice = Number(priceItem.supplyPrice || existing.unitSupplyPrice || 0);
      existing.unitSalePrice = Number(priceItem.salePrice || existing.unitSalePrice || 0);
      existing.totalSupplyPrice = Number(existing.quantity) * Number(existing.unitSupplyPrice);
      existing.totalSaleAmount = Number(existing.quantity) * Number(existing.unitSalePrice || 0);
      existing.spec = priceItem.spec || existing.spec || "";
      existing.unit = priceItem.unit || existing.unit || "";
      existing.effectiveFrom = priceItem.effectiveFrom || existing.effectiveFrom || "";
      return items;
    }
    items.push({
      id: cryptoRandomId(),
      priceEntryId: priceItem.id,
      itemCode: priceItem.itemCode,
      itemName: priceItem.itemName,
      spec: priceItem.spec || "",
      unit: priceItem.unit || "",
      quantity,
      unitSupplyPrice: Number(priceItem.supplyPrice || 0),
      unitSalePrice: Number(priceItem.salePrice || 0),
      totalSupplyPrice: Number(priceItem.supplyPrice || 0) * quantity,
      totalSaleAmount: Number(priceItem.salePrice || 0) * quantity,
      effectiveFrom: priceItem.effectiveFrom
    });
    return items;
  };
  const addManualLineItem = () => {
    const items = getLineItems();
    if (items.length >= 30) {
      bulkResult.textContent = "품목 행은 최대 30개까지 입력할 수 있습니다.";
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
      unitSalePrice: 0,
      totalSupplyPrice: 0,
      totalSaleAmount: 0,
      effectiveFrom: ""
    });
    setLineItems(items);
    updateRequestCalculation(requestForm);
  };
  const setUnmatchedItems = (items) => {
    unmatchedItems = items;
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
          bulkResult.textContent = "기존 단가 매핑 대상을 찾지 못했습니다.";
          return;
        }
        setLineItems(mergeLineItem(getLineItems(), priceItem, missing.quantity));
        setUnmatchedItems(unmatchedItems.filter((item) => item.id !== missing.id));
        bulkResult.textContent = "미일치 품목을 기존 단가에 연결했습니다.";
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
          bulkResult.textContent = "별칭으로 연결할 기존 단가를 찾지 못했습니다.";
          return;
        }
        const aliasText = String(aliasTextInput?.value || "").trim();
        if (!aliasText) {
          bulkResult.textContent = "자동 인식할 별칭 문구를 입력하세요.";
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
        bulkResult.textContent = "기간 별칭을 저장하고 품목에 연결했습니다.";
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
          bulkResult.textContent = "브랜드 또는 미일치 품목 정보가 없습니다.";
          return;
        }
        if (!supplyPrice) {
          bulkResult.textContent = "신규 공급가를 입력하세요.";
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
        bulkResult.textContent = "새 단가를 등록하고 품목에 추가했습니다.";
        updateRequestCalculation(requestForm);
      });
    });
  };
  setLineItems(getLineItems());
  setUnmatchedItems([]);
  refreshLineItemOptions();
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
  const addSelectedLineItem = () => {
    const brand = getSelectedBrand();
    const priceItem = findPriceCatalogByInput(lineItemSearch.value, brand?.id || "", getEffectiveDate());
    if (!priceItem) {
      alert("현재 브랜드에 해당하는 품목을 찾지 못했습니다.");
      return;
    }
    const quantity = Math.max(1, Number(lineItemQty.value || 1));
    const items = mergeLineItem(getLineItems(), priceItem, quantity);
    setLineItems(items);
    lineItemSearch.value = "";
    lineItemQty.value = "1";
    if (bulkResult) bulkResult.textContent = "";
    setUnmatchedItems([]);
    updateRequestCalculation(requestForm);
    lineItemSearch.focus();
  };
  requestForm.querySelector("[data-add-line-item]").addEventListener("click", () => {
    addSelectedLineItem();
  });
  requestForm.querySelector("[data-add-manual-line-item]")?.addEventListener("click", () => {
    addManualLineItem();
  });
  [lineItemSearch, lineItemQty].forEach((input) => {
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        addSelectedLineItem();
      }
    });
  });
  requestForm.querySelector("[data-bulk-add-line-items]").addEventListener("click", () => {
    const brand = getSelectedBrand();
    if (!brand) {
      bulkResult.textContent = "브랜드를 먼저 선택하세요.";
      return;
    }
    const raw = String(bulkInput.value || "").trim();
    if (!raw) {
      bulkResult.textContent = "붙여넣은 내용이 없습니다.";
      return;
    }
    const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const items = getLineItems();
    let added = 0;
    let merged = 0;
    const missing = [];
    for (const line of lines) {
      const columns = line.split(/\t+/).map((part) => part.trim()).filter(Boolean);
      if (!columns.length) continue;
      const parsed = parseBulkLine(columns);
      const priceItem =
        findPriceCatalogByInput(parsed.searchText, brand.id, getEffectiveDate()) ||
        findPriceCatalogByInput(parsed.itemCode, brand.id, getEffectiveDate()) ||
        findPriceCatalogByInput(parsed.itemName, brand.id, getEffectiveDate());
      if (!priceItem) {
        missing.push({
          id: cryptoRandomId(),
          raw: columns.join(" / "),
          itemCode: parsed.itemCode,
          itemName: parsed.itemName,
          quantity: parsed.quantity,
          suggestedSearch: parsed.searchText,
          aliasText: parsed.itemName || parsed.itemCode || parsed.searchText,
          defaultValidFrom: getEffectiveDate(),
          defaultValidTo: ""
        });
        continue;
      }
      const existed = items.some((item) => item.priceEntryId === priceItem.id || (item.itemCode && item.itemCode === priceItem.itemCode && item.itemName === priceItem.itemName));
      mergeLineItem(items, priceItem, parsed.quantity);
      if (existed) merged += 1;
      else added += 1;
    }
    setLineItems(items);
    updateRequestCalculation(requestForm);
    bulkInput.value = "";
    setUnmatchedItems(missing);
    bulkResult.textContent =
      missing.length
        ? `추가 ${added}건, 합산 ${merged}건, 미일치 ${missing.length}건`
        : `추가 ${added}건, 합산 ${merged}건`;
  });
  requestForm
    .querySelectorAll("[name='productSalesAmount'], [name='extraShippingFee'], [name='commissionRate'], [name='supplyAmount'], [name='expectedDepositDate'], [name='overpaidAmount'], [name='creditUsedAmount']")
    .forEach((input) => input.addEventListener("input", () => updateRequestCalculation(requestForm)));
  requestForm.querySelector("[name='baseShippingFee']")?.addEventListener("input", (event) => {
    event.target.dataset.manual = "1";
    updateRequestCalculation(requestForm);
  });
  requestForm.querySelector("[name='paidAmount']")?.addEventListener("input", (event) => {
    event.target.dataset.manual = "1";
  });
  updateRequestCalculation(requestForm);
  requestForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = formObject(event.currentTarget);
    const brand = state.brands.find((item) => item.id === body.brandId) || findBrandByInput(body.brandSearch);
    if (brand) body.brandName = brand.name;
    body.brandId = brand?.id || "";
    if (body.brandId) pushRecentBrand(body.brandId);
    body.lineItems = body.lineItemsJson || "[]";
    delete body.brandSearch;
    delete body.lineItemsJson;
    const wasEditing = !!state.editingRequest;
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
    state.brands.find((brand) => brand.type === "brand" && brand.name.toLowerCase() === query) ||
    state.brands.find((brand) => brand.type === "brand" && brand.name.toLowerCase().includes(query))
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
  const value = (name) => Number(form.querySelector(`[name='${name}']`)?.value || 0);
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
  const baseShippingInputEl = form.querySelector("[name='baseShippingFee']");
  const baseManual = baseShippingInputEl?.dataset.manual === "1";
  const baseShippingFee = baseManual ? value("baseShippingFee") : calculateBrandShippingFee(brand, productSalesAmount);
  const extraShippingFee = value("extraShippingFee");
  const shippingFee = baseShippingFee + extraShippingFee;
  const promotionContext = buildPromotionPreview(brand, lineItems, form.querySelector("[name='expectedDepositDate']")?.value);
  const promotion = promotionContext?.primaryRule || null;
  const commissionRate = Number(promotionContext?.commissionRate ?? brand?.commissionRate ?? value("commissionRate"));
  const supplyAmount = lineItems.length
    ? lineItems.reduce((sum, item) => sum + Number(item.totalSupplyPrice || 0), 0)
    : value("supplyAmount");
  const commissionAmount = Number.isFinite(promotionContext?.commissionAmount)
    ? Number(promotionContext.commissionAmount)
    : Math.round(productSalesAmount * (commissionRate / 100));
  const hasReceivable = Boolean(brand?.hasReceivable || settlementType === "prepay_debt");
  const isDirect = settlementType === "direct_purchase";
  let depositAmount = 0;
  if (settlementType === "prepay_debt") {
    depositAmount = productSalesAmount + shippingFee;
  } else if (settlementType === "prepay_supply") {
    depositAmount = hasReceivable ? productSalesAmount + extraShippingFee : supplyAmount + shippingFee;
  } else if (isDirect) {
    depositAmount = productSalesAmount + shippingFee;
  } else {
    depositAmount = productSalesAmount - commissionAmount + shippingFee;
  }
  const receivableDeduction =
    settlementType === "prepay_debt"
      ? commissionAmount
      : (settlementType === "prepay_supply" && hasReceivable ? Math.max(0, productSalesAmount - supplyAmount - baseShippingFee) : 0);
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
  if (commissionInput) commissionInput.value = String(commissionAmount || "");
  if (commissionRateInput) commissionRateInput.value = String(commissionRate || "");
  if (promotionRuleInput) promotionRuleInput.value = promotionContext?.name || "";
  if (productSalesInput && derivedProductSalesAmount > 0) productSalesInput.value = String(productSalesAmount || "");
  if (supplyInput && lineItems.length) supplyInput.value = String(supplyAmount || "");
  if (baseShippingInput && !baseManual) baseShippingInput.value = String(baseShippingFee || "");
  if (totalShippingInput) totalShippingInput.value = String(shippingFee || "");
  if (depositInput) depositInput.value = String(depositAmount || "");
  if (deductionInput) deductionInput.value = String(receivableDeduction || "");
  const creditUsedAmount = value("creditUsedAmount");
  const paidAmountInput = form.querySelector("[name='paidAmount']");
  const paidManual = paidAmountInput?.dataset.manual === "1";
  const finalPaidAmount = Math.max(0, depositAmount - creditUsedAmount);
  if (paidAmountInput && !paidManual) paidAmountInput.value = finalPaidAmount ? String(finalPaidAmount) : "";
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
  if (isDirect) {
    if (commissionInput) commissionInput.value = "";
    if (commissionRateInput) commissionRateInput.value = "";
    if (promotionRuleInput) promotionRuleInput.value = "";
    if (supplyInput) supplyInput.value = "";
  }
  if (fixedSettlementType) fixedSettlementType.textContent = settlementLabel(settlementType);
  if (fixedCommissionRate) fixedCommissionRate.textContent = commissionRate ? `${commissionRate}%` : "-";
  if (fixedBaseShipping) fixedBaseShipping.textContent = `${money.format(Number(baseShippingFee || 0))}원`;
  if (fixedCutoff) fixedCutoff.textContent = cutoffLabel(brand) || "-";
  if (fixedSourceSheet) fixedSourceSheet.textContent = form.querySelector("[name='sourceSheet']")?.value || "-";
  if (fixedDepositor) fixedDepositor.textContent = form.querySelector("[name='depositorName']")?.value || "-";
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

function calculateBrandShippingFee(brand, productSalesAmount = 0) {
  if (!brand) return 0;
  if (brand.shippingPolicyType === "flat") return Number(brand.shippingFlatFee || 0);
  if (brand.shippingPolicyType === "threshold") {
    return Number(productSalesAmount || 0) < Number(brand.shippingThresholdAmount || 0)
      ? Number(brand.shippingThresholdFee || 0)
      : 0;
  }
  return 0;
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
  const allRule = activeRules.find((item) => (item.scopeType || "all") === "all") || null;
  const itemRules = activeRules.filter((item) => (item.scopeType || "all") === "items");
  const salesLines = lineItems.filter((item) => Number(item.totalSaleAmount || 0) > 0);
  if (!salesLines.length) {
    return allRule ? {
      primaryRule: allRule,
      name: allRule.name,
      commissionRate: Number(allRule.commissionRate || 0),
      commissionAmount: null
    } : null;
  }
  let salesTotal = 0;
  let commissionTotal = 0;
  const applied = [];
  const seen = new Set();
  for (const line of salesLines) {
    const key = normalizeItemKey(line.itemCode, line.itemName);
    const matchedItemRule = itemRules.find((rule) => (rule.targetItems || []).some((target) => normalizeItemKey(target.itemCode, target.itemName) === key)) || null;
    const rule = matchedItemRule || allRule;
    const rate = Number(rule?.commissionRate ?? brand.commissionRate ?? 0);
    const sales = Number(line.totalSaleAmount || 0);
    salesTotal += sales;
    commissionTotal += Math.round(sales * (rate / 100));
    if (rule && !seen.has(rule.id)) {
      seen.add(rule.id);
      applied.push(rule);
    }
  }
  return {
    primaryRule: applied.length === 1 ? applied[0] : null,
    name: applied.length === 1 ? applied[0].name : applied.length > 1 ? `품목별 프로모션 ${applied.length}건` : "",
    commissionRate: salesTotal > 0 ? Number(((commissionTotal / salesTotal) * 100).toFixed(2)) : Number(brand.commissionRate || 0),
    commissionAmount: commissionTotal,
    appliedRules: applied
  };
}

function describeShippingRule(brand = {}) {
  if (brand.shippingPolicyType === "flat") return brand.shippingFlatFee ? `무조건 ${money.format(Number(brand.shippingFlatFee))}원` : "무조건 0원";
  if (brand.shippingPolicyType === "threshold") {
    return `${money.format(Number(brand.shippingThresholdAmount || 0))}원 미만 ${money.format(Number(brand.shippingThresholdFee || 0))}원`;
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
    if (state.editingPromotionRule) {
      await api(`/api/promotion-rules/${state.editingPromotionRule.id}`, { method: "PUT", body });
    } else {
      await api("/api/promotion-rules", { method: "POST", body });
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
  app.querySelector("[data-admin-form]").addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = formObject(event.currentTarget);
    body.isActive = body.isActive === "true";
    if (state.editingAdmin) {
      await api(`/api/admins/${state.editingAdmin.id}`, { method: "PUT", body });
    } else {
      await api("/api/admins", { method: "POST", body });
    }
    state.editingAdmin = null;
    await refreshAndRender();
  });
  app.querySelector("[data-cancel-edit]")?.addEventListener("click", () => {
    state.editingAdmin = null;
    renderApp();
  });
}

function bindArchive() {
  app.querySelector("[data-sync-all]").addEventListener("click", async () => {
    await api("/api/archives/google-sync", { method: "POST", body: {} });
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

init().catch((error) => {
  app.innerHTML = `<main class="login"><section class="login-panel"><h1>앱 오류</h1><p>${h(error.message)}</p></section></main>`;
});
