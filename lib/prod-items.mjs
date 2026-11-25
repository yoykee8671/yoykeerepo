// 생산처 상세내역(팩스로 받은 날짜별 품목·수량·단가) ↔ 품목 코드 연결.
//
// 팩스 줄은 "카시트(오렌지)", "하네스 S,M", "운임*3" 처럼 손으로 적힌 이름이라, 품목(자재·공임·운임…)
// 마다 '팩스 표기(별칭)'를 두고 거기에 맞춰 추천한다. 처음 한 번은 담당자가 확인한다(2026-11-25 사용자 결정).
//   - 같은 별칭을 쓰는 품목이 여럿이면(하네스 S / M) 줄에 적힌 사이즈로 고르고,
//     사이즈가 없으면 단가가 하나에만 맞을 때 그걸로, 아니면 '사이즈 미기재'로 둔다.
//   - 단가 이력(itemPrices)에서 그 날짜에 적용되는 단가가 첫 단가가 아니면 "(YYMMDD단가개정)"을 붙인다.
// 계산만 하고 저장은 server.js 가 한다.

const won = (n) => Math.round(Number(n || 0));

// 비교용 이름: 공백·괄호·구분 기호를 뺀다. "45x35 (앞솜)-카시트속커버" → "45x35앞솜카시트속커버"
export function lineKey(text) {
  return String(text ?? "").normalize("NFKC").toLowerCase()
    .replace(/[*×]/g, "x").replace(/[\s()[\]{}\/,.\-_~·]+/g, "");
}

// 줄 이름에 적힌 사이즈 표시. "목줄 S (4/2누락분추가)" → S, "리드줄(레드/1.2M)" → 1.2M, "하네스 S,M" → S와 M 둘 다.
const SIZE_WORDS = ["XS", "S", "M", "L", "XL", "SM", "ML"];
export function sizeTags(text) {
  const up = String(text ?? "").normalize("NFKC").toUpperCase();
  const out = new Set();
  for (const tok of up.split(/[^A-Z0-9.]+/)) {
    if (SIZE_WORDS.includes(tok)) out.add(tok);
    const m = tok.match(/^(\d+(?:\.\d+)?)M?$/);
    if (m && /[.]/.test(m[1]) || (m && /M$/.test(tok))) out.add(`${Number(m[1])}M`);
    if (tok === "2.0") out.add("2M");
  }
  return out;
}
const itemSize = (item) => String(item.sizeTag || "").toUpperCase();

// 품목의 날짜별 단가(오래된 것부터).
export function priceSteps(prices, itemId) {
  return (prices || []).filter((p) => p.itemId === itemId && !p.voided)
    .sort((a, b) => String(a.effectiveFrom).localeCompare(String(b.effectiveFrom)) || String(a.createdAt).localeCompare(String(b.createdAt)));
}
export function priceAt(prices, itemId, date) {
  const steps = priceSteps(prices, itemId);
  let hit = null;
  for (const s of steps) if (!date || String(s.effectiveFrom) <= String(date)) hit = s;
  return hit;
}
// "(261108단가개정)" — 그 날짜에 쓰는 단가가 처음 단가가 아니면.
export function revisionLabel(prices, itemId, date) {
  const steps = priceSteps(prices, itemId);
  const at = priceAt(prices, itemId, date);
  if (!at || steps.indexOf(at) <= 0) return "";
  return `(${String(at.effectiveFrom).slice(2, 10).replace(/-/g, "")}단가개정)`;
}

// 상세내역 → 줄 목록. lineId = "<상세 id>#<순번>"
export function flattenDetails(details) {
  const out = [];
  for (const d of details || []) {
    (d.lines || []).forEach((l, i) => out.push({
      lineId: `${d.id}#${i}`, detailId: d.id, date: d.date, item: String(l.item || "").trim(),
      qty: Number(l.qty || 0), unitPrice: won(l.unitPrice), supply: won(l.supply), gross: won(l.gross)
    }));
  }
  return out;
}

// 금액이 이상한 줄(시트에서 옮길 때 깨진 것): 수량은 있는데 단가 0, 또는 단가가 10원 미만.
export const amountSuspicious = (line) => (line.qty > 0 && line.unitPrice === 0) || (line.unitPrice > 0 && line.unitPrice < 10);

