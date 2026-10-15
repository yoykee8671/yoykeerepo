// 공급사(브랜드) 공식몰 수집기 — 카페24로 만든 브랜드몰 전용.
//
// 카페24 프런트 화면에는 상품 정보가 화면 문구와 별개로 자바스크립트 변수로
// 그대로 실려 있다(product_name, product_price, option_stock_data ...). 화면
// 디자인(스킨)은 브랜드마다 달라도 이 변수들은 카페24가 찍어 주는 것이라
// 이름과 형태가 같다. 그래서 문구를 긁지 않고 이 변수만 읽는다 — 스킨이 바뀌어도
// 깨지지 않게 하려는 것이다.
//
// 이 파일은 남의 사이트를 읽기만 한다. 우프 쪽에 쓰는 일은 product-sync 와
// cafe24-api 가 맡는다.
//
// 확인된 판정 규칙 (MUNIKUND 168개 상품 실측, 2026-10-15):
//   - 상품 전체 품절: is_soldout_icon === 'T' (구매 버튼이 숨겨진다).
//     옵션이 전부 is_selling 'T' 인 채로 상품만 품절인 경우가 있다
//     (예: Blueberry Shower Gown) — 옵션만 보고 판단하면 놓친다.
//   - 옵션(사이즈) 품절: option_stock_data[*].is_selling === 'F'.
//   - 재고 수량은 공개되지 않는다. 판매가능 여부만 알 수 있다.
//   - 옵션 추가금: option_stock_data[*].stock_price (예: "5000.00").
//   - 상세설명 이미지 경로에 업로드 날짜가 찍힌다: /web/upload/NNEditor/20261001/...
//     화면에 등록일이 없어서 "최근 등록 상품" 판단에 이 날짜를 쓴다.

const USER_AGENT = "Mozilla/5.0 (compatible; WooofPay-ProductSync/1.0; +https://pay.wooof.co.kr)";
const REQUEST_TIMEOUT_MS = 20000;
const MAX_LIST_PAGES = 60;

// 본사 서버에 부담을 주지 않도록 한 번에 몇 개만, 사이사이 쉬면서 받는다.
// 170개 남짓이면 1~2분이면 끝난다. 하루 두 번 도는 작업이라 서두를 이유가 없다.
const DETAIL_CONCURRENCY = 3;
const DETAIL_GAP_MS = 300;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function fetchText(url, { retries = 2 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        headers: { "user-agent": USER_AGENT, accept: "text/html,*/*" },
        signal: controller.signal,
        redirect: "follow"
      });
      if (response.status === 404) {
        const error = new Error(`페이지 없음 (404): ${url}`);
        error.status = 404;
        throw error;
      }
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
      return await response.text();
    } catch (error) {
      lastError = error;
      if (error.status === 404) throw error;
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

function originOf(baseUrl) {
  return new URL(baseUrl).origin;
}

// "//munikund.com/web/..." 나 "/web/..." 를 절대주소로.
export function absoluteUrl(baseUrl, raw) {
  const value = String(raw || "").trim();
  if (!value) return "";
  if (value.startsWith("//")) return `https:${value}`;
  if (/^https?:\/\//i.test(value)) return value;
  return `${originOf(baseUrl)}${value.startsWith("/") ? "" : "/"}${value}`;
}

// 목록 페이지에서 상품번호만 뽑는다. 카페24 목록은 상품마다
// id="anchorBoxId_{상품번호}" 를 단다.
export function parseListPage(html) {
  const seen = new Set();
  for (const match of String(html).matchAll(/anchorBoxId_(\d+)/g)) seen.add(Number(match[1]));
  return [...seen];
}

export async function crawlCategory(baseUrl, categoryNo) {
  const all = [];
  const seen = new Set();
  for (let page = 1; page <= MAX_LIST_PAGES; page += 1) {
    const html = await fetchText(`${originOf(baseUrl)}/product/list.html?cate_no=${categoryNo}&page=${page}`);
    const found = parseListPage(html).filter((no) => !seen.has(no));
    if (!found.length) break;
    for (const no of found) {
      seen.add(no);
      all.push(no);
    }
    await sleep(DETAIL_GAP_MS);
  }
  return all;
}

// 자바스크립트 작은따옴표 문자열 리터럴 안의 내용을 원래 문자열로.
// option_stock_data 는 JSON 을 이 리터럴 안에 다시 넣은 것이라 \" 와 \uXXXX 가
// 섞여 있다. JSON 문자열로 한 번 풀면 정확히 원래 값이 나온다.
const SIMPLE_ESCAPES = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", 0: "\0" };

function unescapeJsString(raw) {
  const text = String(raw ?? "");
  let out = "";
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch !== "\\" || i === text.length - 1) {
      out += ch;
      continue;
    }
    const next = text[i + 1];
    if (next === "u" && /^[0-9a-fA-F]{4}$/.test(text.slice(i + 2, i + 6))) {
      out += String.fromCharCode(parseInt(text.slice(i + 2, i + 6), 16));
      i += 5;
    } else if (next === "x" && /^[0-9a-fA-F]{2}$/.test(text.slice(i + 2, i + 4))) {
      out += String.fromCharCode(parseInt(text.slice(i + 2, i + 4), 16));
      i += 3;
    } else {
      out += SIMPLE_ESCAPES[next] ?? next;
      i += 1;
    }
  }
  return out;
}

