"""
Multi-Chemistry Battery Presets
=================================

Provides parameterized chemistry presets for different Li-ion cathode chemistries:
    - NMC622 / Graphite  (default — balanced energy/power)
    - NMC811 / Graphite   (high energy density)
    - LFP / Graphite      (long cycle life, flat voltage)
    - NCA / Graphite      (high energy, Tesla-style)
    - LTO / NMC           (ultra-fast charge, long life)
    - Solid-State (Li-metal anode, experimental)

Each preset provides complete ECM, thermal, degradation, and SPM parameters
calibrated to representative published data for that chemistry.
"""

import numpy as np
from dataclasses import dataclass, field
from typing import Dict, Any

from .equivalent_circuit import ECMParameters
from .thermal import ThermalParameters
from .degradation import DegradationParameters
from .electrochemical import SPMParameters


@dataclass
class ChemistryPreset:
    """Complete parameterisation for a battery chemistry."""
    id: str
    name: str
    description: str
    cathode: str
    anode: str
    nominal_voltage: float
    voltage_range: tuple  # (V_min, V_max)
    energy_density_wh_kg: float
    cycle_life: int  # typical cycles to 80% SOH
    ecm: ECMParameters = field(default_factory=ECMParameters)
    thermal: ThermalParameters = field(default_factory=ThermalParameters)
    degradation: DegradationParameters = field(default_factory=DegradationParameters)
    spm: SPMParameters = field(default_factory=SPMParameters)


def _nmc622_preset() -> ChemistryPreset:
    """NMC622/Graphite — balanced energy and power, standard EV chemistry."""
    return ChemistryPreset(
        id="nmc622",
        name="NMC622/Graphite",
        description="Balanced energy/power density. Standard EV chemistry (VW ID, BMW i4).",
        cathode="LiNi₀.₆Mn₀.₂Co₀.₂O₂",
        anode="Graphite",
        nominal_voltage=3.7,
        voltage_range=(2.5, 4.2),
        energy_density_wh_kg=180,
        cycle_life=1500,
        ecm=ECMParameters(
            capacity_ah=50.0,
            nominal_voltage=3.7,
            R0_ref=0.015,
            R1_ref=0.010,
            C1_ref=1000.0,
            R2_ref=0.005,
            C2_ref=20000.0,
            V_max=4.2,
            V_min=2.5,
            soc_breakpoints=np.array([0.0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45,
                                       0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0]),
            ocv_values=np.array([2.50, 3.28, 3.42, 3.50, 3.55, 3.58, 3.61, 3.63, 3.65, 3.67,
                                  3.70, 3.73, 3.77, 3.80, 3.85, 3.90, 3.96, 4.02, 4.08, 4.14, 4.20]),
            entropy_coefficient=-0.0001,
        ),
    )


def _nmc811_preset() -> ChemistryPreset:
    """NMC811/Graphite — high energy density, aggressive cathode."""
    ecm = ECMParameters(
        capacity_ah=50.0,
        nominal_voltage=3.7,
        R0_ref=0.012,
        R1_ref=0.008,
        C1_ref=1200.0,
        R2_ref=0.004,
        C2_ref=25000.0,
        V_max=4.25,
        V_min=2.5,
        soc_breakpoints=np.array([0.0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45,
                                   0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0]),
        ocv_values=np.array([2.50, 3.30, 3.45, 3.53, 3.57, 3.60, 3.62, 3.64, 3.66, 3.68,
                              3.71, 3.74, 3.78, 3.82, 3.87, 3.93, 3.99, 4.06, 4.12, 4.19, 4.25]),
        entropy_coefficient=-0.00012,
    )
    deg = DegradationParameters()
    deg.sei_rate_factor = 1.3  # faster SEI than NMC622
    deg.cycle_rate_factor = 1.2  # more cycle stress
    return ChemistryPreset(
        id="nmc811",
        name="NMC811/Graphite",
        description="High energy density. Used in newer EVs (Tesla Model 3 LR, Hyundai Ioniq 5).",
        cathode="LiNi₀.₈Mn₀.₁Co₀.₁O₂",
        anode="Graphite",
        nominal_voltage=3.7,
        voltage_range=(2.5, 4.25),
        energy_density_wh_kg=220,
        cycle_life=1000,
        ecm=ecm,
        degradation=deg,
    )


