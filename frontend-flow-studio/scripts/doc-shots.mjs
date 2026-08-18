// 文档截图生成:深链直达相位 → 点圆圈开弹窗 → 截图(保证每张都在正确相位)
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(__dirname, "..", ".shots");
fs.mkdirSync(SHOTS, { recursive: true });

const BASE = process.env.BASE ?? "http://localhost:5180";
const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--font-render-hinting=none"],
  defaultViewport: { width: 1720, height: 980 },
});
const page = await browser.newPage();

/** 深链到某停靠点 → 点圆圈 → 等弹窗内容展开 → 截图 */
async function shotAt(name, sid, stop, circle) {
  await page.goto(`${BASE}/?scenario=${sid}&stop=${stop}`, { waitUntil: "networkidle2" });
  await sleep(900);
  if (circle != null) {
    await page.click(`[data-testid="circle-${circle}"]`);
    await sleep(1800); // 等推理链揭示/图表展开
  }
  await page.screenshot({ path: path.join(SHOTS, name) });
  console.log("shot:", name);
}

await shotAt("overview-A.png", "A", 0, null);
await shotAt("A-anomaly.png", "A", 2, 2);
await shotAt("A-reasoning.png", "A", 4, 4);
await shotAt("A-dispatch.png", "A", 5, 5);
await shotAt("A-eval.png", "A", 7, 7);
await shotAt("B-r1-reasoning.png", "B", 4, 4);   // 第一轮:仅大致分布 · 未定位
await shotAt("B-r2-reasoning.png", "B", 8, 4);   // 第二轮:补采后前后对比 → 锁定 SMF_1
await shotAt("B-eval.png", "B", 11, 7);
await shotAt("C-reasoning.png", "C", 8, 4);
await shotAt("D-anomaly.png", "D", 2, 2);
await shotAt("D-reasoning.png", "D", 4, 4);
await shotAt("D-dispatch.png", "D", 5, 5);

// 三主题(相位4 + 弹窗打开)
await page.goto(`${BASE}/?scenario=A&stop=4`, { waitUntil: "networkidle2" });
await sleep(900);
await page.click('[data-testid="circle-4"]');
await sleep(1500);
for (const [label, file] of [["墨", "theme-ink"], ["雾", "theme-mist"], ["纸", "theme-paper"]]) {
  await page.evaluate((l) => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === l && b.ariaLabel?.includes("主题"));
    if (btn) btn.click();
  }, label);
  await sleep(700);
  await page.screenshot({ path: path.join(SHOTS, `${file}.png`) });
  console.log("shot:", `${file}.png`);
}

await browser.close();
console.log("done");
