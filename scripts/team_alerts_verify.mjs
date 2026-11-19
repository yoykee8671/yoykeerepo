// node scripts/team_alerts_verify.mjs — 팀챗 알림(슬랙 웹훅) 규칙 확인
import assert from "node:assert/strict";
import * as ta from "../lib/team-alerts.mjs";

const cfg = { enabled: true, events: {} };
assert.equal(ta.planAuto(cfg, "request_new"), null); // 입금요청은 체크해서 보냄
assert.deepEqual(ta.planAuto(cfg, "product_registered"), { event: "product_registered" });
assert.equal(ta.planAuto({ ...cfg, enabled: false }, "product_registered"), null);
assert.equal(ta.eventConfig({ events: { request: { mode: "auto" } } }, "request").mode, "auto");
assert.equal(ta.eventConfig({ events: { request: { mode: "x" } } }, "request").mode, "manual");

const n = ta.productRegisteredNotice({ brandName: "MUNIKUND", count: 2, products: [{ productNo: 1, name: "A<b>" }] });
const text = ta.slackTextFor(n, { event: "product_registered" });
assert.ok(text.startsWith("*[신상품 미진열 등록] MUNIKUND 신상품 2건 미진열 등록*\n"));
assert.ok(text.includes("A&lt;b&gt;"));
assert.ok(!text.includes("@"));

assert.equal(ta.isSlackWebhook("https://hooks.slack.com/services/T0/B0/xyz"), true);
assert.equal(ta.isSlackWebhook("https://evil.example.com/services/x"), false);

let sent;
await ta.postSlack({ webhook: "https://hooks.slack.com/services/T0/B0/xyz", text }, async (url, o) => { sent = { url, body: JSON.parse(o.body) }; return { ok: true }; });
assert.equal(sent.body.text, text);
await assert.rejects(ta.postSlack({ webhook: "", text }), /웹훅 주소가 없습니다/);
await assert.rejects(ta.postSlack({ webhook: "https://hooks.slack.com/services/T0/B0/x", text }, async () => ({ ok: false, status: 404, text: async () => "no_service" })), /거절/);
console.log("team alerts verify: all checks passed");