def _lfp_preset() -> ChemistryPreset:
    """LFP/Graphite — long life, flat voltage, very safe."""
    ecm = ECMParameters(
        capacity_ah=50.0,
        nominal_voltage=3.2,
        R0_ref=0.018,
        R1_ref=0.012,
        C1_ref=800.0,
        R2_ref=0.006,
        C2_ref=15000.0,
        V_max=3.65,
        V_min=2.0,
        soc_breakpoints=np.array([0.0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45,
                                   0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0]),
        # LFP has a very flat plateau ~3.3V
        ocv_values=np.array([2.00, 2.80, 3.05, 3.18, 3.23, 3.26, 3.28, 3.29, 3.30, 3.31,
                              3.32, 3.32, 3.33, 3.33, 3.34, 3.34, 3.35, 3.36, 3.40, 3.50, 3.65]),
        entropy_coefficient=-0.00004,
        Ea_R0=18000.0,
        Ea_R1=22000.0,
        Ea_R2=26000.0,
    )
    deg = DegradationParameters()
    deg.sei_rate_factor = 0.5  # much slower SEI
    deg.cycle_rate_factor = 0.4  # excellent cycle life
    deg.plating_rate_factor = 0.3  # less plating-prone
    return ChemistryPreset(
        id="lfp",
        name="LFP/Graphite",
        description="Long cycle life, very safe, flat voltage profile. (Tesla Model 3 SR, BYD Blade).",
        cathode="LiFePO₄",
        anode="Graphite",
        nominal_voltage=3.2,
        voltage_range=(2.0, 3.65),
        energy_density_wh_kg=140,
        cycle_life=4000,
        ecm=ecm,
        degradation=deg,
    )


def _nca_preset() -> ChemistryPreset:
    """NCA/Graphite — high energy, good power."""
    ecm = ECMParameters(
        capacity_ah=50.0,
        nominal_voltage=3.65,
        R0_ref=0.013,
        R1_ref=0.009,
        C1_ref=1100.0,
        R2_ref=0.004,
        C2_ref=22000.0,
        V_max=4.2,
        V_min=2.5,
        soc_breakpoints=np.array([0.0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45,
                                   0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0]),
        ocv_values=np.array([2.50, 3.25, 3.40, 3.48, 3.53, 3.57, 3.60, 3.62, 3.64, 3.66,
                              3.69, 3.72, 3.76, 3.80, 3.85, 3.90, 3.96, 4.02, 4.08, 4.14, 4.20]),
        entropy_coefficient=-0.00011,
    )
    deg = DegradationParameters()
    deg.sei_rate_factor = 1.1
    deg.cycle_rate_factor = 1.0
    return ChemistryPreset(
        id="nca",
        name="NCA/Graphite",
        description="High energy density, good power. (Tesla Model S/X, Panasonic 2170).",
        cathode="LiNi₀.₈Co₀.₁₅Al₀.₀₅O₂",
        anode="Graphite",
        nominal_voltage=3.65,
        voltage_range=(2.5, 4.2),
        energy_density_wh_kg=200,
        cycle_life=1200,
        ecm=ecm,
        degradation=deg,
    )


