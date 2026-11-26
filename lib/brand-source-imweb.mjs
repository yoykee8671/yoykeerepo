// 공급사(브랜드) 공식몰 수집기 — 아임웹으로 만든 브랜드몰 전용 (첫 대상: 앤블랭크).
//
// 카페24 수집기(brand-source-cafe24.mjs)와 같은 모양의 함수를 내보낸다
// (listBrand / fetchProduct / fetchProducts / fetchBinary). 서비스는 공급사 설정의
// platform 값으로 둘 중 하나를 고른다 — 비교·반영·등록 로직은 그대로 같이 쓴다.
//
// 아임웹 화면이 데이터를 담는 곳 (andblank.com 실측, 2026-10-20)
//   - 상품 목록: /sitemap.xml 의 /shop_view/{번호} (판매 중인 상품 전부, 목록 화면의
//     "더보기"는 위젯 코드가 필요해서 쓰지 않는다)
//   - 상품 상세 /shop_view/?idx=N
//       · SITE_SHOP_DETAIL.initDetail({...}) : prod_price(정가), is_soldout(상품 전체 품절),
//         prod_edit_time, prod_type
//       · JSON-LD Product : name, image(정사각 썸네일 — 경로에 업로드 날짜)
//       · .real_price : 할인가
//       · #prod_image_list .item img : 원본 상품 이미지(3:4 등 원래 비율)
//       · <template id="prodDetailPC"> : 상세설명 HTML. 맨 앞 회원가입·카카오 배너는
//         링크(<a>)로 감싸져 있어서 링크 안 이미지는 뺀다.
//   - 옵션 POST /shop/load_option.cm (type=prod&prod_idx=N) → option_html
//       · 옵션 그룹마다 .option_title("사이즈 *")과 .dropdown-item
//       · 값마다 onclick="SITE_SHOP_DETAIL.selectRequireOption('prod', N, '옵션코드', '값코드', '값이름', ...)"
//       · 품절 값은 글자에 "(품절)"이 붙는다. 보이는 금액은 할인 적용가.
//       · 조합형(색상×사이즈)은 첫 그룹만 채워져 오고, 첫 값을 고른 상태로 다시
//         부르면(selected_require_options[...]) 다음 그룹이 채워져 온다.
//   - 옵션 정가 POST /shop/select_option.cm → selected_option.price(정가+추가금),
//     prod_price(정가). 추가금 = 둘의 차이. 보이는 금액이 같은 옵션은 추가금도 같아서
//     금액 종류마다 한 번만 부른다.
//
// 이 파일은 남의 사이트를 읽기만 한다. 주문·장바구니 관련 주소는 부르지 않는다.
// (로그인은 예외: 회원가가 로그인해야 보이는 사이트 — 테일릿 — 를 읽으려고 로그인만 한다.)

// 아임웹은 짧은 시간에 요청이 몰리면 IP를 잠시 "접근 제한"으로 막는다(2026-10-20 운영에서 확인:
// 신상품 찾기 도중 막힘). 그래서 한 번에 하나씩, 사람 속도에 가깝게 읽는다.
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const REQUEST_TIMEOUT_MS = 20000;
const DETAIL_CONCURRENCY = 1;
const DETAIL_GAP_MS = 1500;
const OPTION_GAP_MS = 600;
// 막혔을 때 한 번 쉬었다가 다시 해 본다. 그래도 막히면 그때까지 읽은 것만 저장하고 멈춘다.
const BLOCK_COOLDOWN_MS = Number(process.env.IMWEB_BLOCK_COOLDOWN_MS) || 90000;
const MAX_COMBINATIONS = 200;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function originOf(baseUrl) {
  return new URL(baseUrl).origin;
}

// --- 로그인(회원가 공개 사이트: 테일릿 등) -----------------------------------------
// 로그인해야 판매가(우리 매입가)가 보이는 사이트가 있다. 서버가 사이트별 계정을 알려 주면
// (setCredentialResolver) 그 사이트에 로그인한 쿠키를 들고 읽는다. 계정은 여기 저장하지 않는다.
let credentialResolver = null;
export function setCredentialResolver(fn) { credentialResolver = typeof fn === "function" ? fn : null; }
const sessions = new Map(); // origin → { cookies: Map, at }
const SESSION_TTL_MS = 30 * 60 * 1000;

