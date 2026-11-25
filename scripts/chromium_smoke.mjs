// node scripts/chromium_smoke.mjs — 서버(도커) 안에서 자동 주문용 크롬이 뜨는지 확인한다(공급사 사이트 접속 없음).
import { loadChromium, chromiumPath } from "../lib/supplier-order-imweb.mjs";

const chromium = await loadChromium();
const browser = await chromium.launch({ executablePath: chromiumPath(), headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage();
await page.setContent("<html><body><h1>우프 크롬 확인</h1></body></html>");
const text = await page.locator("h1").innerText();
await browser.close();
if (text !== "우프 크롬 확인") throw new Error(`unexpected: ${text}`);
console.log(`chromium smoke OK (${chromiumPath()})`);
