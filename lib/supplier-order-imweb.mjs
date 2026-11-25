// 공급사(아임웹 몰, 첫 대상: 테일릿) 자동 주문 — 크롬을 띄워 사람이 하듯 주문한다.
//
// 테일릿 결제 화면은 아임웹 새 주문 화면(앱 방식)이라 서버 요청만으로는 주문할 수 없다.
// 흐름(2026-11-25 결제 직전까지 확인):
//   상품 화면 › 옵션 선택(필수) › 수량 › [구매하기] (여러 상품이면 [장바구니] 후 장바구니에서 우리 상품만 골라 주문)
//   결제 화면 › 배송지 [변경] › [신규입력] 수령인·연락처·[주소찾기](우편번호 검색)·상세주소
//            › 결제 수단 '무통장입금'(입금자명 비우면 주문자명) › 약관 동의 › [결제하기]
// 안전장치
//   - dryRun: 결제 화면을 다 채우고 [결제하기]는 누르지 않는다(연습 모드).
//   - expectedTotal: 결제 화면의 총 주문금액이 다르면 [결제하기] 전에 멈춘다.
//   - 화면 캡처를 단계마다 남겨(screenshotDir) 실패 원인을 사람이 본다.
// 계정은 서버가 넘겨준다(여기 저장하지 않는다).

const digits = (v) => String(v || "").replace(/\D/g, "");
const won = (text) => Number(String(text || "").replace(/[^\d]/g, "")) || 0;
const norm = (s) => String(s || "").normalize("NFKC").replace(/[^\p{L}\p{N}]+/gu, "").toLowerCase();

export async function loadChromium() {
  const pw = await import("playwright-core");
  return pw.chromium;
}

export function chromiumPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  if (process.platform === "darwin") return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  return "/usr/bin/chromium";
}

