"""
Integrated Battery Cell Digital Twin
=======================================

Combines all sub-models into a unified battery cell model:
    - Equivalent Circuit Model (ECM) for voltage/current dynamics
    - Thermal Model for temperature prediction
    - Degradation Model for aging/SOH tracking
    - Single Particle Model for electrochemical visualization

This is the top-level model that the simulation engine interfaces with.
"""

import numpy as np
from dataclasses import dataclass, field
from typing import Optional, Dict, Any

from .equivalent_circuit import EquivalentCircuitModel, ECMParameters
from .thermal import ThermalModel, ThermalParameters
from .degradation import DegradationModel, DegradationParameters
from .electrochemical import SingleParticleModel, SPMParameters


@dataclass
class BatteryCellConfig:
    """Configuration for a complete battery cell."""

    # Cell identification
    cell_id: str = "CELL_001"
    chemistry: str = "NMC622/Graphite"
    form_factor: str = "Prismatic"

    # Nominal specifications
    nominal_capacity_ah: float = 50.0
    nominal_voltage_v: float = 3.7
    energy_wh: float = 185.0

    # Initial conditions
    initial_soc: float = 0.5
    initial_temperature_c: float = 25.0

    # Sub-model parameters
    ecm_params: ECMParameters = field(default_factory=ECMParameters)
    thermal_params: ThermalParameters = field(default_factory=ThermalParameters)
    degradation_params: DegradationParameters = field(default_factory=DegradationParameters)
    spm_params: SPMParameters = field(default_factory=SPMParameters)

    # Simulation settings
    enable_thermal: bool = True
    enable_degradation: bool = True
    enable_electrochemical: bool = True

    # Time acceleration for degradation (for faster-than-realtime simulation)
    degradation_time_factor: float = 1.0


