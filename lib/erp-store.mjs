// v2 레코드 저장소.
//
// 기존 데이터는 app_state 한 행(JSON 한 덩어리)에 통째로 들어 있어, 무엇을
// 저장하든 전체를 다시 쓴다. ERP 로 커지며 매일 쌓이는 기록(지급요청·자금 일정·
// 재고 이동 등)은 여기에 한 건씩 따로 저장한다. 기존 기능은 그대로 두고 새
// 기능부터 쓴다.
//
// - Postgres 가 있으면 erp_records(collection, id, data) / erp_files 표.
// - 없으면(로컬 개발) DATA_DIR/erp/<collection>.json 과 erp-files/ 폴더.
import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import path from "node:path";

export function createErpStore({ pool = null, dataDir = "" } = {}) {
  const fileDir = path.join(dataDir || ".", "erp");
  const blobDir = path.join(dataDir || ".", "erp-files");

  async function init() {
    if (pool) {
      await pool.query(`
        create table if not exists erp_records (
          collection text not null,
          id text not null,
          data jsonb not null,
          created_at timestamptz not null default now(),
          updated_at timestamptz not null default now(),
          primary key (collection, id)
        )
      `);
      await pool.query(`
        create table if not exists erp_files (
          id text primary key,
          owner_collection text not null default '',
          owner_id text not null default '',
          name text not null default '',
          type text not null default 'application/octet-stream',
          size integer not null default 0,
          data bytea not null,
          created_at timestamptz not null default now()
        )
      `);
      return;
    }
    await mkdir(fileDir, { recursive: true });
    await mkdir(blobDir, { recursive: true });
  }

  async function readCollectionFile(collection) {
    try {
      return JSON.parse(await readFile(path.join(fileDir, `${collection}.json`), "utf8"));
    } catch {
      return [];
    }
  }

  async function list(collection) {
    if (pool) {
      const r = await pool.query(
        "select data from erp_records where collection = $1 order by created_at desc", [collection]
      );
      return r.rows.map((row) => row.data);
    }
    return readCollectionFile(collection);
  }

  async function get(collection, id) {
    if (pool) {
      const r = await pool.query("select data from erp_records where collection = $1 and id = $2", [collection, id]);
      return r.rows[0]?.data || null;
    }
    return (await readCollectionFile(collection)).find((x) => x.id === id) || null;
  }

  async function put(collection, record) {
    if (!record?.id) throw new Error("record.id 가 필요합니다.");
    if (pool) {
      await pool.query(
        `insert into erp_records (collection, id, data) values ($1, $2, $3)
         on conflict (collection, id) do update set data = excluded.data, updated_at = now()`,
        [collection, record.id, record]
      );
      return record;
    }
    const rows = await readCollectionFile(collection);
    const i = rows.findIndex((x) => x.id === record.id);
    if (i >= 0) rows[i] = record; else rows.unshift(record);
    await mkdir(fileDir, { recursive: true });
    await writeFile(path.join(fileDir, `${collection}.json`), JSON.stringify(rows, null, 2));
    return record;
  }

  async function remove(collection, id) {
    if (pool) {
      await pool.query("delete from erp_records where collection = $1 and id = $2", [collection, id]);
      return;
    }
    const rows = (await readCollectionFile(collection)).filter((x) => x.id !== id);
    await writeFile(path.join(fileDir, `${collection}.json`), JSON.stringify(rows, null, 2));
  }

  async function putFile({ id, ownerCollection = "", ownerId = "", name = "", type = "", buffer }) {
    if (pool) {
      await pool.query(
        `insert into erp_files (id, owner_collection, owner_id, name, type, size, data)
         values ($1, $2, $3, $4, $5, $6, $7)`,
        [id, ownerCollection, ownerId, name, type || "application/octet-stream", buffer.length, buffer]
      );
      return;
    }
    await mkdir(blobDir, { recursive: true });
    await writeFile(path.join(blobDir, id), buffer);
    await writeFile(path.join(blobDir, `${id}.json`), JSON.stringify({ name, type, ownerCollection, ownerId }));
  }

  async function getFile(id) {
    if (pool) {
      const r = await pool.query("select name, type, data from erp_files where id = $1", [id]);
      const row = r.rows[0];
      return row ? { name: row.name, type: row.type, buffer: row.data } : null;
    }
    try {
      const meta = JSON.parse(await readFile(path.join(blobDir, `${id}.json`), "utf8"));
      return { ...meta, buffer: await readFile(path.join(blobDir, id)) };
    } catch {
      return null;
    }
  }

  async function removeFile(id) {
    if (pool) {
      await pool.query("delete from erp_files where id = $1", [id]);
      return;
    }
    await unlink(path.join(blobDir, id)).catch(() => {});
    await unlink(path.join(blobDir, `${id}.json`)).catch(() => {});
  }

  return { init, list, get, put, remove, putFile, getFile, removeFile };
}