// items: [{ sourceNo, optionLabel, qty, name }]
// receiver: { name, phone, zip, addr1, addr2, memo }
export async function placeImwebOrder({ baseUrl, uid, passwd, items, receiver, expectedTotal = 0, dryRun = true,
  log = () => {}, screenshotDir = "", timeoutMs = 30000 }) {
  if (!items?.length) throw new Error("주문할 상품이 없습니다.");
  if (!receiver?.name || !digits(receiver.phone) || !receiver.addr1) throw new Error("수령인 이름·연락처·주소가 필요합니다.");
  const origin = new URL(baseUrl).origin;
  const chromium = await loadChromium();
  const browser = await chromium.launch({ executablePath: chromiumPath(), headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const shots = [];
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1400 }, locale: "ko-KR", timezoneId: "Asia/Seoul" });
  const page = await ctx.newPage();
  page.setDefaultTimeout(timeoutMs);
  const shot = async (name) => {
    if (!screenshotDir) return;
    const file = `${screenshotDir}/${String(shots.length + 1).padStart(2, "0")}-${name}.png`;
    await page.screenshot({ path: file }).catch(() => {});
    shots.push(file);
  };
  const step = (message) => log(message);
  try {
    // 1. 로그인
    step("공급사 사이트 로그인");
    await page.goto(`${origin}/login?back_url=Lw%3D%3D&used_login_btn=Y`);
    await page.fill('input[name="uid"]', uid);
    await page.fill('input[name="passwd"]', passwd);
    await page.locator('input[name="passwd"]').press("Enter");
    await page.waitForLoadState("networkidle").catch(() => {});
    if (!(await page.locator("a, button").filter({ hasText: /^로그아웃$/ }).count())) {
      await shot("login-failed");
      throw new Error("공급사 사이트 로그인에 실패했습니다. 상품동기화 설정의 계정을 확인하세요.");
    }

    // 2. 상품 담기
    const single = items.length === 1;
    if (!single) {
      // 여러 상품은 장바구니를 거친다. 연습 모드는 상대 장바구니를 바꾸므로 하지 않고,
      // 장바구니에 다른 상품이 있으면 섞일 수 있어 멈춘다.
      if (dryRun) return { ok: false, stopped: "dryrun-multi", error: "여러 상품 주문은 연습 모드를 지원하지 않습니다(공급사 장바구니가 바뀜).", screenshots: shots };
      await page.goto(`${origin}/shop_cart`);
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(2500);
      if (!(await cartIsEmpty(page))) {
        await shot("cart-not-empty");
        return { ok: false, stopped: "cart", error: "공급사 장바구니에 다른 상품이 있어서 멈췄습니다. 공급사 사이트 장바구니를 비우고 다시 하세요.", screenshots: shots };
      }
    }
    for (const [i, item] of items.entries()) {
      step(`상품 ${i + 1}/${items.length} 담는 중: ${item.name || item.sourceNo}`);
      await page.goto(`${origin}/shop_view/?idx=${Number(item.sourceNo)}`);
      await page.waitForLoadState("networkidle").catch(() => {});
      await chooseOption(page, item.optionLabel);
      await setQuantity(page, Number(item.qty) || 1);
      await shot(`item-${i + 1}`);
      if (single) {
        await page.locator("a, button").filter({ hasText: /^\s*구매하기\s*$/ }).first().click();
        // 장바구니에 다른 상품이 있으면 "이 상품만 구매" 창이 뜬다.
        const only = page.locator("a, button").filter({ hasText: "이 상품만 구매" }).first();
        await only.waitFor({ state: "visible", timeout: 4000 }).then(() => only.click()).catch(() => {});
      } else {
        await page.locator("a, button").filter({ hasText: /^\s*장바구니\s*$/ }).filter({ visible: true }).first().click();
        await page.waitForTimeout(1500);
      }
    }
    if (!single) {
      step("장바구니에서 이번 주문 상품만 고르는 중");
      await page.goto(`${origin}/shop_cart`);
      await page.waitForLoadState("networkidle").catch(() => {});
      await page.waitForTimeout(2500);
      await shot("cart");
      // 장바구니에는 방금 담은 상품만 있다(시작 전에 비어 있음을 확인). 전체 주문.
      await page.locator("a, button").filter({ hasText: /전체\s*(상품\s*)?주문|^\s*주문하기\s*$|^\s*구매하기\s*$/ }).filter({ visible: true }).first().click();
    }

    // 3. 결제 화면
    await page.waitForURL(/shop_payment/, { timeout: timeoutMs });
    const supplierOrderNo = new URL(page.url()).searchParams.get("order_no") || "";
    await page.locator("text=결제 수단").first().waitFor();
    await page.waitForTimeout(1500);
    step("배송지 입력");
    await fillReceiver(page, receiver, shot);
    step("결제 수단: 무통장입금");
    await page.locator("label, div, span").filter({ hasText: /^무통장입금$/ }).first().click();
    await page.waitForTimeout(800);
    await agreeTerms(page);
    await page.waitForTimeout(1000);
    const lines = await readOrderLines(page);
    const summary = await readSummary(page);
    const seen = await readReceiver(page);
    await shot("ready");
    const result = { supplierOrderNo, payDisabled: summary.payDisabled, total: summary.total, shippingFee: summary.shippingFee, itemsAmount: summary.itemsAmount,
      receiverSeen: seen, paymentUrl: page.url(), dryRun, screenshots: shots };
    const missingItems = items.filter((it) => !lines.some((l) => norm(l).includes(norm(it.name).slice(0, 12))));
    if (lines.length !== items.length || missingItems.length) {
      return { ...result, ok: false, stopped: "items", orderLines: lines,
        error: `결제 화면의 상품이 우리 주문과 다릅니다(결제 화면 ${lines.length}줄 / 우리 ${items.length}개${missingItems.length ? `, 없음: ${missingItems.map((x) => x.name).join(", ")}` : ""}). 주문하지 않았습니다.` };
    }
    if (expectedTotal && summary.total !== Number(expectedTotal)) {
      return { ...result, ok: false, stopped: "amount", error: `결제 금액이 다릅니다: 공급사 ${summary.total.toLocaleString("ko-KR")}원 / 우리 계산 ${Number(expectedTotal).toLocaleString("ko-KR")}원. 주문하지 않았습니다.` };
    }
    if (norm(seen.name) !== norm(receiver.name) || digits(seen.phone) !== digits(receiver.phone)) {
      return { ...result, ok: false, stopped: "receiver", error: "결제 화면의 수령인 이름·연락처가 카페24와 다릅니다. 주문하지 않았습니다." };
    }
    if (dryRun) return { ...result, ok: true };

    // 4. 주문 제출
    step("주문 제출");
    await page.locator("button, a").filter({ hasText: /^\s*결제하기\s*$/ }).last().click();
    await page.waitForURL((url) => !/shop_payment\/\?/.test(url.toString()) || /complete/i.test(url.toString()), { timeout: 60000 }).catch(() => {});
    await page.waitForLoadState("networkidle").catch(() => {});
    await page.waitForTimeout(2000);
    await shot("done");
    const doneText = await page.locator("body").innerText();
    const completed = /주문\s*(이|이\s*정상적으로)?\s*완료|주문완료|입금\s*계좌|입금하실\s*계좌/.test(doneText);
    const doneNo = (doneText.match(/주문\s*번호[^\d]{0,10}(\d{10,})/) || [])[1] || supplierOrderNo;
    const bank = (doneText.match(/([가-힣]+은행|농협|우체국|새마을금고)[^\n]{0,40}/) || [])[0] || "";
    return { ...result, ok: completed, supplierOrderNo: doneNo, bankInfo: bank.trim(), completeUrl: page.url(),
      ...(completed ? {} : { error: "주문 완료 화면을 확인하지 못했습니다. 공급사 사이트 주문내역에서 확인하세요." }) };
  } catch (error) {
    await shot("error");
    return { ok: false, error: error.message, screenshots: shots };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function chooseOption(page, optionLabel) {
  const toggle = page.locator(":is(a,button,div,span):text-is('선택 (필수)')").first();
  if (!(await toggle.count())) return;
  await toggle.click();
  const items = page.locator(".dropdown-menu:visible .dropdown-item");
  await items.first().waitFor({ state: "visible", timeout: 5000 });
  const texts = await items.allInnerTexts();
  let index = 0;
  if (optionLabel) {
    const want = norm(optionLabel);
    const hit = texts.findIndex((t) => norm(t.split("\n")[0]).includes(want) || want.includes(norm(t.split("\n")[0])));
    if (hit < 0 && texts.length > 1) throw new Error(`공급사 옵션 '${optionLabel}'을 찾지 못했습니다. (있는 옵션: ${texts.map((t) => t.split("\n")[0]).join(", ")})`);
    if (hit >= 0) index = hit;
  } else if (texts.length > 1) {
    throw new Error("옵션이 여러 개인데 어느 옵션인지 모릅니다. 상품동기화 연결표에서 옵션 연결을 확인하세요.");
  }
  if (/품절/.test(texts[index] || "")) throw new Error(`공급사에서 품절인 옵션입니다: ${texts[index].split("\n")[0]}`);
  await items.nth(index).click();
  await page.waitForTimeout(1200);
}

async function setQuantity(page, qty) {
  if (qty <= 1) return;
  const input = page.locator("input[type=text]:visible, input[type=number]:visible").filter({ has: page.locator("xpath=.") })
    .and(page.locator("[class*=qty] input, [class*=quantity] input, input[name*=qty], input[name*=count]")).first();
  if (await input.count()) {
    await input.fill(String(qty));
    await input.press("Tab");
  } else {
    const plus = page.locator("[class*=plus]:visible, button:has-text('+'):visible").first();
    for (let i = 1; i < qty; i += 1) await plus.click();
  }
  await page.waitForTimeout(800);
}

async function cartIsEmpty(page) {
  const text = await page.locator("body").innerText();
  return /상품 둘러보기|장바구니가\s*비어|담긴\s*상품이\s*없/.test(text);
}

// 결제 화면 '주문 상품 정보'의 상품 줄(상품명). 상품마다 '필수' 옵션 줄이 붙는다.
async function readOrderLines(page) {
  // '주문 상품 정보'로 시작하는 가장 안쪽 상자(바깥 상자는 결제 화면 전체를 품는다).
  const box = page.locator("section, div").filter({ hasText: /^\s*주문 상품 정보/ }).filter({ hasNotText: /주문자 정보/ }).last();
  const text = (await box.count()) ? await box.innerText() : "";
  if (process.env.SUPPLIER_ORDER_DEBUG) console.log("order box text:", JSON.stringify(text.slice(0, 600)));
  return text.split("\n").map((t) => t.trim())
    .filter((t) => t && !/^주문 상품 정보$|^필수$|^배송비|원$|^\d/.test(t) && !/ - \d+개$/.test(t));
}

async function fillReceiver(page, r, shot) {
  const section = page.locator("section, div").filter({ hasText: /^배송지 정보/ }).first();
  await page.locator("button, a").filter({ hasText: /^변경$/ }).first().click();
  await page.locator("button, a, div, span").filter({ hasText: /^신규입력$/ }).first().click();
  await page.locator('input[name="name"]').fill(r.name);
  await page.locator('input[name="call"]').fill(digits(r.phone));
  // 주소찾기 → 우편번호 검색 창(다음 우편번호). 도로명 주소로 찾고 우편번호가 같은 결과를 고른다.
  await page.locator("button, a").filter({ hasText: /주소\s*찾기/ }).first().click();
  const frame = await waitPostcodeFrame(page);
  const query = String(r.addr1).replace(/\(.*?\)/g, "").trim();
  await frame.locator("input#region_name, input[name=region_name], input[type=text]").first().fill(query);
  await frame.locator("input#region_name, input[name=region_name], input[type=text]").first().press("Enter");
  const results = frame.locator(".link_post, li.list_post_item, ul.list_post li");
  await results.first().waitFor({ state: "visible", timeout: 10000 });
  const n = await results.count();
  let chosen = -1;
  for (let i = 0; i < n; i += 1) {
    const text = await results.nth(i).innerText();
    if (r.zip && text.includes(digits(r.zip))) { chosen = i; break; }
  }
  if (chosen < 0) {
    if (n === 1) chosen = 0;
    else throw new Error(`주소 검색 결과에서 우편번호 ${r.zip || "(없음)"}를 찾지 못했습니다: ${query}`);
  }
  if (process.env.SUPPLIER_ORDER_DEBUG) console.log("postcode result html:", (await results.nth(chosen).evaluate((el) => el.innerHTML)).replace(/\s+/g, " ").slice(0, 2500));
  // 결과 안의 '영문보기'·'지도' 링크가 아니라 도로명 주소 글자를 눌러야 선택된다.
  const item = results.nth(chosen);
  const modalOpen = async () => (await page.locator(".ReactModal__Overlay--after-open").count()) > 0;
  const attempts = [
    // 2026-11-25 확인: 마우스 클릭은 선택이 안 되고 Enter 로 선택된다.
    ["enter", () => item.locator(".main_road button.link_post").first().press("Enter")],
    ["click", () => item.locator(".main_road button.link_post").first().click()],
    ["dispatch", () => item.locator(".main_road button.link_post").first().dispatchEvent("click")],
    ["zip", () => item.locator(".txt_postcode").first().click()],
    ["mouse", async () => { const b = await item.locator(".main_road .txt_addr").first().boundingBox(); if (b) await page.mouse.click(b.x + 20, b.y + b.height / 2); }]
  ];
  for (const [how, run] of attempts) {
    await run().catch((e) => { if (process.env.SUPPLIER_ORDER_DEBUG) console.log("addr pick", how, "error", e.message.split("\n")[0]); });
    await page.waitForTimeout(1500);
    if (!(await modalOpen())) { if (process.env.SUPPLIER_ORDER_DEBUG) console.log("addr pick ok via", how); break; }
  }
  await shot("after-address");
  if (await modalOpen()) throw new Error("주소 검색 결과를 선택하지 못했습니다.");
  await page.locator('input[name="addr2"]').fill(String(r.addr2 || "").trim());
  if (r.memo) await fillMemo(page, r.memo);
  await shot("receiver");
  void section;
}

async function waitPostcodeFrame(page) {
  for (let i = 0; i < 20; i += 1) {
    const f = page.frames().find((fr) => /postcode|daum|kakao/i.test(fr.url()));
    if (f) {
      // 다음 우편번호는 바깥 틀 안에 검색 틀이 또 있다.
      const inner = page.frames().find((fr) => /postcode\.map\.daum|search\.daum|t1\.daumcdn/i.test(fr.url()) && fr !== f) || f;
      return inner;
    }
    await page.waitForTimeout(500);
  }
  throw new Error("주소 검색 창이 열리지 않았습니다.");
}

async function fillMemo(page, memo) {
  const select = page.locator("select").filter({ has: page.locator("option", { hasText: "배송메모" }) }).first();
  if (!(await select.count())) return;
  const options = await select.locator("option").allInnerTexts();
  const direct = options.find((o) => /직접/.test(o));
  if (!direct) return;
  await select.selectOption({ label: direct });
  const box = page.locator("textarea:visible, input[placeholder*='메모']:visible").first();
  if (await box.count()) await box.fill(String(memo).slice(0, 50));
}

async function agreeTerms(page) {
  const label = page.locator("label").filter({ hasText: /구매조건\s*확인\s*및\s*결제진행\s*동의/ }).first();
  const box = label.locator("input[type=checkbox]");
  if (await box.count()) { if (!(await box.isChecked())) await label.click(); return; }
  const any = page.locator("text=/구매조건 확인 및 결제진행 동의/").first();
  if (await any.count()) await any.click();
}

async function readSummary(page) {
  const box = page.locator("section, div").filter({ hasText: /^주문 요약/ }).first();
  const text = (await box.count()) ? await box.innerText() : await page.locator("body").innerText();
  const pick = (re) => won((text.match(re) || [])[1]);
  const pay = page.locator("button, a").filter({ hasText: /^\s*결제하기\s*$/ }).last();
  const payDisabled = await pay.evaluate((el) => el.disabled || el.getAttribute("aria-disabled") === "true" || /disabled/.test(el.className)).catch(() => null);
  return {
    payDisabled,
    itemsAmount: pick(/상품가격\s*([\d,]+)/),
    shippingFee: pick(/배송비\s*\+?\s*([\d,]+)/),
    total: pick(/총\s*주문금액\s*([\d,]+)/)
  };
}

async function readReceiver(page) {
  const name = await page.locator('input[name="name"]').inputValue().catch(() => "");
  const phone = await page.locator('input[name="call"]').inputValue().catch(() => "");
  const addr1 = await page.locator('input[name="addr1"]').inputValue().catch(() => "");
  const addr2 = await page.locator('input[name="addr2"]').inputValue().catch(() => "");
  return { name, phone, addr1, addr2 };
}