// 줄 하나 추천. items: 이 생산처 품목(aliases, sizeTag 포함). learned: 확정된 연결(같은 이름·단가 → 같은 품목).
export function suggestLine(line, { items = [], prices = [], learned = new Map() } = {}) {
  const key = lineKey(line.item);
  const memo = learned.get(`${key}|${line.unitPrice}`);
  if (memo && items.some((i) => i.id === memo)) return { status: "linked", itemId: memo, why: "이전 확인" };
  // 가장 길게 맞는 별칭을 쓰는 품목들 = 한 '가족'(예: 하네스 공임 S·M).
  let best = 0;
  let family = [];
  for (const it of items) {
    for (const a of it.aliases || []) {
      const ak = lineKey(a);
      if (!ak || !key.startsWith(ak)) continue;
      if (ak.length > best) { best = ak.length; family = [it]; }
      else if (ak.length === best && !family.includes(it)) family.push(it);
    }
  }
  if (!family.length) return null;
  // 나중에 생긴 품목(뉴 이케코백 등)은 그 전 날짜 줄에 추천하지 않는다.
  const current = family.filter((it) => !it.validFrom || !line.date || String(it.validFrom) <= String(line.date));
  if (current.length) family = current;
  if (family.length === 1) return { status: "linked", itemId: family[0].id, why: "팩스 표기" };
  // 사이즈가 적혀 있으면 그 사이즈
  const tags = sizeTags(line.item);
  const sized = family.filter((it) => itemSize(it) && tags.has(itemSize(it)));
  if (sized.length === 1) return { status: "linked", itemId: sized[0].id, why: "사이즈 표기" };
  // 단가가 한 품목과만 맞으면 그것(이케코백 SM 15,300 / ML 16,000 / 뉴 ML 16,800)
  const known = (it) => new Set(priceSteps(prices, it.id).map((p) => won(p.price)));
  const cands = sized.length ? sized : family;
  const byPrice = cands.filter((it) => known(it).has(line.unitPrice));
  if (byPrice.length === 1) return { status: "linked", itemId: byPrice[0].id, why: sized.length ? "사이즈+단가" : "단가 일치" };
  const pool = byPrice.length > 1 ? byPrice : cands;
  return { status: "unsized", itemIds: pool.map((it) => it.id), why: tags.size > 1 ? "사이즈 여러 개" : "사이즈 미기재" };
}

