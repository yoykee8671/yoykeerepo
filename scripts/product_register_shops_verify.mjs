// node scripts/product_register_shops_verify.mjs — 신상품 등록: 다른 쇼핑몰 판매 끄기는
// pay 가 아는 쇼핑몰 번호로 한다(GET /shops 는 mall.read_store 권한이 필요해 실패했다).
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { registerProduct } from "../lib/product-register.mjs";

const calls = [];
const api = {
  fetchShops: async () => { throw new Error("insufficient_scope"); },
  uploadEditorImages: async () => [],
  createProduct: async () => ({ product_no: 999 }),
  updateProductInShop: async (_t, productNo, shopNo, patch) => calls.push([productNo, shopNo, patch]),
  uploadMainImage: async () => ({}),
  addAdditionalImages: async () => ({}),
  fetchProduct: async () => ({ variants: [] }),
  updateVariants: async () => ({})
};
const deps = {
  cafe24: (run) => run("token"),
  api,
  shopNos: async () => [1, 3],
  fetchBinary: async () => ({ buffer: Buffer.from("x"), contentType: "image/jpeg" }),
  runPython: async (args) => {
    const out = args[args.indexOf("--output") + 1];
    if (out) await writeFile(out, "x");
    return { multiplied: false, output: out };
  }
};
const source = { name: "테스트", price: 10000, images: { thumbnail: "https://x/a.jpg", detailImages: [] }, options: [], optionNames: [], hasOption: false };
const template = { supply_price: 5000, retail_price: 10000, price: 10000, supply_rate: 0.5 };
const result = await registerProduct({ source, template, settings: {}, productName: "테스트" }, deps);
assert.equal(result.productNo, 999);
assert.deepEqual(calls, [[999, 3, { selling: "F", display: "F" }]]);
assert.ok(!result.warnings.some((w) => /쇼핑몰/.test(w)), result.warnings.join(" / "));
console.log("product register shops verify: all checks passed");
