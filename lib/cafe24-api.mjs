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
export const CAFE24_SCOPE = "mall.read_order,mall.read_product,mall.read_supply,mall.read_store";

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
    // Cafe24 returns absolute expiry timestamps rather than a duration.
    expiresAt: payload.expires_at || new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
    refreshTokenExpiresAt: payload.refresh_token_expires_at || "",
    mallId: payload.mall_id || cafe24Config().mallId
  };
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
export async function fetchOrders(accessToken, { startDate, endDate, dateType = "order_date", supplierId = "" }) {
  const chunks = splitRange(startDate, endDate);
  const orders = [];
  for (const chunk of chunks) {
    for (let page = 0; page < MAX_PAGES; page += 1) {
      const payload = await apiGet(accessToken, "/api/v2/admin/orders", {
        start_date: chunk.startDate,
        end_date: chunk.endDate,
        date_type: dateType,
        supplier_id: supplierId,
        embed: "items",
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE
      });
      const batch = payload.orders || [];
      orders.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }
  }
  return orders;
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
