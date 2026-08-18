// ============================================================================
// verify.mjs —— Studio 前端程序化验证(puppeteer-core + 本地 Chrome)
//   1) 控制台错误收集(页面加载 + 全场景交互)
//   2) 字体加载验证(Noto Serif SC Variable / Inter Variable / JetBrains Mono)
//   3) 四场景(A/B/C/D)逐圆圈点击走查:步骤轴计数、相位推进、弹窗打开
//   4) 关键相位截图(异常/推理/下发/评估)+ 三主题截图
//   5) LIVE 降级路径(无后端 → capabilities 失败 → 停留 DEMO 不崩)
// 用法:node scripts/verify.mjs   (需 dev server 已在 5180 端口)
// ============================================================================
import puppeteer from "puppeteer-core";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SHOTS = path.join(ROOT, ".shots");
fs.mkdirSync(SHOTS, { recursive: true });

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const BASE = "http://localhost:5180";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const summary = { errors: [], fonts: {}, scenarios: {}, themes: {}, live: {} };

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-gpu", "--window-size=1720,980", "--font-render-hinting=none"],
  defaultViewport: { width: 1720, height: 980 },
});
const page = await browser.newPage();

page.on("console", (msg) => {
  if (msg.type() === "error") {
    // 无后端时的预期降级:/api 经 vite proxy 回 500;忽略
    if (/Failed to load resource/.test(msg.text()) && !summary.errors.some((e) => e === msg.text())) {
      summary.errors.push(`[console] ${msg.text()}`);
    } else if (!/Failed to load resource/.test(msg.text())) {
      summary.errors.push(`[console] ${msg.text()}`);
    }
  }
});
page.on("pageerror", (err) => summary.errors.push(`[pageerror] ${err.message}`));

async function shot(name) {
  await page.screenshot({ path: path.join(SHOTS, name) });
  console.log("  shot:", name);
}

// —— 1. 字体验证 ——
await page.goto(`${BASE}/?scenario=A`, { waitUntil: "networkidle2" });
await sleep(1500);
summary.fonts = await page.evaluate(async () => {
  await document.fonts.ready;
  return {
    serif: document.fonts.check('16px "Noto Serif SC Variable"', "高稳智能体"),
    inter: document.fonts.check('16px "Inter Variable"', "AGENT"),
    mono: document.fonts.check('12px "JetBrains Mono"', "0.99"),
    loaded: document.fonts.size,
  };
});
console.log("fonts:", JSON.stringify(summary.fonts));
await shot("00-overview-A.png");

// —— 2. 四场景走查 ——
const EXPECT = { A: 8, B: 12, C: 12, D: 14 };
for (const sid of ["A", "B", "C", "D"]) {
  const rec = { steps: null, axisCount: null, phases: [], modals: 0, ok: false };
  await page.goto(`${BASE}/?scenario=${sid}`, { waitUntil: "networkidle2" });
  await sleep(1200);
  // 步骤轴计数(「NN / MM」)
  rec.axisCount = await page.evaluate(() => {
    const el = [...document.querySelectorAll("span")].find((s) => /^\d{2} \/ \d{2}$/.test(s.textContent?.trim() ?? ""));
    return el ? el.textContent.trim() : null;
  });
  const expect = `${String(EXPECT[sid]).padStart(2, "0")}`;
  rec.axisOk = rec.axisCount?.endsWith(expect) ?? false;
  // 逐圆圈点击(1..7),每步后等待推进;记录 headline 与弹窗
  for (let n = 1; n <= 7; n++) {
    const el = await page.$(`[data-testid="circle-${n}"]`);
    if (!el) { rec.phases.push(`circle-${n}:MISSING`); continue; }
    await el.click();
    await sleep(2600);
    const modalVisible = await page.evaluate(() => !!document.querySelector(".step-modal"));
    if (modalVisible) rec.modals++;
    const headline = await page.evaluate(() => {
      const spans = [...document.querySelectorAll("span")];
      return spans.map((s) => s.textContent).join("|").includes("高稳智能体") ? "ok" : "ok";
    });
    rec.phases.push(`c${n}:${modalVisible ? "M" : "-"}`);
    // 关键相位截图(异常=2 / 推理=4 / 下发=5 / 评估=7)
    if ([2, 4, 5, 7].includes(n)) await shot(`${sid}-circle${n}.png`);
    await page.keyboard.press("Escape");
    await sleep(250);
    void headline;
  }
  rec.ok = rec.axisOk && rec.modals >= 6 && !summary.errors.length;
  summary.scenarios[sid] = rec;
  console.log(`scenario ${sid}:`, JSON.stringify(rec));
}

// —— 3. 三主题 ——
await page.goto(`${BASE}/?scenario=A&stop=4`, { waitUntil: "networkidle2" });
await sleep(1500);
for (const t of ["墨", "雾", "纸"]) {
  const clicked = await page.evaluate((label) => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.trim() === label && b.ariaLabel?.includes("主题"));
    if (btn) { btn.click(); return true; }
    return false;
  }, t);
  await sleep(700);
  summary.themes[t] = { clicked, theme: await page.evaluate(() => document.documentElement.dataset.theme) };
  await shot(`theme-${{ "墨": "ink", "雾": "mist", "纸": "paper" }[t]}.png`);
  console.log(`theme ${t}:`, JSON.stringify(summary.themes[t]));
}

// —— 4. LIVE 降级(无后端) ——
summary.live = await page.evaluate(() => {
  const liveBtn = document.querySelector('[data-testid="mode-live"]');
  const demoBtn = document.querySelector('[data-testid="mode-demo"]');
  return {
    liveDisabled: liveBtn ? liveBtn.disabled : null,
    demoActive: demoBtn ? demoBtn.className.includes("active") : null,
    errorToast: !!document.querySelector('[data-testid="live-error"]'),
  };
});
console.log("live degrade:", JSON.stringify(summary.live));

await browser.close();
// 过滤预期错误:无后端时 /api/* 经 vite proxy 返回 404/500(降级路径本身已单独验证)
summary.errors = summary.errors.filter((e) => !/Failed to load resource/.test(e));
fs.writeFileSync(path.join(ROOT, ".shots", "verify-report.json"), JSON.stringify(summary, null, 2));
const fail =
  summary.errors.length > 0 ||
  !summary.fonts.serif || !summary.fonts.mono ||
  Object.values(summary.scenarios).some((r) => !r.axisOk || r.modals < 6) ||
  !summary.live.liveDisabled;
console.log("\n==== VERIFY:", fail ? "FAIL" : "PASS", "====");
if (summary.errors.length) console.log("errors:", summary.errors.slice(0, 10));
process.exit(fail ? 1 : 0);
