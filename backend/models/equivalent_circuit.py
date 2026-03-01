"""
Equivalent Circuit Model (2RC Thevenin) for Lithium-Ion Battery
================================================================

Models the battery terminal voltage using:
    V_terminal = OCV(SOC) - I * R0 - V_rc1 - V_rc2

State equations:
    dSOC/dt  = -I / (Q_nom * 3600)        [Coulomb counting]
    dV1/dt   = -V1 / (R1 * C1) + I / C1   [RC pair 1 - electrochemical polarization]
    dV2/dt   = -V2 / (R2 * C2) + I / C2   [RC pair 2 - diffusion polarization]

Parameters are temperature-dependent via Arrhenius relationship:
    R(T) = R_ref * exp(Ea_R / R_gas * (1/T - 1/T_ref))

Convention: I > 0 = discharge, I < 0 = charge
"""

import numpy as np
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class ECMParameters:
    """Parameters for the 2RC Equivalent Circuit Model."""

    # Nominal capacity [Ah]
    capacity_ah: float = 50.0

    # Nominal voltage [V]
    nominal_voltage: float = 3.7

    # Reference temperature [K]
    T_ref: float = 298.15  # 25°C

    # Ohmic resistance at reference temperature [Ohm]
    R0_ref: float = 0.015

    # RC pair 1 (electrochemical polarization)
    R1_ref: float = 0.010  # [Ohm]
    C1_ref: float = 1000.0  # [F] -> tau1 = R1*C1 = 10s

    # RC pair 2 (diffusion)
    R2_ref: float = 0.005  # [Ohm]
    C2_ref: float = 20000.0  # [F] -> tau2 = R2*C2 = 100s

    # Activation energies for Arrhenius temperature dependence [J/mol]
    Ea_R0: float = 20000.0
    Ea_R1: float = 25000.0
    Ea_R2: float = 30000.0

    # Voltage limits [V]
    V_max: float = 4.2
    V_min: float = 2.5

    # SOC-OCV lookup table (NMC type chemistry)
    # SOC points from 0 to 1
    soc_breakpoints: np.ndarray = field(default_factory=lambda: np.array(
        [0.0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45,
         0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0]
    ))

    # OCV values [V] - NMC/Graphite chemistry
    ocv_values: np.ndarray = field(default_factory=lambda: np.array(
        [2.50, 3.28, 3.42, 3.50, 3.55, 3.58, 3.61, 3.63, 3.65, 3.67,
         3.70, 3.73, 3.77, 3.80, 3.85, 3.90, 3.96, 4.02, 4.08, 4.14, 4.20]
    ))

    # Entropy coefficient dOCV/dT [V/K] (for entropic heat calculation)
    entropy_coefficient: float = -0.0001


# Universal gas constant [J/(mol·K)]
R_GAS = 8.314


