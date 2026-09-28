# 거래관리 — 생산업체 발주서 (1단계) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "거래관리" menu with 거래처관리/원부자재관리/명세서 발행 sub-screens so production-vendor purchase orders (발주서) can be created, tracked, and exported to Excel instead of hand-built in Google Sheets.

**Architecture:** Three new top-level DB collections (`partners`, `materials`, `purchaseOrders`) added to the existing single-file JSON DB, exposed via the same `pathname === "/api/..."` route-matching convention already used for `brands`/`price-entries`. The client adds one new nav tab ("거래관리") whose three sub-screens are switched via a `state.procurement.screen` field, mirroring the existing NPB tab's `NPB_SCREENS`/`n.screen` sub-nav pattern exactly. A new standalone `scripts/purchase_order_excel.py` (openpyxl, same invocation convention as `scripts/settlement_excel.py`) renders the 발주서 document.

**Tech Stack:** Node.js (ESM, no framework) on the server, vanilla JS string-template rendering on the client (`public/app.js`), openpyxl (Python) for Excel generation. No test framework exists in this repo — verification is `node --check` for syntax, plus booting the real dev server against a disposable scratch copy of `data/db.json` and hitting endpoints with `curl`, plus a final browser pass with the Chrome extension tools. This replaces the pytest-style TDD loop the skill template shows.

**Spec:** `docs/superpowers/specs/2026-09-28-production-purchase-order-design.md`

## Global Constraints

