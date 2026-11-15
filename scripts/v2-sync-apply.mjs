// v2 테스트 앱 컨테이너 안에서만 돈다(scripts/v2-sync.sh 가 부른다).
// 표준입력: {"base": 지난번 운영 상태, "prod": 지금 운영 상태}
// v2 DB 의 상태와 3-way 로 합쳐 저장하고, 양쪽에서 다르게 고친 칸은 '확인 필요' 질문(sync-conflict)으로 올린다.
// 표준출력: 요약 JSON.
import crypto from "node:crypto";
import pg from "pg";
import { mergeState, describePath } from "../lib/sync-merge.mjs";
import { createErpStore } from "../lib/erp-store.mjs";

if (process.env.PUBLIC_BASE_URL !== "https://v2.gnuol.com") {
  console.error("v2 테스트 앱에서만 실행합니다.");
  process.exit(2);
}
const dryRun = process.argv.includes("--dry-run");
// 버퍼로 모은 뒤 한 번에 푼다(조각마다 풀면 조각 경계에 걸린 한글이 깨진다).
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const input = Buffer.concat(chunks).toString("utf8");
const { base, prod } = JSON.parse(input);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const erp = createErpStore({ pool, dataDir: "/tmp" });
const row = (await pool.query("select state from app_state where id = 'primary'")).rows[0];
const v2 = row.state;
const rev = Number(v2.__rev || 0);
const { state, conflicts, changes, added } = mergeState(base, prod, v2);

const short = (v) => {
  if (v === undefined) return "(없음)";
  const t = typeof v === "string" ? v : JSON.stringify(v);
  return t.length > 120 ? `${t.slice(0, 117)}…` : t;
};
const questions = conflicts.map((c) => {
  const where = describePath(c.path, state);
  const id = `sync-conflict:${crypto.createHash("sha1").update(JSON.stringify(c.path)).digest("hex").slice(0, 16)}`;
  return {
    id, topic: "sync", kind: "sync-conflict", status: "open", subjectId: where,
    title: `pay 와 v2 에서 다르게 고친 값: ${where}`,
    detail: `원래: ${short(c.base)}\npay(직원): ${short(c.prod)}\nv2(대표): ${short(c.v2)}`,
    choices: [{ key: "v2", label: "v2 값 유지" }, { key: "prod", label: "pay 값으로" }],
    suggested: "v2",
    payload: { path: c.path, prod: c.prod === undefined ? null : c.prod, prodMissing: c.prod === undefined },
    createdAt: new Date().toISOString()
  };
});

let written = false;
if (!dryRun && (changes || conflicts.length)) {
  const next = { ...state, __rev: rev + 1 };
  const r = await pool.query(
    "update app_state set state = $1::jsonb, updated_at = now() where id = 'primary' and coalesce((state->>'__rev')::bigint, 0) = $2",
    [JSON.stringify(next), rev]
  );
  written = r.rowCount === 1;
  if (!written) { console.log(JSON.stringify({ ok: false, error: "v2 가 그 사이 저장됨 — 다음에 다시" })); await pool.end(); process.exit(3); }
  for (const q of questions) {
    const old = await erp.get("setupQuestions", q.id);
    // 이미 답한 것은 pay 값이 그대로면 다시 묻지 않는다
    if (old && old.status !== "open" && JSON.stringify(old.payload?.prod) === JSON.stringify(q.payload.prod)) continue;
    await erp.put("setupQuestions", old ? { ...old, ...q, status: "open", createdAt: old.createdAt } : q);
  }
}
console.log(JSON.stringify({ ok: true, dryRun, written, changes, added, conflicts: questions.map((q) => q.subjectId) }));
await pool.end();
