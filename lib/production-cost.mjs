// 생산비 (v2): 생산처별 청구·지급 원장, 미지급 잔액, 지급 필요, 공임 단가 대조.
//
// 지금은 생산비 구글시트(세림통상·동광섬유·…)에 청구와 상환을 손으로 적고, 팩스로
// 받은 상세내역(품목·수량·단가)을 옮겨 적는다. 여기서는
//   - 청구(prodBills)와 지급(prodPayments)을 쌓아 생산처 잔액을 계산하고
//   - 지급을 오래된 청구부터 채워(선입선출) 아직 안 낸 청구와 경과일을 보이고
//   - 상세내역 단가를 약속한 공임 단가(prodRates)와 맞춰 다르면 표시한다.
// 금액은 VAT 포함 원, 공임 단가는 시트처럼 VAT 별도.

const won = (n) => Math.round(Number(n || 0));
const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

// 생산처 하나의 원장: 날짜순, 같은 날은 청구 먼저.
export function partnerLedger({ bills = [], payments = [], adjustments = [] }) {
  const entries = [
    ...bills.filter((b) => !b.voided).map((b) => ({ date: b.date, kind: "bill", amount: won(b.amount), memo: b.memo || "", id: b.id })),
    ...payments.filter((p) => !p.voided).map((p) => ({ date: p.date, kind: "payment", amount: -won(p.amount), memo: p.memo || "", id: p.id, assumed: !!p.assumed })),
    ...adjustments.filter((a) => !a.voided).map((a) => ({ date: a.date, kind: "adjust", amount: won(a.amount), memo: a.memo || "", id: a.id }))
  ].sort((a, b) => String(a.date).localeCompare(String(b.date)) || (a.kind === "bill" ? -1 : 1));
  let balance = 0;
  for (const e of entries) { balance += e.amount; e.balance = balance; }
  const billed = entries.filter((e) => e.kind === "bill").reduce((s, e) => s + e.amount, 0);
  const paid = -entries.filter((e) => e.kind === "payment").reduce((s, e) => s + e.amount, 0);
  return { entries, billed, paid, balance };
}

// 아직 안 낸 청구들(지급을 오래된 청구부터 채운다).
// 청구를 지정한 지급(billId)은 그 청구에 먼저 붙이고, 나머지 지급은 오래된 청구부터 채운다.
export function openBills({ bills = [], payments = [], adjustments = [] }, today) {
  const live = payments.filter((p) => !p.voided);
  const linked = new Map();
  for (const p of live) if (p.billId) linked.set(p.billId, (linked.get(p.billId) || 0) + won(p.amount));
  const billIds = new Set(bills.map((b) => b.id));
  let pool = live.filter((p) => !p.billId || !billIds.has(p.billId)).reduce((s, p) => s + won(p.amount), 0)
    - adjustments.filter((a) => !a.voided).reduce((s, a) => s + won(a.amount), 0); // + 조정은 갚을 돈을 늘린다
  const out = [];
  const sorted = bills.filter((x) => !x.voided).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  // 지정 지급이 청구보다 많으면 남는 돈은 공용으로 돌린다.
  for (const b of sorted) pool += Math.max(0, (linked.get(b.id) || 0) - won(b.amount));
  for (const b of sorted) {
    const amount = Math.max(0, won(b.amount) - (linked.get(b.id) || 0));
    if (!amount) continue;
    const cover = Math.max(0, Math.min(pool, amount));
    pool -= cover;
    const remaining = amount - cover;
    if (remaining > 0) out.push({ ...b, remaining, partial: cover > 0 || remaining < won(b.amount), ageDays: today ? daysBetween(b.date, today) : 0 });
  }
  return out;
}

// 공임 단가 찾기: 상세 품목명 '카시트(네이비)' → 품목 '카시트' + 옵션 '네이비'. 날짜에 맞는 가장 최근 단가.
const norm = (s) => String(s || "").replace(/\s+/g, "").toLowerCase();
export function findRate(rates, itemName, date) {
  const name = norm(itemName);
  const cands = rates.filter((r) => {
    const item = norm(r.item);
    if (!item || !name.startsWith(item)) return false;
    const opt = norm(r.option);
    if (!opt) return true;
    return opt.split(/[\/,]/).some((o) => o && name.includes(o));
  }).filter((r) => !r.from || !date || r.from <= date);
  if (!cands.length) return null;
  // 시작일이 늦은 것(새 단가) 우선, 같으면 더 자세히 맞는 것(품목+옵션이 긴 것).
  const spec = (r) => norm(r.item).length + norm(r.option).length;
  return cands.sort((a, b) => String(b.from || "").localeCompare(String(a.from || "")) || spec(b) - spec(a))[0];
}

const SKIP_ITEMS = /운임|택배|퀵|샘플/;