class BatteryCell:
    """
    Complete battery cell digital twin integrating all physics models.

    Manages the coupling between electrical, thermal, and degradation
    sub-models and provides unified state output for visualization.
    """

    def __init__(self, config: Optional[BatteryCellConfig] = None):
        self.config = config or BatteryCellConfig()
        c = self.config

        # Ensure sub-model parameters are consistent
        c.ecm_params.capacity_ah = c.nominal_capacity_ah
        c.ecm_params.nominal_voltage = c.nominal_voltage_v

        # Initialize sub-models
        self.ecm = EquivalentCircuitModel(c.ecm_params)
        self.thermal = ThermalModel(c.thermal_params)
        self.degradation = DegradationModel(c.degradation_params)
        self.spm = SingleParticleModel(c.spm_params)

        # Set initial conditions
        self.ecm.state = np.array([c.initial_soc, 0.0, 0.0])
        T_init_k = c.initial_temperature_c + 273.15
        self.thermal.state = np.array([T_init_k, T_init_k])
        self.spm.set_soc(c.initial_soc)
        self.degradation.nominal_capacity_ah = c.nominal_capacity_ah

        # Simulation time tracking
        self.sim_time_s: float = 0.0
        self.step_count: int = 0

        # Per-step snapshots (read by pack summary)
        self._last_current: float = 0.0
        self._last_heat_w: float = 0.0

        # Track cycle depth for degradation
        self._soc_min_cycle: float = c.initial_soc
        self._soc_max_cycle: float = c.initial_soc

    def step(self, current: float, dt: float, ambient_temp_c: Optional[float] = None) -> Dict[str, Any]:
        """
        Advance the battery cell by one time step.

        Args:
            current: Applied current [A] (positive = discharge, negative = charge)
            dt: Time step [seconds]
            ambient_temp_c: Optional ambient temperature override [°C]

        Returns:
            Comprehensive state dictionary for visualization
        """
        c = self.config

        # Update ambient temperature if provided
        if ambient_temp_c is not None:
            self.thermal.params.T_ambient_k = ambient_temp_c + 273.15

        # Get current temperature for temperature-dependent parameters
        T_k = self.thermal.T_core if c.enable_thermal else (c.initial_temperature_c + 273.15)

        # Get degradation factors
        cap_factor = self.degradation.capacity_retention if c.enable_degradation else 1.0
        res_factor = self.degradation.resistance_factor if c.enable_degradation else 1.0

        # === Step 1: Electrical Model (ECM) ===
        ecm_result = self.ecm.step(current, dt, T_k, cap_factor, res_factor)

        # Snapshot for pack-level queries
        self._last_current = current
        self._last_heat_w = ecm_result.get("total_heat_w", 0.0)

        # === Step 2: Thermal Model ===
        if c.enable_thermal:
            Q_gen = ecm_result["total_heat_w"]
            thermal_result = self.thermal.step(Q_gen, dt)
        else:
            thermal_result = {
                "T_core_c": c.initial_temperature_c,
                "T_surface_c": c.initial_temperature_c,
                "T_avg_c": c.initial_temperature_c,
                "T_ambient_c": c.initial_temperature_c,
                "Q_gen_w": 0.0,
                "Q_conv_w": 0.0,
                "Q_rad_w": 0.0,
                "Q_cond_w": 0.0,
                "thermal_gradient_c": 0.0,
                "overtemp_warning": False,
                "thermal_runaway_risk": False,
            }

        # === Step 3: Degradation Model ===
        if c.enable_degradation:
            # Track cycle depth
            soc = ecm_result["soc"]
            self._soc_min_cycle = min(self._soc_min_cycle, soc)
            self._soc_max_cycle = max(self._soc_max_cycle, soc)
            delta_soc = self._soc_max_cycle - self._soc_min_cycle

            # Apply time factor for accelerated aging simulation
            effective_dt = dt * c.degradation_time_factor

            degradation_result = self.degradation.step(
                current=current,
                voltage=ecm_result["voltage"],
                T=T_k,
                soc=soc,
                dt=effective_dt,
                delta_soc=max(delta_soc, 0.1),
            )
        else:
            degradation_result = {
                "soh_pct": 100.0,
                "capacity_retention": 1.0,
                "resistance_factor": 1.0,
                "sei_loss_pct": 0.0,
                "cycle_loss_pct": 0.0,
                "plating_loss_pct": 0.0,
                "total_ah_throughput": 0.0,
                "equivalent_cycles": 0.0,
                "total_energy_wh": 0.0,
                "remaining_cycles": 10000.0,
                "is_eol": False,
                "total_time_hours": 0.0,
            }

        # === Step 4: Electrochemical Model (SPM) ===
        if c.enable_electrochemical:
            spm_result = self.spm.step(current, T_k, dt)
        else:
            N = c.spm_params.N_r
            spm_result = {
                "neg_concentration": [0.5] * N,
                "pos_concentration": [0.7] * N,
                "neg_surface_stoich": 0.5,
                "pos_surface_stoich": 0.7,
                "neg_avg_stoich": 0.5,
                "pos_avg_stoich": 0.7,
                "neg_gradient": 0.0,
                "pos_gradient": 0.0,
                "r_normalized": np.linspace(0, 1, N).tolist(),
                "diffusion_limitation": 0.0,
            }

        # Update simulation time
        self.sim_time_s += dt
        self.step_count += 1

        # Compute derived quantities
        power_w = ecm_result["voltage"] * current
        c_rate = abs(current) / c.nominal_capacity_ah

        # === Compile comprehensive state ===
        state = {
            # Metadata
            "cell_id": c.cell_id,
            "chemistry": c.chemistry,
            "sim_time_s": self.sim_time_s,
            "sim_time_hours": self.sim_time_s / 3600.0,
            "step_count": self.step_count,

            # Electrical state
            "soc": ecm_result["soc"],
            "soc_pct": ecm_result["soc"] * 100.0,
            "voltage": ecm_result["voltage"],
            "ocv": ecm_result["ocv"],
            "current": current,
            "power_w": power_w,
            "c_rate": c_rate,
            "v_rc1": ecm_result["v_rc1"],
            "v_rc2": ecm_result["v_rc2"],

            # Thermal state
            **{f"thermal_{k}": v for k, v in thermal_result.items()},

            # Degradation state
            **{f"deg_{k}": v for k, v in degradation_result.items()},

            # Electrochemical state (concentration profiles)
            **{f"echem_{k}": v for k, v in spm_result.items()},

            # Heat generation breakdown
            "heat_ohmic_w": ecm_result["ohmic_loss_w"],
            "heat_polarization_w": ecm_result["polarization_loss_w"],
            "heat_entropic_w": ecm_result["entropic_heat_w"],
            "heat_total_w": ecm_result["total_heat_w"],

            # Temperature distribution for 3D heatmap
            "temperature_distribution": (
                self.thermal.get_temperature_distribution()
                if c.enable_thermal else None
            ),
        }

        return state

    def get_3d_visualization_data(self) -> Dict[str, Any]:
        """
        Get data specifically formatted for 3D rendering.

        Returns dict with:
            - Cell dimensions and geometry
            - Heat map data (temperature field)
            - Particle concentration profiles (for ion flow viz)
            - State indicators (SOC, SOH, voltage colors)
        """
        c = self.config
        soc = self.ecm.soc
        temp_dist = self.thermal.get_temperature_distribution() if c.enable_thermal else None

        return {
            # Geometry
            "geometry": {
                "length_m": c.thermal_params.length_m,
                "width_m": c.thermal_params.width_m,
                "height_m": c.thermal_params.height_m,
                "form_factor": c.form_factor,
            },

            # State colors (normalized 0-1 for shader mapping)
            "soc_normalized": soc,
            "soh_normalized": self.degradation.capacity_retention,
            "thermal_stress": min((self.thermal.T_core - 273.15 - 25.0) / 35.0, 1.0) if c.enable_thermal else 0.0,

            # Heat map
            "heat_map": temp_dist,

            # Particle state for ion flow animation
            "ion_flow": {
                "rate": abs(self.ecm.state[0]) * 10,  # Normalized flow rate
                "direction": "discharge" if self.ecm.state[0] > 0 else "charge",
                "neg_surface": float(self.spm._c_neg[-1] / c.spm_params.c_s_max_neg) if c.enable_electrochemical else 0.5,
                "pos_surface": float(self.spm._c_pos[-1] / c.spm_params.c_s_max_pos) if c.enable_electrochemical else 0.5,
            },
        }

    def reset(self, soc: float = 0.5, temperature_c: float = 25.0, reset_degradation: bool = False):
        """Reset cell state."""
        self.ecm.state = np.array([soc, 0.0, 0.0])
        T_k = temperature_c + 273.15
        self.thermal.state = np.array([T_k, T_k])
        self.spm.set_soc(soc)
        if reset_degradation:
            self.degradation.reset()
        self.sim_time_s = 0.0
        self.step_count = 0
        self._soc_min_cycle = soc
        self._soc_max_cycle = soc
