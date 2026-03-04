"""
Lumped Thermal Model for Lithium-Ion Battery Cell
===================================================

Models the cell temperature using an energy balance:

    m * Cp * dT_core/dt  = Q_gen - Q_core_to_surface
    m_s * Cp_s * dT_surf/dt = Q_core_to_surface - Q_conv - Q_rad

Where:
    Q_gen = I²R (ohmic) + polarization losses + entropic heat
    Q_core_to_surface = (T_core - T_surface) / R_cond
    Q_conv = h_conv * A_surface * (T_surface - T_ambient)    [Newton's cooling]
    Q_rad  = epsilon * sigma * A_surface * (T_surface⁴ - T_ambient⁴)  [Stefan-Boltzmann]

Two-state thermal model captures:
    - Core temperature (where reactions happen)
    - Surface temperature (where cooling happens)
    - Temperature gradient across the cell
"""

import numpy as np
from dataclasses import dataclass
from typing import Optional


# Stefan-Boltzmann constant [W/(m²·K⁴)]
STEFAN_BOLTZMANN = 5.67e-8


@dataclass
class ThermalParameters:
    """Thermal model parameters for a prismatic Li-ion cell."""

    # Cell physical properties
    mass_kg: float = 0.8                    # Cell mass [kg]
    specific_heat_j_per_kg_k: float = 1000.0  # Specific heat capacity [J/(kg·K)]

    # Surface thermal properties
    surface_mass_kg: float = 0.15            # Effective surface mass [kg]
    surface_cp_j_per_kg_k: float = 500.0     # Surface specific heat [J/(kg·K)]

    # Cell geometry (prismatic cell)
    length_m: float = 0.148                  # Cell length [m]
    width_m: float = 0.091                   # Cell width [m]
    height_m: float = 0.027                  # Cell height [m]

    # Thermal resistances
    R_cond_k_per_w: float = 1.5              # Core-to-surface thermal resistance [K/W]

    # Convective heat transfer
    h_conv_w_per_m2_k: float = 10.0          # Natural convection [W/(m²·K)]

    # Radiative properties
    emissivity: float = 0.9                  # Surface emissivity [-]

    # Ambient temperature [K]
    T_ambient_k: float = 298.15              # 25°C

    # Temperature limits
    T_max_k: float = 333.15                  # 60°C - max operating
    T_critical_k: float = 353.15             # 80°C - thermal runaway risk

    @property
    def surface_area_m2(self) -> float:
        """Total surface area of the prismatic cell."""
        l, w, h = self.length_m, self.width_m, self.height_m
        return 2 * (l * w + l * h + w * h)