// 상세내역 단가 대조. details: [{date, lines:[{item, qty, unitPrice}], total}], rates: 공임표.
// 돌려주는 값: 단가가 다른 줄, 공임표에 없는 품목(이름별 1회), 묶음 합계와 원장 청구가 다른 날.
export function rateChecks({ details = [], rates = [], bills = [], since = "" }) {
  const mismatches = [];
  const unknown = new Map();
  for (const d of details) {
    if (since && d.date < since) continue;
    for (const l of d.lines || []) {
      if (SKIP_ITEMS.test(l.item)) continue;
      const rate = findRate(rates, l.item, d.date);
      if (!rate) {
        const k = norm(l.item);
        if (!unknown.has(k)) unknown.set(k, { item: l.item, lastDate: d.date, lastPrice: won(l.unitPrice), count: 0 });
        const u = unknown.get(k);
        u.count += 1;
        if (d.date >= u.lastDate) { u.lastDate = d.date; u.lastPrice = won(l.unitPrice); }
        continue;
      }
      if (Math.abs(won(l.unitPrice) - won(rate.unitPrice)) > 1) {
        mismatches.push({ date: d.date, item: l.item, qty: l.qty, unitPrice: won(l.unitPrice), rate: won(rate.unitPrice),
          rateLabel: `${rate.item}${rate.option ? ` ${rate.option}` : ""}`, diff: Math.round((won(l.unitPrice) - won(rate.unitPrice)) * Number(l.qty || 0)) });
      }
    }
  }
  // 상세내역 묶음 합계 vs 원장 청구액(같은 날)
  const billByDate = new Map();
  for (const b of bills) billByDate.set(b.date, (billByDate.get(b.date) || 0) + won(b.amount));
  const totals = [];
  for (const d of details) {
    if (since && d.date < since) continue;
    const sum = d.total || (d.lines || []).reduce((s, l) => s + won(l.gross), 0);
    const billed = billByDate.get(d.date);
    if (billed == null) totals.push({ date: d.date, detail: sum, billed: 0, note: "원장에 그날 청구 없음" });
    else if (Math.abs(billed - sum) > 10) totals.push({ date: d.date, detail: sum, billed, note: "상세 합계와 청구액이 다름" });
  }
  return { mismatches, unknown: [...unknown.values()], totals };
}

// 생산처 요약(목록 화면).
export function partnerSummary(p, today) {
  const led = partnerLedger(p);
  const open = openBills(p, today);
  const oldest = open[0];
  return { billed: led.billed, paid: led.paid, balance: led.balance, openCount: open.length,
    oldestDate: oldest?.date || "", oldestAge: oldest?.ageDays || 0,
    over60: open.filter((b) => b.ageDays > 60).reduce((s, b) => s + b.remaining, 0),
    lastPayment: [...(p.payments || [])].filter((x) => !x.voided && !x.assumed).sort((a, b) => String(b.date).localeCompare(String(a.date)))[0]?.date || "" };
}

