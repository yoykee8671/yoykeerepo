// 입점사 월정산 보드 (v2).
//
// 매달 입점 브랜드마다 매출·배송비·채권 회수·마진을 보고, 확인/계산서 발행요청/
// 정산서 발송을 체크하던 구글시트(월정산)를 대신한다.
//   - 숫자는 wooofpay 입금요청에서 계산한다(주문번호 앞 8자리 = 주문일 기준 월).
//   - 입금요청이 없는 위탁 브랜드는 손으로 적는다.
//   - 예전 시트 값은 '시트' 칸으로 같이 보여 다르면 표시한다.

const won = (n) => Math.round(Number(n || 0));

// 주문번호 '20261015-0000123' → '2026-10'. 없으면 만든 날.
export function requestMonth(r) {
  const m = String(r.orderNo || "").match(/^(\d{4})(\d{2})\d{2}/);
  return m ? `${m[1]}-${m[2]}` : String(r.createdAt || "").slice(0, 7);
}

// 브랜드 이름 맞추기: '패디펫(아카바코퍼레이션)' ↔ '아카바코퍼레이션 (패디펫)', '아이그룸 (리케이)' ↔ '리케이(아이그룸)'
const clean = (s) => String(s || "").toLowerCase().replace(/주식회사|㈜|\(주\)/g, "").replace(/\s+/g, "");
function nameKeys(s) {
  const t = clean(s);
  const outside = t.replace(/\(.*?\)/g, "");
  const inside = [...t.matchAll(/\((.*?)\)/g)].map((m) => m[1]);
  // 'ANBLANK 앤블랭크', '꼬뜨cote' 처럼 영문·한글이 붙은 이름은 각각도 키로 쓴다.
  const words = String(s || "").toLowerCase().replace(/[()]/g, " ").split(/\s+/).map(clean);
  const scripts = [t.replace(/[^가-힣]/g, ""), t.replace(/[^a-z0-9]/g, "")];
  return [...new Set([t, outside, ...inside, ...words, ...scripts])].filter((k) => k.length >= 2);
}
export function matchBrandName(name, brands) {
  const keys = nameKeys(name);
  let best = null;
  for (const b of brands) {
    const bk = [...nameKeys(b.name), ...nameKeys(b.rawSheetName)];
    // 맞는 키 점수를 더한다: '트러스티푸드 (b2b)'는 '트러스티푸드 (B2B)'가 '(온라인)'보다 높다.
    let score = 0;
    for (const k of keys) {
      let s = 0;
      for (const x of bk) {
        if (k === x) s = Math.max(s, 3);
        else if ((k.startsWith(x) || x.startsWith(k)) && Math.min(k.length, x.length) >= 3) s = Math.max(s, 2);
      }
      score += s;
    }
    if (score && (!best || score > best.score)) best = { brand: b, score };
  }
  return best?.brand || null;
}

// 한 달 브랜드별 합계(입금요청 기준).
export function computeMonth(requests, ym) {
  const out = {};
  for (const r of requests) {
    if (r.status === "deleted" || requestMonth(r) !== ym) continue;
    const o = out[r.brandId] ||= { brandId: r.brandId, count: 0, sales: 0, shipping: 0, recovered: 0, margin: 0, deposit: 0 };
    o.count += 1;
    o.sales += won(r.productSalesAmount);
    o.shipping += won(r.shippingFee);
    o.recovered += won(r.receivableDeduction);
    // 채권 브랜드의 수수료는 회수(채권차감)로 잡히고, 그 밖은 마진이다.
    if (!won(r.receivableDeduction)) o.margin += won(r.commissionAmount);
    o.deposit += won(r.depositAmount);
  }
  return out;
}

const FIELDS = ["sales", "shipping", "recovered", "margin"];

// 보드 한 줄: 계산값(또는 손으로 적은 값) + 시트 값 + 다른 칸.
export function boardRows({ brands = [], requests = [], records = [], ym }) {
  const computed = computeMonth(requests, ym);
  const recByBrand = new Map(records.filter((x) => x.month === ym).map((x) => [x.brandId, x]));
  const ids = new Set([...Object.keys(computed), ...recByBrand.keys()]);
  const rows = [];
  for (const id of ids) {
    const b = brands.find((x) => x.id === id);
    const c = computed[id];
    const rec = recByBrand.get(id) || {};
    const values = {};
    for (const f of FIELDS) values[f] = c ? c[f] : won(rec.manual?.[f]);
    // 시트 빈칸(0)은 '덜 적은 것'이라 다르다고 하지 않는다.
    const diffs = rec.sheet ? FIELDS.filter((f) => won(rec.sheet[f]) && Math.abs(won(rec.sheet[f]) - values[f]) > 1) : [];
    rows.push({
      month: ym, brandId: id, brandName: b?.name || rec.brandName || id, code: b?.code || "", kind: rec.kind || b?.settlementType || "",
      source: c ? "requests" : rec.manual ? "manual" : rec.sheet ? "sheet-only" : "none", count: c?.count || 0, ...values,
      sheet: rec.sheet || null, diffs, checked: !!rec.checked, invoiceRequested: !!rec.invoiceRequested, sent: !!rec.sent,
      memo: rec.memo || "", fixRequest: rec.fixRequest || "", updatedBy: rec.updatedBy || "", updatedAt: rec.updatedAt || ""
    });
  }
  return rows.sort((a, b) => b.sales - a.sales || String(a.brandName).localeCompare(String(b.brandName), "ko"));
}

