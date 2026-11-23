// 기준 상품 매칭: 브랜드 상품의 기준은 단가표 품목(IT 코드)이다.
// 판매처(우프 카페24, 본사몰…)에 보이는 상품명·옵션명이 달라도, 연결은 이름이 아니라
// 번호(우프 상품번호+품목코드)로 저장해서 "(1+1)", "[아울렛]" 같은 말머리가 붙어도 끊기지 않는다.
// 기준 코드는 바코드 → 카페24 품목코드 → 단가표 코드(IT-) 순서(2026-11-23 사용자 확정).
//
// 이 파일은 저장·네트워크 없이 계산만 한다(추천·정리). 저장은 server.js 가 맡는다.

// 한글 색상·옵션 말 → 영문(단가표가 영문 색상명을 쓰는 브랜드용). 확인된 연결에서 배운 말은
// 브랜드별 learned 사전으로 더해진다.
export const KO_EN = {
  루비: "ruby", 피콕: "peacock", 피코크: "peacock", 스트로베리: "strawberry", 블랙베리: "blackberry",
  라벤더: "lavender", 시나몬: "cinnamon", 허니: "honey", 스트림: "stream", 포레스트: "forest",
  파슬리: "parsley", 데저트: "desert", 오션: "ocean", 레이븐: "raven", 비트루트: "beetroot",
  에그플랜트: "eggplant", 터메릭: "turmeric", 벅쏜: "buckthorn", 네온: "neon", 리코리스: "licorice",
  헷지: "hedge", 로즈힙: "rosehip", 빌베리: "bilberry", 링건: "lingon", 아쿠아마린: "aquamarine",
  옐로우: "yellow", 블랙: "black", 화이트: "white", 그레이: "grey", 레드: "red", 블루: "blue",
  그린: "green", 핑크: "pink", 퍼플: "purple", 오렌지: "orange", 네이비: "navy", 브라운: "brown",
  베이지: "beige", 카키: "khaki", 올리브: "olive", 민트: "mint", 크림: "cream", 아이보리: "ivory",
  성견용: "adult", 성견: "adult", 노령견용: "senior", 노령견: "senior", 시니어: "senior", 퍼피: "puppy"
};

// 상품명 앞뒤에 붙는 판매용 말머리·안내: [1+1] (1+1) [옥에티] [아울렛] [신제품] (미노출 상품) (4컬러) 2025 …
const PROMO_TAG = /[\[(（【]\s*(?:\d+\s*\+\s*\d+|옥에티|아울렛|신제품|신상|세일|특가|할인|단독|한정|미노출(?:\s*상품)?|품절임박|유통기한[^)\]]*|재고\s*소진|리퍼|b급|세트상품[^)\]]*|\d+\s*(?:colou?rs?|컬러|color|types?|종|가지))\s*[\])）】]/gi;
export function cleanProductName(name) {
  return String(name ?? "").normalize("NFKC")
    .replace(PROMO_TAG, " ")
    .replace(/\b20\d{2}\b/g, " ")
    .replace(/★|☆|NEW\b/gi, " ")
    .replace(/\s+/g, " ").trim();
}

