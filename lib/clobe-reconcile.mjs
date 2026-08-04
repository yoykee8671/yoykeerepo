// Matches unsettled WooofPay 입금요청 against real bank movements from clobe.
//
// Direction decides everything. A 입금요청 is money WooofPay owes a brand and
// always leaves the account as 출금 — 위탁 included, settled net of commission
// the following month. Matching across directions attaches a payout to an
// unrelated customer payment that happens to share the amount.
//
// Two passes, because brands pay both ways in practice:
//   A. 1:1 — one transfer settles exactly one request.
//   B. N:1 — one lump transfer settles several requests at once (the common
//      case for brands that batch a day's orders into a single wire).
//
// Nothing here mutates anything. Every result is a *proposal* carrying its own
// reasons and confidence; a human confirms before mark-paid runs. Auto-applying
// a wrong match is far more expensive to unwind than reviewing a list.

const DAY_MS = 24 * 60 * 60 * 1000;

// Deposits that are never customer settlements — internal sweeps between the
// company's own accounts would otherwise match by amount and pollute the list.
const DEFAULT_EXCLUDED_CATEGORIES = ["계좌간 입금", "계좌간 출금", "계좌간 이체"];

const MAX_GROUP_FOR_SUBSET_SUM = 20;
const MAX_SUBSET_SIZE = 6;
const MAX_DP_STATES = 200000;

export function reconcile({ requests = [], transactions = [], options = {} }) {
  const windowDays = Number(options.windowDays ?? 7);
  const excluded = new Set(options.excludedCategories || DEFAULT_EXCLUDED_CATEGORIES);
  const allowedAccountIds = Array.isArray(options.accountIds) && options.accountIds.length
    ? new Set(options.accountIds.map(Number))
    : null;

  // 방향이 핵심이다. 선매입은 우프가 브랜드에 지급하므로 통장에서는 출금이고,
  // 위탁만 브랜드가 우프에 보내는 입금이다. 방향을 섞으면 같은 금액의 손님
  // 결제건에 지급 요청이 붙는다 — 실제로 24,500원 지급건과 손님 입금 24,500원이
  // 같은 날 있었다.
  const deposits = transactions
    .filter((tx) => Number(tx.inAmount) > 0 || Number(tx.outAmount) > 0)
    .filter((tx) => !excluded.has(String(tx.category || "")))
    .filter((tx) => !allowedAccountIds || allowedAccountIds.has(Number(tx.accountId)))
    .map((tx) => ({
      raw: tx,
      transactionId: tx.transactionId,
      direction: Number(tx.outAmount) > 0 ? "OUT" : "IN",
      amount: Math.round(Number(tx.outAmount) > 0 ? Number(tx.outAmount) : Number(tx.inAmount)),
      at: parseDate(tx.transactionAt),
      // 메모는 사람이 애매한 건에 직접 단서를 남기는 자리다. 이름 후보에도
      // 넣고(고객명), 주문번호도 따로 뽑아 쓴다.
      names: [tx.transactionName, tx.transactionDescription, tx.memo].filter(Boolean).map(normalizeName),
      orderNos: extractOrderNos([tx.memo, tx.transactionDescription, tx.transactionName].filter(Boolean).join(" "))
    }));

  const pending = requests.map((request) => ({
    raw: request,
    id: request.id,
    // 호출부가 방향을 정한다. 기본은 출금(우프가 브랜드에 지급).
    direction: request.direction === "IN" ? "IN" : "OUT",
    amount: Math.round(Number(request.expectedAmount)),
    window: depositWindow(request, windowDays),
    names: [request.depositorName, request.customerName, request.brandName]
      .filter(Boolean)
      .map(normalizeName)
  }));

  const usedRequests = new Set();
  const usedTransactions = new Set();
  const matches = [];

  // Pass 0 — the operator wrote the order number in the clobe memo. That is a
  // direct statement of intent, so it outranks every heuristic below: take it
  // even when the amount disagrees, and surface the gap rather than hiding the
  // deposit among the unmatched.
  const byOrderNo = new Map();
  for (const request of pending) {
    const key = normalizeOrderNo(request.raw.orderNo);
    if (key) byOrderNo.set(key, request);
  }
  for (const deposit of deposits) {
    if (!deposit.orderNos.length) continue;
    const named = deposit.orderNos
      .map((no) => byOrderNo.get(no))
      .filter(Boolean)
      .filter((r) => !usedRequests.has(r.id) && r.direction === deposit.direction);
    if (!named.length) continue;
    named.forEach((request) => usedRequests.add(request.id));
    usedTransactions.add(deposit.transactionId);
    matches.push(buildMatch(deposit, named, "memo"));
  }

  // Pass A — score every plausible 1:1 pair, then take them best-first so a
  // strong name match wins the transaction over a same-amount coincidence.
  const pairs = [];
  for (const deposit of deposits) {
    for (const request of pending) {
      if (request.direction !== deposit.direction) continue;
      if (request.amount <= 0 || request.amount !== deposit.amount) continue;
      const dateScore = scoreDate(deposit.at, request.window);
      if (dateScore === null) continue;
      const nameScore = scoreNames(deposit.names, request.names);
      pairs.push({ deposit, request, score: nameScore * 2 + dateScore });
    }
  }
  pairs.sort((a, b) => b.score - a.score);

  for (const pair of pairs) {
    if (usedTransactions.has(pair.deposit.transactionId)) continue;
    if (usedRequests.has(pair.request.id)) continue;
    usedTransactions.add(pair.deposit.transactionId);
    usedRequests.add(pair.request.id);
    matches.push(buildMatch(pair.deposit, [pair.request], "one_to_one"));
  }

  // Pass B — group whatever is left by payer identity and look for a subset of
  // requests whose amounts add up to a single remaining deposit.
  const leftoverRequests = pending.filter((request) => !usedRequests.has(request.id));
  const groups = new Map();
  for (const request of leftoverRequests) {
    const key = request.names[0] || request.raw.brandId || "unknown";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(request);
  }

  for (const deposit of deposits) {
    if (usedTransactions.has(deposit.transactionId)) continue;
    for (const [, group] of groups) {
      const available = group.filter((request) => !usedRequests.has(request.id) && request.direction === deposit.direction);
      if (available.length < 2) continue;
      if (scoreNames(deposit.names, available[0].names) === 0) continue;
      const eligible = available
        .filter((request) => scoreDate(deposit.at, request.window) !== null)
        .slice(0, MAX_GROUP_FOR_SUBSET_SUM);
      const subset = findSubsetSummingTo(eligible, deposit.amount);
      if (!subset) continue;
      subset.forEach((request) => usedRequests.add(request.id));
      usedTransactions.add(deposit.transactionId);
      matches.push(buildMatch(deposit, subset, "many_to_one"));
      break;
    }
  }

  matches.sort((a, b) => (a.transaction.transactionAt < b.transaction.transactionAt ? 1 : -1));

  return {
    matches,
    unmatchedRequests: pending
      .filter((request) => !usedRequests.has(request.id))
      .map((request) => request.raw),
    unmatchedDeposits: deposits
      .filter((deposit) => !usedTransactions.has(deposit.transactionId))
      .map((deposit) => deposit.raw),
    summary: {
      depositCount: deposits.length,
      requestCount: pending.length,
      matchedCount: matches.length,
      matchedRequestCount: usedRequests.size,
      highConfidenceCount: matches.filter((match) => match.confidence === "high").length,
      outCount: deposits.filter((d) => d.direction === "OUT").length,
      inCount: deposits.filter((d) => d.direction === "IN").length
    }
  };
}