// 시트 추출본 → 보드 기록(month×brand) + 이름을 못 맞춘 시트 브랜드 + 매출이 계속 다른 브랜드.
export function planMonthlyImport(extract, { brands = [], requests = [] } = {}) {
  const records = [];
  const unmatched = new Map();
  const salesGaps = new Map();
  for (const [ym, rows] of Object.entries(extract.months || {})) {
    const computed = computeMonth(requests, ym);
    for (const row of rows) {
      if (/^(합계|total|소계)$/i.test(String(row.brand).trim())) continue;
      const b = matchBrandName(row.brand, brands);
      if (!b) {
        const u = unmatched.get(row.brand) || unmatched.set(row.brand, { name: row.brand, months: [], sales: 0, rows: [] }).get(row.brand);
        u.months.push(ym);
        u.rows.push({ ym, row });
        u.sales += won(row.sales);
        continue;
      }
      const sheet = { sales: won(row.sales), shipping: won(row.shipping), recovered: won(row.recovered), margin: won(row.margin) };
      const rec = { id: `${ym}:${b.id}`, month: ym, brandId: b.id, brandName: b.name, kind: row.kind || "", sheet,
        sheetRate: row.rate ?? row.baseRate ?? null, checked: !!row.checked, sent: !!row.sent,
        memo: [row.memo, row.note].filter(Boolean).join(" / "), fixRequest: row.fixRequest || "", source: "월정산 시트" };
      // 입금요청이 없는 달(위탁 등)은 시트 값을 손으로 적은 값으로 옮긴다.
      if (!computed[b.id] && (sheet.sales || sheet.margin)) rec.manual = { ...sheet };
      records.push(rec);
      const c = computed[b.id];
      if (c && sheet.sales && Math.abs(c.sales - sheet.sales) > 1) {
        const g = salesGaps.get(b.id) || salesGaps.set(b.id, { brandId: b.id, brandName: b.name, months: [], app: 0, sheet: 0 }).get(b.id);
        g.months.push(ym);
        g.app += c.sales;
        g.sheet += sheet.sales;
      }
    }
  }
  return { records, unmatched: [...unmatched.values()], salesGaps: [...salesGaps.values()] };
}

// 질문: 시트 브랜드 이름 연결, 매출이 시트와 다른 브랜드(프로모션 미적용 의심).
export function monthlyQuestions({ unmatched = [], salesGaps = [] }) {
  const fmt = (n) => `${won(n).toLocaleString("ko-KR")}원`;
  const qs = [];
  for (const u of unmatched) {
    qs.push({ id: `monthly-brand:${u.name}`, topic: "monthly", kind: "monthly-brand", subjectId: u.name,
      title: `월정산 시트 '${u.name}'은 어느 브랜드인가요?`,
      detail: `${u.months.length}개월(${u.months.slice(-1)[0]}~${u.months[0]}), 매출 합계 ${fmt(u.sales)}. 브랜드를 고르면 그 달들의 시트 값을 붙입니다.`,
      choices: [{ key: "pick-brand", label: "브랜드 고르기", input: "brand" }, { key: "skip", label: "연결 안 함" }],
      payload: { rows: u.rows } });
  }
  for (const g of salesGaps) {
    const ratio = g.app ? g.sheet / g.app : 0;
    qs.push({ id: `monthly-gap:${g.brandId}`, topic: "monthly", kind: "monthly-gap", subjectId: g.brandId,
      title: `${g.brandName}: 월정산 시트 매출과 입금요청 매출이 다릅니다 (${g.months.length}개월)`,
      detail: `시트 ${fmt(g.sheet)} / 입금요청 ${fmt(g.app)} (시트가 ${Math.round(ratio * 100)}%) · ${g.months.join(", ")}. 시트가 더 작으면 프로모션·할인이 입금요청에 안 걸렸을 수 있습니다.`,
      choices: [{ key: "app", label: "입금요청이 맞음" }, { key: "review", label: "입금요청 확인 필요로 표시" }, { key: "later", label: "나중에" }],
      payload: { months: g.months } });
  }
  return qs;
}
