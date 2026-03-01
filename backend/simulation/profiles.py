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
