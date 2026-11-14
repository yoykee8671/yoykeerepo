// 판매처별 가격 체계 (v2, docs/v2/README.md §9).
//
// 3단 구조:
//   1) 품목 기준가 — 정가(소비자가, VAT 포함). NPB 제품(listPrice) 또는 단가표 품목(IT-).
//   2) 판매처 기본 규칙 — 정가 그대로 / 할인율 / 공급률 / 품목별 고정가, VAT 포함·별도,
//      끝전 처리, 판매수수료율.
//   3) 판매처 × 품목 예외 — 기본 규칙과 다른 칸만. 적용 기간이 있으면 그 기간에만 쓴다.
// 값을 찾는 순서: 예외(기간 안, 가장 최근 시작) → 기본 규칙 → 정가.
// 모르는 칸은 질문(확인 필요)으로 만든다.

export const CHANNEL_TYPES = {
  own_mall: "자사몰",
  open_market: "오픈마켓",
  b2b_mall: "B2B몰",
  wholesale: "도매",
  offline: "오프라인",
  group_buy: "공구·행사"
};

export const PRICING_MODES = {
  list: "정가 그대로",
  discount: "정가 대비 할인율",
  supply_rate: "정가 대비 공급률",
  fixed: "품목별 고정가"
};

export const ROUND_UNITS = [1, 10, 100];
export const ROUND_METHODS = { round: "반올림", floor: "절사", ceil: "올림" };

const num = (v) => {
  const n = Number(String(v ?? "").replace(/,/g, ""));
  return Number.isFinite(n) ? n : 0;
};

// 끝전 처리. unit 1/10/100, method round/floor/ceil.
export function roundPrice(value, unit = 1, method = "round") {
  const u = ROUND_UNITS.includes(Number(unit)) ? Number(unit) : 1;
  const fn = method === "floor" ? Math.floor : method === "ceil" ? Math.ceil : Math.round;
  // 부동소수 오차(19.999999) 때문에 절사가 한 단위 내려가지 않게 아주 작게 보정한다.
  return fn(Number(value) / u + (method === "floor" ? 1e-9 : method === "ceil" ? -1e-9 : 0)) * u;
}

// VAT 포함 금액 → 공급가·세액. 명세서와 같은 규칙(공급가 = 반올림(합계/1.1)).
export function splitVat(gross) {
  const total = Math.round(num(gross));
  const supply = Math.round(total / 1.1);
  return { total, supply, vat: total - supply };
}

// 판매처 기본값을 채운다.
export function normalizeChannel(c = {}) {
  const mode = PRICING_MODES[c.pricingMode] ? c.pricingMode : "";
  return {
    ...c,
    name: String(c.name || "").trim(),
    type: CHANNEL_TYPES[c.type] ? c.type : "open_market",
    pricingMode: mode, // "" = 아직 모름 → 질문
    rate: num(c.rate), // 할인율·공급률(%)
    vatMode: c.vatMode === "excluded" ? "excluded" : "included",
    roundUnit: ROUND_UNITS.includes(Number(c.roundUnit)) ? Number(c.roundUnit) : 1,
    roundMethod: ROUND_METHODS[c.roundMethod] ? c.roundMethod : "round",
    feeRate: num(c.feeRate), // %
    partnerId: c.partnerId || "",
    npbChannelCodes: Array.isArray(c.npbChannelCodes) ? c.npbChannelCodes.filter(Boolean) : [],
    active: c.active !== false
  };
}

// 규칙(또는 예외) 하나를 정가에 적용한 VAT 포함가. 정할 수 없으면 null.
function applyRule(rule, listPrice, fixedValue) {
  const base = num(listPrice);
  switch (rule.mode) {
    case "list": return base > 0 ? base : null;
    case "discount": return base > 0 ? base * (1 - num(rule.rate) / 100) : null;
    case "supply_rate": return base > 0 ? base * (num(rule.rate) / 100) : null;
    case "fixed": return fixedValue > 0 ? fixedValue : null;
    default: return null;
  }
}