function rememberCookies(origin, response) {
  const list = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  if (!list.length) return;
  const s = sessions.get(origin) || { cookies: new Map(), at: 0 };
  for (const line of list) {
    const [pair] = line.split(";");
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const name = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (!value || /expires=Thu, 01 Jan 1970/i.test(line)) s.cookies.delete(name);
    else s.cookies.set(name, value);
  }
  sessions.set(origin, s);
}
const cookieHeader = (origin) => [...(sessions.get(origin)?.cookies || new Map())].map(([k, v]) => `${k}=${v}`).join("; ");

export function memberPriceHidden(html) {
  return /real_price[^>]*>\s*판매가\s*회원공개/.test(String(html || ""));
}

// 로그인이 필요한 사이트면 로그인한다. force: 쿠키가 있어도 다시.
export async function ensureLogin(baseUrl, { force = false } = {}) {
  const origin = originOf(baseUrl);
  const creds = credentialResolver ? await credentialResolver(origin) : null;
  if (!creds?.uid || !creds?.passwd) return false;
  const s = sessions.get(origin);
  if (!force && s?.loggedIn && Date.now() - s.at < SESSION_TTL_MS) return true;
  sessions.delete(origin);
  await request(`${origin}/login?back_url=Lw%3D%3D&used_login_btn=Y`, { retries: 1 });
  const text = await request(`${origin}/backpg/login.cm`, {
    method: "POST", referer: `${origin}/login`, retries: 0,
    form: { uid: creds.uid, passwd: creds.passwd, back_url: "Lw==", used_login_btn: "Y" }
  });
  // 실패하면 아임웹은 alert(…) 를 돌려준다(아이디·비밀번호 확인 등).
  const alert = /alert\(\s*['"]([^'"]+)['"]/.exec(text)?.[1];
  if (alert) {
    const error = new Error(`공급사 사이트 로그인 실패: ${alert}`);
    error.loginFailed = true;
    throw error;
  }
  const cur = sessions.get(origin) || { cookies: new Map() };
  sessions.set(origin, { ...cur, loggedIn: true, at: Date.now() });
  return true;
}

async function request(url, { method = "GET", form = null, retries = 2, referer = "" } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const headers = { "user-agent": USER_AGENT, accept: "text/html,application/json,*/*", "accept-language": "ko-KR,ko;q=0.9" };
      if (referer) headers.referer = referer;
      let body;
      if (form) {
        headers["content-type"] = "application/x-www-form-urlencoded; charset=UTF-8";
        headers["x-requested-with"] = "XMLHttpRequest";
        headers.origin = new URL(url).origin;
        body = new URLSearchParams(form).toString();
      }
      const origin = new URL(url).origin;
      const cookie = cookieHeader(origin);
      if (cookie) headers.cookie = cookie;
      const response = await fetch(url, { method, headers, body, signal: controller.signal, redirect: "follow" });
      rememberCookies(origin, response);
      const text = await response.text();
      if (response.status === 404) {
        const error = new Error(`페이지 없음 (404): ${url}`);
        error.status = 404;
        throw error;
      }
      if (response.status === 403 && /접근 제한|Access is restricted/i.test(text)) {
        const error = new Error("공급사 사이트가 접속을 막았습니다(접근 제한). 서버 IP가 차단됐을 수 있습니다.");
        error.status = 403;
        error.blocked = true;
        throw error;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
      return text;
    } catch (error) {
      lastError = error;
      if (error.status === 404 || error.blocked) throw error;
      await sleep(1000 * (attempt + 1));
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`본사 사이트를 읽지 못했습니다: ${lastError?.message || url}`);
}

export async function fetchBinary(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(url, { headers: { "user-agent": USER_AGENT }, signal: controller.signal });
    if (!response.ok) throw new Error(`이미지 다운로드 실패 HTTP ${response.status}: ${url}`);
    return {
      buffer: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get("content-type") || ""
    };
  } finally {
    clearTimeout(timer);
  }
}