- Scope is **production vendors only** (`category: "production"`). The `partners`/`purchaseOrders` schema supports `sales`/`purchase` categories too (per the spec), but no screen in this plan exercises them beyond letting the category field be set.
- Item management is **hybrid**: purchase-order line items can reference a `materials` catalog entry or be typed freehand; typing a name not in the catalog triggers a client-side "register this to the catalog?" confirm — no new server endpoint for this, since `state.materials` is already loaded client-side (unlike the sales-side `priceEntries` flow, which needs a server round trip for date-effective/alias matching materials don't have).
- `partners.attachments` is a **list of pasted link strings** (e.g. a Google Drive URL), not real file upload — this repo's `readBody()` only parses JSON, and there is no existing persistent-binary-attachment storage to build on. Do not add file upload infra as part of this plan.
- Document output is **Excel only** for this plan (no PDF).
- The issuing company (발행자 = 우리 회사) is a **hardcoded constant** (`COMPANY_INFO` in `server.js`), not picked from `partners` — there is only one issuing entity today.
- VAT is a flat 10% (`Math.round(subtotal * 0.1)`), matching how the rest of this codebase computes VAT-like amounts.
- Every new collection follows the existing `touch(db, "key", [])` migration convention (`migrateDb()`) and the existing `id(prefix)` helper (`crypto.randomBytes(8).toString("hex")`, prefixed) for IDs.
- Server-side write-permission checks (`requirePermission`) are **not** added to the new routes — `brands`/`price-entries`/`requests` routes don't have them either (only `admins`/`pipeline`/`reconcile`/`npb` do); adding them here would be inconsistent with the rest of the codebase, not a fix.

---

## File Structure

| File | Responsibility |
|---|---|
| `server.js` | DB schema (init + migration), `MENU_REGISTRY` entry, CRUD API routes for `partners`/`materials`/`purchaseOrders`, docNo numbering, line-item sanitizing, Excel generation glue |
| `scripts/purchase_order_excel.py` | New — renders one 발주서 xlsx from a JSON spec (openpyxl), invoked as a subprocess exactly like `scripts/settlement_excel.py` |
| `public/app.js` | Client state, `loadAll()` wiring, "거래관리" nav tab + sub-nav shell, three screens (거래처관리/원부자재관리/명세서 발행) |
| `public/styles.css` | Column-width rules for the three new tables |

---

## Task 1: 데이터 모델 — DB 스키마 / 마이그레이션 / 메뉴 권한

**Files:**
- Modify: `server.js` (four separate edits — see steps)

**Interfaces:**
- Produces: `db.partners`, `db.materials`, `db.purchaseOrders` (all arrays, present on every DB whether freshly bootstrapped or migrated), `partnerCategories` (Set: `"production" | "sales" | "purchase"`), `purchaseOrderStatuses` (Set: `"ordered" | "in_production" | "received" | "cancelled"`), `MENU_REGISTRY` key `"procurement"`.

- [ ] **Step 1: Add the category/status enums next to the existing `settlementTypes` constant**

`server.js:196` currently reads:
```js
const settlementTypes = new Set(["prepay_debt", "prepay_fee", "prepay_supply", "consignment", "direct_purchase"]);
```
Add immediately after it:
```js
const partnerCategories = new Set(["production", "sales", "purchase"]);
const purchaseOrderStatuses = new Set(["ordered", "in_production", "received", "cancelled"]);
```

- [ ] **Step 2: Seed the three collections in `buildInitialDb()`**

Find (around line 1102-1104):
```js
    priceEntries: [],
    priceAliases: [],
    promotionRules: [],
```
Change to:
```js
    priceEntries: [],
    priceAliases: [],
    promotionRules: [],
    partners: [],
    materials: [],
    purchaseOrders: [],
```

- [ ] **Step 3: Backfill the three collections in `migrateDb()`**

Find (around line 1280-1282):
```js
  touch(db, "priceEntries", []);
  touch(db, "priceAliases", []);
  touch(db, "promotionRules", []);
```
Change to:
```js
  touch(db, "priceEntries", []);
  touch(db, "priceAliases", []);
  touch(db, "promotionRules", []);
  touch(db, "partners", []);
  touch(db, "materials", []);
  touch(db, "purchaseOrders", []);
```

- [ ] **Step 4: Register the "거래관리" menu key**

Find the end of `MENU_REGISTRY` (around line 4196):
```js
  { key: "npb", label: "npb정산", actions: ["view", "edit"] }
];
```
Change to:
```js
  { key: "npb", label: "npb정산", actions: ["view", "edit"] },
  { key: "procurement", label: "거래관리", actions: ["view", "create", "edit", "delete"] }
];
```

- [ ] **Step 5: Syntax check**

Run: `node --check server.js`
Expected: no output (success).

- [ ] **Step 6: Smoke-test migration on an old-shaped DB**

```bash
mkdir -p /tmp/wooofpay-scratch
cp data/db.json /tmp/wooofpay-scratch/db.json
node -e "
const fs = require('fs');
const db = JSON.parse(fs.readFileSync('/tmp/wooofpay-scratch/db.json', 'utf8'));
delete db.partners; delete db.materials; delete db.purchaseOrders;
fs.writeFileSync('/tmp/wooofpay-scratch/db.json', JSON.stringify(db));
"
DATA_DIR=/tmp/wooofpay-scratch PORT=4700 node server.js &
sleep 2
kill %1
node -e "
const fs = require('fs');
const db = JSON.parse(fs.readFileSync('/tmp/wooofpay-scratch/db.json', 'utf8'));
console.log('partners:', Array.isArray(db.partners), 'materials:', Array.isArray(db.materials), 'purchaseOrders:', Array.isArray(db.purchaseOrders));
"
rm -rf /tmp/wooofpay-scratch
```
Expected: `partners: true materials: true purchaseOrders: true` (migration runs once at boot in `doEnsureDb()`, before the server starts listening — no HTTP call needed to trigger it).

- [ ] **Step 7: Commit**

```bash
git add server.js
git commit -m "feat(procurement): seed partners/materials/purchaseOrders collections"
```

---

## Task 2: 거래처(partners) API

**Files:**
- Modify: `server.js` — insert a new route block immediately before the final fallback `sendJson(res, 404, { error: "API를 찾을 수 없습니다." });` / `}` that closes the main request-handling function (this is the very last `sendJson(res, 404, ...)` in the file, i.e. the one **not** nested inside the `/api/npb/...` block).

**Interfaces:**
- Consumes: `partnerCategories` (Task 1), `id(prefix)`, `now()`, `addAudit(db, actor, action, entityType, entityId, summary, before, after)`, `readBody(req)`, `sendJson(res, status, body)`, `writeDb(db)` — all pre-existing helpers.
- Produces: `GET /api/partners` → `{ partners: [...] }`; `POST /api/partners` → `{ partner }`; `PUT /api/partners/:id` → `{ partner }`; `DELETE /api/partners/:id` → `{ ok: true }`. Partner shape: `{ id, category, name, businessName, businessNumber, representativeName, address, invoiceEmail, bankName, bankAccount, depositorName, orderMethod, invoiceTiming, contactName, contactPhone, contactEmail, note, attachments: string[], isActive, createdAt, updatedAt }`.

- [ ] **Step 1: Add the route block**

Insert this whole block right before the file's final `sendJson(res, 404, { error: "API를 찾을 수 없습니다." });`:

```js
  if (pathname === "/api/partners" && method === "GET") {
    const category = url.searchParams.get("category") || "";
    const rows = (db.partners || [])
      .filter((item) => !category || item.category === category)
      .slice()
      .sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ko"));
    sendJson(res, 200, { partners: rows });
    return;
  }

  if (pathname === "/api/partners" && method === "POST") {
    const body = await readBody(req);
    const name = String(body.name || "").trim();
    if (!name) {
      sendJson(res, 400, { error: "거래처명은 필수입니다." });
      return;
    }
    const partner = {
      id: id("partner"),
      category: partnerCategories.has(body.category) ? body.category : "production",
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
      attachments: Array.isArray(body.attachments)
        ? body.attachments.map((item) => String(item || "").trim()).filter(Boolean)
        : [],
      isActive: body.isActive !== false,
      createdAt: now(),
      updatedAt: now()
    };
    db.partners.unshift(partner);
    addAudit(db, actor, "create", "partner", partner.id, `${partner.name} 거래처 생성`, null, partner);
    await writeDb(db);
    sendJson(res, 201, { partner });
    return;
  }

  const partnerMatch = pathname.match(/^\/api\/partners\/([^/]+)$/);
  if (partnerMatch && method === "PUT") {
    const body = await readBody(req);
    const partner = db.partners.find((item) => item.id === partnerMatch[1]);
    if (!partner) {
      sendJson(res, 404, { error: "거래처를 찾을 수 없습니다." });
      return;
    }
    const before = { ...partner };
    for (const key of [
      "category", "name", "businessName", "businessNumber", "representativeName",
      "address", "invoiceEmail", "bankName", "bankAccount", "depositorName",
      "orderMethod", "invoiceTiming", "contactName", "contactPhone", "contactEmail", "note"
    ]) {
      if (key in body) partner[key] = String(body[key] || "").trim();
    }
    if (!partnerCategories.has(partner.category)) partner.category = "production";
    if ("attachments" in body) {
      partner.attachments = Array.isArray(body.attachments)
        ? body.attachments.map((item) => String(item || "").trim()).filter(Boolean)
        : [];
    }
    if ("isActive" in body) partner.isActive = body.isActive !== false && body.isActive !== "false";
    partner.updatedAt = now();
    addAudit(db, actor, "update", "partner", partner.id, `${partner.name} 거래처 수정`, before, partner);
    await writeDb(db);
    sendJson(res, 200, { partner });
    return;
  }

  if (partnerMatch && method === "DELETE") {
    const index = db.partners.findIndex((item) => item.id === partnerMatch[1]);
    if (index === -1) {
      sendJson(res, 404, { error: "거래처를 찾을 수 없습니다." });
      return;
    }
    const inUse = (db.purchaseOrders || []).some((po) => po.partnerId === partnerMatch[1]);
    if (inUse) {
      sendJson(res, 400, { error: "발주서가 있는 거래처는 삭제할 수 없습니다. 먼저 사용 안 함으로 전환하세요." });
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

Run: `node --check server.js` — expect no output.

- [ ] **Step 3: Boot against a scratch DB and smoke-test the four routes**

```bash
mkdir -p /tmp/wooofpay-scratch
cp data/db.json /tmp/wooofpay-scratch/db.json
DATA_DIR=/tmp/wooofpay-scratch PORT=4700 node server.js &
sleep 2
SESSION=$(curl -s -c - http://localhost:4700/api/login -X POST -H "Content-Type: application/json" \
  -d '{"email":"owner@wooofpay.local","password":"REPLACE_WITH_ACTUAL_BOOTSTRAP_ADMIN_PASSWORD"}' \
  -o /dev/null | grep wooofpay_session | awk '{print $7}')
curl -s -H "Cookie: wooofpay_session=$SESSION" -X POST http://localhost:4700/api/partners \
  -H "Content-Type: application/json" \
  -d '{"category":"production","name":"테스트공장","businessName":"테스트상사","orderMethod":"메일"}'
curl -s -H "Cookie: wooofpay_session=$SESSION" http://localhost:4700/api/partners
kill %1
rm -rf /tmp/wooofpay-scratch
```
Expected: the POST returns `{"partner":{"id":"partner_...","category":"production","name":"테스트공장",...}}`, and the GET returns that same partner inside `{"partners":[...]}`.

Note: use whatever admin login this dev environment actually has (check `data/db.json`'s `admins` array for an active account, or `.env.local`'s `BOOTSTRAP_ADMIN_*` vars) — do not hardcode a guessed password into the committed plan; this step is meant to be run interactively, adjust credentials as needed.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat(procurement): add partners CRUD API"
```

---

## Task 3: 원부자재(materials) API

**Files:**
- Modify: `server.js` — insert immediately after Task 2's block (same "before the final 404" location).

**Interfaces:**
- Consumes: same helpers as Task 2.
- Produces: `GET /api/materials` (optional `?partnerId=`) → `{ materials: [...] }`; `POST /api/materials` → `{ material }`; `PUT /api/materials/:id` → `{ material }`; `DELETE /api/materials/:id` → `{ ok: true }`. Material shape: `{ id, partnerId, itemName, category, orderUnit, basePrice, leadTimeDays, note, isActive, createdAt, updatedAt }`.

- [ ] **Step 1: Add the route block**

```js
  if (pathname === "/api/materials" && method === "GET") {
    const partnerId = url.searchParams.get("partnerId") || "";
    const rows = (db.materials || [])
      .filter((item) => !partnerId || item.partnerId === partnerId)
      .slice()
      .sort((a, b) => String(a.itemName || "").localeCompare(String(b.itemName || ""), "ko"));
    sendJson(res, 200, { materials: rows });
    return;
  }

  if (pathname === "/api/materials" && method === "POST") {
    const body = await readBody(req);
    const itemName = String(body.itemName || "").trim();
    if (!itemName) {
      sendJson(res, 400, { error: "품목명은 필수입니다." });
      return;
    }
    const material = {
      id: id("material"),
      partnerId: String(body.partnerId || "").trim(),
      itemName,
      category: String(body.category || "").trim(),
      orderUnit: String(body.orderUnit || "").trim(),
      basePrice: number(body.basePrice),
      leadTimeDays: number(body.leadTimeDays),
      note: String(body.note || "").trim(),
      isActive: body.isActive !== false,
      createdAt: now(),
      updatedAt: now()
    };
    db.materials.unshift(material);
    addAudit(db, actor, "create", "material", material.id, `${material.itemName} 원부자재 생성`, null, material);
    await writeDb(db);
    sendJson(res, 201, { material });
    return;
  }

  const materialMatch = pathname.match(/^\/api\/materials\/([^/]+)$/);
  if (materialMatch && method === "PUT") {
    const body = await readBody(req);
    const material = db.materials.find((item) => item.id === materialMatch[1]);
    if (!material) {
      sendJson(res, 404, { error: "원부자재를 찾을 수 없습니다." });
      return;
    }
    const before = { ...material };
    for (const key of ["partnerId", "itemName", "category", "orderUnit", "note"]) {
      if (key in body) material[key] = String(body[key] || "").trim();
    }
    if ("basePrice" in body) material.basePrice = number(body.basePrice);
    if ("leadTimeDays" in body) material.leadTimeDays = number(body.leadTimeDays);
    if ("isActive" in body) material.isActive = body.isActive !== false && body.isActive !== "false";
    material.updatedAt = now();
    addAudit(db, actor, "update", "material", material.id, `${material.itemName} 원부자재 수정`, before, material);
    await writeDb(db);
    sendJson(res, 200, { material });
    return;
  }

  if (materialMatch && method === "DELETE") {
    const index = db.materials.findIndex((item) => item.id === materialMatch[1]);
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

Run: `node --check server.js` — expect no output.

- [ ] **Step 3: Boot against a scratch DB and smoke-test**

Same pattern as Task 2 Step 3, but:
```bash
curl -s -H "Cookie: wooofpay_session=$SESSION" -X POST http://localhost:4700/api/materials \
  -H "Content-Type: application/json" \
  -d '{"itemName":"테스트원단","orderUnit":"Roll","basePrice":10000}'
curl -s -H "Cookie: wooofpay_session=$SESSION" http://localhost:4700/api/materials
```
Expected: POST returns `{"material":{"id":"material_...","itemName":"테스트원단","orderUnit":"Roll","basePrice":10000,...}}`; GET lists it.

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat(procurement): add materials catalog CRUD API"
```

---

## Task 4: 발주서(purchaseOrders) API

**Files:**
- Modify: `server.js` — the `id()`/enum-based route block (insert after Task 3's block, same location), plus a new helper function `sanitizePurchaseOrderLineItems` and `nextPurchaseOrderDocNo` placed near the existing `sanitizeLineItems` function (`server.js:4323`, search for `function sanitizeLineItems(raw) {` and add the two new functions immediately before it).

**Interfaces:**
- Consumes: `purchaseOrderStatuses` (Task 1), `number()`, `dateOnly()`, `id()`, `now()`, `addAudit`, `readBody`, `sendJson`, `writeDb`.
- Produces: `sanitizePurchaseOrderLineItems(raw) => LineItem[]` where `LineItem = { id, materialId, itemName, spec, quantity, unit, unitPrice, totalPrice }`; `nextPurchaseOrderDocNo(db, orderDate) => string` (e.g. `"PO-20260928-001"`); `GET /api/purchase-orders` (optional `?partnerId=`) → `{ purchaseOrders: [...] }`; `POST /api/purchase-orders` → `{ purchaseOrder }`; `PUT /api/purchase-orders/:id` → `{ purchaseOrder }`; `DELETE /api/purchase-orders/:id` → `{ ok: true }`. PurchaseOrder shape: `{ id, docNo, partnerId, orderDate, status, lineItems: LineItem[], deliveryPlace, subtotal, vat, total, note, createdAt, updatedAt }`.

- [ ] **Step 1: Add the two helper functions before `sanitizeLineItems`**

Find `function sanitizeLineItems(raw) {` (`server.js:4323`) and insert immediately before it:

```js
function sanitizePurchaseOrderLineItems(raw) {
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
        totalPrice: Math.round(quantity * unitPrice)
      };
    })
    .filter((item) => item.itemName);
}

// 문서번호는 별도 카운터를 두지 않고, 같은 날짜로 이미 저장된 발주서 개수에서
// 파생한다 — 저장된 데이터가 곧 진실이라 카운터가 어긋날 일이 없다.
function nextPurchaseOrderDocNo(db, orderDate) {
  const dateKey = (dateOnly(orderDate) || now().slice(0, 10)).replaceAll("-", "");
  const sameDay = (db.purchaseOrders || []).filter((po) => String(po.docNo || "").startsWith(`PO-${dateKey}-`));
  const seq = sameDay.length + 1;
  return `PO-${dateKey}-${String(seq).padStart(3, "0")}`;
}

```

- [ ] **Step 2: Add the route block**

Insert (same "before the final 404" location used in Tasks 2-3):

```js
  if (pathname === "/api/purchase-orders" && method === "GET") {
    const partnerId = url.searchParams.get("partnerId") || "";
    const rows = (db.purchaseOrders || [])
      .filter((item) => !partnerId || item.partnerId === partnerId)
      .slice()
      .sort((a, b) => (b.orderDate || "").localeCompare(a.orderDate || "") || b.updatedAt.localeCompare(a.updatedAt));
    sendJson(res, 200, { purchaseOrders: rows });
    return;
  }

  if (pathname === "/api/purchase-orders" && method === "POST") {
    const body = await readBody(req);
    const partner = db.partners.find((item) => item.id === body.partnerId);
    if (!partner) {
      sendJson(res, 400, { error: "거래처를 선택하세요." });
      return;
    }
    const orderDate = dateOnly(body.orderDate) || now().slice(0, 10);
    const lineItems = sanitizePurchaseOrderLineItems(body.lineItems);
    const subtotal = lineItems.reduce((sum, item) => sum + item.totalPrice, 0);
    const vat = Math.round(subtotal * 0.1);
    const po = {
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
    db.purchaseOrders.unshift(po);
    addAudit(db, actor, "create", "purchaseOrder", po.id, `${po.docNo} 발주서 생성`, null, po);
    await writeDb(db);
    sendJson(res, 201, { purchaseOrder: po });
    return;
  }

  const poMatch = pathname.match(/^\/api\/purchase-orders\/([^/]+)$/);
  if (poMatch && method === "PUT") {
    const body = await readBody(req);
    const po = db.purchaseOrders.find((item) => item.id === poMatch[1]);
    if (!po) {
      sendJson(res, 404, { error: "발주서를 찾을 수 없습니다." });
      return;
    }
    const before = { ...po };
    if ("partnerId" in body) {
      const partner = db.partners.find((item) => item.id === body.partnerId);
      if (!partner) {
        sendJson(res, 400, { error: "거래처를 찾을 수 없습니다." });
        return;
      }
      po.partnerId = partner.id;
    }
    if ("orderDate" in body) po.orderDate = dateOnly(body.orderDate) || po.orderDate;
    if ("status" in body && purchaseOrderStatuses.has(body.status)) po.status = body.status;
    if ("deliveryPlace" in body) po.deliveryPlace = String(body.deliveryPlace || "").trim();
    if ("note" in body) po.note = String(body.note || "").trim();
    if ("lineItems" in body) {
      po.lineItems = sanitizePurchaseOrderLineItems(body.lineItems);
      po.subtotal = po.lineItems.reduce((sum, item) => sum + item.totalPrice, 0);
      po.vat = Math.round(po.subtotal * 0.1);
      po.total = po.subtotal + po.vat;
    }
    po.updatedAt = now();
    addAudit(db, actor, "update", "purchaseOrder", po.id, `${po.docNo} 발주서 수정`, before, po);
    await writeDb(db);
    sendJson(res, 200, { purchaseOrder: po });
    return;
  }

  if (poMatch && method === "DELETE") {
    const index = db.purchaseOrders.findIndex((item) => item.id === poMatch[1]);
    if (index === -1) {
      sendJson(res, 404, { error: "발주서를 찾을 수 없습니다." });
      return;
    }
    const [before] = db.purchaseOrders.splice(index, 1);
    addAudit(db, actor, "delete", "purchaseOrder", before.id, `${before.docNo} 발주서 삭제`, before, null);
    await writeDb(db);
    sendJson(res, 200, { ok: true });
    return;
  }

```

- [ ] **Step 3: Syntax check**

Run: `node --check server.js` — expect no output.

- [ ] **Step 4: Boot against a scratch DB and smoke-test docNo numbering**

Same scratch-DB pattern as Task 2 Step 3 (create the partner from Task 2's test first, capture its id from the response), then:
```bash
PARTNER_ID="<id from the /api/partners POST response>"
curl -s -H "Cookie: wooofpay_session=$SESSION" -X POST http://localhost:4700/api/purchase-orders \
  -H "Content-Type: application/json" \
  -d "{\"partnerId\":\"$PARTNER_ID\",\"orderDate\":\"2026-09-28\",\"lineItems\":[{\"itemName\":\"테스트원단\",\"quantity\":10,\"unit\":\"Roll\",\"unitPrice\":10000}]}"
curl -s -H "Cookie: wooofpay_session=$SESSION" -X POST http://localhost:4700/api/purchase-orders \
  -H "Content-Type: application/json" \
  -d "{\"partnerId\":\"$PARTNER_ID\",\"orderDate\":\"2026-09-28\",\"lineItems\":[]}"
```
Expected: first response has `"docNo":"PO-20260928-001"`, `"subtotal":100000`, `"vat":10000`, `"total":110000`; second response has `"docNo":"PO-20260928-002"`.

- [ ] **Step 5: Commit**

```bash
git add server.js
git commit -m "feat(procurement): add purchase orders CRUD API with doc-number sequencing"
```

---

## Task 5: 발주서 엑셀 발행

**Files:**
- Create: `scripts/purchase_order_excel.py`
- Modify: `server.js` — add `PURCHASE_ORDER_SCRIPT` constant, `COMPANY_INFO` constant, `generatePurchaseOrderXlsx()` function, and one new route.

**Interfaces:**
- Consumes: `execFileAsync`, `os`, `path`, `crypto`, `writeFile`/`readFile`, `safeUnlink` (all already imported/defined in `server.js`), `contentDisposition()`, `sendBuffer()`.
- Produces: `generatePurchaseOrderXlsx(spec) => Promise<Buffer>`; `GET /api/purchase-orders/:id/excel` → an `.xlsx` file download.

- [ ] **Step 1: Create `scripts/purchase_order_excel.py`**

```python
#!/usr/bin/env python3
"""Generate a production purchase order (발주서) xlsx from a JSON spec.

Spec JSON:
{
  "docNo": "PO-20260928-001",
  "orderDate": "2026-09-28",
  "issuer": {"businessName","businessNumber","representativeName","address","bankInfo"},
  "partner": {"name","businessName","businessNumber","representativeName","address",
              "contactName","contactEmail"},
  "lineItems": [{"itemName","spec","quantity","unit","unitPrice","totalPrice"}, ...],
  "deliveryPlace": "...",
  "subtotal": 0, "vat": 0, "total": 0,
  "note": "..."
}
"""

import argparse
import json

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

_THIN = Side(style="thin", color="808080")
BORDER = Border(left=_THIN, right=_THIN, top=_THIN, bottom=_THIN)
HEAD_FILL = PatternFill("solid", fgColor="D9D9D9")
BOLD = Font(bold=True)
TITLE = Font(size=20, bold=True)
CENTER = Alignment(horizontal="center", vertical="center", wrap_text=True)
WON = "#,##0"


def _num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def build_purchase_order(ws, spec):
    ws.title = "발주서"
    ws["A1"] = "발  주  서"
    ws["A1"].font = TITLE
    ws.merge_cells("A1:E1")
    ws["A1"].alignment = CENTER

    ws["F2"] = "문서번호"
    ws["G2"] = spec.get("docNo", "")
    ws["F3"] = "발주일"
    ws["G3"] = spec.get("orderDate", "")

    issuer = spec.get("issuer", {})
    partner = spec.get("partner", {})

    ws["A3"] = "발행"
    ws["A3"].font = BOLD
    ws["B3"] = issuer.get("businessName", "")
    ws["A4"] = "사업자번호"
    ws["B4"] = issuer.get("businessNumber", "")
    ws["A5"] = "대표자"
    ws["B5"] = issuer.get("representativeName", "")
    ws["A6"] = "주소"
    ws["B6"] = issuer.get("address", "")
    ws["A7"] = "계좌"
    ws["B7"] = issuer.get("bankInfo", "")

    ws["D3"] = "수신"
    ws["D3"].font = BOLD
    ws["E3"] = partner.get("businessName") or partner.get("name", "")
    ws["D4"] = "사업자번호"
    ws["E4"] = partner.get("businessNumber", "")
    ws["D5"] = "대표자"
    ws["E5"] = partner.get("representativeName", "")
    ws["D6"] = "담당자"
    ws["E6"] = f"{partner.get('contactName', '')} {partner.get('contactEmail', '')}".strip()
    ws["D7"] = "주소"
    ws["E7"] = partner.get("address", "")

    headers = ["순번", "품목명", "규격", "수량", "단위", "단가", "합계"]
    header_row = 9
    for ci, htext in enumerate(headers, start=1):
        c = ws.cell(row=header_row, column=ci, value=htext)
        c.font = BOLD
        c.fill = HEAD_FILL
        c.alignment = CENTER
        c.border = BORDER

    r = header_row + 1
    for i, item in enumerate(spec.get("lineItems", []), start=1):
        vals = [i, item.get("itemName", ""), item.get("spec", ""), _num(item.get("quantity")),
                item.get("unit", ""), _num(item.get("unitPrice")), _num(item.get("totalPrice"))]
        for ci, v in enumerate(vals, start=1):
            c = ws.cell(row=r, column=ci, value=v)
            c.border = BORDER
            if ci in (6, 7):
                c.number_format = WON
        r += 1

    sr = r + 1
    ws.cell(row=sr, column=6, value="소계").font = BOLD
    ws.cell(row=sr, column=7, value=_num(spec.get("subtotal"))).number_format = WON
    ws.cell(row=sr + 1, column=6, value="부가세").font = BOLD
    ws.cell(row=sr + 1, column=7, value=_num(spec.get("vat"))).number_format = WON
    ws.cell(row=sr + 2, column=6, value="합계").font = BOLD
    ws.cell(row=sr + 2, column=7, value=_num(spec.get("total"))).number_format = WON

    ws.cell(row=sr, column=1, value="납품장소")
    ws.cell(row=sr, column=2, value=spec.get("deliveryPlace", ""))
    ws.cell(row=sr + 1, column=1, value="비고")
    ws.cell(row=sr + 1, column=2, value=spec.get("note", ""))

    widths = [6, 26, 16, 8, 8, 12, 14]
    for ci, w in enumerate(widths, start=1):
        ws.column_dimensions[ws.cell(row=header_row, column=ci).column_letter].width = w


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True)
    ap.add_argument("--output", required=True)
    args = ap.parse_args()

    with open(args.input, encoding="utf-8") as f:
        spec = json.load(f)

    wb = Workbook()
    ws = wb.active
    build_purchase_order(ws, spec)
    wb.save(args.output)
    print(json.dumps({"ok": True, "lineCount": len(spec.get("lineItems", []))}))


if __name__ == "__main__":
    main()
```

- [ ] **Step 2: Verify the script runs standalone**

```bash
cat > /tmp/po-spec.json <<'EOF'
{
  "docNo": "PO-20260928-001",
  "orderDate": "2026-09-28",
  "issuer": {"businessName": "주식회사 우프컴퍼니", "businessNumber": "314-87-00725",
             "representativeName": "이교영", "address": "", "bankInfo": "KB국민은행 802-21-0429-353"},
  "partner": {"name": "테스트공장", "businessName": "테스트상사"},
  "lineItems": [{"itemName": "테스트원단", "spec": "", "quantity": 10, "unit": "Roll",
                 "unitPrice": 10000, "totalPrice": 100000}],
  "deliveryPlace": "", "subtotal": 100000, "vat": 10000, "total": 110000, "note": ""
}
EOF
python3 scripts/purchase_order_excel.py --input /tmp/po-spec.json --output /tmp/po-test.xlsx
```
Expected: prints `{"ok": true, "lineCount": 1}` and `/tmp/po-test.xlsx` exists. Open it (or `python3 -c "from openpyxl import load_workbook; wb = load_workbook('/tmp/po-test.xlsx'); print(wb.active['A1'].value, wb.active['G2'].value)"`) to confirm `발  주  서` and `PO-20260928-001` are present.

- [ ] **Step 3: Wire it up in `server.js`**

Add the script path constant right after `server.js:23`:
```js
const SETTLEMENT_SCRIPT = path.join(__dirname, "scripts", "settlement_excel.py");
const PURCHASE_ORDER_SCRIPT = path.join(__dirname, "scripts", "purchase_order_excel.py");
```

Add the company-info constant and generator function immediately after `generateSettlementXlsx` (`server.js:3766-3781`):
```js
// 발주서 발행자(우리 회사) 고정 정보 — 거래처마다 바뀌는 값이 아니라 상수로 둔다.
// 발행 법인이 여러 개로 늘어나면 그때 설정 화면으로 옮긴다.
const COMPANY_INFO = {
  businessName: "주식회사 우프컴퍼니",
  businessNumber: "314-87-00725",
  representativeName: "이교영",
  address: "",
  bankInfo: "KB국민은행 802-21-0429-353"
};

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

Add the route (same "before the final 404" location used in Tasks 2-4):
```js
  const poExcelMatch = pathname.match(/^\/api\/purchase-orders\/([^/]+)\/excel$/);
  if (poExcelMatch && method === "GET") {
    const po = db.purchaseOrders.find((item) => item.id === poExcelMatch[1]);
    if (!po) {
      sendJson(res, 404, { error: "발주서를 찾을 수 없습니다." });
      return;
    }
    const partner = db.partners.find((item) => item.id === po.partnerId);
    const spec = {
      docNo: po.docNo,
      orderDate: po.orderDate,
      issuer: COMPANY_INFO,
      partner: partner
        ? {
            name: partner.name,
            businessName: partner.businessName,
            businessNumber: partner.businessNumber,
            representativeName: partner.representativeName,
            address: partner.address,
            contactName: partner.contactName,
            contactEmail: partner.contactEmail
          }
        : {},
      lineItems: po.lineItems,
      deliveryPlace: po.deliveryPlace,
      subtotal: po.subtotal,
      vat: po.vat,
      total: po.total,
      note: po.note
    };
    try {
      const buffer = await generatePurchaseOrderXlsx(spec);
      sendBuffer(res, 200, buffer,
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        { "content-disposition": contentDisposition(`발주서_${po.docNo}.xlsx`) });
    } catch (error) {
      sendJson(res, 500, { error: `발주서 생성 실패: ${error.message}` });
    }
    return;
  }

```

- [ ] **Step 4: Syntax check**

Run: `node --check server.js` — expect no output.

- [ ] **Step 5: End-to-end smoke test against a scratch DB**

Reuse the scratch-DB server from Task 4 (partner + purchase order already created), then:
```bash
PO_ID="<id from the /api/purchase-orders POST response in Task 4 Step 4>"
curl -s -H "Cookie: wooofpay_session=$SESSION" http://localhost:4700/api/purchase-orders/$PO_ID/excel -o /tmp/po-download.xlsx
file /tmp/po-download.xlsx
```
Expected: `file` reports `Microsoft Excel 2007+` (a valid xlsx), not an error JSON.

- [ ] **Step 6: Commit**

```bash
git add server.js scripts/purchase_order_excel.py
git commit -m "feat(procurement): generate purchase order excel via openpyxl"
```

---

## Task 6: 클라이언트 — 거래관리 탭 셸 + 거래처관리 화면

**Files:**
- Modify: `public/app.js` — state, `loadAll()`, nav tabs array, tab-dispatch (`renderCurrentTab`/bind-dispatch), and new `renderProcurement`/`bindProcurement`/`renderPartners`/`renderPartnerForm`/`bindPartners` functions.

**Interfaces:**
- Consumes: `api(path, options)`, `h()`, `formObject(form)`, `refreshAndRender()`, `money.format()`, `can(key, action)` — all pre-existing.
- Produces: `state.procurement` (`{ screen, editingPartner, editingMaterial, editingPurchaseOrder, partnerFilterCategory }`), `state.partners`, `PARTNER_CATEGORY_LABELS`, `PROCUREMENT_SCREENS`, `filteredPartners()`, `productionPartners()` (used again in Tasks 7-8), `renderProcurement()`, `bindProcurement()`.

- [ ] **Step 1: Add `state.procurement` next to the existing `npb` state block**

Find (around line 59, the start of the `npb: { ... }` block) and add a sibling key right after the `npb: { ... }` block closes (after the line `};` that ends the whole `state` object is too late — add it as a new top-level key inside `state`, e.g. immediately before the closing `};` of the `state` object, right after the `npb` block's closing `},`):
```js
  procurement: {
    screen: "partners",
    editingPartner: null,
    editingMaterial: null,
    editingPurchaseOrder: null,
    partnerFilterCategory: ""
  }
