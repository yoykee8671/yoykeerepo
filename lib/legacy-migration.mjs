// 옛 선매입 관리대장(구글시트) → wooofpay 이관 계획 (v2).
//
// 2026_선매입 브랜드 관리대장의 브랜드 탭 주문들(대부분 2024-11 ~ 2026-05)을
// wooofpay 브랜드 내역에 '이관' 주문으로 붙이고, 회생계획 채권자 목록과 맞춰
// 브랜드 채권총액을 확인한다. 정할 수 없는 것은 질문(확인 필요)으로 남긴다.
//
// 대표가 정한 규칙 (2026-11-13):
//  - 수수료는 회생 채권총액 '전체'에서 차감한다.
//  - 시트와 wooofpay 에 같은 주문번호·같은 금액이 있으면 최종 건(wooofpay)만 남긴다.
//  - wooofpay 안에서 같은 주문번호·같은 금액이 여러 건이면 최신 한 건만 남긴다.
//  - 옛 주문은 모두 브랜드 내역에 보이고 채권 차감에 반영한다.

const norm = (s) => String(s || "").replace(/\s+/g, "").replace(/[()（）㈜]|주식회사/g, "").toLowerCase();
const orderKey = (no) => String(no || "").slice(0, 16);
const won = (n) => Math.round(Number(n || 0));

export function matchBrandForTab(tab, brands) {
  const t = norm(tab);
  return brands.find((b) => [b.rawSheetName, b.name].some((n) => {
    const k = norm(n);
    return k && (k === t || t.startsWith(k) || k.startsWith(t));
  })) || null;
}

export function matchCreditor(brand, creditors) {
  // 예금주가 '라이프인사이드 주식'처럼 잘려 있기도 해 끝의 '주식'을 떼고 본다.
  const trim = (s) => norm(s).replace(/주식$/, "");
  const keys = [trim(String(brand.name || "").split("(")[0]), trim(brand.businessName), trim(brand.depositorName)]
    .filter((k) => k.length >= 2);
  return creditors.find((c) => keys.some((k) => (norm(c.creditor) + norm(c.biz)).includes(k))) || null;
}

