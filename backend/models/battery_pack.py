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


def _sanitize(val: float, fallback: float = 0.0) -> float:
    """Replace NaN/Inf with a safe fallback value."""
    if not np.isfinite(val):
        return fallback
    return float(val)


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
    degradation_time_factor: float = 100.0  # Accelerated aging for visible effects

    # Base convective heat transfer coefficient (stored for edge-cell scaling)
    _base_h_conv: float = 10.0


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

        # Store the base convective coefficient from cell thermal params
        # so we can scale it for edge vs. interior cells
        if self.cells:
            c._base_h_conv = self.cells[0].config.thermal_params.h_conv_w_per_m2_k

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

    def _compute_cell_position(self, cell) -> tuple:
        """Return (string_idx, series_idx) for a cell in the grid."""
        for pi, string in enumerate(self._cell_grid):
            for si, c in enumerate(string):
                if c is cell:
                    return (pi, si)
        return (0, 0)

    def _is_edge_cell(self, pi: int, si: int) -> bool:
        """True if cell is on the boundary of the pack (more exposed surface)."""
        n_strings = len(self._cell_grid)
        n_series = len(self._cell_grid[0]) if n_strings > 0 else 0
        return pi == 0 or pi == n_strings - 1 or si == 0 or si == n_series - 1

    def _count_interior_faces(self, pi: int, si: int) -> int:
        """Count how many of the cell's 4 lateral faces are adjacent to another cell."""
        n_strings = len(self._cell_grid)
        n_series = len(self._cell_grid[0]) if n_strings > 0 else 0
        count = 0
        if si > 0:
            count += 1
        if si < n_series - 1:
            count += 1
        if pi > 0:
            count += 1
        if pi < n_strings - 1:
            count += 1
        return count

    def _apply_thermal_coupling(self, dt: float):
        """
        Physics-based inter-cell thermal coupling.

        Uses surface-to-surface heat transfer (not core-to-core), because
        in a real pack the outer casing of adjacent cells are in thermal
        contact through cell holders, thermal pads, or air gaps.

        Model:
            Q_ij = G * (T_surface_i - T_surface_j)   [W]

        The heat extracted from cell i's surface goes into cell j's surface
        (and vice-versa), modifying the surface energy balance. This is
        physically correct: surface temperature is what neighboring cells
        "see", and cores are only indirectly affected via the cell's own
        internal core↔surface conduction.

        Edge cells have fewer neighbors → more exposed surface area →
        enhanced ambient convection (h_conv scaled by exposed-face fraction).
        """
        G = self.config.inter_cell_thermal_conductance
        n_strings = len(self._cell_grid)
        n_series = len(self._cell_grid[0]) if n_strings > 0 else 0

        # ── Track heat exchanged per link for visualization ───────────
        if not hasattr(self, '_thermal_link_q'):
            self._thermal_link_q = {}  # (id_a, id_b) → cumulative Q in this step

        self._thermal_link_q.clear()

        def exchange(cell_a, cell_b, conductance):
            """Surface-to-surface heat exchange between two cells."""
            T_surf_a = cell_a.thermal.T_surface
            T_surf_b = cell_b.thermal.T_surface
            Q = conductance * (T_surf_a - T_surf_b)  # W, positive = A→B

            # Modify surface temperatures (energy balance on surface node)
            m_s_a = cell_a.config.thermal_params.surface_mass_kg
            cp_s_a = cell_a.config.thermal_params.surface_cp_j_per_kg_k
            m_s_b = cell_b.config.thermal_params.surface_mass_kg
            cp_s_b = cell_b.config.thermal_params.surface_cp_j_per_kg_k

            dT_a = Q * dt / (m_s_a * cp_s_a)
            dT_b = Q * dt / (m_s_b * cp_s_b)

            cell_a.thermal._state[1] -= dT_a   # surface of A loses heat
            cell_b.thermal._state[1] += dT_b   # surface of B gains heat

            # Record for visualization
            key = (cell_a.config.cell_id, cell_b.config.cell_id)
            self._thermal_link_q[key] = float(Q)

        # Within each string (series-adjacent coupling: full conductance)
        for string in self._cell_grid:
            for i in range(len(string) - 1):
                exchange(string[i], string[i + 1], G)

        # Across parallel strings (same series index: reduced conductance
        # because cross-string contact area is typically smaller)
        if n_strings > 1:
            G_cross = G * 0.6  # weaker cross-string thermal coupling
            for si in range(n_series):
                for pi in range(n_strings - 1):
                    if si < len(self._cell_grid[pi]) and si < len(self._cell_grid[pi + 1]):
                        exchange(self._cell_grid[pi][si],
                                 self._cell_grid[pi + 1][si], G_cross)

        # ── Edge-cell enhanced ambient cooling ────────────────────────
        # In a real pack, interior cells are sandwiched between neighbors
        # and have less direct airflow. Edge cells have exposed faces.
        for pi in range(n_strings):
            for si in range(n_series):
                cell = self._cell_grid[pi][si]
                interior_faces = self._count_interior_faces(pi, si)
                exposed_faces = 4 - interior_faces  # of 4 lateral faces

                if exposed_faces > 0:
                    # Boost convective cooling proportional to exposed surface
                    # Interior cell: 0 boost. Corner cell (2 exposed): ~0.3 boost
                    boost_factor = 1.0 + 0.15 * exposed_faces
                    # Temporarily increase h_conv for this cell's thermal step
                    cell.thermal.params.h_conv_w_per_m2_k = (
                        self.config._base_h_conv * boost_factor
                    )
                else:
                    # Interior cells: slightly reduced convection (shielded)
                    cell.thermal.params.h_conv_w_per_m2_k = (
                        self.config._base_h_conv * 0.75
                    )

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
        n_strings = len(self._cell_grid)
        n_series = len(self._cell_grid[0]) if n_strings > 0 else 0

        for cell in self.cells:
            deg = cell.degradation
            soh = (deg.capacity_retention * 100.0
                   if cell.config.enable_degradation else 100.0)
            sei_loss = (deg.sei_capacity_loss * 100.0
                        if cell.config.enable_degradation else 0.0)
            plating_loss = (deg.plating_capacity_loss * 100.0
                            if cell.config.enable_degradation else 0.0)
            cycle_loss = (deg.cycle_capacity_loss * 100.0
                          if cell.config.enable_degradation else 0.0)
            # Approximate current from last step result
            current = getattr(cell, '_last_current', 0.0)
            heat_w = getattr(cell, '_last_heat_w', 0.0)

            # Determine position for edge/interior classification
            pi, si = self._compute_cell_position(cell)
            is_edge = self._is_edge_cell(pi, si)

            summaries.append({
                "cell_id": cell.config.cell_id,
                "soc": _sanitize(cell.ecm.soc, 0.5),
                "voltage": _sanitize(cell.ecm.terminal_voltage(
                    cell.ecm.state, 0, cell.thermal.T_core
                ), 3.7),
                "temp_c": _sanitize(cell.thermal.T_core - 273.15, 25.0),
                "temp_surface_c": _sanitize(cell.thermal.T_surface - 273.15, 25.0),
                "temp_gradient_c": _sanitize(cell.thermal.T_core - cell.thermal.T_surface, 0.0),
                "soh_pct": _sanitize(soh, 100.0),
                "sei_loss_pct": _sanitize(sei_loss, 0.0),
                "plating_loss_pct": _sanitize(plating_loss, 0.0),
                "cycle_loss_pct": _sanitize(cycle_loss, 0.0),
                "resistance_factor": _sanitize(
                    deg.resistance_factor
                    if cell.config.enable_degradation else 1.0, 1.0
                ),
                "current": _sanitize(current, 0.0),
                "heat_w": _sanitize(heat_w, 0.0),
                "capacity_ah": cell.config.nominal_capacity_ah,
                "is_edge_cell": is_edge,
                "h_conv_effective": cell.thermal.params.h_conv_w_per_m2_k,
            })
        return summaries

    def get_thermal_links(self) -> List[Dict[str, Any]]:
        """
        Return thermal coupling data between adjacent cells for visualisation.

        Uses the actual computed heat flow from _apply_thermal_coupling
        (surface-to-surface model) when available, otherwise falls back to
        instantaneous surface temperature difference calculation.
        """
        G = self.config.inter_cell_thermal_conductance
        link_q = getattr(self, '_thermal_link_q', {})
        links = []

        # Within each parallel string: series-adjacent cells
        for string in self._cell_grid:
            for i in range(len(string) - 1):
                cell_a = string[i]
                cell_b = string[i + 1]
                id_a = cell_a.config.cell_id
                id_b = cell_b.config.cell_id

                # Use tracked Q if available (from last step), else compute
                Q = link_q.get((id_a, id_b))
                if Q is None:
                    Q = G * (cell_a.thermal.T_surface - cell_b.thermal.T_surface)

                T_surf_a = cell_a.thermal.T_surface - 273.15
                T_surf_b = cell_b.thermal.T_surface - 273.15
                T_core_a = cell_a.thermal.T_core - 273.15
                T_core_b = cell_b.thermal.T_core - 273.15

                links.append({
                    "from": id_a,
                    "to": id_b,
                    "heat_flow_w": _sanitize(Q, 0.0),
                    "temp_diff_c": _sanitize(T_surf_a - T_surf_b, 0.0),
                    "from_temp_c": _sanitize(T_core_a, 25.0),
                    "to_temp_c": _sanitize(T_core_b, 25.0),
                    "from_surface_c": _sanitize(T_surf_a, 25.0),
                    "to_surface_c": _sanitize(T_surf_b, 25.0),
                    "coupling_type": "series",
                })

        # Across parallel strings: cells at the same series index
        n_strings = len(self._cell_grid)
        if n_strings > 1:
            for si in range(len(self._cell_grid[0])):
                for pi in range(n_strings - 1):
                    if si < len(self._cell_grid[pi]) and si < len(self._cell_grid[pi + 1]):
                        cell_a = self._cell_grid[pi][si]
                        cell_b = self._cell_grid[pi + 1][si]
                        id_a = cell_a.config.cell_id
                        id_b = cell_b.config.cell_id

                        Q = link_q.get((id_a, id_b))
                        if Q is None:
                            Q = G * 0.6 * (cell_a.thermal.T_surface - cell_b.thermal.T_surface)

                        T_surf_a = cell_a.thermal.T_surface - 273.15
                        T_surf_b = cell_b.thermal.T_surface - 273.15
                        T_core_a = cell_a.thermal.T_core - 273.15
                        T_core_b = cell_b.thermal.T_core - 273.15

                        links.append({
                            "from": id_a,
                            "to": id_b,
                            "heat_flow_w": _sanitize(Q, 0.0),
                            "temp_diff_c": _sanitize(T_surf_a - T_surf_b, 0.0),
                            "from_temp_c": _sanitize(T_core_a, 25.0),
                            "to_temp_c": _sanitize(T_core_b, 25.0),
                            "from_surface_c": _sanitize(T_surf_a, 25.0),
                            "to_surface_c": _sanitize(T_surf_b, 25.0),
                            "coupling_type": "parallel",
                        })

        return links

    def reset(self, soc: float = 0.5, temperature_c: float = 25.0,
              reset_degradation: bool = False):
        """Reset every cell in the pack."""
        for cell in self.cells:
            cell.reset(soc, temperature_c, reset_degradation)
        self.sim_time_s = 0.0
        self.step_count = 0
