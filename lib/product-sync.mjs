// 공급사 상품 동기화 — 판단 로직만 모아 둔 곳 (네트워크·저장 없음).
//
// 흐름
//   1) 본사 사이트를 읽는다 (brand-source-cafe24).
//   2) 우프(카페24)에 연결된 상품의 실제 상태를 읽는다 (cafe24-api).
//   3) 둘을 맞대어 "어긋난 점(issue)"을 만든다 ← 이 파일.
//   4) 사람이 화면에서 버튼을 누르면 issue 에 담긴 action 을 카페24에 쓴다.
//
// "지난번과 달라졌나"가 아니라 "지금 우프가 본사와 같은가"를 본다. 지난번과의
// 차이만 보면 처음부터 어긋나 있던 것(이미 재입고됐는데 우프만 품절)은 영영
// 안 잡힌다. 실제로 첫 비교에서 써멀업 패딩 카키 3L·그레이 L 재입고 누락,
// 블루베리 샤워가운 S 품절 누락이 나왔다.
//
// 우프의 품절 표시 방식: 공급사들이 "재고관리 사용 + 수량 0 → 자동 품절"로
// 쓰고 있다(옵션별 is_auto_soldout). 동기화도 같은 방식을 따른다 — 판매안함으로
// 바꾸면 공급사 어드민에서 보는 화면과 어긋난다.

export const PRODUCT_SYNC_ROW_ID = "product_sync";
export const HISTORY_LIMIT = 500;

// 매일 이 시각(한국시간)이 지나면 한 번씩 돈다.
export const DEFAULT_RUN_HOURS_KST = [9, 17];

export const DEFAULT_SOURCES = {
  munikund: {
    id: "munikund",
    name: "MUNIKUND",
    platform: "cafe24",
    // 우프 상품명 앞에 붙이는 브랜드명. 기존 72개가 모두 "뮤니쿤트 ..." 형식이다.
    namePrefix: "뮤니쿤트",
    baseUrl: "https://munikund.com",
    // SHOP 전체 카테고리. 본사에 진열된 168개가 모두 여기 있다(2026-10-15 확인).
    categoryNos: [24],
    enabled: true,
    // 신상품 기준: 본사 등록일(추정)이 이 일수 안이면 후보로 올린다. 3개월.
    recentDays: 92,
    // 재입고 때 넣는 재고 수량. 본사 실제 재고는 공개되지 않으므로 넉넉히 둔다.
    restockQuantity: 99,
    // 정방형 썸네일 중 배경이 흰색(FFF)인 누끼컷은 이 색으로 multiply 해서 올린다.
    thumbnailMultiply: "F7F7F7",
    // 신규 등록 때 공급사·카테고리·공급가 비율 등을 복사해 올 우프 기준 상품번호.
    // 비어 있으면 연결된 상품 중 가장 최근 것을 쓴다.
    templateProductNo: null,
    // 옵션값 번역표(본사 → 우프). 사이즈처럼 같은 값은 적을 필요 없다.
    // 예: { "Bloom Blue": "블룸 블루" }. 상품별로 다르면 링크의 valueMap 이 우선한다.
    valueMap: {}
  },
  // 앤블랭크 — 아임웹 사이트. 상품 목록은 sitemap.xml, 옵션은 load_option.cm 으로 읽는다
  // (lib/brand-source-imweb.mjs). 뮤니쿤트와 연결표·본사 상태·설정을 따로 둔다.
  andblank: {
    id: "andblank",
    name: "앤블랭크",
    platform: "imweb",
    namePrefix: "앤블랭크",
    baseUrl: "https://andblank.com",
    categoryNos: [],
    enabled: true,
    recentDays: 92,
    restockQuantity: 99,
    thumbnailMultiply: "F7F7F7",
    templateProductNo: null,
    valueMap: {}
  }
};

