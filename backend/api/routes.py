"""
REST API Routes for Battery Digital Twin
==========================================

Provides HTTP endpoints for:
    - Simulation configuration and control
    - Battery cell parameter management
    - Historical data retrieval
    - Export (CSV / JSON)
    - EIS impedance spectrum
    - Pack management
"""

import csv
import io
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List
import sys, os
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

router = APIRouter(prefix="/api", tags=["battery"])


# ─── Request/Response Models ──────────────────────────────────────────────────

class CellConfigRequest(BaseModel):
    """Battery cell configuration."""
    cell_id: str = "CELL_001"
    chemistry: str = "NMC622/Graphite"
    nominal_capacity_ah: float = Field(50.0, ge=1.0, le=500.0)
    nominal_voltage_v: float = Field(3.7, ge=2.0, le=5.0)
    initial_soc: float = Field(0.5, ge=0.0, le=1.0)
    initial_temperature_c: float = Field(25.0, ge=-20.0, le=60.0)
    enable_thermal: bool = True
    enable_degradation: bool = True
    enable_electrochemical: bool = True


class SimConfigRequest(BaseModel):
    """Simulation configuration."""
    dt: float = Field(1.0, ge=0.01, le=10.0, description="Physics time step [s]")
    output_interval: float = Field(1.0, ge=0.1, le=60.0, description="Output interval [s]")
    speed_multiplier: float = Field(1.0, ge=0.1, le=1000.0, description="Simulation speed")
    max_sim_time_s: float = Field(86400.0, ge=60.0, le=8640000.0, description="Max duration [s]")
    degradation_acceleration: float = Field(1.0, ge=1.0, le=10000.0)


class ProfileRequest(BaseModel):
    """Load profile selection."""
    profile_type: str = "constant_discharge"
    params: Dict[str, Any] = Field(default_factory=dict)


class ResetRequest(BaseModel):
    """Simulation reset parameters."""
    soc: float = Field(0.5, ge=0.0, le=1.0)
    temperature_c: float = Field(25.0, ge=-20.0, le=60.0)
    reset_degradation: bool = False


class SimulationResponse(BaseModel):
    """Standard simulation response."""
    status: str
    message: str
    data: Optional[Dict[str, Any]] = None


def _convert_numpy(obj):
    """Convert numpy types to native Python for JSON serialization."""
    if isinstance(obj, dict):
        return {k: _convert_numpy(v) for k, v in obj.items()}
    elif isinstance(obj, (list, tuple)):
        return [_convert_numpy(item) for item in obj]
    elif isinstance(obj, np.ndarray):
        return obj.tolist()
    elif isinstance(obj, (np.integer,)):
        return int(obj)
    elif isinstance(obj, (np.floating,)):
        return float(obj)
    elif isinstance(obj, np.bool_):
        return bool(obj)
    return obj


# ─── Simulation Engine Instance ──────────────────────────────────────────────

# Global simulation engine (managed in main.py)
_engine = None


def get_engine():
    """Get the global simulation engine instance."""
    global _engine
    if _engine is None:
        from simulation.engine import SimulationEngine
        _engine = SimulationEngine()
    return _engine


def set_engine(engine):
    """Set the global simulation engine instance."""
    global _engine
    _engine = engine


# ─── Endpoints ───────────────────────────────────────────────────────────────

@router.get("/status")
async def get_status() -> SimulationResponse:
    """Get current simulation status and summary."""
    engine = get_engine()
    summary = engine.get_summary()
    return SimulationResponse(
        status="ok",
        message=f"Simulation state: {engine.state.value}",
        data=summary,
    )


@router.get("/profiles")
async def get_profiles() -> List[Dict[str, str]]:
    """Get list of available load profiles."""
    engine = get_engine()
    return engine.get_available_profiles()


@router.post("/configure/cell")
async def configure_cell(config: CellConfigRequest) -> SimulationResponse:
    """Configure the battery cell parameters."""
    from models.battery_cell import BatteryCellConfig
    from simulation.engine import SimulationEngine, SimulationConfig

    cell_config = BatteryCellConfig(
        cell_id=config.cell_id,
        chemistry=config.chemistry,
        nominal_capacity_ah=config.nominal_capacity_ah,
        nominal_voltage_v=config.nominal_voltage_v,
        initial_soc=config.initial_soc,
        initial_temperature_c=config.initial_temperature_c,
        enable_thermal=config.enable_thermal,
        enable_degradation=config.enable_degradation,
        enable_electrochemical=config.enable_electrochemical,
    )

    engine = get_engine()
    old_sim_config = engine.sim_config
    new_engine = SimulationEngine(cell_config, old_sim_config)
    set_engine(new_engine)

    return SimulationResponse(
        status="ok",
        message=f"Cell configured: {config.cell_id} ({config.chemistry})",
        data={"cell_id": config.cell_id, "capacity_ah": config.nominal_capacity_ah},
    )