// tabs: { [tabName]: { rows: [{orderNo, customer, month, goods, ship, paid, margin, date, ret, b2b}] } }
// creditors: [{ creditor, biz, total }]
export function planMigration({ brands = [], requests = [], tabs = {}, creditors = [] }) {
  const live = requests.filter((r) => r.status !== "deleted");
  const legacyOrders = [];
  const autoDeletes = [];
  const questions = [];
  const perBrand = {};
  const q = (o) => questions.push({ status: "open", ...o });

  // 1) wooofpay 안 중복: 같은 브랜드·주문번호·입금액 → 최신만 남김
  const groups = new Map();
  for (const r of live) {
    if (!r.orderNo) continue;
    const k = `${r.brandId}|${orderKey(r.orderNo)}|${won(r.depositAmount)}`;
    (groups.get(k) || groups.set(k, []).get(k)).push(r);
  }
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const sorted = g.slice().sort((a, b) => String(b.updatedAt || b.createdAt).localeCompare(String(a.updatedAt || a.createdAt)));
    for (const r of sorted.slice(1)) autoDeletes.push({ requestId: r.id, keepId: sorted[0].id, orderNo: r.orderNo, amount: won(r.depositAmount), brandName: r.brandName });
  }
  const deleted = new Set(autoDeletes.map((d) => d.requestId));

  // 2) 시트 탭 → 브랜드, 주문 대조
  for (const [tab, { rows = [] } = {}] of Object.entries(tabs)) {
    if (!rows.length) continue;
    const brand = matchBrandForTab(tab, brands);
    if (!brand) {
      q({ id: `tab:${tab}`, topic: "migration", kind: "tab-brand", subjectId: tab,
        title: `시트 탭 '${tab}'(주문 ${rows.length}건)은 어느 브랜드인가요?`,
        detail: `wooofpay 브랜드 이름과 맞는 것을 찾지 못했습니다. 브랜드를 고르면 이 탭의 주문을 그 브랜드 내역으로 옮깁니다.`,
        choices: [{ key: "pick-brand", label: "브랜드 고르기", input: "brand" }, { key: "skip", label: "옮기지 않음" }],
        payload: { tab, rows } });
      continue;
    }
    const pb = perBrand[brand.id] ||= { brandId: brand.id, brandName: brand.name, tabs: [], imported: 0, skippedSame: 0, legacyDeducted: 0 };
    pb.tabs.push(tab);
    const appByNo = new Map();
    for (const r of live) {
      if (r.brandId !== brand.id || deleted.has(r.id)) continue;
      (appByNo.get(orderKey(r.orderNo)) || appByNo.set(orderKey(r.orderNo), []).get(orderKey(r.orderNo))).push(r);
    }
    rows.forEach((row, index) => {
      const key = orderKey(row.orderNo);
      const inApp = appByNo.get(key) || [];
      const same = inApp.find((r) => Math.abs(won(r.depositAmount) - won(row.paid)) <= 1);
      if (same) {
        pb.skippedSame += 1;
        // 같은 주문이면 wooofpay 건을 남긴다. 다만 wooofpay 쪽 채권차감이 비어 있고 시트엔 있으면 물어본다.
        if (brand.hasReceivable && won(row.margin) && Math.abs(won(same.receivableDeduction) - won(row.margin)) > 1) {
          q({ id: `deduct:${same.id}`, topic: "receivable", kind: "request-deduction", subjectId: same.id,
            title: `${brand.name} ${row.orderNo}: 채권차감액이 다릅니다`,
            detail: `시트 ${won(row.margin).toLocaleString()}원 / wooofpay ${won(same.receivableDeduction).toLocaleString()}원. 어느 쪽이 맞나요?`,
            choices: [{ key: "use-sheet", label: `시트 값 ${won(row.margin).toLocaleString()}원`, value: won(row.margin) },
              { key: "keep", label: `wooofpay 값 ${won(same.receivableDeduction).toLocaleString()}원 유지` }] });
        }
        return;
      }
      if (inApp.length) {
        q({ id: `amount:${brand.id}:${key}:${index}`, topic: "migration", kind: "amount-mismatch", subjectId: inApp[0].id,
          title: `${brand.name} ${row.orderNo}: 시트와 wooofpay 금액이 다릅니다`,
          detail: `시트 ${won(row.paid).toLocaleString()}원 / wooofpay ${won(inApp[0].depositAmount).toLocaleString()}원 (${row.date || ""})`,
          choices: [{ key: "keep-app", label: "wooofpay 건만 남김" }, { key: "import-too", label: "시트 건도 이관(별개 주문)" }],
          payload: { tab, row, brandId: brand.id } });
        return;
      }
      const deduct = brand.hasReceivable ? won(row.margin) : 0;
      legacyOrders.push({
        id: `lg_${brand.id}_${key}_${index}`, brandId: brand.id, brandName: brand.name, tab,
        orderNo: row.orderNo, customer: row.customer, month: row.month, date: row.date,
        goodsAmount: won(row.goods), shippingFee: won(row.ship), depositAmount: won(row.paid),
        margin: won(row.margin), receivableDeduction: deduct, returnNote: row.ret || "", b2b: row.b2b || "",
        source: "2026_선매입 브랜드 관리대장"
      });
      pb.imported += 1;
      pb.legacyDeducted += deduct;
    });
  }

  // 3) 채권총액: 회생계획 채권자 목록과 비교
  for (const brand of brands.filter((b) => b.hasReceivable)) {
    const c = matchCreditor(brand, creditors);
    const current = won(brand.receivableTotal);
    if (!c) {
      q({ id: `claim:${brand.id}`, topic: "receivable", kind: "claim-base", subjectId: brand.id,
        title: `${brand.name}: 회생계획 채권자 목록에서 찾지 못했습니다`,
        detail: `지금 wooofpay 채권총액은 ${current.toLocaleString()}원입니다. 채권총액을 확인해 주세요.`,
        choices: [{ key: "keep", label: `${current.toLocaleString()}원 유지` }, { key: "input", label: "직접 입력", input: "amount" }] });
      continue;
    }
    const plan = won(c.total);
    if (Math.abs(plan - current) <= 1) continue;
    q({ id: `claim:${brand.id}`, topic: "receivable", kind: "claim-base", subjectId: brand.id,
      title: `${brand.name}: 채권총액이 회생계획과 다릅니다`,
      detail: `회생계획(${c.creditor}${c.biz ? ` · ${c.biz}` : ""}) ${plan.toLocaleString()}원 / 지금 wooofpay ${current.toLocaleString()}원. 수수료는 채권총액 전체에서 차감합니다.`,
      choices: [{ key: "plan", label: `회생계획 ${plan.toLocaleString()}원`, value: plan },
        { key: "keep", label: `지금 값 ${current.toLocaleString()}원 유지` }, { key: "input", label: "직접 입력", input: "amount" }],
      suggested: "plan" });
  }

  // 4) 채권 브랜드인데 차감이 0원인 wooofpay 입금요청(정산 방식이 덜 설정된 채 올라간 건)
  for (const brand of brands.filter((b) => b.hasReceivable)) {
    const zero = live.filter((r) => r.brandId === brand.id && !deleted.has(r.id) && !Number(r.receivableDeduction)
      && Number(r.productSalesAmount || r.depositAmount) > 0);
    if (!zero.length) continue;
    q({ id: `zero:${brand.id}`, topic: "receivable", kind: "zero-deduction", subjectId: brand.id,
      title: `${brand.name}: 채권차감이 0원인 입금요청 ${zero.length}건`,
      detail: `수수료율 ${Number(brand.commissionRate || 0)}% · 정산유형 ${brand.settlementType}. 옛 시트에서는 주문마다 마진을 채권에서 차감했습니다. 이 브랜드는 어떻게 차감하나요?`,
      choices: [{ key: "rate", label: "수수료율(%)로 차감", input: "rate", ...(Number(brand.commissionRate) > 0 ? { value: Number(brand.commissionRate) } : {}) },
        { key: "supply-margin", label: "공급가 차이(우프마진)로 차감" },
        { key: "none", label: "0원이 맞음(차감 안 함)" }],
      payload: { requestIds: zero.map((r) => r.id) } });
  }

  return { legacyOrders, autoDeletes, questions, perBrand: Object.values(perBrand) };
}