export function buildSyncState() {
  return {
    __rev: 0,
    runHoursKst: [...DEFAULT_RUN_HOURS_KST],
    sources: Object.fromEntries(
      Object.entries(DEFAULT_SOURCES).map(([id, settings]) => [id, buildSourceState(settings)])
    ),
    history: []
  };
}

export function buildSourceState(settings) {
  return {
    ...structuredClone(settings),
    // 우프 상품번호 → { sourceNo, sourceFilter, valueMap, optionMap, linkedAt, linkedBy, note }
    // 우프 상품 기준으로 둔다. 본사 한 상품(색상×사이즈)을 우프가 색상별 여러
    // 상품으로 나눠 올린 경우가 있어서(버그가드 캡 M-Band 옐로우/코랄/네이비 ↔
    // 본사 Bug Guard Cap : 3Colors) 본사 하나에 우프 여럿이 붙을 수 있어야 한다.
    // sourceFilter 는 그때 "본사 옵션 중 이 값(예: M-Band Yellow)만" 이라는 뜻이다.
    links: {},
    // 신상품 후보에서 "등록 안 함"으로 넘긴 본사 상품번호
    ignored: {},
    // 본사 상품 최근 상태 (상품번호 → 요약)
    snapshot: {},
    // 마지막 실행 결과
    // 재고 확인 결과 / 신상품 찾기 결과
    lastRun: null,
    lastScan: null,
    running: null,
    scanning: null,
    issues: [],
    // 본사 상품명·이미지 변경처럼 자동 반영이 어려운 알림
    notices: [],
    // 무시한 issue: key → fingerprint. 값이 또 바뀌면 다시 뜬다.
    dismissed: {}
  };
}

// 저장된 상태에 새로 생긴 기본값을 채운다 (기존 값은 건드리지 않는다).
export function migrateSyncState(state) {
  const next = state && typeof state === "object" ? state : buildSyncState();
  let changed = !state;
  if (!Array.isArray(next.runHoursKst)) {
    next.runHoursKst = [...DEFAULT_RUN_HOURS_KST];
    changed = true;
  }
  if (!Array.isArray(next.history)) {
    next.history = [];
    changed = true;
  }
  if (!next.sources || typeof next.sources !== "object") {
    next.sources = {};
    changed = true;
  }
  for (const [id, settings] of Object.entries(DEFAULT_SOURCES)) {
    if (!next.sources[id]) {
      next.sources[id] = buildSourceState(settings);
      changed = true;
      continue;
    }
    const seed = buildSourceState(settings);
    for (const key of Object.keys(seed)) {
      if (!(key in next.sources[id])) {
        next.sources[id][key] = seed[key];
        changed = true;
      }
    }
  }
  return { state: next, changed };
}

// --- 비교 -------------------------------------------------------------------

export function normalize(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s_\-·/:()[\]]+/g, "");
}

function money(value) {
  const n = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : 0;
}

export function wooofVariantValues(variant) {
  return (variant?.options || []).map((option) => String(option.value ?? ""));
}

export function wooofVariantLabel(variant) {
  const values = wooofVariantValues(variant);
  return values.length ? values.join(" / ") : "(단일상품)";
}

// 우프 품목이 지금 살 수 있는 상태인가. 공급사 방식: 재고관리 사용 + 수량 0 =
// 품절. 재고관리를 안 쓰면 수량과 무관하게 판매된다.
export function wooofSellable(variant) {
  if (!variant) return false;
  if (variant.selling === "F" || variant.display === "F") return false;
  if (variant.use_inventory === "T" && variant.display_soldout !== "F" && money(variant.quantity) <= 0) return false;
  return true;
}

export function sourceSellable(product, option) {
  if (!product || product.missing || product.soldOut) return false;
  if (!option) return true;
  return option.selling !== false && option.display !== false;
}

