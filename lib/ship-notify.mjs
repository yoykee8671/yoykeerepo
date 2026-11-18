// 입금완료된 입금요청을 브랜드 출고 담당자에게 알린다(문자·메일).
// 받는 곳은 브랜드에 따로 넣은 '주문배송 담당' 값이 우선이고, 비어 있으면
// 브랜드 설문(배송·메인 담당자) → 대표자 → 연결 거래처 담당자 → 계산서 메일 순으로 찾는다.

export const SHIP_MODES = { off: "안 보냄", manual: "버튼으로 보냄", auto: "입금완료 때 자동" };

// 단문(90byte) 안에 들어가도록 짧게. 한글은 2byte로 센다.
export const DEFAULT_TEMPLATES = {
  sms: [
    { id: "sms1", name: "출고 요청(기본)", text: "[우프]{브랜드} 주문{주문번호} 입금완료. 출고 부탁드립니다." },
    { id: "sms2", name: "출고 재요청", text: "[우프]{브랜드} {주문번호} 미출고. 오늘 출고 부탁드립니다." },
    { id: "sms3", name: "여러 건", text: "[우프]{브랜드} 입금완료 {건수}건. 출고 부탁드립니다." }
  ],
  mail: [
    { id: "mail1", name: "출고 요청(기본)", subject: "[우프] {브랜드} 주문 {주문번호} 입금완료 — 출고 부탁드립니다",
      body: "{브랜드} 담당자님, 안녕하세요. 우프입니다.\n\n아래 주문의 입금이 완료되었습니다. 출고 부탁드립니다.\n\n주문번호: {주문번호}\n주문자: {주문자}\n입금일: {입금일}\n품목: {품목}\n\n감사합니다.\n우프 CS (wooof.betters@gmail.com)" },
    { id: "mail2", name: "출고 재요청", subject: "[우프] {브랜드} 주문 {주문번호} 출고 확인 부탁드립니다",
      body: "{브랜드} 담당자님, 우프입니다.\n\n{입금일}에 입금완료된 주문 {주문번호}({주문자})이 아직 출고되지 않은 것으로 보여 연락드립니다. 오늘 중 출고 부탁드리며, 지연 사유가 있으면 회신 부탁드립니다.\n\n품목: {품목}\n\n감사합니다.\n우프 CS" },
    { id: "mail3", name: "여러 건 묶음", subject: "[우프] {브랜드} 입금완료 {건수}건 — 출고 부탁드립니다",
      body: "{브랜드} 담당자님, 우프입니다.\n\n아래 {건수}건의 입금이 완료되었습니다. 출고 부탁드립니다.\n\n{주문목록}\n\n감사합니다.\n우프 CS" }
  ]
};

const digits = (v) => String(v || "").replace(/\D/g, "");
export const isMobile = (v) => /^01[016789]\d{7,8}$/.test(digits(v));
const isEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v || "").trim());

function partnerOf(brand, partners = []) {
  const code = String(brand?.partnerCode || "").trim();
  return code ? partners.find((p) => p.code === code || p.id === code) || null : null;
}

// [{ value, source }] 후보를 순서대로 보고 맞는 첫 값을 준다.
function firstOf(candidates, ok) {
  for (const c of candidates) if (ok(c.value)) return { value: String(c.value).trim(), source: c.source };
  return { value: "", source: "" };
}

export function resolveShipPhone(brand, partners = []) {
  const p = brand?.profile || {};
  const c = p.contacts || {};
  const partner = partnerOf(brand, partners);
  const hit = firstOf([
    { value: brand?.shipContactPhone, source: "주문배송 담당" },
    { value: c.delivery?.mobile, source: "배송 담당자(설문)" },
    { value: c.main?.mobile, source: "메인 담당자(설문)" },
    { value: p.ceoPhone, source: "대표자(설문)" },
    { value: partner?.contactPhone, source: "거래처 담당자" }
  ], isMobile);
  return { ...hit, value: hit.value ? digits(hit.value) : "" };
}

