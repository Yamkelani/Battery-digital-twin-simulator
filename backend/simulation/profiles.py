"""
Load Profiles for Battery Simulation
=======================================

Defines various current/power load profiles:
    1. Constant Current (CC) charge/discharge
    2. CCCV (Constant Current - Constant Voltage) charging
    3. Drive Cycle (dynamic load)
    4. Solar Storage (PV + battery for self-consumption)
    5. Custom profile from time-series data
"""

import numpy as np
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Optional, List


class LoadProfile(ABC):
    """Base class for all load profiles."""

    @abstractmethod
    def get_current(self, time_s: float, soc: float, voltage: float) -> float:
        """
        Return the current demand at a given time.

        Args:
            time_s: Elapsed simulation time [s]
            soc: Current state of charge [0-1]
            voltage: Current terminal voltage [V]

        Returns:
            Current [A] (positive = discharge, negative = charge)
        """
        pass

    @abstractmethod
    def is_complete(self, time_s: float, soc: float) -> bool:
        """Check if the profile has completed."""
        pass

    @property
    @abstractmethod
    def name(self) -> str:
        pass

    @property
    @abstractmethod
    def description(self) -> str:
        pass


class ConstantCurrentProfile(LoadProfile):
    """Constant current charge or discharge."""

    def __init__(self, current_a: float = 25.0, soc_limit_low: float = 0.05,
                 soc_limit_high: float = 0.95, duration_s: Optional[float] = None):
        """
        Args:
            current_a: Current magnitude [A] (positive = discharge)
            soc_limit_low: Stop discharge at this SOC
            soc_limit_high: Stop charge at this SOC
            duration_s: Optional max duration
        """
        self.current_a = current_a
        self.soc_limit_low = soc_limit_low
        self.soc_limit_high = soc_limit_high
        self.duration_s = duration_s

    def get_current(self, time_s: float, soc: float, voltage: float) -> float:
        if self.is_complete(time_s, soc):
            return 0.0

        # During discharge (positive current), stop at low SOC
        if self.current_a > 0 and soc <= self.soc_limit_low:
            return 0.0
        # During charge (negative current), stop at high SOC
        if self.current_a < 0 and soc >= self.soc_limit_high:
            return 0.0

        return self.current_a

    def is_complete(self, time_s: float, soc: float) -> bool:
        if self.duration_s and time_s >= self.duration_s:
            return True
        if self.current_a > 0 and soc <= self.soc_limit_low:
            return True
        if self.current_a < 0 and soc >= self.soc_limit_high:
            return True
        return False

    @property
    def name(self) -> str:
        mode = "Discharge" if self.current_a > 0 else "Charge"
        return f"CC {mode} @ {abs(self.current_a):.1f}A"

    @property
    def description(self) -> str:
        mode = "discharge" if self.current_a > 0 else "charge"
        return f"Constant current {mode} at {abs(self.current_a):.1f}A"


class CCCVProfile(LoadProfile):
    """Constant Current - Constant Voltage charging protocol."""

    def __init__(self, charge_current_a: float = -25.0, cv_voltage: float = 4.2,
                 cutoff_current_a: float = 1.25, soc_limit: float = 0.98):
        self.charge_current_a = charge_current_a  # Negative for charging
        self.cv_voltage = cv_voltage
        self.cutoff_current_a = cutoff_current_a  # |I| below this → complete
        self.soc_limit = soc_limit
        self._in_cv_phase = False
        self._cv_current = charge_current_a

    def get_current(self, time_s: float, soc: float, voltage: float) -> float:
        if self.is_complete(time_s, soc):
            return 0.0

        if not self._in_cv_phase:
            # CC phase
            if voltage >= self.cv_voltage:
                self._in_cv_phase = True
                self._cv_current = self.charge_current_a
            return self.charge_current_a
        else:
            # CV phase: taper current to maintain voltage
            # Simplified: exponential taper
            self._cv_current *= 0.999
            if abs(self._cv_current) < self.cutoff_current_a:
                return 0.0
            return self._cv_current

    def is_complete(self, time_s: float, soc: float) -> bool:
        if soc >= self.soc_limit:
            return True
        if self._in_cv_phase and abs(self._cv_current) < self.cutoff_current_a:
            return True
        return False

    @property
    def name(self) -> str:
        return f"CCCV Charge @ {abs(self.charge_current_a):.1f}A"

    @property
    def description(self) -> str:
        return f"CCCV charging: CC at {abs(self.charge_current_a):.1f}A then CV at {self.cv_voltage:.2f}V"