// 본사 옵션 중 sourceFilter 값을 가진 것만 남기고, 그 값은 비교에서 뺀다.
// "M-Band Yellow / 3호" → (필터 M-Band Yellow) → "3호" 로 우프 단일 사이즈 상품과 짝.
export function filterSourceOptions(options, sourceFilter) {
  const filter = normalize(sourceFilter);
  if (!filter) return options;
  return options
    .filter((option) => (option.values || []).some((value) => normalize(value) === filter))
    .map((option) => {
      const keep = [];
      (option.values || []).forEach((value, index) => {
        if (normalize(value) !== filter) keep.push(index);
      });
      const values = keep.map((index) => option.values[index]);
      return {
        ...option,
        values,
        names: keep.map((index) => option.names?.[index]).filter(Boolean),
        label: values.join(" / "),
        fullLabel: option.label
      };
    });
}

export function stripNote(value) {
  const stripped = String(value ?? "").replace(/\s*[([（][^)\]）]*[)\]）]\s*/g, " ").trim();
  return stripped || String(value ?? "");
}

function translate(value, ...maps) {
  for (const map of maps) {
    if (!map) continue;
    const hit = Object.entries(map).find(([from]) => normalize(from) === normalize(value));
    if (hit) return hit[1];
  }
  return value;
}

// 본사 옵션과 우프 품목을 짝짓는다.
//   1) 링크에 적어 둔 옵션 대응표(optionMap: 본사 라벨 → 우프 라벨)
//   2) 값 번역표(valueMap)로 값마다 바꾼 뒤 정규화해서 같으면 짝
//   3) 옵션 없는 상품끼리는 하나뿐인 품목끼리 짝
// 짝이 안 맞는 것은 그대로 돌려줘서 화면에 "옵션 연결 필요"로 보인다.
export function matchOptions(sourceProduct, wooofVariants, { valueMap = {}, linkValueMap = {}, optionMap = {}, sourceFilter = "" } = {}) {
  const variants = [...(wooofVariants || [])];
  const sourceOptions = filterSourceOptions(sourceProduct?.options || [], sourceFilter);
  const pairs = [];
  const used = new Set();

  if (!sourceOptions.length) {
    if (variants.length === 1) {
      pairs.push({ source: null, variant: variants[0] });
      used.add(variants[0].variant_code);
    }
    return {
      pairs,
      unmatchedSource: [],
      unmatchedWooof: variants.filter((v) => !used.has(v.variant_code))
    };
  }

  const byLabel = new Map();
  for (const variant of variants) byLabel.set(normalize(wooofVariantValues(variant).join("")), variant);
  // 괄호 안 안내 문구를 뺀 이름. 본사가 "1호 (10/21 순차배송)"처럼 옵션명에 안내를
  // 붙였다 떼었다 하고, 우프에서 등록 후 그 문구를 지우기도 한다.
  const byBareLabel = new Map();
  for (const variant of variants) {
    const key = normalize(wooofVariantValues(variant).map(stripNote).join(""));
    if (!byBareLabel.has(key)) byBareLabel.set(key, variant);
    else byBareLabel.set(key, null); // 괄호를 빼면 겹치는 경우엔 이 방법을 쓰지 않는다
  }
  const byOrderedLabel = new Map();
  for (const variant of variants) byOrderedLabel.set(normalize(wooofVariantLabel(variant)), variant);

  const bareSourceCount = new Map();
  for (const option of sourceOptions) {
    const key = normalize(option.values.map((value) => translate(stripNote(value), linkValueMap, valueMap)).join(""));
    bareSourceCount.set(key, (bareSourceCount.get(key) || 0) + 1);
  }
  const unmatchedSource = [];
  for (const option of sourceOptions) {
    let variant = null;
    const mapped = Object.entries(optionMap || {}).find(([from]) => normalize(from) === normalize(option.label));
    if (mapped) variant = byOrderedLabel.get(normalize(mapped[1])) || byLabel.get(normalize(mapped[1]));
    if (!variant) {
      const translated = option.values.map((value) => translate(value, linkValueMap, valueMap));
      variant = byLabel.get(normalize(translated.join("")));
      if (!variant || used.has(variant.variant_code)) {
        // 괄호를 뺀 이름이 양쪽 모두에서 하나뿐일 때만 짝짓는다. "M (Kids)"와
        // "M (Adult)"가 같이 있으면 어느 쪽이 맞는지 알 수 없다.
        const bareKey = normalize(option.values.map((value) => translate(stripNote(value), linkValueMap, valueMap)).join(""));
        const bare = bareSourceCount.get(bareKey) === 1 ? byBareLabel.get(bareKey) : null;
        if (bare) variant = bare;
      }
    }
    if (variant && !used.has(variant.variant_code)) {
      pairs.push({ source: option, variant });
      used.add(variant.variant_code);
    } else {
      unmatchedSource.push(option);
    }
  }
  return {
    pairs,
    unmatchedSource,
    unmatchedWooof: variants.filter((v) => !used.has(v.variant_code))
  };
}

