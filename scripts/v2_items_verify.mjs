// node scripts/v2_items_verify.mjs — 품목 종류 나누기와 종류별 코드
import assert from "node:assert/strict";
import { assignCodes, classifyLegacyItem, itemPrefix } from "../server.js";

const partners = [{ id: "p1", name: "동광섬유" }, { id: "p2", name: "베럴즈" }, { id: "p3", name: "다정한마켓(로렌츠)" }];
const db = {
  codeSeq: { MT: 42 },
  partners,
  materials: [
    { id: "a", code: "MT-0002", category: "부자재", partnerId: "p1", itemName: "옆솜", createdAt: "2026-01-01" },
    { id: "b", code: "MT-0001", category: "운송비", partnerId: "p1", itemName: "용달", createdAt: "2026-01-02" },
    { id: "c", code: "MT-0039", category: "상품", partnerId: "p2", itemName: "포포타올", createdAt: "2026-01-03" },
    { id: "d", code: "MT-0010", category: "상품", partnerId: "p3", itemName: "로렌츠 스틱", createdAt: "2026-01-04" },
    { id: "e", code: "MT-0038", category: "", partnerId: "p3", itemName: "로렌츠 배송비", createdAt: "2026-01-05" }
  ]
};
for (const m of db.materials) classifyLegacyItem(m, partners);
assert.deepEqual(db.materials.map((m) => [m.itemKind, m.materialType || ""]), [["material", "SB"], ["material", "FR"], ["product", ""], ["vendorProduct", ""], ["vendorProduct", ""]]);
assignCodes(db);
assert.deepEqual(db.materials.map((m) => m.code), ["SB-0001", "FR-0001", "P-0001", "V-0001", "V-0002"]);
assert.deepEqual(db.materials[0].legacyCodes, ["MT-0002"]);
// 다시 돌려도 그대로
assert.equal(assignCodes(db), 0);
// 새 자재(원단) → RM-0001, 종류를 바꾸면 새 코드 + 예전 코드 보관
db.materials.push({ id: "f", itemKind: "material", materialType: "RM", itemName: "겉감", createdAt: "2026-02-01" });
assignCodes(db);
assert.equal(db.materials[5].code, "RM-0001");
db.materials[0].materialType = "PK";
assignCodes(db);
assert.equal(db.materials[0].code, "PK-0001");
assert.deepEqual(db.materials[0].legacyCodes, ["MT-0002", "SB-0001"]);
assert.equal(itemPrefix({ itemKind: "material" }), "SB");
console.log("v2 items verify: all checks passed");
