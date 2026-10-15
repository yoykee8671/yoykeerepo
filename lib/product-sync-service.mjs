// 공급사 상품 동기화 — 저장, 실행(수집·비교), 반영, 신규 등록, 스케줄.
//
// 저장 위치: app_state 테이블의 별도 행(id = "product_sync"). 메인 상태(입금요청·
// 정산 등)와 한 행에 넣으면 170개 상품 스냅샷이 매 화면 로딩·저장마다 같이
// 오가고, 하루 두 번 도는 백그라운드 저장이 사람의 저장과 낙관적 잠금에서
// 부딪힌다. 행을 나눠서 둘 다 피한다. 로컬(JSON 파일)에서는 data/product-sync.json.
//
// 오래 걸리는 일(수집 1~2분, 신규 등록은 이미지 수십 장 업로드)은 HTTP 요청
// 안에서 끝내지 않는다 — 앞단(Cloudflare)이 100초에 끊는다. 작업(job)으로
// 돌리고 화면은 진행 상황을 물어본다.

import crypto from "node:crypto";
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as source from "./brand-source-cafe24.mjs";
import {
  PRODUCT_SYNC_ROW_ID,
  HISTORY_LIMIT,
  buildSyncState,
  migrateSyncState,
  compactSource,
  computeIssues,
  sourceNotices,
  dueRunSlot,
  publicSourceState,
  issueIsDismissed,
  matchOptions,
  wooofVariantLabel,
  wooofSellable
} from "./product-sync.mjs";
import { registerProduct } from "./product-register.mjs";
import { SEED_LINKS, SEED_VALUE_MAPS, SEED_WOOOF_NAMES } from "./product-sync-seed.mjs";

const execFileAsync = promisify(execFile);
const RUN_STALE_MS = 30 * 60 * 1000;
const SCHEDULE_CHECK_MS = 10 * 60 * 1000;
const SCHEDULE_START_DELAY_MS = 3 * 60 * 1000;
const NOTICE_LIMIT = 200;
const JOB_KEEP_MS = 6 * 60 * 60 * 1000;

const SETTINGS_KEYS = [
  "enabled",
  "name",
  "namePrefix",
  "categoryNos",
  "recentDays",
  "restockQuantity",
  "thumbnailMultiply",
  "templateProductNo",
  "valueMap"
];

function nowIso() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