def _lto_preset() -> ChemistryPreset:
    """LTO/NMC — ultra-fast charge, extreme cycle life, very safe."""
    ecm = ECMParameters(
        capacity_ah=30.0,  # typically lower capacity
        nominal_voltage=2.3,
        R0_ref=0.008,  # very low resistance
        R1_ref=0.005,
        C1_ref=2000.0,
        R2_ref=0.003,
        C2_ref=30000.0,
        V_max=2.8,
        V_min=1.5,
        soc_breakpoints=np.array([0.0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45,
                                   0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0]),
        # LTO has a very flat plateau ~2.3V
        ocv_values=np.array([1.50, 1.90, 2.10, 2.18, 2.22, 2.25, 2.27, 2.28, 2.29, 2.30,
                              2.31, 2.32, 2.33, 2.34, 2.35, 2.37, 2.40, 2.45, 2.55, 2.68, 2.80]),
        entropy_coefficient=-0.00002,
        Ea_R0=15000.0,
        Ea_R1=18000.0,
        Ea_R2=20000.0,
    )
    deg = DegradationParameters()
    deg.sei_rate_factor = 0.2  # negligible SEI on LTO
    deg.cycle_rate_factor = 0.15  # extraordinary cycle life
    deg.plating_rate_factor = 0.05  # LTO anode is virtually plating-free
    return ChemistryPreset(
        id="lto",
        name="LTO/NMC",
        description="Ultra-fast charge (10C+), 20,000+ cycle life. Grid storage, buses. (Toshiba SCiB).",
        cathode="NMC",
        anode="Li₄Ti₅O₁₂",
        nominal_voltage=2.3,
        voltage_range=(1.5, 2.8),
        energy_density_wh_kg=80,
        cycle_life=20000,
        ecm=ecm,
        degradation=deg,
    )


def _solid_state_preset() -> ChemistryPreset:
    """Solid-State Li-metal — experimental next-gen technology."""
    ecm = ECMParameters(
        capacity_ah=60.0,
        nominal_voltage=3.8,
        R0_ref=0.020,  # higher ionic resistance in solid electrolyte
        R1_ref=0.015,
        C1_ref=800.0,
        R2_ref=0.008,
        C2_ref=12000.0,
        V_max=4.4,
        V_min=2.8,
        soc_breakpoints=np.array([0.0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45,
                                   0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95, 1.0]),
        ocv_values=np.array([2.80, 3.35, 3.50, 3.58, 3.63, 3.66, 3.69, 3.72, 3.74, 3.77,
                              3.80, 3.83, 3.87, 3.92, 3.97, 4.03, 4.10, 4.17, 4.24, 4.32, 4.40]),
        entropy_coefficient=-0.00008,
    )
    deg = DegradationParameters()
    deg.sei_rate_factor = 0.3  # no liquid electrolyte → less SEI
    deg.cycle_rate_factor = 0.6  # early-stage tech
    deg.plating_rate_factor = 2.0  # dendrite risk is higher with Li metal
    return ChemistryPreset(
        id="solid_state",
        name="Solid-State (Li-metal)",
        description="Next-gen solid-state with lithium metal anode. High energy, experimental. (QuantumScape, Toyota).",
        cathode="NMC811 / Sulfide Electrolyte",
        anode="Li Metal",
        nominal_voltage=3.8,
        voltage_range=(2.8, 4.4),
        energy_density_wh_kg=350,
        cycle_life=800,
        ecm=ecm,
        degradation=deg,
    )


# ─── Registry ──────────────────────────────────────────────────────────────

CHEMISTRY_PRESETS: Dict[str, ChemistryPreset] = {}

def _register_all():
    for factory in [_nmc622_preset, _nmc811_preset, _lfp_preset, _nca_preset, _lto_preset, _solid_state_preset]:
        preset = factory()
        CHEMISTRY_PRESETS[preset.id] = preset

_register_all()


def get_chemistry(chemistry_id: str) -> ChemistryPreset:
    """Get a chemistry preset by ID. Raises KeyError if not found."""
    if chemistry_id not in CHEMISTRY_PRESETS:
        raise KeyError(f"Unknown chemistry '{chemistry_id}'. Available: {list(CHEMISTRY_PRESETS.keys())}")
    return CHEMISTRY_PRESETS[chemistry_id]


def list_chemistries() -> list:
    """Return a list of available chemistry presets (summary info)."""
    return [
        {
            "id": p.id,
            "name": p.name,
            "description": p.description,
            "cathode": p.cathode,
            "anode": p.anode,
            "nominal_voltage": p.nominal_voltage,
            "voltage_range": list(p.voltage_range),
            "energy_density_wh_kg": p.energy_density_wh_kg,
            "cycle_life": p.cycle_life,
        }
        for p in CHEMISTRY_PRESETS.values()
    ]
