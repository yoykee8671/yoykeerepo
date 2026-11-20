// 일일 자금보고 (v2).
//
// 지금은 현금흐름표 엑셀(항목 × 날짜 달력)을 손으로 채우고 캡처해 채널톡에
// 올린다. 여기서는 세 가지를 한 표로 모은다.
//   1) 자금 일정: 정기(매월 n일·매주 요일) 또는 1회. 고정비·급여·대출상환·
//      회생변제·PG 정산 입금 같은 것. (cashSchedules)
//   2) 지급요청: 처리 전이고 입금예정일/요청기한이 있는 것.
//   3) 선매입 입금요청: 입금대기이고 입금예정일이 있는 것.
// 잔액은 클로브 계좌 잔액에서 출발해 날마다 들어올 돈을 더하고 나갈 돈을 뺀다.
import { addDays } from "./payment-requests.mjs";

export const SCHEDULE_REPEATS = { once: "1회", monthly: "매월", weekly: "매주" };
export const SCHEDULE_CATEGORIES = {
  out: ["고정비", "급여", "대출상환", "회생변제", "세금", "생산비", "물류비", "매입", "광고비", "기타"],
  in: ["PG정산", "매출입금", "용역비", "대출실행", "기타"]
};

// 일정 하나가 [start, end] 사이에 떨어지는 날짜들.
export function occurrences(schedule, start, end) {
  const s = schedule || {};
  const out = [];
  if (s.active === false) return out;
  const from = String(s.startDate || "0000-01-01").slice(0, 10);
  const until = String(s.endDate || "9999-12-31").slice(0, 10);
  const lo = start > from ? start : from;
  const hi = end < until ? end : until;
  if (lo > hi) return out;
  const skip = new Set(s.skipDates || []);
  if ((s.repeat || "once") === "once") {
    const d = String(s.date || "").slice(0, 10);
    if (d && d >= lo && d <= hi) out.push(d);
    return out;
  }
  for (let d = lo; d <= hi; d = addDays(d, 1)) {
    if (skip.has(d)) continue;
    const day = new Date(`${d}T00:00:00Z`);
    if (s.repeat === "monthly") {
      const want = Number(s.dayOfMonth || 1);
      const last = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0)).getUTCDate();
      // 31일 지정인데 30일까지 있는 달은 말일에 잡는다.
      if (day.getUTCDate() === Math.min(want, last)) out.push(d);
    } else if (s.repeat === "weekly") {
      if (day.getUTCDay() === Number(s.weekday ?? 1)) out.push(d);
    }
  }
  return out;
}