function jsVar(html, name) {
  // var product_name = 'Fleece All In One : Yellow';  /  var product_sale_price = 44800;
  const re = new RegExp(`var\\s+${name}\\s*=\\s*(?:'((?:[^'\\\\]|\\\\.)*)'|"((?:[^"\\\\]|\\\\.)*)"|([^;\\n]+))\\s*;`);
  const match = re.exec(html);
  if (!match) return undefined;
  if (match[1] !== undefined) return unescapeJsString(match[1]);
  if (match[2] !== undefined) return unescapeJsString(match[2]);
  return String(match[3]).trim();
}

function metaContent(html, property) {
  const re = new RegExp(`<meta[^>]+(?:property|name)="${property.replace(/[.:]/g, "\\$&")}"[^>]+content="([^"]*)"`, "i");
  return re.exec(html)?.[1] || "";
}

function decodeEntities(text) {
  return String(text || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function toNumber(value) {
  const n = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function sectionBetween(html, startMarker, endMarker) {
  const start = html.indexOf(startMarker);
  if (start < 0) return "";
  const end = endMarker ? html.indexOf(endMarker, start + startMarker.length) : -1;
  return html.slice(start, end > start ? end : undefined);
}

// 옵션 조합 이름 구분자. 카페24는 조합형 옵션(색상×사이즈)을 "COLOR#$%SIZE" 처럼 잇는다.
const OPTION_JOIN = "#$%";

function parseOptions(html) {
  const raw = jsVar(html, "option_stock_data");
  if (!raw) return [];
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  return Object.entries(data || {}).map(([code, item]) => {
    const names = Array.isArray(item.option_name_original) && item.option_name_original.length
      ? item.option_name_original.map(String)
      : String(item.option_name || "").split(OPTION_JOIN);
    const values = Array.isArray(item.option_value_orginal) && item.option_value_orginal.length
      ? item.option_value_orginal.map(String)
      : String(item.option_value || "").split("-");
    // 품절은 두 가지로 표시된다 (MUNIKUND 실측: 판매안함 23개, 재고0 239개).
    //   - 판매안함: is_selling 'F'
    //   - 재고 소진: is_selling 은 'T' 그대로, stock_number 0 + is_auto_soldout 'T'
    //     (재고관리 사용 + 품절표시 사용인 품목이 0개가 된 것)
    // 판매중 플래그만 보면 재고 소진 품절을 전부 놓친다.
    // 재고를 관리하지 않는 품목은 stock_number 가 0 이어도 팔린다. 카페24가 품절로
    // 처리했다는 표시(is_auto_soldout) 또는 재고관리+품절표시 사용일 때만 품절로 본다.
    // (MUNIKUND 실측: stock_number 0 인 254개 모두 is_auto_soldout 'T')
    const stockOut = Object.prototype.hasOwnProperty.call(item, "stock_number")
      && item.stock_number !== null
      && Number(item.stock_number) <= 0
      && item.use_soldout !== "F"
      && (item.is_auto_soldout === "T" || (Boolean(item.use_stock) && item.use_stock !== "F"));
    return {
      code,
      names,
      values,
      // 화면 표시용 한 줄 이름: "INAP Black / 1호"
      label: values.join(" / "),
      additionalAmount: toNumber(item.stock_price),
      selling: item.is_selling === "T" && !stockOut,
      stockOut,
      display: item.is_display !== "F"
    };
  });
}

function parseImages(html, baseUrl) {
  // og:image 가 두 번 나온다 — 첫 번째는 사이트 공통 이미지(/img/og_img.jpg)이고
  // 상품 대표이미지는 /web/product/big/ 경로다. 상품 경로인 것을 고른다.
  const ogImages = [...String(html).matchAll(/<meta[^>]+property="og:image"[^>]+content="([^"]*)"/gi)].map((m) => m[1]);
  const keyImage = /class="[^"]*BigImage[^"]*"[^>]*src="([^"]+)"|<img[^>]+src="([^"]+\/web\/product\/big\/[^"]+)"/i.exec(html);
  const thumbnailRaw = ogImages.find((src) => /\/web\/product\/big\//.test(src))
    || keyImage?.[1] || keyImage?.[2] || ogImages[ogImages.length - 1] || "";
  const thumbnail = absoluteUrl(baseUrl, thumbnailRaw);
  // 추가이미지 영역. 첫 칸은 대표이미지(축소본)라 extra 경로만 고른다.
  const addSection = sectionBetween(html, "xans-product-addimage", "</ul>");
  const additional = [...addSection.matchAll(/(?:ec-data-src|src)="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((src) => /\/web\/product\/extra\//.test(src))
    .map((src) => absoluteUrl(baseUrl, src));

  // 상세설명. 탭 구조상 prdDetail 안의 .cont 가 본문이다.
  const detailSection = sectionBetween(html, '<div id="prdDetail"', '<div id="prdReview"');
  const contIndex = detailSection.indexOf('<div class="cont">');
  const body = contIndex >= 0 ? detailSection.slice(contIndex) : detailSection;
  const detailImages = [];
  for (const match of body.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const src = /ec-data-src="([^"]+)"/i.exec(tag)?.[1] || /\ssrc="([^"]+)"/i.exec(tag)?.[1] || "";
    if (!src || /^data:/i.test(src)) continue;
    // 스킨이 넣는 장식(아이콘·버튼)은 상세 본문이 아니다.
    if (/\/_dj\/|\/web\/upload\/custom_|btn_|icon/i.test(src)) continue;
    const absolute = absoluteUrl(baseUrl, src);
    if (!detailImages.includes(absolute)) detailImages.push(absolute);
  }
  return { thumbnail, additional: [...new Set(additional)], detailImages };
}

// 상세이미지 경로의 날짜(NNEditor/20261001)와 대표·추가이미지 업로드 월
// (/big/202610/) 중 가장 이른 것을 "본사 등록일 추정"으로 쓴다. 상세는 나중에
// 고쳐 올리는 일이 잦아서(1079: 이미지 2024-10, 상세 2025-12) 가장 이른 날짜가
// 실제 등록 시점에 가깝다. 이미지 월은 일자를 모르니 그달 1일로 본다 —
// 3개월 창을 판단하는 데는 이 정도 오차면 충분하다.
//
// 다만 이미지 월이 상세 날짜와 같은 달이면 정확한 상세 날짜를 쓴다. 그러지 않으면
// 7월 15일에 올린 상품이 7월 1일로 잡혀 3개월 경계에서 빠진다(Dry Hug Shower Glove).
export function estimateRegisteredAt(images) {
  const isDate = (d) => /^(19|20)\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(d);
  const detailDates = [];
  for (const url of images.detailImages || []) {
    const m = /NNEditor\/(\d{4})(\d{2})(\d{2})\//.exec(url);
    if (m) detailDates.push(`${m[1]}-${m[2]}-${m[3]}`);
  }
  const imageMonths = [];
  for (const url of [images.thumbnail, ...(images.additional || [])]) {
    const m = /\/web\/product\/(?:extra\/)?(?:big|small|medium|tiny)\/(\d{4})(\d{2})\//.exec(url || "");
    if (m) imageMonths.push(`${m[1]}-${m[2]}`);
  }
  const earliestDetail = detailDates.filter(isDate).sort()[0] || "";
  const earliestMonth = imageMonths.filter((ym) => isDate(`${ym}-01`)).sort()[0] || "";
  if (earliestDetail && (!earliestMonth || earliestMonth >= earliestDetail.slice(0, 7))) return earliestDetail;
  return earliestMonth ? `${earliestMonth}-01` : earliestDetail;
}

export function parseProductPage(html, { baseUrl, productNo }) {
  const name = decodeEntities(jsVar(html, "product_name") || metaContent(html, "og:title"));
  if (!name) {
    const error = new Error(`상품 정보를 찾지 못했습니다 (상품번호 ${productNo}). 페이지 구조가 바뀌었을 수 있습니다.`);
    error.code = "PARSE_FAILED";
    throw error;
  }
  const price = toNumber(jsVar(html, "product_price") || metaContent(html, "product:price:amount"));
  const salePriceRaw = jsVar(html, "product_sale_price") ?? metaContent(html, "product:sale_price:amount");
  const salePrice = toNumber(salePriceRaw) || price;
  const options = parseOptions(html);
  const images = parseImages(html, baseUrl);
  const declaresOptions = jsVar(html, "has_option") === "T";
  const soldOutIcon = jsVar(html, "is_soldout_icon") === "T";
  const optionMapper = String(jsVar(html, "option_name_mapper") || "");
  const optionNames = options[0]?.names?.length
    ? options[0].names
    : (optionMapper ? optionMapper.split(OPTION_JOIN) : []);
  return {
    sourceNo: Number(productNo),
    url: `${originOf(baseUrl)}/product/detail.html?product_no=${productNo}`,
    name,
    price,
    salePrice,
    soldOut: soldOutIcon,
    hasOption: declaresOptions && options.length > 0,
    // 옵션이 있다고 하는데 옵션 데이터를 못 읽었다 — 상품 단위로 판단하면 틀린다.
    optionsUnreadable: declaresOptions && options.length === 0,
    optionNames,
    options,
    images,
    registeredAt: estimateRegisteredAt(images)
  };
}

export async function fetchProduct(baseUrl, productNo) {
  const html = await fetchText(`${originOf(baseUrl)}/product/detail.html?product_no=${productNo}`);
  return parseProductPage(html, { baseUrl, productNo });
}

// 상세 페이지 여러 개를 천천히 나눠 읽는다. 404 는 본사에서 삭제된 것이다.
export async function fetchProducts(baseUrl, productNos, { onProgress } = {}) {
  const targets = [...new Set(productNos.map(Number).filter(Boolean))];
  const products = [];
  const missing = [];
  const failed = [];
  let cursor = 0;
  let done = 0;
  const worker = async () => {
    while (cursor < targets.length) {
      const no = targets[cursor];
      cursor += 1;
      try {
        products.push(await fetchProduct(baseUrl, no));
      } catch (error) {
        if (error.status === 404) missing.push(no);
        else failed.push({ sourceNo: no, error: error.message });
      }
      done += 1;
      if (onProgress) onProgress(done, targets.length);
      await sleep(DETAIL_GAP_MS);
    }
  };
  await Promise.all(Array.from({ length: Math.min(DETAIL_CONCURRENCY, targets.length) }, worker));
  products.sort((a, b) => b.sourceNo - a.sourceNo);
  return { products, missing, failed };
}

// 진열 목록에 있는 상품번호만 모은다(목록 페이지 몇 장 — 상세는 읽지 않는다).
export async function listBrand({ baseUrl, categoryNos = [] }) {
  const listed = [];
  for (const categoryNo of categoryNos) {
    for (const no of await crawlCategory(baseUrl, categoryNo)) {
      if (!listed.includes(no)) listed.push(no);
    }
  }
  return listed;
}
