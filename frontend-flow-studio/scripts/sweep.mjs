// v1.3 全局巡检:小屏(1440×860)× 各场景 × 各停靠点 × 逐圆圈弹窗,收集运行时错误
import puppeteer from "puppeteer-core";

const BASE = process.env.BASE ?? "http://localhost:5180";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox"],
  defaultViewport: { width: 1440, height: 860 },
});
const page = await browser.newPage();
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text());
});
page.on("pageerror", (e) => errors.push(e.message));

const plan = { A: [0, 2, 4, 5, 7], B: [2, 4, 8, 9, 11], C: [2, 4, 8, 9, 11], D: [2, 4, 5, 7, 12] };
let checks = 0;
for (const sid of Object.keys(plan)) {
  for (const stop of plan[sid]) {
    await page.goto(`${BASE}/?scenario=${sid}&stop=${stop}`, { waitUntil: "domcontentloaded" });
    await sleep(450);
    for (let c = 1; c <= 7; c++) {
      const el = await page.$(`[data-testid="circle-${c}"]`);
      if (el) {
        await el.click().catch(() => {});
        await sleep(320);
        checks++;
        await page.keyboard.press("Escape");
        await sleep(100);
      }
    }
  }
}
console.log("巡检交互次数:", checks, "| 运行时错误:", errors.length ? JSON.stringify(errors.slice(0, 5)) : "无");
await browser.close();