```
(This becomes the last key in `state`, so it has no trailing comma; remove the trailing comma from whatever was previously last — check the current file for the exact preceding line before editing.)

- [ ] **Step 2: Add `PROCUREMENT_SCREENS` and category/status label maps next to `NPB_SCREENS`**

Find `const NPB_SCREENS = [` (around line 91) and add before it:
```js
const PARTNER_CATEGORY_LABELS = { production: "생산업체", sales: "판매납품처", purchase: "매입공급처" };
const PO_STATUS_LABELS = { ordered: "발주", in_production: "생산중", received: "입고완료", cancelled: "취소" };
const PROCUREMENT_SCREENS = [
  ["partners", "거래처관리"],
  ["materials", "원부자재관리"],
  ["orders", "명세서 발행"]
];

```

- [ ] **Step 3: Add `partners`/`materials`/`purchaseOrders` to `loadAll()`**

Find (`public/app.js:486-507`):
```js
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
```
Change to:
```js
  const [dashboard, brands, requests, priceEntries, priceAliases, promotionRules, paymentLogs, admins, menus, partners, materials, purchaseOrders] = await Promise.all([
    api("/api/dashboard"),
    api("/api/brands"),
    api("/api/requests"),
    api("/api/price-entries"),
    api("/api/price-aliases"),
    api("/api/promotion-rules"),
    api("/api/payment-logs"),
    api("/api/admins"),
    api("/api/menus"),
    api("/api/partners"),
    api("/api/materials"),
    api("/api/purchase-orders")
  ]);
```
And add these lines right after `state.admins = admins.admins;`:
```js
  state.partners = partners.partners;
  state.materials = materials.materials;
  state.purchaseOrders = purchaseOrders.purchaseOrders;
```

- [ ] **Step 4: Register the nav tab**

Find (`public/app.js:597-610`):
```js
  const tabs = [
    ["dashboard", "대시보드"],
    ["requests", "입금요청"],
    ["prices", "단가표"],
    ["brands", "브랜드"],
    ["admins", "관리자"],
    ["audits", "이력"],
    ["archive", "아카이브"],
    ["pipeline", "주문매칭"],
    ["settlement", "정산"],
    ["npb", "npb정산"]
  ].filter(([key]) => can(key, "view") || (key === "pipeline" && can("reconcile", "view")));
```
Change to (insert `["procurement", "거래관리"]` after `["brands", "브랜드"]`):
```js
  const tabs = [
    ["dashboard", "대시보드"],
    ["requests", "입금요청"],
    ["prices", "단가표"],
    ["brands", "브랜드"],
    ["procurement", "거래관리"],
    ["admins", "관리자"],
    ["audits", "이력"],
    ["archive", "아카이브"],
    ["pipeline", "주문매칭"],
    ["settlement", "정산"],
    ["npb", "npb정산"]
  ].filter(([key]) => can(key, "view") || (key === "pipeline" && can("reconcile", "view")));
```

- [ ] **Step 5: Wire the tab dispatch**

Find (`public/app.js:726-735`), add one line after the `brands` line:
```js
  if (state.tab === "brands") return renderBrands();
  if (state.tab === "procurement") return renderProcurement();
```

Find (`public/app.js:2125-2135`), add one line after the `brands` line:
```js
  if (state.tab === "brands") bindBrands();
  if (state.tab === "procurement") bindProcurement();
```

- [ ] **Step 6: Add `renderProcurement()`/`bindProcurement()` and the 거래처관리 screen**

Add these functions anywhere after `renderBrands()`/`bindBrands()` (e.g. right after `bindBrands()` ends, before `function renderPrices()` / the next unrelated function):

```js
function filteredPartners() {
  const cat = state.procurement.partnerFilterCategory;
  return (state.partners || []).filter((item) => !cat || item.category === cat);
}

function productionPartners() {
  return (state.partners || []).filter((item) => item.category === "production" && item.isActive !== false);
}

function renderProcurement() {
  const p = state.procurement;
  const subnav = PROCUREMENT_SCREENS
    .map(([key, label]) => `<button data-procurement-screen="${key}" class="npb-subtab ${p.screen === key ? "active" : ""}">${label}</button>`)
    .join("");
  let body = "";
  if (p.screen === "materials") body = renderMaterials();
  else if (p.screen === "orders") body = renderPurchaseOrders();
  else body = renderPartners();
  return `
    ${pageHead("거래관리", "생산업체·판매납품처·매입공급처 거래처와 발주서를 관리합니다.")}
    <div class="npb-subnav">${subnav}</div>
    ${body}
  `;
}

function bindProcurement() {
  app.querySelectorAll("[data-procurement-screen]").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.procurement.screen = btn.dataset.procurementScreen;
      renderApp();
    });
  });
  if (state.procurement.screen === "materials") bindMaterials();
  else if (state.procurement.screen === "orders") bindPurchaseOrders();
  else bindPartners();
}