// 보고서 본문. company 는 'wooof' | 'betters' 같은 회사 키.
export function buildCashReport({ today, days = 7, company = "", openingBalance = null,
  schedules = [], payments = [], requests = [], receivables = [], extra = [] }) {
  const start = String(today).slice(0, 10);
  const end = addDays(start, days);
  // 클로브에서 받아 온 일정(판매처 정산 예정·클로브 자금 계획). 기간 안의 것만.
  const lines = extra.filter((l) => l.date >= start && l.date <= end && l.amount);
  const mine = (x) => !company || !x.company || x.company === company;

  for (const s of schedules.filter(mine)) {
    for (const date of occurrences(s, start, end)) {
      lines.push({ date, direction: s.direction === "in" ? "in" : "out", amount: Number(s.amount || 0),
        title: s.title, category: s.category || "", source: "schedule", refId: s.id, method: s.method || "" });
    }
  }
  for (const p of payments.filter(mine)) {
    if (["paid", "cancelled"].includes(p.status)) continue;
    const date = String(p.plannedDate || p.dueDate || "").slice(0, 10);
    if (!date || date > end) continue;
    lines.push({ date: date < start ? start : date, overdue: date < start, direction: "out",
      amount: Number(p.amount || 0), title: (() => {
        const payee = p.payeeName || p.holder || "";
        return String(p.title || "").includes(payee) ? String(p.title || "") : `${payee} ${p.title || ""}`.trim();
      })(),
      category: p.category || "지급요청", source: "payment", refId: p.id, status: p.status });
  }
  for (const r of requests) {
    if (r.status !== "pending") continue;
    const date = String(r.expectedDepositDate || "").slice(0, 10);
    if (!date || date > end) continue;
    const amount = Math.max(0, Number(r.depositAmount || 0) - Number(r.creditUsedAmount || 0) - Number(r.priorPaidAmount || 0));
    lines.push({ date: date < start ? start : date, overdue: date < start, direction: "out", amount,
      title: `${r.brandName || ""} 선매입`, category: "선매입", source: "request", refId: r.id });
  }

  // 판매 파이프라인의 받을 돈(계산서까지 냈는데 덜 들어온 돈). 기한이 지났으면 오늘로 모은다.
  for (const r of receivables) {
    const date = String(r.dueDate || "").slice(0, 10);
    if (!date || date > end || !r.remaining) continue;
    lines.push({ date: date < start ? start : date, overdue: date < start, direction: "in", amount: Number(r.remaining),
      title: `${r.partnerName || ""} ${r.title || ""}`.trim(), category: "받을 돈", source: "sales", refId: r.id });
  }

  const dayRows = [];
  let balance = openingBalance == null ? null : Number(openingBalance);
  let shortfallDate = "";
  for (let d = start; d <= end; d = addDays(d, 1)) {
    const items = lines.filter((l) => l.date === d);
    const cashIn = items.filter((l) => l.direction === "in").reduce((s, l) => s + l.amount, 0);
    const cashOut = items.filter((l) => l.direction === "out").reduce((s, l) => s + l.amount, 0);
    if (balance != null) {
      balance += cashIn - cashOut;
      if (balance < 0 && !shortfallDate) shortfallDate = d;
    }
    dayRows.push({ date: d, cashIn, cashOut, balance, items });
  }
  const todayRow = dayRows[0];
  return {
    start, end, company,
    openingBalance,
    today: todayRow,
    days: dayRows,
    weekIn: dayRows.reduce((s, r) => s + r.cashIn, 0),
    weekOut: dayRows.reduce((s, r) => s + r.cashOut, 0),
    endingBalance: balance,
    shortfallDate
  };
}

const won = (n) => `${Math.round(Number(n || 0)).toLocaleString("ko-KR")}원`;
const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
const dayLabel = (d) => `${Number(d.slice(5, 7))}/${Number(d.slice(8, 10))}(${WEEKDAYS[new Date(`${d}T00:00:00Z`).getUTCDay()]})`;

// 채널톡에 그대로 붙여 넣을 보고 문구.
export function reportText(report, { companyName = "", accounts = [], fund = null } = {}) {
  const r = report;
  const out = [];
  out.push(`[일일 자금보고] ${companyName} ${dayLabel(r.start)}`.trim());
  if (r.openingBalance != null) out.push(`현 잔액 ${won(r.openingBalance)}`);
  for (const a of accounts) out.push(` · ${a.name} ${won(a.balance)}`);
  // 클로브 자금일보: 어제 들어온 돈·나간 돈(분류별).
  if (fund && (fund.cashIn || fund.cashOut)) {
    out.push("");
    out.push(`■ 어제(${dayLabel(String(fund.transactionDate || "").slice(0, 10) || r.start)}) 들어온 돈 ${won(fund.cashIn)} / 나간 돈 ${won(Math.abs(fund.cashOut || 0))}`);
    for (const l of fund.cashInLabels || []) out.push(` + ${l.name} ${won(l.amount)} (${l.count}건)`);
    for (const l of fund.cashOutLabels || []) out.push(` - ${l.name} ${won(Math.abs(l.amount))} (${l.count}건)`);
  }
  out.push("");
  out.push(`■ 오늘 들어올 돈 ${won(r.today.cashIn)}`);
  for (const l of r.today.items.filter((x) => x.direction === "in")) out.push(` - ${l.title} ${won(l.amount)}`);
  out.push(`■ 오늘 나갈 돈 ${won(r.today.cashOut)}`);
  for (const l of r.today.items.filter((x) => x.direction === "out")) {
    out.push(` - ${l.overdue ? "[기한지남] " : ""}${l.title} ${won(l.amount)}`);
  }
  out.push("");
  out.push(`■ 7일 예정 (${dayLabel(r.start)}~${dayLabel(r.end)}) 들어올 돈 ${won(r.weekIn)} / 나갈 돈 ${won(r.weekOut)}`);
  for (const d of r.days.slice(1)) {
    if (!d.cashIn && !d.cashOut) continue;
    out.push(` - ${dayLabel(d.date)} ${d.cashIn ? `+${won(d.cashIn)} ` : ""}${d.cashOut ? `-${won(d.cashOut)}` : ""}${d.balance != null ? ` → ${won(d.balance)}` : ""}`);
    // 고정비·자금 일정, 지급요청, 선매입, 받을 돈을 건마다 적는다.
    for (const l of d.items) out.push(`    · ${l.direction === "in" ? "+" : "-"} ${l.title} ${won(l.amount)}`);
  }
  if (r.shortfallDate) out.push(`⚠ ${dayLabel(r.shortfallDate)}에 잔액이 모자랍니다.`);
  return out.join("\n");
}