class ThermalModel:
    """
    Two-state lumped thermal model for Li-ion battery cell.

    State vector: [T_core, T_surface] in Kelvin
    """

    def __init__(self, params: Optional[ThermalParameters] = None):
        self.params = params or ThermalParameters()
        T_init = self.params.T_ambient_k
        self._state = np.array([T_init, T_init])  # [T_core, T_surface]

    @property
    def state(self) -> np.ndarray:
        return self._state.copy()

    @state.setter
    def state(self, value: np.ndarray):
        self._state = np.array(value, dtype=np.float64)

    @property
    def T_core(self) -> float:
        return float(self._state[0])

    @property
    def T_surface(self) -> float:
        return float(self._state[1])

    @property
    def T_avg(self) -> float:
        return float(0.7 * self._state[0] + 0.3 * self._state[1])

    def _convective_heat_loss(self, T_surface: float) -> float:
        """Newton's law of cooling."""
        return (self.params.h_conv_w_per_m2_k * self.params.surface_area_m2 *
                (T_surface - self.params.T_ambient_k))

    def _radiative_heat_loss(self, T_surface: float) -> float:
        """Stefan-Boltzmann radiative heat loss."""
        T_amb = self.params.T_ambient_k
        return (self.params.emissivity * STEFAN_BOLTZMANN * self.params.surface_area_m2 *
                (T_surface**4 - T_amb**4))

    def _conductive_transfer(self, T_core: float, T_surface: float) -> float:
        """Heat transfer from core to surface."""
        return (T_core - T_surface) / self.params.R_cond_k_per_w

    def derivatives(self, state: np.ndarray, Q_gen: float) -> np.ndarray:
        """
        Compute thermal state derivatives.

        Args:
            state: [T_core, T_surface] in Kelvin
            Q_gen: Total heat generation from electrical model [W]

        Returns:
            [dT_core/dt, dT_surface/dt]
        """
        T_core, T_surface = state
        p = self.params

        # Heat flows
        Q_cond = self._conductive_transfer(T_core, T_surface)
        Q_conv = self._convective_heat_loss(T_surface)
        Q_rad = self._radiative_heat_loss(T_surface)

        # Core energy balance: gains heat from reactions, loses to surface
        dT_core_dt = (Q_gen - Q_cond) / (p.mass_kg * p.specific_heat_j_per_kg_k)

        # Surface energy balance: gains from core, loses to environment
        dT_surface_dt = (Q_cond - Q_conv - Q_rad) / (p.surface_mass_kg * p.surface_cp_j_per_kg_k)

        return np.array([dT_core_dt, dT_surface_dt])

    def step(self, Q_gen: float, dt: float) -> dict:
        """
        Advance thermal model by one time step using RK4 integration.

        Args:
            Q_gen: Heat generation from electrical model [W]
            dt: Time step [s]

        Returns:
            dict with temperatures and heat flows
        """
        # RK4 integration
        k1 = self.derivatives(self._state, Q_gen)
        k2 = self.derivatives(self._state + 0.5 * dt * k1, Q_gen)
        k3 = self.derivatives(self._state + 0.5 * dt * k2, Q_gen)
        k4 = self.derivatives(self._state + dt * k3, Q_gen)

        self._state += (dt / 6.0) * (k1 + 2 * k2 + 2 * k3 + k4)

        # Clamp temperatures to physically plausible range to prevent
        # NaN / Inf propagation if the model diverges (e.g. at very high
        # speed multipliers or aggressive degradation acceleration).
        T_floor = 223.15    # -50 °C
        T_ceiling = 473.15  # 200 °C  (well above thermal runaway)
        self._state = np.clip(self._state, T_floor, T_ceiling)

        T_core, T_surface = self._state
        Q_conv = self._convective_heat_loss(T_surface)
        Q_rad = self._radiative_heat_loss(T_surface)
        Q_cond = self._conductive_transfer(T_core, T_surface)

        return {
            "T_core_k": float(T_core),
            "T_surface_k": float(T_surface),
            "T_core_c": float(T_core - 273.15),
            "T_surface_c": float(T_surface - 273.15),
            "T_avg_c": float(self.T_avg - 273.15),
            "T_ambient_c": float(self.params.T_ambient_k - 273.15),
            "Q_gen_w": float(Q_gen),
            "Q_conv_w": float(Q_conv),
            "Q_rad_w": float(Q_rad),
            "Q_cond_w": float(Q_cond),
            "gradient_c": float(T_core - T_surface),
            "overtemp_warning": T_core > self.params.T_max_k,
            "runaway_risk": T_core > self.params.T_critical_k,
        }

    def get_temperature_distribution(self, num_points: int = 20) -> dict:
        """
        Generate a simplified 1D temperature distribution from core to surface.
        Used for 3D heat map visualization.

        Returns:
            dict with position array [0=core, 1=surface] and temperature array
        """
        positions = np.linspace(0, 1, num_points)
        T_core, T_surface = self._state

        # Parabolic temperature profile (typical for conduction-dominated)
        temperatures = T_core - (T_core - T_surface) * positions**2

        return {
            "positions": positions.tolist(),
            "temperatures_k": temperatures.tolist(),
            "temperatures_c": (temperatures - 273.15).tolist(),
        }

    def reset(self, T_init_k: Optional[float] = None):
        """Reset thermal state to initial temperature."""
        T = T_init_k or self.params.T_ambient_k
        self._state = np.array([T, T])