function soldOutPatch() {
  return { use_inventory: "T", display_soldout: "T", quantity: 0 };
}

// 재입고는 재고 수량만 채운다. 우프에서 진열·판매를 꺼 둔 품목은 사람이 일부러
// 내린 것일 수 있어서 건드리지 않는다(재입고 대상에서도 뺀다).
function restockPatch(quantity) {
  return { use_inventory: "T", display_soldout: "T", quantity };
}

function wooofHiddenOnPurpose(variant) {
  return variant?.selling === "F" || variant?.display === "F";
}

// 한 상품에 대해 우프가 본사와 어긋난 점을 모두 뽑는다.
// source: 수집한 본사 상품(없으면 null = 본사 삭제), wooof: 카페24 상품(variants 포함)
export function computeIssues({ sourceId, sourceNo, source, wooof, link, settings }) {
  const issues = [];
  const wooofNo = Number(link?.wooofProductNo || wooof?.product_no || 0);
  const base = { sourceId, sourceNo: Number(sourceNo), wooofProductNo: wooofNo, sourceFilter: link?.sourceFilter || "" };
  const productLabel = wooof?.product_name || source?.name || `본사 ${sourceNo}`;
  const push = (issue) => issues.push({
    ...base,
    productName: productLabel,
    sourceName: source?.name || "",
    ...issue,
    key: `${sourceId}:${wooofNo}:${issue.type}:${issue.variantCode || ""}`
  });

  if (!wooof) {
    push({
      type: "wooof_missing",
      severity: "warn",
      message: `연결된 우프 상품(${wooofNo})을 찾을 수 없습니다. 삭제됐다면 연결을 해제하세요.`,
      fingerprint: String(wooofNo)
    });
    return issues;
  }

  const variants = wooof.variants || [];
  const restockQuantity = Math.max(1, Number(settings?.restockQuantity) || 99);

  // 본사를 이번에 못 읽었으면(시간 초과·구조 변경 등) 판단하지 않는다. 삭제(404)와
  // 섞으면 일시적인 접속 오류가 "전체 품절" 제안으로 이어진다.
  if (!source || source.unreadable) {
    push({
      type: "source_unreadable",
      severity: "info",
      message: "본사 상품 정보를 읽지 못해 이번에는 비교하지 않았습니다.",
      fingerprint: "unreadable"
    });
    return issues;
  }

  if (source.optionsUnreadable) {
    push({
      type: "source_unreadable",
      severity: "warn",
      message: "본사 상품에 옵션이 있는데 옵션 정보를 읽지 못했습니다. 이번에는 비교하지 않았습니다.",
      fingerprint: "options-unreadable"
    });
    return issues;
  }

  if (source.missing) {
    const sellable = variants.filter(wooofSellable);
    if (sellable.length) {
      push({
        type: "source_removed",
        severity: "high",
        message: "본사에서 상품이 삭제됐는데 우프는 판매 중입니다.",
        from: `판매중 ${sellable.length}개 옵션`,
        to: "전체 품절",
        fingerprint: "removed",
        action: { kind: "variants", patches: sellable.map((v) => ({ variant_code: v.variant_code, ...soldOutPatch() })) }
      });
    }
    return issues;
  }

  if (source.listed === false) {
    push({
      type: "source_unlisted",
      severity: "info",
      message: "본사 진열 목록에서 빠졌습니다(상세 페이지는 열림). 단종 여부를 확인하세요.",
      fingerprint: "unlisted"
    });
  }

  // 판매가 — 본사 정가 기준.
  if (source.price && money(wooof.price) !== money(source.price)) {
    push({
      type: "price",
      severity: "high",
      message: "판매가가 본사 정가와 다릅니다.",
      from: money(wooof.price),
      to: money(source.price),
      fingerprint: `${money(wooof.price)}>${money(source.price)}`,
      action: { kind: "product", patch: { price: money(source.price) } }
    });
  }

  // 옵션 필터에 맞는 본사 옵션이 하나도 없으면 비교하지 않는다. 그대로 두면
  // 우프 단일품목이 본사 "상품 전체" 상태와 짝지어져 엉뚱한 품절·재입고가 나온다.
  if (link?.sourceFilter && !filterSourceOptions(source.options || [], link.sourceFilter).length) {
    push({
      type: "filter_empty",
      severity: "warn",
      message: `본사 옵션에 "${link.sourceFilter}" 값이 없습니다. 연결의 옵션 필터를 확인하세요.`,
      fingerprint: link.sourceFilter
    });
    return issues;
  }
  const matching = matchOptions(source, variants, {
    valueMap: settings?.valueMap,
    linkValueMap: link?.valueMap,
    optionMap: link?.optionMap,
    sourceFilter: link?.sourceFilter
  });

  for (const [order, { source: option, variant }] of matching.pairs.entries()) {
    const label = option ? option.label : "(단일상품)";
    const shouldSell = sourceSellable(source, option);
    const sells = wooofSellable(variant);
    const common = { variantCode: variant.variant_code, optionLabel: label, wooofOptionLabel: wooofVariantLabel(variant), order };
    if (!shouldSell && sells) {
      push({
        ...common,
        type: "soldout",
        severity: "high",
        message: source.soldOut ? "본사 상품 전체 품절 — 우프는 판매 중" : "본사 품절 — 우프는 판매 중",
        from: "판매중",
        to: "품절",
        fingerprint: "soldout",
        action: { kind: "variants", patches: [{ variant_code: variant.variant_code, ...soldOutPatch() }] }
      });
    } else if (shouldSell && !sells && !wooofHiddenOnPurpose(variant)) {
      push({
        ...common,
        type: "restock",
        severity: "high",
        message: "본사 재입고 — 우프는 품절",
        from: "품절",
        to: `판매 (재고 ${restockQuantity})`,
        fingerprint: "restock",
        action: { kind: "variants", patches: [{ variant_code: variant.variant_code, ...restockPatch(restockQuantity) }] }
      });
    }
    if (option && money(variant.additional_amount) !== money(option.additionalAmount)) {
      push({
        ...common,
        type: "option_price",
        severity: "high",
        message: "옵션 추가금이 본사와 다릅니다.",
        from: money(variant.additional_amount),
        to: money(option.additionalAmount),
        fingerprint: `${money(variant.additional_amount)}>${money(option.additionalAmount)}`,
        action: { kind: "variants", patches: [{ variant_code: variant.variant_code, additional_amount: money(option.additionalAmount) }] }
      });
    }
  }

  // 옵션값 이름: 괄호 안 안내 문구만 다를 때("1호 (10/21 순차배송)" ↔ "1호")
  // 본사에 맞춘다. 한글로 번역해 둔 값(블룸 블루 ↔ Bloom Blue)처럼 뜻이 다른
  // 경우는 건드리지 않는다. 같은 값이 여러 품목에 걸려 있으니 값 하나당 한 건.
  const renames = new Map();
  for (const { source: option, variant } of matching.pairs) {
    if (!option) continue;
    const wooofValues = wooofVariantValues(variant);
    option.values.forEach((sourceValue, index) => {
      const wooofValue = wooofValues[index];
      if (wooofValue === undefined) return;
      const target = String(translate(sourceValue, link?.valueMap, settings?.valueMap)).replace(/\s+/g, " ").trim();
      if (!target || target === wooofValue.replace(/\s+/g, " ").trim()) return;
      if (normalize(stripNote(target)) !== normalize(stripNote(wooofValue))) return;
      const optionName = variant.options?.[index]?.name || "";
      const key = `${index}:${wooofValue}`;
      if (!renames.has(key)) renames.set(key, { name: optionName, from: wooofValue, to: target });
    });
  }
  for (const rename of renames.values()) {
    push({
      type: "option_text",
      variantCode: `opt:${rename.name}:${rename.from}`,
      optionLabel: rename.from,
      severity: "warn",
      message: "본사 옵션명의 안내 문구가 바뀌었습니다.",
      from: rename.from,
      to: rename.to,
      fingerprint: `${rename.from}>${rename.to}`,
      action: { kind: "option_texts", renames: [rename] }
    });
  }

  for (const option of matching.unmatchedSource) {
    push({
      type: "option_unmatched",
      variantCode: `src:${option.code}`,
      optionLabel: option.label,
      severity: "warn",
      message: sourceSellable(source, option)
        ? "본사 옵션과 짝이 되는 우프 옵션이 없습니다 (새 옵션이거나 이름이 다름)."
        : "본사 옵션(품절)과 짝이 되는 우프 옵션이 없습니다.",
      fingerprint: option.label
    });
  }
  for (const variant of matching.unmatchedWooof) {
    push({
      type: "variant_unmatched",
      variantCode: variant.variant_code,
      optionLabel: "",
      wooofOptionLabel: wooofVariantLabel(variant),
      severity: wooofSellable(variant) ? "warn" : "info",
      message: "우프 옵션과 짝이 되는 본사 옵션이 없습니다. 옵션 연결표를 확인하세요.",
      fingerprint: wooofVariantLabel(variant)
    });
  }
  return issues;
}

