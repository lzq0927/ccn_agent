"""LiveDataRecorder: 把 LIVE 模式的全部仿真/诊断/恢复/评估数据落盘。

每个 session 一个目录:``{base_dir}/live_sessions/{session_id}/``

文件清单:
  session_meta.json  — session 元数据(场景/轮数/状态)
  topo.txt           — 拓扑(plugin.build_topology,与 storage/cases 同格式)
  process.txt        — 业务流模板
  data.csv           — KPI 时序(宽表,每 tick 一行,Excel 友好)
  chr.jsonl          — CHR 记录(每行一条)
  alarms.jsonl       — 告警(每行一条)
  reasoning.jsonl    — 推理步骤(每行一条)
  recovery.json      — 恢复动作列表
  evaluation.json    — 评估报告
  events.jsonl       — 全部 WS 事件流水(最完整,断线重连回放也用它)

设计:所有方法吞异常(LIVE 运行不能因落盘失败而中断)。
"""
from __future__ import annotations

import csv
import io
import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)

_KPI_COLUMNS = [
    "sim_t", "round",
    "amf_cpu", "smf_cpu",
    "iot_reg_rate", "toc_reg_rate", "iot_sess_rate", "toc_sess_rate",
    "amf_success_rate", "smf_success_rate",
]


class LiveDataRecorder:
    """单 session 的数据落盘记录器(非线程安全,由 LiveRunner 单任务驱动)。"""

    def __init__(self, session_id: str, scenario_id: str, base_dir: str = "./storage"):
        self.session_id = session_id
        self.scenario_id = scenario_id
        self.dir = Path(base_dir) / "live_sessions" / session_id
        self.dir.mkdir(parents=True, exist_ok=True)
        self._kpi_rows: list[dict] = []
        self._kpi_columns: list[str] | None = None  # 首个 kpi_snapshot 决定(动态适配各场景 KPI 形态)
        self._recovery_actions: list[dict] = []
        self._meta: dict[str, Any] = {
            "session_id": session_id,
            "scenario_id": scenario_id,
            "status": "running",
        }
        self._events_path = self.dir / "events.jsonl"
        self._chr_path = self.dir / "chr.jsonl"
        self._alarms_path = self.dir / "alarms.jsonl"
        self._reasoning_path = self.dir / "reasoning.jsonl"

    # ------------------------------------------------------------------
    # 生命周期
    # ------------------------------------------------------------------
    def begin(self, plugin: Any) -> None:
        self._meta["scenario_label"] = getattr(plugin, "label_cn", self.scenario_id)
        self._meta["expected_round"] = int(getattr(plugin, "expected_round", 1))
        try:
            topo = plugin.build_topology()
            if topo is not None:
                (self.dir / "topo.txt").write_text(_format_topology(topo), encoding="utf-8")
        except Exception:  # noqa: BLE001
            logger.exception("record topology failed")
        try:
            (self.dir / "process.txt").write_text(_format_process(self.scenario_id), encoding="utf-8")
        except Exception:  # noqa: BLE001
            logger.exception("record process failed")
        self._write_meta()

    def finalize(self, status: str) -> None:
        self._meta["status"] = status
        self._write_meta()
        self._flush_kpi_csv()
        self._flush_recovery_json()
        self._snapshot_to_replay_dir()

    def _snapshot_to_replay_dir(self) -> None:
        """把本 session 的全部数据复制到 ``live_replay/{scenario_id}/``(按场景留存,供回放)。

        最新一次完整运行覆盖该场景的回放目录;失败不影响主流程。
        """
        if not self.scenario_id:
            return
        try:
            import shutil

            replay_dir = Path(self.dir).parent.parent / "live_replay" / self.scenario_id
            replay_dir.mkdir(parents=True, exist_ok=True)
            for src in Path(self.dir).iterdir():
                dst = replay_dir / src.name
                try:
                    if src.is_file():
                        shutil.copy2(src, dst)
                except Exception:  # noqa: BLE001
                    logger.debug("copy %s failed", src)
            (replay_dir / "replay_source_session.txt").write_text(self.session_id, encoding="utf-8")
        except Exception:  # noqa: BLE001
            logger.exception("snapshot to replay dir failed")

    # ------------------------------------------------------------------
    # 逐项记录(全部吞异常)
    # ------------------------------------------------------------------
    def record_event(self, type_: str, payload: dict) -> None:
        self._append_jsonl(self._events_path, {"type": type_, "payload": payload})

    def record_tick(self, ctx: Any, events: list) -> None:
        for ev in events or []:
            etype = getattr(ev, "type", None)
            epayload = getattr(ev, "payload", None) or {}
            if etype == "kpi_snapshot":
                # 首个 snapshot 决定 CSV 列(不同场景 KPI 字段不同:F 流控 / G 级联)
                if self._kpi_columns is None and epayload:
                    self._kpi_columns = list(epayload.keys())
                self._kpi_rows.append(dict(epayload))
            elif etype == "chr_record":
                self._append_jsonl(self._chr_path, epayload)
            elif etype == "alarm":
                self._append_jsonl(self._alarms_path, epayload)
        # 每 10 tick 刷一次 csv(平衡 IO 频率与数据完整性)
        if self._kpi_rows and len(self._kpi_rows) % 10 == 0:
            self._flush_kpi_csv()

    def record_reasoning_step(self, payload: dict) -> None:
        self._append_jsonl(self._reasoning_path, payload)

    def record_recovery_action(self, action: Any, round_no: int) -> None:
        self._recovery_actions.append({
            "round": round_no,
            "id": getattr(action, "id", ""),
            "cn": getattr(action, "cn", ""),
            "en": getattr(action, "en", ""),
            "layer": getattr(action, "layer", None),
        })

    def record_evaluation(self, report: dict) -> None:
        try:
            (self.dir / "evaluation.json").write_text(
                json.dumps(report, ensure_ascii=False, indent=2, default=str), encoding="utf-8"
            )
        except Exception:  # noqa: BLE001
            logger.exception("record evaluation failed")

    # ------------------------------------------------------------------
    # 内部
    # ------------------------------------------------------------------
    def _write_meta(self) -> None:
        try:
            (self.dir / "session_meta.json").write_text(
                json.dumps(self._meta, ensure_ascii=False, indent=2, default=str), encoding="utf-8"
            )
        except Exception:  # noqa: BLE001
            logger.exception("write session_meta failed")

    def _flush_kpi_csv(self) -> None:
        if not self._kpi_rows:
            return
        columns = self._kpi_columns or _KPI_COLUMNS
        try:
            buf = io.StringIO()
            writer = csv.DictWriter(buf, fieldnames=columns)
            writer.writeheader()
            for row in self._kpi_rows:
                writer.writerow({k: row.get(k) for k in columns})
            (self.dir / "data.csv").write_text(buf.getvalue(), encoding="utf-8")
        except Exception:  # noqa: BLE001
            logger.exception("flush data.csv failed")

    def _flush_recovery_json(self) -> None:
        if not self._recovery_actions:
            return
        try:
            (self.dir / "recovery.json").write_text(
                json.dumps(self._recovery_actions, ensure_ascii=False, indent=2, default=str),
                encoding="utf-8",
            )
        except Exception:  # noqa: BLE001
            logger.exception("flush recovery.json failed")

    def _append_jsonl(self, path: Path, obj: dict) -> None:
        try:
            with open(path, "a", encoding="utf-8") as f:
                f.write(json.dumps(obj, ensure_ascii=False, default=str) + "\n")
        except Exception:  # noqa: BLE001
            logger.exception("append %s failed", path)


