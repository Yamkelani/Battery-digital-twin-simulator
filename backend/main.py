"""
Battery Digital Twin - FastAPI Application
=============================================

Main entry point for the backend server.
Serves the REST API and WebSocket endpoints.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import router, set_engine
from api.websocket import ws_router
from simulation.engine import SimulationEngine, SimulationConfig
from models.battery_cell import BatteryCellConfig

# ─── Create Application ─────────────────────────────────────────────────────

app = FastAPI(
    title="Battery Digital Twin",
    description="3D Digital Twin for Li-ion Battery Simulation — "
                "Electrochemical, thermal, and degradation modeling",
    version="1.0.0",
)

# ─── CORS (allow frontend dev server) ───────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ─── Include Routers ────────────────────────────────────────────────────────

app.include_router(router)
app.include_router(ws_router)

# ─── Initialize Default Simulation ──────────────────────────────────────────

@app.on_event("startup")
async def startup():
    """Initialize the default simulation engine on startup."""
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
    # Set default profile
    engine.set_profile("constant_discharge", c_rate=0.5)

    set_engine(engine)
    print("🔋 Battery Digital Twin backend started")
    print(f"   Cell: {cell_config.cell_id} | {cell_config.chemistry}")
    print(f"   Capacity: {cell_config.nominal_capacity_ah}Ah | Voltage: {cell_config.nominal_voltage_v}V")


@app.get("/")
async def root():
    return {
        "name": "Battery Digital Twin API",
        "version": "1.0.0",
        "docs": "/docs",
        "websocket": "/ws/simulation",
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