// 본사 상태 요약 (저장용). 비교에 쓰는 값과 화면에 보여줄 최소한만 남긴다.
export function compactSource(product, previous, nowIso) {
  return {
    name: product.name,
    price: product.price,
    salePrice: product.salePrice,
    soldOut: Boolean(product.soldOut),
    listed: product.listed !== false,
    missing: false,
    unreadable: false,
    optionsUnreadable: Boolean(product.optionsUnreadable),
    url: product.url,
    registeredAt: product.registeredAt || "",
    thumbnail: product.images?.thumbnail || "",
    optionNames: product.optionNames || [],
    options: (product.options || []).map((o) => ({
      code: o.code,
      label: o.label,
      values: o.values,
      selling: o.selling,
      display: o.display,
      additionalAmount: o.additionalAmount,
      // 아임웹: 화면에 보이는 할인 적용가. 다음 확인 때 같으면 추가금을 다시 묻지 않는다.
      ...(o.displayPrice !== undefined ? { displayPrice: o.displayPrice } : {})
    })),
    firstSeenAt: previous?.firstSeenAt || nowIso,
    lastSeenAt: nowIso
  };
}

// 우프와 비교할 수 없는 본사 쪽 변화(상품명·대표이미지). 우프 상품명은 한글
// 번역명이라 자동으로 고칠 수 없고, 사람이 보고 판단하도록 알림만 남긴다.
export function sourceNotices({ sourceId, sourceNo, previous, current, nowIso }) {
  if (!previous || previous.missing || !current) return [];
  const notices = [];
  if (previous.name && current.name !== previous.name) {
    notices.push({
      id: `${sourceId}:${sourceNo}:name:${nowIso}`,
      sourceId,
      sourceNo: Number(sourceNo),
      type: "name_changed",
      message: "본사 상품명이 바뀌었습니다.",
      from: previous.name,
      to: current.name,
      at: nowIso
    });
  }
  if (previous.thumbnail && current.thumbnail && current.thumbnail !== previous.thumbnail) {
    notices.push({
      id: `${sourceId}:${sourceNo}:image:${nowIso}`,
      sourceId,
      sourceNo: Number(sourceNo),
      type: "image_changed",
      message: "본사 대표이미지가 바뀌었습니다.",
      from: previous.thumbnail,
      to: current.thumbnail,
      at: nowIso
    });
  }
  const prevLabels = (previous.options || []).map((o) => o.label).join("|");
  const curLabels = (current.options || []).map((o) => o.label).join("|");
  if (prevLabels && curLabels !== prevLabels) {
    notices.push({
      id: `${sourceId}:${sourceNo}:options:${nowIso}`,
      sourceId,
      sourceNo: Number(sourceNo),
      type: "options_changed",
      message: "본사 옵션 구성이 바뀌었습니다.",
      from: prevLabels.replaceAll("|", ", "),
      to: curLabels.replaceAll("|", ", "),
      at: nowIso
    });
  }
  return notices;
}