// --- 옵션·규격 토큰 -----------------------------------------------------------
function translateWords(text, dict) {
  let out = text;
  const keys = Object.keys(dict).sort((a, b) => b.length - a.length);
  for (const k of keys) if (out.includes(k)) out = out.split(k).join(` ${dict[k]} `);
  return out;
}
// "45 - 60", "45~60", "120-180cm*6mm", "5kg", "S (45 - 65)", "25S", "beetroot 35" → 토큰 집합
export function specTokens(text, dict = KO_EN) {
  let t = String(text ?? "").normalize("NFKC").toLowerCase();
  t = translateWords(t, Object.fromEntries(Object.entries(dict).map(([k, v]) => [k.toLowerCase(), v.toLowerCase()])));
  t = t.replace(/(\d)\s*[-~]\s*(\d)/g, "$1-$2").replace(/(\d)\s*(kg|g|ml|l|cm|mm|ct)\b/g, "$1$2");
  t = t.replace(/[()\[\]/,*|·]+/g, " ").replace(/\bx\b/g, " ");
  const out = new Set();
  for (const raw of t.split(/\s+/)) {
    const w = raw.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}.]+$/gu, "");
    if (!w || /^(mix|eco|cm|mm|kg|g|개|ea)$/.test(w)) continue;
    // 길이(cm) 끝자리는 빼고 비교한다: 120-180cm ↔ 120-180
    out.add(w.replace(/(\d)(cm)$/, "$1").replace(/^(\d+(?:\.\d+)?)l$/, "$1000ml").replace(/^(\d+(?:\.\d+)?)kg$/, (m, n) => `${Number(n) * 1000}g`));
  }
  return out;
}
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));
const subsetOf = (a, b) => a.size > 0 && [...a].every((x) => b.has(x));

// 우프 품목의 규격 = 옵션값들. 옵션이 없으면 상품명 끝의 용량((5kg), 85g, 2.5kg X 3개)을 쓴다.
// 색상이 옵션이 아니라 상품명에 있으면("래즐대즐 미드레이어 자켓 (블랙베리)" + 옵션 25) 그 말도 더한다.
export function variantSpecText(productName, variant, dict = KO_EN) {
  const name = String(productName || "");
  const extra = Object.keys(dict).filter((k) => name.includes(k)).join(" ");
  const opt = (variant?.options || []).map((o) => o.value).filter(Boolean).join(" ");
  if (opt) return [opt, extra].filter(Boolean).join(" ");
  const m = name.match(/(\d+(?:\.\d+)?\s*(?:kg|g|ml|ct)\b)(?!.*\d+(?:\.\d+)?\s*(?:kg|g|ml|ct)\b)/i);
  return [m ? m[1] : "", extra].filter(Boolean).join(" ");
}

// --- 이름 비교 ----------------------------------------------------------------
// 한글을 소리대로 영문 자음 뼈대로 바꿔(몬순→MNSN, Monsoon→MNSN) 영문 단가표명과 비교한다.
const CHO = ["g", "kk", "n", "d", "tt", "r", "m", "b", "pp", "s", "ss", "", "j", "jj", "ch", "k", "t", "p", "h"];
const JONG = ["", "k", "k", "k", "n", "n", "n", "t", "l", "k", "m", "l", "l", "l", "p", "l", "m", "p", "p", "t", "t", "ng", "t", "t", "k", "t", "p", "t"];
function romanize(text) {
  let out = "";
  for (const ch of String(text || "")) {
    const c = ch.charCodeAt(0) - 0xac00;
    if (c < 0 || c > 11171) { out += ch; continue; }
    out += `${CHO[Math.floor(c / 588)]}a${JONG[c % 28]}`;
  }
  return out;
}
function skeleton(text) {
  return String(text || "").toLowerCase()
    .replace(/ii\b/g, "2").replace(/ph/g, "p").replace(/th/g, "t").replace(/sh|ch|ck/g, (m) => (m === "ck" ? "k" : "s"))
    .replace(/ng/g, "n").replace(/[aeiouyw h]/g, "").replace(/[^a-z0-9]/g, "")
    .replace(/[gkcq]/g, "K").replace(/[dt]/g, "T").replace(/[bpvf]/g, "P").replace(/[szjx]/g, "S")
    .replace(/[rl]/g, "R").replace(/m/g, "M").replace(/n/g, "N")
    .replace(/(.)\1+/g, "$1");
}
function bigrams(text) {
  const m = new Map();
  for (let i = 0; i < text.length - 1; i += 1) { const g = text.slice(i, i + 2); m.set(g, (m.get(g) || 0) + 1); }
  return m;
}
export function dice(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a), B = bigrams(b);
  let o = 0, t = 0;
  for (const [g, n] of A) { t += n; o += Math.min(n, B.get(g) || 0); }
  for (const n of B.values()) t += n;
  return t ? (2 * o) / t : 0;
}
const onlyKo = (s) => (String(s).match(/[가-힣]+/g) || []).join("");
const onlyEn = (s) => (String(s).match(/[A-Za-z]+/g) || []).join(" ");
const sizeWords = /\d+(?:\.\d+)?\s*(?:kg|g|ml|ct)\b|\([^)]*\d[^)]*\)/gi;
export function nameScore(wooofName, modelName) {
  const w = cleanProductName(wooofName).replace(sizeWords, " ");
  const m = cleanProductName(modelName).replace(sizeWords, " ");
  const wk = onlyKo(w), mk = onlyKo(m);
  // 단가표 한글명이 짧으면("덕하트") 우프 이름에 다 들어 있는지도 본다.
  const cover = mk.length >= 3 ? [...bigrams(mk).keys()].filter((g) => wk.includes(g)).length / Math.max(1, mk.length - 1) : 0;
  const ko = Math.max(dice(wk, mk), cover * 0.85);
  const en = onlyEn(m) ? dice(skeleton(romanize(onlyKo(w)) + onlyEn(w)), skeleton(onlyEn(m))) : 0;
  return Math.round(Math.max(ko, en * 0.9) * 100) / 100;
}

