"""
Battery Simulation Engine
===========================

Orchestrates the battery cell model with load profiles and manages
the simulation loop. Supports:
    - Real-time simulation with WebSocket streaming
    - Batch simulation for accelerated studies
    - Pause/resume/reset controls
    - Configurable time stepping
"""

import time
import asyncio
import logging
import numpy as np
from enum import Enum
from typing import Optional, Dict, Any, Callable, List
from dataclasses import dataclass, field

from models.battery_cell import BatteryCell, BatteryCellConfig
from simulation.profiles import (
    LoadProfile,
    ConstantCurrentProfile,
    CCCVProfile,
    DriveProfile,
    SolarStorageProfile,
    CycleAgingProfile,
    PulseDischargeProfile,
    RestStorageProfile,
    ConstantPowerProfile,
    GridRegulationProfile,
    HPPCProfile,
)
from models.bms import BMSModel, BMSConfig

logger = logging.getLogger("battery_dt.engine")


class SimulationState(str, Enum):
    IDLE = "idle"
    RUNNING = "running"
    PAUSED = "paused"
    COMPLETED = "completed"
    ERROR = "error"


@dataclass
class SimulationConfig:
    """Configuration for the simulation engine."""

    # Time stepping
    dt: float = 1.0                    # Physics time step [s]
    output_interval: float = 1.0       # Interval between output frames [s]

    # Simulation speed
    speed_multiplier: float = 1.0      # 1.0 = real-time, 10.0 = 10x faster
    max_sim_time_s: float = 86400.0    # Max simulation duration [s] (24h default)

    # Degradation acceleration
    degradation_acceleration: float = 1.0  # Time multiplier for aging

    # Data collection
    history_max_points: int = 10000    # Max points to keep in history
    history_downsample: int = 1        # Keep every Nth point