class DriveProfile(LoadProfile):
    """
    Simulated drive cycle load profile.

    Generates a realistic driving power demand with regenerative braking.
    Based on simplified urban + highway driving patterns.
    """

    def __init__(self, nominal_capacity_ah: float = 50.0, duration_s: float = 3600.0,
                 aggressiveness: float = 1.0):
        """
        Args:
            nominal_capacity_ah: Battery capacity for C-rate scaling
            duration_s: Total drive duration
            aggressiveness: 0.5=calm, 1.0=normal, 2.0=aggressive
        """
        self.nominal_capacity_ah = nominal_capacity_ah
        self.duration_s = duration_s
        self.aggressiveness = aggressiveness
        self._generate_profile()

    def _generate_profile(self):
        """Pre-generate the drive cycle current profile."""
        np.random.seed(42)
        t = np.arange(0, self.duration_s, 1.0)
        n = len(t)

        # Base driving load (urban pattern)
        urban_freq = 2 * np.pi / 120  # 2-minute cycle
        highway_freq = 2 * np.pi / 600  # 10-minute cycle

        current = np.zeros(n)

        # Urban driving component (frequent acceleration/braking)
        current += 15.0 * self.aggressiveness * np.sin(urban_freq * t)
        current += 8.0 * self.aggressiveness * np.sin(3 * urban_freq * t + 0.5)

        # Highway cruise component
        current += 20.0 * self.aggressiveness * (0.5 + 0.3 * np.sin(highway_freq * t))

        # Random acceleration events
        for _ in range(int(20 * self.aggressiveness)):
            t_event = np.random.uniform(0, self.duration_s)
            width = np.random.uniform(5, 30)
            magnitude = np.random.uniform(20, 50) * self.aggressiveness
            current += magnitude * np.exp(-0.5 * ((t - t_event) / width) ** 2)

        # Regenerative braking events (negative current = charging)
        for _ in range(int(15 * self.aggressiveness)):
            t_event = np.random.uniform(0, self.duration_s)
            width = np.random.uniform(3, 15)
            magnitude = np.random.uniform(-30, -10) * self.aggressiveness
            current += magnitude * np.exp(-0.5 * ((t - t_event) / width) ** 2)

        # Ensure net discharge (driving consumes energy)
        current = np.clip(current, -self.nominal_capacity_ah * 0.5, self.nominal_capacity_ah * 2.0)

        self._times = t
        self._currents = current

    def get_current(self, time_s: float, soc: float, voltage: float) -> float:
        if self.is_complete(time_s, soc):
            return 0.0
        if soc <= 0.05:
            return 0.0  # Battery empty

        idx = int(time_s) % len(self._currents)
        return float(self._currents[idx])

    def is_complete(self, time_s: float, soc: float) -> bool:
        return time_s >= self.duration_s or soc <= 0.05

    @property
    def name(self) -> str:
        return f"Drive Cycle ({self.aggressiveness:.1f}x)"

    @property
    def description(self) -> str:
        return f"Simulated drive cycle, aggressiveness={self.aggressiveness:.1f}"