function renderPartners() {
  const rows = filteredPartners();
  return `
    <section class="layout">
      <div class="panel">
        <div class="panel-head"><h2>거래처 목록</h2><span class="muted">${money.format(rows.length)}개</span></div>
        <div class="panel-body" style="padding-bottom:0">
          <select data-partner-filter-category>
            <option value="">전체 분류</option>
            ${Object.entries(PARTNER_CATEGORY_LABELS).map(([key, label]) => `<option value="${key}" ${state.procurement.partnerFilterCategory === key ? "selected" : ""}>${label}</option>`).join("")}
          </select>
          <button class="primary" data-new-partner style="margin-left:8px">새 거래처</button>
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

function renderPartnerRow(item) {
  return `
    <tr>
      <td>${h(item.name)}<br><span class="muted">${PARTNER_CATEGORY_LABELS[item.category] || item.category}</span></td>
      <td>${h(item.businessName)}</td>
      <td>${h(item.contactName)}${item.contactPhone ? ` · ${h(item.contactPhone)}` : ""}</td>
      <td>${h(item.orderMethod)}</td>
      <td>${h(item.bankName)} ${h(item.bankAccount)}</td>
      <td><div class="row-actions"><button data-edit-partner="${item.id}">수정</button><button class="danger icon-btn" data-delete-partner="${item.id}" aria-label="삭제" title="삭제">×</button></div></td>
    </tr>`;
}

function renderPartnerForm() {
  const p = state.procurement.editingPartner || {};
  return `
    <form class="form-grid" data-partner-form>
      <div class="field">
        <label>분류</label>
        <select name="category">
          ${Object.entries(PARTNER_CATEGORY_LABELS).map(([key, label]) => `<option value="${key}" ${(p.category || "production") === key ? "selected" : ""}>${label}</option>`).join("")}
        </select>
      </div>
      <div class="field"><label>거래처명</label><input name="name" value="${h(p.name)}" required></div>
      <div class="field two">
        <div><label>상호명</label><input name="businessName" value="${h(p.businessName)}"></div>
        <div><label>사업자등록번호</label><input name="businessNumber" value="${h(p.businessNumber)}"></div>
      </div>
      <div class="field"><label>대표자명</label><input name="representativeName" value="${h(p.representativeName)}"></div>
      <div class="field"><label>주소</label><input name="address" value="${h(p.address)}"></div>
      <div class="field"><label>세금계산서 발행 메일</label><input name="invoiceEmail" type="email" value="${h(p.invoiceEmail)}"></div>
      <div class="field two">
        <div><label>은행</label><input name="bankName" value="${h(p.bankName)}"></div>
        <div><label>계좌번호</label><input name="bankAccount" value="${h(p.bankAccount)}"></div>
      </div>
      <div class="field"><label>예금주명</label><input name="depositorName" value="${h(p.depositorName)}"></div>
      <div class="field two">
        <div><label>발주방식</label><input name="orderMethod" value="${h(p.orderMethod)}" placeholder="예: 메일, 개별요청"></div>
        <div><label>증빙구분(계산서 발행 시점)</label><input name="invoiceTiming" value="${h(p.invoiceTiming)}" placeholder="예: 입금 후 발행"></div>
      </div>
      <div class="field two">
        <div><label>담당자명</label><input name="contactName" value="${h(p.contactName)}"></div>
        <div><label>담당자 연락처</label><input name="contactPhone" value="${h(p.contactPhone)}"></div>
      </div>
      <div class="field"><label>담당자 이메일</label><input name="contactEmail" type="email" value="${h(p.contactEmail)}"></div>
      <div class="field"><label>메모</label><textarea name="note">${h(p.note)}</textarea></div>
      <div class="field"><label>사용 상태</label><select name="isActive"><option value="true" ${p.isActive !== false ? "selected" : ""}>Y</option><option value="false" ${p.isActive === false ? "selected" : ""}>N</option></select></div>
      <div class="toolbar">
        <button class="primary" type="submit">${p.id ? "수정 저장" : "거래처 추가"}</button>
        ${state.procurement.editingPartner ? `<button type="button" data-cancel-edit-partner>취소</button>` : ""}
      </div>
    </form>
  `;
}

function bindPartners() {
  app.querySelector("[data-partner-filter-category]")?.addEventListener("change", (event) => {
    state.procurement.partnerFilterCategory = event.target.value;
    renderApp();
  });
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
  app.querySelector("[data-partner-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = formObject(event.currentTarget);
    body.isActive = body.isActive === "true";
    const editing = state.procurement.editingPartner;
    if (editing) {
      await api(`/api/partners/${editing.id}`, { method: "PUT", body });
    } else {
      await api("/api/partners", { method: "POST", body });
    }
    state.procurement.editingPartner = null;
    await refreshAndRender();
  });
}
```

Note: `renderMaterials`/`bindMaterials` and `renderPurchaseOrders`/`bindPurchaseOrders` are referenced above but don't exist yet — that's expected and gets filled in by Tasks 7-8. `node --check` won't catch this (it's a runtime `ReferenceError` only if that branch executes), so Step 8 below explicitly only exercises the `partners` screen.

