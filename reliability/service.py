"""Application boundary shared by HTTP and MCP."""

import json

from reliability.models import Design
from reliability.solver import digest, freeze_input, solve, validate_design
from reliability.store import ConflictError, Store


class ReliabilityService:
    def __init__(self, store: Store | None = None):
        self.store = store or Store()

    def create_design(self, design: Design) -> dict:
        validate_design(design)
        return self.store.create_design(design)

    def update_design(self, design_id: str, design: Design, expected_revision: int) -> dict:
        validate_design(design)
        return self.store.update_design(design_id, design, expected_revision)

    def current(self, design_id: str, expected_revision: int) -> dict:
        item = self.store.get_design(design_id)
        if item["revision"] != expected_revision:
            raise ConflictError("方案版本冲突，请重新读取后评估")
        return item

    def run(self, design_id: str, expected_revision: int) -> dict:
        item = self.current(design_id, expected_revision)
        frozen = freeze_input(Design.model_validate(item["design"]))
        result = solve(frozen)
        return self.store.save_run(design_id, expected_revision, frozen, result)

    def replay(self, run_id: str) -> dict:
        source = self.store.get_run(run_id)
        if source["input_hash"] != digest(source["input"]):
            raise ValueError("原实验输入摘要不匹配，不能重放")
        result = solve(source["input"])
        return self.store.save_run(source["design_id"], source["design_revision"],
                                   source["input"], result, source_run_id=run_id)

    def report(self, run_id: str) -> str:
        run = self.store.get_run(run_id)
        result = run["result"]
        design = run["input"]["design"]
        lines = ["# ReMAP · AI 系统可靠性机制仿真报告", "",
                 f"方案：{design['name']} · 修订 {run['design_revision']}",
                 f"实验：{run_id} · 场景：{design['scenario_id']} · 种子：{design['seeds']}",
                 f"结论：{result['conclusion']}（合成仿真证据）", "",
                 "| 指标 | 无机制基线 | 候选机制 |", "| --- | ---: | ---: |"]
        for label, key in (("注册成功率", "registration_success_rate"),
                           ("PDU 成功率", "pdu_success_rate"),
                           ("最大核心 CPU (%)", "max_core_cpu"),
                           ("末窗准入拒绝数", "admission_rejects"),
                           ("末窗退避数", "backoff_rejects"),
                           ("末端持续达标种子比例", "final_target_met_fraction")):
            lines.append(f"| {label} | {result['summary']['baseline'][key]:.4f} | "
                         f"{result['summary']['candidate'][key]:.4f} |")
        lines += ["", "| 种子 | 基线持续恢复确认时间(s) | 候选持续恢复确认时间(s) |",
                  "| --- | ---: | ---: |"]
        for trial in result["trials"]:
            values = [str(trial[b]["recovery_time"]) if trial[b]["recovery_time"] is not None
                      else "未恢复" for b in ("baseline", "candidate")]
            lines.append(f"| {trial['seed']} | {values[0]} | {values[1]} |")
        lines += ["", "## 实验输入", "", "```json",
                  json.dumps(design, ensure_ascii=False, indent=2), "```", "",
                  f"输入 SHA-256：{run['input_hash']}",
                  f"结果 SHA-256：{run['result_hash']}",
                  f"引擎版本：{run['input']['engine_revision']}",
                  f"知识版本：{run['input']['knowledge']['version']}", "",
                  f"运行环境：{json.dumps(run['input']['runtime'], ensure_ascii=False)}", "",
                  *[f"- {warning}" for warning in result["warnings"]], "",
                  run["input"]["methodology"]]
        return "\n".join(lines)