class SolarStorageProfile(LoadProfile):
    """
    Solar + Battery Storage load profile.

    Simulates a 24-hour solar day with:
        - PV generation (bell curve peaking at noon)
        - Household load demand
        - Battery arbitrage: charge from PV, discharge to meet demand
    """

    def __init__(self, pv_peak_kw: float = 5.0, load_base_kw: float = 1.5,
                 load_peak_kw: float = 4.0, battery_voltage: float = 3.7,
                 num_cells_series: int = 14, duration_s: float = 86400.0):
        """
        Args:
            pv_peak_kw: Peak PV generation [kW]
            load_base_kw: Base household load [kW]
            load_peak_kw: Peak household load [kW]
            battery_voltage: Nominal cell voltage
            num_cells_series: Number of cells in series (for voltage)
            duration_s: Simulation duration (default 24h)
        """
        self.pv_peak_kw = pv_peak_kw
        self.load_base_kw = load_base_kw
        self.load_peak_kw = load_peak_kw
        self.system_voltage = battery_voltage * num_cells_series
        self.duration_s = duration_s

    def _pv_power(self, time_s: float) -> float:
        """PV generation power [kW] as function of time of day."""
        hour = (time_s / 3600.0) % 24.0

        # Sunrise ~6am, sunset ~18pm, peak at noon
        if hour < 6.0 or hour > 18.0:
            return 0.0

        # Bell curve centered at noon
        solar_hour = hour - 12.0
        pv = self.pv_peak_kw * np.exp(-0.5 * (solar_hour / 2.5) ** 2)

        # Add some cloud variation
        cloud_factor = 0.85 + 0.15 * np.sin(2 * np.pi * time_s / 1800)
        return max(pv * cloud_factor, 0.0)

    def _load_power(self, time_s: float) -> float:
        """Household load [kW] as function of time of day."""
        hour = (time_s / 3600.0) % 24.0

        # Base load + morning peak + evening peak
        load = self.load_base_kw

        # Morning peak (7-9am)
        load += (self.load_peak_kw - self.load_base_kw) * 0.4 * np.exp(-0.5 * ((hour - 8) / 1.0) ** 2)

        # Evening peak (17-21pm)
        load += (self.load_peak_kw - self.load_base_kw) * np.exp(-0.5 * ((hour - 19) / 1.5) ** 2)

        # Night low (0-5am)
        if hour < 5:
            load *= 0.5

        return load

    def get_current(self, time_s: float, soc: float, voltage: float) -> float:
        if self.is_complete(time_s, soc):
            return 0.0

        pv_kw = self._pv_power(time_s)
        load_kw = self._load_power(time_s)

        # Net power: positive = excess PV (charge battery), negative = deficit (discharge)
        net_kw = pv_kw - load_kw

        # Convert to battery current (positive = discharge = deficit)
        # Current = Power / Voltage
        effective_voltage = max(voltage, 2.5)  # Prevent division issues
        current_a = -(net_kw * 1000.0) / effective_voltage  # Negative net → positive discharge

        # Limit charge when battery is full
        if current_a < 0 and soc >= 0.95:
            current_a = 0.0

        # Limit discharge when battery is empty
        if current_a > 0 and soc <= 0.10:
            current_a = 0.0

        # Clamp to reasonable C-rates
        max_current = 50.0  # Cap at 1C for 50Ah battery
        current_a = np.clip(current_a, -max_current, max_current)

        return float(current_a)

    def is_complete(self, time_s: float, soc: float) -> bool:
        return time_s >= self.duration_s

    @property
    def name(self) -> str:
        return f"Solar Storage ({self.pv_peak_kw:.1f}kW PV)"

    @property
    def description(self) -> str:
        return (f"Solar self-consumption: {self.pv_peak_kw:.1f}kW PV, "
                f"{self.load_base_kw:.1f}-{self.load_peak_kw:.1f}kW load")


class CycleAgingProfile(LoadProfile):
    """
    Repeated charge-discharge cycles for accelerated aging studies.

    Cycles between SOC limits at specified C-rate.
    """

    def __init__(self, c_rate: float = 1.0, nominal_capacity_ah: float = 50.0,
                 soc_min: float = 0.1, soc_max: float = 0.9,
                 num_cycles: int = 100, rest_between_s: float = 300.0):
        self.current_magnitude = c_rate * nominal_capacity_ah
        self.soc_min = soc_min
        self.soc_max = soc_max
        self.num_cycles = num_cycles
        self.rest_between_s = rest_between_s
        self._cycle_count = 0
        self._phase = "discharge"  # discharge, rest_after_discharge, charge, rest_after_charge
        self._rest_timer = 0.0

    def get_current(self, time_s: float, soc: float, voltage: float) -> float:
        if self.is_complete(time_s, soc):
            return 0.0

        if self._phase == "discharge":
            if soc <= self.soc_min:
                self._phase = "rest_after_discharge"
                self._rest_timer = 0.0
                return 0.0
            return self.current_magnitude  # Positive = discharge

        elif self._phase == "rest_after_discharge":
            self._rest_timer += 1.0
            if self._rest_timer >= self.rest_between_s:
                self._phase = "charge"
            return 0.0

        elif self._phase == "charge":
            if soc >= self.soc_max:
                self._phase = "rest_after_charge"
                self._rest_timer = 0.0
                self._cycle_count += 1
                return 0.0
            return -self.current_magnitude  # Negative = charge

        elif self._phase == "rest_after_charge":
            self._rest_timer += 1.0
            if self._rest_timer >= self.rest_between_s:
                self._phase = "discharge"
            return 0.0

        return 0.0

    def is_complete(self, time_s: float, soc: float) -> bool:
        return self._cycle_count >= self.num_cycles

    @property
    def name(self) -> str:
        return f"Cycle Aging ({self.num_cycles} cycles)"

    @property
    def description(self) -> str:
        return f"Repeated cycling: {self.num_cycles} cycles, SOC {self.soc_min}-{self.soc_max}"


