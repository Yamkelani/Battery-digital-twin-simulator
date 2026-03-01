"""
Battery Management System (BMS) Model
========================================

Provides pack-level management features:
    - Passive cell balancing (resistive bleeding)
    - Fault detection (over-voltage, under-voltage, over-temperature, over-current)
    - Contactor state management (main +/− contactors, pre-charge relay)
    - Pack-level SOC / SOH estimation
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Optional, Dict, Any, List, Set

from models.battery_pack import BatteryPack


# ─── Fault codes ─────────────────────────────────────────────────────────────

class Fault:
    OVER_VOLTAGE = "OVER_VOLTAGE"
    UNDER_VOLTAGE = "UNDER_VOLTAGE"
    OVER_TEMP = "OVER_TEMP"
    UNDER_TEMP = "UNDER_TEMP"
    OVER_CURRENT = "OVER_CURRENT"
    CELL_IMBALANCE = "CELL_IMBALANCE"
    THERMAL_RUNAWAY = "THERMAL_RUNAWAY"


@dataclass
class BMSConfig:
    """Thresholds and parameters for the BMS."""

    # Voltage limits (per cell)
    cell_v_max: float = 4.25     # V  – triggers OVER_VOLTAGE
    cell_v_min: float = 2.50     # V  – triggers UNDER_VOLTAGE

    # Temperature limits (per cell, °C)
    cell_temp_max: float = 55.0
    cell_temp_min: float = -20.0
    cell_temp_critical: float = 75.0  # thermal runaway threshold

    # Current limit (pack level, A)
    pack_current_max: float = 150.0

    # Imbalance threshold (V spread across cells)
    imbalance_v_threshold: float = 0.05

    # Balancing
    balancing_enabled: bool = True
    balancing_bleed_current_a: float = 0.05   # Passive resistor bleed [A]
    balancing_v_threshold: float = 0.01       # Start balancing above Δ V

    # Contactor
    precharge_time_s: float = 2.0


class BMSModel:
    """
    Simplified Battery Management System model.

    Call ``evaluate()`` every simulation step; it returns a status dict
    including active faults and contactor state.
    """

    def __init__(self, pack: BatteryPack, config: Optional[BMSConfig] = None):
        self.pack = pack
        self.config = config or BMSConfig()

        # State
        self.active_faults: Set[str] = set()
        self.fault_history: List[Dict[str, Any]] = []
        self.contactor_closed: bool = False
        self.precharge_active: bool = False
        self._precharge_start: Optional[float] = None
        self.balancing_active: bool = False
        self._balancing_map: Dict[str, bool] = {}  # cell_id → bleeding?

    # ─── Main evaluation ─────────────────────────────────────────────────

    def evaluate(self, pack_current: float, sim_time_s: float) -> Dict[str, Any]:
        """Run all BMS checks and return status dict."""
        c = self.config
        faults_before = set(self.active_faults)
        self.active_faults.clear()

        cell_summaries = self.pack.get_cell_summary()

        # ── Voltage checks ───────────────────────────────────────────
        for cs in cell_summaries:
            if cs["voltage"] > c.cell_v_max:
                self.active_faults.add(Fault.OVER_VOLTAGE)
            if cs["voltage"] < c.cell_v_min:
                self.active_faults.add(Fault.UNDER_VOLTAGE)

        # ── Temperature checks ───────────────────────────────────────
        for cs in cell_summaries:
            if cs["temp_c"] > c.cell_temp_critical:
                self.active_faults.add(Fault.THERMAL_RUNAWAY)
            elif cs["temp_c"] > c.cell_temp_max:
                self.active_faults.add(Fault.OVER_TEMP)
            if cs["temp_c"] < c.cell_temp_min:
                self.active_faults.add(Fault.UNDER_TEMP)

        # ── Current check ────────────────────────────────────────────
        if abs(pack_current) > c.pack_current_max:
            self.active_faults.add(Fault.OVER_CURRENT)

        # ── Cell imbalance ───────────────────────────────────────────
        voltages = [cs["voltage"] for cs in cell_summaries]
        v_spread = max(voltages) - min(voltages) if voltages else 0
        if v_spread > c.imbalance_v_threshold:
            self.active_faults.add(Fault.CELL_IMBALANCE)

        # Record new faults in history
        new_faults = self.active_faults - faults_before
        for f in new_faults:
            self.fault_history.append({
                "fault": f,
                "time_s": sim_time_s,
                "cleared": False,
            })

        # Mark cleared faults
        cleared = faults_before - self.active_faults
        for entry in reversed(self.fault_history):
            if entry["fault"] in cleared and not entry["cleared"]:
                entry["cleared"] = True

        # ── Contactor logic ──────────────────────────────────────────
        if Fault.THERMAL_RUNAWAY in self.active_faults:
            self.contactor_closed = False
            self.precharge_active = False
        elif not self.contactor_closed:
            # Pre-charge sequence
            if self._precharge_start is None:
                self._precharge_start = sim_time_s
                self.precharge_active = True
            elif sim_time_s - self._precharge_start >= c.precharge_time_s:
                self.contactor_closed = True
                self.precharge_active = False

        # ── Passive balancing ────────────────────────────────────────
        self._balancing_map.clear()
        self.balancing_active = False
        if c.balancing_enabled and len(voltages) > 1:
            v_min = min(voltages)
            for cs in cell_summaries:
                bleed = (cs["voltage"] - v_min) > c.balancing_v_threshold
                self._balancing_map[cs["cell_id"]] = bleed
                if bleed:
                    self.balancing_active = True

        return self.get_status()

    # ─── Balancing current ───────────────────────────────────────────────

    def get_balancing_current(self, cell_id: str) -> float:
        """Return bleed current for a cell (subtracted in the next step)."""
        if self._balancing_map.get(cell_id, False):
            return self.config.balancing_bleed_current_a
        return 0.0

    # ─── Status snapshot ─────────────────────────────────────────────────

    def get_status(self) -> Dict[str, Any]:
        return {
            "contactor_closed": self.contactor_closed,
            "precharge_active": self.precharge_active,
            "balancing_active": self.balancing_active,
            "balancing_map": dict(self._balancing_map),
            "active_faults": sorted(self.active_faults),
            "fault_count": len(self.active_faults),
            "fault_history": self.fault_history[-50:],  # last 50
        }

    def reset(self):
        """Reset BMS state."""
        self.active_faults.clear()
        self.fault_history.clear()
        self.contactor_closed = False
        self.precharge_active = False
        self._precharge_start = None
        self.balancing_active = False
        self._balancing_map.clear()