// --- 생산처별 기본 품목(처음 한 번 만드는 후보) -----------------------------------
// 세림통상: 2026-11-25 사용자 확인한 후보표. 단가는 VAT 별도, 날짜는 팩스(상세내역)에 처음 보인 날.
// type: LB 공임 · SB 부자재 · OP 외주가공 · FR 운임 · OT 기타. prices 가 비면 매번 금액 입력.
export const PRESETS = {
  세림통상: [
    { name: "카시트 공임 · 오렌지", type: "LB", group: "카시트", aliases: ["카시트 오렌지"], prices: [["2024-04-12", 36500], ["2026-04-28", 37550], ["2026-06-23", 38090], ["2026-07-13", 38940]] },
    { name: "카시트 공임 · 카키", type: "LB", group: "카시트", aliases: ["카시트 카키"], prices: [["2024-05-07", 36500], ["2026-07-03", 38940]] },
    { name: "카시트 공임 · 블랙", type: "LB", group: "카시트", aliases: ["카시트 블랙"], prices: [["2024-06-27", 31000], ["2026-05-06", 32050], ["2026-06-30", 33640]] },
    { name: "카시트 공임 · 네이비(블루)", type: "LB", group: "카시트", aliases: ["카시트 네이비", "카시트 블루"], prices: [["2024-09-06", 32500], ["2026-06-23", 35140]] },
    { name: "카시트 공임 · 아이보리", type: "LB", group: "카시트", aliases: ["카시트 아이보리"], prices: [["2024-09-20", 32500], ["2026-05-22", 33550], ["2026-07-13", 35140]] },
    { name: "이케코백 공임 · SM", type: "LB", group: "이케코백", sizeTag: "SM", aliases: ["이케코백", "이케코"], prices: [["2026-06-26", 15300]] },
    { name: "이케코백 공임 · ML", type: "LB", group: "이케코백", sizeTag: "ML", aliases: ["이케코백", "이케코"], prices: [["2026-06-26", 16000]] },
    // 사용자가 2026-11-25 직접 만든 품목(LB-0001)을 그대로 쓴다. 웨빙 어깨끈을 빼고 제원단 어깨끈으로 바꾸며 800원 인상.
    { name: "뉴 이케코백 ML 공임", type: "LB", group: "이케코백 어깨끈 제원단 ver", sizeTag: "ML", validFrom: "2026-09-11", aliases: ["이케코백", "이케코"], prices: [["2026-09-11", 16800]] },
    { name: "뉴 이케코백 SM 공임", type: "LB", group: "이케코백 어깨끈 제원단 ver", sizeTag: "SM", validFrom: "2026-09-11", aliases: ["이케코백", "이케코"], prices: [] },
    { name: "이케코백 어깨끈(제원단)", type: "SB", group: "이케코백 어깨끈 제원단 ver", aliases: ["이케코백 어깨끈"], prices: [["2026-09-16", 1100]] },
    { name: "메쉬백 공임 · ML", type: "LB", group: "메쉬백", sizeTag: "ML", aliases: ["메쉬백"], prices: [["2026-06-23", 8100]] },
    { name: "하네스 공임 · S", type: "LB", group: "하네스", sizeTag: "S", aliases: ["하네스"], prices: [["2024-05-07", 4300]] },
    { name: "하네스 공임 · M", type: "LB", group: "하네스", sizeTag: "M", aliases: ["하네스"], prices: [["2024-05-07", 4300]] },
    { name: "목줄 공임 · S", type: "LB", group: "목줄", sizeTag: "S", aliases: ["목줄"], prices: [["2024-08-12", 2800]] },
    { name: "목줄 공임 · M", type: "LB", group: "목줄", sizeTag: "M", aliases: ["목줄"], prices: [["2024-08-12", 2800]] },
    { name: "리드줄 공임 · 1.2m", type: "LB", group: "리드줄", sizeTag: "1.2M", aliases: ["리드줄"], prices: [["2024-01-10", 2800]] },
    { name: "리드줄 공임 · 2m", type: "LB", group: "리드줄", sizeTag: "2M", aliases: ["리드줄"], prices: [["2024-01-10", 2800]] },
    { name: "쿨파우치 공임", type: "LB", aliases: ["쿨파우치"], prices: [["2026-06-17", 2800]] },
    { name: "콘디 블랭킷 임가공", type: "LB", aliases: ["콘디 블랭킷", "콘디 임가공"], prices: [["2025-07-14", 1600]] },
    { name: "캐리어(헤지스) 공임", type: "LB", aliases: ["캐리어 헤지스", "캐리어"], prices: [["2024-08-26", 20000]] },
    { name: "이케코 메쉬작업", type: "LB", aliases: ["이케코 매쉬"], prices: [["2024-08-02", 6500]] },
    { name: "베개 공임(샘플·봉제)", type: "LB", aliases: ["베개"], prices: [["2026-11-09", 4000]] },
    { name: "카시트 속커버 45×35 (앞솜)", type: "SB", group: "카시트 속커버", aliases: ["45x35", "속커버 45x35", "속커버(45*35)"], prices: [["2026-03-12", 600]] },
    { name: "카시트 속커버 60×35 (옆솜)", type: "SB", group: "카시트 속커버", aliases: ["60x35", "속커버 60x35", "속커버(60*35)"], prices: [["2026-03-12", 750]] },
    { name: "카시트 속커버 45×60 (스텝온)", type: "SB", group: "카시트 속커버", aliases: ["45x60", "속커버 45x60"], prices: [["2026-03-12", 900]] },
    { name: "인쇄", type: "OP", aliases: ["인쇄"], prices: [["2024-04-29", 16500]] },
    { name: "운임(세림 출고)", type: "FR", aliases: ["운임", "택배비"], prices: [] },
    { name: "샘플 제작", type: "OT", aliases: ["샘플", "이케코 샘플"], prices: [] },
    { name: "수선", type: "OT", aliases: ["수선", "목줄 수선"], prices: [] }
  ]
};