function buildMatch(deposit, requests, kind) {
  const nameScore = Math.max(...requests.map((request) => scoreNames(deposit.names, request.names)), 0);
  const dateScores = requests.map((request) => scoreDate(deposit.at, request.window) ?? 0);
  const worstDateScore = Math.min(...dateScores);
  const reasons = [];

  // 메모 매칭은 사람이 지정한 것이라 별도 등급으로 다룬다. 금액이 어긋나면
  // 그 사실을 근거에 그대로 적어 확인하게 만든다.
  if (kind === "memo") {
    const total = requests.reduce((sum, request) => sum + request.amount, 0);
    const orders = requests.map((request) => request.raw.orderNo).join(", ");
    reasons.push(`클로브 메모에 주문번호 지정: ${orders}`);
    if (total === deposit.amount) {
      reasons.push(`${deposit.direction === "OUT" ? "출금" : "입금"}액도 일치 (${formatMoney(deposit.amount)})`);
    } else {
      reasons.push(`⚠ 금액 불일치 — ${deposit.direction === "OUT" ? "출금" : "입금"} ${formatMoney(deposit.amount)} vs 요청 합계 ${formatMoney(total)} (차액 ${formatMoney(deposit.amount - total)})`);
    }
    return {
      kind,
      confidence: total === deposit.amount ? "high" : "low",
      reasons,
      amount: deposit.amount,
      transaction: deposit.raw,
      requests: requests.map((request) => request.raw)
    };
  }

  const dirLabel = deposit.direction === "OUT" ? "출금" : "입금";
  if (kind === "one_to_one") reasons.push(`${dirLabel} 금액 정확히 일치 (${formatMoney(deposit.amount)})`);
  else reasons.push(`${requests.length}건 합계가 ${dirLabel}액과 일치 (${formatMoney(deposit.amount)})`);

  if (nameScore >= 0.99) reasons.push("입금자명 일치");
  else if (nameScore >= 0.8) reasons.push("입금자명 부분 일치");
  else if (nameScore > 0) reasons.push("입금자명 유사");
  else reasons.push("입금자명 불일치 — 확인 필요");

  if (worstDateScore >= 0.8) reasons.push("입금예정일 근접");
  else if (worstDateScore > 0) reasons.push("입금예정일 범위 내");

  let confidence = "low";
  if (kind === "one_to_one" && nameScore >= 0.8 && worstDateScore >= 0.5) confidence = "high";
  else if (nameScore >= 0.8 || (kind === "one_to_one" && worstDateScore >= 0.8)) confidence = "medium";
  else if (kind === "many_to_one" && nameScore >= 0.99) confidence = "medium";

  return {
    kind,
    confidence,
    reasons,
    amount: deposit.amount,
    transaction: deposit.raw,
    requests: requests.map((request) => request.raw)
  };
}

