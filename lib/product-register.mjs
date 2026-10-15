// 본사 상품 → 우프(카페24) 신규 등록.
//
// 원칙
//   - 항상 미진열(display F)로 올린다. 사람이 우프 어드민에서 보고 진열한다.
//   - 판매가는 본사 정가. 옵션 추가금도 본사 그대로.
//   - 공급사·카테고리·원산지·과세·공급가 비율은 "기준 상품"(이미 우프에 있는 같은
//     브랜드 상품)에서 복사한다. 브랜드마다 손으로 맞춰 둔 값이라 그대로 따르는
//     편이 안전하다.
//   - 대표이미지는 흰 배경 누끼면 #F7F7F7 multiply (scripts/product_image.py).
//   - 상세·추가 이미지는 본사 주소를 걸지 않고 우프 쪽으로 옮겨 올린다. 본사가
//     이미지를 지우거나 바꿔도 우프 상세가 깨지지 않게.
//
// 네트워크·파일·파이썬 호출은 deps 로 받는다 — 서버에서 묶어 넘기고, 시험할 때는
// 가짜로 바꿔 끼울 수 있게.

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { matchOptions } from "./product-sync.mjs";

const COPY_FROM_TEMPLATE = [
  "supplier_code",
  "tax_type",
  "origin_classification",
  "origin_place_no",
  "origin_place_value",
  "made_in_code",
  "brand_code",
  "manufacturer_code",
  "trend_code"
];

function money(value) {
  const n = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : 0;
}

