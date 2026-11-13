// 지급요청 (v2). 채널톡 한 줄 요청과 노션 '우프 결제 업무 요청' DB 를 대신한다.
//
// 상태 흐름 (노션과 같은 말):
//   요청 → 확인 → (기준금액 이상이면 허가대기 → 확인) → 처리완료
//   어느 단계에서든 보류 / 취소 가능, 보류는 다시 요청으로 되돌릴 수 있다.

export const PAYMENT_STATUSES = {
  requested: "요청",
  confirmed: "확인",
  awaiting_approval: "허가대기",
  paid: "처리완료",
  on_hold: "보류",
  cancelled: "취소"
};

// 노션 '요청분류' + 자주 쓰는 것. 화면에서 고를 기본 목록이다.
export const PAYMENT_CATEGORIES = ["생산", "물류", "마케팅", "컨텐츠", "매입", "외주", "개인정산", "고정비", "기타"];

// 노션 '사용출금계좌' 선택지. 설정에서 바꿀 수 있다.
export const DEFAULT_WITHDRAW_ACCOUNTS = [
  "하나504_출금", "신한697_판관비", "신한453_위탁사입", "신한732_베럴즈", "신한725_대출",
  "신한756_투자", "우리464_투자(새벽)", "농협_151_신규", "하나체크카드", "법인카드결제", "현대카드결제"
];

export const DEFAULT_APPROVAL_THRESHOLD = 1_000_000;

const BANKS = [
  ["카카오뱅크", "카카오"], ["토스뱅크", "토스"], ["케이뱅크"], ["SC제일은행", "SC제일", "제일"],
  ["국민은행", "국민", "KB"], ["신한은행", "신한"], ["하나은행", "하나"], ["우리은행", "우리"],
  ["기업은행", "기업", "IBK"], ["농협은행", "농협", "NH"], ["수협은행", "수협"], ["우체국"],
  ["새마을금고", "새마을"], ["신협"], ["대구은행", "대구", "iM뱅크"], ["부산은행", "부산"],
  ["경남은행", "경남"], ["광주은행", "광주"], ["전북은행", "전북"], ["제주은행", "제주"],
  ["씨티은행", "씨티"], ["산업은행", "산업"]
];

// 은행 이름을 표준형으로 ("국민" → "국민은행").
export function normalizeBankName(text) {
  const t = String(text || "").trim();
  for (const [full, ...aliases] of BANKS) {
    if (t === full || aliases.includes(t) || t === `${aliases[0]}은행`) return full;
  }
  return t;
}

