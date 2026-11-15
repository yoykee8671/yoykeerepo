// node scripts/v2_closing_verify.mjs — 월 마감 규칙 확인
import assert from "node:assert/strict";
import * as closing from "../lib/closing.mjs";
import { requestMonth } from "../lib/monthly-board.mjs";

assert.equal(closing.isLocked({ lockedThrough: "2026-10" }, "2026-10"), true);
assert.equal(closing.isLocked({ lockedThrough: "2026-10" }, "2026-09"), true);
assert.equal(closing.isLocked({ lockedThrough: "2026-10" }, "2026-11"), false);
assert.equal(closing.isLocked({ lockedThrough: "" }, "2026-01"), false);
assert.equal(closing.prevMonth("2026-01"), "2025-12");

const r = closing.closingCheck({
  month: "2026-10",
  requests: [
    { orderNo: "20261005-001", status: "pending", brandName: "A" },
    { orderNo: "20261007-002", status: "paid", brandName: "B" },
    { orderNo: "20261101-003", status: "pending", brandName: "C" }
  ],
  requestMonth,
  payments: [
    { code: "P1", status: "requested", dueDate: "2026-10-20", title: "택배" },
    { code: "P2", status: "paid", dueDate: "2026-10-20" },
    { code: "P3", status: "requested", dueDate: "2026-11-20" }
  ],
  boardRows: [{ brandName: "A", sales: 100, checked: true, sent: false, diffs: [] }, { brandName: "Z", sales: 0, shipping: 0, recovered: 0 }],
  questions: [{ status: "open", title: "q" }, { status: "answered" }],
  stock: [{ name: "박스", negative: true }, { name: "x", negative: false }]
});
const by = Object.fromEntries(r.items.map((i) => [i.key, i.count]));
assert.deepEqual(by, { requests: 1, payments: 1, unchecked: 0, unsent: 1, diffs: 0, questions: 1, negative: 1 });
assert.equal(r.open, 5);
console.log("v2 closing: ok");
