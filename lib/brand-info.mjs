// 입점 브랜드 정보 정리 (v2).
//
// 브랜드 정보는 구글 설문(우프 파트너 브랜드사 정보 업데이트) 응답 시트에 쌓여 있다.
// 한 브랜드가 여러 번 응답했을 수 있어 가장 최근 응답을 쓴다.
//   - 비어 있는 칸은 바로 채운다(자동).
//   - 이미 값이 있는데 다르면 확인 필요로 묻는다(특히 계좌 — 입금요청 계좌가 바뀐다).
//   - wooofpay 에 없는 브랜드는 '신규'로, 오래 거래가 없는 브랜드는 '장기 미거래'로 표시한다.
import { matchBrandName } from "./monthly-board.mjs";

const t = (v) => String(v ?? "").replace(/\s+/g, " ").trim();
const digits = (v) => String(v ?? "").replace(/\D/g, "");

// [머리글 정규식, 저장 위치]. 위치가 'top.' 이면 브랜드 본 칸, 아니면 brand.profile 안.
export const FORM_FIELDS = [
  [/브랜드명.*국문/, "profile.nameKo", "브랜드명(국문)"],
  [/브랜드명.*영문/, "profile.nameEn", "브랜드명(영문)"],
  [/사업자\s*유형/, "profile.businessType", "사업자유형"],
  [/회사명|상호/, "top.businessName", "상호"],
  [/대표자\s*명/, "top.representativeName", "대표자"],
  [/대표자\s*연락처/, "profile.ceoPhone", "대표자 연락처"],
  [/사업자\s*등록\s*번호/, "top.businessNumber", "사업자번호"],
  [/공급\s*형태/, "profile.supplyType", "공급형태"],
  [/사무실\s*전화/, "profile.phone", "대표 전화"],
  [/사업장\s*주소/, "profile.address", "사업장 주소"],
  [/웹사이트|홈페이지/, "profile.website", "웹사이트"],
  [/SNS|인스타/, "profile.sns", "SNS"],
  [/공급사\s*아이디/, "profile.supplierId", "공급사 아이디"],
  [/세금계산서.*이메일/, "profile.invoiceEmail", "세금계산서 이메일"],
  [/거래\s*은행/, "top.bankName", "은행"],
  [/계좌\s*번호/, "top.bankAccount", "계좌번호"],
  [/예금주/, "top.accountHolder", "예금주"],
  [/반품.*주소|반품 배송지/, "profile.returnAddress", "반품지"],
  [/택배사/, "profile.courier", "택배사"],
  [/배송비\s*정책/, "profile.shippingPolicyText", "배송비 정책"],
  [/도서산간/, "profile.remoteFee", "도서산간 추가배송비"],
  [/발송\s*마감/, "profile.cutoffText", "발송 마감"],
  [/메인 담당자 성함/, "profile.contacts.main.name", "메인 담당자"],
  [/메인 담당자 이메일/, "profile.contacts.main.email", "메인 담당자 이메일"],
  [/메인 담당자 일반전화/, "profile.contacts.main.phone", "메인 담당자 전화"],
  [/메인 담당자 휴대폰/, "profile.contacts.main.mobile", "메인 담당자 휴대폰"],
  [/CS\s*담당자\s*이름/, "profile.contacts.cs.name", "CS 담당자"],
  [/CS\s*담당자\s*일반전화/, "profile.contacts.cs.phone", "CS 전화"],
  [/CS\s*담당자\s*휴대폰/, "profile.contacts.cs.mobile", "CS 휴대폰"],
  [/CS\s*담당자\s*이메일/, "profile.contacts.cs.email", "CS 이메일"],
  [/배송 담당자명/, "profile.contacts.delivery.name", "배송 담당자"],
  [/배송 담당자 연락처.*일반/, "profile.contacts.delivery.phone", "배송 전화"],
  [/배송 담당자 연락처.*휴대/, "profile.contacts.delivery.mobile", "배송 휴대폰"],
  [/배송 담당자 이메일/, "profile.contacts.delivery.email", "배송 이메일"],
  [/정산 담당자 이름/, "profile.contacts.settlement.name", "정산 담당자"],
  [/정산 담당자 연락처.*일반/, "profile.contacts.settlement.phone", "정산 전화"],
  [/정산 담당자 연락처.*휴대/, "profile.contacts.settlement.mobile", "정산 휴대폰"],
  [/정산 담당자 이메일/, "profile.contacts.settlement.email", "정산 이메일"]
];
const LABEL = Object.fromEntries(FORM_FIELDS.map(([, p, l]) => [p, l]));