function extOf(url, contentType) {
  const fromUrl = path.extname(new URL(url).pathname).toLowerCase();
  if ([".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(fromUrl)) return fromUrl;
  if (/png/.test(contentType)) return ".png";
  if (/gif/.test(contentType)) return ".gif";
  if (/webp/.test(contentType)) return ".webp";
  return ".jpg";
}

function mimeOf(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".gif") return "image/gif";
  return "image/jpeg";
}

// 공급가 = 판매가 × (기준 상품의 공급가/판매가). 10원 단위 반올림.
export function supplyPriceFor(price, template) {
  const tPrice = money(template?.price);
  const tSupply = money(template?.supply_price);
  if (!price) return 0;
  if (!tPrice || !tSupply) return 0;
  return Math.round((price * tSupply) / tPrice / 10) * 10;
}

// 옵션 정의: 차원(SIZE, COLOR...)별로 값 목록. 본사 순서를 그대로 따른다.
export function optionDefinitions(source) {
  const names = source.optionNames?.length ? source.optionNames : (source.options?.[0]?.names || []);
  return names.map((name, index) => {
    const values = [];
    for (const option of source.options || []) {
      const value = option.values?.[index];
      if (value !== undefined && !values.includes(value)) values.push(value);
    }
    return { name, value: values };
  });
}

export function buildDescriptionHtml(imagePaths) {
  const images = imagePaths
    .map((src) => `<img src="${src}" style="display:block;margin:0 auto;max-width:100%;" alt="">`)
    .join("\n");
  return `<div style="text-align:center;">\n${images}\n</div>`;
}

export function buildCreateRequest({ source, template, settings, productName, descriptionHtml }) {
  const price = money(source.price);
  const request = {
    product_name: productName,
    supply_product_name: source.name,
    custom_product_code: `${String(settings.id || "SRC").toUpperCase()}-${source.sourceNo}`.slice(0, 40),
    price,
    supply_price: supplyPriceFor(price, template),
    display: "F",
    selling: "T",
    product_condition: "N",
    description: descriptionHtml,
    has_option: source.options?.length ? "T" : "F"
  };
  // 소비자가는 기준 상품이 쓰고 있을 때만 판매가와 같게 넣는다.
  if (money(template?.retail_price) > 0) request.retail_price = price;
  for (const key of COPY_FROM_TEMPLATE) {
    const value = template?.[key];
    if (value !== undefined && value !== null && value !== "") request[key] = value;
  }
  const categories = (template?.category || [])
    .map((c) => Number(c.category_no))
    .filter((n) => Number.isInteger(n) && n > 0);
  if (categories.length) {
    request.add_category_no = categories.map((categoryNo) => ({ category_no: categoryNo, recommend: "F", new: "F" }));
  }
  if (source.options?.length) request.options = optionDefinitions(source);
  return request;
}

// 등록 직후 품목 정리: 추가금, 재고(판매중=restockQuantity, 품절=0),
// 본사에 없는 조합(조합형 옵션의 빈칸)은 진열·판매 안 함.
export function variantPatchesAfterCreate({ source, variants, restockQuantity }) {
  const matching = matchOptions(source, variants, {});
  const patches = [];
  for (const { source: option, variant } of matching.pairs) {
    const sellable = !source.soldOut && (!option || (option.selling && option.display !== false));
    patches.push({
      variant_code: variant.variant_code,
      additional_amount: option ? money(option.additionalAmount) : 0,
      use_inventory: "T",
      display_soldout: "T",
      quantity: sellable ? restockQuantity : 0,
      display: "T",
      selling: "T"
    });
  }
  for (const variant of matching.unmatchedWooof) {
    patches.push({ variant_code: variant.variant_code, display: "F", selling: "F" });
  }
  return { patches, unmatchedSource: matching.unmatchedSource };
}

export async function registerProduct({ source: sourceIn, template, settings, productName }, deps) {
  // 단일상품인데 카페24가 품목 하나를 옵션 데이터로 내보내는 경우가 있다 —
  // has_option 이 아니면 옵션 없이 등록한다.
  const source = sourceIn.hasOption === false ? { ...sourceIn, options: [], optionNames: [] } : sourceIn;
  if (source.optionsUnreadable) throw new Error("본사 옵션 정보를 읽지 못해 등록하지 않았습니다. 본사 페이지를 확인하세요.");
  const { cafe24, fetchBinary, runPython, log = () => {} } = deps;
  const workDir = await mkdtemp(path.join(os.tmpdir(), "wooof-register-"));
  const steps = [];
  const note = (message) => {
    steps.push(message);
    log(message);
  };
  try {
    const download = async (url, name) => {
      const { buffer, contentType } = await fetchBinary(url);
      const file = path.join(workDir, `${name}${extOf(url, contentType)}`);
      await writeFile(file, buffer);
      return file;
    };
    const normalize = async (file) => {
      const result = await runPython(["normalize", "--input", file, "--output-dir", workDir]);
      return result.output;
    };
    const asBase64 = async (file) => (await readFile(file)).toString("base64");
    const asDataUri = async (file) => `data:${mimeOf(file)};base64,${await asBase64(file)}`;

    // 1) 대표이미지
    if (!source.images?.thumbnail) throw new Error("본사 대표이미지를 찾지 못했습니다.");
    const thumbIn = await download(source.images.thumbnail, "thumb-src");
    const thumbOut = path.join(workDir, "thumb.jpg");
    const thumb = await runPython([
      "thumbnail", "--input", thumbIn, "--output", thumbOut, "--color", settings.thumbnailMultiply || "F7F7F7"
    ]);
    note(thumb.multiplied
      ? `대표이미지: 흰 배경 누끼 → #${settings.thumbnailMultiply || "F7F7F7"} multiply`
      : "대표이미지: 흰 배경이 아니라 원본 그대로");

    // 2) 상세이미지 → 우프로 업로드
    const detailFiles = [];
    for (const [index, url] of (source.images?.detailImages || []).entries()) {
      detailFiles.push(await normalize(await download(url, `detail-${String(index).padStart(2, "0")}`)));
    }
    const uploaded = detailFiles.length
      ? await cafe24(async (token) => deps.api.uploadEditorImages(token, await Promise.all(detailFiles.map(asBase64))))
      : [];
    note(`상세이미지 ${uploaded.length}장 업로드`);

    // 3) 상품 등록 (미진열)
    const request = buildCreateRequest({
      source,
      template,
      settings,
      productName,
      descriptionHtml: buildDescriptionHtml(uploaded)
    });
    if (!request.supply_price) {
      throw new Error("공급가를 계산할 기준 상품이 없습니다. 기준 상품번호를 설정하거나 기존 상품을 먼저 연결하세요.");
    }
    const created = await cafe24((token) => deps.api.createProduct(token, request));
    const productNo = Number(created?.product_no);
    if (!productNo) throw new Error("카페24가 상품번호를 돌려주지 않았습니다.");
    note(`우프 상품 ${productNo} 등록 (미진열)`);

    // 여기부터 실패해도 상품은 이미 생겼다 — 상품번호를 꼭 돌려준다.
    const warnings = [];
    try {
      await cafe24(async (token) => deps.api.uploadMainImage(token, productNo, await asDataUri(thumbOut)));
      note("대표이미지 업로드");
    } catch (error) {
      warnings.push(`대표이미지 업로드 실패: ${error.message}`);
    }
    try {
      const extraFiles = [];
      for (const [index, url] of (source.images?.additional || []).slice(0, 20).entries()) {
        extraFiles.push(await normalize(await download(url, `extra-${String(index).padStart(2, "0")}`)));
      }
      if (extraFiles.length) {
        await cafe24(async (token) => deps.api.addAdditionalImages(token, productNo, await Promise.all(extraFiles.map(asDataUri))));
        note(`추가이미지 ${extraFiles.length}장 업로드`);
      }
    } catch (error) {
      warnings.push(`추가이미지 업로드 실패: ${error.message}`);
    }
    try {
      const product = await cafe24((token) => deps.api.fetchProduct(token, productNo));
      const { patches, unmatchedSource } = variantPatchesAfterCreate({
        source,
        variants: product?.variants || [],
        restockQuantity: Math.max(1, Number(settings.restockQuantity) || 99)
      });
      for (let i = 0; i < patches.length; i += 100) {
        await cafe24((token) => deps.api.updateVariants(token, productNo, patches.slice(i, i + 100)));
      }
      note(`품목 ${patches.length}개 추가금·재고 설정`);
      if (unmatchedSource.length) warnings.push(`옵션 ${unmatchedSource.map((o) => o.label).join(", ")} 이(가) 품목과 맞지 않습니다.`);
    } catch (error) {
      warnings.push(`옵션 재고·추가금 설정 실패: ${error.message}`);
    }
    return { productNo, steps, warnings, thumbnail: thumb, request: { ...request, description: `(이미지 ${uploaded.length}장)` } };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
