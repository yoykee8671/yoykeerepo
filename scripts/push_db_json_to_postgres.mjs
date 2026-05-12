import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DB_PATH = path.join(ROOT, "data", "db.json");
const DATABASE_URL = String(process.env.DATABASE_URL || "").trim();

if (!DATABASE_URL) {
  throw new Error("DATABASE_URL is required.");
}

const pool = new pg.Pool({
  connectionString: DATABASE_URL,
  ssl: /supabase\.(co|com)/.test(DATABASE_URL) ? { rejectUnauthorized: false } : undefined
});

const state = JSON.parse(await readFile(DB_PATH, "utf8"));

await pool.query(`
  create table if not exists app_state (
    id text primary key,
    state jsonb not null,
    updated_at timestamptz not null default now()
  )
`);

await pool.query(
  `
    insert into app_state (id, state, updated_at)
    values ($1, $2::jsonb, now())
    on conflict (id)
    do update set state = excluded.state, updated_at = now()
  `,
  ["primary", JSON.stringify(state)]
);

console.log("Pushed local data/db.json to Postgres app_state.primary");
await pool.end();
