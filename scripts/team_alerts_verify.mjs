// node scripts/team_alerts_verify.mjs — 팀챗 알림: 보낼지, 태그, 이슈 문구
import assert from "node:assert/strict";
import { planAlert, issueFor, DEFAULT_TEAM_ALERTS } from "../lib/team-alerts.mjs";

const cfg = { ...DEFAULT_TEAM_ALERTS, enabled: true, people: [
  { name: "김예빈", github: "yebin-k", on: true, kinds: ["request_new", "payment_new"] },
  { name: "휴가중", github: "away", on: false, kinds: ["request_new"] },
  { name: "아이디없음", github: "", on: true, kinds: ["request_new"] }
] };
assert.equal(planAlert({ ...cfg, enabled: false }, "request_new"), null);
assert.equal(planAlert(cfg, "request_paid"), null);
assert.deepEqual(planAlert(cfg, "request_batch"), { kind: "request_new", mentions: ["@yebin-k"] });
const iss = issueFor({ title: "테일릿 입금요청 53,000원", text: "[입금요청] 테일릿 · 주문 1" }, planAlert(cfg, "request_new"));
assert.equal(iss.title, "[입금요청 발생] 테일릿 입금요청 53,000원");
assert.ok(iss.body.includes("@yebin-k 확인해 주세요."));
console.log("team alerts verify: all checks passed");
