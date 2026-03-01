"""
Battery Pack Model
=====================

Manages multiple battery cells in series/parallel configuration with:
    - Cell-to-cell manufacturing variation
    - Inter-cell thermal coupling
    - Pack-level voltage / current aggregation
"""

from __future__ import annotations

import numpy as np
from dataclasses import dataclass, field
from typing import Optional, Dict, Any, List

from models.battery_cell import BatteryCell, BatteryCellConfig
from models.thermal import ThermalParameters


@dataclass
class PackConfig:
    """Configuration for a battery pack."""

    n_series: int = 1
    n_parallel: int = 1
    base_capacity_ah: float = 50.0

    # Manufacturing spread (σ as %  of nominal)
    capacity_variation_pct: float = 2.0   # e.g. 2 % → σ = 1 Ah for 50 Ah cell
    resistance_variation_pct: float = 3.0

    # Thermal coupling between adjacent cells [W/K]
    inter_cell_thermal_conductance: float = 0.5

    # Initial conditions
    initial_soc: float = 0.8
    initial_temperature_c: float = 25.0

    # Sub-model toggles
    enable_thermal: bool = True
    enable_degradation: bool = True
    enable_electrochemical: bool = True
    degradation_time_factor: float = 1.0


class BatteryPack:
    """
    Multi-cell battery pack with series / parallel topology.

    Topology:  *n_parallel* strings, each string has *n_series* cells.
    Pack voltage  =  sum of per-string voltages (series)
    String current =  total_current / n_parallel
    """

    def __init__(self, config: Optional[PackConfig] = None):
        self.config = config or PackConfig()
        c = self.config
        self.n_cells = c.n_series * c.n_parallel

        # ── Create cells with manufacturing variation ───────────────────
        rng = np.random.default_rng(42)  # deterministic seed
        self.cells: List[BatteryCell] = []
        self._cell_grid: List[List[BatteryCell]] = []  # [string][series_idx]

        cap_sigma = c.base_capacity_ah * (c.capacity_variation_pct / 100.0)
        res_sigma = c.resistance_variation_pct / 100.0

        for s in range(c.n_parallel):
            string_cells: List[BatteryCell] = []
            for i in range(c.n_series):
                cell_cap = max(
                    c.base_capacity_ah * 0.8,
                    rng.normal(c.base_capacity_ah, cap_sigma),
                )
                res_factor = max(0.8, rng.normal(1.0, res_sigma))

                cell_cfg = BatteryCellConfig(
                    cell_id=f"S{s+1}_C{i+1}",
                    nominal_capacity_ah=cell_cap,
                    initial_soc=c.initial_soc,
                    initial_temperature_c=c.initial_temperature_c,
                    enable_thermal=c.enable_thermal,
                    enable_degradation=c.enable_degradation,
                    enable_electrochemical=c.enable_electrochemical,
                    degradation_time_factor=c.degradation_time_factor,
                )
                # Apply resistance variation at ECM level
                cell_cfg.ecm_params.R0_ref *= res_factor
                cell_cfg.ecm_params.R1_ref *= res_factor
                cell_cfg.ecm_params.R2_ref *= res_factor

                cell = BatteryCell(cell_cfg)
                string_cells.append(cell)
                self.cells.append(cell)

            self._cell_grid.append(string_cells)

        # Track pack-level time
        self.sim_time_s: float = 0.0
        self.step_count: int = 0

    # ─── Pack-level step ─────────────────────────────────────────────────

    def step(self, pack_current: float, dt: float) -> Dict[str, Any]:
        """
        Advance every cell by one time step.

        Args:
            pack_current: Total pack current [A] (positive = discharge).
            dt: Time step [s].

        Returns:
            Pack-level aggregated state dict.
        """
        c = self.config
        string_current = pack_current / max(c.n_parallel, 1)

        cell_states: List[Dict[str, Any]] = []
        for cell in self.cells:
            result = cell.step(string_current, dt)
            cell_states.append(result)

        # ── Inter-cell thermal coupling ──────────────────────────────
        if c.enable_thermal and c.inter_cell_thermal_conductance > 0:
            self._apply_thermal_coupling(dt)

        # ── Aggregate pack-level results ─────────────────────────────
        self.sim_time_s += dt
        self.step_count += 1

        pack_state = self._aggregate(cell_states, pack_current)
        pack_state["cell_states"] = cell_states
        return pack_state

    # ─── Thermal coupling ────────────────────────────────────────────────

    def _apply_thermal_coupling(self, dt: float):
        """Nearest-neighbour heat exchange between adjacent cells in each string."""
        G = self.config.inter_cell_thermal_conductance
        for string in self._cell_grid:
            for i in range(len(string) - 1):
                T_a = string[i].thermal.T_core
                T_b = string[i + 1].thermal.T_core
                Q = G * (T_a - T_b)  # W
                # Simple explicit Euler coupling (small dt ⇒ stable)
                dT = Q * dt / (string[i].config.thermal_params.mass_kg *
                               string[i].config.thermal_params.specific_heat_j_per_kg_k)
                string[i].thermal._state[0] -= dT
                string[i + 1].thermal._state[0] += dT

    # ─── Aggregation helpers ─────────────────────────────────────────────

    def _aggregate(self, cell_states: List[Dict], pack_current: float) -> Dict[str, Any]:
        """Build pack-level summary from per-cell results."""
        c = self.config
        socs = [cs["soc"] for cs in cell_states]
        voltages = [cs["voltage"] for cs in cell_states]
        temps = [cs.get("thermal_T_core_c", 25.0) for cs in cell_states]
        sohs = [cs.get("deg_soh_pct", 100.0) for cs in cell_states]

        # String voltages (series addition for each parallel string)
        string_voltages: List[float] = []
        idx = 0
        for _s in range(c.n_parallel):
            v_string = sum(voltages[idx: idx + c.n_series])
            string_voltages.append(v_string)
            idx += c.n_series

        pack_voltage = float(np.mean(string_voltages))
        pack_power = pack_voltage * pack_current

        return {
            "pack_voltage": pack_voltage,
            "pack_current": pack_current,
            "pack_power_w": pack_power,
            "n_series": c.n_series,
            "n_parallel": c.n_parallel,
            "n_cells": self.n_cells,

            # SOC statistics
            "soc_mean": float(np.mean(socs)),
            "soc_min": float(np.min(socs)),
            "soc_max": float(np.max(socs)),
            "soc_spread": float(np.max(socs) - np.min(socs)),

            # Voltage statistics
            "cell_voltage_mean": float(np.mean(voltages)),
            "cell_voltage_min": float(np.min(voltages)),
            "cell_voltage_max": float(np.max(voltages)),
            "voltage_spread": float(np.max(voltages) - np.min(voltages)),

            # Thermal statistics
            "temp_mean_c": float(np.mean(temps)),
            "temp_min_c": float(np.min(temps)),
            "temp_max_c": float(np.max(temps)),
            "temp_spread_c": float(np.max(temps) - np.min(temps)),

            # SOH statistics
            "soh_mean_pct": float(np.mean(sohs)),
            "soh_min_pct": float(np.min(sohs)),
            "soh_max_pct": float(np.max(sohs)),

            # Time
            "sim_time_s": self.sim_time_s,
            "sim_time_hours": self.sim_time_s / 3600.0,
            "step_count": self.step_count,
        }

    def get_cell_summary(self) -> List[Dict[str, Any]]:
        """Return per-cell snapshot (for the pack visualisation)."""
        summaries = []
        for cell in self.cells:
            summaries.append({
                "cell_id": cell.config.cell_id,
                "soc": cell.ecm.soc,
                "voltage": cell.ecm.terminal_voltage(
                    cell.ecm.state, 0, cell.thermal.T_core
                ),
                "temp_c": cell.thermal.T_core - 273.15,
                "soh_pct": (cell.degradation.capacity_retention * 100.0
                            if cell.config.enable_degradation else 100.0),
                "capacity_ah": cell.config.nominal_capacity_ah,
            })
        return summaries

    def reset(self, soc: float = 0.5, temperature_c: float = 25.0,
              reset_degradation: bool = False):
        """Reset every cell in the pack."""
        for cell in self.cells:
            cell.reset(soc, temperature_c, reset_degradation)
        self.sim_time_s = 0.0
        self.step_count = 0