export function kstDate(date = new Date()) {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// 신상품 후보: 우프에 연결·등록되지 않았고, 넘기지도 않았고, 본사 등록일이
// 최근 recentDays 안인 본사 상품.
export function newProductCandidates(sourceState, now = new Date()) {
  const recentDays = Number(sourceState.recentDays) || 92;
  const cutoff = kstDate(new Date(now.getTime() - recentDays * 86400000));
  const linked = new Set(Object.values(sourceState.links || {}).map((link) => String(link.sourceNo)));
  const ignored = new Set(Object.keys(sourceState.ignored || {}).map(String));
  return Object.entries(sourceState.snapshot || {})
    .filter(([no, snap]) => !snap.missing && snap.listed !== false)
    .filter(([no]) => !linked.has(String(no)) && !ignored.has(String(no)))
    .filter(([, snap]) => (snap.registeredAt || snap.firstSeenAt?.slice(0, 10) || "") >= cutoff)
    .map(([no, snap]) => ({ sourceNo: Number(no), ...snap }))
    .sort((a, b) => String(b.registeredAt).localeCompare(String(a.registeredAt)) || b.sourceNo - a.sourceNo);
}

// 지금이 실행할 때인가: 오늘(한국시간) 지나간 실행 시각 중 가장 늦은 것보다
// 마지막 실행이 앞서면 돌린다. 서버가 그 시각에 꺼져 있었어도 켜지면 따라잡는다.
export function dueRunSlot(lastRunAt, runHoursKst = DEFAULT_RUN_HOURS_KST, now = new Date()) {
  const kstNow = new Date(now.getTime() + 9 * 3600000);
  const hour = kstNow.getUTCHours();
  const passed = [...runHoursKst].map(Number).filter((h) => h <= hour).sort((a, b) => b - a);
  let slotKst;
  if (passed.length) {
    slotKst = Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate(), passed[0]);
  } else {
    // 오늘 첫 시각 전이면 어제 마지막 시각.
    const last = Math.max(...runHoursKst.map(Number));
    slotKst = Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate() - 1, last);
  }
  const slotUtc = slotKst - 9 * 3600000;
  const last = lastRunAt ? new Date(lastRunAt).getTime() : 0;
  return last < slotUtc ? new Date(slotUtc).toISOString() : null;
}