// 채널톡에 쓰던 한 줄 요청을 칸으로 나눈다.
//   "041302 04 196113 국민 김성준 로젠택배 8,000원 세림 택배 착불비 입금 부탁드립니다! @김예빈"
// → { accountNumber: "04130204196113", bankName: "국민은행", holder: "김성준",
//     amount: 8000, title: "로젠택배 세림 택배 착불비" }
// 못 찾은 칸은 빈 값으로 두고, 사람이 화면에서 채운다.
export function parseQuickPaymentText(input) {
  let text = String(input || "").replace(/\s+/g, " ").trim();
  const out = { accountNumber: "", bankName: "", holder: "", amount: 0, title: "", dueDate: "" };
  if (!text) return out;

  // 멘션·인사말 제거
  text = text.replace(/@\S+/g, " ")
    .replace(/(입금|이체|결제|송금)\s*(부탁|요청)\S*/g, " ")
    .replace(/부탁\s*드립니다|부탁합니다|요청\s*드립니다/g, " ")
    .replace(/[!！]+/g, " ");

  // 금액: "8,000원" / "8000 원" / "1.2만원"
  const man = text.match(/(\d+(?:\.\d+)?)\s*만\s*원/);
  const won = text.match(/(\d[\d,]*)\s*원/);
  if (man) {
    out.amount = Math.round(Number(man[1]) * 10000);
    text = text.replace(man[0], " ");
  } else if (won) {
    out.amount = Number(won[1].replace(/,/g, ""));
    text = text.replace(won[0], " ");
  }

  // 계좌번호: 숫자·하이픈·공백이 이어진 덩어리 중 숫자 10~16자리
  const runs = [...text.matchAll(/\d[\d\s-]{8,}\d/g)]
    .map((m) => ({ raw: m[0], digits: m[0].replace(/\D/g, "") }))
    .filter((r) => r.digits.length >= 10 && r.digits.length <= 16)
    .sort((a, b) => b.digits.length - a.digits.length);
  if (runs[0]) {
    out.accountNumber = runs[0].digits;
    text = text.replace(runs[0].raw, " ");
  }

  // 기한: "11/15까지", "11월 15일까지"
  const due = text.match(/(\d{1,2})\s*[/월.]\s*(\d{1,2})\s*일?\s*까지/);
  if (due) {
    const now = new Date();
    const y = now.getFullYear() + (Number(due[1]) < now.getMonth() + 1 - 6 ? 1 : 0);
    out.dueDate = `${y}-${String(due[1]).padStart(2, "0")}-${String(due[2]).padStart(2, "0")}`;
    text = text.replace(due[0], " ");
  }

  // 은행 + 바로 뒤 단어 = 예금주
  const tokens = text.split(" ").filter(Boolean);
  const bankIndex = tokens.findIndex((tok) => normalizeBankName(tok) !== tok || BANKS.some(([full]) => full === tok));
  if (bankIndex >= 0) {
    out.bankName = normalizeBankName(tokens[bankIndex]);
    const next = tokens[bankIndex + 1];
    if (next && !/\d/.test(next)) {
      out.holder = next;
      tokens.splice(bankIndex, 2);
    } else {
      tokens.splice(bankIndex, 1);
    }
  }
  out.title = tokens.join(" ").replace(/\s+/g, " ").trim();
  return out;
}

// 확인 단계에서 다음 상태. 기준금액 이상은 대표 허가를 거친다.
export function statusAfterConfirm(amount, threshold = DEFAULT_APPROVAL_THRESHOLD) {
  return Number(amount || 0) >= Number(threshold || 0) && Number(threshold) > 0 ? "awaiting_approval" : "confirmed";
}

// 상태를 바꿀 수 있는지. action → { from: [...], to, permission }
export const PAYMENT_ACTIONS = {
  confirm: { from: ["requested", "on_hold"], permission: "confirm" },
  approve: { from: ["awaiting_approval"], to: "confirmed", permission: "approve" },
  pay: { from: ["confirmed"], to: "paid", permission: "pay" },
  hold: { from: ["requested", "confirmed", "awaiting_approval"], to: "on_hold", permission: "confirm" },
  reopen: { from: ["on_hold", "cancelled", "paid"], to: "requested", permission: "confirm" },
  cancel: { from: ["requested", "confirmed", "awaiting_approval", "on_hold"], to: "cancelled", permission: "edit" }
};

// 오늘~N일 안에 나갈 돈 (처리완료·취소 제외). 날짜는 입금예정일 > 요청기한 순.
export function upcomingPayments(list, today, days = 7) {
  const start = String(today).slice(0, 10);
  const end = addDays(start, days);
  const open = (list || []).filter((p) => !["paid", "cancelled"].includes(p.status));
  const dated = open.map((p) => ({ ...p, when: String(p.plannedDate || p.dueDate || "").slice(0, 10) }));
  const overdue = dated.filter((p) => p.when && p.when < start);
  const window = dated.filter((p) => p.when && p.when >= start && p.when <= end);
  const undated = dated.filter((p) => !p.when);
  const byDay = {};
  for (const p of window) (byDay[p.when] ||= []).push(p);
  const sum = (rows) => rows.reduce((s, p) => s + Number(p.amount || 0), 0);
  return {
    start, end,
    overdue, overdueTotal: sum(overdue),
    byDay, windowTotal: sum(window),
    todayTotal: sum(byDay[start] || []),
    undated, undatedTotal: sum(undated)
  };
}

export function addDays(date, n) {
  const d = new Date(`${String(date).slice(0, 10)}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
