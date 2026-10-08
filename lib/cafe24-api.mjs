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

async function fetchJson(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") throw new Error("카페24 응답이 지연됩니다. 잠시 후 다시 시도하세요.");
    throw new Error(`카페24에 연결하지 못했습니다: ${error.message}`);
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`카페24 응답을 해석하지 못했습니다 (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    const detail = data?.error?.message || data?.error_description || data?.error || `HTTP ${response.status}`;
    const error = new Error(`카페24 요청 실패: ${detail}`);
    error.status = response.status;
    // 401 means the token is dead; the refresh token may be gone too, in which
    // case only a fresh human authorisation can recover it.
    error.needsReauth = response.status === 401;
    throw error;
  }
  return data;
}