// 브랜드 채권원장: 채권총액 − (이관 주문 차감 + wooofpay 차감 + 조정) = 잔액
// rehabPaid: 회생 현금변제로 이 브랜드(채권자)에 낸 돈 [{date, amount, memo}] — 채권총액에서 같이 뺀다(대표 확인 2026-11-15).
// plan: 회생계획표의 이 채권자 줄 {total, cash} — 20%(현금변제)·80%(수수료 차감으로 갚아 가는 몫)를 나눠 보여 준다.
export function receivableLedger(brand, { legacyOrders = [], requests = [], adjustments = [], rehabPaid = [], plan = null } = {}) {
  const entries = [];
  for (const p of rehabPaid) {
    entries.push({ date: p.date, kind: "회생변제", orderNo: "", amount: -won(p.amount), memo: p.memo || "" });
  }
  for (const o of legacyOrders.filter((x) => x.brandId === brand.id && x.receivableDeduction)) {
    entries.push({ date: o.date || o.month || "", kind: "이관", orderNo: o.orderNo, amount: -o.receivableDeduction, memo: o.customer });
  }
  for (const r of requests.filter((x) => x.brandId === brand.id && x.status !== "deleted" && Number(x.receivableDeduction))) {
    entries.push({ date: String(r.expectedDepositDate || r.createdAt || "").slice(0, 10), kind: "입금요청", orderNo: r.orderNo, amount: -won(r.receivableDeduction), memo: r.customerName });
  }
  for (const a of adjustments.filter((x) => x.brandId === brand.id)) {
    entries.push({ date: a.date, kind: "조정", orderNo: "", amount: won(a.amount), memo: a.memo });
  }
  entries.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  let balance = won(brand.receivableTotal);
  for (const e of entries) { balance += e.amount; e.balance = balance; }
  const rehabCash = rehabPaid.reduce((s, p) => s + won(p.amount), 0);
  const commission = -entries.filter((e) => e.amount < 0 && e.kind !== "회생변제").reduce((s, e) => s + e.amount, 0);
  const split = plan ? {
    planTotal: won(plan.total), cashPlan: won(plan.cash), cashPaid: rehabCash, cashLeft: Math.max(0, won(plan.cash) - rehabCash),
    convertPart: won(plan.total) - won(plan.cash), commission, convertLeft: Math.max(0, won(plan.total) - won(plan.cash) - commission)
  } : null;
  return { base: won(brand.receivableTotal), deducted: -entries.filter((e) => e.amount < 0).reduce((s, e) => s + e.amount, 0), balance, entries,
    rehabCash, commission, split };
}

// '차감 0원' 질문에 답한 뒤 그 입금요청들의 채권차감액을 다시 계산한다.
// 입금액은 건드리지 않는다(이미 송금한 건이 있다). 돌려주는 값: [{ id, before, after }] 와 건너뛴 건.
export function recomputeZeroDeductions(requests, { mode, rate = 0 }) {
  const changes = [];
  const skipped = [];
  for (const r of requests) {
    const sales = won(r.productSalesAmount || 0);
    let next = null;
    if (mode === "rate") {
      next = Math.round(sales * Number(rate) / 100) + Math.round(won(r.cancelledAmount) * (1 - Number(rate) / 100));
    } else if (mode === "supply-margin") {
      if (won(r.supplyAmount) > 0) next = Math.max(0, sales - won(r.supplyAmount));
      else { skipped.push({ id: r.id, reason: "공급가 없음" }); continue; }
    }
    if (next == null || next === won(r.receivableDeduction)) continue;
    changes.push({ id: r.id, before: won(r.receivableDeduction), after: next });
  }
  return { changes, skipped };
}

