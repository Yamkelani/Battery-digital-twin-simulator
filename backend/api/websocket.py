"""
WebSocket Handler for Real-Time Simulation Streaming
======================================================

Manages WebSocket connections for:
    - Real-time simulation state streaming
    - Client-initiated simulation control (start/pause/resume/reset)
    - Parameter updates during simulation
    - Pack configuration messages (validated via Pydantic)
"""

import json
import asyncio
import numpy as np
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Dict, Any, Set

from api.schemas import parse_ws_message

ws_router = APIRouter()

# Connected WebSocket clients
_clients: Set[WebSocket] = set()
_simulation_task: asyncio.Task = None
_user_stopped: bool = False    # True after explicit "stop"; prevents auto-restart


async def _cancel_simulation(engine):
    """Properly cancel any running simulation task and clean up."""
    global _simulation_task
    if _simulation_task is not None:
        if not _simulation_task.done():
            engine.state = engine.state.__class__("completed")
            if hasattr(engine, '_pause_event'):
                engine._pause_event.set()
            _simulation_task.cancel()
            try:
                await _simulation_task
            except (asyncio.CancelledError, Exception):
                pass
        _simulation_task = None


def _reset_energy_tracking(engine):
    """Reset cumulative energy / efficiency counters on the engine."""
    engine._charge_ah_in = 0.0
    engine._discharge_ah_out = 0.0
    engine._charge_energy_in = 0.0
    engine._discharge_energy_out = 0.0
    engine._coulombic_eff = 0.0
    engine._energy_eff = 0.0


def _sanitize_float(v):
    """Replace NaN / Inf with JSON-safe values."""
    import math
    if isinstance(v, float):
        if math.isnan(v) or math.isinf(v):
            return None
    return v


def _convert_numpy(obj):
    """Recursively convert numpy types to native Python types for JSON serialization.
    Also sanitises NaN / Inf which produce non-standard JSON tokens that
    JavaScript's JSON.parse() rejects, silently killing the WS data stream."""
    if isinstance(obj, dict):
        return {k: _convert_numpy(v) for k, v in obj.items()}
    elif isinstance(obj, (list, tuple)):
        return [_convert_numpy(item) for item in obj]
    elif isinstance(obj, np.ndarray):
        # Replace NaN/Inf inside arrays before converting
        cleaned = np.where(np.isfinite(obj), obj, 0.0)
        return cleaned.tolist()
    elif isinstance(obj, (np.integer,)):
        return int(obj)
    elif isinstance(obj, (np.floating,)):
        val = float(obj)
        return _sanitize_float(val)
    elif isinstance(obj, np.bool_):
        return bool(obj)
    elif isinstance(obj, float):
        return _sanitize_float(obj)
    return obj


async def broadcast(data: Dict[str, Any]):
    """Broadcast simulation data to all connected clients."""
    global _clients
    if not _clients:
        return

    # Create a compact version for streaming (exclude large arrays)
    compact = {}
    for k, v in data.items():
        if v is None:
            continue
        if k.startswith("echem_") and isinstance(v, (list, np.ndarray)):
            arr = v.tolist() if isinstance(v, np.ndarray) else v
            if len(arr) > 10:
                # Downsample concentration profiles for streaming
                compact[k] = arr[::5] if len(arr) > 5 else arr
            else:
                compact[k] = arr
        elif k == "temperature_distribution":
            # Send temperature distribution periodically (not every frame)
            if data.get("step_count", 0) % 10 == 0:
                compact[k] = _convert_numpy(v)
        else:
            compact[k] = _convert_numpy(v)

    # Final safety: replace any remaining Python float NaN/Inf
    # (e.g. from plain dicts that bypassed _convert_numpy)
    import math

    def _deep_sanitize(o):
        if isinstance(o, dict):
            return {k: _deep_sanitize(v) for k, v in o.items()}
        elif isinstance(o, (list, tuple)):
            return [_deep_sanitize(i) for i in o]
        elif isinstance(o, float) and (math.isnan(o) or math.isinf(o)):
            return None
        return o

    compact = _deep_sanitize(compact)
    message = json.dumps(compact)

    disconnected = set()
    for ws in list(_clients):
        try:
            await asyncio.wait_for(ws.send_text(message), timeout=5.0)
        except Exception:
            disconnected.add(ws)

    _clients -= disconnected