// 화면에서 쓰는 요약. 큰 스냅샷은 빼고 보낸다.
export function publicSourceState(sourceState, now = new Date()) {
  const { snapshot, ...rest } = sourceState;
  const snapshotCount = Object.keys(snapshot || {}).length;
  return {
    ...rest,
    snapshotCount,
    candidates: newProductCandidates(sourceState, now),
    linkedCount: Object.keys(sourceState.links || {}).length
  };
}

export function issueIsDismissed(sourceState, issue) {
  return sourceState.dismissed?.[issue.key] === issue.fingerprint;
}

// --- 연결 추천 -----------------------------------------------------------------
// 우프에 이미 올라가 있는 브랜드 상품을 본사 상품과 이름으로 짝지어 본다.
// 우프: "앤블랭크 아이코닉 조이베어 목줄 (블랙)"  본사: "아이코닉 조이베어 목줄 블랙"
// 또는 본사는 한 상품에 색상 옵션, 우프는 색상별 상품 → 괄호 안 값을 sourceFilter 로 쓴다.

function nameKey(value, prefix = "") {
  let text = String(value ?? "").normalize("NFKC").trim();
  if (prefix && text.startsWith(prefix)) text = text.slice(prefix.length);
  return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

function splitTrailingNote(value) {
  const m = /^(.*?)[\s]*[(\[]([^()\[\]]+)[)\]]\s*$/.exec(String(value ?? "").trim());
  return m ? { base: m[1].trim(), note: m[2].trim() } : null;
}

function bigrams(text) {
  const out = new Map();
  for (let i = 0; i < text.length - 1; i += 1) {
    const g = text.slice(i, i + 2);
    out.set(g, (out.get(g) || 0) + 1);
  }
  return out;
}

export function nameSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = bigrams(a);
  const B = bigrams(b);
  let overlap = 0;
  let total = 0;
  for (const [g, n] of A) {
    total += n;
    overlap += Math.min(n, B.get(g) || 0);
  }
  for (const n of B.values()) total += n;
  return total ? (2 * overlap) / total : 0;
}

