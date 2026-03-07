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
import math
import asyncio
import logging
import numpy as np
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from typing import Dict, Any, Set

from api.schemas import parse_ws_message
from api.utils import convert_numpy, sanitize_float, deep_sanitize

logger = logging.getLogger("battery_dt.ws")

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


def _on_sim_task_done(task: asyncio.Task):
    """Clean up the global simulation-task reference when the task ends on its own."""
    global _simulation_task
    if _simulation_task is task:
        _simulation_task = None
        logger.info("Simulation task finished (reference cleaned up)")


def _reset_energy_tracking(engine):
    """Reset cumulative energy / efficiency counters on the engine."""
    engine._charge_ah_in = 0.0
    engine._discharge_ah_out = 0.0
    engine._charge_energy_in = 0.0
    engine._discharge_energy_out = 0.0
    engine._coulombic_eff = 0.0
    engine._energy_eff = 0.0


# _convert_numpy and _sanitize_float are now in api.utils
# Keep a backward-compatible alias so existing imports still work.
_convert_numpy = convert_numpy
_sanitize_float = sanitize_float


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
    compact = deep_sanitize(compact)
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
            # ── Receive & validate ─────────────────────────────────────
            try:
                data = await websocket.receive_json()
            except json.JSONDecodeError as jde:
                await websocket.send_json({
                    "type": "error",
                    "message": f"Invalid JSON: {jde}",
                })
                continue

            try:
                msg = parse_ws_message(data)
            except Exception as ve:
                await websocket.send_json({
                    "type": "error",
                    "message": f"Invalid message: {ve}",
                })
                continue

            action = data.get("action", "")

            # ── Dispatch action (wrapped for safety) ────────────────────
            try:
                if action == "start":
                    logger.info('Start requested (state=%s)', engine.state.value)
                    _user_stopped = False
                    if _simulation_task and not _simulation_task.done():
                        await websocket.send_json({"type": "status", "status": "running"})
                        continue

                    _simulation_task = None
                    engine._sim_time = 0.0
                    engine.state = engine.state.__class__("idle")
                    _reset_energy_tracking(engine)
                    engine.cell.config.degradation_time_factor = 100.0

                    if not engine._profile:
                        engine.set_profile("constant_discharge", c_rate=0.5)

                    engine.set_callback(broadcast)
                    _simulation_task = asyncio.create_task(_run_simulation(engine))
                    _simulation_task.add_done_callback(_on_sim_task_done)
                    await broadcast({"type": "status", "status": "running"})
                    logger.info('Simulation started')

                elif action == "pause":
                    if _simulation_task and not _simulation_task.done() and engine.state.value == "running":
                        engine.pause()
                        await broadcast({"type": "status", "status": "paused"})
                        logger.info('Paused')
                    else:
                        actual = engine.state.value
                        mapped = "idle" if actual in ("idle", "completed") else actual
                        await websocket.send_json({"type": "status", "status": mapped})
                        logger.debug('Pause rejected (state=%s)', actual)

                elif action == "resume":
                    if _simulation_task and not _simulation_task.done() and engine.state.value == "paused":
                        engine.resume()
                        await broadcast({"type": "status", "status": "running"})
                        logger.info('Resumed')
                    else:
                        actual = engine.state.value
                        mapped = "idle" if actual in ("idle", "completed") else actual
                        await websocket.send_json({"type": "status", "status": mapped})
                        logger.debug('Resume rejected (state=%s)', actual)

                elif action == "stop":
                    logger.info('Stop requested (state=%s)', engine.state.value)
                    _user_stopped = True
                    await _cancel_simulation(engine)
                    engine.state = engine.state.__class__("idle")
                    await broadcast({"type": "status", "status": "idle"})
                    logger.info('Stopped')

                elif action == "reset":
                    _user_stopped = False
                    await _cancel_simulation(engine)

                    soc = data.get("soc", 0.5)
                    temp = data.get("temperature_c", 25.0)
                    reset_deg = data.get("reset_degradation", False)
                    engine.reset(soc, temp, reset_deg)
                    _reset_energy_tracking(engine)
                    engine.cell.config.degradation_time_factor = 100.0

                    try:
                        from api.routes import get_pack, get_bms
                        pack = get_pack()
                        if pack is not None:
                            pack.reset(soc, temp, reset_deg)
                        bms = get_bms()
                        if bms is not None:
                            bms.reset()
                    except Exception as e:
                        logger.warning('Pack/BMS reset error: %s', e)

                    await broadcast({"type": "status", "status": "idle"})
                    logger.info('Reset complete')

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
                    await websocket.send_json(pack_msg)
                    await broadcast(pack_msg)

            except Exception as action_exc:
                logger.exception("Error handling action '%s': %s", action, action_exc)
                try:
                    await websocket.send_json({
                        "type": "error",
                        "message": f"Server error handling '{action}': {str(action_exc)[:200]}",
                    })
                except Exception:
                    pass

    except WebSocketDisconnect:
        pass
    except Exception as exc:
        logger.exception("Unexpected WS handler error: %s", exc)
    finally:
        _clients.discard(websocket)


async def _run_simulation(engine):
    """Background task to run the simulation until the profile completes.

    The loop runs the current profile to completion and then stops.
    If the user selected the 'cycle_aging' profile, the engine itself
    handles multi-cycle logic internally.  For all other profiles the
    simulation finishes once and the user must explicitly click Start
    again (or choose a different profile and press Start).
    """
    global _user_stopped

    try:
        logger.info('Simulation task running...')
        await engine.run_async()
        logger.info('Engine run_async completed normally')
    except asyncio.CancelledError:
        logger.info('Simulation task cancelled')
    except Exception as e:
        logger.exception('Simulation error: %s', e)
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
    logger.info('Simulation ended -> broadcasting %r', final_status)
    try:
        await broadcast({"type": "status", "status": final_status})
    except Exception:
        pass
