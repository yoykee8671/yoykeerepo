// 확인 필요 '제안' 질문 (v2).
//
// 시트마다 모양이 제각각이라 파서를 만들기 아까운 자료(미수·미지급 시트 등)는
// 사람이 읽고 '이렇게 등록할까요?' 제안 질문으로 올린다. 선택지마다 실제로 할 일
// (자금 일정·지급요청·생산비 지급 기록)을 담아 두고, 답하면 그대로 실행한다.
// 질문 자료는 저장소에 넣지 않고 배포 때 오너가 올린다(금액·거래처 정보).

const str = (v, n = 200) => String(v ?? "").trim().slice(0, n);
const amt = (v) => Math.max(0, Math.round(Number(String(v ?? "").replace(/,/g, "")) || 0));
const date = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : "");
const COMPANIES = new Set(["wooof", "betters"]);

export function sanitizeAction(a = {}) {
  switch (a.type) {
    case "cashSchedule": {
      const repeat = ["once", "monthly", "weekly"].includes(a.repeat) ? a.repeat : "once";
      const out = { type: a.type, title: str(a.title), direction: a.direction === "in" ? "in" : "out", amount: amt(a.amount),
        category: str(a.category, 40), repeat, company: COMPANIES.has(a.company) ? a.company : "wooof", memo: str(a.memo, 500),
        date: date(a.date), startDate: date(a.startDate), endDate: date(a.endDate) };
      if (repeat === "monthly") out.dayOfMonth = Math.min(31, Math.max(1, Math.round(Number(a.dayOfMonth) || 1)));
      if (!out.title || !out.amount || (repeat === "once" && !out.date)) throw new Error(`자금 일정이 덜 채워졌습니다: ${out.title || "?"}`);
      return out;
    }
    case "payment": {
      const out = { type: a.type, title: str(a.title), payeeName: str(a.payeeName), amount: amt(a.amount), dueDate: date(a.dueDate),
        category: str(a.category, 40) || "기타", company: COMPANIES.has(a.company) ? a.company : "wooof", memo: str(a.memo, 1000) };
      if (!out.title || !out.amount) throw new Error(`지급요청이 덜 채워졌습니다: ${out.title || "?"}`);
      return out;
    }
    case "prodPayment": {
      const out = { type: a.type, partnerName: str(a.partnerName), date: date(a.date), amount: amt(a.amount), memo: str(a.memo, 300) };
      if (!out.partnerName || !out.date || !out.amount) throw new Error("생산비 지급 기록이 덜 채워졌습니다.");
      return out;
    }
    default:
      throw new Error(`모르는 할 일입니다: ${a.type}`);
  }
}

// 올린 제안 하나를 질문 모양으로 정리한다. id 는 'proposal:' 로 시작한다.
export function normalizeProposal(p = {}) {
  const key = str(p.key, 80).replace(/[^\w가-힣:.-]/g, "_");
  if (!key) throw new Error("제안 key 가 필요합니다.");
  const choices = (Array.isArray(p.choices) ? p.choices : []).slice(0, 6).map((c, i) => ({
    key: str(c.key, 40) || `c${i}`, label: str(c.label, 120), actions: (Array.isArray(c.actions) ? c.actions : []).slice(0, 24).map(sanitizeAction)
  }));
  if (!choices.length || choices.some((c) => !c.label)) throw new Error(`제안 '${key}'의 선택지가 비었습니다.`);
  return { id: `proposal:${key}`, topic: str(p.topic, 40) || "proposal", kind: "proposal", subjectId: key,
    title: str(p.title, 200), detail: str(p.detail, 2000), source: str(p.source, 200), choices,
    ...(p.suggested && choices.some((c) => c.key === p.suggested) ? { suggested: p.suggested } : {}) };
}

// 사람이 읽는 요약(답한 뒤 남길 문구).
export function describeActions(actions = []) {
  const won = (n) => `${Number(n).toLocaleString("ko-KR")}원`;
  return actions.map((a) => a.type === "cashSchedule"
    ? `일정 '${a.title}' ${a.repeat === "monthly" ? `매월 ${a.dayOfMonth}일` : a.date} ${won(a.amount)}`
    : a.type === "payment" ? `지급요청 '${a.title}' ${won(a.amount)}`
      : `생산비 지급 ${a.partnerName} ${a.date} ${won(a.amount)}`).join(", ") || "할 일 없음";
}
