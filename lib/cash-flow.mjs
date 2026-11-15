// 현금흐름표 (v2) — 담당자가 쓰던 구글시트(2026_현금흐름표)와 같은 모양.
//
// 행 = 현금IN(채널·PG별) / 현금OUT(비용 항목별), 열 = 그달의 날짜.
// 한 칸의 값은 아래 순서로 정한다.
//   1) 사람이 적은 값(manual)
//   2) 지난 날: 클로브 실제 입출금(actual) — 없으면 옛 시트 값(sheet)
//   3) 오늘·앞날: 옛 시트에 적어 둔 값(sheet) — 없으면 v2 예정(plan: 자금 일정·지급요청·생산비·대출·회생·받을 돈)
// 어느 행에도 안 맞는 줄은 '기타 입금/출금' 행으로 간다. 클로브는 여러 자료 중 하나다.

const won = (n) => Math.round(Number(n || 0));

// 매출 유형(사업구조 지침 2026-11-15). consigned_sales(픽키도기클럽 대행 판매분)와 pass_through(ITIT 재발행분)는
// 우프 매출이 아니거나 순매출에서 뺀다 — 현금은 오가지만 매출로 세지 않는다.
export const REVENUE_TYPES = {
  product_sales: "상품 매출", agency_fee: "운영대행비", consigned_sales: "대행 판매분(정산 대상)", cost_rebill: "선집행 비용 재청구",
  service_fee: "용역·컨설팅", pass_through: "재발행 전달분", other: "기타·매출 아님"
};
const norm = (s) => String(s || "").toLowerCase().replace(/\s+/g, "");

// '생산비/세림통상' → ['생산', '세림통상'], 'B 신한은행 이자비용' → ['신한', '이자'] (+ 회사 betters)
export function rowTokens(label) {
  return String(label || "")
    .replace(/^B\s+/, "")
    .split(/[\s/()·,]+/)
    .map((t) => norm(t).replace(/(은행|비용|료|비)$/, ""))
    .filter((t) => t.length >= 2);
}
export const rowCompany = (label) => (/^B\s+/.test(String(label || "")) ? "betters" : "");

// 줄(예정/실제)에 맞는 행. side 가 같고, 행 이름 낱말이 가장 많이 들어 있는 행.
export function matchRow(rows, line) {
  const text = norm(line.text);
  let best = null;
  for (const r of rows) {
    if (r.side !== line.side || r.active === false) continue;
    const co = r.company || rowCompany(r.label);
    if (co && line.company && co !== line.company) continue;
    const extra = (r.match || []).map(norm).filter(Boolean);
    const toks = [...rowTokens(r.label), ...extra];
    const score = toks.filter((t) => text.includes(t)).length + (extra.some((t) => text.includes(t)) ? 2 : 0);
    if (score > 0 && (!best || score > best.score)) best = { row: r, score };
  }
  return best?.row || null;
}

export function monthDays(month) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const W = ["일", "월", "화", "수", "목", "금", "토"];
  return Array.from({ length: last }, (_, i) => {
    const date = `${month}-${String(i + 1).padStart(2, "0")}`;
    return { date, day: i + 1, dow: W[new Date(`${date}T00:00:00Z`).getUTCDay()] };
  });
}

// rows: [{id, side, label, order, company?, match?}]
// cells: 저장된 칸 [{date, rowId, amount, memo, source: 'manual'|'sheet'}]
// actual / plan: [{date, side, amount, text, company, title, source}]
export function buildGrid({ rows = [], month, cells = [], actual = [], plan = [], today = "", company = "", actualSynced = false }) {
  const days = monthDays(month);
  const inMonth = (d) => String(d || "").slice(0, 7) === month;
  const visible = rows.filter((r) => r.active !== false && (!company || !(r.company || rowCompany(r.label)) || (r.company || rowCompany(r.label)) === company))
    .sort((a, b) => (a.side === b.side ? Number(a.order || 0) - Number(b.order || 0) : a.side === "in" ? -1 : 1));
  const other = { in: visible.find((r) => r.side === "in" && /^기타/.test(r.label)), out: visible.find((r) => r.side === "out" && /^기타/.test(r.label)) };
  const bucket = new Map(); // `${rowId}|${date}` -> { manual, sheet, actual:[], plan:[] }
  const slot = (rowId, date) => bucket.get(`${rowId}|${date}`) || bucket.set(`${rowId}|${date}`, { actual: [], plan: [] }).get(`${rowId}|${date}`);
  for (const c of cells) {
    if (!inMonth(c.date)) continue;
    const s = slot(c.rowId, c.date);
    if (c.source === "sheet") s.sheet = c; else s.manual = c;
  }
  const place = (list, key) => {
    for (const l of list) {
      if (!inMonth(l.date) || (company && l.company && l.company !== company)) continue;
      const r = matchRow(visible, l) || other[l.side];
      if (!r) continue;
      slot(r.id, l.date)[key].push(l);
    }
  };
  place(actual, "actual");
  place(plan, "plan");

  const sum = (list) => list.reduce((s, l) => s + won(l.amount), 0);
  const grid = {};
  const totals = Object.fromEntries(days.map((d) => [d.date, { in: 0, out: 0 }]));
  for (const r of visible) {
    grid[r.id] = {};
    for (const d of days) {
      const s = bucket.get(`${r.id}|${d.date}`);
      if (!s) continue;
      const past = today && d.date < today;
      let v = null;
      if (s.manual) v = { amount: won(s.manual.amount), kind: "manual", memo: s.manual.memo || "" };
      else if (past && actualSynced && s.actual.length) v = { amount: sum(s.actual), kind: "actual" };
      else if (s.sheet) v = { amount: won(s.sheet.amount), kind: "sheet" };
      else if (past && s.actual.length) v = { amount: sum(s.actual), kind: "actual" };
      else if (!past && s.plan.length) v = { amount: sum(s.plan), kind: "plan" };
      if (!v) continue;
      v.parts = { actual: s.actual.map((l) => ({ title: l.title || l.text, amount: won(l.amount) })), plan: s.plan.map((l) => ({ title: l.title || l.text, amount: won(l.amount), source: l.source })),
        sheet: s.sheet ? won(s.sheet.amount) : null };
      grid[r.id][d.date] = v;
      totals[d.date][r.side] += v.amount;
    }
  }
  return { days, rows: visible, grid, totals };
}

// 오늘부터 잔액: 오늘 시작 잔액(클로브) + 날마다 들어올 돈 − 나갈 돈.
export function balances(days, totals, opening, today) {
  if (opening == null) return {};
  const out = {};
  let bal = Number(opening);
  for (const d of days) {
    if (d.date < today) continue;
    bal += totals[d.date].in - totals[d.date].out;
    out[d.date] = bal;
  }
  return out;
}

// '10일' → 10, '말일' → 31
export function scheduleDay(s) {
  const t = String(s || "");
  if (/말일/.test(t)) return 31;
  const m = t.match(/(\d{1,2})/);
  return m ? Number(m[1]) : 0;
}
