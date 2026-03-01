"""
WebSocket Message Schemas (Pydantic v2)
=========================================

Strict validation for every message arriving over the WebSocket.
"""

from __future__ import annotations

from typing import Dict, Any, Literal, Optional, Union
from pydantic import BaseModel, Field, field_validator


# ─── Inbound (client → server) ──────────────────────────────────────────────

class WSStart(BaseModel):
    action: Literal["start"]


class WSPause(BaseModel):
    action: Literal["pause"]


class WSResume(BaseModel):
    action: Literal["resume"]


class WSStop(BaseModel):
    action: Literal["stop"]


class WSReset(BaseModel):
    action: Literal["reset"]
    soc: float = Field(0.5, ge=0.0, le=1.0)
    temperature_c: float = Field(25.0, ge=-40.0, le=80.0)
    reset_degradation: bool = False


class WSSetSpeed(BaseModel):
    action: Literal["set_speed"]
    value: float = Field(..., ge=0.1, le=1000.0)


class WSSetProfile(BaseModel):
    action: Literal["set_profile"]
    type: str = "constant_discharge"
    params: Dict[str, Any] = Field(default_factory=dict)

    @field_validator("type")
    @classmethod
    def _known_profile(cls, v: str) -> str:
        allowed = {
            "constant_discharge",
            "constant_charge",
            "cccv_charge",
            "drive_cycle",
            "solar_storage",
            "cycle_aging",
        }
        if v not in allowed:
            raise ValueError(f"Unknown profile: {v}. Allowed: {allowed}")
        return v


class WSConfigureCell(BaseModel):
    action: Literal["configure_cell"]
    capacity_ah: float = Field(50.0, ge=1.0, le=500.0)
    soc: float = Field(0.5, ge=0.0, le=1.0)
    temperature_c: float = Field(25.0, ge=-40.0, le=80.0)
    enable_thermal: bool = True
    enable_degradation: bool = True
    enable_electrochemical: bool = True
    degradation_acceleration: float = Field(1.0, ge=1.0, le=10000.0)


class WSSetAmbientTemp(BaseModel):
    action: Literal["set_ambient_temp"]
    value: float = Field(..., ge=-40.0, le=80.0)


# ─── Pack-specific messages ─────────────────────────────────────────────────

class WSConfigurePack(BaseModel):
    action: Literal["configure_pack"]
    n_series: int = Field(1, ge=1, le=200)
    n_parallel: int = Field(1, ge=1, le=100)
    capacity_ah: float = Field(50.0, ge=1.0, le=500.0)
    variation_pct: float = Field(0.0, ge=0.0, le=20.0)
    enable_balancing: bool = True
    enable_thermal_coupling: bool = True


# ─── Discriminated union ────────────────────────────────────────────────────

WSAction = Union[
    WSStart,
    WSPause,
    WSResume,
    WSStop,
    WSReset,
    WSSetSpeed,
    WSSetProfile,
    WSConfigureCell,
    WSSetAmbientTemp,
    WSConfigurePack,
]


def parse_ws_message(data: dict) -> WSAction:
    """Parse and validate an incoming WS message dict.

    Returns a validated Pydantic model or raises ``ValueError``.
    """
    action = data.get("action")
    _map = {
        "start": WSStart,
        "pause": WSPause,
        "resume": WSResume,
        "stop": WSStop,
        "reset": WSReset,
        "set_speed": WSSetSpeed,
        "set_profile": WSSetProfile,
        "configure_cell": WSConfigureCell,
        "set_ambient_temp": WSSetAmbientTemp,
        "configure_pack": WSConfigurePack,
    }
    model_cls = _map.get(action)
    if model_cls is None:
        raise ValueError(f"Unknown action: {action!r}")
    return model_cls.model_validate(data)