const inPeriod = (x, date) => (!x.from || x.from <= date) && (!x.to || x.to >= date);

// 판매처 × 품목 가격 찾기.
//   channel: normalizeChannel 결과
//   item: { ref, name, listPrice }
//   exceptions: [{ channelId, itemRef, mode, rate, price, vatMode, from, to }]
// 돌려주는 값: { status: 'ok'|'missing', source: 'exception'|'rule'|'list'|'',
//   gross(VAT포함), supply, vat, unitPrice(판매처 금액 기준에 맞춘 단가), note }
export function resolvePrice({ channel, item, exceptions = [], date = "" }) {
  const ch = normalizeChannel(channel);
  const day = String(date || "").slice(0, 10) || "9999-12-31";
  const mine = exceptions
    .filter((x) => x.channelId === ch.id && x.itemRef === item.ref && x.active !== false && inPeriod(x, day))
    .sort((a, b) => String(b.from || "").localeCompare(String(a.from || "")) || String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

  let gross = null;
  let source = "";
  let note = "";
  let vatMode = ch.vatMode;
  // 예외는 가격만, 수수료만, 둘 다 적을 수 있다(브랜드마다 수수료가 다른 판매처).
  const ex = mine.find((x) => x.mode);
  const feeEx = mine.find((x) => x.feeRate !== undefined && x.feeRate !== null && x.feeRate !== "");
  const feeRate = feeEx ? num(feeEx.feeRate) : ch.feeRate;
  if (ex) {
    // 예외의 가격은 그 예외의 금액 기준(VAT 포함/별도)으로 적는다.
    const exVat = ex.vatMode || ch.vatMode;
    const fixed = ex.mode === "fixed" && exVat === "excluded" ? Math.round(num(ex.price) * 1.1) : num(ex.price);
    gross = applyRule({ mode: ex.mode || "fixed", rate: ex.rate }, item.listPrice, fixed);
    if (gross != null) {
      source = "exception";
      vatMode = exVat;
      note = ex.to ? `${ex.from || ""}~${ex.to} 예외` : "품목 예외";
    }
  }
  if (gross == null && ch.pricingMode && ch.pricingMode !== "fixed") {
    gross = applyRule({ mode: ch.pricingMode, rate: ch.rate }, item.listPrice);
    if (gross != null) {
      source = ch.pricingMode === "list" ? "list" : "rule";
      note = ch.pricingMode === "list" ? "정가" : `${PRICING_MODES[ch.pricingMode]} ${ch.rate}%`;
    }
  }
  if (gross == null) {
    return { status: "missing", source: "", gross: 0, supply: 0, vat: 0, unitPrice: 0, vatMode: ch.vatMode, feeRate,
      note: !ch.pricingMode ? "판매처 가격 방식 미지정" : ch.pricingMode === "fixed" ? "고정가 미입력" : "정가 없음" };
  }

  // 끝전 처리는 판매처 금액 기준 쪽에 한다(VAT 별도 판매처는 공급가 끝전을 맞춘다).
  let unitPrice;
  let split;
  if (vatMode === "excluded") {
    unitPrice = source === "exception" && ex?.mode === "fixed"
      ? Math.round(num(ex.price))
      : roundPrice(gross / 1.1, ch.roundUnit, ch.roundMethod);
    split = { total: unitPrice + Math.round(unitPrice * 0.1), supply: unitPrice, vat: Math.round(unitPrice * 0.1) };
  } else {
    unitPrice = source === "exception" && ex?.mode === "fixed" ? Math.round(gross) : roundPrice(gross, ch.roundUnit, ch.roundMethod);
    split = splitVat(unitPrice);
  }
  return { status: "ok", source, gross: split.total, supply: split.supply, vat: split.vat, unitPrice, vatMode, feeRate,
    exceptionId: source === "exception" ? ex.id : "", note };
}

// 판매처 하나의 가격표(품목 전체).
export function priceSheet({ channel, items = [], exceptions = [], date = "" }) {
  return items.map((item) => ({ ref: item.ref, code: item.code || "", name: item.name, brandId: item.brandId || "",
    listPrice: num(item.listPrice), ...resolvePrice({ channel, item, exceptions, date }) }));
}

// 실제로 쓴 단가와 계산값 비교 → 다르면 질문 후보.
//   used: [{ channelId, itemRef, itemName, unitPrice, vatMode, date, docNo }]
export function priceMismatches({ channels = [], items = [], exceptions = [], used = [] }) {
  const chById = new Map(channels.map((c) => [c.id, c]));
  const itemByRef = new Map(items.map((i) => [i.ref, i]));
  const latest = new Map();
  for (const u of used) {
    const k = `${u.channelId}|${u.itemRef}`;
    if (!latest.has(k) || String(u.date) > String(latest.get(k).date)) latest.set(k, u);
  }
  const out = [];
  for (const u of latest.values()) {
    const ch = chById.get(u.channelId);
    const item = itemByRef.get(u.itemRef);
    if (!ch || !item) continue;
    const r = resolvePrice({ channel: ch, item, exceptions, date: u.date });
    const usedGross = (u.vatMode || ch.vatMode) === "excluded" ? Math.round(num(u.unitPrice) * 1.1) : Math.round(num(u.unitPrice));
    if (r.status === "ok" && Math.abs(r.gross - usedGross) <= 1) continue;
    out.push({ channel: ch, item, used: u, usedGross, computed: r });
  }
  return out;
}

// 질문(확인 필요) 만들기.
export function pricingQuestions({ channels = [], items = [], exceptions = [], used = [], hints = {} }) {
  const qs = [];
  for (const c of channels.map(normalizeChannel)) {
    if (!c.active || c.pricingMode) continue;
    const h = hints[c.id] || {};
    const detail = [`판매처 '${c.name}'의 기본 가격 방식이 정해지지 않았습니다.`];
    if (h.supplyRate) detail.push(`참고: NPB 채널 설정의 공급가는 정가의 약 ${h.supplyRate}%입니다.`);
    if (h.feeRate) detail.push(`NPB 판매수수료 ${h.feeRate}%.`);
    qs.push({
      id: `price-rule:${c.id}`, topic: "pricing", kind: "channel-rule", subjectId: c.id,
      title: `${c.name}: 기본 가격 방식은?`, detail: detail.join(" "),
      choices: [
        { key: "list", label: "정가 그대로" },
        { key: "discount", label: "정가에서 할인율(%)", input: "rate" },
        { key: "supply_rate", label: "정가의 공급률(%)", input: "rate", ...(h.supplyRate ? { value: h.supplyRate } : {}) },
        { key: "fixed", label: "품목마다 고정가" }
      ],
      ...(h.supplyRate ? { suggested: "supply_rate" } : {})
    });
  }
  for (const m of priceMismatches({ channels, items, exceptions, used })) {
    const won = (n) => `${Math.round(n).toLocaleString("ko-KR")}원`;
    const vatLabel = (m.used.vatMode || m.channel.vatMode) === "excluded" ? "VAT 별도" : "VAT 포함";
    qs.push({
      id: `price-item:${m.channel.id}:${m.item.ref}`, topic: "pricing", kind: "channel-price", subjectId: m.channel.id,
      title: `${m.channel.name} · ${m.item.name} 단가는?`,
      detail: `최근 ${m.used.docNo || "명세서"}(${m.used.date || ""}) ${won(m.used.unitPrice)}(${vatLabel}) / 계산값 ${m.computed.status === "ok" ? won(m.computed.unitPrice) : `없음(${m.computed.note})`}`,
      choices: [
        { key: "fixed-used", label: `${won(m.used.unitPrice)} 고정`, value: Math.round(num(m.used.unitPrice)) },
        { key: "input", label: "다른 금액 입력", input: "amount" },
        ...(m.computed.status === "ok" ? [{ key: "keep-rule", label: `규칙대로(${won(m.computed.unitPrice)})` }] : []),
        { key: "once", label: "그때만 그 가격(저장 안 함)" }
      ],
      payload: { itemRef: m.item.ref, vatMode: m.used.vatMode || m.channel.vatMode }
    });
  }
  return qs;
}

// NPB 채널 설정 → 판매처 씨앗. 브랜드별로 나뉜 같은 판매처(coupang / picky_coupang)를 하나로 묶는다.
const ALIAS = { b2c: "wooofmall", sparkpet: "spark", wooofmall: "wooofmall" };
export function channelKeyFromNpb(code) {
  const base = String(code || "").replace(/^picky_/, "");
  return ALIAS[base] || base;
}

export function seedChannelsFromNpb(npbChannels = [], existing = []) {
  const byKey = new Map(existing.map((c) => [c.seedKey || "", c]));
  const groups = new Map();
  for (const n of npbChannels) {
    const key = channelKeyFromNpb(n.code);
    (groups.get(key) || groups.set(key, []).get(key)).push(n);
  }
  const created = [];
  const hints = {};
  for (const [key, list] of groups) {
    // 한글 이름이 있는 쪽을 대표 이름으로.
    const named = list.find((n) => /[가-힣]/.test(n.name || "")) || list[0];
    const typeOf = () => {
      const s = `${named.name} ${named.note || ""} ${key}`;
      if (/자사|cafe24|wooofmall/i.test(s)) return "own_mall";
      if (/b2b|사업자|대리점/i.test(s)) return "b2b_mall";
      if (/공구|행사|팝업|offmarket|popup/i.test(s)) return "group_buy";
      if (/이마트|emart|오프라인/i.test(s)) return "offline";
      return "open_market";
    };
    const rates = list.filter((n) => num(n.salePrice) > 0 && num(n.supplyPrice) > 0)
      .map((n) => Math.round((num(n.supplyPrice) / num(n.salePrice)) * 1000) / 10);
    const fees = list.map((n) => Math.round(num(n.feeRate) * 1000) / 10).filter((f) => f > 0);
    const vatExcluded = list.some((n) => n.vatIncluded === false);
    let ch = byKey.get(key);
    if (!ch) {
      ch = normalizeChannel({ seedKey: key, name: named.name, type: typeOf(), pricingMode: "",
        vatMode: vatExcluded ? "excluded" : "included", feeRate: fees.length ? Math.max(...fees) : 0,
        npbChannelCodes: list.map((n) => n.code) });
      created.push(ch);
    } else {
      ch.npbChannelCodes = [...new Set([...(ch.npbChannelCodes || []), ...list.map((n) => n.code)])];
    }
    hints[key] = { supplyRate: rates.length ? rates[0] : 0, feeRate: fees.length ? Math.max(...fees) : 0 };
  }
  return { created, hints };
}

// NPB 채널 설정의 브랜드별 값 → 판매처 × 품목 예외 씨앗.
//   공급가가 적혀 있으면 그 브랜드 제품의 고정가로, 수수료율이 판매처 기본값과 다르면 수수료 예외로.
//   channels: seedKey 가 있는 판매처(코드 붙은 뒤), products: NPB 제품
export function seedExceptionsFromNpb(npbChannels = [], channels = [], products = []) {
  const byKey = new Map(channels.map((c) => [c.seedKey, c]));
  const out = [];
  for (const n of npbChannels) {
    const ch = byKey.get(channelKeyFromNpb(n.code));
    if (!ch) continue;
    const fee = Math.round(num(n.feeRate) * 1000) / 10;
    for (const p of products.filter((x) => x.brandId === n.brandId)) {
      const x = { id: `seed:${ch.id}:npb:${p.id}`, channelId: ch.id, itemRef: `npb:${p.id}`, source: "NPB 채널 설정", note: n.code };
      if (num(n.supplyPrice) > 0) Object.assign(x, { mode: "fixed", price: num(n.supplyPrice), vatMode: n.vatIncluded === false ? "excluded" : "included" });
      if (fee !== num(ch.feeRate)) x.feeRate = fee;
      if (x.mode || x.feeRate !== undefined) out.push(x);
    }
  }
  return out;
}