export function createProductSyncService({ pgPool, dataDir, scriptPath, withCafe24, api, log = console }) {
  const filePath = path.join(dataDir, "product-sync.json");
  const jobs = new Map();
  let scheduleTimer = null;

  // --- 저장 ---------------------------------------------------------------

  async function readRaw() {
    if (pgPool) {
      const result = await pgPool.query("select state from app_state where id = $1", [PRODUCT_SYNC_ROW_ID]);
      return result.rowCount ? result.rows[0].state : null;
    }
    try {
      return JSON.parse(await readFile(filePath, "utf8"));
    } catch {
      return null;
    }
  }

  async function writeRaw(state) {
    const prevRev = Number(state.__rev || 0);
    const next = { ...state, __rev: prevRev + 1 };
    if (pgPool) {
      const result = await pgPool.query(
        `
          insert into app_state (id, state, updated_at)
          values ($1, $2::jsonb, now())
          on conflict (id)
          do update set state = excluded.state, updated_at = now()
          where coalesce((app_state.state->>'__rev')::bigint, 0) = $3
        `,
        [PRODUCT_SYNC_ROW_ID, JSON.stringify(next), prevRev]
      );
      if (!result.rowCount) {
        const error = new Error("상품 동기화 데이터가 다른 곳에서 먼저 저장되었습니다. 다시 시도하세요.");
        error.status = 409;
        throw error;
      }
    } else {
      // 로컬(JSON 파일): Postgres 와 같은 버전 확인을 하고, 임시 파일에 쓴 뒤 바꿔
      // 끼운다. 그냥 덮어쓰면 다른 작업이 반쯤 쓰인 파일을 읽는다.
      await mkdir(dataDir, { recursive: true });
      const current = await readRaw();
      if (current && Number(current.__rev || 0) !== prevRev) {
        const error = new Error("상품 동기화 데이터가 다른 곳에서 먼저 저장되었습니다. 다시 시도하세요.");
        error.status = 409;
        throw error;
      }
      const tmp = `${filePath}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
      await writeFile(tmp, `${JSON.stringify(next)}\n`);
      await rename(tmp, filePath);
    }
    state.__rev = next.__rev;
    return state;
  }

  function seedLinks(state) {
    // 기존 우프 상품 ↔ 본사 상품 초기 연결표. 한 번만 넣는다 — 사람이 지운
    // 연결이 배포 때마다 되살아나면 안 된다.
    let changed = false;
    for (const [sourceId, links] of Object.entries(SEED_LINKS)) {
      const src = state.sources[sourceId];
      if (!src || src.seededAt) continue;
      for (const link of links) {
        if (src.links[link.wooofProductNo]) continue;
        src.links[link.wooofProductNo] = {
          sourceNo: link.sourceNo,
          sourceFilter: link.sourceFilter || "",
          wooofName: SEED_WOOOF_NAMES[link.wooofProductNo] || "",
          valueMap: link.valueMap || {},
          optionMap: link.optionMap || {},
          note: link.note || "",
          linkedAt: nowIso(),
          linkedBy: "초기 연결표"
        };
      }
      if (SEED_VALUE_MAPS[sourceId]) src.valueMap = { ...SEED_VALUE_MAPS[sourceId], ...(src.valueMap || {}) };
      src.seededAt = nowIso();
      changed = true;
    }
    return changed;
  }

  async function readState() {
    const raw = await readRaw();
    const { state, changed } = migrateSyncState(raw || buildSyncState());
    const seeded = seedLinks(state);
    if (!raw || changed || seeded) {
      try {
        await writeRaw(state);
      } catch (error) {
        if (error.status !== 409) throw error;
        return migrateSyncState(await readRaw()).state;
      }
    }
    return state;
  }

  // 읽고-고치고-쓰기. 다른 인스턴스·작업과 부딪히면 최신을 다시 읽어 다시 한다.
  async function mutate(fn) {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const state = await readState();
      const result = await fn(state);
      try {
        await writeRaw(state);
        return result;
      } catch (error) {
        if (error.status !== 409) throw error;
        await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
      }
    }
    throw new Error("상품 동기화 데이터 저장이 계속 충돌합니다. 잠시 후 다시 시도하세요.");
  }

  function requireSource(state, sourceId) {
    const src = state.sources[sourceId];
    if (!src) {
      const error = new Error(`알 수 없는 공급사입니다: ${sourceId}`);
      error.status = 404;
      throw error;
    }
    return src;
  }

  function addHistory(state, entry) {
    state.history.unshift({ id: id("psh"), at: nowIso(), ...entry });
    state.history = state.history.slice(0, HISTORY_LIMIT);
  }

  // --- 작업(job) -------------------------------------------------------------

  function startJob(kind, meta, work) {
    const job = {
      id: id("job"),
      kind,
      ...meta,
      status: "running",
      progress: null,
      message: "",
      startedAt: nowIso(),
      finishedAt: "",
      result: null,
      error: ""
    };
    jobs.set(job.id, job);
    for (const [key, value] of jobs) {
      if (value.finishedAt && Date.now() - new Date(value.finishedAt).getTime() > JOB_KEEP_MS) jobs.delete(key);
    }
    const update = (patch) => Object.assign(job, patch);
    Promise.resolve()
      .then(() => work(update))
      .then((result) => update({ status: "done", result, finishedAt: nowIso() }))
      .catch((error) => {
        log.error(`[product-sync] ${kind} failed: ${error.stack || error.message}`);
        update({ status: "failed", error: error.message, finishedAt: nowIso() });
      });
    return job;
  }

  function getJob(jobId) {
    return jobs.get(jobId) || null;
  }

  function listJobs() {
    return [...jobs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 20);
  }

  // --- 파이썬 이미지 처리 ------------------------------------------------------

  async function runPython(args) {
    try {
      const { stdout } = await execFileAsync("python3", [scriptPath, ...args], { maxBuffer: 16 * 1024 * 1024 });
      const result = JSON.parse(String(stdout).trim().split("\n").pop());
      if (!result.ok) throw new Error(result.error || "이미지 처리 실패");
      return result;
    } catch (error) {
      const detail = String(error.stdout || "").trim() || String(error.stderr || "").trim() || error.message;
      throw new Error(`이미지 처리 실패: ${detail}`);
    }
  }

  // --- 실행: 수집 → 비교 -------------------------------------------------------

  function fullSourceFromSnapshot(snap) {
    if (!snap) return null;
    return { ...snap, options: snap.options || [] };
  }

  async function fetchWooofProducts(wooofNos) {
    if (!wooofNos.length) return { products: new Map(), error: "" };
    try {
      const list = await withCafe24((token) => api.fetchProductsWithVariants(token, wooofNos));
      return { products: new Map(list.map((p) => [Number(p.product_no), p])), error: "" };
    } catch (error) {
      return { products: new Map(), error: error.message };
    }
  }

  // checkedWooofNos: 이번에 우프에서 실제로 읽어 온 상품번호. 실행 도중 새로 붙은
  // 연결은 읽지 않았으므로 "우프 상품 없음"으로 판단하지 않고 기존 결과를 둔다.
  function rebuildIssues(src, wooofProducts, checkedWooofNos) {
    const issues = [];
    const seenKeys = new Set();
    for (const [wooofNo, stored] of Object.entries(src.links || {})) {
      if (!checkedWooofNos.has(Number(wooofNo))) {
        issues.push(...(src.issues || []).filter((issue) => String(issue.wooofProductNo) === String(wooofNo)));
        continue;
      }
      const link = { ...stored, wooofProductNo: Number(wooofNo) };
      const wooof = wooofProducts.get(Number(wooofNo)) || null;
      if (wooof?.product_name) stored.wooofName = wooof.product_name;
      const snap = src.snapshot[String(link.sourceNo)];
      for (const issue of computeIssues({
        sourceId: src.id,
        sourceNo: link.sourceNo,
        source: fullSourceFromSnapshot(snap),
        wooof,
        link,
        settings: src
      })) {
        seenKeys.add(issue.key);
        if (!issueIsDismissed(src, issue)) issues.push({ ...issue, detectedAt: nowIso() });
      }
    }
    // 무시해 둔 항목이 이번에 사라졌으면 무시 기록도 지운다 — 다음에 같은 품절이
    // 또 생기면 다시 보여야 한다.
    for (const key of Object.keys(src.dismissed || {})) {
      const wooofNo = Number(String(key).split(":")[1]);
      if (checkedWooofNos.has(wooofNo) && !seenKeys.has(key)) delete src.dismissed[key];
    }
    return sortIssues(issues);
  }

  async function runSyncBody(settings, { trigger, actorName, started, onProgress }) {
    const linkedSourceNos = [...new Set(Object.values(settings.links || {}).map((link) => Number(link.sourceNo)).filter(Boolean))];
    // 2) 본사 수집
    const collected = await source.collectBrand(
      { baseUrl: settings.baseUrl, categoryNos: settings.categoryNos || [], extraNos: linkedSourceNos },
      { onProgress }
    );
    if (!collected.products.length) {
      throw new Error("본사에서 상품을 하나도 읽지 못했습니다. 사이트 구조가 바뀌었거나 접속이 막혔을 수 있습니다.");
    }
    // 3) 우프 현재 상태
    const wooofNos = Object.keys(settings.links || {}).map(Number).filter(Boolean);
    const wooof = await fetchWooofProducts(wooofNos);

    // 4) 저장
    return mutate((state) => {
      const src = requireSource(state, settings.id);
      const at = nowIso();
      const firstRun = !Object.keys(src.snapshot || {}).length;
      const seen = new Set();
      const notices = [];
      for (const product of collected.products) {
        const key = String(product.sourceNo);
        seen.add(key);
        const previous = src.snapshot[key];
        const current = compactSource(product, previous, at);
        if (!firstRun) notices.push(...sourceNotices({ sourceId: src.id, sourceNo: key, previous, current, nowIso: at }));
        src.snapshot[key] = current;
      }
      for (const no of collected.missing) {
        const key = String(no);
        seen.add(key);
        src.snapshot[key] = { ...(src.snapshot[key] || {}), missing: true, listed: false, lastSeenAt: src.snapshot[key]?.lastSeenAt || "" };
      }
      // 이번에 못 읽은 상품(시간 초과 등)은 판단하지 않는다 — 지난 상태로 품절·재입고를
      // 제안하지도, 삭제로 보지도 않는다.
      for (const { sourceNo } of collected.failed) {
        const key = String(sourceNo);
        seen.add(key);
        src.snapshot[key] = { ...(src.snapshot[key] || {}), unreadable: true };
      }
      // 이번에 목록에도 없고 따로 확인하지도 않은 상품 = 진열에서 빠진 것.
      for (const [key, snap] of Object.entries(src.snapshot)) {
        if (!seen.has(key) && snap.listed !== false) snap.listed = false;
      }
      src.notices = [...notices, ...(src.notices || [])].slice(0, NOTICE_LIMIT);

      if (!wooof.error) src.issues = rebuildIssues(src, wooof.products, new Set(wooofNos));
      src.lastRun = {
        at,
        trigger,
        by: actorName,
        durationMs: Date.now() - started,
        listedCount: collected.listedCount,
        collectedCount: collected.products.length,
        missing: collected.missing,
        failed: collected.failed.slice(0, 10),
        failedCount: collected.failed.length,
        wooofChecked: wooof.products.size,
        wooofError: wooof.error,
        issueCount: (src.issues || []).length,
        noticeCount: notices.length
      };
      addHistory(state, {
        sourceId: src.id,
        type: "run",
        by: actorName || (trigger === "schedule" ? "자동 실행" : ""),
        summary: `수집 ${collected.products.length}개 · 우프 확인 ${wooof.products.size}개 · 확인필요 ${(src.issues || []).length}건${wooof.error ? ` · 우프 조회 실패: ${wooof.error}` : ""}`
      });
      return src.lastRun;
    });
  }

  function startRun(sourceId, { trigger = "manual", actorName = "" } = {}) {
    const existing = [...jobs.values()].find((job) => job.kind === "run" && job.sourceId === sourceId && job.status === "running");
    if (existing) return existing;
    return startJob("run", { sourceId }, async (update) => {
      const jobId = id("run");
      const settings = await mutate((state) => {
        const src = requireSource(state, sourceId);
        const running = src.running;
        if (running && Date.now() - new Date(running.startedAt).getTime() < RUN_STALE_MS) {
          const error = new Error("다른 곳에서 이미 실행 중입니다. 잠시 후 결과를 확인하세요.");
          error.status = 409;
          throw error;
        }
        src.running = { jobId, startedAt: nowIso(), trigger };
        // 실패해도 남는 시도 기록. 자동 실행이 실패하면 10분마다 170쪽을 다시
        // 긁지 않도록 스케줄이 이것을 보고 한 시간 쉰다.
        src.lastAttemptAt = nowIso();
        return structuredClone(src);
      });
      try {
        update({ message: "본사 상품 읽는 중" });
        return await runSyncBody(settings, {
          trigger,
          actorName,
          started: Date.now(),
          onProgress: (done, total) => update({ progress: { done, total }, message: `본사 상품 읽는 중 ${done}/${total}` })
        });
      } finally {
        await mutate((state) => {
          const src = state.sources[sourceId];
          if (src?.running?.jobId === jobId) src.running = null;
        }).catch((error) => log.error(`[product-sync] clear running failed: ${error.message}`));
      }
    });
  }

  // --- 반영 ------------------------------------------------------------------

  // 고른 issue 를 반영한다. 화면의 결과는 몇 시간 전 것일 수 있으므로(09시 확인을
  // 16시에 반영) 쓰기 직전에 본사와 우프를 다시 읽어 다시 비교하고, 화면에서 본
  // 값(fingerprint)과 지금도 같은 항목만 쓴다. 그새 바뀐 것은 건너뛰고 알려 준다.
  function startApply(sourceId, items, actor) {
    return startJob("apply", { sourceId }, async (update) => {
      const state = await readState();
      const src = requireSource(state, sourceId);
      const wanted = new Map(items.map((item) => [item.key, item.fingerprint]));
      const picked = (src.issues || []).filter((issue) => wanted.has(issue.key) && issue.action);
      if (!picked.length) throw new Error("반영할 항목이 없습니다 (이미 반영됐거나 자동 반영 대상이 아닙니다).");

      // 1) 다시 읽기
      update({ message: "본사·우프 최신 상태 다시 확인 중" });
      const wooofNos = [...new Set(picked.map((issue) => Number(issue.wooofProductNo)))];
      const freshWooof = new Map(
        (await withCafe24((token) => api.fetchProductsWithVariants(token, wooofNos))).map((p) => [Number(p.product_no), p])
      );
      const freshSource = new Map();
      for (const sourceNo of new Set(picked.map((issue) => Number(issue.sourceNo)))) {
        try {
          const product = await source.fetchProduct(src.baseUrl, sourceNo);
          freshSource.set(sourceNo, compactSource({ ...product, listed: src.snapshot[String(sourceNo)]?.listed !== false }, src.snapshot[String(sourceNo)], nowIso()));
        } catch (error) {
          if (error.status === 404) freshSource.set(sourceNo, { ...(src.snapshot[String(sourceNo)] || {}), missing: true });
          // 그 밖의 실패는 판단하지 않는다 → 그 상품의 항목은 건너뛴다.
        }
      }

      // 2) 다시 비교해서 지금도 같은 것만
      const confirmed = [];
      const skipped = [];
      for (const wooofNo of wooofNos) {
        const stored = src.links[String(wooofNo)];
        const mine = picked.filter((issue) => Number(issue.wooofProductNo) === wooofNo);
        const sourceNow = stored ? freshSource.get(Number(stored.sourceNo)) : null;
        if (!stored || !sourceNow) {
          skipped.push(...mine.map((issue) => ({ ...issue, reason: !stored ? "연결이 해제됨" : "본사를 다시 읽지 못함" })));
          continue;
        }
        const now = computeIssues({
          sourceId,
          sourceNo: stored.sourceNo,
          source: sourceNow,
          wooof: freshWooof.get(wooofNo) || null,
          link: { ...stored, wooofProductNo: wooofNo },
          settings: src
        });
        const byKey = new Map(now.map((issue) => [issue.key, issue]));
        for (const issue of mine) {
          const current = byKey.get(issue.key);
          if (current?.action && current.fingerprint === issue.fingerprint && current.fingerprint === wanted.get(issue.key)) {
            confirmed.push(current);
          } else {
            skipped.push({ ...issue, reason: current ? "그사이 값이 바뀜" : "이미 본사와 같음" });
          }
        }
      }

      // 3) 상품별로 묶어 쓰기. 판매가와 품목은 따로 성공·실패를 기록한다.
      const byProduct = new Map();
      for (const issue of confirmed) {
        const entry = byProduct.get(issue.wooofProductNo) || { variants: new Map(), product: {}, productIssues: [], variantIssues: [] };
        if (issue.action.kind === "variants") {
          entry.variantIssues.push(issue);
          for (const patch of issue.action.patches) {
            entry.variants.set(patch.variant_code, { ...(entry.variants.get(patch.variant_code) || {}), ...patch });
          }
        } else if (issue.action.kind === "product") {
          entry.productIssues.push(issue);
          Object.assign(entry.product, issue.action.patch);
        }
        byProduct.set(issue.wooofProductNo, entry);
      }

      const applied = [];
      const failed = [];
      let done = 0;
      for (const [productNo, entry] of byProduct) {
        update({ progress: { done, total: byProduct.size }, message: `우프 상품 ${productNo} 반영 중` });
        if (Object.keys(entry.product).length) {
          try {
            await withCafe24((token) => api.updateProduct(token, productNo, entry.product));
            applied.push(...entry.productIssues);
          } catch (error) {
            failed.push(...entry.productIssues.map((issue) => ({ ...issue, error: error.message })));
          }
        }
        if (entry.variants.size) {
          try {
            const patches = [...entry.variants.values()];
            for (let i = 0; i < patches.length; i += 100) {
              await withCafe24((token) => api.updateVariants(token, productNo, patches.slice(i, i + 100)));
            }
            applied.push(...entry.variantIssues);
          } catch (error) {
            failed.push(...entry.variantIssues.map((issue) => ({ ...issue, error: error.message })));
          }
        }
        done += 1;
      }

      await mutate((fresh) => {
        const s = requireSource(fresh, sourceId);
        const resolved = new Set([
          ...applied.map((issue) => issue.key),
          ...skipped.filter((issue) => issue.reason === "이미 본사와 같음").map((issue) => issue.key)
        ]);
        s.issues = (s.issues || []).filter((issue) => !resolved.has(issue.key));
        for (const [no, snap] of freshSource) {
          if (!snap.missing) s.snapshot[String(no)] = snap;
        }
        for (const issue of applied) {
          addHistory(fresh, {
            sourceId,
            type: "apply",
            by: actor?.name || "",
            sourceNo: issue.sourceNo,
            wooofProductNo: issue.wooofProductNo,
            summary: `${issue.productName}${issue.optionLabel ? ` [${issue.optionLabel}]` : ""} · ${issueTypeLabel(issue.type)} ${issue.from ?? ""} → ${issue.to ?? ""}`
          });
        }
        for (const issue of failed) {
          addHistory(fresh, {
            sourceId,
            type: "apply_failed",
            by: actor?.name || "",
            sourceNo: issue.sourceNo,
            wooofProductNo: issue.wooofProductNo,
            summary: `${issue.productName}${issue.optionLabel ? ` [${issue.optionLabel}]` : ""} · 반영 실패: ${issue.error}`
          });
        }
      });
      return {
        applied: applied.length,
        failed: failed.map((issue) => ({ key: issue.key, productName: issue.productName, optionLabel: issue.optionLabel, error: issue.error })),
        skipped: skipped.map((issue) => ({ key: issue.key, productName: issue.productName, optionLabel: issue.optionLabel, reason: issue.reason }))
      };
    });
  }

  async function dismissIssues(sourceId, issueKeys, actor) {
    return mutate((state) => {
      const src = requireSource(state, sourceId);
      const wanted = new Set(issueKeys);
      const dismissed = (src.issues || []).filter((issue) => wanted.has(issue.key));
      for (const issue of dismissed) src.dismissed[issue.key] = issue.fingerprint;
      src.issues = (src.issues || []).filter((issue) => !wanted.has(issue.key));
      for (const issue of dismissed) {
        addHistory(state, {
          sourceId,
          type: "dismiss",
          by: actor?.name || "",
          sourceNo: issue.sourceNo,
          wooofProductNo: issue.wooofProductNo,
          summary: `${issue.productName}${issue.optionLabel ? ` [${issue.optionLabel}]` : ""} · ${issueTypeLabel(issue.type)} 무시`
        });
      }
      return { dismissed: dismissed.length };
    });
  }

  async function clearNotices(sourceId, noticeIds) {
    return mutate((state) => {
      const src = requireSource(state, sourceId);
      const wanted = new Set(noticeIds);
      const before = (src.notices || []).length;
      src.notices = noticeIds?.length ? (src.notices || []).filter((n) => !wanted.has(n.id)) : [];
      return { cleared: before - src.notices.length };
    });
  }

  // --- 연결 ------------------------------------------------------------------

  // 연결 직후 그 상품만 바로 비교해서 돌려준다 — 옵션이 제대로 짝지어졌는지
  // 그 자리에서 보이게.
  async function checkLink(src, wooofNo) {
    const stored = src.links[wooofNo];
    if (!stored) return null;
    const link = { ...stored, wooofProductNo: Number(wooofNo) };
    let wooof = null;
    let wooofError = "";
    try {
      wooof = await withCafe24((token) => api.fetchProduct(token, Number(wooofNo)));
    } catch (error) {
      wooofError = error.message;
    }
    let snap = src.snapshot[String(link.sourceNo)];
    let freshSnap = null;
    if (!snap || snap.missing) {
      try {
        const fresh = await source.fetchProduct(src.baseUrl, Number(link.sourceNo));
        freshSnap = compactSource({ ...fresh, listed: snap?.listed !== false }, snap, nowIso());
        snap = freshSnap;
      } catch {
        // 본사에서 못 읽으면 저장된 상태로 판단한다.
      }
    }
    if (wooofError) return { wooofError, snap, freshSnap };
    const matching = matchOptions(snap, wooof?.variants || [], {
      valueMap: src.valueMap,
      linkValueMap: link.valueMap,
      optionMap: link.optionMap,
      sourceFilter: link.sourceFilter
    });
    const issues = computeIssues({ sourceId: src.id, sourceNo: link.sourceNo, source: snap, wooof, link, settings: src })
      .filter((issue) => !issueIsDismissed(src, issue))
      .map((issue) => ({ ...issue, detectedAt: nowIso() }));
    return {
      snap,
      freshSnap,
      wooof: wooof && {
        product_no: wooof.product_no,
        product_name: wooof.product_name,
        price: wooof.price,
        display: wooof.display,
        selling: wooof.selling,
        variants: (wooof.variants || []).map((v) => ({ variant_code: v.variant_code, label: wooofVariantLabel(v), sellable: wooofSellable(v) }))
      },
      pairs: matching.pairs.map((p) => ({ source: p.source?.label ?? "(단일상품)", wooof: wooofVariantLabel(p.variant) })),
      unmatchedSource: matching.unmatchedSource.map((o) => o.label),
      unmatchedWooof: matching.unmatchedWooof.map(wooofVariantLabel),
      issues
    };
  }

  async function saveLink(sourceId, wooofProductNo, { sourceNo, sourceFilter, valueMap, optionMap, note }, actor) {
    const wooofKey = String(Number(wooofProductNo));
    const srcNo = Number(sourceNo);
    if (!Number(wooofKey) || !srcNo) throw Object.assign(new Error("본사 상품번호와 우프 상품번호를 확인하세요."), { status: 400 });
    const src = await mutate((state) => {
      const s = requireSource(state, sourceId);
      const previous = s.links[wooofKey];
      s.links[wooofKey] = {
        sourceNo: srcNo,
        sourceFilter: String(sourceFilter ?? previous?.sourceFilter ?? "").trim(),
        wooofName: previous?.wooofName || "",
        valueMap: cleanMap(valueMap ?? previous?.valueMap),
        optionMap: cleanMap(optionMap ?? previous?.optionMap),
        note: String(note ?? previous?.note ?? ""),
        linkedAt: previous?.linkedAt || nowIso(),
        linkedBy: previous?.linkedBy || actor?.name || ""
      };
      delete s.ignored[String(srcNo)];
      addHistory(state, {
        sourceId,
        type: previous ? "link_update" : "link",
        by: actor?.name || "",
        sourceNo: srcNo,
        wooofProductNo: Number(wooofKey),
        summary: previous ? `연결 수정 (본사 ${srcNo})` : `연결 추가 (본사 ${srcNo})`
      });
      return structuredClone(s);
    });
    const check = await checkLink(src, wooofKey);
    if (check && !check.wooofError) {
      // 방금 비교한 결과를 이 상품 몫만 바꿔 끼운다.
      await mutate((state) => {
        const s = requireSource(state, sourceId);
        s.issues = sortIssues([
          ...(s.issues || []).filter((issue) => String(issue.wooofProductNo) !== wooofKey),
          ...check.issues
        ]);
        if (check.freshSnap) s.snapshot[String(srcNo)] = check.freshSnap;
        if (check.wooof?.product_name && s.links[wooofKey]) s.links[wooofKey].wooofName = check.wooof.product_name;
      });
    }
    return check;
  }

  async function removeLink(sourceId, wooofProductNo, actor) {
    return mutate((state) => {
      const src = requireSource(state, sourceId);
      const key = String(Number(wooofProductNo));
      const link = src.links[key];
      if (!link) return { removed: false };
      delete src.links[key];
      src.issues = (src.issues || []).filter((issue) => String(issue.wooofProductNo) !== key);
      addHistory(state, {
        sourceId,
        type: "unlink",
        by: actor?.name || "",
        sourceNo: link.sourceNo,
        wooofProductNo: Number(key),
        summary: `연결 해제 (본사 ${link.sourceNo})`
      });
      return { removed: true };
    });
  }

  async function setIgnored(sourceId, sourceNo, ignored, actor) {
    return mutate((state) => {
      const src = requireSource(state, sourceId);
      const no = String(Number(sourceNo));
      if (ignored) src.ignored[no] = { at: nowIso(), by: actor?.name || "" };
      else delete src.ignored[no];
      return { ignored: Boolean(ignored) };
    });
  }

  async function updateSettings(sourceId, patch, actor) {
    return mutate((state) => {
      const src = requireSource(state, sourceId);
      for (const key of SETTINGS_KEYS) {
        if (!(key in (patch || {}))) continue;
        const value = patch[key];
        if (key === "categoryNos") src.categoryNos = (Array.isArray(value) ? value : String(value).split(/[,\s]+/)).map(Number).filter((n) => n > 0);
        else if (key === "recentDays" || key === "restockQuantity") src[key] = Math.max(1, Math.round(Number(value) || 0)) || src[key];
        else if (key === "templateProductNo") src.templateProductNo = Number(value) || null;
        else if (key === "valueMap") src.valueMap = cleanMap(value);
        else if (key === "enabled") src.enabled = Boolean(value);
        else if (key === "thumbnailMultiply") src.thumbnailMultiply = /^#?[0-9a-f]{6}$/i.test(String(value)) ? String(value).replace("#", "").toUpperCase() : src.thumbnailMultiply;
        else src[key] = String(value ?? "").trim();
      }
      if (Array.isArray(patch?.runHoursKst)) {
        const hours = patch.runHoursKst.map(Number).filter((h) => Number.isInteger(h) && h >= 0 && h <= 23);
        if (hours.length) state.runHoursKst = [...new Set(hours)].sort((a, b) => a - b);
      }
      addHistory(state, { sourceId, type: "settings", by: actor?.name || "", summary: "설정 변경" });
      return publicSourceState(src);
    });
  }

  // --- 신규 등록 --------------------------------------------------------------

  async function templateFor(src) {
    const candidates = [];
    if (src.templateProductNo) candidates.push(Number(src.templateProductNo));
    const linked = Object.keys(src.links || {}).map(Number).filter(Boolean).sort((a, b) => b - a);
    candidates.push(...linked.slice(0, 5));
    for (const no of [...new Set(candidates)]) {
      try {
        const product = await withCafe24((token) => api.fetchProduct(token, no));
        if (product && Number(product.supply_price) > 0 && Number(product.price) > 0) return product;
      } catch (error) {
        if (/권한|scope|연결/.test(error.message)) throw error;
      }
    }
    throw new Error("공급사·카테고리·공급가 비율을 가져올 기준 상품을 찾지 못했습니다. 설정에서 기준 상품번호를 넣어 주세요.");
  }

  function startRegister(sourceId, sourceNo, { productName } = {}, actor) {
    return startJob("register", { sourceId, sourceNo: Number(sourceNo) }, async (update) => {
      const state = await readState();
      const src = requireSource(state, sourceId);
      const no = String(Number(sourceNo));
      // 두 번 누르거나 두 사람이 동시에 눌러 같은 상품이 두 번 등록되지 않게, 이미지
      // 작업(1~2분)을 시작하기 전에 "등록 중" 표시를 먼저 저장한다.
      const registerId = id("reg");
      await mutate((fresh0) => {
        const s0 = requireSource(fresh0, sourceId);
        const existing = Object.entries(s0.links).find(([, link]) => String(link.sourceNo) === no);
        if (existing) throw new Error(`이미 우프 상품 ${existing[0]}에 연결된 상품입니다.`);
        s0.registering = s0.registering || {};
        const pending = s0.registering[no];
        if (pending && Date.now() - new Date(pending.at).getTime() < 15 * 60 * 1000) {
          throw new Error("이 상품은 지금 등록 중입니다. 잠시 후 확인하세요.");
        }
        s0.registering[no] = { id: registerId, at: nowIso(), by: actor?.name || "" };
      });
      try {
      update({ message: "본사 상품 다시 읽는 중" });
      const fresh = await source.fetchProduct(src.baseUrl, Number(no));
      update({ message: "기준 상품 확인 중" });
      const template = await templateFor(src);
      const name = String(productName || "").trim() || `${src.namePrefix ? `${src.namePrefix} ` : ""}${fresh.name}`;
      const result = await registerProduct(
        { source: fresh, template, settings: src, productName: name },
        {
          cafe24: withCafe24,
          api,
          fetchBinary: source.fetchBinary,
          runPython,
          log: (message) => update({ message })
        }
      );
      await mutate((fresh2) => {
        const s = requireSource(fresh2, sourceId);
        if (s.registering?.[no]?.id === registerId) delete s.registering[no];
        s.links[String(result.productNo)] = {
          sourceNo: Number(no),
          sourceFilter: "",
          wooofName: name,
          valueMap: {},
          optionMap: {},
          note: "자동 등록",
          registered: true,
          linkedAt: nowIso(),
          linkedBy: actor?.name || ""
        };
        s.snapshot[no] = compactSource({ ...fresh, listed: s.snapshot[no]?.listed !== false }, s.snapshot[no], nowIso());
        addHistory(fresh2, {
          sourceId,
          type: "register",
          by: actor?.name || "",
          sourceNo: Number(no),
          wooofProductNo: result.productNo,
          summary: `신규 등록 (미진열): ${name}${result.warnings.length ? ` · 경고 ${result.warnings.length}건` : ""}`
        });
      });
      return result;
      } finally {
        await mutate((fresh3) => {
          const s3 = fresh3.sources[sourceId];
          if (s3?.registering?.[no]?.id === registerId) delete s3.registering[no];
        }).catch(() => {});
      }
    });
  }

  // --- 조회 ------------------------------------------------------------------

  async function overview() {
    const state = await readState();
    return {
      runHoursKst: state.runHoursKst,
      sources: Object.values(state.sources).map((src) => publicSourceState(src)),
      history: state.history.slice(0, 100),
      jobs: listJobs()
    };
  }

  async function sourceDetail(sourceId) {
    const state = await readState();
    const src = requireSource(state, sourceId);
    const links = Object.entries(src.links || {}).map(([wooofNo, link]) => {
      const snap = src.snapshot[String(link.sourceNo)];
      return {
        wooofProductNo: Number(wooofNo),
        ...link,
        sourceName: snap?.name || "",
        sourceUrl: snap?.url || `${src.baseUrl}/product/detail.html?product_no=${link.sourceNo}`,
        sourcePrice: snap?.price || 0,
        sourceSoldOut: Boolean(snap?.soldOut),
        sourceMissing: Boolean(snap?.missing),
        sourceListed: snap?.listed !== false,
        thumbnail: snap?.thumbnail || "",
        issueCount: (src.issues || []).filter((issue) => String(issue.wooofProductNo) === String(wooofNo)).length
      };
    }).sort((a, b) => b.wooofProductNo - a.wooofProductNo);
    const linkedSourceNos = new Set(Object.values(src.links || {}).map((link) => String(link.sourceNo)));
    const unlinked = Object.entries(src.snapshot || {})
      .filter(([no, snap]) => !linkedSourceNos.has(String(no)) && !snap.missing)
      .map(([no, snap]) => ({
        sourceNo: Number(no),
        name: snap.name,
        price: snap.price,
        soldOut: snap.soldOut,
        listed: snap.listed !== false,
        registeredAt: snap.registeredAt,
        thumbnail: snap.thumbnail,
        url: snap.url,
        ignored: Boolean(src.ignored?.[no])
      }))
      .sort((a, b) => b.sourceNo - a.sourceNo);
    return { ...publicSourceState(src), links, unlinked, history: state.history.filter((h) => h.sourceId === sourceId).slice(0, 100) };
  }

  async function searchWooof(query) {
    const text = String(query || "").trim();
    if (/^\d+$/.test(text)) {
      const product = await withCafe24((token) => api.fetchProduct(token, Number(text)));
      return product ? [summarizeWooof(product)] : [];
    }
    const list = await withCafe24((token) => api.searchProducts(token, { productName: text, limit: 30 }));
    return list.map(summarizeWooof);
  }

  // --- 스케줄 ------------------------------------------------------------------

  async function scheduleTick() {
    try {
      const state = await readState();
      for (const src of Object.values(state.sources)) {
        if (!src.enabled) continue;
        const due = dueRunSlot(src.lastRun?.at, state.runHoursKst);
        if (!due) continue;
        // 방금 시도했다가 실패했으면 한 시간은 쉰다.
        if (src.lastAttemptAt && Date.now() - new Date(src.lastAttemptAt).getTime() < 60 * 60 * 1000) continue;
        log.log(`[product-sync] scheduled run for ${src.id} (slot ${due})`);
        startRun(src.id, { trigger: "schedule" });
      }
    } catch (error) {
      log.error(`[product-sync] schedule check failed: ${error.message}`);
    }
  }

  function startSchedule() {
    if (scheduleTimer) return;
    scheduleTimer = setTimeout(() => {
      scheduleTick();
      scheduleTimer = setInterval(scheduleTick, SCHEDULE_CHECK_MS);
      scheduleTimer.unref?.();
    }, SCHEDULE_START_DELAY_MS);
    scheduleTimer.unref?.();
  }

  return {
    readState,
    overview,
    sourceDetail,
    startRun,
    startApply,
    startRegister,
    dismissIssues,
    clearNotices,
    saveLink,
    removeLink,
    setIgnored,
    updateSettings,
    searchWooof,
    checkLink: async (sourceId, wooofProductNo) => {
      const state = await readState();
      return checkLink(requireSource(state, sourceId), String(Number(wooofProductNo)));
    },
    getJob,
    listJobs,
    startSchedule,
    scheduleTick,
    // 시험용
    _runSyncBody: runSyncBody
  };
}

// 잘못 팔릴 수 있는 것(품절·삭제)이 먼저, 그다음 가격, 재입고, 확인만 할 것.
// 같은 종류 안에서는 상품끼리 모으고 옵션은 본사 순서(S, M, L…)대로.
const ISSUE_RANK = { soldout: 0, source_removed: 0, price: 1, option_price: 1, restock: 2 };
export function sortIssues(issues) {
  const rank = (issue) => ISSUE_RANK[issue.type] ?? (issue.severity === "warn" ? 3 : 4);
  return issues.sort((a, b) =>
    rank(a) - rank(b) ||
    b.wooofProductNo - a.wooofProductNo ||
    (a.order ?? 999) - (b.order ?? 999) ||
    String(a.optionLabel || "").localeCompare(String(b.optionLabel || "")));
}

function summarizeWooof(product) {
  return {
    product_no: Number(product.product_no),
    product_name: product.product_name,
    price: Number(product.price) || 0,
    display: product.display,
    selling: product.selling,
    supplier_code: product.supplier_code || "",
    custom_product_code: product.custom_product_code || "",
    list_image: product.list_image || product.tiny_image || ""
  };
}

function cleanMap(value) {
  const out = {};
  if (!value || typeof value !== "object") return out;
  for (const [from, to] of Object.entries(value)) {
    const k = String(from || "").trim();
    const v = String(to || "").trim();
    if (k && v) out[k] = v;
  }
  return out;
}

export function issueTypeLabel(type) {
  return {
    soldout: "품절",
    restock: "재입고",
    price: "판매가",
    option_price: "옵션 추가금",
    option_unmatched: "본사 옵션 짝 없음",
    variant_unmatched: "우프 옵션 짝 없음",
    source_removed: "본사 삭제",
    source_unlisted: "본사 진열 중단",
    wooof_missing: "우프 상품 없음",
    source_unreadable: "본사 읽기 실패",
    filter_empty: "옵션 필터 확인"
  }[type] || type;
}
