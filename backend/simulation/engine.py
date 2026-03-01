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
)


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

                # Control simulation speed
                if config.speed_multiplier < 100:
                    # Sleep to maintain desired speed
                    target_delay = config.dt / config.speed_multiplier
                    await asyncio.sleep(max(target_delay * 0.01, 0.001))
                else:
                    # Batch mode: yield control occasionally
                    if self.cell.step_count % 100 == 0:
                        await asyncio.sleep(0)

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
            current = self._profile.get_current(self._sim_time, self.cell.ecm.soc, voltage_est)

            # Step the cell model
            step_result = self.cell.step(current, config.dt)
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
        ]