# ═══════════════════════════════════════════════════════════════════
# Additional Profiles for Complete Scenario Coverage
# ═══════════════════════════════════════════════════════════════════


class PulseDischargeProfile(LoadProfile):
    """
    Pulse Discharge Profile for power-tool / grid regulation testing.

    Alternates between high-current discharge pulses and rest periods.
    Models intermittent high-power loads (power tools, grid frequency
    regulation, start-stop automotive, radar/communication bursts).
    """

    def __init__(self, nominal_capacity_ah: float = 50.0,
                 pulse_c_rate: float = 3.0, pulse_duration_s: float = 10.0,
                 rest_duration_s: float = 30.0, num_pulses: int = 100,
                 soc_min: float = 0.1):
        self.pulse_current = pulse_c_rate * nominal_capacity_ah
        self.pulse_duration_s = pulse_duration_s
        self.rest_duration_s = rest_duration_s
        self.num_pulses = num_pulses
        self.soc_min = soc_min
        self.cycle_period = pulse_duration_s + rest_duration_s

    def get_current(self, time_s: float, soc: float, voltage: float) -> float:
        if self.is_complete(time_s, soc):
            return 0.0
        if soc <= self.soc_min:
            return 0.0

        # Determine position within the current pulse cycle
        cycle_pos = time_s % self.cycle_period
        if cycle_pos < self.pulse_duration_s:
            return self.pulse_current  # Discharge pulse
        return 0.0  # Rest

    def is_complete(self, time_s: float, soc: float) -> bool:
        if soc <= self.soc_min:
            return True
        return time_s >= self.num_pulses * self.cycle_period

    @property
    def name(self) -> str:
        return f"Pulse Discharge ({self.pulse_current:.0f}A)"

    @property
    def description(self) -> str:
        return (f"Pulse discharge: {self.pulse_current:.0f}A for {self.pulse_duration_s:.0f}s, "
                f"rest {self.rest_duration_s:.0f}s, {self.num_pulses} pulses")


class RestStorageProfile(LoadProfile):
    """
    Rest / Calendar Storage Profile.

    No current applied — the cell just sits at a fixed SOC and temperature.
    Used with accelerated degradation to study calendar aging (SEI growth,
    self-discharge) without any cycling.
    """

    def __init__(self, duration_s: float = 86400.0, self_discharge_rate: float = 0.0):
        """
        Args:
            duration_s: Storage duration to simulate [s]
            self_discharge_rate: Optional tiny drain [A] simulating parasitic self-discharge
        """
        self.duration_s = duration_s
        self.self_discharge_rate = self_discharge_rate

    def get_current(self, time_s: float, soc: float, voltage: float) -> float:
        if self.is_complete(time_s, soc):
            return 0.0
        return self.self_discharge_rate  # Usually 0 or very small positive value

    def is_complete(self, time_s: float, soc: float) -> bool:
        return time_s >= self.duration_s

    @property
    def name(self) -> str:
        return "Calendar Storage"

    @property
    def description(self) -> str:
        hours = self.duration_s / 3600
        return f"Calendar aging study: {hours:.0f}h rest at fixed SOC"


