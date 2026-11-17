import { test, expect } from "@playwright/test";
import fs from "node:fs/promises";

test("complete evidence workflow, playback and report download", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "SMF:smf_2 后端部分链路丢包",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText("已定位故障", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "查看网元 SMF:smf_2", exact: true }),
  ).toHaveCount(1);
  await page.screenshot({
    path: "../docs/artifacts/overview-desktop.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  await expect(page.getByText("当前案例未调用慢推理 Agent")).toBeVisible();
  await page.getByRole("tab", { name: "感知与降噪", exact: true }).click();
  const before = await page.getByLabel("选择时序维度").inputValue();
  const options = page.getByLabel("选择时序维度").locator("option");
  const alternative = await options.last().getAttribute("value");
  await page.getByLabel("选择时序维度").selectOption(alternative!);
  expect(await page.getByLabel("选择时序维度").inputValue()).not.toBe(before);
  await expect(page.getByRole("heading", { name: "降噪证据" })).toBeVisible();
  await page.getByRole("tab", { name: "关联分析", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "六维聚集性证据" }),
  ).toBeVisible();
  await expect(page.getByText("POD", { exact: true })).toBeVisible();
  await page.screenshot({
    path: "../docs/artifacts/analysis-desktop.png",
    fullPage: true,
  });
  const user = await page.locator(".table-link").first().innerText();
  await page.getByLabel("搜索用户路径").fill(user);
  await expect(page.locator("tbody tr").first()).toContainText(user);
  await page.locator(".table-link").first().click();
  await expect(page.locator(".flow-expanded")).toBeVisible();
  await page.getByLabel("搜索用户路径").fill("no-user-matches");
  await expect(page.getByText("没有匹配的用户路径")).toBeVisible();
  await page.getByRole("tab", { name: "图谱推理", exact: true }).click();
  await expect(page.getByText("唯一充分匹配", { exact: true })).toBeVisible();
  await page.getByLabel("选择知识图谱原因码").selectOption("5GSM:27");
  await expect(
    page.locator(".card-footnote").filter({ hasText: "3GPP 标准原因码" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "决策交接", exact: true }).click();
  const handoffDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "下载交接 JSON" }).click();
  const file = await handoffDownload;
  const content = JSON.parse(await fs.readFile((await file.path())!, "utf8"));
  expect(content.delivered).toBe(false);
  expect(content.conclusion.nf).toBe("SMF:smf_2");
  await page.getByRole("button", { name: "导出报告" }).click();
  const reportDownload = page.waitForEvent("download");
  await page.getByRole("link", { name: "分析报告 · Markdown" }).click();
  const report = await reportDownload;
  expect(await fs.readFile((await report.path())!, "utf8")).toContain(
    "SMF:smf_2",
  );
  await page.getByRole("tab", { name: "故障概览", exact: true }).click();
  await page.getByRole("slider", { name: "回放分钟" }).fill("23");
  await expect(
    page.getByRole("heading", { name: "检测到突增，等待持续性确认" }),
  ).toBeVisible();
  await expect(page.locator(".summary-banner")).toContainText("3/5");
  await page.getByRole("button", { name: "下一分钟" }).click();
  await expect(
    page.getByRole("heading", {
      name: "SMF:smf_2 后端部分链路丢包",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("slider", { name: "回放分钟" }).fill("40");
  await expect(page.locator(".current-time")).toContainText("40");
  await expect(page.getByText("已定位故障", { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test("normal simulation and responsive navigation", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("已定位故障", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "仿真实验", exact: true }).click();
  await page.getByLabel("实验场景").selectOption("normal");
  await page.getByLabel("随机种子").fill("42");
  await page.getByRole("button", { name: "生成并分析", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "当前窗口未确认持续异常" }),
  ).toBeVisible();
  await page.getByRole("slider", { name: "回放分钟" }).fill("40");
  await expect(page.locator(".current-time")).toContainText("40");
  await expect(
    page.getByRole("heading", { name: "当前窗口未确认持续异常" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "数据源", exact: false }).click();
  await page.getByRole("button", { name: "重新加载 CSV", exact: true }).click();
  await expect(page.getByText("已定位故障", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("tab", { name: "故障概览", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "../docs/artifacts/overview-mobile.png",
    fullPage: true,
  });
  await page.getByRole("tab", { name: "关联分析", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "六维聚集性证据" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