export function resolveShipEmail(brand, partners = []) {
  const p = brand?.profile || {};
  const c = p.contacts || {};
  const partner = partnerOf(brand, partners);
  return firstOf([
    { value: brand?.shipContactEmail, source: "주문배송 담당" },
    { value: c.delivery?.email, source: "배송 담당자(설문)" },
    { value: c.main?.email, source: "메인 담당자(설문)" },
    { value: partner?.contactEmail, source: "거래처 담당자" },
    { value: p.invoiceEmail, source: "계산서 메일(설문)" },
    { value: partner?.invoiceEmail, source: "거래처 계산서 메일" }
  ], isEmail);
}

// 문자 길이(EUC-KR 기준: 한글 2byte, 영문·숫자 1byte). 90byte 넘으면 장문 요금.
export function smsBytes(text) {
  let n = 0;
  for (const ch of String(text || "")) n += ch.charCodeAt(0) > 127 ? 2 : 1;
  return n;
}

const fmtDate = (v) => String(v || "").slice(0, 10);
export function templateVars(brand, requests = []) {
  const list = Array.isArray(requests) ? requests : [requests];
  const first = list[0] || {};
  return {
    브랜드: brand?.name || first.brandName || "",
    주문번호: list.length > 1 ? `${first.orderNo} 외 ${list.length - 1}건` : first.orderNo || "",
    주문자: first.customerName || "",
    입금일: fmtDate(first.paidAt),
    품목: (first.lineItems || []).map((l) => `${l.itemName || ""}${l.quantity ? ` ×${l.quantity}` : ""}`).filter(Boolean).join(", ") || "-",
    건수: String(list.length),
    주문목록: list.map((r) => `- ${r.orderNo} ${r.customerName || ""} (${fmtDate(r.paidAt)})`).join("\n")
  };
}

export function fillTemplate(text, vars) {
  return String(text || "").replace(/\{([^}]+)\}/g, (m, key) => (key in vars ? vars[key] : m));
}

export function templatesOf(settings) {
  const t = settings?.templates || {};
  return {
    sms: Array.isArray(t.sms) && t.sms.length ? t.sms : DEFAULT_TEMPLATES.sms,
    mail: Array.isArray(t.mail) && t.mail.length ? t.mail : DEFAULT_TEMPLATES.mail
  };
}

// 자동 발송 대상: 브랜드가 '자동'이고, 자동을 켠 뒤에 입금완료됐고, 아직 안 보낸 건.
// 켜기 전 입금완료 건까지 한꺼번에 나가지 않게 autoSince 이후만 본다.
export function dueAutoNotices(db, { maxAgeDays = 3, now = new Date() } = {}) {
  const out = [];
  const cutoff = new Date(now.getTime() - maxAgeDays * 86400000).toISOString();
  const brands = new Map((db.brands || []).map((b) => [b.id, b]));
  for (const r of db.requests || []) {
    if (r.status !== "paid" || !r.paidAt) continue;
    const brand = brands.get(r.brandId);
    if (!brand) continue;
    const paidIso = new Date(r.paidAt).toISOString();
    if (paidIso < cutoff) continue;
    for (const channel of ["sms", "mail"]) {
      const mode = channel === "sms" ? brand.shipSmsMode : brand.shipMailMode;
      const since = channel === "sms" ? brand.shipSmsAutoSince : brand.shipMailAutoSince;
      if (mode !== "auto" || !since || paidIso < new Date(since).toISOString()) continue;
      const sent = r.shipNotify?.[channel];
      if (sent?.ok || (sent?.tries || 0) >= 3) continue;
      // 보내는 중 표시(10분 안)는 건너뛴다 — 두 번 나가지 않게.
      if (sent?.pendingAt && now.getTime() - new Date(sent.pendingAt).getTime() < 10 * 60000) continue;
      out.push({ request: r, brand, channel });
    }
  }
  return out;
}