def _format_topology(topo: Any) -> str:
    """把 simulator.models.Topology 渲染成 topo.txt(与 storage/cases 同格式)。"""
    lines: list[str] = []
    for dc in getattr(topo, "dcs", []):
        lines.append(f"DC: {dc.id}")
        for pool in dc.pools:
            lines.append(f"  ResourcePool: {pool.id}")
            for ne in pool.elements:
                role_str = f"({ne.role})" if ne.role != "lb" else ""
                lines.append(f"    {ne.ne_type.value}: {ne.id}{role_str}")
    return "\n".join(lines)


def _format_process(scenario_id: str) -> str:
    """业务流模板。F 场景用流控溯源专用模板,其余用通用 PDU 建立。"""
    if scenario_id == "F":
        return (
            "Process: IOT_Registration_Storm\n"
            "Flow: UE -> gNB -> AMF -> SMF -> UPF -> SMF -> AMF -> gNB -> UE\n"
            "UE count: 380 (物联终端 320 + ToC 手机 60)\n"
            "# 风暴期物联终端反复上线;iPhone 不支持 back-off → 收到 Reg Reject 立即重试,放大风暴\n"
            "# 恢复策略: UE back-off + AMF 限 NSSAI + SMF 限 DNN(二轮排除 iPhone)\n"
        )
    return (
        "Process: PDU_Session_Establishment\n"
        "Flow: UE -> gNB -> AMF -> SMF -> UDM -> SMF -> PCF -> SMF -> UPF -> SMF -> AMF -> gNB -> UE\n"
    )
