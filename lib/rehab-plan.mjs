// 회생계획 변제 (v2).
//
// 회생채권은 80%(특수관계인 100%)를 출자전환하고, 나머지를 2026~2035년 10년 동안
// 해마다 계획표 금액대로 그해 연말까지 현금으로 갚는다(조세는 출자전환 없이 2028년까지).
// 2026년분은 조기졸업 조건으로 50%를 2025년에 미리 갚았다(계획표 '준비연도(2025)' 칸,
// 현가할인 4.4%를 적용해 실제로는 그보다 조금 적게 냄) → 2026년에 남은 것은 '1차(2026)
// 변제실잔액'. 수수료를 차감하는 거래 브랜드에도 현금변제는 따로 한다(대표 확인 2026-11-15).

const won = (n) => Math.round(Number(n || 0));

// 해마다: 계획액, 미리 낸 액(2026), 기록된 지급, 남은 액, 기한(연말).
export function yearSummary(plan, payments = [], today = "") {
  const years = Object.keys(plan?.totals?.years || {}).sort();
  const firstYear = years[0];
  return years.map((y) => {
    const planned = won(plan.totals.years[y]);
    const prepaid = y === firstYear ? won(plan.totals.prepaid) : 0;
    const paid = payments.filter((p) => !p.voided && String(p.year) === y).reduce((s, p) => s + won(p.amount), 0);
    const due = Math.max(0, planned - prepaid - paid);
    const dueDate = `${y}-12-31`;
    return { year: y, planned, prepaid, prepaidPaid: y === firstYear ? won(plan.totals.prepaidPaid) : 0, paid, due, dueDate,
      status: due <= 0 ? "paid" : today && today > dueDate ? "overdue" : today && today.slice(0, 4) === y ? "this-year" : "planned" };
  });
}

// 그해 채권자별 금액(2026년은 미리 낸 50%를 뺀 남은 금액).
export function creditorsForYear(plan, year) {
  const first = Object.keys(plan?.totals?.years || {}).sort()[0];
  return (plan?.creditors || []).map((c) => {
    const planned = won(c.years?.[year]);
    const prepaid = year === first ? won(c.prepaid) : 0;
    return { cat: c.cat, creditor: c.creditor, biz: c.biz, total: won(c.total), cash: won(c.cash), planned, prepaid,
      remaining: year === first && c.remaining2026 != null ? won(c.remaining2026) : Math.max(0, planned - prepaid) };
  }).filter((c) => c.planned || c.prepaid);
}

// 자금 보고서용: 기간 안에 들어오는 연말 변제(남은 금액이 있을 때만).
export function rehabScheduleLines(plan, payments, start, end, company = "wooof") {
  if (!plan) return [];
  return yearSummary(plan, payments).filter((y) => y.due > 0 && y.dueDate >= start && y.dueDate <= end).map((y) => ({
    id: `rehab:${y.year}`, company, direction: "out", repeat: "once", date: y.dueDate, amount: y.due,
    title: `회생채권 ${y.year}년 변제(연말까지)`, category: "회생변제", fromRehab: y.year
  }));
}

// 대출 → 회생계획 채권자 연결(이름 앞부분으로).
const key = (s) => String(s || "").replace(/㈜|\(주\)|주식회사|\s/g, "");
export function creditorPlan(plan, name) {
  const k = key(name);
  if (!k) return null;
  return (plan?.creditors || []).find((c) => key(c.creditor) === k || key(c.creditor).startsWith(k) || k.startsWith(key(c.creditor))) || null;
}

// 채권자 한 곳이 실제로 받은 현금변제: 2025 선변제(2026년분의 50%) + 지급 기록으로 '완료'된 해의 그 채권자 몫.
// (지급 기록은 해마다 묶어서 남기므로, 그해 남은 금액을 다 낸 해만 채권자별로 나눠 반영한다.)
export function creditorCashPaid(plan, payments = [], creditor) {
  if (!plan || !creditor) return [];
  const years = Object.keys(plan.totals?.years || {}).sort();
  const out = [];
  if (won(creditor.prepaid)) out.push({ year: years[0], date: `${Number(years[0]) - 1}-12-31`, amount: won(creditor.prepaid), memo: `${years[0]}년분 50% 선변제(조기졸업 조건)` });
  for (const y of yearSummary(plan, payments)) {
    if (y.status !== "paid") continue;
    const c = creditorsForYear(plan, y.year).find((x) => x.creditor === creditor.creditor);
    if (!c?.remaining) continue;
    const last = payments.filter((p) => !p.voided && String(p.year) === y.year).map((p) => p.date).sort().at(-1) || y.dueDate;
    out.push({ year: y.year, date: last, amount: c.remaining, memo: `${y.year}년 회생 현금변제` });
  }
  return out;
}