class ConstantPowerProfile(LoadProfile):
    """
    Constant Power Discharge/Charge Profile.

    Maintains constant power output (W) by adjusting current as voltage changes.
    This is more realistic than constant current for many applications:
        - ESS grid discharge (kW setpoint)
        - EV cruise at constant speed (power demand)
        - UPS backup (power rating)
    """

    def __init__(self, power_w: float = 200.0, nominal_capacity_ah: float = 50.0,
                 soc_limit_low: float = 0.05, soc_limit_high: float = 0.95,
                 duration_s: Optional[float] = None):
        """
        Args:
            power_w: Target power [W]. Positive = discharge, negative = charge.
            soc_limit_low: Stop discharging at this SOC.
            soc_limit_high: Stop charging at this SOC.
            duration_s: Optional max run time [s].
        """
        self.power_w = power_w
        self.nominal_capacity_ah = nominal_capacity_ah
        self.soc_limit_low = soc_limit_low
        self.soc_limit_high = soc_limit_high
        self.duration_s = duration_s

    def get_current(self, time_s: float, soc: float, voltage: float) -> float:
        if self.is_complete(time_s, soc):
            return 0.0

        # I = P / V  —  prevent division-by-zero
        effective_voltage = max(voltage, 2.0)
        current = self.power_w / effective_voltage

        # Clamp to safe limits (10C max)
        max_current = 10.0 * self.nominal_capacity_ah
        current = np.clip(current, -max_current, max_current)

        # SOC guard
        if current > 0 and soc <= self.soc_limit_low:
            return 0.0
        if current < 0 and soc >= self.soc_limit_high:
            return 0.0

        return float(current)

    def is_complete(self, time_s: float, soc: float) -> bool:
        if self.duration_s and time_s >= self.duration_s:
            return True
        if self.power_w > 0 and soc <= self.soc_limit_low:
            return True
        if self.power_w < 0 and soc >= self.soc_limit_high:
            return True
        return False

    @property
    def name(self) -> str:
        mode = "Discharge" if self.power_w > 0 else "Charge"
        return f"Constant Power {mode} @ {abs(self.power_w):.0f}W"

    @property
    def description(self) -> str:
        mode = "discharge" if self.power_w > 0 else "charge"
        return f"Constant power {mode} at {abs(self.power_w):.0f}W"


class GridRegulationProfile(LoadProfile):
    """
    Grid Frequency Regulation Profile.

    Simulates a battery providing grid ancillary services — rapid alternating
    charge and discharge at varying power levels in response to frequency
    deviations.  Models both symmetric (charge = discharge) and asymmetric
    regulation.
    """

    def __init__(self, nominal_capacity_ah: float = 50.0,
                 max_c_rate: float = 1.0, duration_s: float = 3600.0,
                 regulation_period_s: float = 4.0):
        """
        Args:
            max_c_rate: Maximum C-rate for regulation response.
            duration_s: Service duration [s].
            regulation_period_s: Average period of frequency regulation signal [s].
        """
        self.nominal_capacity_ah = nominal_capacity_ah
        self.max_current = max_c_rate * nominal_capacity_ah
        self.duration_s = duration_s
        self.regulation_period_s = regulation_period_s
        self._generate_signal()

    def _generate_signal(self):
        """Pre-generate a realistic grid regulation signal."""
        rng = np.random.default_rng(123)
        t = np.arange(0, self.duration_s, 1.0)
        n = len(t)

        # Superposition of sinusoids at different frequencies
        freq1 = 2 * np.pi / self.regulation_period_s
        freq2 = 2 * np.pi / (self.regulation_period_s * 3.7)
        freq3 = 2 * np.pi / (self.regulation_period_s * 0.3)

        signal = (0.4 * np.sin(freq1 * t + rng.uniform(0, 2 * np.pi)) +
                  0.3 * np.sin(freq2 * t + rng.uniform(0, 2 * np.pi)) +
                  0.2 * np.sin(freq3 * t + rng.uniform(0, 2 * np.pi)))

        # Add random step changes (AGC dispatch)
        for _ in range(int(self.duration_s / 60)):
            t_step = rng.uniform(0, self.duration_s)
            width = rng.uniform(10, 60)
            mag = rng.uniform(-0.8, 0.8)
            signal += mag * np.where(np.abs(t - t_step) < width / 2, 1.0, 0.0)

        # Normalize to [-1, 1] then scale to current
        signal = np.clip(signal, -1, 1)
        self._times = t
        self._currents = signal * self.max_current

    def get_current(self, time_s: float, soc: float, voltage: float) -> float:
        if self.is_complete(time_s, soc):
            return 0.0

        # SOC management: reduce service when near limits
        soc_factor = 1.0
        if soc < 0.15:
            soc_factor = max(0, (soc - 0.05) / 0.10)  # Fade out discharge
        elif soc > 0.85:
            soc_factor = max(0, (0.95 - soc) / 0.10)  # Fade out charge

        idx = min(int(time_s), len(self._currents) - 1)
        raw_current = float(self._currents[idx])

        # Only attenuate when current direction would violate SOC bounds
        if raw_current > 0 and soc < 0.15:
            raw_current *= soc_factor
        elif raw_current < 0 and soc > 0.85:
            raw_current *= soc_factor

        return raw_current

    def is_complete(self, time_s: float, soc: float) -> bool:
        return time_s >= self.duration_s

    @property
    def name(self) -> str:
        return f"Grid Regulation (±{self.max_current:.0f}A)"

    @property
    def description(self) -> str:
        return (f"Grid frequency regulation: ±{self.max_current:.0f}A, "
                f"{self.duration_s/3600:.1f}h service window")