@ws_router.websocket("/ws/simulation")
async def simulation_websocket(websocket: WebSocket):
    """
    WebSocket endpoint for real-time simulation.

    Protocol:
        Client sends JSON messages:
            {"action": "start"}                  - Start simulation
            {"action": "pause"}                  - Pause simulation
            {"action": "resume"}                 - Resume simulation
            {"action": "reset", "soc": 0.5}      - Reset simulation
            {"action": "set_speed", "value": 10}  - Change speed
            {"action": "set_profile", "type": "...", "params": {...}}

        Server streams JSON messages:
            {full simulation state every output_interval}
    """
    await websocket.accept()
    _clients.add(websocket)

    # Send initial state
    from api.routes import get_engine, get_pack
    engine = get_engine()

    # Include pack info if a pack is already configured
    connected_msg = {
        "type": "connected",
        "status": engine.state.value,
        "profiles": engine.get_available_profiles(),
    }
    pack = get_pack()
    if pack is not None:
        connected_msg["pack"] = {
            "n_series": pack.config.n_series,
            "n_parallel": pack.config.n_parallel,
            "n_cells": pack.n_cells,
        }
    await websocket.send_json(connected_msg)

    global _simulation_task, _user_stopped

    # Do NOT auto-start — wait for the user to click Start.
    # Just inform the client about the current engine state.
    current_status = "idle"
    if _simulation_task and not _simulation_task.done():
        current_status = engine.state.value if engine.state.value in ("running", "paused") else "idle"
    await websocket.send_json({"type": "status", "status": current_status})

    try:
        while True:
            # Receive client commands
            data = await websocket.receive_json()

            # ── Validate with Pydantic ───────────────────────────────
            try:
                msg = parse_ws_message(data)
            except Exception as ve:
                await websocket.send_json({
                    "type": "error",
                    "message": f"Invalid message: {ve}",
                })
                continue

            action = data.get("action", "")

            if action == "start":
                _user_stopped = False
                if _simulation_task and not _simulation_task.done():
                    await websocket.send_json({"type": "error", "message": "Simulation already running"})
                    continue

                # Clean up any finished task reference
                _simulation_task = None

                # Reset sim time & engine state so the profile starts fresh
                engine._sim_time = 0.0
                engine.state = engine.state.__class__("idle")
                _reset_energy_tracking(engine)

                # Ensure accelerated aging is set
                engine.cell.config.degradation_time_factor = 100.0

                # Ensure a profile is set
                if not engine._profile:
                    engine.set_profile("constant_discharge", c_rate=0.5)

                # Configure callback for streaming
                engine.set_callback(broadcast)

                # Start simulation in background task
                _simulation_task = asyncio.create_task(_run_simulation(engine, websocket))
                await websocket.send_json({"type": "status", "status": "running"})

            elif action == "pause":
                engine.pause()
                await websocket.send_json({"type": "status", "status": "paused"})

            elif action == "resume":
                engine.resume()
                await websocket.send_json({"type": "status", "status": "running"})

            elif action == "stop":
                # Fully stop the simulation (cancel the background task)
                _user_stopped = True
                await _cancel_simulation(engine)
                await websocket.send_json({"type": "status", "status": "idle", "message": "Simulation stopped"})

            elif action == "reset":
                _user_stopped = False
                # Properly cancel old task before resetting
                await _cancel_simulation(engine)

                soc = data.get("soc", 0.5)
                temp = data.get("temperature_c", 25.0)
                reset_deg = data.get("reset_degradation", False)
                engine.reset(soc, temp, reset_deg)
                _reset_energy_tracking(engine)
                engine.cell.config.degradation_time_factor = 100.0

                # Also reset the pack and BMS if they exist
                try:
                    from api.routes import get_pack, get_bms
                    pack = get_pack()
                    if pack is not None:
                        pack.reset(soc, temp, reset_deg)
                    bms = get_bms()
                    if bms is not None:
                        bms.reset()
                except Exception as e:
                    print(f"[WS] Pack/BMS reset error: {e}")

                await websocket.send_json({
                    "type": "status",
                    "status": "idle",
                    "message": "Simulation reset",
                })

                # Do NOT auto-restart — leave in idle until user clicks Start.

            elif action == "set_speed":
                speed = data.get("value", 1.0)
                engine.sim_config.speed_multiplier = max(0.1, min(speed, 1000))
                await websocket.send_json({
                    "type": "config",
                    "speed": engine.sim_config.speed_multiplier,
                })

            elif action == "set_profile":
                profile_type = data.get("type", "constant_discharge")
                params = data.get("params", {})
                try:
                    info = engine.set_profile(profile_type, **params)
                    await websocket.send_json({
                        "type": "profile",
                        "profile": info,
                    })
                except ValueError as e:
                    await websocket.send_json({"type": "error", "message": str(e)})

            elif action == "configure_cell":
                from models.battery_cell import BatteryCellConfig
                from simulation.engine import SimulationEngine

                cell_config = BatteryCellConfig(
                    nominal_capacity_ah=data.get("capacity_ah", 50.0),
                    initial_soc=data.get("soc", 0.5),
                    initial_temperature_c=data.get("temperature_c", 25.0),
                    enable_thermal=data.get("enable_thermal", True),
                    enable_degradation=data.get("enable_degradation", True),
                    enable_electrochemical=data.get("enable_electrochemical", True),
                )
                cell_config.degradation_time_factor = data.get("degradation_acceleration", 1.0)

                new_engine = SimulationEngine(cell_config, engine.sim_config)
                from api.routes import set_engine
                set_engine(new_engine)
                engine = new_engine

                await websocket.send_json({
                    "type": "config",
                    "message": "Cell reconfigured",
                })

            elif action == "set_ambient_temp":
                temp_c = data.get("value", 25.0)
                engine.cell.thermal.params.T_ambient_k = temp_c + 273.15
                await websocket.send_json({
                    "type": "config",
                    "ambient_temp_c": temp_c,
                })

            elif action == "configure_pack":
                from models.battery_pack import BatteryPack, PackConfig
                from api.routes import set_pack

                pack_cfg = PackConfig(
                    n_series=data.get("n_series", 4),
                    n_parallel=data.get("n_parallel", 2),
                    base_capacity_ah=data.get("capacity_ah", 50.0),
                    capacity_variation_pct=data.get("variation_pct", 2.0),
                    enable_thermal=data.get("enable_thermal_coupling", True),
                    enable_degradation=True,
                    degradation_time_factor=data.get("degradation_time_factor", 100.0),
                )
                pack = BatteryPack(pack_cfg)
                set_pack(pack)

                pack_msg = {
                    "type": "pack_configured",
                    "n_series": pack_cfg.n_series,
                    "n_parallel": pack_cfg.n_parallel,
                    "n_cells": pack.n_cells,
                    "cells": _convert_numpy(pack.get_cell_summary()),
                }
                # Direct reply to requesting client (reliable)
                await websocket.send_json(pack_msg)
                # Also broadcast to other connected clients
                await broadcast(pack_msg)

    except WebSocketDisconnect:
        pass
    finally:
        _clients.discard(websocket)


async def _run_simulation(engine, websocket: WebSocket):
    """Background task to run the simulation until the profile completes.

    The loop runs the current profile to completion and then stops.
    If the user selected the 'cycle_aging' profile, the engine itself
    handles multi-cycle logic internally.  For all other profiles the
    simulation finishes once and the user must explicitly click Start
    again (or choose a different profile and press Start).
    """
    global _user_stopped

    try:
        await engine.run_async()
    except asyncio.CancelledError:
        # Graceful stop via user pressing Stop — not an error.
        pass
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"[SIM ERROR] {e}")
        try:
            await broadcast({
                "type": "error",
                "message": f"Simulation error: {str(e)}",
            })
        except Exception:
            pass

    # Ensure engine is in a clean state when the task exits
    if engine.state.value not in ("idle", "completed", "error"):
        engine.state = engine.state.__class__("completed")

    # Notify all clients that the simulation finished
    final_status = "idle" if _user_stopped else "completed"
    try:
        await broadcast({"type": "status", "status": final_status})
    except Exception:
        pass