// 서로 배타적인 말(원료·나이·종·제품군·라인): 양쪽에 다 있는데 다르면 다른 상품이다.
// 우프 "치킨과 연어 소형견용" ↔ 단가표 "치킨 소형견용" 은 이름이 비슷해도 다른 상품.
const CONCEPTS = {
  brand: { sbf: ["셰퍼드보이팜즈", "sbf"], mcadams: ["맥아담스", "mcadams"], tribal: ["트라이벌", "tribal"], woof: ["워프", "woof"],
    meow: ["먀오", "meow"], bugsy: ["벅시", "bugsy"], fera: ["페라", "fera"], wenature: ["위네이쳐", "wenature"], hurtta: ["후르타", "hurtta"] },
  protein: { chicken: ["치킨", "닭", "chicken"], turkey: ["터키", "칠면조", "turkey"], salmon: ["연어", "새몬", "salmon"], duck: ["오리", "덕", "duck"],
    beef: ["비프", "소고기", "beef"], lamb: ["램", "양고기", "lamb"], venison: ["베니슨", "사슴", "venison"], goat: ["고트", "산양", "염소", "goat"],
    kangaroo: ["캥거루", "kangaroo"], pork: ["포크", "돼지", "pork"], tuna: ["튜나", "참치", "tuna"], mussel: ["홍합", "mussel"], hoki: ["호키", "hoki"],
    prawn: ["새우", "prawn"], minnow: ["미노", "피라미", "minnow"], fish: ["피쉬", "fish"] },
  part: { heart: ["하트", "심장", "heart"], liver: ["리버", "간)", "liver"], breast: ["브레스트", "가슴살", "breast"], tripe: ["트라이프", "tripe"],
    lung: ["렁", "허파", "lung"], trachea: ["트레키아", "기도", "trachea"], diet: ["다이어트", "사료", "diet"], cheese: ["치즈", "cheese"] },
  stage: { adult: ["성견", "adult"], small: ["소형견", "small"], medium: ["중형견"], large: ["중대형견", "ml."], puppy: ["퍼피", "puppy"], senior: ["시니어", "노령견", "senior"] },
  pet: { cat: ["캣", "고양이", "cat"], dog: ["독 ", "dog"] },
  flavor: { classic: ["클래식", "classic"], green: ["그린스", "super green", "슈퍼그린"], fruit: ["후르츠", "푸르트", "fruit"], golden: ["골든", "golden"],
    vitamin: ["멀티비타민", "multivitamin"], joint: ["힙&조인트", "joint"], probiotic: ["프로바이오틱스", "probiotic"], postbiotic: ["포스트바이오틱스", "postbiotic"],
    pumpkin: ["펌킨", "pumpkin"], mushroom: ["머쉬룸", "mushroom"], cardiac: ["카디악", "cardiac"], vegetable: ["베지터블", "vegetable"], aloe: ["알로에", "aloe"],
    steak: ["스테이크", "steak"] },
  kind: { coat: ["코트", "coat"], harness: ["하네스", "harness"], leash: ["리쉬", "leash"], collar: ["칼라", "collar"], overall: ["오버올", "overall"],
    midlayer: ["미드레이어", "midlayer"], parka: ["파카", "parka"], warmer: ["워머", "warmer"], bandana: ["반다나", "bandana"],
    savior: ["구명조끼", "세이비어", "savior"], cooling: ["쿨링", "cooling"], pack: ["팩 ", "pack"], bag: ["슬리핑 백", "bag"], vest: ["베스트", "vest"], pocket: ["포켓", "pocket"],
    rope: ["로프", "rope"] },
  line: { monsoon: ["몬순", "monsoon"], mudventure: ["머드벤처", "mudventure"], weekend: ["위캔드", "weekend"], safeguard: ["세이프가드", "safeguard"],
    razzle: ["래즐대즐", "razzle"], extreme: ["익스트림", "extreme"], expedition: ["익스페디션", "expedition"], casual: ["캐주얼", "casual"],
    rover: ["로버", "rover"], seeker: ["시커", "seeker"], venture: ["벤처 ", "venture"], warming: ["워밍", "warming"], reflective: ["리플렉티브", "reflective"],
    multilong: ["멀티롱", "멀티 롱", "multilong"], life: ["라이프", "life"], adjustable: [" al ", "adjustable"] }
};
function conceptsOf(text) {
  const t = ` ${String(text || "").normalize("NFKC").toLowerCase()} `;
  const out = {};
  for (const [cat, ids] of Object.entries(CONCEPTS)) {
    const hit = new Set();
    for (const [id, words] of Object.entries(ids)) if (words.some((w) => t.includes(w))) hit.add(id);
    // "머드벤처" 안의 "벤처", "중대형견" 과 겹치는 말처럼 더 긴 말이 잡혔으면 짧은 쪽은 뺀다.
    if (hit.has("mudventure")) hit.delete("venture");
    if (cat === "protein" && hit.has("goat") && /고트\s*밀크|goat\s*milk/.test(t)) hit.add("goatmilk");
    out[cat] = hit;
  }
  return out;
}
// 판(버전): 단가표가 "II"/"2" 인데 우프 이름에 없으면 예전 판이다.
const versionOf = (t) => (/\b(ii|2)\b/i.test(cleanProductName(t).replace(sizeWords, " ")) ? "2" : "");
const FOOD = /사료|간식|동결건조|에어드라이드|토퍼|트릿|파우더|캔\b|\b(?:fd|ad|treat|food|diet|wet)\b/i;
// 라인(위캔드·AL …)은 한쪽 이름에만 붙기도 해서 겹치는 게 하나도 없을 때만 다르다고 본다.
const LOOSE = new Set(["line"]);
export function conflicts(wooofName, modelName) {
  const wa = cleanProductName(wooofName), mb = cleanProductName(modelName);
  const a = conceptsOf(wa);
  const b = conceptsOf(mb);
  if ((FOOD.test(wa) && b.kind.size) || (a.kind.size && FOOD.test(mb))) return "kind";
  for (const cat of Object.keys(CONCEPTS)) {
    if (!a[cat].size || !b[cat].size) continue;
    if (LOOSE.has(cat)) { if (![...a[cat]].some((x) => b[cat].has(x))) return cat; continue; }
    if (a[cat].size !== b[cat].size || [...a[cat]].some((x) => !b[cat].has(x))) return cat;
  }
  if (b.brand.has("hurtta") || a.brand.has("hurtta")) {
    if (versionOf(modelName) && !versionOf(wooofName)) return "version";
  }
  return "";
}

