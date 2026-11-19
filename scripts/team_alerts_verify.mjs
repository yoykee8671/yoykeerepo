// node scripts/team_alerts_verify.mjs — 팀챗 알림: 방(라벨), 자동/수동, 기본 태그
import assert from "node:assert/strict";
import { planAuto, issueFor, mentionsFor, eventConfig, productRegisteredNotice, DEFAULT_TEAM_ALERTS } from "../lib/team-alerts.mjs";

const cfg = { ...DEFAULT_TEAM_ALERTS, enabled: true };
// 결제 요청류는 수동(체크해서 보냄)이라 자동으로는 안 나간다
assert.equal(planAuto(cfg, "request_batch"), null);
assert.equal(planAuto(cfg, "payment_new"), null);
// 신상품 등록은 자동 · 우프_브랜드 방 · 유재량 태그
assert.deepEqual(planAuto(cfg, "product_registered"), { event: "product_registered", room: "brand", mentions: ["@wooof-yjr"] });
assert.equal(planAuto({ ...cfg, enabled: false }, "product_registered"), null);
assert.deepEqual(eventConfig(cfg, "request").tags, ["yebin"]);
assert.deepEqual(mentionsFor(cfg, ["kyo"]), ["@wooof-kyo"]);
const n = productRegisteredNotice({ brandName: "MUNIKUND", count: 3 });
assert.equal(n.text.split("\n")[0], "MUNIKUND의 3건의 새로운 제품이 미진열로 등록되었습니다. 카페24 어드민에서 분류 지정 및 검수 후 진열로 변경해주세요.");
const iss = issueFor(n, planAuto(cfg, "product_registered"));
assert.deepEqual(iss.labels, ["브랜드"]);
assert.ok(iss.title.startsWith("[신상품 미진열 등록] MUNIKUND"));
assert.deepEqual(issueFor({ title: "x" }, { event: "request", room: "payment", mentions: ["@wooof-kyo"] }).labels, ["결제요청"]);
console.log("team alerts verify: all checks passed");
