// 대출금 원장 (v2).
//
// 대출금 관리대장(구글시트, 베럴즈·우프 탭)은 대출마다 한 줄이고 '잔여 대출금'을
// 손으로 고친다. 여기서는
//   - 시트의 잔액을 기준일(asOf) 잔액으로 두고, 그 뒤 상환(loanPayments)의 원금을 빼서
//     지금 잔액을 계산하고
//   - 매월 상환일·예상 금액(원금 + 이자 추정)을 자금 일정에 올리고
//   - 클로브에 연결된 출금계좌의 거래에서 상환 출금을 찾아 자동으로 기록하고
//   - 만기가 지났거나 다가오는 대출을 표시한다.
// 금액은 원, 이율은 연 %.

const won = (n) => Math.round(Number(n || 0));
const digits = (s) => String(s || "").replace(/\D/g, "");

// betters = 개인사업자 Betters(브랜드 Betters 와 다름)
export const LOAN_COMPANIES = { wooof: "우프컴퍼니", betters: "Betters(개인사업자)" };

// '14일' → 14, '말일' → 31, '' → 0
export function payDayOf(loan) {
  const t = String(loan.payDay || "");
  if (/말일/.test(t)) return 31;
  const m = t.match(/(\d{1,2})/);
  return m ? Math.min(31, Number(m[1])) : 0;
}

const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const iso = (y, m, d) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

// 지금 잔액: 기준일 잔액 − 기준일 뒤 상환 원금 (+ 추가 실행).
export function loanBalance(loan, payments = []) {
  let bal = won(loan.balance);
  for (const p of payments) {
    if (p.loanId !== loan.id || p.voided) continue;
    if (loan.asOf && p.date <= loan.asOf) continue;
    bal -= won(p.principal);
  }
  return Math.max(0, bal);
}