@router.post("/configure/simulation")
async def configure_simulation(config: SimConfigRequest) -> SimulationResponse:
    """Configure simulation parameters."""
    engine = get_engine()
    engine.sim_config.dt = config.dt
    engine.sim_config.output_interval = config.output_interval
    engine.sim_config.speed_multiplier = config.speed_multiplier
    engine.sim_config.max_sim_time_s = config.max_sim_time_s
    engine.sim_config.degradation_acceleration = config.degradation_acceleration

    return SimulationResponse(
        status="ok",
        message="Simulation parameters updated",
        data={
            "dt": config.dt,
            "speed": config.speed_multiplier,
            "max_time_s": config.max_sim_time_s,
        },
    )


@router.post("/profile")
async def set_profile(req: ProfileRequest) -> SimulationResponse:
    """Set the active load profile."""
    engine = get_engine()
    try:
        info = engine.set_profile(req.profile_type, **req.params)
        return SimulationResponse(
            status="ok",
            message=f"Profile set: {info['profile_name']}",
            data=info,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/reset")
async def reset_simulation(req: ResetRequest) -> SimulationResponse:
    """Reset the simulation to initial conditions."""
    engine = get_engine()
    engine.reset(req.soc, req.temperature_c, req.reset_degradation)
    return SimulationResponse(
        status="ok",
        message="Simulation reset",
        data={"soc": req.soc, "temperature_c": req.temperature_c},
    )


@router.post("/run/batch")
async def run_batch(num_steps: Optional[int] = None) -> SimulationResponse:
    """Run simulation in batch mode (non-streaming)."""
    engine = get_engine()
    if engine._profile is None:
        raise HTTPException(status_code=400, detail="No load profile set")

    try:
        results = engine.run_batch(num_steps)
        return SimulationResponse(
            status="ok",
            message=f"Batch simulation complete: {len(results)} data points",
            data={
                "num_points": len(results),
                "summary": engine.get_summary(),
                "final_state": results[-1] if results else None,
            },
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/history")
async def get_history(start: int = 0, limit: int = 1000) -> Dict[str, Any]:
    """Get simulation history data for charts."""
    engine = get_engine()
    history = engine.history[start:start + limit]

    if not history:
        return {"data": [], "total": 0}

    # Extract time-series arrays for charting
    keys_to_extract = [
        "sim_time_s", "sim_time_hours", "soc", "soc_pct", "voltage", "ocv",
        "current", "power_w", "c_rate",
        "thermal_T_core_c", "thermal_T_surface_c", "thermal_T_avg_c",
        "thermal_Q_gen_w", "thermal_Q_conv_w",
        "deg_soh_pct", "deg_capacity_retention", "deg_resistance_factor",
        "deg_sei_loss_pct", "deg_cycle_loss_pct", "deg_equivalent_cycles",
        "heat_total_w",
    ]

    series = {}
    for key in keys_to_extract:
        series[key] = [entry.get(key, 0) for entry in history]

    return {
        "data": series,
        "total": len(engine.history),
        "returned": len(history),
    }


@router.get("/state")
async def get_current_state() -> Dict[str, Any]:
    """Get the latest simulation state."""
    engine = get_engine()
    if engine.latest_state is None:
        return {"status": "no_data", "message": "No simulation data yet"}

    return _convert_numpy({
        "status": "ok",
        **engine.latest_state,
    })


@router.get("/visualization")
async def get_visualization_data() -> Dict[str, Any]:
    """Get data formatted for 3D visualization."""
    engine = get_engine()
    return _convert_numpy(engine.cell.get_3d_visualization_data())


# ─── Export Endpoints ────────────────────────────────────────────────────────

@router.get("/export/json")
async def export_json():
    """Download full simulation history as JSON."""
    engine = get_engine()
    history = engine.history
    if not history:
        raise HTTPException(status_code=404, detail="No simulation data to export")

    return JSONResponse(
        content=_convert_numpy(history),
        headers={"Content-Disposition": "attachment; filename=battery_simulation.json"},
    )


@router.get("/export/csv")
async def export_csv():
    """Download full simulation history as CSV."""
    engine = get_engine()
    history = engine.history
    if not history:
        raise HTTPException(status_code=404, detail="No simulation data to export")

    # Determine columns from first entry (skip nested dicts/lists)
    first = history[0]
    columns = [k for k, v in first.items()
               if not isinstance(v, (dict, list, np.ndarray))]

    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=columns, extrasaction="ignore")
    writer.writeheader()
    for row in history:
        clean = {}
        for c in columns:
            val = row.get(c)
            if isinstance(val, (np.integer,)):
                val = int(val)
            elif isinstance(val, (np.floating,)):
                val = float(val)
            elif isinstance(val, np.bool_):
                val = bool(val)
            clean[c] = val
        writer.writerow(clean)

    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=battery_simulation.csv"},
    )


