"""
Battery Digital Twin - FastAPI Application
=============================================

Main entry point for the backend server.
Serves the REST API and WebSocket endpoints.
"""

import logging
import traceback
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from api.routes import router, set_engine
from api.websocket import ws_router, _clients
from simulation.engine import SimulationEngine, SimulationConfig
from models.battery_cell import BatteryCellConfig

# ─── Logging Configuration ──────────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("battery_dt")

# ─── Application Lifespan ───────────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup / shutdown lifecycle for the application."""
    # ── Startup ──
    cell_config = BatteryCellConfig(
        cell_id="CELL_001",
        chemistry="NMC622/Graphite",
        nominal_capacity_ah=50.0,
        nominal_voltage_v=3.7,
        initial_soc=0.8,
        initial_temperature_c=25.0,
        enable_thermal=True,
        enable_degradation=True,
        enable_electrochemical=True,
    )

    sim_config = SimulationConfig(
        dt=1.0,
        output_interval=2.0,
        speed_multiplier=50.0,
        max_sim_time_s=86400.0,
    )

    engine = SimulationEngine(cell_config, sim_config)
    engine.set_profile("constant_discharge", c_rate=0.5)
    set_engine(engine)

    logger.info("Backend started")
    logger.info("  Cell: %s | %s", cell_config.cell_id, cell_config.chemistry)
    logger.info("  Capacity: %sAh | Voltage: %sV", cell_config.nominal_capacity_ah, cell_config.nominal_voltage_v)

    yield  # ← application runs here

    # ── Shutdown ──  (clean up WebSocket connections gracefully)
    for ws in list(_clients):
        try:
            await ws.close()
        except Exception:
            pass
    _clients.clear()
    logger.info("Backend shut down — all WebSocket clients closed")


# ─── Create Application ─────────────────────────────────────────────────────

app = FastAPI(
    title="Battery Digital Twin",
    description="3D Digital Twin for Li-ion Battery Simulation — "
                "Electrochemical, thermal, and degradation modeling",
    version="1.0.0",
    lifespan=lifespan,
)


# ─── Global Exception Handling ──────────────────────────────────────────────

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Catch any unhandled exception and return a safe JSON response."""
    logger.error("Unhandled exception on %s %s: %s",
                 request.method, request.url.path, exc)
    logger.debug(traceback.format_exc())
    return JSONResponse(
        status_code=500,
        content={
            "error": "Internal server error",
            "detail": str(exc)[:500],  # Truncate extremely long messages
            "path": str(request.url.path),
        },
    )


class SafetyMiddleware(BaseHTTPMiddleware):
    """Catch exceptions that slip past route handlers (e.g. middleware errors)."""

    async def dispatch(self, request: Request, call_next):
        try:
            return await call_next(request)
        except Exception as exc:
            logger.error("Middleware caught exception on %s %s: %s",
                         request.method, request.url.path, exc)
            return JSONResponse(
                status_code=500,
                content={"error": "Internal server error", "detail": str(exc)[:500]},
            )

app.add_middleware(SafetyMiddleware)

# ─── CORS (allow frontend dev server) ───────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://localhost:3000",
        "http://localhost:8001",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:8001",
        "file://",               # Electron production
        "app://.",               # Electron custom scheme
    ],
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Include Routers ────────────────────────────────────────────────────────

app.include_router(router)
app.include_router(ws_router)

# ─── Health Check ────────────────────────────────────────────────────────────

@app.get("/")
async def root():
    return {
        "name": "Battery Digital Twin API",
        "version": "1.0.0",
        "docs": "/docs",
        "websocket": "/ws/simulation",
    }


@app.get("/health")
async def health():
    """Lightweight liveness probe for monitoring / load-balancers."""
    return {"status": "ok"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001, reload=True, ws="wsproto")
