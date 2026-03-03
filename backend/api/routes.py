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
        degradation_time_factor=500.0,
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
