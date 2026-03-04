"""
Battery Degradation Models
============================

Implements multiple degradation mechanisms for Li-ion batteries:

1. **SEI Layer Growth (Calendar Aging)**
   - Solid Electrolyte Interphase grows on anode surface
   - Consumes cyclable lithium → capacity fade
   - Increases resistance
   - Rate: proportional to sqrt(time), accelerated by temperature (Arrhenius)
   - Q_loss_sei = k_sei * exp(-Ea_sei / (R*T)) * sqrt(t)

2. **Cycle Aging (Mechanical Degradation)**
   - Particle cracking from lithium intercalation stress
   - Loss of active material
   - proportional to charge throughput (Ah)
   - Q_loss_cyc = k_cyc * exp(-Ea_cyc / (R*T)) * (Ah_throughput)^z

3. **Lithium Plating**
   - Metallic lithium deposits on anode at low T or high C-rate
   - Irreversible capacity loss
   - Safety hazard (dendrites)
   - Onset condition: anode potential < 0V vs Li/Li+

4. **Resistance Growth**
   - Combined effect of SEI + contact resistance increase
   - R_increase = f(sqrt(t), Ah_throughput, T)

References:
    - Schmalstieg et al., J. Electrochem. Soc., 2014
    - Naumann et al., J. Energy Storage, 2020
    - Reniers et al., J. Electrochem. Soc., 2019
"""

import numpy as np
from dataclasses import dataclass
from typing import Optional


R_GAS = 8.314  # Universal gas constant [J/(mol·K)]


@dataclass
class DegradationParameters:
    """Parameters governing battery degradation mechanisms."""

    # Reference temperature [K]
    T_ref: float = 298.15  # 25°C

    # === SEI Growth (Calendar Aging) ===
    # Capacity loss coefficient [fraction / sqrt(s)]
    # Tuned so degradation is visible over ~10-15 min of wall-clock simulation
    # without prematurely hitting EOL. sqrt(t) law preserved.
    k_sei: float = 2.0e-5
    # Activation energy for SEI growth [J/mol]
    Ea_sei: float = 24000.0
    # SEI resistance growth coefficient [Ohm / sqrt(s)]
    k_sei_resistance: float = 4.0e-5

    # === Cycle Aging ===
    # Capacity loss coefficient per Ah throughput [fraction / Ah^z]
    # Tuned for a gentler curve — ~2-3% cycle loss over extended sessions
    k_cyc: float = 8.0e-5
    # Activation energy for cycle aging [J/mol]
    Ea_cyc: float = 22000.0
    # Power law exponent for Ah throughput
    z_cyc: float = 0.55
    # Cycle aging resistance coefficient
    k_cyc_resistance: float = 3.0e-5
    # DOD stress factor coefficient
    k_dod: float = 1.2  # Higher DOD → faster degradation

    # === Lithium Plating ===
    # Critical C-rate threshold for plating onset at T_ref
    c_rate_plating_threshold: float = 0.5
    # Temperature below which plating risk increases [K]
    T_plating_onset: float = 288.15  # 15°C — only at genuinely cold temps
    # Plating capacity loss rate [fraction / (Ah * K)]
    k_plating: float = 2.0e-6

    # === Humidity / Corrosion ===
    # Corrosion acceleration factor per %RH above 60%
    # Moisture ingress accelerates connector corrosion and can degrade
    # seal integrity, increasing self-discharge and resistance.
    k_humidity_corrosion: float = 1.5e-7   # resistance growth per %RH·s above threshold
    humidity_threshold_pct: float = 60.0    # corrosion accelerates above this RH
    k_humidity_self_discharge: float = 5.0e-8  # capacity loss from moisture-induced self-discharge

    # === General Limits ===
    # End of life capacity retention threshold
    eol_capacity_fraction: float = 0.70  # 70% = end of life (more lenient)
    # Maximum resistance increase factor
    max_resistance_factor: float = 2.5


