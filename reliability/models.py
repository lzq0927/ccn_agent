"""Validated contracts shared by REST, MCP, and the offline solver."""

from __future__ import annotations

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class Isolate(Contract):
    kind: Literal["isolate"]
    ne_id: str = Field(min_length=1, max_length=80)


class Reroute(Contract):
    kind: Literal["reroute"]
    from_ne_id: str = Field(min_length=1, max_length=80)
    to_ne_id: str = Field(min_length=1, max_length=80)


class TrafficFilter(Contract):
    sst: int | None = Field(default=None, ge=1, le=255)
    dnn: str | None = Field(default=None, min_length=1, max_length=80)
    device_type: str | None = Field(default=None, min_length=1, max_length=80)


class FlowControl(Contract):
    kind: Literal["flow_control"]
    layer: Literal["UE", "AMF", "SMF"]
    ratio: float = Field(gt=0, le=0.95)
    flt: TrafficFilter = Field(default_factory=TrafficFilter)


Action = Annotated[Isolate | Reroute | FlowControl, Field(discriminator="kind")]


class Targets(Contract):
    success_rate: float = Field(default=0.99, gt=0, le=1)
    max_core_cpu: float = Field(default=80, gt=0, le=100)
    sustained_ticks: int = Field(default=5, ge=1, le=60)


class Design(Contract):
    name: str = Field(min_length=1, max_length=120)
    scenario_id: Literal["A", "B", "C", "D", "E", "F", "G"] = "A"
    actions: list[Action] = Field(default_factory=list, max_length=20)
    seeds: list[Annotated[int, Field(strict=True, ge=0, le=2**31 - 1)]] = Field(
        default_factory=lambda: [42, 43, 44], min_length=1, max_length=20
    )
    warmup_ticks: int = Field(default=15, ge=12, le=120)
    fault_ticks: int = Field(default=14, ge=12, le=120)
    recovery_ticks: int = Field(default=30, ge=12, le=300)
    targets: Targets = Field(default_factory=Targets)
    rationale: str = Field(default="", max_length=4000)

    @model_validator(mode="after")
    def validate_experiment(self):
        if not self.name.strip():
            raise ValueError("方案名称不能为空")
        if len(set(self.seeds)) != len(self.seeds):
            raise ValueError("种子必须互不重复，重复种子不是独立样本")
        if self.targets.sustained_ticks > self.recovery_ticks:
            raise ValueError("持续达标窗口不能超过恢复观测窗口")
        if len(self.seeds) * (self.warmup_ticks + self.fault_ticks + 2*self.recovery_ticks) > 6000:
            raise ValueError("单次实验最多 6000 个仿真 tick，请缩小样本或窗口")
        return self


class RevisionRequest(Contract):
    expected_revision: int = Field(ge=1)


class DesignUpdate(RevisionRequest):
    design: Design


class SessionRequest(RevisionRequest):
    design_id: str = Field(min_length=1, max_length=80)
