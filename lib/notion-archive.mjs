// 노션 → ERP 아카이브 (v2).
//
// 노션 '내보내기(CSV)' 4개를 읽는다:
//   결제업무 요청(우프 결제 업무 요청) · 발주 및 정산 업체 정보 · 세금계산서 발행 요청 · 영업거래처 대장.
// - 결제·계산서 기록은 그대로 아카이브(검색용)로 남긴다. 관계(상호 ↔ 결제 ↔ 계산서)는 이름과 노션 링크로 다시 잇는다.
// - 업체는 ERP 거래처로 합친다. 2025-01-01 이후 결제가 있으면 '활성', 아니면 '보관'.
// - 노션의 협력사 쇼핑몰 아이디·비밀번호는 가져오지 않는다(보안). 첨부파일은 파일 이름만 남긴다.

// --- CSV (RFC 4180: 따옴표 안 쉼표·줄바꿈 허용) ---------------------------------
export function parseCsv(text) {
  const src = String(text || "").replace(/^﻿/, "");
  const rows = [];
  let row = [];
  let cell = "";
  let q = false;
  for (let i = 0; i < src.length; i += 1) {
    const c = src[i];
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { cell += '"'; i += 1; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i += 1;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head = [], ...body] = rows.filter((r) => r.some((x) => String(x).trim()));
  return body.map((r) => Object.fromEntries(head.map((h, i) => [h.trim(), String(r[i] ?? "").trim()])));
}

// '2022년 3월 8일 오전 11:42' · '2022년 3월 11일' · '2022/03/11' → ISO(+09:00) 또는 'YYYY-MM-DD'
export function parseKoDate(text) {
  const t = String(text || "").trim();
  if (!t) return "";
  let m = t.match(/(\d{4})\s*[년./-]\s*(\d{1,2})\s*[월./-]\s*(\d{1,2})/);
  if (!m) return "";
  const date = `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
  m = t.match(/(오전|오후)\s*(\d{1,2}):(\d{2})/);
  if (!m) return date;
  let h = Number(m[2]) % 12;
  if (m[1] === "오후") h += 12;
  return `${date}T${String(h).padStart(2, "0")}:${m[3]}:00+09:00`;
}

export const parseWon = (text) => {
  const n = Number(String(text || "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : 0;
};

// '어반애니멀 (https://app.notion.com/p/8fe3…?pvs=21), 다른곳 (https://…)' → [{name, url}]
export function parseRelations(text) {
  const out = [];
  const re = /(.*?)\s*\((https:\/\/[^)\s]+)\)\s*(?:,\s*|$)/g;
  const t = String(text || "").trim();
  let m;
  let last = 0;
  while ((m = re.exec(t))) {
    if (m.index === re.lastIndex) break;
    out.push({ name: m[1].trim(), url: m[2].replace(/\?pvs=\d+$/, "") });
    last = re.lastIndex;
  }
  if (!out.length && t) return [{ name: t, url: "" }];
  if (last < t.length && t.slice(last).trim()) out.push({ name: t.slice(last).trim(), url: "" });
  return out;
}

export const normName = (s) => String(s || "").replace(/주식회사|㈜|\(주\)|유한회사|\s/g, "").toLowerCase();
const attachmentNames = (text) => String(text || "").split(/,\s*(?=[^,]*\.)/).map((s) => {
  const raw = s.trim();
  if (!raw) return "";
  let name = raw.replace(/^attachment:[0-9a-f-]+:/, "");
  try { name = decodeURIComponent(name); } catch {}
  return name.split("/").pop();
}).filter(Boolean);

// 노션 '구분'(업체) → ERP 거래처 역할
export const ROLE_FROM_NOTION = {
  생산: "production", 새벽배송: "purchase", 직매입: "purchase", 우프배송: "purchase", 선매입: "purchase", PICKYPARK: "purchase",
  컨텐츠: "service", 오프라인: "service", 인쇄물: "service", 경영: "service", 서비스이용: "service", 교육: "service", 세금: "etc",
  기타: "etc", 개인정산: "etc", 직원: "etc",
  "대리점(도매)": "sales", "동물병원(도매)": "sales", 외주용역: "service"
};

const hash = (s) => {
  let h = 2166136261;
  for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619) >>> 0; }
  return h.toString(36);
};

export function archivePayments(rows) {
  return rows.map((r, i) => {
    const vendor = parseRelations(r["상호"])[0] || { name: "", url: "" };
    const createdAt = parseKoDate(r["작성일"]);
    return {
      id: `np:${hash(`${r["작성일"]}|${r["주문내용"]}|${r["입금금액"]}|${vendor.name}|${i}`)}`,
      title: r["주문내용"] || "", vendorName: vendor.name || r["예금주명"] || "", vendorUrl: vendor.url,
      status: r["상태"] || "", amount: parseWon(r["입금금액"]), createdAt, year: createdAt.slice(0, 4),
      dueDate: parseKoDate(r["요청입금기한"]).slice(0, 10), plannedDate: parseKoDate(r["입금예정일"]).slice(0, 10),
      category: r["요청분류"] || "", midCategory: r["중분류"] || "", subCategory: r["소분류"] || "",
      withdrawAccount: r["사용출금계좌"] || "", invoiceMethod: r["계산서발행"] || "",
      bank: r["은행"] || "", account: r["입금계좌번호"] || "", holder: r["예금주명"] || "",
      author: r["작성자"] || "", manager: r["담당자"] || "", orderNo: r["주문번호"] || "",
      files: attachmentNames(r["파일과 미디어"]), source: "노션 결제업무"
    };
  });
}

export function archiveInvoices(rows) {
  return rows.map((r, i) => {
    const biz = parseRelations(r["사업자명"])[0] || { name: "", url: "" };
    return {
      id: `ni:${hash(`${r["제목"]}|${r["발행일자"]}|${r["금액(합계)"]}|${i}`)}`,
      title: r["제목"] || "", partnerName: biz.name, partnerUrl: biz.url, kind: r["구분"] || "",
      amount: parseWon(r["금액(합계)"]), issuedAt: parseKoDate(r["발행일자"]).slice(0, 10),
      paidOrDue: parseKoDate(r["입금일/기한"]).slice(0, 10), status: r["상태"] || "", content: r["발행내용(필요시)"] || "",
      email: r["발행용이메일"] || "", manager: r["담당자"] || "", files: attachmentNames(r["명세서"]), source: "노션 세금계산서 발행 요청"
    };
  });
}

// 업체 정보 + 영업거래처 + 결제 통계 → 거래처 후보
export function vendorCandidates({ vendors = [], salesPartners = [], payments = [], activeSince = "2025-01-01" }) {
  const stats = new Map();
  for (const p of payments) {
    const k = normName(p.vendorName);
    if (!k) continue;
    const s = stats.get(k) || { count: 0, total: 0, first: "", last: "", accounts: new Set() };
    s.count += 1;
    s.total += p.amount || 0;
    const d = String(p.createdAt).slice(0, 10);
    if (d && (!s.first || d < s.first)) s.first = d;
    if (d && d > s.last) s.last = d;
    if (p.account) s.accounts.add(p.account.replace(/\D/g, ""));
    stats.set(k, s);
  }
  const out = [];
  for (const v of vendors) {
    const name = v["상호명(사업자명)"] || "";
    if (!name) continue;
    const s = stats.get(normName(name)) || { count: 0, total: 0, first: "", last: "", accounts: new Set() };
    const bank = v["은행"] || "";
    const role = ROLE_FROM_NOTION[v["구분"]] || "service";
    out.push({
      name, notionCategory: v["구분"] || "", roles: [role], bankName: bank.replace(/\(가상계좌\)/, "").split(",")[0].trim(),
      bankAccount: v["계좌번호"] || "", depositorName: v["예금주명"] || "",
      payoutAccountType: /가상/.test(bank) || /가상계좌/.test(v["상세내용"] || "") ? "virtual" : "fixed",
      invoiceTiming: v["계산서 발행"] || "", orderMethod: v["발주방식"] || "", contactName: v["담당자/연락처"] || "", contactEmail: v["메일"] || "",
      note: v["상세내용"] || "", hasLogin: Boolean(v["아이디"] || v["비밀번호"]), attachments: attachmentNames(v["사업자/통장사본"]),
      notion: { payments: s.count, total: s.total, first: s.first, last: s.last },
      active: Boolean(s.last && s.last >= activeSince)
    });
  }
  for (const v of salesPartners) {
    const name = v["상호"] || "";
    if (!name) continue;
    out.push({
      name, notionCategory: v["구분"] || "", roles: [ROLE_FROM_NOTION[v["구분"]] || "sales"], businessNumber: (v["사업자등록번호"] || "").trim(),
      invoiceEmail: v["발행용 이메일"] || "", invoiceTiming: v["발행/결제방식"] || "", note: v["메모"] || "",
      attachments: attachmentNames(v["사업자등록증"]), notion: { payments: 0, total: 0, first: parseKoDate(v["생성 일시"]).slice(0, 10), last: "" },
      active: true, payoutAccountType: "fixed"
    });
  }
  return out;
}

// 기존 ERP 거래처와 합치는 계획. 기존 값은 덮어쓰지 않고 빈 칸만 채운다.
export function planPartnerMerge(existing = [], candidates = []) {
  const byKey = new Map();
  for (const p of existing) {
    for (const n of [p.name, p.businessName, ...(p.aliases || [])]) if (normName(n)) byKey.set(normName(n), p);
    const biz = String(p.businessNumber || "").replace(/\D/g, "");
    if (biz) byKey.set(`biz:${biz}`, p);
  }
  const creates = [];
  const updates = [];
  const seen = new Map();
  for (const c of candidates) {
    const biz = String(c.businessNumber || "").replace(/\D/g, "");
    const hit = (biz && byKey.get(`biz:${biz}`)) || byKey.get(normName(c.name));
    if (hit) {
      const patch = {};
      for (const k of ["bankName", "bankAccount", "depositorName", "invoiceTiming", "orderMethod", "contactName", "contactEmail", "invoiceEmail", "businessNumber"]) {
        if (c[k] && !hit[k]) patch[k] = c[k];
      }
      const roles = [...new Set([...(hit.roles || [hit.category].filter(Boolean)), ...c.roles])];
      if (roles.join() !== (hit.roles || []).join()) patch.roles = roles;
      patch.notion = c.notion;
      if (c.payoutAccountType === "virtual" && hit.payoutAccountType !== "virtual") patch.payoutAccountType = "virtual";
      updates.push({ id: hit.id, name: hit.name, patch });
      continue;
    }
    const key = normName(c.name);
    if (seen.has(key)) { // 노션 안에서 같은 이름이 두 번 — 하나로
      const prev = seen.get(key);
      prev.roles = [...new Set([...prev.roles, ...c.roles])];
      prev.active = prev.active || c.active;
      continue;
    }
    seen.set(key, c);
    creates.push(c);
  }
  return { creates, updates };
}