class DegradationModel:
    """
    Comprehensive battery degradation model tracking multiple mechanisms.

    State: cumulative degradation effects over battery lifetime.
    """

    def __init__(self, params: Optional[DegradationParameters] = None):
        self.params = params or DegradationParameters()

        # Cumulative tracking variables
        self.total_time_s: float = 0.0          # Total elapsed time [s]
        self.total_ah_throughput: float = 0.0   # Cumulative charge throughput [Ah]
        self.total_energy_wh: float = 0.0       # Cumulative energy throughput [Wh]
        self.total_cycles: float = 0.0          # Equivalent full cycles
        self.nominal_capacity_ah: float = 50.0  # Will be set from cell params

        # Degradation accumulators
        self.sei_capacity_loss: float = 0.0     # Fraction lost to SEI
        self.cycle_capacity_loss: float = 0.0   # Fraction lost to cycling
        self.plating_capacity_loss: float = 0.0 # Fraction lost to plating
        self.humidity_capacity_loss: float = 0.0 # Fraction lost to humidity corrosion

        self.sei_resistance_increase: float = 0.0   # Ohm
        self.cycle_resistance_increase: float = 0.0  # Ohm
        self.humidity_resistance_increase: float = 0.0  # Ohm from corrosion

        # History tracking
        self.capacity_history: list = []
        self.resistance_history: list = []

    @property
    def capacity_retention(self) -> float:
        """Remaining capacity as fraction of nominal (1.0 = fresh)."""
        total_loss = (self.sei_capacity_loss + self.cycle_capacity_loss +
                      self.plating_capacity_loss + self.humidity_capacity_loss)
        return max(1.0 - total_loss, 0.0)

    @property
    def resistance_factor(self) -> float:
        """Resistance increase factor (1.0 = fresh)."""
        r_total = (1.0 + self.sei_resistance_increase +
                   self.cycle_resistance_increase + self.humidity_resistance_increase)
        return min(r_total, self.params.max_resistance_factor)

    @property
    def state_of_health(self) -> float:
        """State of Health (SOH) as percentage."""
        return self.capacity_retention * 100.0

    @property
    def is_end_of_life(self) -> bool:
        """Check if battery has reached end of life."""
        return self.capacity_retention <= self.params.eol_capacity_fraction

    @property
    def remaining_useful_life_cycles(self) -> float:
        """Estimate remaining useful life in equivalent full cycles."""
        if self.total_cycles < 1:
            return 5000.0  # Default estimate for fresh cell

        degradation_per_cycle = (1.0 - self.capacity_retention) / max(self.total_cycles, 1)
        if degradation_per_cycle <= 0:
            return 10000.0

        remaining_budget = self.capacity_retention - self.params.eol_capacity_fraction
        return max(remaining_budget / degradation_per_cycle, 0.0)

    def _arrhenius_factor(self, Ea: float, T: float) -> float:
        """Temperature acceleration factor via Arrhenius equation."""
        return np.exp(Ea / R_GAS * (1.0 / self.params.T_ref - 1.0 / T))

    def _sei_growth_rate(self, T: float) -> float:
        """SEI layer growth rate for capacity loss [fraction / s]."""
        # d(Q_loss)/dt = k * exp(-Ea/(RT)) * 0.5 / sqrt(t)
        if self.total_time_s < 1.0:
            return 0.0

        rate = (self.params.k_sei * self._arrhenius_factor(self.params.Ea_sei, T) *
                0.5 / np.sqrt(self.total_time_s))
        return rate

    def _cycle_degradation_rate(self, current: float, T: float, soc: float,
                                 delta_soc: float) -> float:
        """Cycle aging degradation rate [fraction / s]."""
        if abs(current) < 0.01:
            return 0.0

        # C-rate
        c_rate = abs(current) / self.nominal_capacity_ah

        # DOD stress factor: deeper cycles cause more degradation
        dod_factor = 1.0 + self.params.k_dod * delta_soc

        # Ah throughput rate
        ah_rate = abs(current) / 3600.0  # [Ah/s]

        # Differentiated form: d(Q_loss)/d(Ah) * d(Ah)/dt
        if self.total_ah_throughput < 0.01:
            rate = self.params.k_cyc * self._arrhenius_factor(self.params.Ea_cyc, T) * ah_rate * dod_factor
        else:
            rate = (self.params.k_cyc * self._arrhenius_factor(self.params.Ea_cyc, T) *
                    self.params.z_cyc * self.total_ah_throughput ** (self.params.z_cyc - 1) *
                    ah_rate * dod_factor)
        return rate

    def _plating_rate(self, current: float, T: float, soc: float) -> float:
        """Lithium plating degradation rate [fraction / s]."""
        c_rate = abs(current) / self.nominal_capacity_ah

        # Plating only during charging at high C-rate and low temperature
        if current >= 0:  # Not charging
            return 0.0
        if T > self.params.T_plating_onset and c_rate < self.params.c_rate_plating_threshold:
            return 0.0

        # Temperature factor: exponentially worse at low temperatures
        T_factor = max(0.0, (self.params.T_plating_onset - T) / 10.0)

        # C-rate factor: worse at high charging rates
        c_factor = max(0.0, c_rate - self.params.c_rate_plating_threshold * 0.5)

        # SOC factor: worse at high SOC
        soc_factor = max(0.0, soc - 0.8) * 5.0

        rate = self.params.k_plating * (T_factor + c_factor) * (1.0 + soc_factor) * abs(current) / 3600.0
        return rate

    def _humidity_corrosion_rate(self, humidity_pct: float, T: float) -> tuple:
        """Humidity-driven corrosion rates for capacity loss and resistance growth.

        Moisture ingress past seals accelerates:
        - Connector/tab corrosion → resistance growth
        - Electrolyte contamination → self-discharge → capacity loss
        - Both are exponentially worse at high humidity and high temperature.

        Returns:
            (capacity_loss_rate, resistance_growth_rate)
        """
        excess_rh = max(0.0, humidity_pct - self.params.humidity_threshold_pct)
        if excess_rh < 0.01:
            return 0.0, 0.0

        # Temperature accelerates corrosion (Arrhenius-like)
        temp_factor = self._arrhenius_factor(self.params.Ea_sei, T) * 0.3  # reuse SEI activation energy

        cap_rate = self.params.k_humidity_self_discharge * excess_rh * temp_factor
        res_rate = self.params.k_humidity_corrosion * excess_rh * temp_factor

        return cap_rate, res_rate

    def step(self, current: float, voltage: float, T: float, soc: float, dt: float,
             delta_soc: float = 0.5, humidity_pct: float = 50.0) -> dict:
        """
        Update degradation state for one time step.

        Args:
            current: Applied current [A] (positive = discharge)
            voltage: Terminal voltage [V]
            T: Cell temperature [K]
            soc: Current state of charge [0-1]
            dt: Time step [s]
            delta_soc: Depth of discharge for current cycle [0-1]

        Returns:
            dict with degradation metrics
        """
        # Update cumulative counters
        self.total_time_s += dt
        ah_increment = abs(current) * dt / 3600.0
        self.total_ah_throughput += ah_increment
        self.total_energy_wh += abs(current * voltage) * dt / 3600.0
        self.total_cycles = self.total_ah_throughput / (2 * self.nominal_capacity_ah)

        # Calculate degradation rates
        sei_rate = self._sei_growth_rate(T)
        cyc_rate = self._cycle_degradation_rate(current, T, soc, delta_soc)
        plating_rate = self._plating_rate(current, T, soc)

        # Update capacity losses
        self.sei_capacity_loss += sei_rate * dt
        self.cycle_capacity_loss += cyc_rate * dt
        self.plating_capacity_loss += plating_rate * dt

        # Humidity / corrosion effects
        hum_cap_rate, hum_res_rate = self._humidity_corrosion_rate(humidity_pct, T)
        self.humidity_capacity_loss += hum_cap_rate * dt
        self.humidity_resistance_increase += hum_res_rate * dt

        # Update resistance increases
        sei_r_rate = (self.params.k_sei_resistance * self._arrhenius_factor(self.params.Ea_sei, T) *
                      0.5 / max(np.sqrt(self.total_time_s), 0.01))
        cyc_r_rate = self.params.k_cyc_resistance * abs(current) / 3600.0 if abs(current) > 0.01 else 0.0

        self.sei_resistance_increase += sei_r_rate * dt
        self.cycle_resistance_increase += cyc_r_rate * dt

        return {
            "soh_pct": self.state_of_health,
            "capacity_retention": self.capacity_retention,
            "resistance_factor": self.resistance_factor,
            "sei_loss_pct": self.sei_capacity_loss * 100,
            "cycle_loss_pct": self.cycle_capacity_loss * 100,
            "plating_loss_pct": self.plating_capacity_loss * 100,
            "humidity_loss_pct": self.humidity_capacity_loss * 100,
            "total_ah_throughput": self.total_ah_throughput,
            "equivalent_cycles": self.total_cycles,
            "total_energy_wh": self.total_energy_wh,
            "remaining_cycles": self.remaining_useful_life_cycles,
            "is_eol": self.is_end_of_life,
            "total_time_hours": self.total_time_s / 3600.0,
        }

    def get_degradation_breakdown(self) -> dict:
        """Get detailed breakdown of all degradation mechanisms."""
        return {
            "total_capacity_loss_pct": (1.0 - self.capacity_retention) * 100,
            "sei_contribution_pct": self.sei_capacity_loss * 100,
            "cycle_contribution_pct": self.cycle_capacity_loss * 100,
            "plating_contribution_pct": self.plating_capacity_loss * 100,
            "humidity_contribution_pct": self.humidity_capacity_loss * 100,
            "resistance_increase_pct": (self.resistance_factor - 1.0) * 100,
            "sei_resistance_pct": self.sei_resistance_increase * 100,
            "cycle_resistance_pct": self.cycle_resistance_increase * 100,
            "humidity_resistance_pct": self.humidity_resistance_increase * 100,
        }

    def reset(self):
        """Reset all degradation state (fresh battery)."""
        self.total_time_s = 0.0
        self.total_ah_throughput = 0.0
        self.total_energy_wh = 0.0
        self.total_cycles = 0.0
        self.sei_capacity_loss = 0.0
        self.cycle_capacity_loss = 0.0
        self.plating_capacity_loss = 0.0
        self.humidity_capacity_loss = 0.0
        self.sei_resistance_increase = 0.0
        self.cycle_resistance_increase = 0.0
        self.humidity_resistance_increase = 0.0
        self.capacity_history.clear()
        self.resistance_history.clear()