// '2025. 4. 23 오후 2:14:31' → 정렬 가능한 문자열
export function formTime(v) {
  const s = t(v);
  const m = s.match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})[^\d오]*(오전|오후)?\s*(\d{1,2})?:?(\d{2})?/);
  if (!m) return s;
  let h = Number(m[5] || 0);
  if (m[4] === "오후" && h < 12) h += 12;
  if (m[4] === "오전" && h === 12) h = 0;
  return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}T${String(h).padStart(2, "0")}:${m[6] || "00"}`;
}

// 응답 한 줄 → { time, name, values: { path: value } }
export function readResponse(row) {
  const values = {};
  let time = "";
  for (const [header, raw] of Object.entries(row)) {
    if (/타임스탬프|timestamp/i.test(header)) { time = formTime(raw); continue; }
    const f = FORM_FIELDS.find(([re]) => re.test(header));
    const v = t(raw);
    if (f && v && !values[f[1]]) values[f[1]] = v;
  }
  return { time, name: values["profile.nameKo"] || values["top.businessName"] || "", values };
}

const getPath = (brand, p) => {
  const [root, ...rest] = p.split(".");
  let cur = root === "top" ? brand : brand.profile || {};
  for (const k of rest) cur = cur?.[k];
  return cur;
};
const same = (p, a, b) => (/bankAccount|businessNumber|phone|mobile/i.test(p) ? digits(a) === digits(b) : t(a).toLowerCase() === t(b).toLowerCase());

// sheets: { 탭이름: [행 객체] }, requests: 마지막 거래일 계산용
export function planBrandInfo({ brands = [], sheets = {}, requests = [], today = "", dormantDays = 180 }) {
  const latest = new Map();
  for (const rows of Object.values(sheets)) {
    for (const row of rows || []) {
      const r = readResponse(row);
      if (!r.name) continue;
      const key = r.name.replace(/\s+/g, "").toLowerCase();
      if (!latest.has(key) || r.time >= latest.get(key).time) latest.set(key, r);
    }
  }
  const auto = [], conflicts = [], newBrands = [];
  const seen = new Set();
  for (const r of latest.values()) {
    const b = matchBrandName(r.name, brands) || (r.values["profile.nameEn"] ? matchBrandName(r.values["profile.nameEn"], brands) : null);
    if (!b) { newBrands.push({ name: r.name, time: r.time, businessName: r.values["top.businessName"] || "", supplyType: r.values["profile.supplyType"] || "" }); continue; }
    if (seen.has(b.id)) continue;
    seen.add(b.id);
    const fill = {}, diff = [];
    for (const [p, v] of Object.entries(r.values)) {
      if (p === "profile.nameKo") continue;
      const cur = getPath(b, p);
      if (cur === undefined || cur === null || t(cur) === "") fill[p] = v;
      else if (!same(p, cur, v)) diff.push({ path: p, label: LABEL[p] || p, current: t(cur), sheet: v });
    }
    if (Object.keys(fill).length) auto.push({ brandId: b.id, brandName: b.name, set: fill, time: r.time });
    if (diff.length) conflicts.push({ brandId: b.id, brandName: b.name, time: r.time, fields: diff });
  }
  // 마지막 거래(입금요청) 날짜
  const last = {};
  for (const q of requests) {
    if (q.status === "deleted") continue;
    const d = String(q.createdAt || "").slice(0, 10);
    if (d > (last[q.brandId] || "")) last[q.brandId] = d;
  }
  const cut = today ? new Date(Date.parse(`${today}T00:00:00Z`) - dormantDays * 86400000).toISOString().slice(0, 10) : "";
  const dormant = brands.filter((b) => b.isActive !== false && (b.type || "brand") === "brand" && (!last[b.id] || last[b.id] < cut))
    .map((b) => ({ brandId: b.id, brandName: b.name, lastRequest: last[b.id] || "" }));
  return { auto, conflicts, newBrands, dormant, lastRequest: last, responses: latest.size };
}

// 값 넣기: path 'top.x' / 'profile.a.b.c'
export function applyPaths(brand, set) {
  for (const [p, v] of Object.entries(set)) {
    const [root, ...rest] = p.split(".");
    if (root === "top") { brand[rest[0]] = v; continue; }
    brand.profile ||= {};
    let cur = brand.profile;
    for (const k of rest.slice(0, -1)) cur = (cur[k] ||= {});
    cur[rest.at(-1)] = v;
  }
  return brand;
}

export function brandInfoQuestions({ conflicts = [], newBrands = [] }) {
  const qs = conflicts.map((c) => {
    const bank = c.fields.some((f) => /bank|accountHolder/.test(f.path));
    return {
      id: `brand-info:${c.brandId}`, topic: "brand-info", kind: "brand-info", subjectId: c.brandId,
      title: `${c.brandName}: 업체 정보가 설문 응답(${c.time.slice(0, 10)})과 다릅니다${bank ? " — ⚠ 계좌 포함" : ""}`,
      detail: c.fields.map((f) => `${f.label}: 지금 '${f.current}' / 설문 '${f.sheet}'`).join(" · ") + (bank ? " · 계좌를 바꾸면 이후 입금요청이 새 계좌로 나갑니다." : ""),
      choices: [{ key: "sheet", label: "설문 값으로 바꾸기" }, ...(bank ? [{ key: "sheet-no-bank", label: "계좌만 빼고 바꾸기" }] : []), { key: "keep", label: "지금 값 유지" }],
      payload: { set: Object.fromEntries(c.fields.map((f) => [f.path, f.sheet])) },
      suggested: bank ? "sheet-no-bank" : "sheet"
    };
  });
  if (newBrands.length) {
    qs.push({ id: "brand-info:new", topic: "brand-info", kind: "brand-new", subjectId: "new",
      title: `설문에만 있고 wooofpay 에 없는 브랜드 ${newBrands.length}곳`,
      detail: newBrands.map((n) => `${n.name}${n.businessName ? `(${n.businessName})` : ""} ${n.time.slice(0, 10)}`).join(", ") + ". 거래할 브랜드면 브랜드 메뉴에서 등록하세요(등록 후 다시 올리면 정보가 채워집니다).",
      choices: [{ key: "ok", label: "확인함" }] });
  }
  return qs;
}