// --- 추천 --------------------------------------------------------------------
// 단가표 품목을 '모델'(같은 품목명)으로 묶는다. 우프 한 상품 = 보통 단가표 한 모델의 여러 옵션.
export function groupModels(entries) {
  const map = new Map();
  for (const e of entries) {
    const key = String(e.itemName || e.itemCode || "").trim();
    if (!map.has(key)) map.set(key, { name: key, entries: [] });
    map.get(key).entries.push(e);
  }
  return [...map.values()];
}
const retailOf = (e) => Number(e.consumerPrice || e.originalPrice || 0);

function matchVariants(product, variants, model, dict) {
  const pairs = [];
  const usedEntries = new Set();
  const priceOf = (v) => Math.round(Number(product.price || 0) + Number(v.additional_amount || 0));
  const specs = model.entries.map((e) => ({ e, tokens: specTokens(e.spec || "", dict) }));
  for (const v of variants) {
    const vt = specTokens(variantSpecText(product.product_name, v, dict), dict);
    let hit = null;
    if (vt.size) hit = specs.find((s) => !usedEntries.has(s.e.code) && sameSet(vt, s.tokens))
      || specs.find((s) => !usedEntries.has(s.e.code) && s.tokens.size && subsetOf(s.tokens, vt))
      || specs.find((s) => !usedEntries.has(s.e.code) && subsetOf(vt, s.tokens));
    if (!hit && variants.length === 1 && model.entries.length === 1 && (!vt.size || !specs[0].tokens.size)) hit = specs[0];
    if (!hit) continue;
    usedEntries.add(hit.e.code);
    pairs.push({ variantCode: v.variant_code, entryCode: hit.e.code, priceHit: retailOf(hit.e) > 0 && retailOf(hit.e) === priceOf(v) });
  }
  return pairs;
}