export function loanStatus(loan, balance, today) {
  // 대위변제로 채권자가 바뀌어 회생채권에 들어간 대출: 은행 상환·이자가 없고 회생계획대로 갚는다.
  if (loan.rehabCreditor) return "rehab";
  if (loan.closed || balance <= 0) return "closed";
  if (loan.maturity && loan.maturity < today) return "matured";
  if (loan.maturity) {
    const days = Math.round((Date.parse(`${loan.maturity}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
    if (days <= 60) return "due-soon";
  }
  return "active";
}

// 한 달 예상 상환액. 원리금이 적혀 있으면 그것, 아니면 원금상환 + 이자(잔액×이율/12).
export function expectedPayment(loan, balance, date = "") {
  const started = !loan.repayStart || !date || loan.repayStart <= date;
  const interest = Math.round(balance * Number(loan.rate || 0) / 100 / 12);
  if (won(loan.monthlyPayment) > 0 && started) {
    const principal = Math.max(0, Math.min(balance, won(loan.monthlyPayment) - interest));
    return { principal, interest, total: principal + interest };
  }
  const principal = started ? Math.min(balance, won(loan.principalPayment)) : 0;
  return { principal, interest, total: principal + interest };
}

// [start, end] 사이 상환 예정 → 자금 보고서의 일정 줄.
export function loanScheduleLines(loans, payments, start, end) {
  const out = [];
  for (const loan of loans) {
    const bal = loanBalance(loan, payments);
    if (loan.closed || loan.rehabCreditor || bal <= 0) continue;
    const day = payDayOf(loan);
    if (!day) continue;
    const [sy, sm] = start.split("-").map(Number);
    for (let k = 0; k < 3; k += 1) {
      const y = sy + Math.floor((sm - 1 + k) / 12);
      const m = ((sm - 1 + k) % 12) + 1;
      const d = iso(y, m, Math.min(day, lastDay(y, m)));
      if (d < start || d > end) continue;
      if (loan.maturity && d > loan.maturity && !loan.autoRenew) continue;
      // 이미 그 달 상환이 기록됐으면 넣지 않는다.
      if (payments.some((p) => p.loanId === loan.id && !p.voided && String(p.date).slice(0, 7) === d.slice(0, 7))) continue;
      const e = expectedPayment(loan, bal, d);
      if (!e.total) continue;
      out.push({ id: `loan:${loan.id}:${d}`, company: loan.company, direction: "out", repeat: "once", date: d, amount: e.total,
        title: `${loan.bank} ${loan.name} 상환${e.principal ? "(원리금)" : "(이자)"}`, category: "대출상환", fromLoan: loan.id, estimated: true });
    }
  }
  return out;
}

// 클로브 출금 거래 → 상환 기록 후보.
//   txs: [{ transactionId, transactionAt, outAmount, accountNumber, transactionDescription, transactionName }]
// 같은 출금계좌에 대출이 여럿이면 상환일이 가장 가까운 대출, 그다음 예상액이 가까운 대출.
const LOAN_WORDS = /이자|대출|원리금|여신|상환|론/;
export function matchLoanPayments(loans, txs, existing = []) {
  const taken = new Set(existing.map((p) => String(p.txId || "")).filter(Boolean));
  const out = [];
  for (const tx of txs) {
    const amount = won(tx.outAmount);
    if (!amount || taken.has(String(tx.transactionId))) continue;
    const acct = digits(tx.accountNumber);
    const date = String(tx.transactionAt || "").slice(0, 10);
    const day = Number(date.slice(8, 10));
    const text = `${tx.transactionDescription || ""} ${tx.transactionName || ""} ${tx.transactionType || ""}`;
    const cands = loans.filter((l) => !l.closed && !l.rehabCreditor && digits(l.account) && digits(l.account) === acct).map((l) => {
      const bal = loanBalance(l, existing);
      const e = expectedPayment(l, bal, date);
      const pd = payDayOf(l);
      const dayGap = pd ? Math.min(Math.abs(day - Math.min(pd, lastDay(Number(date.slice(0, 4)), Number(date.slice(5, 7))))), 31) : 31;
      const ratio = e.total ? amount / e.total : 0;
      return { l, e, dayGap, ratio };
    }).filter((c) => c.dayGap <= 3 && (LOAN_WORDS.test(text) || (c.ratio > 0.7 && c.ratio < 1.3)));
    if (!cands.length) continue;
    cands.sort((a, b) => a.dayGap - b.dayGap || Math.abs(1 - a.ratio) - Math.abs(1 - b.ratio));
    const { l, e } = cands[0];
    const principal = Math.min(e.principal, amount);
    out.push({ id: `lp:tx:${tx.transactionId}`, loanId: l.id, date, amount, principal, interest: amount - principal,
      txId: String(tx.transactionId), memo: text.trim().slice(0, 100), source: "클로브" });
    taken.add(String(tx.transactionId));
  }
  return out;
}

// 시트 추출본 → 대출 기록 + 질문.
export function planLoanImport(extract, { today = "" } = {}) {
  const loans = [];
  const questions = [];
  const fmt = (n) => `${won(n).toLocaleString("ko-KR")}원`;
  for (const x of extract.loans || []) {
    const id = `loan:${x.sheetKey}`;
    const closed = (x.balanceBlank || !won(x.balance)) && (!x.maturity || x.maturity < today);
    const loan = { id, ...x, asOf: (extract.asOf || {})[x.company] || today, closed, autoRenew: /연갱신|매년만기|연장/.test(x.memo || ""), source: "대출금 관리대장" };
    loans.push(loan);
    if (!closed && x.maturity && x.maturity < today) {
      questions.push({
        id: `loan-maturity:${id}`, topic: "loan", kind: "loan-maturity", subjectId: id, status: "open",
        title: `${LOAN_COMPANIES[x.company]} ${x.bank} ${x.name}: 만기(${x.maturity})가 지났습니다`,
        detail: `잔액 ${fmt(x.balance)} · 연 ${x.rate}% · 매월 ${x.payDay || "?"} · ${x.memo || ""}`.trim(),
        choices: [{ key: "extended", label: "연장됨 · 새 만기일", input: "date" }, { key: "repaid", label: "다 갚음(종료)" }],
        ...(loan.autoRenew ? { suggested: "extended" } : {})
      });
    }
  }
  return { loans, questions };
}
