// Cafe24 Admin API client — OAuth 2.0 + order retrieval.
//
// Unlike clobe (a public PKCE client), Cafe24 issues a client_secret and
// authenticates the token endpoint with HTTP Basic, so the secret must come
// from the environment and never reach the database or the browser.
//
// Token lifetimes are short by Cafe24's design: access 2 hours, refresh
// 2 weeks. A mall left untouched for a fortnight therefore needs a human to
// reconnect — callers should surface that rather than retrying forever.

import crypto from "node:crypto";

const API_VERSION = "2026-03-01";
const REQUEST_TIMEOUT_MS = 30000;
// 없는 이름을 하나라도 섞으면 authorize 단계에서 invalid_scope 로 통째로
// 거부된다(mall.read_supply 가 실제로 그랬다). 그래서 기본은 정산에 필요한
// 읽기 하나만 요청한다.
//
// 주문 상태 쓰기(PUT /api/v2/admin/orders 의 process_status)는 앱 권한을 켜는
// 것과 별개로 토큰이 그 scope 를 들고 있어야 한다. 준비되면 환경변수로 켠다:
//   CAFE24_SCOPE=mall.read_order,mall.write_order
// 바꾼 뒤에는 기존 토큰에 새 권한이 없으므로 재연결이 필요하다.
export const CAFE24_SCOPE = String(process.env.CAFE24_SCOPE || "mall.read_order").trim();

// Cafe24 refuses date ranges of three months or more in a single call.
const MAX_RANGE_DAYS = 80;
const MAX_PAGES = 40;
const PAGE_SIZE = 500;

export function cafe24Config() {
  return {
    mallId: String(process.env.CAFE24_MALL_ID || "").trim(),
    clientId: String(process.env.CAFE24_CLIENT_ID || "").trim(),
    clientSecret: String(process.env.CAFE24_CLIENT_SECRET || "").trim()
  };
}

export function cafe24Configured() {
  const { mallId, clientId, clientSecret } = cafe24Config();
  return Boolean(mallId && clientId && clientSecret);
}

function apiBase() {
  // 시험용: 가짜 카페24 서버로 돌릴 때만 쓴다. 운영 환경에는 두지 않는다.
  const override = String(process.env.CAFE24_API_BASE || "").trim().replace(/\/$/, "");
  if (override) return override;
  const { mallId } = cafe24Config();
  if (!mallId) throw new Error("CAFE24_MALL_ID 가 설정되지 않았습니다.");
  return `https://${mallId}.cafe24api.com`;
}