// 생산비 시트 추출본(scripts/v2_extract_production.py) → 저장할 기록 + 확인 필요 질문.
//   partnerIdByName: 시트 이름 → wooofpay 거래처 id (없으면 서버가 만든다)
// 같은 시트를 다시 넣어도 id 가 같아 덮어쓴다(여러 번 돌려도 안전).
export function planProductionImport(extract, { partnerIdByName = {}, today = "", since = "" } = {}) {
  const bills = [], payments = [], details = [], rates = [], questions = [];
  const slug = (name) => String(name).replace(/\s+/g, "");
  const fmt = (n) => `${won(n).toLocaleString("ko-KR")}원`;
  const summary = [];
  for (const p of extract.partners || []) {
    const partnerId = partnerIdByName[p.name];
    if (!partnerId) continue;
    const k = slug(p.name);
    const pb = (p.bills || []).map((b, i) => ({ id: `pb:${k}:${i}`, partnerId, partnerName: p.name, date: b.date, amount: won(b.amount),
      memo: b.memo || "", lines: b.lines || [], installments: b.installments || undefined, source: "생산비 시트" }));
    const pp = (p.payments || []).map((x, i) => ({ id: `pp:${k}:${i}`, partnerId, partnerName: p.name, date: x.date, amount: won(x.amount),
      memo: x.memo || "", assumed: !!x.assumed, billId: Number.isInteger(x.billIdx) ? `pb:${k}:${x.billIdx}` : "", source: "생산비 시트" }));
    bills.push(...pb);
    payments.push(...pp);
    for (const [i, d] of (p.details || []).entries()) {
      details.push({ id: `pd:${k}:${d.date}:${i}`, partnerId, partnerName: p.name, ...d, source: "생산비 시트" });
    }
    const led = partnerLedger({ bills: pb, payments: pp });
    const open = openBills({ bills: pb, payments: pp }, today);
    summary.push({ name: p.name, partnerId, bills: pb.length, payments: pp.length, balance: led.balance, sheetBalance: p.sheetBalance ?? null, open: open.length });
    const sheet = p.sheetBalance;
    const detail = [`계산한 미지급 ${fmt(led.balance)} (청구 ${pb.length}건 − 지급 ${pp.length}건)`];
    if (sheet != null) detail.push(`시트에 적힌 잔금 ${fmt(sheet)}`);
    if (open.length) detail.push(`안 낸 청구 ${open.length}건, 가장 오래된 것 ${open[0].date} ${fmt(open[0].remaining)}`);
    if (pp.some((x) => x.assumed)) detail.push(`시트 합산 범위 이전 청구 ${pp.filter((x) => x.assumed).length}건은 정산 끝난 것으로 봤습니다`);
    for (const n of p.notes || []) detail.push(n);
    questions.push({
      id: `prod-balance:${partnerId}`, topic: "production", kind: "prod-balance", subjectId: partnerId,
      title: `${p.name}: 생산비 미지급 ${fmt(led.balance)}이 맞나요?`, detail: detail.join(" · "),
      choices: [{ key: "ok", label: `${fmt(led.balance)} 맞음` },
        ...(sheet != null && won(sheet) !== led.balance ? [{ key: "sheet", label: `시트 값 ${fmt(sheet)}로 맞춤`, value: won(sheet) }] : []),
        { key: "input", label: "실제 잔금 입력", input: "amount" }],
      payload: { computed: led.balance }
    });
  }
  // 공임 단가
  for (const [i, r] of (extract.rates || []).entries()) {
    const partnerId = partnerIdByName[r.partner];
    if (!partnerId) continue;
    rates.push({ id: `pr:${slug(r.partner)}:${i}`, partnerId, partnerName: r.partner, item: r.item, option: r.option || "",
      unitPrice: won(r.unitPrice), from: r.from || "", fromText: r.fromText || "", source: "생산비 시트" });
  }
  // 상세 단가 대조 → 질문(같은 품목·같은 단가는 한 번만)
  const byPartner = new Map();
  for (const d of details) (byPartner.get(d.partnerId) || byPartner.set(d.partnerId, []).get(d.partnerId)).push(d);
  for (const [partnerId, ds] of byPartner) {
    const name = ds[0].partnerName;
    const chk = rateChecks({ details: ds, rates: rates.filter((r) => r.partnerId === partnerId), bills: bills.filter((b) => b.partnerId === partnerId), since });
    const groups = new Map();
    for (const m of chk.mismatches) {
      const key = `${norm(m.item)}|${m.unitPrice}`;
      const g = groups.get(key) || groups.set(key, { ...m, count: 0, first: m.date, qty: 0 }).get(key);
      g.count += 1;
      g.qty += Number(m.qty || 0);
      if (m.date < g.first) g.first = m.date;
    }
    for (const g of groups.values()) {
      questions.push({
        id: `prod-rate:${partnerId}:${norm(g.item)}:${g.unitPrice}`, topic: "production", kind: "prod-rate-change", subjectId: partnerId,
        title: `${name} ${g.item}: 공임이 ${fmt(g.unitPrice)}으로 바뀌었나요?`,
        detail: `약속 단가(${g.rateLabel}) ${fmt(g.rate)} · 상세내역 ${g.first}부터 ${g.count}번(${g.qty}개) ${fmt(g.unitPrice)} · 차액 합계 ${fmt((g.unitPrice - g.rate) * g.qty)} (VAT 별도)`,
        choices: [{ key: "new-rate", label: `${g.first}부터 ${fmt(g.unitPrice)}로 등록`, value: g.unitPrice },
          { key: "dispute", label: "약속 단가가 맞음(세림에 확인)" }, { key: "later", label: "나중에" }],
        payload: { item: g.item, unitPrice: g.unitPrice, from: g.first }
      });
    }
    for (const u of chk.unknown) {
      questions.push({
        id: `prod-rate-new:${partnerId}:${norm(u.item)}`, topic: "production", kind: "prod-rate-new", subjectId: partnerId,
        title: `${name} '${u.item}' 공임 단가를 등록할까요?`,
        detail: `공임표에 없는 품목입니다. 최근(${u.lastDate}) ${fmt(u.lastPrice)}, ${u.count}번 나왔습니다. 등록하면 다음 상세내역부터 단가를 대조합니다.`,
        choices: [{ key: "register", label: `${fmt(u.lastPrice)} 등록`, value: u.lastPrice }, { key: "input", label: "다른 금액", input: "amount" },
          { key: "skip", label: "대조 안 함" }],
        payload: { item: u.item }
      });
    }
    for (const t of chk.totals) {
      questions.push({
        id: `prod-total:${partnerId}:${t.date}`, topic: "production", kind: "prod-total", subjectId: partnerId,
        title: `${name} ${t.date}: ${t.note}`,
        detail: `상세내역 합계 ${fmt(t.detail)} / 원장 청구 ${fmt(t.billed)}. 팩스 원본과 대조해 주세요.`,
        choices: [{ key: "checked", label: "확인함(원장이 맞음)" }, { key: "later", label: "나중에" }]
      });
    }
  }
  return { bills, payments, details, rates, questions, summary };
}