- [ ] **Step 7: Syntax check**

Run: `node --check public/app.js` — expect no output.

- [ ] **Step 8: Browser smoke test (거래처관리 screen only)**

```bash
mkdir -p /tmp/wooofpay-scratch
cp data/db.json /tmp/wooofpay-scratch/db.json
DATA_DIR=/tmp/wooofpay-scratch PORT=4700 node server.js &
sleep 2
```
Then, using the Chrome extension tools (`ToolSearch` for `mcp__claude-in-chrome__*` if not already loaded): navigate to `http://localhost:4700`, log in, click the new "거래관리" tab, confirm the 거래처관리 sub-screen renders with an empty list + form, fill in the form (분류=생산업체, 거래처명=테스트공장) and submit, confirm the row appears in the list, click 수정 and change a field, confirm it saves, click 삭제 and confirm it's removed. Watch the console (`mcp__claude-in-chrome__read_console_messages`) for errors throughout.
```bash
kill %1
rm -rf /tmp/wooofpay-scratch
```

- [ ] **Step 9: Commit**

```bash
git add public/app.js
git commit -m "feat(procurement): add 거래관리 tab shell and 거래처관리 screen"
```

---

## Task 7: 클라이언트 — 원부자재관리 화면

**Files:**
- Modify: `public/app.js` — add `renderMaterials`/`renderMaterialRow`/`renderMaterialForm`/`bindMaterials`.