class HPPCProfile(LoadProfile):
    """
    Hybrid Pulse Power Characterization (HPPC) Profile.

    Standard test protocol used to characterize battery impedance and
    power capability at multiple SOC points.

    Protocol at each SOC:
        1. 10s discharge pulse at specified C-rate
        2. 40s rest
        3. 10s charge (regen) pulse
        4. Rest until next SOC point

    Sweeps from high SOC to low SOC in configurable steps.
    """

    def __init__(self, nominal_capacity_ah: float = 50.0,
                 pulse_c_rate: float = 1.0, soc_points: int = 10,
                 pulse_duration_s: float = 10.0, rest_duration_s: float = 40.0,
                 soc_step_rest_s: float = 600.0):
        self.nominal_capacity_ah = nominal_capacity_ah
        self.pulse_current = pulse_c_rate * nominal_capacity_ah
        self.soc_points = soc_points
        self.pulse_duration_s = pulse_duration_s
        self.rest_duration_s = rest_duration_s
        self.soc_step_rest_s = soc_step_rest_s

        # SOC targets from 0.9 down to 0.1
        self._soc_targets = np.linspace(0.9, 0.1, soc_points).tolist()
        self._current_soc_idx = 0

        # Phases within each SOC point
        # discharge_pulse → rest1 → charge_pulse → rest2 → discharge_to_next_soc
        self._phase = "discharge_to_next_soc"
        self._phase_timer = 0.0
        self._completed = False

    def get_current(self, time_s: float, soc: float, voltage: float) -> float:
        if self._completed:
            return 0.0

        if self._current_soc_idx >= self.soc_points:
            self._completed = True
            return 0.0

        target_soc = self._soc_targets[self._current_soc_idx]

        if self._phase == "discharge_to_next_soc":
            if soc <= target_soc + 0.005:
                # Arrived at target SOC, start HPPC sequence
                self._phase = "discharge_pulse"
                self._phase_timer = 0.0
                return 0.0
            # Gentle discharge to reach target SOC
            return 0.3 * self.nominal_capacity_ah

        elif self._phase == "discharge_pulse":
            self._phase_timer += 1.0
            if self._phase_timer >= self.pulse_duration_s:
                self._phase = "rest1"
                self._phase_timer = 0.0
                return 0.0
            return self.pulse_current

        elif self._phase == "rest1":
            self._phase_timer += 1.0
            if self._phase_timer >= self.rest_duration_s:
                self._phase = "charge_pulse"
                self._phase_timer = 0.0
            return 0.0

        elif self._phase == "charge_pulse":
            self._phase_timer += 1.0
            if self._phase_timer >= self.pulse_duration_s:
                self._phase = "rest2"
                self._phase_timer = 0.0
                return 0.0
            return -self.pulse_current  # Regen pulse

        elif self._phase == "rest2":
            self._phase_timer += 1.0
            if self._phase_timer >= self.soc_step_rest_s:
                self._current_soc_idx += 1
                self._phase = "discharge_to_next_soc"
                self._phase_timer = 0.0
            return 0.0

        return 0.0

    def is_complete(self, time_s: float, soc: float) -> bool:
        return self._completed or self._current_soc_idx >= self.soc_points

    @property
    def name(self) -> str:
        return f"HPPC ({self.soc_points} SOC pts)"

    @property
    def description(self) -> str:
        return (f"Hybrid Pulse Power Characterization: {self.soc_points} SOC points, "
                f"{self.pulse_current:.0f}A pulses")