// Bounded subset-sum. Amounts are whole KRW so exact integer arithmetic holds;
// the state cap keeps a pathological group from stalling the request.
function findSubsetSummingTo(requests, target) {
  if (!requests.length || target <= 0) return null;
  let states = new Map([[0, []]]);
  for (let index = 0; index < requests.length; index += 1) {
    const request = requests[index];
    if (request.amount <= 0 || request.amount > target) continue;
    const next = new Map(states);
    for (const [sum, chosen] of states) {
      if (chosen.length >= MAX_SUBSET_SIZE) continue;
      const candidateSum = sum + request.amount;
      if (candidateSum > target || next.has(candidateSum)) continue;
      const combination = [...chosen, index];
      if (candidateSum === target && combination.length >= 2) {
        return combination.map((position) => requests[position]);
      }
      next.set(candidateSum, combination);
    }
    states = next;
    if (states.size > MAX_DP_STATES) break;
  }
  return null;
}

function depositWindow(request, windowDays) {
  const expected = parseDate(request.expectedDepositDate);
  if (expected) {
    return { from: expected.getTime() - windowDays * DAY_MS, to: expected.getTime() + windowDays * DAY_MS };
  }
  const created = parseDate(request.createdAt) || new Date();
  // Without an expected date, allow the deposit to land any time from the day
  // before the request was raised through three weeks after.
  return { from: created.getTime() - DAY_MS, to: created.getTime() + 21 * DAY_MS };
}

// Returns null when the deposit falls outside the request's window, otherwise
// 1.0 for same-day down to ~0 at the window edge.
function scoreDate(depositAt, window) {
  if (!depositAt) return null;
  const time = depositAt.getTime();
  if (time < window.from || time > window.to) return null;
  const center = (window.from + window.to) / 2;
  const halfSpan = Math.max((window.to - window.from) / 2, 1);
  return 1 - Math.abs(time - center) / halfSpan;
}

function scoreNames(depositNames, requestNames) {
  let best = 0;
  for (const left of depositNames) {
    for (const right of requestNames) {
      best = Math.max(best, compareName(left, right));
    }
  }
  return best;
}

function compareName(left, right) {
  if (!left || !right) return 0;
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.85;
  const shared = longestCommonSubstring(left, right);
  const ratio = shared / Math.min(left.length, right.length);
  if (shared >= 2 && ratio >= 0.6) return 0.6;
  return 0;
}

// Strips the corporate-form noise banks add or truncate ("(주)", "주식회사")
// so "주식회사 우프컴퍼니" and "우프컴퍼니" compare equal.
// 주문번호는 "20260731-0000066" 형태다. 메모에 하이픈 없이 적거나 여러 건을
// 쉼표로 나열하는 경우가 있어, 8+7 자리 숫자 뭉치를 폭넓게 잡아 정규화한다.
function extractOrderNos(text) {
  const found = new Set();
  for (const match of String(text || "").matchAll(/\b(\d{8})[-\s]?(\d{6,8})\b/g)) {
    found.add(`${match[1]}-${match[2]}`);
  }
  return [...found];
}

function normalizeOrderNo(value) {
  const text = String(value || "").trim();
  const match = text.match(/^(\d{8})[-\s]?(\d{6,8})$/);
  return match ? `${match[1]}-${match[2]}` : "";
}

function normalizeName(value) {
  return String(value ?? "")
    .replace(/\(주\)|㈜|주식회사|유한회사|\(유\)/g, "")
    .replace(/[\s\-_.,()·]/g, "")
    .toLowerCase();
}

function longestCommonSubstring(left, right) {
  let best = 0;
  let previous = new Array(right.length + 1).fill(0);
  for (let i = 1; i <= left.length; i += 1) {
    const current = new Array(right.length + 1).fill(0);
    for (let j = 1; j <= right.length; j += 1) {
      if (left[i - 1] === right[j - 1]) {
        current[j] = previous[j - 1] + 1;
        if (current[j] > best) best = current[j];
      }
    }
    previous = current;
  }
  return best;
}

function parseDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatMoney(value) {
  return `${Number(value || 0).toLocaleString("ko-KR")}원`;
}