class SimulationEngine:
    """
    Core simulation engine managing the battery digital twin.

    Runs the simulation loop, applies load profiles, and collects
    time-series data for visualization.
    """

    def __init__(self, cell_config: Optional[BatteryCellConfig] = None,
                 sim_config: Optional[SimulationConfig] = None):
        self.cell_config = cell_config or BatteryCellConfig()
        self.sim_config = sim_config or SimulationConfig()

        # Create battery cell
        self.cell = BatteryCell(self.cell_config)

        # Simulation state
        self.state = SimulationState.IDLE
        self._sim_time: float = 0.0
        self._wall_time_start: float = 0.0

        # Load profile
        self._profile: Optional[LoadProfile] = None

        # Data history
        self._history: List[Dict[str, Any]] = []
        self._latest_state: Optional[Dict[str, Any]] = None

        # Callbacks for WebSocket streaming
        self._on_step_callback: Optional[Callable] = None

        # Energy efficiency tracking
        self._charge_ah_in: float = 0.0
        self._discharge_ah_out: float = 0.0
        self._charge_energy_in: float = 0.0
        self._discharge_energy_out: float = 0.0
        self._coulombic_eff: float = 0.0
        self._energy_eff: float = 0.0

    @property
    def sim_time(self) -> float:
        return self._sim_time

    @property
    def history(self) -> List[Dict[str, Any]]:
        return self._history

    @property
    def latest_state(self) -> Optional[Dict[str, Any]]:
        return self._latest_state

    def set_profile(self, profile_type: str, **kwargs) -> dict:
        """
        Set the active load profile.

        Args:
            profile_type: One of 'constant_discharge', 'constant_charge',
                         'cccv_charge', 'drive_cycle', 'solar_storage', 'cycle_aging'
            **kwargs: Profile-specific parameters

        Returns:
            Profile info dict
        """
        capacity = self.cell_config.nominal_capacity_ah

        if profile_type == "constant_discharge":
            c_rate = kwargs.get("c_rate", 1.0)
            self._profile = ConstantCurrentProfile(
                current_a=c_rate * capacity,
                soc_limit_low=kwargs.get("soc_min", 0.05),
            )

        elif profile_type == "constant_charge":
            c_rate = kwargs.get("c_rate", 0.5)
            self._profile = ConstantCurrentProfile(
                current_a=-c_rate * capacity,
                soc_limit_high=kwargs.get("soc_max", 0.95),
            )

        elif profile_type == "cccv_charge":
            c_rate = kwargs.get("c_rate", 0.5)
            self._profile = CCCVProfile(
                charge_current_a=-c_rate * capacity,
                cv_voltage=kwargs.get("cv_voltage", 4.2),
            )

        elif profile_type == "drive_cycle":
            self._profile = DriveProfile(
                nominal_capacity_ah=capacity,
                duration_s=kwargs.get("duration_s", 3600.0),
                aggressiveness=kwargs.get("aggressiveness", 1.0),
            )

        elif profile_type == "solar_storage":
            self._profile = SolarStorageProfile(
                pv_peak_kw=kwargs.get("pv_peak_kw", 5.0),
                load_base_kw=kwargs.get("load_base_kw", 1.5),
                load_peak_kw=kwargs.get("load_peak_kw", 4.0),
                duration_s=kwargs.get("duration_s", 86400.0),
            )

        elif profile_type == "cycle_aging":
            c_rate = kwargs.get("c_rate", 1.0)
            self._profile = CycleAgingProfile(
                c_rate=c_rate,
                nominal_capacity_ah=capacity,
                soc_min=kwargs.get("soc_min", 0.1),
                soc_max=kwargs.get("soc_max", 0.9),
                num_cycles=kwargs.get("num_cycles", 50),
            )

        elif profile_type == "pulse_discharge":
            self._profile = PulseDischargeProfile(
                nominal_capacity_ah=capacity,
                pulse_c_rate=kwargs.get("pulse_c_rate", 3.0),
                pulse_duration_s=kwargs.get("pulse_duration_s", 10.0),
                rest_duration_s=kwargs.get("rest_duration_s", 30.0),
                num_pulses=kwargs.get("num_pulses", 100),
                soc_min=kwargs.get("soc_min", 0.1),
            )

        elif profile_type == "rest_storage":
            self._profile = RestStorageProfile(
                duration_s=kwargs.get("duration_s", 86400.0),
                self_discharge_rate=kwargs.get("self_discharge_rate", 0.0),
            )

        elif profile_type == "constant_power":
            self._profile = ConstantPowerProfile(
                power_w=kwargs.get("power_w", 200.0),
                nominal_capacity_ah=capacity,
                soc_limit_low=kwargs.get("soc_min", 0.05),
                soc_limit_high=kwargs.get("soc_max", 0.95),
                duration_s=kwargs.get("duration_s", None),
            )

        elif profile_type == "grid_regulation":
            self._profile = GridRegulationProfile(
                nominal_capacity_ah=capacity,
                max_c_rate=kwargs.get("max_c_rate", 1.0),
                duration_s=kwargs.get("duration_s", 3600.0),
                regulation_period_s=kwargs.get("regulation_period_s", 4.0),
            )

        elif profile_type == "hppc":
            self._profile = HPPCProfile(
                nominal_capacity_ah=capacity,
                pulse_c_rate=kwargs.get("pulse_c_rate", 1.0),
                soc_points=kwargs.get("soc_points", 10),
            )

        else:
            raise ValueError(f"Unknown profile type: {profile_type}")

        return {
            "profile_name": self._profile.name,
            "profile_description": self._profile.description,
        }

    def set_callback(self, callback: Callable):
        """Set the callback for each simulation step (for WebSocket streaming)."""
        self._on_step_callback = callback

    async def run_async(self):
        """
        Run the simulation asynchronously (for WebSocket streaming).

        Yields simulation state at each output interval.
        Properly handles pause/resume via asyncio Event.
        """
        if not self._profile:
            # Auto-set default profile
            self.set_profile("constant_discharge", c_rate=0.5)

        self.state = SimulationState.RUNNING
        self._wall_time_start = time.time()
        self._pause_event = asyncio.Event()
        self._pause_event.set()  # Start unpaused
        config = self.sim_config

        output_accumulator = 0.0

        # Cache pack/BMS accessors outside the tight loop to avoid
        # per-step import overhead.
        from api.routes import get_pack, get_bms

        try:
            while self.state in (SimulationState.RUNNING, SimulationState.PAUSED):
                # Wait if paused
                if self.state == SimulationState.PAUSED:
                    self._pause_event.clear()
                    await self._pause_event.wait()
                    if self.state == SimulationState.COMPLETED:
                        break
                    continue

                if self._profile.is_complete(self._sim_time, self.cell.ecm.soc):
                    self.state = SimulationState.COMPLETED
                    break

                if self._sim_time >= config.max_sim_time_s:
                    self.state = SimulationState.COMPLETED
                    break

                # Get current from load profile
                try:
                    current = self._profile.get_current(
                        self._sim_time, self.cell.ecm.soc, 
                        self.cell.ecm.terminal_voltage(self.cell.ecm.state, 0, self.cell.thermal.T_core)
                    )
                except Exception:
                    current = 0.0

                # Step the cell model
                step_result = self.cell.step(current, config.dt)

                # ── NaN / Inf guard ──
                # If any key value went NaN the physics diverged; skip this
                # frame and reset the cell to avoid poisoning every future frame.
                _v = step_result.get('voltage', 0)
                _s = step_result.get('soc', 0)
                _t = step_result.get('thermal_T_core_c', 25)
                if (not np.isfinite(_v) or not np.isfinite(_s) or not np.isfinite(_t)):
                    logger.warning(
                        'NaN/Inf detected at t=%.1fs (V=%s, SOC=%s, T=%s). Clamping cell state.',
                        self._sim_time, _v, _s, _t,
                    )
                    # Emergency clamp: reset ECM RC voltages, keep SOC
                    soc_safe = float(np.clip(self.cell.ecm.state[0], 0.05, 0.95))
                    self.cell.ecm._state = np.array([soc_safe, 0.0, 0.0])
                    # Clamp thermal to ambient
                    T_amb = self.cell.thermal.params.T_ambient_k
                    self.cell.thermal._state = np.array([T_amb, T_amb])
                    self._sim_time += config.dt
                    await asyncio.sleep(0.01)
                    continue

                # ── Charging phase annotation for CC-CV charts ──
                charging_phase = 'idle'
                if self._profile is not None:
                    if isinstance(self._profile, CCCVProfile):
                        if self._profile.is_complete(self._sim_time, self.cell.ecm.soc):
                            charging_phase = 'complete'
                        elif self._profile._in_cv_phase:
                            charging_phase = 'cv'
                        else:
                            charging_phase = 'cc'
                    elif current < -0.1:
                        charging_phase = 'charge'
                    elif current > 0.1:
                        charging_phase = 'discharge'
                step_result['charging_phase'] = charging_phase

                # ── Energy efficiency tracking ──
                step_result['coulombic_efficiency'] = self._coulombic_eff
                step_result['energy_efficiency'] = self._energy_eff
                step_result['charge_ah_in'] = self._charge_ah_in
                step_result['discharge_ah_out'] = self._discharge_ah_out
                step_result['charge_energy_in'] = self._charge_energy_in
                step_result['discharge_energy_out'] = self._discharge_energy_out

                # Track cumulative charge/discharge for efficiency
                if current < 0:  # charging
                    self._charge_ah_in += abs(current) * config.dt / 3600.0
                    self._charge_energy_in += abs(current * step_result.get('voltage', 3.7)) * config.dt / 3600.0
                elif current > 0:  # discharging
                    self._discharge_ah_out += abs(current) * config.dt / 3600.0
                    self._discharge_energy_out += abs(current * step_result.get('voltage', 3.7)) * config.dt / 3600.0
                if self._charge_ah_in > 0.01:
                    self._coulombic_eff = min(self._discharge_ah_out / self._charge_ah_in, 1.0) * 100.0
                if self._charge_energy_in > 0.01:
                    self._energy_eff = min(self._discharge_energy_out / self._charge_energy_in, 1.0) * 100.0

                # ── RUL prediction (updated periodically) ──
                deg = self.cell.degradation
                step_result['rul_cycles'] = deg.remaining_useful_life_cycles
                step_result['rul_soh'] = deg.state_of_health
                step_result['rul_eol_threshold'] = deg.params.eol_capacity_fraction * 100
                step_result['rul_degradation_rate'] = (
                    (1.0 - deg.capacity_retention) / max(deg.total_cycles, 0.01)
                ) if deg.total_cycles > 0.5 else 0.0
                step_result['rul_estimated_eol_hours'] = (
                    deg.remaining_useful_life_cycles * 2 * deg.nominal_capacity_ah /
                    max(abs(current), 0.01) / 3600.0 * 3600.0
                ) if abs(current) > 0.01 else 0.0

                # Also step the pack + BMS if one exists
                try:
                    pack = get_pack()
                    if pack is not None:
                        pack_result = pack.step(current, config.dt)
                        # Include lightweight per-cell summaries so the frontend
                        # gets real-time pack data via WS instead of REST polling.
                        step_result['pack_cells'] = pack.get_cell_summary()
                        step_result['pack_thermal_links'] = pack.get_thermal_links()
                        step_result['pack_n_series'] = pack.config.n_series
                        step_result['pack_n_parallel'] = pack.config.n_parallel
                        step_result['pack_n_cells'] = pack.n_cells
                        # Pack-level aggregates
                        step_result['pack_voltage'] = pack_result.get('pack_voltage')
                        step_result['pack_power_w'] = pack_result.get('pack_power_w')
                        step_result['pack_soc_mean'] = pack_result.get('soc_mean')
                        step_result['pack_soh_mean'] = pack_result.get('soh_mean_pct')
                        step_result['pack_temp_max'] = pack_result.get('temp_max_c')

                    bms = get_bms()
                    if bms is not None:
                        bms_status = bms.evaluate(current, self._sim_time)
                        step_result['bms'] = bms_status
                except Exception as e:
                    logger.exception('Pack/BMS step error: %s', e)

                self._sim_time += config.dt
                output_accumulator += config.dt

                # Output at specified interval
                if output_accumulator >= config.output_interval:
                    output_accumulator = 0.0
                    self._latest_state = step_result

                    # Store in history (with downsampling)
                    if len(self._history) < config.history_max_points:
                        # Store light version (without large arrays) for history
                        history_entry = {
                            k: v for k, v in step_result.items()
                            if not isinstance(v, (list, dict)) or k in [
                                "temperature_distribution"
                            ]
                        }
                        self._history.append(history_entry)

                    # Notify via callback
                    if self._on_step_callback:
                        await self._on_step_callback(step_result)

                # Control simulation speed — always yield enough for WS pings
                # Yield more aggressively when a pack is configured because
                # stepping 16+ cells is CPU-heavy and starves the event loop,
                # causing WS pings to time out and the connection to drop.
                has_pack = step_result.get('pack_n_cells', 0) > 1
                if config.speed_multiplier < 100:
                    target_delay = config.dt / config.speed_multiplier
                    min_delay = 0.01 if has_pack else 0.005
                    await asyncio.sleep(max(target_delay * 0.01, min_delay))
                else:
                    # Batch mode: yield every N steps (fewer for heavy packs)
                    yield_every = 10 if has_pack else 50
                    if self.cell.step_count % yield_every == 0:
                        await asyncio.sleep(0.01 if has_pack else 0.005)
                    else:
                        await asyncio.sleep(0)

        except asyncio.CancelledError:
            # Graceful stop requested — mark as completed, re-raise for caller
            self.state = SimulationState.COMPLETED
            raise

        except Exception as e:
            self.state = SimulationState.ERROR
            raise

    def run_batch(self, num_steps: Optional[int] = None) -> List[Dict[str, Any]]:
        """
        Run simulation in batch mode (blocking, no streaming).

        Args:
            num_steps: Number of steps to run (None = run until profile complete)

        Returns:
            List of state dictionaries
        """
        if not self._profile:
            raise RuntimeError("No load profile set. Call set_profile() first.")

        self.state = SimulationState.RUNNING
        config = self.sim_config
        results = []
        output_accumulator = 0.0
        step = 0

        while True:
            if num_steps and step >= num_steps:
                break

            if self._profile.is_complete(self._sim_time, self.cell.ecm.soc):
                break

            if self._sim_time >= config.max_sim_time_s:
                break

            # Get current from load profile
            voltage_est = self.cell.ecm.terminal_voltage(
                self.cell.ecm.state, 0, self.cell.thermal.T_core
            )
            try:
                current = self._profile.get_current(self._sim_time, self.cell.ecm.soc, voltage_est)
            except Exception:
                current = 0.0

            # Step the cell model
            step_result = self.cell.step(current, config.dt)

            # ── NaN / Inf guard (batch mode) ──
            _v = step_result.get('voltage', 0)
            _s = step_result.get('soc', 0)
            _t = step_result.get('thermal_T_core_c', 25)
            if (not np.isfinite(_v) or not np.isfinite(_s) or not np.isfinite(_t)):
                logger.warning(
                    'NaN/Inf in batch at t=%.1fs (V=%s, SOC=%s, T=%s). Clamping.',
                    self._sim_time, _v, _s, _t,
                )
                soc_safe = float(np.clip(self.cell.ecm.state[0], 0.05, 0.95))
                self.cell.ecm._state = np.array([soc_safe, 0.0, 0.0])
                T_amb = self.cell.thermal.params.T_ambient_k
                self.cell.thermal._state = np.array([T_amb, T_amb])
                self._sim_time += config.dt
                step += 1
                continue

            self._sim_time += config.dt
            output_accumulator += config.dt
            step += 1

            # Collect output
            if output_accumulator >= config.output_interval:
                output_accumulator = 0.0
                self._latest_state = step_result
                results.append(step_result)

                if len(self._history) < config.history_max_points:
                    history_entry = {
                        k: v for k, v in step_result.items()
                        if not isinstance(v, (list, dict))
                    }
                    self._history.append(history_entry)

        self.state = SimulationState.COMPLETED
        return results

    def pause(self):
        """Pause the simulation."""
        if self.state == SimulationState.RUNNING:
            self.state = SimulationState.PAUSED

    def resume(self):
        """Resume the simulation."""
        if self.state == SimulationState.PAUSED:
            self.state = SimulationState.RUNNING
            if hasattr(self, '_pause_event'):
                self._pause_event.set()

    def reset(self, soc: float = 0.5, temperature_c: float = 25.0,
              reset_degradation: bool = False):
        """Reset simulation to initial conditions."""
        self.cell.reset(soc, temperature_c, reset_degradation)
        self._sim_time = 0.0
        self._history.clear()
        self._latest_state = None
        self.state = SimulationState.IDLE

    def get_summary(self) -> Dict[str, Any]:
        """Get simulation summary statistics."""
        if not self._history:
            return {"status": "no data"}

        return {
            "status": self.state.value,
            "sim_time_s": self._sim_time,
            "sim_time_hours": self._sim_time / 3600.0,
            "total_steps": self.cell.step_count,
            "data_points": len(self._history),
            "final_soc": self._latest_state.get("soc", 0) if self._latest_state else None,
            "final_voltage": self._latest_state.get("voltage", 0) if self._latest_state else None,
            "final_temperature": self._latest_state.get("thermal_T_core_c", 0) if self._latest_state else None,
            "final_soh": self._latest_state.get("deg_soh_pct", 100) if self._latest_state else None,
            "profile": self._profile.name if self._profile else None,
        }

    def get_available_profiles(self) -> List[Dict[str, str]]:
        """Return list of available load profiles."""
        return [
            {
                "id": "constant_discharge",
                "name": "Constant Current Discharge",
                "description": "Discharge at constant C-rate until SOC limit",
                "params": "c_rate (float), soc_min (float)"
            },
            {
                "id": "constant_charge",
                "name": "Constant Current Charge",
                "description": "Charge at constant C-rate until SOC limit",
                "params": "c_rate (float), soc_max (float)"
            },
            {
                "id": "cccv_charge",
                "name": "CCCV Charging",
                "description": "Constant Current then Constant Voltage charge protocol",
                "params": "c_rate (float), cv_voltage (float)"
            },
            {
                "id": "drive_cycle",
                "name": "Drive Cycle",
                "description": "Simulated EV driving with regenerative braking",
                "params": "aggressiveness (float), duration_s (float)"
            },
            {
                "id": "solar_storage",
                "name": "Solar + Battery Storage",
                "description": "24h solar self-consumption with PV + household load",
                "params": "pv_peak_kw (float), load_base_kw (float), load_peak_kw (float)"
            },
            {
                "id": "cycle_aging",
                "name": "Cycle Aging Test",
                "description": "Repeated charge-discharge cycles for aging study",
                "params": "c_rate (float), num_cycles (int), soc_min (float), soc_max (float)"
            },
            {
                "id": "pulse_discharge",
                "name": "Pulse Discharge",
                "description": "High-current discharge pulses with rest periods (power tools, grid, radar)",
                "params": "pulse_c_rate (float), pulse_duration_s (float), rest_duration_s (float), num_pulses (int)"
            },
            {
                "id": "rest_storage",
                "name": "Calendar Storage",
                "description": "Rest at fixed SOC to study calendar aging (SEI growth, self-discharge)",
                "params": "duration_s (float)"
            },
            {
                "id": "constant_power",
                "name": "Constant Power",
                "description": "Discharge or charge at constant power — current adjusts with voltage",
                "params": "power_w (float), soc_min (float), soc_max (float)"
            },
            {
                "id": "grid_regulation",
                "name": "Grid Frequency Regulation",
                "description": "Rapid charge/discharge cycles for grid ancillary services",
                "params": "max_c_rate (float), duration_s (float)"
            },
            {
                "id": "hppc",
                "name": "HPPC Test",
                "description": "Hybrid Pulse Power Characterization — impedance & power capability at multiple SOC",
                "params": "pulse_c_rate (float), soc_points (int)"
            },
        ]
