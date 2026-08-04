// Minimal MCP client for the clobe.ai remote server.
//
// Two things make this much smaller than a general MCP client:
//   1. The server is stateless — it answers tools/call without ever issuing an
//      Mcp-Session-Id, so there is no session to open, keep alive, or tear down.
//   2. It replies with plain application/json, not text/event-stream, so no SSE
//      framing has to be parsed.
// Verified against api.clobe.ai on 2026-08-04 (protocolVersion 2025-06-18).
//
// Auth is OAuth 2.1 with Dynamic Client Registration + PKCE. clobe issues no
// client_credentials grant, so access is always delegated from a real user and
// stays alive through the refresh token — see refreshTokens() callers.

import crypto from "node:crypto";

export const CLOBE_MCP_URL = "https://api.clobe.ai/mcp";
export const CLOBE_ISSUER = "https://api.clobe.ai";
const PROTOCOL_VERSION = "2025-06-18";
const OAUTH_SCOPE = "mcp offline_access";
const REQUEST_TIMEOUT_MS = 30000;

// Read-only allowlist. The clobe server also exposes mutating tools
// (update_journal_entry_line, bulk_label_transactions, create_payroll_row, …)
// that WooofPay has no business calling — a bug here must never be able to
// rewrite the books, so the guard lives at the transport, not the caller.
const ALLOWED_TOOLS = new Set([
  "get_my_context",
  "get_bank_accounts",
  "get_labeled_transactions",
  "get_tax_invoices",
  "get_scraping_status",
  "get_monthly_revenue"
]);

let cachedMetadata = null;

export async function discoverMetadata() {
  if (cachedMetadata) return cachedMetadata;
  const response = await fetchJson(`${CLOBE_ISSUER}/.well-known/oauth-authorization-server`, {
    method: "GET"
  });
  if (!response.authorization_endpoint || !response.token_endpoint) {
    throw new Error("클로브 OAuth 메타데이터를 읽지 못했습니다.");
  }
  cachedMetadata = response;
  return cachedMetadata;
}

// Registers WooofPay itself as an OAuth client. Re-run whenever the redirect
// URI changes (deploy moves to a new host), since it is bound at registration.
export async function registerClient(redirectUri) {
  const metadata = await discoverMetadata();
  const endpoint = metadata.registration_endpoint || `${CLOBE_ISSUER}/oauth/register`;
  const registration = await fetchJson(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      client_name: "WooofPay 입금대사",
      redirect_uris: [redirectUri],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: OAUTH_SCOPE
    })
  });
  if (!registration.client_id) throw new Error("클로브 클라이언트 등록에 실패했습니다.");
  return { clientId: registration.client_id, redirectUri };
}

export function createPkcePair() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export async function buildAuthorizeUrl({ clientId, redirectUri, challenge, state }) {
  const metadata = await discoverMetadata();
  const url = new URL(metadata.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", OAUTH_SCOPE);
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  // RFC 8707 — binds the issued token to this specific MCP resource.
  url.searchParams.set("resource", CLOBE_MCP_URL);
  return url.toString();
}

export async function exchangeCode({ clientId, redirectUri, code, verifier }) {
  return tokenRequest({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: clientId,
    code_verifier: verifier,
    resource: CLOBE_MCP_URL
  });
}

export async function refreshTokens({ clientId, refreshToken }) {
  return tokenRequest({
    grant_type: "refresh_token",
    refresh_token: refreshToken,
    client_id: clientId,
    resource: CLOBE_MCP_URL
  });
}

async function tokenRequest(params) {
  const metadata = await discoverMetadata();
  const payload = await fetchJson(metadata.token_endpoint, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params).toString()
  });
  if (!payload.access_token) throw new Error("클로브 토큰 발급에 실패했습니다.");
  const lifetime = Number(payload.expires_in || 3600);
  return {
    accessToken: payload.access_token,
    // A refresh response may legally omit refresh_token; keep the existing one.
    refreshToken: payload.refresh_token || "",
    expiresAt: new Date(Date.now() + lifetime * 1000).toISOString()
  };
}

// Calls one clobe MCP tool and unwraps the JSON payload it embeds in
// result.content[0].text. Throws on both transport errors and tool-level
// isError responses so callers only deal with successful data.
export async function callTool(accessToken, name, input) {
  if (!ALLOWED_TOOLS.has(name)) {
    throw new Error(`허용되지 않은 클로브 도구입니다: ${name}`);
  }
  const payload = await fetchJson(CLOBE_MCP_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "mcp-protocol-version": PROTOCOL_VERSION
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: crypto.randomUUID(),
      method: "tools/call",
      params: { name, arguments: { input } }
    })
  });

  if (payload.error) {
    const error = new Error(payload.error.message || "클로브 요청이 거부되었습니다.");
    error.code = payload.error.code;
    throw error;
  }
  const result = payload.result || {};
  const textBlock = (result.content || []).find((block) => block?.type === "text");
  if (result.isError) {
    throw new Error(textBlock?.text || "클로브 도구 호출이 실패했습니다.");
  }
  if (!textBlock) return result.structuredContent || {};
  try {
    return JSON.parse(textBlock.text);
  } catch {
    return { text: textBlock.text };
  }
}

async function fetchJson(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error.name === "AbortError") throw new Error("클로브 서버 응답이 지연됩니다. 잠시 후 다시 시도하세요.");
    throw new Error(`클로브 서버에 연결하지 못했습니다: ${error.message}`);
  } finally {
    clearTimeout(timer);
  }

  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`클로브 응답을 해석하지 못했습니다 (HTTP ${response.status}).`);
  }
  if (!response.ok) {
    const error = new Error(data?.message || data?.error_description || data?.error || `클로브 요청 실패 (HTTP ${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return data;
}

// AES-256-GCM at rest for the refresh token. The DB already holds sensitive
// business data, but a long-lived banking credential deserves a second lock —
// without CLOBE_TOKEN_SECRET set we store plaintext and say so at connect time.
// TOKEN_SECRET is the forward-looking name — these helpers now also seal the
// Cafe24 tokens. CLOBE_TOKEN_SECRET stays supported so tokens already sealed
// with it keep opening.
const TOKEN_SECRET = String(process.env.TOKEN_SECRET || process.env.CLOBE_TOKEN_SECRET || "").trim();

export function tokenEncryptionEnabled() {
  return Boolean(TOKEN_SECRET);
}

export function sealSecret(value) {
  if (!value) return "";
  if (!TOKEN_SECRET) return value;
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(TOKEN_SECRET, salt, 32);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${salt.toString("base64url")}:${iv.toString("base64url")}:${tag.toString("base64url")}:${encrypted.toString("base64url")}`;
}

export function openSecret(value) {
  if (!value) return "";
  if (!String(value).startsWith("v1:")) return value;
  if (!TOKEN_SECRET) throw new Error("CLOBE_TOKEN_SECRET 이 설정되어야 저장된 클로브 토큰을 복호화할 수 있습니다.");
  const [, saltPart, ivPart, tagPart, dataPart] = String(value).split(":");
  const key = crypto.scryptSync(TOKEN_SECRET, Buffer.from(saltPart, "base64url"), 32);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivPart, "base64url"));
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(dataPart, "base64url")), decipher.final()]).toString("utf8");
}
