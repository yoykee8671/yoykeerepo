// node scripts/v2_sync_verify.mjs — 운영 → v2 3-way 합치기 규칙 확인
import assert from "node:assert/strict";
import { mergeState, setAtPath, describePath } from "../lib/sync-merge.mjs";

const base = {
  __rev: 10, clobe: { token: "prod" },
  brands: [{ id: "b1", name: "아더마스", bankAccount: "111", fee: 10, updatedAt: "2026-11-14" }, { id: "b2", name: "브릿지독", bankAccount: "222" }],
  requests: [{ id: "r2", amount: 200 }, { id: "r1", amount: 100 }],
  auditLogs: [{ id: "a1", createdAt: "2026-11-14T01" }],
  npb: { channels: { naver: { rate: 5 } } }
};
const prod = structuredClone(base);
prod.__rev = 15; prod.clobe = { token: "prod-new" };
prod.brands[0].fee = 12; prod.brands[0].updatedAt = "2026-11-16"; // staff changed fee
prod.brands[1].bankAccount = "999"; // staff changed bank (conflict with v2)
prod.requests.unshift({ id: "r3", amount: 300 }); // new request in pay
prod.requests[2].amount = 110; // r1 edited in pay
prod.auditLogs.unshift({ id: "a2", createdAt: "2026-11-16T01" });
prod.npb.channels.naver.rate = 6;

const v2 = structuredClone(base);
v2.__rev = 40; v2.clobe = { token: "" };
v2.brands[0].transferAccountId = "acct1"; v2.brands[0].claimKind = "rehab"; v2.brands[0].updatedAt = "2026-11-15"; // v2-only fields
v2.brands[1].bankAccount = "333"; // v2 changed bank via account link
v2.transferAccounts = [{ id: "acct1", alias: "아더" }];
v2.requests.push({ id: "rv", amount: 1 }); // made in v2
v2.auditLogs.unshift({ id: "av", createdAt: "2026-11-15T01" });

const { state, conflicts, added } = mergeState(base, prod, v2);
assert.equal(state.__rev, 40); assert.equal(state.clobe.token, "");
const b1 = state.brands.find((b) => b.id === "b1");
assert.equal(b1.fee, 12); assert.equal(b1.transferAccountId, "acct1"); assert.equal(b1.claimKind, "rehab"); assert.equal(b1.updatedAt, "2026-11-16");
assert.equal(state.brands.find((b) => b.id === "b2").bankAccount, "333", "conflict keeps v2");
assert.equal(conflicts.length, 1); assert.deepEqual(conflicts[0].path, ["brands", { id: "b2" }, "bankAccount"]);
assert.equal(conflicts[0].prod, "999");
assert.deepEqual(state.requests.map((r) => r.id), ["r3", "r2", "r1", "rv"]);
assert.equal(state.requests.find((r) => r.id === "r1").amount, 110);
assert.deepEqual(state.auditLogs.map((a) => a.id), ["a2", "av", "a1"]);
assert.equal(state.npb.channels.naver.rate, 6);
assert.equal(state.transferAccounts.length, 1);
assert.equal(added.requests, 1);
assert.equal(describePath(conflicts[0].path, state), "brands › 브릿지독 › bankAccount");

// deletion in pay of an untouched record removes it in v2; deletion of a v2-edited one is a conflict
const base2 = { partners: [{ id: "p1", n: 1 }, { id: "p2", n: 2 }] };
const prod2 = { partners: [] };
const v22 = { partners: [{ id: "p1", n: 1 }, { id: "p2", n: 5 }] };
const m2 = mergeState(base2, prod2, v22);
assert.deepEqual(m2.state.partners.map((p) => p.id), ["p2"]);
assert.equal(m2.conflicts.length, 1);

// answering a conflict with the pay value
setAtPath(state, conflicts[0].path, conflicts[0].prod);
assert.equal(state.brands.find((b) => b.id === "b2").bankAccount, "999");
setAtPath(m2.state, m2.conflicts[0].path, undefined);
assert.equal(m2.state.partners.length, 0);
console.log("v2 sync merge: ok");