# ─── EIS / Nyquist Endpoint ─────────────────────────────────────────────────

@router.get("/eis")
async def get_eis_spectrum(temp_c: float = 25.0) -> Dict[str, Any]:
    """Compute EIS impedance spectrum from the 2RC equivalent circuit model."""
    engine = get_engine()
    T_k = temp_c + 273.15
    spectrum = engine.cell.ecm.impedance_spectrum(T=T_k)
    return _convert_numpy(spectrum)


# ─── Pack Endpoints ──────────────────────────────────────────────────────────

_pack = None
_bms = None


def get_pack():
    global _pack
    return _pack


def set_pack(pack):
    global _pack
    _pack = pack


def get_bms():
    global _bms
    return _bms


def set_bms(bms):
    global _bms
    _bms = bms


@router.get("/pack/status")
async def get_pack_status() -> Dict[str, Any]:
    """Get current pack-level status with per-cell data and thermal links."""
    pack = get_pack()
    if pack is None:
        return {"status": "no_pack", "message": "No pack configured"}
    summary = pack.get_cell_summary()
    thermal_links = pack.get_thermal_links()
    return _convert_numpy({
        "status": "ok",
        "cells": summary,
        "n_cells": pack.n_cells,
        "thermal_links": thermal_links,
        "n_series": pack.config.n_series,
        "n_parallel": pack.config.n_parallel,
    })


class PackConfigRequest(BaseModel):
    """Pack configuration request."""
    n_series: int = Field(4, ge=1, le=8)
    n_parallel: int = Field(2, ge=1, le=8)
    capacity_ah: float = Field(50.0, ge=1.0, le=500.0)
    variation_pct: float = Field(2.0, ge=0.0, le=10.0)
    enable_balancing: bool = True
    enable_thermal_coupling: bool = True


@router.post("/pack/configure")
async def configure_pack(req: PackConfigRequest) -> Dict[str, Any]:
    """Create / reconfigure the battery pack."""
    from models.battery_pack import BatteryPack, PackConfig

    cfg = PackConfig(
        n_series=req.n_series,
        n_parallel=req.n_parallel,
        base_capacity_ah=req.capacity_ah,
        capacity_variation_pct=req.variation_pct,
        enable_thermal=req.enable_thermal_coupling,
        enable_degradation=True,
        degradation_time_factor=100.0,
    )
    pack = BatteryPack(cfg)
    set_pack(pack)

    # Auto-create BMS for this pack
    from models.bms import BMSModel, BMSConfig
    bms_cfg = BMSConfig(balancing_enabled=req.enable_balancing)
    bms = BMSModel(pack, bms_cfg)
    set_bms(bms)

    # Also broadcast to all WS clients so they know the pack changed
    from api.websocket import broadcast, _convert_numpy
    pack_msg = {
        "type": "pack_configured",
        "n_series": cfg.n_series,
        "n_parallel": cfg.n_parallel,
        "n_cells": pack.n_cells,
        "cells": _convert_numpy(pack.get_cell_summary()),
    }
    await broadcast(pack_msg)

    return {
        "status": "ok",
        "message": f"Pack created: {req.n_series}S{req.n_parallel}P ({pack.n_cells} cells)",
        "n_cells": pack.n_cells,
        "n_series": cfg.n_series,
        "n_parallel": cfg.n_parallel,
    }


@router.get("/bms/status")
async def get_bms_status() -> Dict[str, Any]:
    """Get current BMS status — faults, contactor, balancing."""
    bms = get_bms()
    if bms is None:
        return {"status": "no_bms", "message": "No BMS active (configure a pack first)"}
    return _convert_numpy({
        "status": "ok",
        **bms.get_status(),
    })


