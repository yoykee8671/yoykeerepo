// 운영(pay) → v2 하루 한 번 합치기 (3-way merge).
//
// base = 지난번 합칠 때(처음은 v2 를 복사하기 직전 백업)의 운영 데이터, prod = 지금 운영, v2 = 지금 v2.
// 칸(필드)마다
//   - 운영이 base 그대로면 v2 값(대표가 v2 에서 고친 것 유지)
//   - v2 가 base 그대로면 운영 값(직원이 pay 에서 고친 것 반영)
//   - 둘이 같으면 그대로
//   - 둘 다 다르게 고쳤으면 v2 값을 두고 충돌로 돌려준다(확인 필요 질문이 된다)
// 배열 안의 {id} 기록은 id 로 맞춰 칸 단위로 합친다. 그 밖의 배열·값은 통째로 비교한다.

const SKIP_TOP = new Set(["clobe", "cafe24", "__rev", "version"]); // 토큰·리비전은 v2 것을 그대로
const LOG_CAPS = { auditLogs: 2000, archiveHistory: 200 }; // 최신이 앞인 기록: 합친 뒤 날짜순으로 자른다
const SOFT_KEYS = new Set(["updatedAt", "updatedBy", "updatedByName"]); // 충돌로 보지 않고 늦은 값
// 실제 업무(입금 처리)는 운영(pay)에서 일어나므로, 양쪽이 다르게 고쳤으면 운영 값을 따른다.
const PROD_WINS = { requests: new Set(["status", "paidAt", "paidAmount"]) };

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isIdArray = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => isObj(x) && typeof x.id === "string");
const idArrayLike = (...vs) => vs.some(isIdArray) && vs.every((v) => v === undefined || (Array.isArray(v) && v.every((x) => isObj(x) && typeof x.id === "string")));

export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  const ka = Object.keys(a).filter((k) => a[k] !== undefined);
  const kb = Object.keys(b).filter((k) => b[k] !== undefined);
  return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]));
}

const MISSING = undefined;

function mergeValue(base, prod, v2, path, out) {
  if (deepEqual(prod, base)) return v2;
  if (deepEqual(v2, base)) { out.changes += 1; return prod; }
  if (deepEqual(prod, v2)) return v2;
  // 둘 다 고침
  if (isObj(prod) && isObj(v2)) return mergeObject(isObj(base) ? base : {}, prod, v2, path, out);
  if (idArrayLike(base, prod, v2) && prod !== undefined && v2 !== undefined) return mergeIdArray(base || [], prod, v2, path, out);
  const key = path[path.length - 1];
  if (SOFT_KEYS.has(key)) return String(prod || "") > String(v2 || "") ? prod : v2;
  if (PROD_WINS[path[0]]?.has(key) && prod !== undefined) { out.changes += 1; return prod; }
  out.conflicts.push({ path, base, prod, v2 });
  return v2;
}

function mergeObject(base, prod, v2, path, out) {
  const result = {};
  const keys = new Set([...Object.keys(v2), ...Object.keys(prod), ...Object.keys(base)]);
  for (const k of keys) {
    const v = mergeValue(base[k], prod[k], v2[k], [...path, k], out);
    if (v !== MISSING) result[k] = v;
  }
  return result;
}

function mergeIdArray(base, prod, v2, path, out) {
  const byId = (arr) => new Map((arr || []).map((x) => [x.id, x]));
  const b = byId(base), p = byId(prod), v = byId(v2);
  const merged = new Map();
  for (const id of new Set([...v.keys(), ...p.keys(), ...b.keys()])) {
    const r = mergeValue(b.get(id), p.get(id), v.get(id), [...path, { id }], out);
    if (r !== MISSING) merged.set(id, r);
  }
  // 순서: v2 순서를 따르고, 운영에서 새로 생긴 것은 운영에서 바로 앞에 있던 기록 뒤에 넣는다.
  const order = (v2 || []).map((x) => x.id).filter((id) => merged.has(id));
  const placed = new Set(order);
  (prod || []).forEach((x, i) => {
    if (placed.has(x.id) || !merged.has(x.id)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j -= 1) { const k = order.indexOf(prod[j].id); if (k >= 0) { at = k + 1; break; } }
    order.splice(at, 0, x.id);
    placed.add(x.id);
  });
  for (const id of merged.keys()) if (!placed.has(id)) order.push(id);
  return order.map((id) => merged.get(id));
}

// 운영 상태 전체를 v2 에 합친다. 반환: { state, conflicts, changes, added }
export function mergeState(base, prod, v2) {
  const out = { conflicts: [], changes: 0 };
  const state = {};
  const keys = new Set([...Object.keys(v2), ...Object.keys(prod)]);
  const added = {};
  for (const k of keys) {
    if (SKIP_TOP.has(k)) { if (k in v2) state[k] = v2[k]; continue; }
    const before = out.changes;
    let v = mergeValue(base[k], prod[k], v2[k], [k], out);
    if (LOG_CAPS[k] && Array.isArray(v)) {
      v = [...v].sort((a, b) => String(b.createdAt || b.at || "").localeCompare(String(a.createdAt || a.at || ""))).slice(0, LOG_CAPS[k]);
    }
    if (Array.isArray(v) && Array.isArray(v2[k])) {
      const had = new Set(v2[k].map((x) => x?.id));
      const n = v.filter((x) => x?.id && !had.has(x.id)).length;
      if (n) added[k] = n;
    }
    if (out.changes !== before && !added[k]) added[k] = 0;
    if (v !== MISSING) state[k] = v;
  }
  return { state, conflicts: out.conflicts, changes: out.changes, added };
}

// 경로 → 사람이 읽는 이름. ['brands', {id}, 'bankAccount'] → 'brands › 아더마스 › bankAccount'
export function describePath(path, root) {
  let cur = root;
  return path.map((seg) => {
    if (isObj(seg)) {
      cur = Array.isArray(cur) ? cur.find((x) => x.id === seg.id) : undefined;
      return cur?.name || cur?.brandName || cur?.title || cur?.code || seg.id;
    }
    cur = cur?.[seg];
    return seg;
  }).join(" › ");
}

// 충돌 답 '운영 값으로' — path 위치에 value 를 넣는다(value 가 undefined 면 지운다).
export function setAtPath(root, path, value) {
  let cur = root;
  for (let i = 0; i < path.length - 1; i += 1) {
    const seg = path[i];
    const nextSeg = path[i + 1];
    const next = isObj(seg) ? cur.find((x) => x.id === seg.id) : cur[seg];
    if (next === undefined) {
      if (value === undefined) return false;
      const made = isObj(nextSeg) ? [] : {};
      if (isObj(seg)) cur.push({ id: seg.id }); else cur[seg] = made;
      cur = isObj(seg) ? cur.find((x) => x.id === seg.id) : cur[seg];
    } else cur = next;
  }
  const last = path[path.length - 1];
  if (isObj(last)) {
    const i = cur.findIndex((x) => x.id === last.id);
    if (value === undefined) { if (i >= 0) cur.splice(i, 1); }
    else if (i >= 0) cur[i] = value; else cur.unshift(value);
  } else if (value === undefined) delete cur[last];
  else cur[last] = value;
  return true;
}
