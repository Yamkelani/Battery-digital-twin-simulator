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


def _convert_numpy(obj):
    """Recursively convert numpy types to native Python types for JSON serialization."""
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

    message = json.dumps(compact)

    disconnected = set()
    for ws in list(_clients):
        try:
            await ws.send_text(message)
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
    from api.routes import get_engine
    engine = get_engine()
    await websocket.send_json({
        "type": "connected",
        "status": engine.state.value,
        "profiles": engine.get_available_profiles(),
    })

    global _simulation_task

    # Auto-start simulation on first connection
    if not _simulation_task or _simulation_task.done():
        engine.set_callback(broadcast)
        if not engine._profile:
            engine.set_profile("constant_discharge", c_rate=0.5)
        _simulation_task = asyncio.create_task(_run_simulation(engine, websocket))
        await websocket.send_json({"type": "status", "status": "running"})

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
                if _simulation_task and not _simulation_task.done():
                    await websocket.send_json({"type": "error", "message": "Simulation already running"})
                    continue

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
                if _simulation_task and not _simulation_task.done():
                    engine.state = engine.state.__class__("completed")
                    # Wake up pause event if paused so the loop can exit
                    if hasattr(engine, '_pause_event'):
                        engine._pause_event.set()
                    _simulation_task.cancel()
                    try:
                        await _simulation_task
                    except asyncio.CancelledError:
                        pass
                    _simulation_task = None
                await websocket.send_json({"type": "status", "status": "idle", "message": "Simulation stopped"})

            elif action == "reset":
                if _simulation_task and not _simulation_task.done():
                    engine.state = engine.state.__class__("completed")
                    # Wake up pause event if paused
                    if hasattr(engine, '_pause_event'):
                        engine._pause_event.set()
                    await asyncio.sleep(0.2)

                soc = data.get("soc", 0.5)
                temp = data.get("temperature_c", 25.0)
                reset_deg = data.get("reset_degradation", False)
                engine.reset(soc, temp, reset_deg)
                await websocket.send_json({
                    "type": "status",
                    "status": "idle",
                    "message": "Simulation reset",
                })

                # Auto-restart after reset
                await asyncio.sleep(0.1)
                if not engine._profile:
                    engine.set_profile("constant_discharge", c_rate=0.5)
                engine.set_callback(broadcast)
                _simulation_task = asyncio.create_task(_run_simulation(engine, websocket))
                await websocket.send_json({"type": "status", "status": "running"})

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
                )
                pack = BatteryPack(pack_cfg)
                set_pack(pack)

                await websocket.send_json({
                    "type": "pack_configured",
                    "n_series": pack_cfg.n_series,
                    "n_parallel": pack_cfg.n_parallel,
                    "n_cells": pack.n_cells,
                    "cells": _convert_numpy(pack.get_cell_summary()),
                })

    except WebSocketDisconnect:
        pass
    finally:
        _clients.discard(websocket)


async def _run_simulation(engine, websocket: WebSocket):
    """Background task to run the simulation with auto-cycling."""
    cycle_profiles = [
        ("constant_discharge", {"c_rate": 0.5}),
        ("constant_charge", {"c_rate": 0.5}),
    ]
    cycle_idx = 0

    while True:
        try:
            await engine.run_async()
            # When one profile completes, switch to the next and continue
            try:
                await websocket.send_json({
                    "type": "status",
                    "status": "cycling",
                    "message": f"Cycle complete, switching profile...",
                })
            except Exception:
                break

            # Switch to next profile in the cycle
            cycle_idx = (cycle_idx + 1) % len(cycle_profiles)
            profile_type, params = cycle_profiles[cycle_idx]
            engine.set_profile(profile_type, **params)
            engine.state = engine.state.__class__("idle")
            engine._sim_time = 0.0

            await asyncio.sleep(0.5)

        except Exception as e:
            import traceback
            traceback.print_exc()
            print(f"[SIM ERROR] {e}")
            try:
                await websocket.send_json({
                    "type": "error",
                    "message": f"Simulation error: {str(e)}",
                })
            except Exception:
                pass
            break
