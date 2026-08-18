// ============================================================================
// live-walk.mjs —— LIVE 真实走查(文本转储版)
//   切 LIVE → ②③④⑤⑦ 逐圆圈点击,转储弹窗 innerText + 等待真实事件驱动内容。
//   用途:验证 LIVE 面板呈现真实数据(chr_insight/homogen/规划器策略/实时评估)。
// 用法:node scripts/live-walk.mjs [scenarioId]   (需后端 8000 + dev 5180)
// ============================================================================
import puppeteer from "puppeteer-core";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = process.env.BASE ?? "http://localhost:5180";
const SID = process.argv[2] ?? "A";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--window-size=1720,980"],
  defaultViewport: { width: 1720, height: 980 },
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("console", (m) => { if (m.text().startsWith("[ws]")) console.log(m.text()); });

// WS 钩子:记录浏览器实际收到的 live 事件类型(诊断前端断点)
await page.evaluateOnNewDocument(() => {
  window.__wsEvents = [];
  const OrigWS = window.WebSocket;
  window.WebSocket = class extends OrigWS {
    constructor(url, ...rest) {
      super(url, ...rest);
      if (String(url).includes("/ws/live")) {
        this.addEventListener("message", (e) => {
          try {
            const ev = JSON.parse(e.data);
            window.__wsEvents.push(`${ev.type}${ev.type === "error" ? ":" + (ev.payload?.message ?? "") : ""}`);
          } catch { /* ignore */ }
        });
      }
    }
  };
});

await page.goto(`${BASE}/?scenario=${SID}`, { waitUntil: "networkidle2" });
await sleep(1500);

const modalText = () =>
  page.evaluate(() => {
    const m = document.querySelector(".step-modal") ?? document.body;
    return (m.innerText || "").replace(/\n{2,}/g, "\n").slice(0, 1200);
  });
const clickCircle = async (n) => {
  const el = await page.$(`[data-testid="circle-${n}"]`);
  if (!el) { console.log(`circle-${n} MISSING`); return; }
  await el.click();
};

console.log("== switch to LIVE ==");
await (await page.$('[data-testid="mode-live"]')).click();
await sleep(3000);

console.log("\n== ② 异常检测 ==");
await clickCircle(2);
await sleep(7000);
console.log(await modalText());
await page.keyboard.press("Escape"); await sleep(300);

console.log("\n== ③ 策略匹配 ==");
await clickCircle(3);
await sleep(3500);
console.log(await modalText());
await page.keyboard.press("Escape"); await sleep(300);

console.log("\n== ④ 根因推理(等真 LLM,最长 300s)==");
await clickCircle(4);
const t0 = Date.now();
let txt = "";
while (Date.now() - t0 < 300_000) {
  await sleep(8000);
  txt = await modalText();
  // 真实推理链 conclusion 步到达(#n 结论行)或 diagnosis 完成后 reasoning 停止增长
  if (/#(\d+)(?![\s\S]*#(\d+))/.test(txt) && /根因|业务激增|离群/.test(txt) && Date.now() - t0 > 30_000) break;
}
console.log(`(${Math.round((Date.now() - t0) / 1000)}s)`);
console.log(txt);
await page.keyboard.press("Escape"); await sleep(300);

console.log("\n== ⑤ 下发策略 ==");
await clickCircle(5);
await sleep(7000);
console.log(await modalText());
await page.keyboard.press("Escape"); await sleep(300);

console.log("\n== ⑦ 评估优化 ==");
await clickCircle(7);
await sleep(18000);
console.log(await modalText());

const wsEvents = await page.evaluate(() => window.__wsEvents ?? []);
const seen = new Map();
for (const t of wsEvents) seen.set(t, (seen.get(t) ?? 0) + 1);
console.log("\n== WS received ==");
console.log(JSON.stringify([...seen.entries()]));

await browser.close();
console.log("\n== walk done ==");
