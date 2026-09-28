# 거래관리 — 생산업체 발주서 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "거래관리" menu with 거래처관리(partners)/원부자재관리(materials)/명세서 발행(purchaseOrders) screens so production-vendor purchase orders can be created and issued as an Excel document instead of hand-built in Google Sheets.

**Architecture:** Three new flat top-level collections (`db.partners`, `db.materials`, `db.purchaseOrders`) added the same way `priceEntries`/`promotionRules` were — no schema migration tooling beyond the existing `touch()` pattern. New CRUD routes in `server.js` mirror the existing `/api/price-entries` routes exactly (same `id()`/`addAudit()`/`writeDb()` shape). New client screens in `public/app.js` reuse the existing NPB sub-tab pattern (`NPB_SCREENS` + `state.npb.screen`) for the three sub-screens under one "거래관리" tab. Excel generation reuses the existing `execFile python3 <script> --input <json> --output <xlsx>` convention with a brand-new standalone script (not a branch inside `settlement_excel.py`, which is tightly coupled to settlement-statement semantics).

**Tech Stack:** Node.js (ESM, no framework, hand-rolled HTTP routing in `server.js`), vanilla JS client (`public/app.js`, string-template rendering, no build step), Python 3 + openpyxl for `.xlsx` generation via `execFile`.

**Spec:** `docs/superpowers/specs/2026-09-28-production-purchase-order-design.md`

## Global Constraints