export function suggestLinks({ wooofProducts = [], sourceProducts = [], namePrefix = "", minScore = 0.72 } = {}) {
  const sources = sourceProducts
    .filter((p) => p && p.name && !p.missing)
    .map((p) => ({ ...p, key: nameKey(p.name) }));
  const byKey = new Map();
  for (const p of sources) if (!byKey.has(p.key)) byKey.set(p.key, p);
  const optionHas = (product, note) => {
    const want = nameKey(note);
    return (product.options || []).some((o) => (o.values || [o.label]).some((v) => nameKey(v) === want) || nameKey(o.label).includes(want));
  };
  const suggestions = [];
  const unmatched = [];
  for (const w of wooofProducts) {
    const full = nameKey(w.product_name, namePrefix);
    const exact = byKey.get(full);
    if (exact) {
      suggestions.push({ wooof: w, source: exact, sourceFilter: "", confidence: "exact", score: 1 });
      continue;
    }
    const split = splitTrailingNote(String(w.product_name || "").replace(namePrefix, "").trim());
    if (split) {
      const base = byKey.get(nameKey(split.base));
      if (base) {
        const inOptions = optionHas(base, split.note);
        suggestions.push({ wooof: w, source: base, sourceFilter: split.note, confidence: inOptions ? "option" : "similar", score: inOptions ? 0.95 : 0.8 });
        continue;
      }
    }
    let best = null;
    for (const p of sources) {
      const score = nameSimilarity(full, p.key);
      if (!best || score > best.score) best = { source: p, score };
    }
    if (best && best.score >= minScore) {
      suggestions.push({ wooof: w, source: best.source, sourceFilter: "", confidence: "similar", score: Math.round(best.score * 100) / 100 });
    } else {
      unmatched.push(w);
    }
  }
  return { suggestions, unmatched };
}