// --- 순수 파서 (문자열만 다룬다 — 브라우저에서도 같은 코드로 시험할 수 있다) -------

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: "\"", "#39": "'", apos: "'", nbsp: " " };

export function decodeEntities(text) {
  return String(text ?? "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+|#39);/gi, (all, name) => ENTITIES[name.toLowerCase()] ?? all);
}

function stripTags(html) {
  return decodeEntities(String(html ?? "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

export function toNumber(value) {
  const n = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

// 이미지 주소 정리: 최적화 CDN 대신 원본, 크기·포맷 쿼리 제거.
export function originalImageUrl(raw) {
  let url = decodeEntities(String(raw || "").trim());
  if (!url) return "";
  if (url.startsWith("//")) url = `https:${url}`;
  url = url.replace(/^https?:\/\/cdn-optimized\.imweb\.me\//i, "https://cdn.imweb.me/");
  return url.split("?")[0].split("#")[0];
}

// 균형 잡힌 { ... } 하나를 잘라 JSON 으로 읽는다 (문자열 안의 괄호는 건너뛴다).
function readJsonObject(text, startIndex) {
  const open = text.indexOf("{", startIndex);
  if (open < 0) return null;
  let depth = 0;
  let inString = false;
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (ch === "\\") i += 1;
      else if (ch === "\"") inString = false;
      continue;
    }
    if (ch === "\"") inString = true;
    else if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(open, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function jsonLdProduct(html) {
  // 아임웹은 type='application/ld+json' 처럼 작은따옴표를 쓴다.
  for (const match of String(html).matchAll(/<script[^>]+type=["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const data = JSON.parse(match[1]);
      const items = Array.isArray(data) ? data : [data];
      const product = items.find((item) => item && item["@type"] === "Product");
      if (product) return product;
    } catch {
      // 다른 JSON-LD 는 건너뛴다.
    }
  }
  return null;
}

function elementInner(html, openTagRegex) {
  const match = openTagRegex.exec(html);
  if (!match) return "";
  const tagName = /^<([a-z0-9]+)/i.exec(match[0])?.[1]?.toLowerCase() || "div";
  let depth = 1;
  const re = new RegExp(`<(/?)${tagName}\\b[^>]*>`, "gi");
  re.lastIndex = match.index + match[0].length;
  let m;
  while ((m = re.exec(html))) {
    if (m[1]) depth -= 1;
    else if (!/\/>$/.test(m[0])) depth += 1;
    if (depth === 0) return html.slice(match.index + match[0].length, m.index);
  }
  return html.slice(match.index + match[0].length);
}

// 상세설명 템플릿에서 상품 이미지만. 링크로 감싼 이미지(회원가입·카카오 배너 등)는 뺀다.
export function detailImagesFromTemplate(templateHtml) {
  const withoutLinks = String(templateHtml || "").replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, "");
  const out = [];
  for (const match of withoutLinks.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const src = /\sdata-src="([^"]+)"/i.exec(tag)?.[1] || /\ssrc="([^"]+)"/i.exec(tag)?.[1] || "";
    if (!src || /^data:/i.test(src)) continue;
    const url = originalImageUrl(src);
    if (url && !out.includes(url)) out.push(url);
  }
  return out;
}

// 썸네일 경로의 날짜(/thumbnail/20260911/)로 본사 등록일을 추정한다(가장 이른 것).
export function estimateRegisteredAt(urls) {
  const dates = [];
  for (const url of urls || []) {
    const m = /\/thumbnail\/(\d{4})(\d{2})(\d{2})\//.exec(url || "");
    if (m) dates.push(`${m[1]}-${m[2]}-${m[3]}`);
  }
  return dates.sort()[0] || "";
}

export function parseDetailPage(html, { baseUrl, productNo }) {
  const text = String(html || "");
  const initAt = text.search(/SITE_SHOP_DETAIL\.initDetail\s*\(/);
  const init = initAt >= 0 ? readJsonObject(text, initAt) : null;
  const ld = jsonLdProduct(text);
  const formHtml = elementInner(text, /<[a-z]+[^>]*id="prod_goods_form"[^>]*>/i);
  const titleHtml = /class="[^"]*view_tit[^"]*"[^>]*>([\s\S]*?)<\/(?:h\d|div|p|span)>/i.exec(formHtml)?.[1] || "";
  const name = String(ld?.name || "").trim() || stripTags(titleHtml);
  if (!init && !name) {
    const error = new Error(`상품 정보를 찾지 못했습니다 (상품번호 ${productNo}). 페이지 구조가 바뀌었을 수 있습니다.`);
    error.code = "PARSE_FAILED";
    throw error;
  }
  const price = toNumber(init?.prod_price ?? ld?.offers?.price);
  const saleText = /class="[^"]*\breal_price\b[^"]*"[^>]*>([\s\S]*?)</i.exec(formHtml)?.[1] || "";
  const salePrice = /회원공개/.test(saleText) ? 0 : toNumber(stripTags(saleText)) || price;

  const listHtml = elementInner(text, /<[a-z]+[^>]*id="prod_image_list"[^>]*>/i);
  const productImages = [];
  for (const match of listHtml.matchAll(/<img\b[^>]*>/gi)) {
    const src = /\ssrc="([^"]+)"/i.exec(match[0])?.[1] || /\sdata-src="([^"]+)"/i.exec(match[0])?.[1] || "";
    const url = originalImageUrl(src);
    if (url && /\/upload\//.test(url) && !productImages.includes(url)) productImages.push(url);
  }
  const ldImages = (Array.isArray(ld?.image) ? ld.image : ld?.image ? [ld.image] : []).map(originalImageUrl);
  const templateHtml = /<template[^>]*id="prodDetailPC"[^>]*>([\s\S]*?)<\/template>/i.exec(text)?.[1] || "";

  return {
    sourceNo: Number(productNo),
    url: `${originOf(baseUrl)}/shop_view/?idx=${productNo}`,
    name: decodeEntities(name),
    price,
    salePrice,
    soldOut: init?.is_soldout === true || /schema\.org\/OutOfStock/i.test(JSON.stringify(ld?.offers || {})),
    editedAt: init?.prod_edit_time ? new Date(Number(init.prod_edit_time) * 1000).toISOString() : "",
    productType: init?.prod_type || "",
    requireOptionCount: Number(init?.require_option_count || 0),
    images: {
      thumbnail: productImages[0] || ldImages[0] || "",
      additional: productImages.slice(1, 21),
      detailImages: detailImagesFromTemplate(templateHtml)
    },
    registeredAt: estimateRegisteredAt(ldImages)
  };
}

// load_option.cm 의 option_html → 옵션 그룹들.
//
// 판매 중인 값은 onclick 에 selectRequireOption(...코드...)가 있고, 품절 값은
// onclick="return false;" 로 코드가 없다 — 이름과 "(품절)" 글자만 있다. 그래서
// dropdown-item 블록마다 따로 읽는다.
export function parseOptionHtml(optionHtml, productNo) {
  const html = String(optionHtml || "");
  const marks = [];
  for (const m of html.matchAll(/class="[^"]*\boption_title\b[^"]*"[^>]*>([\s\S]*?)<\/div>/gi)) {
    marks.push({ index: m.index, kind: "title", title: stripTags(m[1]).replace(/\s*\*\s*$/, "").trim() });
  }
  const starts = [...html.matchAll(/<div\b[^>]*class="[^"]*\bdropdown-item\b[^"]*"[^>]*>/gi)].map((m) => m.index);
  starts.forEach((start, i) => {
    const end = i + 1 < starts.length ? starts[i + 1] : Math.min(html.length, start + 3000);
    marks.push({ index: start, kind: "item", block: html.slice(start, end) });
  });
  marks.sort((a, b) => a.index - b.index);

  const titles = [];
  const groups = [];
  let current = null;
  for (const mark of marks) {
    if (mark.kind === "title") {
      titles.push(mark.title);
      current = { optionCode: "", title: mark.title, values: [] };
      groups.push(current);
      continue;
    }
    const block = mark.block;
    const call = /selectRequireOption\(\s*'prod'\s*,\s*(\d+)\s*,\s*'([^']*)'\s*,\s*'([^']*)'\s*,\s*'((?:[^'\\]|\\.)*)'/.exec(block);
    if (call && productNo && Number(call[1]) !== Number(productNo)) continue;
    const visible = stripTags(block);
    const priceMatch = /([\d,]+)\s*원/.exec(visible);
    const spanName = /<span[^>]*class="[^"]*\bmargin-bottom-lg\b[^"]*"[^>]*>([\s\S]*?)<\/span>/i.exec(block)?.[1];
    const valueName = call
      ? decodeEntities(call[4].replace(/\\'/g, "'"))
      : stripTags(spanName || visible.replace(/[\d,]+\s*원.*$/, "")).replace(/^품절\s*임박/, "").replace(/\(\s*품절\s*\)/g, "").trim();
    if (!valueName) continue;
    if (!current) {
      current = { optionCode: "", title: "", values: [] };
      groups.push(current);
    }
    if (call && !current.optionCode) current.optionCode = call[2];
    if (current.values.some((v) => v.valueName === valueName)) continue;
    current.values.push({
      valueCode: call ? call[3] : "",
      valueName,
      // "(품절)"만 품절이다. "품절 임박"은 재고가 적다는 안내일 뿐 판매 중이다.
      soldOut: /\(\s*품절\s*\)/.test(visible) || !call,
      displayPrice: priceMatch ? toNumber(priceMatch[1]) : 0
    });
  }
  // PC·모바일 화면용으로 같은 그룹이 두 번 나온다 — 제목·값이 같은 그룹은 하나로.
  const unique = [];
  for (const group of groups) {
    if (!group.values.length) {
      if (!unique.some((g) => g.title === group.title)) unique.push(group);
      continue;
    }
    const twin = unique.find((g) => g.title === group.title && (!g.values.length || g.values.map((v) => v.valueName).join("|") === group.values.map((v) => v.valueName).join("|")));
    if (twin) {
      if (!twin.values.length) Object.assign(twin, group);
      continue;
    }
    unique.push(group);
  }
  return { titles: [...new Set(titles)], groups: unique };
}

// --- 네트워크 ---------------------------------------------------------------

export async function listBrand({ baseUrl }) {
  const xml = await request(`${originOf(baseUrl)}/sitemap.xml`);
  const nos = [];
  for (const m of xml.matchAll(/<loc>[^<]*\/shop_view\/(?:\?idx=)?(\d+)[^<]*<\/loc>/g)) {
    const no = Number(m[1]);
    if (no && !nos.includes(no)) nos.push(no);
  }
  return nos.sort((a, b) => b - a);
}

async function loadOptionHtml(baseUrl, productNo, selected = []) {
  const form = { type: "prod", prod_idx: String(productNo) };
  selected.forEach((choice, i) => {
    form[`selected_require_options[${i}][value_type]`] = "SELECT";
    form[`selected_require_options[${i}][option_code]`] = choice.optionCode;
    form[`selected_require_options[${i}][value_code]`] = choice.valueCode;
    form[`selected_require_options[${i}][value_name]`] = choice.valueName;
  });
  const text = await request(`${originOf(baseUrl)}/shop/load_option.cm`, { method: "POST", form, referer: `${originOf(baseUrl)}/shop_view/?idx=${productNo}` });
  const json = JSON.parse(text);
  return { html: json.option_html || "", prodName: json.prod_name || "", prodPrice: json.prod_price };
}

async function selectOptionPrice(baseUrl, productNo, choices) {
  const form = { prod_idx: String(productNo), require: "Y", count: "1", idx: "0", skip_quantity_validation: "false" };
  choices.forEach((choice, i) => {
    form[`options[${i}][value_type]`] = "SELECT";
    form[`options[${i}][option_code]`] = choice.optionCode;
    form[`options[${i}][value_code]`] = choice.valueCode;
    form[`options[${i}][value_name]`] = choice.valueName;
  });
  const text = await request(`${originOf(baseUrl)}/shop/select_option.cm`, { method: "POST", form, referer: `${originOf(baseUrl)}/shop_view/?idx=${productNo}` });
  const json = JSON.parse(text);
  if (json.msg !== "SUCCESS" || !json.selected_option) return null;
  return {
    price: toNumber(json.selected_option.price),
    basePrice: toNumber(json.prod_price),
    stock: json.selected_option.use_stock && !json.selected_option.stock_un_limit ? toNumber(json.selected_option.stock) : null
  };
}

// 옵션 전체(조합형은 펼쳐서)를 읽는다. previousOptions 가 있으면 보이는 금액이 같은
// 옵션은 이전 추가금을 다시 쓴다 — 매일 확인할 때 호출 수를 줄이려고.
export async function fetchOptions(baseUrl, productNo, { previousOptions = [] } = {}) {
  const first = await loadOptionHtml(baseUrl, productNo);
  const parsed = parseOptionHtml(first.html, productNo);
  if (!parsed.groups.length) {
    return { options: [], optionNames: [], prodName: first.prodName, basePrice: firstPrice(first.prodPrice) };
  }
  const names = parsed.groups.map((g) => g.title).filter(Boolean);
  if (!names.length) names.push(...parsed.titles);
  const combos = [];
  let lastKnownNext = null; // 품절이라 펼칠 수 없는 값에 붙일 다음 그룹 값(형제에서 빌린다)
  // 조합형: 앞 그룹 값을 하나씩 고른 상태로 다음 그룹을 불러 펼친다.
  const walk = async (selected, groups, depth) => {
    if (combos.length >= MAX_COMBINATIONS) return;
    const group = groups[depth];
    if (!group || !group.values.length) return;
    for (const value of group.values) {
      const choice = { optionCode: group.optionCode, valueCode: value.valueCode, valueName: value.valueName };
      const path = [...selected, { ...choice, soldOut: value.soldOut, displayPrice: value.displayPrice }];
      if (path.length >= names.length) {
        combos.push(path);
        continue;
      }
      if (!value.valueCode) {
        // 품절 값은 코드가 없어 다음 그룹을 못 부른다. 다른 값에서 본 다음 그룹 값으로
        // 채우고 모두 품절로 둔다(우프 품목과 짝짓기 위해).
        pendingSoldOut.push({ path, depth });
        continue;
      }
      const next = await loadOptionHtml(baseUrl, productNo, path);
      const nextParsed = parseOptionHtml(next.html, productNo);
      const nextGroups = nextParsed.groups.filter((g) => g.values.length);
      await sleep(OPTION_GAP_MS);
      const nextGroup = nextGroups.find((g) => g.title === names[depth + 1]) || nextGroups[nextGroups.length - 1];
      if (nextGroup) lastKnownNext = nextGroup;
      const merged = [...groups];
      merged[depth + 1] = nextGroup || merged[depth + 1];
      await walk(path, merged, depth + 1);
    }
  };
  const pendingSoldOut = [];
  await walk([], parsed.groups, 0);
  for (const { path } of pendingSoldOut) {
    for (const value of lastKnownNext?.values || []) {
      combos.push([...path, { optionCode: lastKnownNext.optionCode, valueCode: "", valueName: value.valueName, soldOut: true, displayPrice: value.displayPrice }]);
    }
  }

  const basePrice = firstPrice(first.prodPrice);
  const previousByLabel = new Map((previousOptions || []).map((o) => [o.label, o]));
  // 추가금 = 옵션 정가 - 상품 정가. 정가는 select_option 으로만 정확히 안다(보이는 값은
  // 할인 적용가). 보이는 금액이 같은 옵션은 추가금도 같으니 금액마다 한 번만 묻는다.
  // 품절 옵션은 코드가 없어 물을 수 없다 — 물어본 옵션에서 할인율을 구해 거꾸로 계산한다.
  const amountByDisplay = new Map();
  let ratio = null;
  const learn = (display, additional) => {
    amountByDisplay.set(display, additional);
    if (display && basePrice + additional > 0 && ratio === null) ratio = display / (basePrice + additional);
  };
  for (const path of combos) {
    const last = path[path.length - 1];
    const label = path.map((p) => p.valueName).join(" / ");
    const previous = previousByLabel.get(label);
    if (previous && previous.displayPrice === last.displayPrice && Number.isFinite(previous.additionalAmount)) {
      if (!amountByDisplay.has(last.displayPrice)) learn(last.displayPrice, previous.additionalAmount);
      continue;
    }
    if (amountByDisplay.has(last.displayPrice) || path.some((p) => !p.valueCode)) continue;
    const exact = await selectOptionPrice(baseUrl, productNo, path).catch(() => null);
    await sleep(OPTION_GAP_MS);
    if (exact) learn(last.displayPrice, Math.round(exact.price - (exact.basePrice || basePrice)));
  }
  const inferred = (display) => {
    if (amountByDisplay.has(display)) return amountByDisplay.get(display);
    if (!display) return 0;
    const r = ratio || 1;
    return Math.max(0, Math.round((display / r - basePrice) / 10) * 10);
  };
  const options = combos.map((path) => {
    const last = path[path.length - 1];
    const soldOut = path.some((p) => p.soldOut);
    return {
      code: path.map((p) => p.valueCode || p.valueName).join("+"),
      names,
      values: path.map((p) => p.valueName),
      label: path.map((p) => p.valueName).join(" / "),
      additionalAmount: inferred(last.displayPrice),
      displayPrice: last.displayPrice,
      selling: !soldOut,
      stockOut: soldOut,
      display: true
    };
  });
  return { options, optionNames: names, prodName: first.prodName, basePrice };
}

function firstPrice(prodPrice) {
  if (prodPrice && typeof prodPrice === "object") {
    const first = Object.values(prodPrice)[0];
    return toNumber(first);
  }
  return toNumber(prodPrice);
}

export async function fetchProduct(baseUrl, productNo, { previous = null } = {}) {
  const needsLogin = await ensureLogin(baseUrl);
  const url = `${originOf(baseUrl)}/shop_view/?idx=${productNo}`;
  let html = await request(url, { referer: `${originOf(baseUrl)}/` });
  if (!needsLogin && memberPriceHidden(html)) {
    // 회원만 가격·구매가 되는 사이트인데 계정이 없다 — 비회원 화면을 품절로 읽지 않게 멈춘다.
    const error = new Error("로그인해야 가격이 보이는 사이트인데 계정이 없습니다. 상품동기화 설정에서 사이트 계정을 넣으세요.");
    error.loginFailed = true;
    throw error;
  }
  if (needsLogin && memberPriceHidden(html)) {
    // 세션이 풀렸으면 한 번 다시 로그인한다. 그래도 회원가가 안 보이면 멈춘다(엉뚱한 가격 비교 방지).
    await ensureLogin(baseUrl, { force: true });
    html = await request(url, { referer: `${originOf(baseUrl)}/` });
    if (memberPriceHidden(html)) {
      const error = new Error("로그인했는데도 회원가가 보이지 않습니다. 공급사 계정을 확인하세요.");
      error.loginFailed = true;
      throw error;
    }
  }
  const product = parseDetailPage(html, { baseUrl, productNo });
  const opts = await fetchOptions(baseUrl, productNo, { previousOptions: previous?.options });
  product.options = opts.options;
  product.optionNames = opts.optionNames;
  product.hasOption = opts.options.length > 0;
  product.optionsUnreadable = product.requireOptionCount > 0 && !opts.options.length && !product.soldOut;
  return product;
}

// 재고 확인용 가벼운 읽기: 상세 페이지(약 500KB) 없이 옵션만 읽고, 나머지는
// 지난번 값을 쓴다. 옵션 없는 상품만 상세를 읽는다(전체 품절은 상세에만 있다).
export async function fetchProductLight(baseUrl, productNo, previous) {
  await ensureLogin(baseUrl);
  if (!previous || previous.missing || !previous.options?.length) {
    return fetchProduct(baseUrl, productNo, { previous });
  }
  const opts = await fetchOptions(baseUrl, productNo, { previousOptions: previous.options });
  if (!opts.options.length) return fetchProduct(baseUrl, productNo, { previous });
  return {
    sourceNo: Number(productNo),
    url: previous.url || `${originOf(baseUrl)}/shop_view/?idx=${productNo}`,
    // 상품명은 상세 페이지 기준으로 저장해 둔 것을 쓴다(옵션 응답의 이름은 표기가 조금
    // 달라서 매번 "상품명 변경"으로 잘못 잡힌다).
    name: previous.name || opts.prodName,
    price: opts.basePrice || previous.price,
    salePrice: previous.salePrice,
    // 옵션이 모두 품절이면 상품 전체 품절과 같게 본다.
    soldOut: opts.options.every((o) => !o.selling),
    hasOption: true,
    optionNames: opts.optionNames,
    options: opts.options,
    images: { thumbnail: previous.thumbnail || "", additional: [], detailImages: [] },
    registeredAt: previous.registeredAt || ""
  };
}

// 이름만 가볍게(일부만 파는 공급사의 '우프 미판매' 목록·연결 추천용). 상세 페이지(약 500KB) 대신
// 옵션 응답(작은 JSON)의 상품명·정가를 쓴다. 우프에 연결된 상품은 재고 확인 때 자세히 읽는다.
export async function fetchNames(baseUrl, productNos, { onProgress } = {}) {
  await ensureLogin(baseUrl);
  const products = [], missing = [], failed = [];
  let blocked = null;
  const targets = [...new Set(productNos.map(Number).filter(Boolean))];
  let done = 0;
  for (const no of targets) {
    try {
      const r = await loadOptionHtml(baseUrl, no);
      if (!r.prodName) missing.push(no);
      else products.push({ sourceNo: no, url: `${originOf(baseUrl)}/shop_view/?idx=${no}`, name: decodeEntities(r.prodName),
        price: firstPrice(r.prodPrice), salePrice: 0, soldOut: false, nameOnly: true, options: [], optionNames: [],
        images: { thumbnail: "", additional: [], detailImages: [] }, registeredAt: "" });
    } catch (error) {
      if (error.blocked) { blocked = error; break; }
      if (error.status === 404) missing.push(no);
      else failed.push({ sourceNo: no, error: error.message });
    }
    done += 1;
    if (onProgress) onProgress(done, targets.length, `상품명 읽는 중 ${done}/${targets.length}`);
    await sleep(OPTION_GAP_MS);
  }
  return { products, missing, failed, ...(blocked ? { blocked: blocked.message, remaining: targets.length - done } : {}) };
}

// 막히면 예외 대신 { blocked } 를 함께 돌려준다 — 그때까지 읽은 상품은 저장해서
// 다음 실행이 이어서 읽게 한다.
export async function fetchProducts(baseUrl, productNos, { onProgress, light = false, previous = {} } = {}) {
  const targets = [...new Set(productNos.map(Number).filter(Boolean))];
  const products = [];
  const missing = [];
  const failed = [];
  let cursor = 0;
  let done = 0;
  let blocked = null;
  let cooledDown = false;
  const worker = async () => {
    while (cursor < targets.length && !blocked) {
      const no = targets[cursor];
      cursor += 1;
      const prev = previous[String(no)];
      const readOne = () => (light ? fetchProductLight(baseUrl, no, prev) : fetchProduct(baseUrl, no, { previous: prev }));
      try {
        products.push(await readOne());
      } catch (error) {
        if (error.blocked && !cooledDown) {
          // 처음 막히면 한 번 쉬었다가 같은 상품부터 다시.
          cooledDown = true;
          if (onProgress) onProgress(done, targets.length, "본사 사이트가 잠시 막아서 1분 30초 쉬는 중");
          await sleep(BLOCK_COOLDOWN_MS);
          try {
            products.push(await readOne());
          } catch (again) {
            if (again.blocked) blocked = again;
            else if (again.status === 404) missing.push(no);
            else failed.push({ sourceNo: no, error: again.message });
          }
        } else if (error.blocked || error.loginFailed) blocked = error;
        else if (error.status === 404) missing.push(no);
        else failed.push({ sourceNo: no, error: error.message });
      }
      if (blocked) break;
      done += 1;
      if (onProgress) onProgress(done, targets.length);
      await sleep(DETAIL_GAP_MS);
    }
  };
  await Promise.all(Array.from({ length: Math.min(DETAIL_CONCURRENCY, targets.length) }, worker));
  products.sort((a, b) => b.sourceNo - a.sourceNo);
  // 하나도 못 읽고 막혔으면 예전처럼 실패로 알린다.
  if (blocked && !products.length && !missing.length) throw blocked;
  return {
    products,
    missing,
    failed,
    blocked: blocked ? blocked.message : "",
    remaining: blocked ? targets.length - done : 0
  };
}