// products: 우프 카페24 상품(variants 포함). entries: 브랜드 단가표(현재 적용 중인 것).
// links: 이미 확정된 연결(variantCode → …) — 확정된 품목은 다시 추천하지 않는다.
export function suggestProductMatches({ products = [], entries = [], links = {}, dict = {} } = {}) {
  const d = { ...KO_EN, ...dict };
  const models = groupModels(entries);
  const out = [];
  for (const p of products) {
    const variants = (p.variants || []).filter((v) => !links[v.variant_code]);
    if (!variants.length) continue;
    let best = null;
    for (const model of models) {
      const ns = nameScore(p.product_name, model.name);
      if (ns < 0.25 || conflicts(p.product_name, model.name)) continue;
      const pairs = matchVariants(p, variants, model, d);
      if (!pairs.length) continue;
      const rate = pairs.length / variants.length;
      const price = pairs.filter((x) => x.priceHit).length / pairs.length;
      const score = ns * 0.55 + rate * 0.3 + price * 0.15;
      if (!best || score > best.score) best = { model: model.name, score: Math.round(score * 100) / 100, nameScore: ns, pairs };
    }
    out.push({ productNo: p.product_no, productName: p.product_name, variants: variants.length, best });
  }
  return out;
}

// 기준 코드: 바코드 → 카페24 품목코드 → 단가표 코드.
export function baseCodeOf(entry, cafe24VariantCode = "") {
  const barcode = String(entry?.barcode || "").replace(/\s/g, "");
  if (/^\d{8,14}$/.test(barcode)) return { code: barcode, kind: "barcode" };
  if (cafe24VariantCode) return { code: cafe24VariantCode, kind: "cafe24" };
  return { code: entry?.code || "", kind: "pay" };
}