- No automated test framework exists in this repo. "Test" steps in this plan are: `node --check <file>` for syntax, then a scratch-DB server boot + `curl` smoke test for API tasks, and a `claude-in-chrome` browser check for UI tasks (screenshot + console error check). Never run these against `data/db.json` — always copy it to a scratch directory first and pass `DATA_DIR=<scratch>` (see Task 1's verify step for the exact recipe; reuse it for every later task).
- Permission key for all three screens is a single menu key `trade` (mirrors how `npb` is one permission key covering six sub-screens). Every new route calls `requirePermission(actor, res, "trade", action)` — this is stricter than the legacy `priceEntries`/`brands` routes (which only gate on "logged in"), but matches the pattern already used for the other *newer* permission-gated resources (`admins`, `pipeline`, `reconcile`, `npb`). Do this deliberately in every new route; don't copy the looser legacy pattern.
- Field/type conventions to match exactly (do not invent alternatives): money and counts go through `number(value)` (existing helper), dates through `dateOnly(value)`, all free-text fields through `String(x || "").trim()` server-side and `h(x)` client-side before interpolating into HTML.
- IDs: `id("partner")`, `id("material")`, `id("po")` — existing `id(prefix)` helper, `server.js:530-532`.
- Every mutation route calls `addAudit(db, actor, action, entityType, entityId, summary, before, after)` (`server.js:1675`) then `await writeDb(db)`, matching the price-entries template at `server.js:5503-5605`.
- **Attachments are deferred**, not part of this plan. The design spec listed "사업자등록증·통장사본 첨부" as a `partners` field, but no verified reusable file-storage pattern exists in this codebase (uploads found are all ephemeral base64→temp-file→parse, not persistent storage) and the user's own original field list didn't include it. `partners.attachments` is omitted from every task below; add a follow-up task later if actually needed.
- `orderMethod`(발주방식) and `invoiceTiming`(증빙구분) are free-text inputs, not fixed dropdowns — the Notion reference had 14+ vendor-specific values for `invoiceTiming` alone, so a rigid `<select>` would need constant editing. This matches how `cutoffNote`/`requiredMemo` are already free-text on the `brands` form.

---

### Task 1: DB schema — partners / materials / purchaseOrders collections + permission menu

**Files:**
- Modify: `server.js:1097-1128` (`buildInitialDb` return object)
- Modify: `server.js:1277-1282` (`migrateDb`, the block of `touch(db, "priceEntries", [])`-style lines)
- Modify: `server.js:4183-4197` (`MENU_REGISTRY`)

**Interfaces:**
- Produces: `db.partners: []`, `db.materials: []`, `db.purchaseOrders: []` — every later task reads/writes these three top-level arrays exactly like `db.priceEntries`.
- Produces: permission key `"trade"` usable in `can(actor, "trade", action)` / `requirePermission(actor, res, "trade", action)`.

- [ ] **Step 1: Add the three empty arrays to `buildInitialDb()`**

In `server.js`, find the `return { ... }` block of `buildInitialDb()` (around line 1097):

```js
  return {
    version: 1,
    createdAt,
    admins: [admin],
    brands,
    priceEntries: [],
    priceAliases: [],
    promotionRules: [],
    partners: [],
    materials: [],
    purchaseOrders: [],
    requests,
```

(Insert the three new lines directly after `promotionRules: [],` and before `requests,` — keep every other line unchanged.)

- [ ] **Step 2: Add migration touches**

In `server.js`, find this block inside `migrateDb()` (around line 1277):

```js
  touch(db, "archiveHistory", []);
  touch(db, "paymentLogs", []);
  touch(db, "auditLogs", []);
  touch(db, "priceEntries", []);
  touch(db, "priceAliases", []);
  touch(db, "promotionRules", []);
```

Add three lines right after `touch(db, "promotionRules", []);`:

```js
  touch(db, "partners", []);
  touch(db, "materials", []);
  touch(db, "purchaseOrders", []);
```

- [ ] **Step 3: Register the `trade` permission menu**

In `server.js`, find `MENU_REGISTRY` (around line 4183):

```js
const MENU_REGISTRY = [
  { key: "dashboard", label: "대시보드", actions: ["view"] },
  { key: "requests", label: "입금요청", actions: ["view", "create", "edit", "delete", "pay"] },
  { key: "prices", label: "단가표", actions: ["view", "create", "edit", "delete"] },
  { key: "brands", label: "브랜드", actions: ["view", "create", "edit", "delete"] },
```

Add a new entry after the `"brands"` line:

```js
  { key: "trade", label: "거래관리", actions: ["view", "create", "edit", "delete"] },
```

- [ ] **Step 4: Syntax check**

Run: `node --check server.js`
Expected: no output, exit code 0.

- [ ] **Step 5: Scratch-DB boot + migration smoke test**

Run (this exact recipe is reused by every later task — copy it verbatim, only the `curl` line changes):

```bash
mkdir -p /tmp/wooofpay-scratch
cp data/db.json /tmp/wooofpay-scratch/db.json
DATA_DIR=/tmp/wooofpay-scratch PORT=4599 node server.js &
sleep 1
curl -s http://localhost:4599/ -o /dev/null -w "%{http_code}\n"
node -e "const db = require('/tmp/wooofpay-scratch/db.json'); console.log(Array.isArray(db.partners), Array.isArray(db.materials), Array.isArray(db.purchaseOrders))"
kill %1
```

Expected: `200`, then `true true true` (migration added the three keys to the on-disk scratch copy). Delete `/tmp/wooofpay-scratch` when done, or leave it — later tasks will overwrite `db.json` in it again from a fresh copy each time so stale scratch state never carries over.

- [ ] **Step 6: Commit**

```bash
git add server.js
git commit -m "feat(trade): add partners/materials/purchaseOrders collections and trade permission menu"
```

---

### Task 2: `partners` CRUD API routes

**Files:**
- Modify: `server.js` — add a new route block. Insert it directly before the `/api/price-entries` GET route (`server.js:5423`), so it's easy to find (거래관리 routes grouped together, ahead of the pricing routes).

**Interfaces:**
- Consumes: `requirePermission(actor, res, menuKey, action, message?)` (`server.js:4244`), `addAudit(db, actor, action, entityType, entityId, summary, before, after)` (`server.js:1675`), `id(prefix)` (`server.js:530`), `number(value)`, `dateOnly(value)`, `sendJson(res, status, obj)`, `readBody(req)`.
- Produces: `partner` object shape `{ id, category, name, businessName, businessNumber, representativeName, address, invoiceEmail, bankName, bankAccount, depositorName, orderMethod, invoiceTiming, contactName, contactPhone, contactEmail, note, isActive, createdAt, updatedAt }` — Task 3 (UI) and Task 6 (purchaseOrders, which reference `partnerId`) depend on this exact field list.

- [ ] **Step 1: Add the route block**

Insert this whole block into `server.js` immediately before the `if (pathname === "/api/price-entries" && method === "GET")` line:

```js
  if (pathname === "/api/partners" && method === "GET") {
    if (!requirePermission(actor, res, "trade", "view")) return;
    const category = url.searchParams.get("category") || "";
    const list = (db.partners || [])
      .filter((item) => !category || item.category === category)
      .slice()
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    sendJson(res, 200, { partners: list });
    return;
  }

  if (pathname === "/api/partners" && method === "POST") {
    if (!requirePermission(actor, res, "trade", "create")) return;
    const body = await readBody(req);
    const category = ["production", "sales", "purchase"].includes(body.category) ? body.category : "production";
    const name = String(body.name || "").trim();
    if (!name) {
      sendJson(res, 400, { error: "거래처명은 필요합니다." });
      return;
    }
    const partner = {
      id: id("partner"),
      category,
      name,
      businessName: String(body.businessName || "").trim(),
      businessNumber: String(body.businessNumber || "").trim(),
      representativeName: String(body.representativeName || "").trim(),
      address: String(body.address || "").trim(),
      invoiceEmail: String(body.invoiceEmail || "").trim(),
      bankName: String(body.bankName || "").trim(),
      bankAccount: String(body.bankAccount || "").trim(),
      depositorName: String(body.depositorName || "").trim(),
      orderMethod: String(body.orderMethod || "").trim(),
      invoiceTiming: String(body.invoiceTiming || "").trim(),
      contactName: String(body.contactName || "").trim(),
      contactPhone: String(body.contactPhone || "").trim(),
      contactEmail: String(body.contactEmail || "").trim(),
      note: String(body.note || "").trim(),
      isActive: body.isActive !== false && body.isActive !== "false",
      createdAt: now(),
      updatedAt: now()
    };
    db.partners.unshift(partner);
    addAudit(db, actor, "create", "partner", partner.id, `${partner.name} 거래처 등록`, null, partner);
    await writeDb(db);
    sendJson(res, 201, { partner });
    return;
  }

  const partnerMatch = pathname.match(/^\/api\/partners\/([^/]+)$/);
  if (partnerMatch && method === "PUT") {
    if (!requirePermission(actor, res, "trade", "edit")) return;
    const body = await readBody(req);
    const partner = (db.partners || []).find((item) => item.id === partnerMatch[1]);
    if (!partner) {
      sendJson(res, 404, { error: "거래처를 찾을 수 없습니다." });
      return;
    }
    const before = { ...partner };
    if ("category" in body && ["production", "sales", "purchase"].includes(body.category)) partner.category = body.category;
    for (const key of [
      "name", "businessName", "businessNumber", "representativeName", "address",
      "invoiceEmail", "bankName", "bankAccount", "depositorName", "orderMethod",
      "invoiceTiming", "contactName", "contactPhone", "contactEmail", "note"
    ]) {
      if (key in body) partner[key] = String(body[key] || "").trim();
    }
    if ("isActive" in body) partner.isActive = body.isActive !== false && body.isActive !== "false";
    partner.updatedAt = now();
    addAudit(db, actor, "update", "partner", partner.id, `${partner.name} 거래처 수정`, before, partner);
    await writeDb(db);
    sendJson(res, 200, { partner });
    return;
  }

  if (partnerMatch && method === "DELETE") {
    if (!requirePermission(actor, res, "trade", "delete")) return;
    const inUse = (db.materials || []).some((item) => item.partnerId === partnerMatch[1])
      || (db.purchaseOrders || []).some((item) => item.partnerId === partnerMatch[1]);
    if (inUse) {
      sendJson(res, 400, { error: "이 거래처를 참조하는 원부자재 또는 발주서가 있어 삭제할 수 없습니다." });
      return;
    }
    const index = (db.partners || []).findIndex((item) => item.id === partnerMatch[1]);
    if (index === -1) {
      sendJson(res, 404, { error: "거래처를 찾을 수 없습니다." });
      return;
    }
    const [before] = db.partners.splice(index, 1);
    addAudit(db, actor, "delete", "partner", before.id, `${before.name} 거래처 삭제`, before, null);
    await writeDb(db);
    sendJson(res, 200, { ok: true });
    return;
  }

```

- [ ] **Step 2: Syntax check**

Run: `node --check server.js`
Expected: no output, exit code 0.

- [ ] **Step 3: Scratch-DB API smoke test**

```bash
cp data/db.json /tmp/wooofpay-scratch/db.json
DATA_DIR=/tmp/wooofpay-scratch PORT=4599 node server.js &
sleep 1
COOKIE=$(curl -s -c - http://localhost:4599/api/login -X POST -H "Content-Type: application/json" \
  -d '{"email":"owner@wooofpay.local","password":"<use the real bootstrap admin email/password for this environment>"}' \
  -o /dev/null | grep wooofpay_session | awk '{print $7}')
curl -s http://localhost:4599/api/partners -H "Cookie: wooofpay_session=$COOKIE" -X POST \
  -H "Content-Type: application/json" \
  -d '{"category":"production","name":"세림통상","businessName":"세림통상","bankName":"국민은행","bankAccount":"802-21-0429-353","depositorName":"최명호"}'
curl -s http://localhost:4599/api/partners -H "Cookie: wooofpay_session=$COOKIE"
kill %1
```

Expected: POST returns `201` with a `partner` object including a generated `id`; the following GET returns `{"partners":[{...that same partner...}]}`. If login fails, first check `data/db.json`'s `admins` array for a real active admin email in this environment and use that instead of the placeholder password.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat(trade): add partners CRUD API routes"
```

---

### Task 3: 거래관리 탭 + 거래처관리 screen (client)

**Files:**
- Modify: `public/app.js:91-98` area — add `TRADE_SCREENS` array near `NPB_SCREENS`.
- Modify: `public/app.js:597-610` (`tabs` array in the main shell render).
- Modify: `public/app.js:726-735` (`renderCurrentTab` dispatch) and `public/app.js:2125-2135` (bind dispatch).
- Create: new render functions `renderTrade()`, `renderPartners()`, `renderPartnerForm()`, `bindTrade()`, `bindPartners()` — place them together in a new section near `renderNpb()` (around line 5657), following the same file-organization convention (NPB's own functions are grouped together rather than scattered).

**Interfaces:**
- Consumes: `GET /api/partners?category=`, `POST /api/partners`, `PUT /api/partners/:id`, `DELETE /api/partners/:id` (Task 2). `api(path, opts)` helper (existing fetch wrapper used throughout `app.js`), `h(value)` escape helper (`app.js:235`), `can(key, action)` (existing client-side permission check), `showToast(message, type)` (existing).
- Produces: `state.trade = { screen: "partners", partners: [], loaded: false, editingPartner: null }` — Task 5 (원부자재관리) and Task 7 (명세서 발행) extend this same `state.trade` object and reuse `TRADE_SCREENS` + the `renderTrade()` subnav shell.

- [ ] **Step 1: Add `TRADE_SCREENS` and initial state**

In `public/app.js`, right after the `NPB_SCREENS` array (around line 98), add:

```js
const TRADE_SCREENS = [
  ["partners", "거래처관리"],
  ["materials", "원부자재관리"],
  ["orders", "명세서 발행"]
];

const PARTNER_CATEGORY_LABELS = {
  production: "생산업체",
  sales: "판매납품처",
  purchase: "매입공급처"
};
```

Find where `state` is initialized (search for `const state = {` near the top of the file) and add a `trade` key to it:

```js
  trade: { screen: "partners", partners: [], materials: [], purchaseOrders: [], loaded: false, editingPartner: null, editingMaterial: null, editingPurchaseOrder: null },
```

- [ ] **Step 2: Add the "거래관리" tab**

In `public/app.js`, find the `tabs` array (around line 597):

```js
  const tabs = [
    ["dashboard", "대시보드"],
    ["requests", "입금요청"],
    ["prices", "단가표"],
    ["brands", "브랜드"],
```

Add a line right after `["brands", "브랜드"],`:

```js
    ["trade", "거래관리"],
```

- [ ] **Step 3: Wire dispatch**

In `public/app.js`, find `renderCurrentTab` (around line 726):

```js
  if (state.tab === "brands") return renderBrands();
```

Add right after it:

```js
  if (state.tab === "trade") return renderTrade();
```

Find the bind dispatch block (around line 2125):

```js
  if (state.tab === "brands") bindBrands();
```

Add right after it:

```js
  if (state.tab === "trade") bindTrade();
```

- [ ] **Step 4: `renderTrade()` shell + `renderPartners()` list + `renderPartnerForm()`**

Add this whole block near `renderNpb()` (e.g., directly above it):

```js
function renderTrade() {
  const t = state.trade;
  const subnav = TRADE_SCREENS
    .map(([key, label]) => `<button data-trade-screen="${key}" class="npb-subtab ${t.screen === key ? "active" : ""}">${label}</button>`)
    .join("");
  let body = "";
  if (t.screen === "materials") body = renderMaterials();
  else if (t.screen === "orders") body = renderPurchaseOrders();
  else body = renderPartners();
  return `
    ${pageHead("거래관리", "생산업체·판매납품처·매입공급처 거래처와 발주서를 관리합니다.")}
    <div class="npb-subnav">${subnav}</div>
    ${body}
  `;
}

function renderPartners() {
  const t = state.trade;
  if (!t.loaded) return `<section class="panel"><div class="panel-body empty">불러오는 중…</div></section>`;
  const rows = (t.partners || []).map((p) => `
    <tr>
      <td>${h(PARTNER_CATEGORY_LABELS[p.category] || p.category)}</td>
      <td>${h(p.name)}</td>
      <td>${h(p.businessName)}</td>
      <td>${h(p.businessNumber)}</td>
      <td>${h(p.contactName)}${p.contactPhone ? ` · ${h(p.contactPhone)}` : ""}</td>
      <td>${h(p.bankName)} ${h(p.bankAccount)}</td>
      <td><div class="row-actions">
        <button data-edit-partner="${p.id}">수정</button>
        <button class="danger icon-btn" data-delete-partner="${p.id}" aria-label="삭제" title="삭제">×</button>
      </div></td>
    </tr>`).join("");
  return `
    <section class="panel partners-panel">
      <div class="panel-head"><h2>거래처 목록</h2></div>
      <div class="panel-body">
        <div class="table-wrap partners-table-wrap"><table class="partners-table">
          <thead><tr><th>구분</th><th>거래처명</th><th>상호명</th><th>사업자번호</th><th>담당자</th><th>계좌</th><th>작업</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="7" class="empty">등록된 거래처가 없습니다.</td></tr>`}</tbody>
        </table></div>
      </div>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>${t.editingPartner ? "거래처 수정" : "거래처 등록"}</h2></div>
      <div class="panel-body">${renderPartnerForm()}</div>
    </section>
  `;
}

function renderPartnerForm() {
  const p = state.trade.editingPartner || {};
  return `
    <form class="form-grid" data-partner-form>
      <div class="field two">
        <div><label>구분</label>
          <select name="category">
            ${Object.entries(PARTNER_CATEGORY_LABELS).map(([value, label]) =>
              `<option value="${value}" ${(p.category || "production") === value ? "selected" : ""}>${label}</option>`).join("")}
          </select>
        </div>
        <div><label>거래처명</label><input name="name" value="${h(p.name)}" required></div>
      </div>
      <div class="field two">
        <div><label>상호명</label><input name="businessName" value="${h(p.businessName)}"></div>
        <div><label>사업자등록번호</label><input name="businessNumber" value="${h(p.businessNumber)}"></div>
      </div>
      <div class="field two">
        <div><label>대표자명</label><input name="representativeName" value="${h(p.representativeName)}"></div>
        <div><label>세금계산서발행메일</label><input name="invoiceEmail" value="${h(p.invoiceEmail)}"></div>
      </div>
      <div class="field"><label>주소</label><input name="address" value="${h(p.address)}"></div>
      <div class="field three">
        <div><label>은행</label><input name="bankName" value="${h(p.bankName)}"></div>
        <div><label>계좌번호</label><input name="bankAccount" value="${h(p.bankAccount)}"></div>
        <div><label>예금주명</label><input name="depositorName" value="${h(p.depositorName)}"></div>
      </div>
      <div class="field two">
        <div><label>발주방식 <span class="muted" style="font-weight:400">(예: 메일, 개별요청)</span></label><input name="orderMethod" value="${h(p.orderMethod)}"></div>
        <div><label>증빙구분 <span class="muted" style="font-weight:400">(계산서 발행 시점)</span></label><input name="invoiceTiming" value="${h(p.invoiceTiming)}"></div>
      </div>
      <div class="field three">
        <div><label>담당자명</label><input name="contactName" value="${h(p.contactName)}"></div>
        <div><label>담당자 연락처</label><input name="contactPhone" value="${h(p.contactPhone)}"></div>
        <div><label>담당자 이메일</label><input name="contactEmail" value="${h(p.contactEmail)}"></div>
      </div>
      <div class="field"><label>메모</label><textarea name="note">${h(p.note)}</textarea></div>
      <div class="field"><label>사용</label><select name="isActive"><option value="true" ${p.isActive !== false ? "selected" : ""}>Y</option><option value="false" ${p.isActive === false ? "selected" : ""}>N</option></select></div>
      <div class="toolbar">
        <button class="primary" type="submit">${p.id ? "수정 저장" : "거래처 등록"}</button>
        ${p.id ? `<button type="button" data-cancel-partner-edit>취소</button>` : ""}
      </div>
    </form>
  `;
}
```

- [ ] **Step 5: `bindTrade()` — load data, subnav clicks, form submit, edit/delete**

Add this near `bindNpb()`:

```js
function bindTrade() {
  const t = state.trade;
  if (!t.loaded) {
    api("/api/partners").then(({ partners }) => {
      t.partners = partners;
      t.loaded = true;
      renderApp();
    }).catch((error) => {
      showToast(error.message || "거래처 목록을 불러오지 못했습니다.", "error");
    });
    return;
  }
  app.querySelectorAll("[data-trade-screen]").forEach((btn) => {
    btn.addEventListener("click", () => {
      t.screen = btn.dataset.tradeScreen;
      renderApp();
    });
  });
  if (t.screen === "partners") bindPartners();
  else if (t.screen === "materials") bindMaterials();
  else if (t.screen === "orders") bindPurchaseOrders();
}

function bindPartners() {
  const t = state.trade;
  const form = app.querySelector("[data-partner-form]");
  if (form) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const body = Object.fromEntries(new FormData(form).entries());
      try {
        if (t.editingPartner?.id) {
          const { partner } = await api(`/api/partners/${t.editingPartner.id}`, { method: "PUT", body });
          t.partners = t.partners.map((p) => (p.id === partner.id ? partner : p));
        } else {
          const { partner } = await api("/api/partners", { method: "POST", body });
          t.partners = [partner, ...t.partners];
        }
        t.editingPartner = null;
        renderApp();
        showToast("거래처가 저장되었습니다.");
      } catch (error) {
        showToast(error.message || "거래처 저장에 실패했습니다.", "error");
      }
    });
  }
  app.querySelectorAll("[data-edit-partner]").forEach((btn) => {
    btn.addEventListener("click", () => {
      t.editingPartner = t.partners.find((p) => p.id === btn.dataset.editPartner) || null;
      renderApp();
    });
  });
  const cancelBtn = app.querySelector("[data-cancel-partner-edit]");
  if (cancelBtn) cancelBtn.addEventListener("click", () => { t.editingPartner = null; renderApp(); });
  app.querySelectorAll("[data-delete-partner]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("이 거래처를 삭제할까요?")) return;
      try {
        await api(`/api/partners/${btn.dataset.deletePartner}`, { method: "DELETE" });
        t.partners = t.partners.filter((p) => p.id !== btn.dataset.deletePartner);
        renderApp();
        showToast("거래처가 삭제되었습니다.");
      } catch (error) {
        showToast(error.message || "거래처 삭제에 실패했습니다.", "error");
      }
    });
  });
}
```

**Note for the implementer:** check the exact signature of the existing `api()` helper (`grep -n "^async function api(" public/app.js` or wherever it's defined) before writing Step 5 — this plan assumes `api(path, { method, body })` where `body` is a plain object that gets JSON-serialized, matching how other forms in this file submit (e.g. `bindBrands()`). If the real helper takes a JSON string instead of an object, adjust `body` accordingly; don't guess silently, check first.

- [ ] **Step 6: Syntax check**

Run: `node --check public/app.js`
Expected: no output, exit code 0.

- [ ] **Step 7: Browser smoke test**

Using `claude-in-chrome` (load tools via `ToolSearch("select:mcp__claude-in-chrome__tabs_context_mcp,mcp__claude-in-chrome__navigate,mcp__claude-in-chrome__computer,mcp__claude-in-chrome__find,mcp__claude-in-chrome__form_input")` first):
1. Start the server against a fresh scratch-DB copy (same recipe as Task 1 Step 5) with an active admin.
2. Navigate to `http://localhost:4599`, log in.
3. Click "거래관리" in the sidebar — confirm the page shows the 거래처관리/원부자재관리/명세서 발행 subnav with 거래처관리 active by default.
4. Fill the 거래처 등록 form (구분=생산업체, 거래처명="테스트생산") and submit — confirm it appears in the table above without a page reload.
5. Click 수정 on that row, change a field, save — confirm the table updates.
6. Click the × delete button — confirm the row disappears.
7. Check console for errors: `mcp__claude-in-chrome__read_console_messages` with `onlyErrors: true`.

Expected: no console errors, all three operations (create/edit/delete) reflected in the table immediately.

- [ ] **Step 8: Commit**

```bash
git add public/app.js
git commit -m "feat(trade): add 거래관리 tab and 거래처관리 screen"
```

---

### Task 4: `materials` CRUD API routes

**Files:**
- Modify: `server.js` — add directly after the `partners` DELETE route from Task 2.

**Interfaces:**
- Consumes: same helpers as Task 2.
- Produces: `material` object `{ id, partnerId, itemName, category, orderUnit, basePrice, leadTimeDays, note, isActive, createdAt, updatedAt }` — Task 5 (UI) and Task 7 (purchaseOrders line-item autocomplete) depend on this shape.

- [ ] **Step 1: Add the route block**

```js
  if (pathname === "/api/materials" && method === "GET") {
    if (!requirePermission(actor, res, "trade", "view")) return;
    const partnerId = url.searchParams.get("partnerId") || "";
    const list = (db.materials || [])
      .filter((item) => !partnerId || item.partnerId === partnerId)
      .slice()
      .sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    sendJson(res, 200, { materials: list });
    return;
  }

  if (pathname === "/api/materials" && method === "POST") {
    if (!requirePermission(actor, res, "trade", "create")) return;
    const body = await readBody(req);
    const itemName = String(body.itemName || "").trim();
    if (!itemName) {
      sendJson(res, 400, { error: "품목명은 필요합니다." });
      return;
    }
    const material = {
      id: id("material"),
      partnerId: String(body.partnerId || "").trim(),
      itemName,
      category: String(body.category || "").trim(),
      orderUnit: String(body.orderUnit || "").trim(),
      basePrice: number(body.basePrice),
      leadTimeDays: body.leadTimeDays === "" || body.leadTimeDays == null ? null : number(body.leadTimeDays),
      note: String(body.note || "").trim(),
      isActive: body.isActive !== false && body.isActive !== "false",
      createdAt: now(),
      updatedAt: now()
    };
    db.materials.unshift(material);
    addAudit(db, actor, "create", "material", material.id, `${material.itemName} 원부자재 등록`, null, material);
    await writeDb(db);
    sendJson(res, 201, { material });
    return;
  }

  const materialMatch = pathname.match(/^\/api\/materials\/([^/]+)$/);
  if (materialMatch && method === "PUT") {
    if (!requirePermission(actor, res, "trade", "edit")) return;
    const body = await readBody(req);
    const material = (db.materials || []).find((item) => item.id === materialMatch[1]);
    if (!material) {
      sendJson(res, 404, { error: "원부자재를 찾을 수 없습니다." });
      return;
    }
    const before = { ...material };
    for (const key of ["partnerId", "itemName", "category", "orderUnit", "note"]) {
      if (key in body) material[key] = String(body[key] || "").trim();
    }
    if ("basePrice" in body) material.basePrice = number(body.basePrice);
    if ("leadTimeDays" in body) material.leadTimeDays = body.leadTimeDays === "" ? null : number(body.leadTimeDays);
    if ("isActive" in body) material.isActive = body.isActive !== false && body.isActive !== "false";
    material.updatedAt = now();
    addAudit(db, actor, "update", "material", material.id, `${material.itemName} 원부자재 수정`, before, material);
    await writeDb(db);
    sendJson(res, 200, { material });
    return;
  }

  if (materialMatch && method === "DELETE") {
    if (!requirePermission(actor, res, "trade", "delete")) return;
    const index = (db.materials || []).findIndex((item) => item.id === materialMatch[1]);
    if (index === -1) {
      sendJson(res, 404, { error: "원부자재를 찾을 수 없습니다." });
      return;
    }
    const [before] = db.materials.splice(index, 1);
    addAudit(db, actor, "delete", "material", before.id, `${before.itemName} 원부자재 삭제`, before, null);
    await writeDb(db);
    sendJson(res, 200, { ok: true });
    return;
  }

```

- [ ] **Step 2: Syntax check**

Run: `node --check server.js`

- [ ] **Step 3: Scratch-DB API smoke test**

Same recipe as Task 2 Step 3, but POST to `/api/materials` with `{"itemName":"목줄 체크 블랙(S)","orderUnit":"개","basePrice":2800}`, then GET `/api/materials` and confirm the entry comes back.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat(trade): add materials CRUD API routes"
```

---

### Task 5: 원부자재관리 screen (client)

**Files:**
- Modify: `public/app.js` — add `renderMaterials()`, `renderMaterialForm()`, `bindMaterials()` next to the Task 3 functions. Wire `t.screen === "materials"` (already stubbed in Task 3's `renderTrade()`/`bindTrade()` dispatch, which currently calls these two function names — no further dispatch change needed here).

**Interfaces:**
- Consumes: `GET/POST/PUT/DELETE /api/materials` (Task 4), `t.partners` (already loaded by Task 3's `bindTrade()`) for the partner-picker dropdown.
- Produces: `t.materials` list state, consumed by Task 7's line-item autocomplete.

- [ ] **Step 1: `renderMaterials()` + `renderMaterialForm()`**

```js
function renderMaterials() {
  const t = state.trade;
  if (!Array.isArray(t.materials) || !t._materialsLoaded) {
    return `<section class="panel"><div class="panel-body empty">불러오는 중…</div></section>`;
  }
  const partnerName = (id) => (t.partners.find((p) => p.id === id)?.name) || "-";
  const rows = t.materials.map((m) => `
    <tr>
      <td>${h(m.itemName)}</td>
      <td>${h(m.category)}</td>
      <td>${h(partnerName(m.partnerId))}</td>
      <td>${h(m.orderUnit)}</td>
      <td>${money.format(Number(m.basePrice || 0))}원</td>
      <td>${m.leadTimeDays == null ? "-" : `${m.leadTimeDays}일`}</td>
      <td><div class="row-actions">
        <button data-edit-material="${m.id}">수정</button>
        <button class="danger icon-btn" data-delete-material="${m.id}" aria-label="삭제" title="삭제">×</button>
      </div></td>
    </tr>`).join("");
  return `
    <section class="panel">
      <div class="panel-head"><h2>원부자재 목록</h2></div>
      <div class="panel-body">
        <div class="table-wrap materials-table-wrap"><table class="materials-table">
          <thead><tr><th>품목명</th><th>카테고리</th><th>거래처</th><th>발주단위</th><th>기본단가</th><th>리드타임</th><th>작업</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="7" class="empty">등록된 원부자재가 없습니다.</td></tr>`}</tbody>
        </table></div>
      </div>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>${t.editingMaterial ? "원부자재 수정" : "원부자재 등록"}</h2></div>
      <div class="panel-body">${renderMaterialForm()}</div>
    </section>
  `;
}

function renderMaterialForm() {
  const m = state.trade.editingMaterial || {};
  const partnerOptions = state.trade.partners
    .filter((p) => p.category === "production")
    .map((p) => `<option value="${p.id}" ${m.partnerId === p.id ? "selected" : ""}>${h(p.name)}</option>`)
    .join("");
  return `
    <form class="form-grid" data-material-form>
      <div class="field two">
        <div><label>품목명</label><input name="itemName" value="${h(m.itemName)}" required></div>
        <div><label>카테고리 <span class="muted" style="font-weight:400">(원단/부자재/포장재/사은품 등)</span></label><input name="category" value="${h(m.category)}"></div>
      </div>
      <div class="field two">
        <div><label>거래처(생산업체)</label><select name="partnerId"><option value="">선택 안 함</option>${partnerOptions}</select></div>
        <div><label>발주단위 <span class="muted" style="font-weight:400">(개/Roll/box 등)</span></label><input name="orderUnit" value="${h(m.orderUnit)}"></div>
      </div>
      <div class="field two">
        <div><label>기본단가</label><input name="basePrice" type="number" min="0" value="${h(m.basePrice || "")}"></div>
        <div><label>리드타임(일)</label><input name="leadTimeDays" type="number" min="0" value="${h(m.leadTimeDays ?? "")}"></div>
      </div>
      <div class="field"><label>메모</label><textarea name="note">${h(m.note)}</textarea></div>
      <div class="toolbar">
        <button class="primary" type="submit">${m.id ? "수정 저장" : "원부자재 등록"}</button>
        ${m.id ? `<button type="button" data-cancel-material-edit>취소</button>` : ""}
      </div>
    </form>
  `;
}
```

- [ ] **Step 2: `bindMaterials()` — load on first visit to this screen, form submit, edit/delete**

```js
function bindMaterials() {
  const t = state.trade;
  if (!t._materialsLoaded) {
    api("/api/materials").then(({ materials }) => {
      t.materials = materials;
      t._materialsLoaded = true;
      renderApp();
    }).catch((error) => showToast(error.message || "원부자재 목록을 불러오지 못했습니다.", "error"));
    return;
  }
  const form = app.querySelector("[data-material-form]");
  if (form) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const body = Object.fromEntries(new FormData(form).entries());
      try {
        if (t.editingMaterial?.id) {
          const { material } = await api(`/api/materials/${t.editingMaterial.id}`, { method: "PUT", body });
          t.materials = t.materials.map((m) => (m.id === material.id ? material : m));
        } else {
          const { material } = await api("/api/materials", { method: "POST", body });
          t.materials = [material, ...t.materials];
        }
        t.editingMaterial = null;
        renderApp();
        showToast("원부자재가 저장되었습니다.");
      } catch (error) {
        showToast(error.message || "원부자재 저장에 실패했습니다.", "error");
      }
    });
  }
  app.querySelectorAll("[data-edit-material]").forEach((btn) => {
    btn.addEventListener("click", () => {
      t.editingMaterial = t.materials.find((m) => m.id === btn.dataset.editMaterial) || null;
      renderApp();
    });
  });
  const cancelBtn = app.querySelector("[data-cancel-material-edit]");
  if (cancelBtn) cancelBtn.addEventListener("click", () => { t.editingMaterial = null; renderApp(); });
  app.querySelectorAll("[data-delete-material]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("이 원부자재를 삭제할까요?")) return;
      try {
        await api(`/api/materials/${btn.dataset.deleteMaterial}`, { method: "DELETE" });
        t.materials = t.materials.filter((m) => m.id !== btn.dataset.deleteMaterial);
        renderApp();
        showToast("원부자재가 삭제되었습니다.");
      } catch (error) {
        showToast(error.message || "원부자재 삭제에 실패했습니다.", "error");
      }
    });
  });
}
```

**Note for the implementer:** `money.format(...)` is an existing formatter used throughout `app.js` (e.g. `renderRequestLineItemsSummary`) — reuse it, don't redefine it.

- [ ] **Step 3: Syntax check**

Run: `node --check public/app.js`

- [ ] **Step 4: Browser smoke test**

Same flow as Task 3 Step 7, but on the 원부자재관리 subnav tab: create a material linked to the partner created in Task 3's test, confirm it lists, edit it, delete it. Check console for errors.

- [ ] **Step 5: Commit**

```bash
git add public/app.js
git commit -m "feat(trade): add 원부자재관리 screen"
```

---

### Task 6: `purchaseOrders` CRUD API routes + document numbering

**Files:**
- Modify: `server.js` — add directly after the `materials` DELETE route from Task 4.

**Interfaces:**
- Consumes: same helpers as Task 2, plus a new `nextPurchaseOrderDocNo(db, orderDate)` helper.
- Produces: `purchaseOrder` object `{ id, docNo, partnerId, orderDate, status, lineItems: [{id, materialId, itemName, spec, quantity, unit, unitPrice, amount}], deliveryPlace, subtotal, vat, total, note, createdAt, updatedAt }` — Task 7 (UI) and Task 8 (Excel) depend on this exact shape.

- [ ] **Step 1: Add the doc-number helper and a line-item sanitizer**

Add these two functions near `sanitizeLineItems` (`server.js:4323`) — same file section, same style:

```js
// 사람이 읽는 발주서 번호. 기존 날짜 이후 발주서 개수로 순번을 매긴다 —
// 별도 카운터를 db에 두면 마이그레이션이 필요해지고, 이 앱은 단일 Node
// 프로세스라 동시 쓰기 경합이 없다(다른 순번 로직, 예: 정산서 seq++, 와 동일).
function nextPurchaseOrderDocNo(db, orderDate) {
  const datePart = String(dateOnly(orderDate) || now().slice(0, 10)).replace(/-/g, "");
  const todayCount = (db.purchaseOrders || []).filter(
    (po) => String(po.docNo || "").startsWith(`PO-${datePart}-`)
  ).length;
  return `PO-${datePart}-${String(todayCount + 1).padStart(3, "0")}`;
}

function sanitizePurchaseOrderLineItems(raw) {
  const source = Array.isArray(raw) ? raw : typeof raw === "string" && raw.trim()
    ? (() => { try { const parsed = JSON.parse(raw); return Array.isArray(parsed) ? parsed : []; } catch { return []; } })()
    : [];
  return source
    .map((item) => {
      const quantity = Math.max(0, number(item.quantity));
      const unitPrice = Math.max(0, number(item.unitPrice));
      return {
        id: item.id || id("poline"),
        materialId: String(item.materialId || "").trim(),
        itemName: String(item.itemName || "").trim(),
        spec: String(item.spec || "").trim(),
        quantity,
        unit: String(item.unit || "").trim(),
        unitPrice,
        amount: quantity * unitPrice
      };
    })
    .filter((item) => item.itemName);
}
```

- [ ] **Step 2: Add the route block**

```js
  const purchaseOrderStatuses = new Set(["ordered", "in_production", "received", "cancelled"]);

  if (pathname === "/api/purchase-orders" && method === "GET") {
    if (!requirePermission(actor, res, "trade", "view")) return;
    const partnerId = url.searchParams.get("partnerId") || "";
    const list = (db.purchaseOrders || [])
      .filter((item) => !partnerId || item.partnerId === partnerId)
      .slice()
      .sort((a, b) => (b.docNo || "").localeCompare(a.docNo || ""));
    sendJson(res, 200, { purchaseOrders: list });
    return;
  }

  if (pathname === "/api/purchase-orders" && method === "POST") {
    if (!requirePermission(actor, res, "trade", "create")) return;
    const body = await readBody(req);
    const partner = (db.partners || []).find((item) => item.id === body.partnerId);
    if (!partner) {
      sendJson(res, 400, { error: "거래처를 먼저 선택하세요." });
      return;
    }
    const orderDate = dateOnly(body.orderDate) || now().slice(0, 10);
    const lineItems = sanitizePurchaseOrderLineItems(body.lineItems);
    if (!lineItems.length) {
      sendJson(res, 400, { error: "품목을 하나 이상 입력하세요." });
      return;
    }
    const subtotal = lineItems.reduce((sum, item) => sum + item.amount, 0);
    const vat = Math.round(subtotal * 0.1);
    const purchaseOrder = {
      id: id("po"),
      docNo: nextPurchaseOrderDocNo(db, orderDate),
      partnerId: partner.id,
      orderDate,
      status: purchaseOrderStatuses.has(body.status) ? body.status : "ordered",
      lineItems,
      deliveryPlace: String(body.deliveryPlace || "").trim(),
      subtotal,
      vat,
      total: subtotal + vat,
      note: String(body.note || "").trim(),
      createdAt: now(),
      updatedAt: now()
    };
    db.purchaseOrders.unshift(purchaseOrder);
    addAudit(db, actor, "create", "purchase_order", purchaseOrder.id, `${purchaseOrder.docNo} 발주서 등록 (${partner.name})`, null, purchaseOrder);
    await writeDb(db);
    sendJson(res, 201, { purchaseOrder });
    return;
  }

  const purchaseOrderMatch = pathname.match(/^\/api\/purchase-orders\/([^/]+)$/);
  if (purchaseOrderMatch && method === "PUT") {
    if (!requirePermission(actor, res, "trade", "edit")) return;
    const body = await readBody(req);
    const purchaseOrder = (db.purchaseOrders || []).find((item) => item.id === purchaseOrderMatch[1]);
    if (!purchaseOrder) {
      sendJson(res, 404, { error: "발주서를 찾을 수 없습니다." });
      return;
    }
    const before = { ...purchaseOrder };
    if ("orderDate" in body) purchaseOrder.orderDate = dateOnly(body.orderDate) || purchaseOrder.orderDate;
    if ("status" in body && purchaseOrderStatuses.has(body.status)) purchaseOrder.status = body.status;
    if ("deliveryPlace" in body) purchaseOrder.deliveryPlace = String(body.deliveryPlace || "").trim();
    if ("note" in body) purchaseOrder.note = String(body.note || "").trim();
    if ("lineItems" in body) {
      purchaseOrder.lineItems = sanitizePurchaseOrderLineItems(body.lineItems);
      purchaseOrder.subtotal = purchaseOrder.lineItems.reduce((sum, item) => sum + item.amount, 0);
      purchaseOrder.vat = Math.round(purchaseOrder.subtotal * 0.1);
      purchaseOrder.total = purchaseOrder.subtotal + purchaseOrder.vat;
    }
    purchaseOrder.updatedAt = now();
    addAudit(db, actor, "update", "purchase_order", purchaseOrder.id, `${purchaseOrder.docNo} 발주서 수정`, before, purchaseOrder);
    await writeDb(db);
    sendJson(res, 200, { purchaseOrder });
    return;
  }

  if (purchaseOrderMatch && method === "DELETE") {
    if (!requirePermission(actor, res, "trade", "delete")) return;
    const index = (db.purchaseOrders || []).findIndex((item) => item.id === purchaseOrderMatch[1]);
    if (index === -1) {
      sendJson(res, 404, { error: "발주서를 찾을 수 없습니다." });
      return;
    }
    const [before] = db.purchaseOrders.splice(index, 1);
    addAudit(db, actor, "delete", "purchase_order", before.id, `${before.docNo} 발주서 삭제`, before, null);
    await writeDb(db);
    sendJson(res, 200, { ok: true });
    return;
  }

```

- [ ] **Step 3: Syntax check**

Run: `node --check server.js`

- [ ] **Step 4: Scratch-DB API smoke test — including doc-number sequencing**

```bash
cp data/db.json /tmp/wooofpay-scratch/db.json
DATA_DIR=/tmp/wooofpay-scratch PORT=4599 node server.js &
sleep 1
# ... log in as in Task 2 Step 3, then create a partner first if the scratch db has none ...
curl -s http://localhost:4599/api/purchase-orders -H "Cookie: wooofpay_session=$COOKIE" -X POST \
  -H "Content-Type: application/json" \
  -d '{"partnerId":"<partner id from a prior create>","lineItems":[{"itemName":"목줄 체크 블랙(S)","quantity":40,"unit":"개","unitPrice":2800}]}'
curl -s http://localhost:4599/api/purchase-orders -H "Cookie: wooofpay_session=$COOKIE" -X POST \
  -H "Content-Type: application/json" \
  -d '{"partnerId":"<same partner id>","lineItems":[{"itemName":"목줄 체크 블랙(M)","quantity":20,"unit":"개","unitPrice":3200}]}'
kill %1
```

Expected: first response `docNo` is `PO-<today>-001`, second response `docNo` is `PO-<today>-002`; both have `subtotal`/`vat`/`total` computed correctly (`subtotal = qty*unitPrice`, `vat = round(subtotal*0.1)`, `total = subtotal+vat`).

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "feat(trade): add purchaseOrders CRUD API routes with document numbering"
```

---

### Task 7: 명세서 발행 screen (client) — purchase order list + line-item form

**Files:**
- Modify: `public/app.js` — add `renderPurchaseOrders()`, `renderPurchaseOrderForm()`, `bindPurchaseOrders()` next to the Task 3/5 functions.

**Interfaces:**
- Consumes: `GET/POST/PUT/DELETE /api/purchase-orders` (Task 6), `t.partners` filtered to `category === "production"`, `t.materials` filtered by selected partner (for the item autocomplete).
- Produces: nothing further consumed by later tasks except the Excel download button added in Task 8 (which will add a link/button referencing `po.id` inside this screen's row markup — Task 8 modifies this file again to add that one `<a>`).

This is a simpler line-item table than the input-요청 one (`renderRequestLineItems`) — no promotion column, no separate supply/sale-price split, no catalog-basis logic. It follows the same shape (one `<tr>` per line, add/remove rows, recompute totals client-side) but scoped down.

- [ ] **Step 1: `renderPurchaseOrders()` (list) + `renderPurchaseOrderForm()` (create/edit with line items)**

```js
function renderPurchaseOrders() {
  const t = state.trade;
  if (!Array.isArray(t.purchaseOrders) || !t._ordersLoaded) {
    return `<section class="panel"><div class="panel-body empty">불러오는 중…</div></section>`;
  }
  const partnerName = (id) => (t.partners.find((p) => p.id === id)?.name) || "-";
  const statusLabel = { ordered: "발주", in_production: "생산중", received: "입고완료", cancelled: "취소" };
  const rows = t.purchaseOrders.map((po) => `
    <tr>
      <td>${h(po.docNo)}</td>
      <td>${h(po.orderDate)}</td>
      <td>${h(partnerName(po.partnerId))}</td>
      <td>${statusLabel[po.status] || po.status}</td>
      <td>${money.format(Number(po.total || 0))}원</td>
      <td><div class="row-actions">
        <button data-edit-po="${po.id}">수정</button>
        <a href="/api/purchase-orders/${po.id}.xlsx"><button type="button">엑셀</button></a>
        <button class="danger icon-btn" data-delete-po="${po.id}" aria-label="삭제" title="삭제">×</button>
      </div></td>
    </tr>`).join("");
  return `
    <section class="panel">
      <div class="panel-head"><h2>발주서 목록</h2></div>
      <div class="panel-body">
        <div class="table-wrap"><table class="purchase-orders-table">
          <thead><tr><th>문서번호</th><th>발주일</th><th>거래처</th><th>상태</th><th>총액</th><th>작업</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="6" class="empty">등록된 발주서가 없습니다.</td></tr>`}</tbody>
        </table></div>
      </div>
    </section>
    <section class="panel">
      <div class="panel-head"><h2>${t.editingPurchaseOrder ? "발주서 수정" : "발주서 작성"}</h2></div>
      <div class="panel-body">${renderPurchaseOrderForm()}</div>
    </section>
  `;
}

function renderPurchaseOrderForm() {
  const t = state.trade;
  const po = t.editingPurchaseOrder || {};
  const items = Array.isArray(t.draftLineItems) ? t.draftLineItems : (po.lineItems || []);
  t.draftLineItems = items;
  const partnerOptions = t.partners
    .filter((p) => p.category === "production")
    .map((p) => `<option value="${p.id}" ${po.partnerId === p.id ? "selected" : ""}>${h(p.name)}</option>`)
    .join("");
  const rows = items.map((item) => `
    <tr data-po-line="${item.id}">
      <td><button type="button" class="danger icon-btn" data-remove-po-line="${item.id}" aria-label="삭제" title="삭제">×</button></td>
      <td><input value="${h(item.itemName)}" data-po-line-name="${item.id}" placeholder="품목명"></td>
      <td><input value="${h(item.spec)}" data-po-line-spec="${item.id}" placeholder="규격"></td>
      <td><input type="number" min="0" value="${h(item.quantity)}" data-po-line-qty="${item.id}" class="qty-input"></td>
      <td><input value="${h(item.unit)}" data-po-line-unit="${item.id}" placeholder="단위"></td>
      <td><input type="number" min="0" value="${h(item.unitPrice)}" data-po-line-price="${item.id}"></td>
      <td data-po-line-amount="${item.id}">${money.format(Number(item.quantity || 0) * Number(item.unitPrice || 0))}원</td>
    </tr>`).join("");
  const subtotal = items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unitPrice || 0), 0);
  const vat = Math.round(subtotal * 0.1);
  return `
    <form class="form-grid" data-po-form>
      <input type="hidden" name="lineItemsJson" value="${h(JSON.stringify(items))}">
      <div class="field two">
        <div><label>거래처</label><select name="partnerId" required><option value="">선택</option>${partnerOptions}</select></div>
        <div><label>발주일</label><input name="orderDate" type="date" value="${h(po.orderDate || new Date().toISOString().slice(0, 10))}"></div>
      </div>
      <div class="field"><label>납품장소</label><input name="deliveryPlace" value="${h(po.deliveryPlace)}"></div>
      <div class="field">
        <label>품목</label>
        <div class="table-wrap"><table class="po-line-items-table">
          <thead><tr><th>작업</th><th>품목명</th><th>규격</th><th>수량</th><th>단위</th><th>단가</th><th>금액</th></tr></thead>
          <tbody data-po-lines-body>${rows}</tbody>
        </table></div>
        <button type="button" data-add-po-line style="margin-top:8px">품목 행 추가</button>
      </div>
      <div class="field"><label>합계 미리보기</label>
        <div data-po-totals class="muted">소계 ${money.format(subtotal)}원 · 부가세 ${money.format(vat)}원 · 총액 ${money.format(subtotal + vat)}원</div>
      </div>
      <div class="field"><label>메모</label><textarea name="note">${h(po.note)}</textarea></div>
      <div class="toolbar">
        <button class="primary" type="submit">${po.id ? "수정 저장" : "발주서 등록"}</button>
        ${po.id ? `<button type="button" data-cancel-po-edit>취소</button>` : ""}
      </div>
    </form>
  `;
}
```

- [ ] **Step 2: `bindPurchaseOrders()` — load, line-item row add/remove/edit with live totals, form submit, edit/delete**

```js
function bindPurchaseOrders() {
  const t = state.trade;
  if (!t._ordersLoaded) {
    Promise.all([api("/api/purchase-orders"), t._materialsLoaded ? Promise.resolve({ materials: t.materials }) : api("/api/materials")])
      .then(([ordersRes, materialsRes]) => {
        t.purchaseOrders = ordersRes.purchaseOrders;
        t.materials = materialsRes.materials;
        t._materialsLoaded = true;
        t._ordersLoaded = true;
        renderApp();
      })
      .catch((error) => showToast(error.message || "발주서 목록을 불러오지 못했습니다.", "error"));
    return;
  }

  const recomputeLine = (id) => {
    const item = t.draftLineItems.find((x) => x.id === id);
    if (!item) return;
    const amountCell = app.querySelector(`[data-po-line-amount='${id}']`);
    if (amountCell) amountCell.textContent = `${money.format(Number(item.quantity || 0) * Number(item.unitPrice || 0))}원`;
    const subtotal = t.draftLineItems.reduce((sum, x) => sum + Number(x.quantity || 0) * Number(x.unitPrice || 0), 0);
    const vat = Math.round(subtotal * 0.1);
    const totalsEl = app.querySelector("[data-po-totals]");
    if (totalsEl) totalsEl.textContent = `소계 ${money.format(subtotal)}원 · 부가세 ${money.format(vat)}원 · 총액 ${money.format(subtotal + vat)}원`;
    const hiddenInput = app.querySelector("[name='lineItemsJson']");
    if (hiddenInput) hiddenInput.value = JSON.stringify(t.draftLineItems);
  };

  const addBtn = app.querySelector("[data-add-po-line]");
  if (addBtn) {
    addBtn.addEventListener("click", () => {
      t.draftLineItems.push({ id: cryptoRandomId(), materialId: "", itemName: "", spec: "", quantity: 1, unit: "", unitPrice: 0 });
      renderApp();
    });
  }
  app.querySelectorAll("[data-remove-po-line]").forEach((btn) => {
    btn.addEventListener("click", () => {
      t.draftLineItems = t.draftLineItems.filter((x) => x.id !== btn.dataset.removePoLine);
      renderApp();
    });
  });
  app.querySelectorAll("[data-po-line-name]").forEach((input) => {
    input.addEventListener("input", () => {
      const item = t.draftLineItems.find((x) => x.id === input.dataset.poLineName);
      if (item) item.itemName = input.value;
    });
  });
  app.querySelectorAll("[data-po-line-spec]").forEach((input) => {
    input.addEventListener("input", () => {
      const item = t.draftLineItems.find((x) => x.id === input.dataset.poLineSpec);
      if (item) item.spec = input.value;
    });
  });
  app.querySelectorAll("[data-po-line-unit]").forEach((input) => {
    input.addEventListener("input", () => {
      const item = t.draftLineItems.find((x) => x.id === input.dataset.poLineUnit);
      if (item) item.unit = input.value;
    });
  });
  app.querySelectorAll("[data-po-line-qty]").forEach((input) => {
    input.addEventListener("input", () => {
      const item = t.draftLineItems.find((x) => x.id === input.dataset.poLineQty);
      if (item) { item.quantity = Number(input.value || 0); recomputeLine(item.id); }
    });
  });
  app.querySelectorAll("[data-po-line-price]").forEach((input) => {
    input.addEventListener("input", () => {
      const item = t.draftLineItems.find((x) => x.id === input.dataset.poLinePrice);
      if (item) { item.unitPrice = Number(input.value || 0); recomputeLine(item.id); }
    });
  });

  const form = app.querySelector("[data-po-form]");
  if (form) {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = Object.fromEntries(new FormData(form).entries());
      const body = { ...formData, lineItems: t.draftLineItems };
      try {
        if (t.editingPurchaseOrder?.id) {
          const { purchaseOrder } = await api(`/api/purchase-orders/${t.editingPurchaseOrder.id}`, { method: "PUT", body });
          t.purchaseOrders = t.purchaseOrders.map((p) => (p.id === purchaseOrder.id ? purchaseOrder : p));
        } else {
          const { purchaseOrder } = await api("/api/purchase-orders", { method: "POST", body });
          t.purchaseOrders = [purchaseOrder, ...t.purchaseOrders];
        }
        t.editingPurchaseOrder = null;
        t.draftLineItems = null;
        renderApp();
        showToast("발주서가 저장되었습니다.");
      } catch (error) {
        showToast(error.message || "발주서 저장에 실패했습니다.", "error");
      }
    });
  }
  app.querySelectorAll("[data-edit-po]").forEach((btn) => {
    btn.addEventListener("click", () => {
      t.editingPurchaseOrder = t.purchaseOrders.find((p) => p.id === btn.dataset.editPo) || null;
      t.draftLineItems = t.editingPurchaseOrder ? t.editingPurchaseOrder.lineItems.map((item) => ({ ...item })) : null;
      renderApp();
    });
  });
  const cancelBtn = app.querySelector("[data-cancel-po-edit]");
  if (cancelBtn) cancelBtn.addEventListener("click", () => { t.editingPurchaseOrder = null; t.draftLineItems = null; renderApp(); });
  app.querySelectorAll("[data-delete-po]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("이 발주서를 삭제할까요?")) return;
      try {
        await api(`/api/purchase-orders/${btn.dataset.deletePo}`, { method: "DELETE" });
        t.purchaseOrders = t.purchaseOrders.filter((p) => p.id !== btn.dataset.deletePo);
        renderApp();
        showToast("발주서가 삭제되었습니다.");
      } catch (error) {
        showToast(error.message || "발주서 삭제에 실패했습니다.", "error");
      }
    });
  });
}
```

**Note for the implementer:** `cryptoRandomId()` is an existing helper already used by `mergeLineItem` in the 입금요청 form (`public/app.js`, grep it to confirm the exact name/signature before using it here — this plan assumes it returns a string with no arguments, matching its existing call sites).

- [ ] **Step 3: Syntax check**

Run: `node --check public/app.js`

- [ ] **Step 4: Browser smoke test**

On 명세서 발행 subnav: select the partner created earlier, add two line-item rows (e.g. "목줄 체크 블랙(S)" qty 40 unit "개" price 2800, and a second row), confirm the amount cell and the 합계 미리보기 line update live as you type, submit, confirm the new row appears in the 발주서 목록 table with the correct `docNo` and total. Edit it, change a quantity, save, confirm total recalculates. Delete it. Check console for errors.

- [ ] **Step 5: Commit**

```bash
git add public/app.js
git commit -m "feat(trade): add 명세서 발행 screen with line-item entry"
```

---

### Task 8: Purchase order Excel generation

**Files:**
- Create: `scripts/purchase_order_excel.py`
- Modify: `server.js` — add `PURCHASE_ORDER_SCRIPT` constant (near the existing `SETTLEMENT_SCRIPT`/`NPB_XLSX_SCRIPT` constants), a `generatePurchaseOrderXlsx(spec)` function (mirroring `generateSettlementXlsx`, `server.js:3766-3781`), and a `GET /api/purchase-orders/:id.xlsx` route.

**Interfaces:**
- Consumes: `purchaseOrder` + `partner` objects (Task 2, Task 6) to build the spec JSON.
- Produces: `.xlsx` binary response consumed by the `<a href="/api/purchase-orders/${po.id}.xlsx">` link already added in Task 7.

- [ ] **Step 1: Create `scripts/purchase_order_excel.py`**

```python
#!/usr/bin/env python3
"""Generate a single production-vendor purchase order (발주서) xlsx.
Reads a JSON spec from --input and writes --output.

Spec JSON:
{
  "docNo": "PO-20260928-001",
  "orderDate": "2026-09-28",
  "supplier": {"name","businessName","businessNumber","representativeName","address"},
  "deliveryPlace": "...",
  "lineItems": [{"itemName","spec","quantity","unit","unitPrice","amount"}, ...],
  "subtotal": 112000, "vat": 11200, "total": 123200,
  "note": "..."
}
"""

import argparse
import json
import os

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

try:
    from openpyxl.drawing.image import Image as XLImage
except Exception:  # pragma: no cover
    XLImage = None

LOGO_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "wooof_logo.png")

WOOOF_GREEN = "1FA84C"
GREY_FILL = PatternFill("solid", fgColor="D9D9D9")
_THIN = Side(style="thin", color="808080")
BORDER = Border(left=_THIN, right=_THIN, top=_THIN, bottom=_THIN)
HEAD_FILL = GREY_FILL
BOLD = Font(bold=True)
FONT = Font(name="맑은 고딕", size=10)
BOLD10 = Font(name="맑은 고딕", size=10, bold=True)
TITLE = Font(name="맑은 고딕", size=20, bold=True)
LOGO_FONT = Font(name="Arial Black", size=24, bold=True, color=WOOOF_GREEN)
CENTER = Alignment(horizontal="center", vertical="center", wrap_text=True)
LEFT = Alignment(horizontal="left", vertical="center")
RIGHT = Alignment(horizontal="right", vertical="center")
WON = "#,##0"

# 발행자(우리 회사) 고정 정보 — 실제 구글시트 "세림양식" 탭에서 확인한 값.
WOOOF_COMPANY = {
    "name": "주식회사 우프컴퍼니",
    "businessNumber": "314-87-00725",
    "representativeName": "이교영"
}


def insert_logo(ws, cell="A1"):
    if XLImage and os.path.exists(LOGO_PATH):
        try:
            img = XLImage(LOGO_PATH)
            img.width, img.height = 180, 32
            img.anchor = cell
            ws.add_image(img)
            return
        except Exception:
            pass
    ws[cell] = "WOOOF"
    ws[cell].font = LOGO_FONT


def box(ws, cell_range, border=BORDER):
    from openpyxl.utils.cell import range_boundaries
    min_col, min_row, max_col, max_row = range_boundaries(cell_range)
    for row in ws.iter_rows(min_row=min_row, max_row=max_row, min_col=min_col, max_col=max_col):
        for cell in row:
            cell.border = border


def _num(v):
    try:
        return int(round(float(v or 0)))
    except (TypeError, ValueError):
        return 0


def build_purchase_order(ws, spec):
    ws.column_dimensions["A"].width = 4
    ws.column_dimensions["B"].width = 24
    ws.column_dimensions["C"].width = 16
    ws.column_dimensions["D"].width = 10
    ws.column_dimensions["E"].width = 10
    ws.column_dimensions["F"].width = 14
    ws.column_dimensions["G"].width = 16

    insert_logo(ws, "A1")
    ws["A3"] = "발  주  서"
    ws["A3"].font = TITLE
    ws["A3"].alignment = CENTER
    ws.merge_cells("A3:G3")

    ws["A5"] = f"문서번호: {spec.get('docNo', '')}"
    ws["A6"] = f"발주일: {spec.get('orderDate', '')}"

    supplier = spec.get("supplier", {})
    ws["A8"] = "발주처"
    ws["A8"].font = BOLD10
    ws["B8"] = WOOOF_COMPANY["name"]
    ws["D8"] = f"사업자번호 {WOOOF_COMPANY['businessNumber']}"
    ws["A9"] = "대표자"
    ws["B9"] = WOOOF_COMPANY["representativeName"]

    ws["A11"] = "공급처"
    ws["A11"].font = BOLD10
    ws["B11"] = supplier.get("name", "")
    ws["D11"] = f"사업자번호 {supplier.get('businessNumber', '')}"
    ws["A12"] = "대표자"
    ws["B12"] = supplier.get("representativeName", "")
    ws["A13"] = "주소"
    ws["B13"] = supplier.get("address", "")
    ws.merge_cells("B13:G13")

    if spec.get("deliveryPlace"):
        ws["A14"] = "납품장소"
        ws["B14"] = spec["deliveryPlace"]
        ws.merge_cells("B14:G14")

    header_row = 16
    headers = ["No", "품목명", "규격", "수량", "단위", "단가", "금액"]
    for ci, hd in enumerate(headers, start=1):
        c = ws.cell(row=header_row, column=ci, value=hd)
        c.font = BOLD
        c.fill = HEAD_FILL
        c.alignment = CENTER
        c.border = BORDER

    r = header_row + 1
    for i, line in enumerate(spec.get("lineItems", []), start=1):
        vals = [i, line.get("itemName", ""), line.get("spec", ""), _num(line.get("quantity")),
                line.get("unit", ""), _num(line.get("unitPrice")), _num(line.get("amount"))]
        for ci, v in enumerate(vals, start=1):
            c = ws.cell(row=r, column=ci, value=v)
            c.border = BORDER
            if ci in (6, 7):
                c.number_format = WON
        r += 1

    sum_row = r + 1
    ws.cell(row=sum_row, column=6, value="소계").font = BOLD
    ws.cell(row=sum_row, column=7, value=_num(spec.get("subtotal"))).number_format = WON
    ws.cell(row=sum_row + 1, column=6, value="부가세").font = BOLD
    ws.cell(row=sum_row + 1, column=7, value=_num(spec.get("vat"))).number_format = WON
    ws.cell(row=sum_row + 2, column=6, value="총 합계").font = BOLD
    total_cell = ws.cell(row=sum_row + 2, column=7, value=_num(spec.get("total")))
    total_cell.number_format = WON
    total_cell.font = BOLD

    if spec.get("note"):
        ws.cell(row=sum_row + 4, column=1, value=f"메모: {spec['note']}")

    box(ws, f"A{header_row}:G{sum_row + 2}")
    return sum_row + 2


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    args = ap.parse_args()

    with open(args.input, encoding="utf-8") as f:
        spec = json.load(f)

    wb = Workbook()
    ws = wb.active
    ws.title = "발주서"
    last_row = build_purchase_order(ws, spec)
    wb.save(args.output)
    print(json.dumps({"ok": True, "lastRow": last_row, "lineCount": len(spec.get("lineItems", []))}))


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Syntax check the Python script**

Run: `python3 -m py_compile scripts/purchase_order_excel.py`
Expected: no output, exit code 0.

- [ ] **Step 3: Manual generation smoke test (no server involved)**

```bash
cat > /tmp/po-spec.json <<'EOF'
{
  "docNo": "PO-20260928-001",
  "orderDate": "2026-09-28",
  "supplier": {"name": "세림통상", "businessNumber": "123-45-67890", "representativeName": "최명호", "address": "서울시 ..."},
  "deliveryPlace": "우프컴퍼니 물류센터",
  "lineItems": [{"itemName": "목줄 체크 블랙(S)", "spec": "S", "quantity": 40, "unit": "개", "unitPrice": 2800, "amount": 112000}],
  "subtotal": 112000, "vat": 11200, "total": 123200, "note": ""
}
EOF
python3 scripts/purchase_order_excel.py --input /tmp/po-spec.json --output /tmp/po-test.xlsx
python3 -c "
from openpyxl import load_workbook
wb = load_workbook('/tmp/po-test.xlsx')
ws = wb.active
print(ws['A3'].value, ws['B11'].value, ws['G20' if False else 'G' + str(19)].value)
"
```

Expected: `{"ok": true, "lastRow": ..., "lineCount": 1}` printed by the script, and the workbook opens without error (adjust the cell reference in the readback snippet to whatever `sum_row+2` actually resolved to — print `last_row` from the script's own JSON output and read that exact cell instead of guessing the row number).

- [ ] **Step 4: Wire up `server.js`**

Find where `SETTLEMENT_SCRIPT` is declared (`grep -n "const SETTLEMENT_SCRIPT" server.js`) and add a sibling constant right after it:

```js
const PURCHASE_ORDER_SCRIPT = path.join(__dirname, "scripts", "purchase_order_excel.py");
```

Add this function directly after `generateSettlementXlsx` (`server.js:3766-3781`):

```js
async function generatePurchaseOrderXlsx(spec) {
  const tmpBase = path.join(os.tmpdir(), `wooofpay-po-${crypto.randomBytes(8).toString("hex")}`);
  const inputPath = `${tmpBase}.json`;
  const outputPath = `${tmpBase}.xlsx`;
  try {
    await writeFile(inputPath, JSON.stringify(spec), "utf8");
    await execFileAsync("python3", [PURCHASE_ORDER_SCRIPT, "--input", inputPath, "--output", outputPath], {
      cwd: __dirname,
      maxBuffer: 20 * 1024 * 1024
    });
    return await readFile(outputPath);
  } finally {
    await safeUnlink(inputPath);
    await safeUnlink(outputPath);
  }
}
```

Add the download route directly after the `purchaseOrders` DELETE route from Task 6:

```js
  const purchaseOrderXlsxMatch = pathname.match(/^\/api\/purchase-orders\/([^/]+)\.xlsx$/);
  if (purchaseOrderXlsxMatch && method === "GET") {
    if (!requirePermission(actor, res, "trade", "view")) return;
    const purchaseOrder = (db.purchaseOrders || []).find((item) => item.id === purchaseOrderXlsxMatch[1]);
    if (!purchaseOrder) {
      sendJson(res, 404, { error: "발주서를 찾을 수 없습니다." });
      return;
    }
    const partner = (db.partners || []).find((item) => item.id === purchaseOrder.partnerId) || {};
    const spec = {
      docNo: purchaseOrder.docNo,
      orderDate: purchaseOrder.orderDate,
      supplier: {
        name: partner.name || "",
        businessName: partner.businessName || "",
        businessNumber: partner.businessNumber || "",
        representativeName: partner.representativeName || "",
        address: partner.address || ""
      },
      deliveryPlace: purchaseOrder.deliveryPlace,
      lineItems: purchaseOrder.lineItems,
      subtotal: purchaseOrder.subtotal,
      vat: purchaseOrder.vat,
      total: purchaseOrder.total,
      note: purchaseOrder.note
    };
    const buffer = await generatePurchaseOrderXlsx(spec);
    sendBuffer(res, 200, buffer,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      { "content-disposition": contentDisposition(`${purchaseOrder.docNo}.xlsx`) });
    return;
  }

```

- [ ] **Step 5: Syntax check**

Run: `node --check server.js`

- [ ] **Step 6: Scratch-DB end-to-end smoke test**

Same recipe as Task 6 Step 4, then:

```bash
curl -s http://localhost:4599/api/purchase-orders/<po id from prior create>.xlsx \
  -H "Cookie: wooofpay_session=$COOKIE" -o /tmp/downloaded-po.xlsx
python3 -c "from openpyxl import load_workbook; wb = load_workbook('/tmp/downloaded-po.xlsx'); print(wb.active['A3'].value)"
```

Expected: prints `발  주  서`, confirming the download endpoint returns a valid, readable workbook.

- [ ] **Step 7: Commit**

```bash
git add server.js scripts/purchase_order_excel.py
git commit -m "feat(trade): generate purchase order xlsx via new script + download route"
```

---

### Task 9: Permission grid check + final end-to-end pass

**Files:** none to modify — verification only.

- [ ] **Step 1: Confirm the admin permission grid shows 거래관리**

Browser check: log in as an owner, go to 관리자 → open a non-owner admin's edit form → confirm the 메뉴 권한 table now has a "거래관리" row with 접근·읽기/등록/수정/삭제 checkboxes (this should work automatically from Task 1's `MENU_REGISTRY` addition with no client code — `renderPermissionGrid` is data-driven). If it doesn't appear, the `GET` route serving `menus`/`actionLabels` (`server.js:6335`) is being cached client-side somewhere stale — check `state.menus` is refetched, not hardcoded.

- [ ] **Step 2: Confirm a permission-less admin can't see or use 거래관리**

Create (or edit an existing) non-owner admin with the `trade` key absent from their `permissions`. Log in as that admin. Confirm "거래관리" doesn't appear in the sidebar (client-side `can(key,"view")` filter in the `tabs` array). Then, with that admin's session cookie, `curl -s .../api/partners -X POST ...` directly — confirm it returns `403`, proving the server-side `requirePermission` calls from Tasks 2/4/6/8 are actually enforced and not just hidden in the UI.

- [ ] **Step 3: Full manual walkthrough on a scratch DB**

Using the scratch-DB recipe from Task 1, do the entire flow once end-to-end in the browser: create a production partner → create a material linked to it → create a purchase order with 2 line items (mix of a catalog-linked item and a free-typed one) → download the Excel → open it and visually confirm the vendor name, item rows, and totals match what was entered on screen.

- [ ] **Step 4: Clean up scratch artifacts**

```bash
rm -rf /tmp/wooofpay-scratch /tmp/po-spec.json /tmp/po-test.xlsx /tmp/downloaded-po.xlsx
```

Confirm `git status` on `data/db.json` shows no changes (none of this plan's verification steps should ever touch the real `data/db.json`).

- [ ] **Step 5: Nothing to commit for this task** — it's verification-only. If Step 2 surfaces a real gap (e.g. a route missing its `requirePermission` call), fix it as a small addendum commit to the relevant earlier task's file, not a new task.

---

## Self-Review Notes

- **Spec coverage:** every data-model field, screen, and the Excel-only decision from `docs/superpowers/specs/2026-09-28-production-purchase-order-design.md` maps to a task above. The hybrid materials-catalog UX (pick-or-freeform) is present as-is in Task 7 (materials aren't force-linked — `materialId` stays `""` for free-typed lines); the *catalog-registration-suggestion* half of the hybrid (offering to save a free-typed line into `materials` after the fact) is intentionally **not** built in this pass — flagging it here explicitly as a deferred fast-follow, not a silent drop, since the spec called it out as the core mechanism. Add a Task 10 for it before considering this feature "done" against the spec's stated design.
- **Placeholder scan:** no TBD/TODO left; every step has real code or a real shell command.
- **Type consistency:** `partnerId`/`materialId`/`id` naming is consistent from Task 2 → Task 6 → Task 7 → Task 8. `lineItems[].amount` (computed) vs `unitPrice`/`quantity` (input) naming matches between the server sanitizer (Task 6) and the client draft state (Task 7).