@router.get("/rul")
async def get_rul_prediction() -> Dict[str, Any]:
    """Get detailed Remaining Useful Life prediction."""
    engine = get_engine()
    deg = engine.cell.degradation
    
    # Current degradation state
    soh = deg.state_of_health
    capacity_retention = deg.capacity_retention
    eq_cycles = deg.total_cycles
    remaining_cycles = deg.remaining_useful_life_cycles
    eol_threshold = deg.params.eol_capacity_fraction * 100
    
    # Degradation rate per cycle (linear approximation)
    if eq_cycles > 0.5:
        deg_rate_per_cycle = (1.0 - capacity_retention) / eq_cycles
    else:
        deg_rate_per_cycle = 0.0
    
    # Breakdown contributions
    total_loss = 1.0 - capacity_retention
    sei_fraction = deg.sei_capacity_loss / max(total_loss, 1e-9) * 100 if total_loss > 1e-6 else 0
    cycle_fraction = deg.cycle_capacity_loss / max(total_loss, 1e-9) * 100 if total_loss > 1e-6 else 0
    plating_fraction = deg.plating_capacity_loss / max(total_loss, 1e-9) * 100 if total_loss > 1e-6 else 0
    
    # Confidence level (higher cycles = more data = higher confidence)
    confidence = min(eq_cycles / 50.0, 1.0) * 100  # 100% confidence after 50 cycles
    
    # Estimated remaining time at current usage rate
    if eq_cycles > 0.5 and deg.total_time_s > 0:
        time_per_cycle = deg.total_time_s / eq_cycles
        remaining_time_hours = remaining_cycles * time_per_cycle / 3600.0
    else:
        remaining_time_hours = 0.0
    
    # Knee point detection (where degradation accelerates)
    knee_point_soh = 85.0  # Typical knee point
    cycles_to_knee = 0.0
    if soh > knee_point_soh and deg_rate_per_cycle > 0:
        soh_to_knee = soh - knee_point_soh
        cycles_to_knee = soh_to_knee / (deg_rate_per_cycle * 100)
    
    # Energy efficiency
    efficiency = {
        "coulombic": engine._coulombic_eff,
        "energy": engine._energy_eff,
        "charge_ah": engine._charge_ah_in,
        "discharge_ah": engine._discharge_ah_out,
        "charge_wh": engine._charge_energy_in,
        "discharge_wh": engine._discharge_energy_out,
    }
    
    return _convert_numpy({
        "status": "ok",
        "soh_pct": soh,
        "capacity_retention": capacity_retention,
        "equivalent_cycles": eq_cycles,
        "remaining_cycles": remaining_cycles,
        "eol_threshold_pct": eol_threshold,
        "degradation_rate_per_cycle": deg_rate_per_cycle,
        "total_capacity_loss_pct": total_loss * 100,
        "sei_contribution_pct": sei_fraction,
        "cycle_contribution_pct": cycle_fraction,
        "plating_contribution_pct": plating_fraction,
        "remaining_time_hours": remaining_time_hours,
        "confidence_pct": confidence,
        "resistance_factor": deg.resistance_factor,
        "total_ah_throughput": deg.total_ah_throughput,
        "total_energy_wh": deg.total_energy_wh,
        "knee_point_soh": knee_point_soh,
        "cycles_to_knee_point": cycles_to_knee,
        "is_eol": deg.is_end_of_life,
        "efficiency": efficiency,
    })


# ─── ML Dataset Export Endpoints ─────────────────────────────────────────────

class MLDatasetRequest(BaseModel):
    """Configuration for ML dataset generation."""
    num_cycles: int = Field(100, ge=1, le=5000, description="Number of charge/discharge cycles to simulate")
    sample_interval_s: float = Field(10.0, ge=1.0, le=300.0, description="Sampling interval in seconds")
    c_rate: float = Field(1.0, ge=0.1, le=5.0, description="C-rate for cycling")
    temperature_c: float = Field(25.0, ge=-10.0, le=60.0, description="Ambient temperature")
    soc_upper: float = Field(1.0, ge=0.5, le=1.0, description="Upper SOC limit")
    soc_lower: float = Field(0.1, ge=0.0, le=0.5, description="Lower SOC limit")
    include_eis: bool = Field(False, description="Include EIS impedance snapshots per cycle")
    capacity_ah: float = Field(50.0, ge=1.0, le=500.0, description="Cell capacity")
    noise_sigma: float = Field(0.001, ge=0.0, le=0.05, description="Gaussian noise std for voltage/temp sensors")
    format: str = Field("csv", description="Output format: csv or json")