**Interfaces:**
- Consumes: `productionPartners()`, `state.materials`, `state.procurement.editingMaterial` (all from Task 6).
- Produces: `renderMaterials()`, `bindMaterials()` (referenced by `renderProcurement`/`bindProcurement` from Task 6, currently undefined — this task defines them).

- [ ] **Step 1: Add the functions**

Add anywhere after `bindPartners()` from Task 6:

```js
function renderMaterials() {
  const rows = state.materials || [];
  return `
    <section class="layout">
      <div class="panel">
        <div class="panel-head"><h2>원부자재 목록</h2><span class="muted">${money.format(rows.length)}개</span></div>
        <div class="panel-body" style="padding-bottom:0">
          <button class="primary" data-new-material>새 원부자재</button>
        </div>
        <div class="table-wrap">
          <table class="materials-table">
            <thead><tr><th>품목명</th><th>카테고리</th><th>거래처</th><th>발주단위</th><th>기본단가</th><th>리드타임</th><th>작업</th></tr></thead>
            <tbody>${rows.map(renderMaterialRow).join("") || `<tr><td colspan="7" class="empty">등록된 원부자재가 없습니다.</td></tr>`}</tbody>
          </table>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>${state.procurement.editingMaterial ? "원부자재 수정" : "원부자재 입력"}</h2></div>
        <div class="panel-body">${renderMaterialForm()}</div>
      </div>
    </section>
  `;
}

function renderMaterialRow(item) {
  const partner = (state.partners || []).find((p) => p.id === item.partnerId);
  return `
    <tr>
      <td>${h(item.itemName)}</td>
      <td>${h(item.category)}</td>
      <td>${h(partner?.name || "")}</td>
      <td>${h(item.orderUnit)}</td>
      <td>${item.basePrice ? `${money.format(item.basePrice)}원` : "-"}</td>
      <td>${item.leadTimeDays ? `${item.leadTimeDays}일` : "-"}</td>
      <td><div class="row-actions"><button data-edit-material="${item.id}">수정</button><button class="danger icon-btn" data-delete-material="${item.id}" aria-label="삭제" title="삭제">×</button></div></td>
    </tr>`;
}

function renderMaterialForm() {
  const m = state.procurement.editingMaterial || {};
  return `
    <form class="form-grid" data-material-form>
      <div class="field">
        <label>거래처(생산업체)</label>
        <select name="partnerId">
          <option value="">선택 안 함</option>
          ${productionPartners().map((p) => `<option value="${p.id}" ${m.partnerId === p.id ? "selected" : ""}>${h(p.name)}</option>`).join("")}
        </select>
      </div>
      <div class="field"><label>품목명</label><input name="itemName" value="${h(m.itemName)}" required></div>
      <div class="field two">
        <div><label>카테고리</label><input name="category" value="${h(m.category)}" placeholder="예: 원단, 부자재, 포장재, 사은품"></div>
        <div><label>발주단위</label><input name="orderUnit" value="${h(m.orderUnit)}" placeholder="예: 개, Roll, box"></div>
      </div>
      <div class="field two">
        <div><label>기본단가</label><input name="basePrice" type="number" min="0" value="${h(m.basePrice || "")}"></div>
        <div><label>리드타임(일)</label><input name="leadTimeDays" type="number" min="0" value="${h(m.leadTimeDays || "")}"></div>
      </div>
      <div class="field"><label>메모</label><textarea name="note">${h(m.note)}</textarea></div>
      <div class="field"><label>사용 상태</label><select name="isActive"><option value="true" ${m.isActive !== false ? "selected" : ""}>Y</option><option value="false" ${m.isActive === false ? "selected" : ""}>N</option></select></div>
      <div class="toolbar">
        <button class="primary" type="submit">${m.id ? "수정 저장" : "원부자재 추가"}</button>
        ${state.procurement.editingMaterial ? `<button type="button" data-cancel-edit-material>취소</button>` : ""}
      </div>
    </form>
  `;
}

function bindMaterials() {
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
      await api(`/api/materials/${button.dataset.deleteMaterial}`, { method: "DELETE" });
      await refreshAndRender();
    });
  });
  app.querySelector("[data-material-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = formObject(event.currentTarget);
    body.isActive = body.isActive === "true";
    const editing = state.procurement.editingMaterial;
    if (editing) {
      await api(`/api/materials/${editing.id}`, { method: "PUT", body });
    } else {
      await api("/api/materials", { method: "POST", body });
    }
    state.procurement.editingMaterial = null;
    await refreshAndRender();
  });
}
```