class EquivalentCircuitModel:
    """
    2RC Thevenin Equivalent Circuit Model for Li-ion batteries.

    State vector: [SOC, V_rc1, V_rc2]
    """

    def __init__(self, params: Optional[ECMParameters] = None):
        self.params = params or ECMParameters()
        self._state = np.array([0.5, 0.0, 0.0])  # [SOC, V1, V2]

    @property
    def state(self) -> np.ndarray:
        return self._state.copy()

    @state.setter
    def state(self, value: np.ndarray):
        self._state = np.array(value, dtype=np.float64)

    @property
    def soc(self) -> float:
        return float(self._state[0])

    def ocv(self, soc: float) -> float:
        """Open Circuit Voltage as function of SOC via interpolation."""
        soc_clamped = np.clip(soc, 0.0, 1.0)
        return float(np.interp(soc_clamped, self.params.soc_breakpoints, self.params.ocv_values))

    def docv_dsoc(self, soc: float) -> float:
        """Derivative of OCV w.r.t. SOC (for impedance calculations)."""
        delta = 0.001
        soc_h = np.clip(soc + delta, 0.0, 1.0)
        soc_l = np.clip(soc - delta, 0.0, 1.0)
        return (self.ocv(soc_h) - self.ocv(soc_l)) / (soc_h - soc_l + 1e-12)

    def _arrhenius(self, R_ref: float, Ea: float, T: float) -> float:
        """Temperature-dependent resistance via Arrhenius relationship."""
        return R_ref * np.exp(Ea / R_GAS * (1.0 / T - 1.0 / self.params.T_ref))

    def get_resistances(self, T: float) -> tuple:
        """Get temperature-adjusted resistances.

        Args:
            T: Temperature in Kelvin

        Returns:
            (R0, R1, R2) - All in Ohms
        """
        R0 = self._arrhenius(self.params.R0_ref, self.params.Ea_R0, T)
        R1 = self._arrhenius(self.params.R1_ref, self.params.Ea_R1, T)
        R2 = self._arrhenius(self.params.R2_ref, self.params.Ea_R2, T)
        return R0, R1, R2

    def derivatives(self, state: np.ndarray, current: float, T: float,
                    capacity_factor: float = 1.0) -> np.ndarray:
        """
        Compute state derivatives for the ECM.

        Args:
            state: [SOC, V_rc1, V_rc2]
            current: Applied current [A] (positive = discharge)
            T: Temperature [K]
            capacity_factor: Fraction of remaining capacity (1.0 = fresh, degradation reduces this)

        Returns:
            [dSOC/dt, dV1/dt, dV2/dt]
        """
        soc, v1, v2 = state
        R0, R1, R2 = self.get_resistances(T)
        C1, C2 = self.params.C1_ref, self.params.C2_ref

        # Effective capacity considering degradation
        Q_eff = self.params.capacity_ah * capacity_factor

        # State derivatives
        dsoc_dt = -current / (Q_eff * 3600.0)  # Coulomb counting
        dv1_dt = -v1 / (R1 * C1) + current / C1  # RC pair 1
        dv2_dt = -v2 / (R2 * C2) + current / C2  # RC pair 2

        return np.array([dsoc_dt, dv1_dt, dv2_dt])

    def terminal_voltage(self, state: np.ndarray, current: float, T: float,
                         resistance_factor: float = 1.0) -> float:
        """
        Compute terminal voltage.

        Args:
            state: [SOC, V_rc1, V_rc2]
            current: Applied current [A]
            T: Temperature [K]
            resistance_factor: Multiplier for resistance increase due to aging

        Returns:
            Terminal voltage [V]
        """
        soc, v1, v2 = state
        R0, _, _ = self.get_resistances(T)
        R0 *= resistance_factor

        v_ocv = self.ocv(soc)
        v_terminal = v_ocv - current * R0 - v1 - v2

        return float(np.clip(v_terminal, self.params.V_min, self.params.V_max))

    def power_loss(self, state: np.ndarray, current: float, T: float,
                   resistance_factor: float = 1.0) -> dict:
        """
        Calculate power losses for thermal model coupling.

        Returns:
            dict with ohmic_loss, polarization_loss, entropic_heat, total_heat [W]
        """
        soc, v1, v2 = state
        R0, R1, R2 = self.get_resistances(T)
        R0 *= resistance_factor

        # Ohmic loss: I²R0
        q_ohmic = current ** 2 * R0

        # Polarization losses from RC pairs
        q_polarization = v1 * current + v2 * current  # Approximation

        # Reversible (entropic) heat: I * T * dOCV/dT
        q_entropic = current * T * self.params.entropy_coefficient

        total = q_ohmic + abs(q_polarization) + q_entropic

        return {
            "ohmic_loss_w": float(q_ohmic),
            "polarization_loss_w": float(abs(q_polarization)),
            "entropic_heat_w": float(q_entropic),
            "total_heat_w": float(max(total, 0.0)),
        }

    def step(self, current: float, dt: float, T: float,
             capacity_factor: float = 1.0, resistance_factor: float = 1.0) -> dict:
        """
        Advance the model by one time step using RK4 integration.

        Args:
            current: Applied current [A]
            dt: Time step [s]
            T: Cell temperature [K]
            capacity_factor: Remaining capacity fraction
            resistance_factor: Resistance increase factor

        Returns:
            dict with SOC, voltage, power losses
        """
        # RK4 integration
        k1 = self.derivatives(self._state, current, T, capacity_factor)
        k2 = self.derivatives(self._state + 0.5 * dt * k1, current, T, capacity_factor)
        k3 = self.derivatives(self._state + 0.5 * dt * k2, current, T, capacity_factor)
        k4 = self.derivatives(self._state + dt * k3, current, T, capacity_factor)

        self._state += (dt / 6.0) * (k1 + 2 * k2 + 2 * k3 + k4)

        # Clamp SOC
        self._state[0] = np.clip(self._state[0], 0.0, 1.0)

        # Compute outputs
        v_terminal = self.terminal_voltage(self._state, current, T, resistance_factor)
        losses = self.power_loss(self._state, current, T, resistance_factor)

        return {
            "soc": float(self._state[0]),
            "v_rc1": float(self._state[1]),
            "v_rc2": float(self._state[2]),
            "voltage": v_terminal,
            "ocv": self.ocv(self._state[0]),
            "current": current,
            **losses,
        }