export function buildAuthorizeUrl({ redirectUri, state }) {
  const { clientId } = cafe24Config();
  if (!clientId) throw new Error("CAFE24_CLIENT_ID 가 설정되지 않았습니다.");
  const url = new URL(`${apiBase()}/api/v2/oauth/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("state", state);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", CAFE24_SCOPE);
  return url.toString();
}

export function createState() {
  return crypto.randomBytes(24).toString("hex");
}

export async function exchangeCode({ code, redirectUri }) {
  return tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
}

export async function refreshTokens({ refreshToken }) {
  return tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
}

async function tokenRequest(params) {
  const { clientId, clientSecret } = cafe24Config();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const payload = await fetchJson(`${apiBase()}/api/v2/oauth/token`, {
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: new URLSearchParams(params).toString()
  });
  if (!payload.access_token) throw new Error("카페24 토큰 발급에 실패했습니다.");
  return {
    accessToken: payload.access_token,
    refreshToken: payload.refresh_token || "",
    expiresAt: normaliseExpiry(payload.expires_at, ACCESS_TOKEN_LIFETIME_MS),
    refreshTokenExpiresAt: payload.refresh_token_expires_at
      ? normaliseExpiry(payload.refresh_token_expires_at, REFRESH_TOKEN_LIFETIME_MS)
      : "",
    mallId: payload.mall_id || cafe24Config().mallId
  };
}

const ACCESS_TOKEN_LIFETIME_MS = 2 * 60 * 60 * 1000;
const REFRESH_TOKEN_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;

// 앱의 타임존 설정과 맞춰야 한다. 개발자센터에서 Asia/Seoul 로 두었다.
const CAFE24_UTC_OFFSET = String(process.env.CAFE24_UTC_OFFSET || "+09:00").trim();

// Cafe24 reports expiry as wall-clock in the app's configured timezone with no
// offset ("2026-08-05T10:16:44.000"). Read on a UTC server that lands nine
// hours late, so a dead token looks alive, never refreshes, and every call
// comes back invalid_token.
//
// Two defences: attach the offset when none is given, and never trust the
// result beyond the lifetime the token actually has. Taking the earlier of the
// two means a wrong clock can only shorten validity, never extend it.
function normaliseExpiry(value, lifetimeMs) {
  const conservative = Date.now() + lifetimeMs;
  const text = String(value || "").trim();
  if (!text) return new Date(conservative).toISOString();
  const hasOffset = /([zZ]|[+-]\d{2}:?\d{2})$/.test(text);
  const parsed = new Date(hasOffset ? text : `${text.replace(" ", "T")}${CAFE24_UTC_OFFSET}`);
  if (Number.isNaN(parsed.getTime())) return new Date(conservative).toISOString();
  return new Date(Math.min(parsed.getTime(), conservative)).toISOString();
}

export async function apiGet(accessToken, path, params = {}) {
  const url = new URL(`${apiBase()}${path}`);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return fetchJson(url.toString(), {
    method: "GET",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      "X-Cafe24-Api-Version": API_VERSION
    }
  });
}

// Splits a range into chunks Cafe24 will accept and pages through each. Returns
// raw order objects with their items embedded, newest call order preserved.
export async function fetchOrders(
  accessToken,
  { startDate, endDate, dateType = "order_date", supplierId = "", shopNos = [1] }
) {
  const chunks = splitRange(startDate, endDate);
  // 멀티쇼핑몰: shop_no를 빼면 카페24는 1번 쇼핑몰 주문만 돌려준다. 2번 이후
  // 쇼핑몰 주문이 조용히 빠지므로, 쓰는 쇼핑몰을 모두 돌면서 가져온다.
  const shops = (Array.isArray(shopNos) && shopNos.length ? shopNos : [1])
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n > 0);
  const orders = [];
  for (const shopNo of shops) {
    for (const chunk of chunks) {
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const payload = await apiGet(accessToken, "/api/v2/admin/orders", {
          shop_no: shopNo,
          start_date: chunk.startDate,
          end_date: chunk.endDate,
          date_type: dateType,
          supplier_id: supplierId,
          embed: "items",
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE
        });
        const batch = payload.orders || [];
        // 어느 쇼핑몰에서 온 주문인지는 뒤에서 구분할 일이 생기므로 남겨둔다.
        for (const order of batch) {
          if (order.shop_no === undefined) order.shop_no = shopNo;
        }
        orders.push(...batch);
        if (batch.length < PAGE_SIZE) break;
      }
    }
  }
  return orders;
}

// 멀티쇼핑몰 목록. 설정 화면에서 "몇 번이 무슨 몰인지" 보여주기 위한 것으로,
// 수집 자체는 저장된 번호만 쓴다.
export async function fetchShops(accessToken) {
  const payload = await apiGet(accessToken, "/api/v2/admin/shops", {});
  return (payload.shops || []).map((shop) => ({
    shopNo: Number(shop.shop_no),
    shopName: String(shop.shop_name || ""),
    businessCountryCode: String(shop.business_country_code || ""),
    active: shop.active !== "F" && shop.active !== false
  }));
}

function splitRange(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("조회 기간이 올바르지 않습니다 (yyyy-MM-dd).");
  }
  const chunks = [];
  let cursor = start;
  while (cursor <= end) {
    const chunkEnd = new Date(cursor);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + MAX_RANGE_DAYS - 1);
    chunks.push({
      startDate: cursor.toISOString().slice(0, 10),
      endDate: (chunkEnd > end ? end : chunkEnd).toISOString().slice(0, 10)
    });
    cursor = new Date(chunkEnd);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return chunks;
}

// 카페24 호출 제한은 몰 단위 leaky bucket 이다. 상품 동기화처럼 여러 번 연달아
// 쓰는 작업은 버킷이 차면 429 를 받는다 — 잠깐 쉬었다가 다시 보낸다.
const RATE_LIMIT_RETRIES = 4;

async function fetchJson(url, options, attempt = 0) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options?.timeoutMs || REQUEST_TIMEOUT_MS);
  let response;
  try {
    const { timeoutMs, ...fetchOptions } = options || {};
    response = await fetch(url, { ...fetchOptions, signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") throw new Error("카페24 응답이 지연됩니다. 잠시 후 다시 시도하세요.");
    throw new Error(`카페24에 연결하지 못했습니다: ${error.message}`);
  } finally {
    clearTimeout(timer);
  }
  if (response.status === 429 && attempt < RATE_LIMIT_RETRIES) {
    const wait = Number(response.headers.get("retry-after")) * 1000 || 1500 * (attempt + 1);
    await new Promise((resolve) => setTimeout(resolve, wait));
    return fetchJson(url, options, attempt + 1);
  }
  // 버킷이 거의 찼으면 다음 호출 전에 조금 쉰다 ("12/40" 형식).
  const callLimit = String(response.headers.get("x-api-call-limit") || "");
  const [used, size] = callLimit.split("/").map(Number);
  if (used && size && used >= size - 5) await new Promise((resolve) => setTimeout(resolve, 1000));

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`카페24 응답을 해석하지 못했습니다 (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    const detail = data?.error?.message || data?.error_description || data?.error || `HTTP ${response.status}`;
    // 상품 권한(mall.read_product / mall.write_product)이 없는 토큰으로 상품 API 를
    // 부르면 403 이 온다. 무엇을 해야 하는지 바로 알 수 있게 덧붙인다.
    const scopeHint = response.status === 403 && /scope|permission|권한/i.test(String(detail))
      ? " — 카페24 앱 권한에 상품 읽기/쓰기를 켜고, CAFE24_SCOPE 에 mall.read_product,mall.write_product 를 추가한 뒤 다시 연결하세요."
      : "";
    const error = new Error(`카페24 요청 실패: ${typeof detail === "string" ? detail : JSON.stringify(detail)}${scopeHint}`);
    error.status = response.status;
    // 401 means the token is dead; the refresh token may be gone too, in which
    // case only a fresh human authorisation can recover it.
    error.needsReauth = response.status === 401;
    throw error;
  }
  return data;
}

// --- 상품 (공급사 상품 동기화) ----------------------------------------------
//
// 필요한 권한: mall.read_product, mall.write_product. 기존 주문 권한과 함께
// CAFE24_SCOPE 에 나열한다(예: mall.read_order,mall.read_product,mall.write_product).
// 상품 등록·수정은 1번 쇼핑몰(본점) 기준이다.

const PRODUCT_SHOP_NO = 1;

async function apiSend(accessToken, method, path, body, { timeoutMs } = {}) {
  return fetchJson(`${apiBase()}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      "X-Cafe24-Api-Version": API_VERSION
    },
    body: JSON.stringify(body),
    timeoutMs
  });
}

// 상품번호 여러 개를 품목(variants)까지 한 번에. 100개씩 끊어 부른다.
export async function fetchProductsWithVariants(accessToken, productNos) {
  const nos = [...new Set((productNos || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  const products = [];
  for (let i = 0; i < nos.length; i += 100) {
    const chunk = nos.slice(i, i + 100);
    const payload = await apiGet(accessToken, "/api/v2/admin/products", {
      shop_no: PRODUCT_SHOP_NO,
      product_no: chunk.join(","),
      embed: "variants",
      limit: 100
    });
    products.push(...(payload.products || []));
  }
  // 목록 조회에 품목이 안 딸려 오는 경우를 대비해 빠진 것만 따로 받는다.
  for (const product of products) {
    if (Array.isArray(product.variants)) continue;
    const payload = await apiGet(accessToken, `/api/v2/admin/products/${product.product_no}/variants`, {
      shop_no: PRODUCT_SHOP_NO
    });
    product.variants = payload.variants || [];
  }
  return products;
}

export async function fetchProduct(accessToken, productNo) {
  const payload = await apiGet(accessToken, `/api/v2/admin/products/${Number(productNo)}`, {
    shop_no: PRODUCT_SHOP_NO,
    embed: "variants"
  });
  return payload.product || null;
}

// 상품명으로 우프 상품 찾기 (연결표 화면의 검색용).
export async function searchProducts(accessToken, { productName = "", supplierCode = "", limit = 50 } = {}) {
  const payload = await apiGet(accessToken, "/api/v2/admin/products", {
    shop_no: PRODUCT_SHOP_NO,
    product_name: productName,
    supplier_code: supplierCode,
    limit: Math.min(100, Math.max(1, limit))
  });
  return payload.products || [];
}

// 품목 여러 개의 재고·판매상태·추가금을 한 번에 (상품당 최대 100품목).
export async function updateVariants(accessToken, productNo, patches) {
  if (!patches?.length) return [];
  const payload = await apiSend(accessToken, "PUT", `/api/v2/admin/products/${Number(productNo)}/variants`, {
    shop_no: PRODUCT_SHOP_NO,
    requests: patches
  });
  return payload.variants || [];
}

export async function updateProduct(accessToken, productNo, request) {
  const payload = await apiSend(accessToken, "PUT", `/api/v2/admin/products/${Number(productNo)}`, {
    shop_no: PRODUCT_SHOP_NO,
    request
  });
  return payload.product || null;
}

// 상세설명용 이미지 업로드. base64(접두어 없이)를 받아 우프 쪽 주소를 돌려준다.
// 한 번에 최대 20장이지만 이미지가 커서 요청 크기를 줄이려고 몇 장씩 나눠 보낸다.
export async function uploadEditorImages(accessToken, base64Images) {
  const paths = [];
  const MAX_BATCH_BYTES = 12 * 1024 * 1024;
  let batch = [];
  let batchBytes = 0;
  const flush = async () => {
    if (!batch.length) return;
    const payload = await apiSend(accessToken, "POST", "/api/v2/admin/products/images", {
      requests: batch.map((image) => ({ image }))
    }, { timeoutMs: 120000 });
    // 응답은 {"images":[{"path":...}]} 형태다(문서 예시는 안쪽 배열만 보여 준다).
    const images = Array.isArray(payload) ? payload : (Array.isArray(payload.images) ? payload.images : []);
    if (images.length !== batch.length) {
      throw new Error(`상세이미지 업로드 결과가 맞지 않습니다 (보낸 ${batch.length}장, 받은 ${images.length}장).`);
    }
    for (const item of images) paths.push(item.path);
    batch = [];
    batchBytes = 0;
  };
  for (const image of base64Images) {
    if (batch.length >= 10 || batchBytes + image.length > MAX_BATCH_BYTES) await flush();
    batch.push(image);
    batchBytes += image.length;
  }
  await flush();
  return paths;
}

export async function createProduct(accessToken, request) {
  const payload = await apiSend(accessToken, "POST", "/api/v2/admin/products", {
    shop_no: PRODUCT_SHOP_NO,
    request
  }, { timeoutMs: 60000 });
  return payload.product || null;
}

// 대표이미지 — 대표이미지 등록(A)으로 올리면 목록·축소 이미지도 카페24가 만든다.
export async function uploadMainImage(accessToken, productNo, dataUri) {
  const payload = await apiSend(accessToken, "POST", `/api/v2/admin/products/${Number(productNo)}/images`, {
    shop_no: PRODUCT_SHOP_NO,
    request: { image_upload_type: "A", detail_image: dataUri }
  }, { timeoutMs: 120000 });
  return payload.image || payload.images || null;
}

// 추가이미지 — 한 호출 30MB, 최대 20장.
export async function addAdditionalImages(accessToken, productNo, dataUris) {
  if (!dataUris?.length) return null;
  const MAX_CALL_BYTES = 25 * 1024 * 1024;
  let last = null;
  let batch = [];
  let bytes = 0;
  const flush = async () => {
    if (!batch.length) return;
    const payload = await apiSend(accessToken, "POST", `/api/v2/admin/products/${Number(productNo)}/additionalimages`, {
      shop_no: PRODUCT_SHOP_NO,
      request: { additional_image: batch }
    }, { timeoutMs: 120000 });
    last = payload.additionalimage || payload;
    batch = [];
    bytes = 0;
  };
  for (const uri of dataUris.slice(0, 20)) {
    if (bytes + uri.length > MAX_CALL_BYTES) await flush();
    batch.push(uri);
    bytes += uri.length;
  }
  await flush();
  return last;
}
