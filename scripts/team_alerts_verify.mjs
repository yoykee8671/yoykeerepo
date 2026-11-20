// node scripts/team_alerts_verify.mjs — 팀챗 알림(슬랙 봇) 규칙 확인
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

const pay = ta.slackTextFor(ta.paymentsNotice([
  { code: "PR-2611-001", title: "태성산업 본딩 및 화물비 포함 11월13일 청구", amount: 67155, payeeName: "태성산업", dueDate: "2026-11-20" },
  { code: "PR-2611-002", title: "새 내용", amount: 67153, holder: "태성산업" }], "이교영"), { event: "payment" });
assert.equal(pay, [
  "*[지급요청] 2 건이 등록되었습니다. - 요청: 이교영*",
  "[1] 내용: 태성산업 본딩 및 화물비 포함 11월13일 청구 (PR-2611-001)",
  "금액: 67,155 원  |  받는곳: 태성산업  |  기한: 2026-11-20",
  "[2] 내용: 새 내용 (PR-2611-002)",
  "금액: 67,153 원  |  받는곳: 태성산업  |  기한: ASAP"].join("\n"));
const req = ta.slackTextFor(ta.teamNoticeFor("request_new", { brandName: "테일릿", orderNo: "20261119-0000012", customerName: "홍길동", depositAmount: 53000, by: "" }), { event: "request" });
assert.equal(req, "*[입금요청] 1 건이 등록되었습니다.*\n[1] 테일릿 53,000 원  |  주문번호: 20261119-0000012 홍길동");
console.log(pay + "\n---\n" + req);
let bot;
await ta.postSlackBot({ token: "xoxb-1-abc", channel: "#notice", text: "t" }, async (url, o) => { bot = { url, auth: o.headers.authorization, body: JSON.parse(o.body) }; return { ok: true, json: async () => ({ ok: true }) }; });
assert.equal(bot.url, "https://slack.com/api/chat.postMessage");
assert.equal(bot.auth, "Bearer xoxb-1-abc");
assert.equal(bot.body.channel, "#notice");
await assert.rejects(ta.postSlackBot({ token: "xoxb-1-abc", channel: "#notice", text: "t" }, async () => ({ ok: true, json: async () => ({ ok: false, error: "not_in_channel" }) })), /봇이 채널에 없습니다/);
await assert.rejects(ta.postSlackBot({ token: "xoxp-1", channel: "#notice", text: "t" }), /봇 토큰/);
console.log("team alerts verify: all checks passed");