@router.post("/export/ml-dataset")
async def export_ml_dataset(req: MLDatasetRequest):
    """
    Generate a comprehensive ML-ready battery cycling dataset.

    Produces a time-series dataset with features suitable for training:
    - SOH/RUL prediction models
    - Anomaly detection on voltage/temperature
    - SEI growth / plating onset classifiers
    - Coulombic efficiency degradation models

    Columns:
      cycle, step, time_s, current_a, voltage_v, soc, temperature_c,
      soh_pct, sei_loss_pct, cycle_loss_pct, plating_loss_pct,
      resistance_factor, capacity_retention, ah_throughput,
      energy_wh, heat_gen_w, dv_dt, di_dt, impedance_re, impedance_im,
      rul_cycles, is_charging, c_rate, dod
    """
    import random
    from models.battery_cell import BatteryCell, BatteryCellConfig

    rng = random.Random(42)
    cell_cfg = BatteryCellConfig(
        nominal_capacity_ah=req.capacity_ah,
        initial_soc=req.soc_upper,
        initial_temperature_c=req.temperature_c,
        enable_thermal=True,
        enable_degradation=True,
        enable_electrochemical=True,
        degradation_time_factor=100.0,  # accelerated aging
    )
    cell = BatteryCell(cell_cfg)

    dt = 1.0  # physics step
    output_interval = max(1, int(req.sample_interval_s / dt))
    discharge_current = req.c_rate * req.capacity_ah
    charge_current = -req.c_rate * req.capacity_ah * 0.8  # charge slightly slower

    rows: list = []
    step_global = 0
    prev_voltage = 0.0
    prev_current = 0.0

    for cycle in range(1, req.num_cycles + 1):
        # ── Discharge phase ──
        phase_steps = 0
        while cell.ecm.soc > req.soc_lower and phase_steps < 20000:
            result = cell.step(discharge_current, dt)
            step_global += 1
            phase_steps += 1

            if phase_steps % output_interval == 0:
                v = result["voltage"] + rng.gauss(0, req.noise_sigma)
                tc = (result.get("thermal_T_core_c", req.temperature_c)
                      + rng.gauss(0, req.noise_sigma * 5))
                dv_dt = (v - prev_voltage) / req.sample_interval_s if prev_voltage else 0
                di_dt = (discharge_current - prev_current) / req.sample_interval_s
                prev_voltage = v
                prev_current = discharge_current
                deg = result
                rows.append({
                    "cycle": cycle,
                    "step": step_global,
                    "time_s": round(step_global * dt, 2),
                    "current_a": round(discharge_current, 4),
                    "voltage_v": round(v, 6),
                    "soc": round(result["soc"], 6),
                    "temperature_c": round(tc, 3),
                    "soh_pct": round(deg.get("deg_soh_pct", 100), 4),
                    "sei_loss_pct": round(deg.get("deg_sei_loss_pct", 0), 6),
                    "cycle_loss_pct": round(deg.get("deg_cycle_loss_pct", 0), 6),
                    "plating_loss_pct": round(deg.get("deg_plating_loss_pct", 0), 6),
                    "resistance_factor": round(deg.get("deg_resistance_factor", 1.0), 6),
                    "capacity_retention": round(deg.get("deg_capacity_retention", 1.0), 6),
                    "ah_throughput": round(deg.get("deg_total_ah_throughput", 0), 4),
                    "energy_wh": round(deg.get("deg_total_energy_wh", 0), 4),
                    "heat_gen_w": round(deg.get("heat_total_w", 0), 4),
                    "dv_dt": round(dv_dt, 8),
                    "di_dt": round(di_dt, 8),
                    "rul_cycles": round(deg.get("deg_remaining_cycles", 0), 2),
                    "is_charging": 0,
                    "c_rate": round(abs(discharge_current) / req.capacity_ah, 3),
                    "dod": round(req.soc_upper - result["soc"], 4),
                })

        # ── Charge phase (CC-CV simplified) ──
        phase_steps = 0
        while cell.ecm.soc < req.soc_upper and phase_steps < 20000:
            # Simple CC → CV transition at 4.15V
            v_now = cell.ecm.terminal_voltage(cell.ecm.state, charge_current, cell.thermal.T_core)
            if v_now > 4.15:
                # CV mode: taper current
                i_charge = charge_current * max(0.1, (req.soc_upper - cell.ecm.soc) * 5)
            else:
                i_charge = charge_current

            result = cell.step(i_charge, dt)
            step_global += 1
            phase_steps += 1

            if phase_steps % output_interval == 0:
                v = result["voltage"] + rng.gauss(0, req.noise_sigma)
                tc = (result.get("thermal_T_core_c", req.temperature_c)
                      + rng.gauss(0, req.noise_sigma * 5))
                dv_dt = (v - prev_voltage) / req.sample_interval_s if prev_voltage else 0
                di_dt = (i_charge - prev_current) / req.sample_interval_s
                prev_voltage = v
                prev_current = i_charge
                deg = result
                rows.append({
                    "cycle": cycle,
                    "step": step_global,
                    "time_s": round(step_global * dt, 2),
                    "current_a": round(i_charge, 4),
                    "voltage_v": round(v, 6),
                    "soc": round(result["soc"], 6),
                    "temperature_c": round(tc, 3),
                    "soh_pct": round(deg.get("deg_soh_pct", 100), 4),
                    "sei_loss_pct": round(deg.get("deg_sei_loss_pct", 0), 6),
                    "cycle_loss_pct": round(deg.get("deg_cycle_loss_pct", 0), 6),
                    "plating_loss_pct": round(deg.get("deg_plating_loss_pct", 0), 6),
                    "resistance_factor": round(deg.get("deg_resistance_factor", 1.0), 6),
                    "capacity_retention": round(deg.get("deg_capacity_retention", 1.0), 6),
                    "ah_throughput": round(deg.get("deg_total_ah_throughput", 0), 4),
                    "energy_wh": round(deg.get("deg_total_energy_wh", 0), 4),
                    "heat_gen_w": round(deg.get("heat_total_w", 0), 4),
                    "dv_dt": round(dv_dt, 8),
                    "di_dt": round(di_dt, 8),
                    "rul_cycles": round(deg.get("deg_remaining_cycles", 0), 2),
                    "is_charging": 1,
                    "c_rate": round(abs(i_charge) / req.capacity_ah, 3),
                    "dod": round(req.soc_upper - result["soc"], 4),
                })

        # Optional: EIS snapshot at end of each cycle
        if req.include_eis and cycle % max(1, req.num_cycles // 20) == 0:
            T_k = req.temperature_c + 273.15
            eis = cell.ecm.impedance_spectrum(T=T_k)
            for z_re, z_im in zip(eis.get("Z_real", []), eis.get("Z_imag", [])):
                rows.append({
                    "cycle": cycle,
                    "step": step_global,
                    "time_s": round(step_global * dt, 2),
                    "current_a": 0,
                    "voltage_v": round(prev_voltage, 6),
                    "soc": round(cell.ecm.soc, 6),
                    "temperature_c": round(req.temperature_c, 3),
                    "soh_pct": round(cell.degradation.state_of_health, 4),
                    "sei_loss_pct": round(cell.degradation.sei_capacity_loss * 100, 6),
                    "cycle_loss_pct": round(cell.degradation.cycle_capacity_loss * 100, 6),
                    "plating_loss_pct": round(cell.degradation.plating_capacity_loss * 100, 6),
                    "resistance_factor": round(cell.degradation.resistance_factor, 6),
                    "capacity_retention": round(cell.degradation.capacity_retention, 6),
                    "ah_throughput": round(cell.degradation.total_ah_throughput, 4),
                    "energy_wh": round(cell.degradation.total_energy_wh, 4),
                    "heat_gen_w": 0,
                    "dv_dt": 0,
                    "di_dt": 0,
                    "rul_cycles": round(cell.degradation.remaining_useful_life_cycles, 2),
                    "is_charging": -1,  # EIS marker
                    "c_rate": 0,
                    "dod": 0,
                    "impedance_re": round(float(z_re), 8),
                    "impedance_im": round(float(z_im), 8),
                })

    if not rows:
        raise HTTPException(status_code=400, detail="No data generated — check parameters")

    if req.format == "json":
        return JSONResponse(
            content={"columns": list(rows[0].keys()), "data": rows, "num_rows": len(rows),
                     "num_cycles": req.num_cycles, "config": req.model_dump()},
            headers={"Content-Disposition": "attachment; filename=battery_ml_dataset.json"},
        )

    # CSV output
    columns = list(rows[0].keys())
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=columns, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        clean = {}
        for c in columns:
            val = row.get(c, "")
            if isinstance(val, (np.integer,)):
                val = int(val)
            elif isinstance(val, (np.floating,)):
                val = float(val)
            clean[c] = val
        writer.writerow(clean)

    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": "attachment; filename=battery_ml_dataset.csv"},
    )