// 출금 리포트(퇴근 때 보고): 그날 지급완료된 지급요청 + 입금완료된 입금요청(선매입, 브랜드별 묶음).
// 금일 우프 출금 리스트 입니다.
// - 픽키파크 9월 판매수수료 / 1,150,560원
// - 빌리스벳 선매입 1건 / 73,400원
export function buildPayoutReport({ date, payments = [], requests = [] }) {
  const day = (v) => String(v || "").slice(0, 10);
  const lines = [];
  for (const p of payments) {
    if (p.status !== "paid" || day(p.paidAt) !== date) continue;
    const payee = String(p.payeeName || p.holder || "").trim();
    const title = String(p.title || "").trim();
    lines.push({ kind: "payment", label: title.startsWith(payee) ? title : [payee, title].filter(Boolean).join(" "), amount: Number(p.amount || 0), code: p.code || "" });
  }
  const byBrand = new Map();
  for (const r of requests) {
    if (r.status !== "paid" || day(r.paidAt) !== date) continue;
    const key = r.brandName || "브랜드 없음";
    const g = byBrand.get(key) || { count: 0, amount: 0 };
    g.count += 1; g.amount += Number(r.paidAmount ?? r.depositAmount ?? 0);
    byBrand.set(key, g);
  }
  for (const [brand, g] of byBrand) lines.push({ kind: "request", label: `${brand} 선매입 ${g.count}건`, amount: g.amount });
  return { date, lines, total: lines.reduce((t, l) => t + l.amount, 0) };
}
export function payoutReportText(rep, { companyShort = "우프", today = "" } = {}) {
  const when = rep.date === today ? "금일" : `${rep.date.slice(5).replace("-", "/")}`;
  if (!rep.lines.length) return `${when} ${companyShort} 출금 내역이 없습니다.`;
  return [`${when} ${companyShort} 출금 리스트 입니다.`, ...rep.lines.map((l) => `- ${l.label} / ${won(l.amount)}`), `합계 ${rep.lines.length}건 / ${won(rep.total)}`].join("\n");
}

// 클로브 → 자금일보 줄.
// - 매출 캘린더(정산 예정일 기준): 쿠팡·스마트스토어·29CM·PG 등 판매처별 들어올 돈
// - 자금 계획의 등록 일정(부가세 등): 1회성은 그날, 매월은 그 달 같은 날
export function clobeLines({ revenue = null, plan = null, start, end }) {
  const out = [];
  for (const r of revenue?.items || []) {
    const amount = Number(r.settlementAmountKrw ?? r.salesAmountKrw ?? 0);
    if (!amount) continue;
    out.push({ date: String(r.date).slice(0, 10), direction: "in", amount, title: `${r.sourcePlatform || r.channel} 정산`, category: "판매처 정산", source: "clobe" });
  }
  for (const it of plan?.registeredSchedules?.items || []) {
    if (!["CONFIRMED", "CANDIDATE"].includes(it.status) || !it.expectedAmount) continue;
    const anchor = String(it.anchorDate || "").slice(0, 10);
    if (!anchor) continue;
    const dates = [];
    if (it.recurrenceType === "ONE_TIME") dates.push(anchor);
    else if (it.recurrenceType === "MONTHLY") {
      const dom = Number(it.dayOfMonth || anchor.slice(8, 10));
      for (let d = start; d <= end; d = addDays(d, 1)) if (Number(d.slice(8, 10)) === dom && d >= anchor) dates.push(d);
    }
    for (const date of dates) {
      if (it.endsOn && date > String(it.endsOn).slice(0, 10)) continue;
      out.push({ date, direction: it.direction === "IN" ? "in" : "out", amount: Number(it.expectedAmount), title: `${it.displayName} (클로브 일정)`, category: "클로브 자금계획", source: "clobe" });
    }
  }
  return out.filter((l) => l.date >= start && l.date <= end);
}
