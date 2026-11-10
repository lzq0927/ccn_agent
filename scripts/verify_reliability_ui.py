"""Browser acceptance against a running local API + frontend; uses synthetic data."""

import argparse
import os
import uuid
from pathlib import Path

from playwright.sync_api import expect, sync_playwright


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default="http://127.0.0.1:5173")
    parser.add_argument("--output", type=Path, default=Path("storage/reliability-ui"))
    parser.add_argument("--with-agent", action="store_true", help="同时验证实际 OpenCode 会话同步")
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(
            executable_path=os.getenv("CHROMIUM_BIN"), headless=True,
        )
        page = browser.new_page(viewport={"width": 1440, "height": 1100},
                                timezone_id="Asia/Shanghai")
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(args.url, wait_until="networkidle")
        name = "验收方案 " + uuid.uuid4().hex[:8]
        page.get_by_label("方案名称", exact=True).fill(name)
        page.get_by_role("button", name="运行对照仿真", exact=True).click()
        expect(page.get_by_text("对照仿真已完成", exact=True)).to_be_visible(timeout=30000)
        expect(page.get_by_text("全部样本末端持续达标", exact=True)).to_be_visible()
        page.get_by_role("button", name="按原输入重放", exact=True).click()
        expect(page.get_by_text("重放完成：结果摘要一致", exact=True)).to_be_visible(timeout=30000)
        with page.expect_download() as info:
            page.get_by_role("link", name="下载报告", exact=True).click()
        report = args.output / "report.md"
        info.value.save_as(report)
        assert '"to_ne_id": "UPF_2"' in report.read_text()
        if args.with_agent:
            page.get_by_role("button", name="交给 OpenCode 协作", exact=True).click()
            expect(page.get_by_role("link", name="打开方案的 OpenCode 会话 ↗", exact=True)).to_be_visible(
                timeout=130000)
        page.reload(wait_until="networkidle")
        option = page.get_by_label("打开已保存方案").get_by_role("option").filter(has_text=name)
        design_id = option.get_attribute("value")
        page.get_by_label("打开已保存方案").select_option(design_id)
        expect(page.get_by_label("历史实验").get_by_role("option")).to_have_count(3)
        page.get_by_label("历史实验").select_option(index=1)
        expect(page.get_by_text("全部样本末端持续达标", exact=True)).to_be_visible()
        page.screenshot(path=str(args.output / "desktop.png"), full_page=True)
        page.set_viewport_size({"width": 390, "height": 844})
        assert not page.evaluate("document.documentElement.scrollWidth > window.innerWidth")
        assert page.get_by_role("button", name="可靠性工作台", exact=True).bounding_box()["height"] < 60
        page.screenshot(path=str(args.output / "mobile.png"), full_page=True)
        # Invalid parameter errors must remain visible and must not start an experiment.
        page.get_by_text("实验参数", exact=True).click()
        page.get_by_label("随机种子", exact=True).fill("42, 42")
        page.get_by_role("button", name="运行对照仿真", exact=True).click()
        expect(page.get_by_role("alert")).to_contain_text("种子必须互不重复")
        assert not errors, errors
        browser.close()
    print("PASS: 保存、仿真、重放、报告、刷新恢复、参数错误、桌面与移动布局")


if __name__ == "__main__":
    main()