@router.get("/export/ml-dataset/schema")
async def ml_dataset_schema():
    """Return the column schema and descriptions for the ML dataset."""
    return {
        "columns": {
            "cycle": "Charge/discharge cycle number (1-indexed)",
            "step": "Global simulation step counter",
            "time_s": "Elapsed simulation time in seconds",
            "current_a": "Applied current [A] (positive=discharge, negative=charge)",
            "voltage_v": "Terminal voltage [V] with optional sensor noise",
            "soc": "State of Charge [0-1]",
            "temperature_c": "Cell temperature [°C] with optional sensor noise",
            "soh_pct": "State of Health [%]",
            "sei_loss_pct": "Capacity loss from SEI growth [%]",
            "cycle_loss_pct": "Capacity loss from cycling degradation [%]",
            "plating_loss_pct": "Capacity loss from lithium plating [%]",
            "resistance_factor": "Internal resistance increase factor (1.0=fresh)",
            "capacity_retention": "Remaining capacity fraction (1.0=fresh)",
            "ah_throughput": "Cumulative Ah throughput [Ah]",
            "energy_wh": "Cumulative energy throughput [Wh]",
            "heat_gen_w": "Heat generation [W]",
            "dv_dt": "Voltage rate of change [V/s]",
            "di_dt": "Current rate of change [A/s]",
            "rul_cycles": "Estimated remaining useful life [cycles]",
            "is_charging": "Phase indicator: 0=discharge, 1=charge, -1=EIS measurement",
            "c_rate": "C-rate magnitude",
            "dod": "Depth of discharge since last full charge",
            "impedance_re": "EIS real impedance [Ohm] (only in EIS rows)",
            "impedance_im": "EIS imaginary impedance [Ohm] (only in EIS rows)",
        },
        "ml_targets": {
            "soh_prediction": "Use soh_pct as target, features: voltage_v, current_a, temperature_c, ah_throughput, cycle",
            "rul_prediction": "Use rul_cycles as target, features: soh_pct, resistance_factor, ah_throughput, cycle, dod",
            "anomaly_detection": "Features: voltage_v, temperature_c, dv_dt, heat_gen_w — detect outliers",
            "degradation_mode": "Multi-output: sei_loss_pct, cycle_loss_pct, plating_loss_pct as targets",
            "capacity_estimation": "Use capacity_retention as target from EIS features: impedance_re, impedance_im",
        },
        "example_request": {
            "num_cycles": 200,
            "sample_interval_s": 10,
            "c_rate": 1.0,
            "temperature_c": 25,
            "soc_upper": 1.0,
            "soc_lower": 0.1,
            "include_eis": True,
            "capacity_ah": 50,
            "noise_sigma": 0.002,
            "format": "csv"
        }
    }