- [ ] **Step 2: Syntax check**

Run: `node --check public/app.js` — expect no output.

- [ ] **Step 3: Browser smoke test (원부자재관리 screen)**

Same scratch-DB boot as Task 6 Step 8. In the browser: click the "거래관리" tab, click the "원부자재관리" sub-tab, add a material (linked to the partner created in Task 6's manual test, or create a fresh one), confirm it appears, edit and delete it. Check console for errors.

- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "feat(procurement): add 원부자재관리 screen"
```

---

## Task 8: 클라이언트 — 명세서 발행 화면 (발주서 작성/목록/엑셀)

**Files:**
- Modify: `public/app.js` — add `renderPurchaseOrders`/`renderPurchaseOrderRow`/`renderPurchaseOrderForm`/`renderPurchaseOrderLineItems`/`bindPurchaseOrders`.

**Interfaces:**
- Consumes: `productionPartners()` (Task 6), `state.materials` (Task 3/7), `cryptoRandomId()` (pre-existing, `public/app.js:3599`), `money.format`, `api`, `formObject`, `refreshAndRender`, `h`.
- Produces: `renderPurchaseOrders()`, `bindPurchaseOrders()` (referenced by `renderProcurement`/`bindProcurement` from Task 6, currently undefined — this task defines them).

- [ ] **Step 1: Add the functions**

Add anywhere after `bindMaterials()` from Task 7:

```js
function renderPurchaseOrders() {
  const rows = (state.purchaseOrders || []).slice().sort((a, b) => (b.orderDate || "").localeCompare(a.orderDate || ""));
  return `
    <section class="layout">
      <div class="panel">
        <div class="panel-head"><h2>발주서 목록</h2><span class="muted">${money.format(rows.length)}건</span></div>
        <div class="panel-body" style="padding-bottom:0">
          <button class="primary" data-new-purchase-order>새 발주서</button>
        </div>
        <div class="table-wrap">
          <table class="purchase-orders-table">
            <thead><tr><th>문서번호</th><th>거래처</th><th>발주일</th><th>상태</th><th>합계</th><th>작업</th></tr></thead>
            <tbody>${rows.map(renderPurchaseOrderRow).join("") || `<tr><td colspan="6" class="empty">등록된 발주서가 없습니다.</td></tr>`}</tbody>
          </table>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>${state.procurement.editingPurchaseOrder ? "발주서 수정" : "발주서 작성"}</h2></div>
        <div class="panel-body">${renderPurchaseOrderForm()}</div>
      </div>
    </section>
  `;
}

function renderPurchaseOrderRow(item) {
  const partner = (state.partners || []).find((p) => p.id === item.partnerId);
  return `
    <tr>
      <td>${h(item.docNo)}</td>
      <td>${h(partner?.name || "")}</td>
      <td>${h(item.orderDate)}</td>
      <td>${PO_STATUS_LABELS[item.status] || item.status}</td>
      <td>${money.format(item.total)}원</td>
      <td><div class="row-actions">
        <button data-edit-purchase-order="${item.id}">수정</button>
        <a href="/api/purchase-orders/${item.id}/excel"><button type="button">엑셀</button></a>
        <button class="danger icon-btn" data-delete-purchase-order="${item.id}" aria-label="삭제" title="삭제">×</button>
      </div></td>
    </tr>`;
}

function renderPurchaseOrderForm() {
  const po = state.procurement.editingPurchaseOrder || {};
  const lineItems = Array.isArray(po.lineItems) ? po.lineItems : [];
  return `
    <form class="form-grid" data-purchase-order-form>
      <div class="field">
        <label>거래처(생산업체)</label>
        <select name="partnerId" required>
          <option value="">거래처 선택</option>
          ${productionPartners().map((p) => `<option value="${p.id}" ${po.partnerId === p.id ? "selected" : ""}>${h(p.name)}</option>`).join("")}
        </select>
      </div>
      <div class="field two">
        <div><label>발주일</label><input name="orderDate" type="date" value="${h(po.orderDate || new Date().toISOString().slice(0, 10))}"></div>
        <div>
          <label>상태</label>
          <select name="status">
            ${Object.entries(PO_STATUS_LABELS).map(([key, label]) => `<option value="${key}" ${(po.status || "ordered") === key ? "selected" : ""}>${label}</option>`).join("")}
          </select>
        </div>
      </div>
      <div class="field"><label>납품장소</label><input name="deliveryPlace" value="${h(po.deliveryPlace)}"></div>
      <input type="hidden" name="lineItemsJson" value='${h(JSON.stringify(lineItems))}'>
      <div class="field">
        <label>품목 추가</label>
        <datalist id="po-material-options">
          ${(state.materials || []).map((m) => `<option value="${h(m.itemName)}">`).join("")}
        </datalist>
        <div class="field three">
          <div><input data-po-item-name list="po-material-options" placeholder="원부자재명 (검색 또는 신규 입력)"></div>
          <div><input data-po-item-qty type="number" min="1" value="1" placeholder="수량"></div>
          <div><input data-po-item-price type="number" min="0" placeholder="단가"></div>
        </div>
        <button type="button" data-add-po-line-item style="margin-top:8px">품목 추가</button>
      </div>
      <div data-po-line-items-table>${renderPurchaseOrderLineItems(lineItems)}</div>
      <div class="field"><label>메모</label><textarea name="note">${h(po.note)}</textarea></div>
      <div class="toolbar">
        <button class="primary" type="submit">${po.id ? "수정 저장" : "발주서 생성"}</button>
        ${state.procurement.editingPurchaseOrder ? `<button type="button" data-cancel-edit-purchase-order>취소</button>` : ""}
      </div>
    </form>
  `;
}

function renderPurchaseOrderLineItems(items) {
  if (!items.length) return `<div class="empty">추가된 품목이 없습니다.</div>`;
  return `
    <table class="line-items-table">
      <thead><tr><th>작업</th><th>품목명</th><th>규격</th><th>수량</th><th>단위</th><th>단가</th><th>합계</th></tr></thead>
      <tbody>
        ${items.map((item) => `
          <tr data-po-line-row="${item.id}">
            <td><button type="button" class="danger icon-btn" data-remove-po-line-item="${item.id}" aria-label="삭제" title="삭제">×</button></td>
            <td>${h(item.itemName)}</td>
            <td>${h(item.spec)}</td>
            <td>${h(item.quantity)}</td>
            <td>${h(item.unit)}</td>
            <td>${money.format(item.unitPrice)}</td>
            <td>${money.format(item.totalPrice)}</td>
          </tr>`).join("")}
      </tbody>
    </table>
  `;
}

function bindPurchaseOrders() {
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
      await api(`/api/purchase-orders/${button.dataset.deletePurchaseOrder}`, { method: "DELETE" });
      await refreshAndRender();
    });
  });

  const form = app.querySelector("[data-purchase-order-form]");
  if (!form) return;
  const lineItemsInput = form.querySelector("[name=lineItemsJson]");
  const lineItemsSlot = form.querySelector("[data-po-line-items-table]");
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
  const setLineItems = (items) => {
    lineItemsInput.value = JSON.stringify(items);
    lineItemsSlot.innerHTML = renderPurchaseOrderLineItems(items);
    bindPoLineItemRemovers();
  };
  bindPoLineItemRemovers();

  form.querySelector("[data-add-po-line-item]")?.addEventListener("click", async () => {
    const nameInput = form.querySelector("[data-po-item-name]");
    const qtyInput = form.querySelector("[data-po-item-qty]");
    const priceInput = form.querySelector("[data-po-item-price]");
    const name = nameInput.value.trim();
    if (!name) return;
    const material = (state.materials || []).find((m) => m.itemName.trim() === name);
    const quantity = Math.max(1, Number(qtyInput.value) || 1);
    const unitPrice = priceInput.value !== "" ? Number(priceInput.value) : Number(material?.basePrice || 0);
    const items = getLineItems();
    items.push({
      id: cryptoRandomId(),
      materialId: material?.id || "",
      itemName: name,
      spec: "",
      quantity,
      unit: material?.orderUnit || "",
      unitPrice,
      totalPrice: Math.round(quantity * unitPrice)
    });
    setLineItems(items);
    nameInput.value = "";
    qtyInput.value = "1";
    priceInput.value = "";
    nameInput.focus();
    if (!material && confirm(`"${name}" 품목을 원부자재 카탈로그에 등록할까요?`)) {
      const partnerId = form.querySelector("[name=partnerId]").value;
      const created = await api("/api/materials", {
        method: "POST",
        body: { itemName: name, orderUnit: "", basePrice: unitPrice, partnerId }
      });
      state.materials.push(created.material);
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = formObject(event.currentTarget);
    body.lineItems = getLineItems();
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
```

- [ ] **Step 2: Syntax check**

Run: `node --check public/app.js` — expect no output.

- [ ] **Step 3: Browser smoke test (명세서 발행 screen, full flow)**

Same scratch-DB boot as Tasks 6-7. In the browser: click "거래관리" → "명세서 발행", select the test partner, add one line item by typing a name that matches an existing material (confirm 단가/단위 auto-fill), add a second line item with a brand-new name (confirm the "카탈로그에 등록할까요?" `confirm()` dialog fires and, on accepting, the item shows up next time you open the datalist), remove one line item with the × button, submit the form, confirm the new 발주서 appears in the list with the correct 합계, click "엑셀" and confirm a valid `.xlsx` downloads (check via `mcp__claude-in-chrome__read_network_requests` or by inspecting the download), edit the 발주서 and change its status, delete it. Watch the console for errors throughout.

- [ ] **Step 4: Commit**

```bash
git add public/app.js
git commit -m "feat(procurement): add 명세서 발행 screen with hybrid catalog line items"
```

---

## Task 9: 스타일 — 신규 테이블 컬럼 폭 + 최종 통합 검증

**Files:**
- Modify: `public/styles.css` — append column-width rules for the three new tables.

**Interfaces:**
- Consumes: the existing `.table-wrap`/`table`/`th`/`td` base rules and the `.icon-btn`/`.npb-subnav`/`.npb-subtab` classes already defined (no new classes needed for those).

- [ ] **Step 1: Append table width rules**

Add to the end of `public/styles.css`:
```css
/* 거래처 목록 */
.partners-table th:nth-child(1), .partners-table td:nth-child(1) { min-width: 160px; }
.partners-table th:nth-child(2), .partners-table td:nth-child(2) { width: 160px; min-width: 160px; }
.partners-table th:nth-child(3), .partners-table td:nth-child(3) { width: 160px; min-width: 160px; }
.partners-table th:nth-child(4), .partners-table td:nth-child(4) { width: 110px; min-width: 110px; }
.partners-table th:nth-child(5), .partners-table td:nth-child(5) { width: 180px; min-width: 180px; }
.partners-table th:nth-child(6), .partners-table td:nth-child(6) { width: 90px; min-width: 90px; }

/* 원부자재 목록 */
.materials-table th:nth-child(1), .materials-table td:nth-child(1) { min-width: 180px; }
.materials-table th:nth-child(2), .materials-table td:nth-child(2) { width: 100px; min-width: 100px; }
.materials-table th:nth-child(3), .materials-table td:nth-child(3) { width: 140px; min-width: 140px; }
.materials-table th:nth-child(4), .materials-table td:nth-child(4) { width: 90px; min-width: 90px; }
.materials-table th:nth-child(5), .materials-table td:nth-child(5) { width: 100px; min-width: 100px; }
.materials-table th:nth-child(6), .materials-table td:nth-child(6) { width: 90px; min-width: 90px; }
.materials-table th:nth-child(7), .materials-table td:nth-child(7) { width: 90px; min-width: 90px; }

/* 발주서 목록 */
.purchase-orders-table th:nth-child(1), .purchase-orders-table td:nth-child(1) { width: 156px; min-width: 156px; }
.purchase-orders-table th:nth-child(2), .purchase-orders-table td:nth-child(2) { min-width: 160px; }
.purchase-orders-table th:nth-child(3), .purchase-orders-table td:nth-child(3) { width: 100px; min-width: 100px; }
.purchase-orders-table th:nth-child(4), .purchase-orders-table td:nth-child(4) { width: 90px; min-width: 90px; }
.purchase-orders-table th:nth-child(5), .purchase-orders-table td:nth-child(5) { width: 105px; min-width: 105px; }
.purchase-orders-table th:nth-child(6), .purchase-orders-table td:nth-child(6) { width: 170px; min-width: 170px; }
```

- [ ] **Step 2: Full end-to-end browser pass**

Boot against a fresh scratch DB copy (same pattern as Task 6 Step 8). Walk the entire flow in one pass: 거래처관리 → create a 생산업체 partner → 원부자재관리 → create a material for that partner → 명세서 발행 → create a purchase order mixing a catalog-matched line and a freeform line → download the Excel → edit the purchase order → delete the material → confirm the purchase order's existing line items are unaffected (materials are referenced by id, not deleted-cascaded) → delete the purchase order → delete the partner. Confirm no layout breakage (columns not overflowing/clipping) and no console errors at every step. Take screenshots at the key screens per this session's established verification convention.

- [ ] **Step 3: Commit**

```bash
git add public/styles.css
git commit -m "style(procurement): size new procurement table columns"
```

---

## Self-Review Notes

- **Spec coverage:** `partners` (거래처관리, category filter) ✓ Task 6; `materials` (원부자재관리, hybrid catalog) ✓ Task 3 + Task 7 + Task 8's "register to catalog" flow; `purchaseOrders` (명세서 발행, docNo, line items, 소계/부가세/합계) ✓ Task 4 + Task 8; Excel export ✓ Task 5; menu/nav registration ✓ Task 1 + Task 6. Everything in the spec's "결정 사항" and "데이터 모델" sections has a task. Spec's "스코프 밖" items (판매납품처/매입공급처 screens, NPB matching, 재고 추적, PDF) are intentionally not tasked here — they're follow-up specs per the design doc.
- **Placeholder scan:** no TBD/TODO; every step has literal code or literal shell commands, not descriptions of code.
- **Type consistency checked:** `sanitizePurchaseOrderLineItems` field names (`materialId`, `itemName`, `spec`, `quantity`, `unit`, `unitPrice`, `totalPrice`) are used identically in the server route bodies (Task 4), the client line-item renderer (Task 8's `renderPurchaseOrderLineItems`), and the client "add line item" handler (Task 8's `bindPurchaseOrders`). `docNo`/`partnerId`/`orderDate`/`status`/`deliveryPlace`/`subtotal`/`vat`/`total`/`note` are consistent between the Task 4 API and the Task 8 UI. `PARTNER_CATEGORY_LABELS`/`PO_STATUS_LABELS` keys match `partnerCategories`/`purchaseOrderStatuses` (Task 1) exactly.
