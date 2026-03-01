# Battery Digital Twin — 3D Simulation Platform

A comprehensive **3D digital twin** for lithium-ion battery simulation, modeling the complete physics of charge/discharge dynamics, thermal behavior, and degradation mechanisms.

![Architecture](https://img.shields.io/badge/Architecture-Digital_Twin-blue)
![Python](https://img.shields.io/badge/Backend-Python_FastAPI-green)
![React](https://img.shields.io/badge/Frontend-React_Three.js-purple)

---

## Overview

This platform provides a real-time, interactive 3D simulation of a Li-ion battery cell (NMC622/Graphite chemistry). It couples four physics models that run simultaneously and stream data to a browser-based 3D visualization.

### Physics Models

| Model | Method | What it captures |
|-------|--------|-----------------|
| **Equivalent Circuit (2RC Thevenin)** | ODE (RK4) | Terminal voltage, SOC via coulomb counting, polarization dynamics |
| **Lumped Thermal (2-state)** | ODE (RK4) | Core & surface temperature, convection, radiation, heat generation |
| **Degradation** | Semi-empirical | SEI growth (calendar aging), cycle aging, lithium plating, resistance growth |
| **Single Particle Model** | PDE (FDM) | Lithium diffusion in electrode particles, concentration gradients |

### Key Equations

**Equivalent Circuit Model:**
```
V_terminal = OCV(SOC) - I·R₀ - V_RC1 - V_RC2
dSOC/dt = -I / (Q_nom · 3600)
dV₁/dt = -V₁/(R₁C₁) + I/C₁
dV₂/dt = -V₂/(R₂C₂) + I/C₂
```

**Thermal Model:**
```
m·Cp · dT_core/dt = Q_gen - (T_core - T_surf)/R_cond
Q_gen = I²R + I·T·(dOCV/dT)   [Ohmic + Entropic]
Q_loss = h·A·(T_surf - T_amb) + ε·σ·A·(T_surf⁴ - T_amb⁴)
```

**Degradation (SEI growth):**
```
Q_loss_SEI = k_SEI · exp(-Ea/(R·T)) · √t     [Arrhenius + √t]
Q_loss_cyc = k_cyc · exp(-Ea/(R·T)) · Ah^z    [Power-law cycling]
```

**Single Particle Diffusion (Fick's law in spherical coords):**
```
∂c/∂t = Ds/r² · ∂/∂r(r² · ∂c/∂r)
```

All temperature-dependent parameters use the **Arrhenius relationship**:
```
P(T) = P_ref · exp(Ea/R · (1/T - 1/T_ref))
```

---

## Technology Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Simulation Engine** | Python 3.11+ / NumPy / SciPy | ODE/PDE solving, electrochemical models |
| **Backend API** | FastAPI + WebSocket | Real-time data streaming, REST configuration |
| **3D Rendering** | Three.js / React Three Fiber | GPU-accelerated battery visualization |
| **UI Framework** | React 18 + TypeScript | Type-safe component architecture |
| **Build Tool** | Vite | Fast HMR, optimized builds |
| **Charts** | Recharts | Time-series data visualization |
| **State Management** | Zustand | Reactive simulation state |
| **Styling** | Tailwind CSS | Consistent dark theme UI |

---

## Project Structure

```
battery_simulator/
├── backend/
│   ├── main.py                          # FastAPI application entry point
│   ├── requirements.txt                 # Python dependencies
│   ├── models/
│   │   ├── equivalent_circuit.py        # 2RC Thevenin ECM model
│   │   ├── thermal.py                   # Lumped thermal model
│   │   ├── degradation.py               # SEI, cycle aging, Li plating
│   │   ├── electrochemical.py           # Single Particle Model (SPM)
│   │   └── battery_cell.py              # Integrated cell digital twin
│   ├── simulation/
│   │   ├── engine.py                    # Simulation orchestrator
│   │   └── profiles.py                  # Load profiles (CC, CCCV, drive, solar)
│   └── api/
│       ├── routes.py                    # REST API endpoints
│       └── websocket.py                 # WebSocket real-time streaming
│
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   └── src/
│       ├── main.tsx                     # React entry point
│       ├── App.tsx
│       ├── index.css                    # Global styles
│       ├── types/
│       │   └── battery.ts              # TypeScript type definitions
│       ├── utils/
│       │   └── colors.ts              # Color mapping utilities
│       ├── hooks/
│       │   ├── useBatteryState.ts     # Zustand store
│       │   └── useSimulation.ts       # WebSocket connection hook
│       └── components/
│           ├── Dashboard.tsx           # Main layout
│           ├── Scene.tsx               # Three.js scene setup
│           ├── BatteryCell3D.tsx       # 3D battery cell model
│           ├── ParticleFlow.tsx        # Ion flow particle system
│           ├── HeatMap.tsx             # Temperature heat map
│           ├── Charts.tsx              # Time-series charts
│           ├── Controls.tsx            # Simulation control panel
│           └── StatusPanel.tsx         # Real-time metrics HUD
│
└── README.md
```

---

## Quick Start

### Prerequisites

- **Python 3.11+** with pip
- **Node.js 18+** with npm

### 1. Backend Setup

```bash
cd backend

# Create virtual environment
python -m venv venv
venv\Scripts\activate          # Windows
# source venv/bin/activate     # Linux/Mac

# Install dependencies
pip install -r requirements.txt

# Start the server
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

The API server starts at `http://localhost:8000` with interactive docs at `/docs`.

### 2. Frontend Setup

```bash
cd frontend

# Install dependencies
npm install

# Start dev server
npm run dev
```

Open `http://localhost:5173` in your browser.

---

## Usage Guide

### Simulation Controls

1. **Select a Load Profile** — Choose from constant current discharge/charge, CCCV charging, drive cycle (EV), solar+storage, or cycle aging tests
2. **Set Initial Conditions** — Adjust starting SOC, cell temperature, and ambient temperature
3. **Configure Models** — Toggle thermal, degradation, and electrochemical models on/off
4. **Start Simulation** — Click Start and watch the 3D battery respond in real-time
5. **Adjust Speed** — Use the speed slider to run faster than real-time (up to 200x)

### Load Profiles

| Profile | Description | Key Parameters |
|---------|-------------|----------------|
| **Constant Discharge** | Fixed C-rate discharge | C-rate (0.1-3C) |
| **Constant Charge** | Fixed C-rate charge | C-rate (0.1-3C) |
| **CCCV Charge** | Industry-standard CC-CV protocol | C-rate, CV voltage |
| **Drive Cycle** | Simulated EV driving with regen braking | Aggressiveness (0.5-2x) |
| **Solar + Storage** | 24h PV self-consumption with household load | PV peak (kW) |
| **Cycle Aging** | Repeated charge-discharge for aging studies | C-rate, # cycles |

### 3D Visualization

- **Battery color** changes with SOC (green → yellow → red)
- **Particle flow** shows lithium-ion transport (speed = current magnitude, direction = charge/discharge)
- **Heat map overlay** appears when temperature deviates from ambient
- **Terminal glow** indicates current flow intensity
- **Electrode layers** pulse with electrochemical activity
- **SOH degradation** shows as surface discoloration

### Real-Time Metrics Panel

- **SOC gauge** with circular progress indicator
- **Voltage, Current, Power** with color-coded values
- **Temperature** (core, surface, gradient) with color warnings
- **SOH** with degradation mechanism breakdown (SEI/cycle/plating bars)
- **Warnings** for over-temperature and thermal runaway risk

---

## API Reference

### REST Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/status` | Current simulation status and summary |
| GET | `/api/profiles` | Available load profiles |
| POST | `/api/configure/cell` | Configure battery cell parameters |
| POST | `/api/configure/simulation` | Set simulation parameters |
| POST | `/api/profile` | Select and configure load profile |
| POST | `/api/reset` | Reset simulation |
| POST | `/api/run/batch` | Run batch simulation (non-streaming) |
| GET | `/api/history` | Get time-series history data |
| GET | `/api/state` | Get latest simulation state |
| GET | `/api/visualization` | Get 3D visualization data |

### WebSocket

Connect to `ws://localhost:8000/ws/simulation` for real-time streaming.

**Send:**
```json
{"action": "start"}
{"action": "pause"}
{"action": "resume"}
{"action": "reset", "soc": 0.8}
{"action": "set_speed", "value": 50}
{"action": "set_profile", "type": "solar_storage", "params": {"pv_peak_kw": 8}}
```

**Receive:** Full battery state JSON every output interval.

---

## Battery Chemistry Reference

### NMC622/Graphite Cell Specifications

| Parameter | Value |
|-----------|-------|
| Chemistry | LiNi₀.₆Mn₀.₂Co₀.₂O₂ / Graphite |
| Nominal Capacity | 50 Ah |
| Nominal Voltage | 3.7 V |
| Voltage Window | 2.5 – 4.2 V |
| Form Factor | Prismatic (148 × 91 × 27 mm) |
| Mass | ~800 g |
| Energy Density | ~230 Wh/kg |

### Degradation Mechanisms Modeled

1. **SEI Layer Growth**: Solid Electrolyte Interphase formation on graphite anode. Consumes cyclable lithium, increases resistance. Rate ∝ √time, accelerated by temperature (Arrhenius).

2. **Cycle Aging**: Mechanical stress from lithium intercalation/deintercalation causes particle cracking and loss of active material. Rate ∝ Ah-throughput, influenced by DOD and temperature.

3. **Lithium Plating**: At low temperatures (<5°C) or high charge C-rates (>2C), metallic lithium deposits on the anode surface. Irreversible capacity loss, potential safety hazard.

4. **Resistance Growth**: Combined effect of SEI thickening and contact loss. Increases internal impedance, reduces power capability, generates more heat.

---

## License

MIT License — Free for educational, research, and commercial use.