# ─── Chemistry Presets ────────────────────────────────────────────────────────

@router.get("/chemistries")
async def list_available_chemistries():
    """List all available battery chemistry presets."""
    from models.chemistry import list_chemistries
    return {"status": "ok", "chemistries": list_chemistries()}


class ChemistrySelectRequest(BaseModel):
    chemistry_id: str = Field(..., description="Chemistry preset ID (e.g., 'nmc622', 'lfp', 'nca')")
    capacity_ah: float = Field(50.0, ge=1.0, le=500.0)
    initial_soc: float = Field(0.8, ge=0.0, le=1.0)
    initial_temperature_c: float = Field(25.0, ge=-20.0, le=60.0)


@router.post("/configure/chemistry")
async def configure_chemistry(req: ChemistrySelectRequest) -> SimulationResponse:
    """Configure the battery cell using a chemistry preset.

    This replaces the entire cell model with parameters calibrated
    for the selected chemistry (OCV curve, resistance, degradation rates, etc.).
    """
    from models.chemistry import get_chemistry, CHEMISTRY_PRESETS
    from models.battery_cell import BatteryCellConfig
    from simulation.engine import SimulationEngine

    try:
        preset = get_chemistry(req.chemistry_id)
    except KeyError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # Build cell config from preset
    ecm = preset.ecm
    ecm.capacity_ah = req.capacity_ah

    cell_config = BatteryCellConfig(
        cell_id="CELL_001",
        chemistry=preset.name,
        form_factor="Prismatic",
        nominal_capacity_ah=req.capacity_ah,
        nominal_voltage_v=preset.nominal_voltage,
        energy_wh=req.capacity_ah * preset.nominal_voltage,
        initial_soc=req.initial_soc,
        initial_temperature_c=req.initial_temperature_c,
        ecm_params=ecm,
        thermal_params=preset.thermal,
        degradation_params=preset.degradation,
        spm_params=preset.spm,
        enable_thermal=True,
        enable_degradation=True,
        enable_electrochemical=True,
    )

    engine = get_engine()
    old_sim_config = engine.sim_config
    new_engine = SimulationEngine(cell_config, old_sim_config)
    set_engine(new_engine)

    return SimulationResponse(
        status="ok",
        message=f"Chemistry set: {preset.name}",
        data={
            "chemistry": preset.name,
            "cathode": preset.cathode,
            "anode": preset.anode,
            "nominal_voltage": preset.nominal_voltage,
            "voltage_range": list(preset.voltage_range),
            "energy_density_wh_kg": preset.energy_density_wh_kg,
            "cycle_life": preset.cycle_life,
            "capacity_ah": req.capacity_ah,
        },
    )


