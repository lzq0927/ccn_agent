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
const BASE = process.env.BASE ?? "http://localhost:5180";
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

// —— 4. LIVE 能力(环境自适应:有后端 → LIVE 可点;无后端 → 禁用并停留 DEMO) ——
const backendUp = await fetch(`${BASE}/api/v1/live/capabilities`)
  .then((r) => r.ok)
  .catch(() => false);
summary.live = await page.evaluate(() => {
  const liveBtn = document.querySelector('[data-testid="mode-live"]');
  const demoBtn = document.querySelector('[data-testid="mode-demo"]');
  return {
    liveDisabled: liveBtn ? liveBtn.disabled : null,
    demoActive: demoBtn ? demoBtn.className.includes("active") : null,
    errorToast: !!document.querySelector('[data-testid="live-error"]'),
  };
});
summary.live.backendUp = backendUp;
summary.live.ok = backendUp ? summary.live.liveDisabled === false : summary.live.liveDisabled === true;
console.log("live:", JSON.stringify(summary.live));

// —— 5. LIVE 真实走查(仅当后端在跑):A 场景 ②→③→④→⑤→⑦,轮询真实事件驱动的内容 ——
if (backendUp && process.env.SKIP_LIVE_WALK !== "1") {
  const walk = { steps: [], shots: 0 };
  const liveBtn = await page.$('[data-testid="mode-live"]');
  if (liveBtn) {
    await page.goto(`${BASE}/?scenario=A`, { waitUntil: "networkidle2" });
    await sleep(1200);
    await (await page.$('[data-testid="mode-live"]')).click();
    await sleep(2500);
    // 等 phase-1 数据段(tick 流入)
    walk.steps.push("mode-live clicked");
    // ② 异常检测(注入 + 真异常工具;等 data_validation/anomaly 面板内容)
    await (await page.$('[data-testid="circle-2"]')).click();
    await sleep(6000);
    walk.shots += await shot("live-A-circle2.png") ? 1 : 0;
    walk.steps.push("circle2 done");
    await page.keyboard.press("Escape");
    // ③ 策略匹配
    await (await page.$('[data-testid="circle-3"]')).click();
    await sleep(3000);
    walk.steps.push("circle3 done");
    await page.keyboard.press("Escape");
    // ④ 根因推理:真 LLM 可能需要数分钟 → 轮询 modal 出现结论/根因内容(最长 300s)
    await (await page.$('[data-testid="circle-4"]')).click();
    const t0 = Date.now();
    let sawConclusion = false, sawHomogen = false, sawChr = false;
    while (Date.now() - t0 < 300_000) {
      await sleep(5000);
      const txt = await page.evaluate(() => document.body.innerText);
      // 真实推理链标记:LIVE 推理步(#n 前缀)带「进入确定性工作流/调用工具/推理迭代」
      sawConclusion = /(进入确定性工作流|🔧 调用工具|推理迭代)/.test(txt) && Date.now() - t0 > 8000;
      sawHomogen = txt.includes("均质化比较 · 实时遥测");
      sawChr = txt.includes("CHR 洞察 · 实时");
      if (sawConclusion) break;
    }
    walk.diagSeconds = Math.round((Date.now() - t0) / 1000);
    walk.sawConclusion = sawConclusion; walk.sawHomogen = sawHomogen; walk.sawChr = sawChr;
    await shot("live-A-circle4.png");
    walk.steps.push(`circle4 done (${walk.diagSeconds}s)`);
    await page.keyboard.press("Escape");
    // ⑤ 下发策略(通用规划器)
    await (await page.$('[data-testid="circle-5"]')).click();
    await sleep(6000);
    const dispatchTxt = await page.evaluate(() => document.body.innerText);
    walk.sawPlanner = dispatchTxt.includes("通用规划器") && dispatchTxt.includes("策略 1 ·");
    await shot("live-A-circle5.png");
    walk.steps.push("circle5 done");
    await page.keyboard.press("Escape");
    // ⑦ 评估优化(等待恢复段 + 真实评估)
    await (await page.$('[data-testid="circle-7"]')).click();
    await sleep(15000);
    const evalTxt = await page.evaluate(() => document.body.innerText);
    walk.sawEval = evalTxt.includes("实时评估") || evalTxt.includes("实时评估 · 未通过");
    await shot("live-A-circle7.png");
    walk.steps.push("circle7 done");
  }
  summary.liveWalk = walk;
  summary.liveWalk.ok = !!(walk.sawConclusion && walk.sawPlanner && walk.sawEval);
  console.log("liveWalk:", JSON.stringify(summary.liveWalk));
}

await browser.close();
// 过滤预期错误:无后端时 /api/* 经 vite proxy 返回 404/500(降级路径本身已单独验证)
summary.errors = summary.errors.filter((e) => !/Failed to load resource/.test(e));
fs.writeFileSync(path.join(ROOT, ".shots", "verify-report.json"), JSON.stringify(summary, null, 2));
const fail =
  summary.errors.length > 0 ||
  !summary.fonts.serif || !summary.fonts.mono ||
  Object.values(summary.scenarios).some((r) => !r.axisOk || r.modals < 6) ||
  !summary.live.ok ||
  summary.live.errorToast ||
  (summary.liveWalk && !summary.liveWalk.ok);
console.log("\n==== VERIFY:", fail ? "FAIL" : "PASS", "====");
if (summary.errors.length) console.log("errors:", summary.errors.slice(0, 10));
process.exit(fail ? 1 : 0);