# ─── Fault Injection ─────────────────────────────────────────────────────────

class FaultInjectionRequest(BaseModel):
    fault_type: str = Field(..., description="Fault type: 'internal_short', 'thermal_runaway', 'sensor_drift', 'capacity_fade'")
    severity: float = Field(0.5, ge=0.0, le=1.0, description="Severity 0-1 (0=mild, 1=catastrophic)")
    delay_s: float = Field(0.0, ge=0.0, description="Delay before fault activates [s]")


@router.post("/fault/inject")
async def inject_fault(req: FaultInjectionRequest) -> SimulationResponse:
    """Inject a fault into the running simulation.

    Supported fault types:
      - internal_short: Adds a parallel leakage resistance (severity scales conductance)
      - thermal_runaway: Forces exothermic self-heating above threshold
      - sensor_drift: Adds progressive offset to voltage/temperature readings
      - capacity_fade: Instantly reduces effective capacity
    """
    engine = get_engine()
    cell = engine.cell

    if req.fault_type == "internal_short":
        # Model ISC as additional parallel resistance draining current
        # severity=1.0 → short resistance = 0.1 Ohm (catastrophic)
        # severity=0.1 → short resistance = 100 Ohm (mild micro-short)
        r_short = max(0.1, 100.0 * (1.0 - req.severity))
        cell._fault_short_resistance = r_short
        cell._fault_short_active = True
        msg = f"Internal short injected: R_short={r_short:.1f} Ω"

    elif req.fault_type == "thermal_runaway":
        # Force heat generation ramp → thermal runaway cascade
        heat_ramp_w_per_s = 0.5 + req.severity * 10.0  # W/s ramp rate
        cell._fault_thermal_runaway = True
        cell._fault_heat_ramp = heat_ramp_w_per_s
        cell._fault_heat_extra = 0.0
        msg = f"Thermal runaway initiated: ramp={heat_ramp_w_per_s:.1f} W/s"

    elif req.fault_type == "sensor_drift":
        # Progressive voltage/temp offset
        v_drift = req.severity * 0.1  # up to 100mV offset
        t_drift = req.severity * 5.0  # up to 5°C offset
        cell._fault_sensor_v_drift = v_drift
        cell._fault_sensor_t_drift = t_drift
        msg = f"Sensor drift injected: ΔV={v_drift*1000:.0f}mV, ΔT={t_drift:.1f}°C"

    elif req.fault_type == "capacity_fade":
        # Instant capacity loss
        fade_pct = req.severity * 30.0  # up to 30% instant fade
        if hasattr(cell, 'degradation'):
            cell.degradation.total_capacity_loss += fade_pct / 100.0
        msg = f"Capacity fade injected: {fade_pct:.1f}% instant loss"

    else:
        raise HTTPException(status_code=400, detail=f"Unknown fault type: {req.fault_type}")

    return SimulationResponse(status="ok", message=msg, data={"fault_type": req.fault_type, "severity": req.severity})


@router.post("/fault/clear")
async def clear_faults() -> SimulationResponse:
    """Clear all injected faults."""
    engine = get_engine()
    cell = engine.cell
    cell._fault_short_active = False
    cell._fault_short_resistance = float('inf')
    cell._fault_thermal_runaway = False
    cell._fault_heat_ramp = 0.0
    cell._fault_heat_extra = 0.0
    cell._fault_sensor_v_drift = 0.0
    cell._fault_sensor_t_drift = 0.0
    return SimulationResponse(status="ok", message="All faults cleared")
