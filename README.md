# Battery Digital Twin — 3D Simulation Platform

A comprehensive **3D digital twin** for lithium-ion battery simulation, modeling the complete physics of charge/discharge dynamics, thermal behavior, electrochemical transport, and multi-mechanism degradation — from a single cell to multi-cell pack configurations with BMS.

![Architecture](https://img.shields.io/badge/Architecture-Digital_Twin-blue)
![Python](https://img.shields.io/badge/Backend-Python_FastAPI-green)
![React](https://img.shields.io/badge/Frontend-React_Three.js-purple)
![License](https://img.shields.io/badge/License-MIT-yellow)

---

## Table of Contents

- [Overview](#overview)
- [Physics Models & Equations](#physics-models--equations)
  - [Equivalent Circuit Model (2RC Thevenin)](#1-equivalent-circuit-model-2rc-thevenin)
  - [Lumped Thermal Model (2-State)](#2-lumped-thermal-model-2-state)
  - [Degradation Model (Multi-Mechanism)](#3-degradation-model-multi-mechanism)
  - [Single Particle Model (SPM)](#4-single-particle-model-spm)
  - [Battery Pack Model](#5-battery-pack-model)
  - [Battery Management System (BMS)](#6-battery-management-system-bms)
  - [Model Coupling & Integration](#7-model-coupling--integration)
- [Technology Stack](#technology-stack)
- [Project Structure](#project-structure)
- [Quick Start](#quick-start)
- [Usage Guide](#usage-guide)
  - [Simulation Controls](#simulation-controls)
  - [Load Profiles](#load-profiles)
  - [3D Visualization](#3d-visualization)
  - [Analysis Views](#analysis-views)
  - [ML Dataset Export](#ml-dataset-export)
- [API Reference](#api-reference)
  - [REST Endpoints](#rest-endpoints)
  - [WebSocket Protocol](#websocket-protocol)
- [Cell Specifications](#cell-specifications)
- [Dependencies](#dependencies)
- [License](#license)

---

## Overview

This platform provides a **real-time, interactive 3D simulation** of a Li-ion battery cell (NMC622/Graphite chemistry) with support for multi-cell pack configurations. Five tightly-coupled physics models run simultaneously, streaming data over WebSocket to a browser-based 3D visualization at up to 200× real-time.

### What It Models

| Model | Method | What It Captures |
|-------|--------|-----------------|
| **Equivalent Circuit (2RC Thevenin)** | ODE (RK4) | Terminal voltage, SOC via coulomb counting, RC polarization dynamics |
| **Lumped Thermal (2-State)** | ODE (RK4) | Core & surface temperature, convection, radiation, internal heat generation |
| **Degradation (Multi-Mechanism)** | Semi-empirical | SEI growth, cycle aging, lithium plating, resistance growth, RUL estimation |
| **Single Particle Model** | PDE (FDM) | Lithium-ion diffusion in electrode particles, concentration gradients |
| **Battery Pack** | Cell array + thermal coupling | Series/parallel packs with manufacturing variation & inter-cell heat transfer |
| **Battery Management System** | Rule-based | Fault detection, passive balancing, contactor control, safety limits |

### Key Capabilities

- Real-time 3D battery visualization with SOC color mapping, thermal heat maps, and degradation effects
- Multi-cell pack simulation (N×M grid) with thermal coupling and cell-to-cell variation
- Five load profiles: constant current, CC-CV charging, EV drive cycle, solar + storage, cycle aging
- Electrochemical Impedance Spectroscopy (EIS) Nyquist plots
- Differential capacity (dQ/dV) analysis for aging diagnostics
- Remaining Useful Life (RUL) prediction with confidence intervals
- ML-ready dataset export for battery state-of-health prediction research
- BMS dashboard with fault monitoring, contactor state, and passive balancing visualization

---

## Physics Models & Equations

### 1. Equivalent Circuit Model (2RC Thevenin)

The electrical behavior is modeled by a second-order Thevenin equivalent circuit — an OCV source in series with an ohmic resistance $R_0$ and two parallel RC pairs representing electrochemical polarization ($R_1 C_1$, $\tau_1 \approx 10\text{s}$) and diffusion ($R_2 C_2$, $\tau_2 \approx 100\text{s}$).

**State vector:** $\mathbf{x} = [\text{SOC},\; V_{RC1},\; V_{RC2}]$

**Terminal voltage:**

$$V_{terminal} = \text{OCV}(\text{SOC}) - I \cdot R_0(T) - V_{RC1} - V_{RC2}$$

**State equations (solved with 4th-order Runge-Kutta):**

$$\frac{d(\text{SOC})}{dt} = \frac{-I}{Q_{eff} \cdot 3600}$$

$$\frac{dV_{RC1}}{dt} = \frac{-V_{RC1}}{R_1 C_1} + \frac{I}{C_1}$$

$$\frac{dV_{RC2}}{dt} = \frac{-V_{RC2}}{R_2 C_2} + \frac{I}{C_2}$$

where $Q_{eff} = Q_{nom} \times \text{capacity\_retention}$ accounts for degradation.

**Temperature dependence** — all resistances follow the Arrhenius relationship:

$$R(T) = R_{ref} \cdot \exp\left[\frac{E_a}{R_{gas}} \left(\frac{1}{T} - \frac{1}{T_{ref}}\right)\right]$$

| Parameter | Value | Description |
|-----------|-------|-------------|
| $R_{0,ref}$ | 0.015 Ω | Ohmic resistance at 25°C |
| $R_{1,ref}$ | 0.010 Ω | Electrochemical polarization resistance |
| $C_1$ | 1000 F | Electrochemical polarization capacitance |
| $R_{2,ref}$ | 0.005 Ω | Diffusion resistance |
| $C_2$ | 20000 F | Diffusion capacitance |
| $E_{a,R_0}$ | 20,000 J/mol | Activation energy for $R_0$ |
| $E_{a,R_1}$ | 25,000 J/mol | Activation energy for $R_1$ |
| $E_{a,R_2}$ | 30,000 J/mol | Activation energy for $R_2$ |
| $T_{ref}$ | 298.15 K | Reference temperature |

**OCV lookup:** 21-point NMC622/Graphite SOC–OCV table (2.50 V at SOC = 0 → 4.20 V at SOC = 1), linearly interpolated.

**Electrochemical Impedance Spectroscopy (EIS):**

$$Z(j\omega) = R_0 + \frac{R_1}{1 + j\omega R_1 C_1} + \frac{R_2}{1 + j\omega R_2 C_2}$$

Computed across $10^{-2}$ – $10^{4}$ Hz for Nyquist plot generation.

---

### 2. Lumped Thermal Model (2-State)

A two-node lumped model tracking **core** and **surface** temperatures of the prismatic cell (148 × 91 × 27 mm).

**State vector:** $\mathbf{T} = [T_{core},\; T_{surface}]$ in Kelvin.

**Core energy balance:**

$$m \cdot C_p \cdot \frac{dT_{core}}{dt} = Q_{gen} - Q_{cond}$$

**Surface energy balance:**

$$m_s \cdot C_{p,s} \cdot \frac{dT_{surface}}{dt} = Q_{cond} - Q_{conv} - Q_{rad}$$

**Heat generation** (three components):

$$Q_{gen} = \underbrace{I^2 R_0}_{\text{Ohmic}} + \underbrace{V_{RC1} \cdot I + V_{RC2} \cdot I}_{\text{Polarization}} + \underbrace{I \cdot T \cdot \frac{d(\text{OCV})}{dT}}_{\text{Entropic (reversible)}}$$

**Conduction** (core → surface):

$$Q_{cond} = \frac{T_{core} - T_{surface}}{R_{cond}}$$

**Convective cooling** (Newton's law):

$$Q_{conv} = h_{conv} \cdot A_{surface} \cdot (T_{surface} - T_{ambient})$$

**Radiative cooling** (Stefan-Boltzmann):

$$Q_{rad} = \varepsilon \cdot \sigma \cdot A_{surface} \cdot (T_{surface}^4 - T_{ambient}^4)$$

where $\sigma = 5.67 \times 10^{-8} \; \text{W/(m²·K⁴)}$.

**Surface area** from prismatic geometry:

$$A_{surface} = 2(l \cdot w + l \cdot h + w \cdot h)$$

| Parameter | Value | Description |
|-----------|-------|-------------|
| $m$ | 0.8 kg | Core mass |
| $C_p$ | 1000 J/(kg·K) | Core specific heat |
| $m_s$ | 0.15 kg | Surface node mass |
| $C_{p,s}$ | 500 J/(kg·K) | Surface specific heat |
| $R_{cond}$ | 1.5 K/W | Core-to-surface thermal resistance |
| $h_{conv}$ | 10.0 W/(m²·K) | Natural convection coefficient |
| $\varepsilon$ | 0.9 | Surface emissivity |
| $T_{ambient}$ | 298.15 K (25°C) | Default ambient temperature |
| $T_{max}$ | 333.15 K (60°C) | Maximum operating temperature |
| $T_{critical}$ | 353.15 K (80°C) | Thermal runaway risk threshold |

**Visualization:** A 20-point parabolic temperature distribution is computed for 3D heat map rendering:

$$T(x) = T_{core} - (T_{core} - T_{surface}) \cdot x^2, \quad x \in [0, 1]$$

**Average temperature** (weighted): $T_{avg} = 0.7 \cdot T_{core} + 0.3 \cdot T_{surface}$

---

### 3. Degradation Model (Multi-Mechanism)

Four degradation mechanisms are tracked cumulatively with accelerated aging via a configurable time factor.

#### 3a. SEI Layer Growth (Calendar Aging)

The Solid Electrolyte Interphase forms on the graphite anode, consuming cyclable lithium and increasing resistance. Growth follows an Arrhenius-activated square-root-of-time law:

$$Q_{loss,SEI} = k_{SEI} \cdot \exp\left[\frac{E_{a,SEI}}{R_{gas}} \left(\frac{1}{T_{ref}} - \frac{1}{T}\right)\right] \cdot \sqrt{t}$$

Incremental (rate) form used in simulation:

$$\frac{dQ_{loss,SEI}}{dt} = k_{SEI} \cdot f_{Arrh}(T) \cdot \frac{0.5}{\sqrt{t + \epsilon}}$$

| Parameter | Value |
|-----------|-------|
| $k_{SEI}$ | $6.5 \times 10^{-5}$ |
| $E_{a,SEI}$ | 20,000 J/mol |
| $k_{SEI,resistance}$ | $1.0 \times 10^{-4}$ Ω/√s |

#### 3b. Cycle Aging (Mechanical Degradation)

Mechanical stress from lithium intercalation/deintercalation causes particle cracking and loss of active material. Modeled as a power law of Ah-throughput with a depth-of-discharge stress factor:

$$Q_{loss,cyc} = k_{cyc} \cdot f_{Arrh}(T) \cdot f_{DOD} \cdot (Ah_{throughput})^z$$

$$f_{DOD} = 1 + k_{DOD} \cdot \Delta \text{SOC}$$

| Parameter | Value |
|-----------|-------|
| $k_{cyc}$ | $2.5 \times 10^{-4}$ |
| $E_{a,cyc}$ | 18,000 J/mol |
| $z$ | 0.55 |
| $k_{DOD}$ | 1.5 |
| $k_{cyc,resistance}$ | $8.0 \times 10^{-5}$ |

#### 3c. Lithium Plating

At low temperatures or high charge C-rates, metallic lithium deposits on the anode surface — an irreversible capacity loss and safety hazard. Onset requires charging ($I < 0$) AND either low temperature or high C-rate:

$$T_{factor} = \max\!\big(0,\; (T_{plating,onset} - T) / 10\big)$$

$$C_{factor} = \max\!\big(0,\; C_{rate} - 0.5 \cdot C_{threshold}\big)$$

$$\text{SOC}_{factor} = \max\!\big(0,\; \text{SOC} - 0.8\big) \times 5$$

$$\text{rate} = k_{plating} \cdot (T_{factor} + C_{factor}) \cdot (1 + \text{SOC}_{factor}) \cdot \frac{|I|}{3600}$$

| Parameter | Value |
|-----------|-------|
| $k_{plating}$ | $5.0 \times 10^{-6}$ |
| $T_{plating,onset}$ | 303.15 K (30°C) |
| $C_{rate,threshold}$ | 0.3 |

#### 3d. Resistance Growth

Combined SEI-driven and cycle-driven resistance increase, capped at $2\times$ the original resistance:

$$R_{factor} = 1 + \Delta R_{SEI}(t, T) + \Delta R_{cyc}(Ah, T)$$

#### 3e. Remaining Useful Life (RUL) Estimation

Linear extrapolation from observed degradation rate:

$$\text{degradation per cycle} = \frac{1 - \text{capacity\_retention}}{\text{total\_cycles}}$$

$$\text{RUL}_{cycles} = \frac{\text{capacity\_retention} - \text{EOL}_{threshold}}{\text{degradation per cycle}}$$

where $\text{EOL}_{threshold} = 0.80$ (80% of original capacity). Default fresh-cell estimate: 5,000 cycles.

**State of Health:**

$$\text{SOH} = \text{capacity\_retention} \times 100\%$$

$$\text{capacity\_retention} = 1 - Q_{loss,SEI} - Q_{loss,cyc} - Q_{loss,plating}$$

---

### 4. Single Particle Model (SPM)

A simplified electrochemical model solving lithium-ion diffusion inside spherical electrode particles for both the **negative electrode** (graphite) and **positive electrode** (NMC622).

**Governing equation** — Fick's 2nd law in spherical coordinates:

$$\frac{\partial c}{\partial t} = \frac{D_s}{r^2} \frac{\partial}{\partial r}\left(r^2 \frac{\partial c}{\partial r}\right)$$

**Boundary conditions:**

- **Center** (symmetry, with L'Hôpital's rule for $r \to 0$):

$$\left.\frac{\partial c}{\partial r}\right|_{r=0} = 0 \quad \Longrightarrow \quad \lim_{r \to 0} \frac{2}{r}\frac{\partial c}{\partial r} = 2\frac{\partial^2 c}{\partial r^2}$$

- **Surface** (molar flux from electrochemical reaction):

$$-D_s \left.\frac{\partial c}{\partial r}\right|_{r=R_p} = j_n$$

**Molar flux calculation:**

$$j_n = \frac{\pm I / A_{cell}}{a_s \cdot L \cdot F}, \quad a_s = \frac{3 \varepsilon_s}{R_p}$$

**Butler-Volmer kinetics** (exchange current density):

$$j_n = \frac{i_0}{F}\left[\exp\left(\frac{\alpha_a F \eta}{RT}\right) - \exp\left(\frac{-\alpha_c F \eta}{RT}\right)\right]$$

**Numerical method:** Explicit finite difference on $N_r = 30$ radial nodes with CFL stability limiting:

$$\Delta t_{max} = 0.4 \cdot \frac{\Delta r^2}{D_s}$$

| Parameter | Negative (Graphite) | Positive (NMC622) |
|-----------|---------------------|-------------------|
| Particle radius $R_p$ | 5.86 μm | 5.22 μm |
| Diffusion coefficient $D_{s,ref}$ | $3.9 \times 10^{-14}$ m²/s | $1.0 \times 10^{-14}$ m²/s |
| Activation energy $E_{a,D}$ | 35,000 J/mol | 29,000 J/mol |
| Max concentration $c_{s,max}$ | 30,555 mol/m³ | 51,555 mol/m³ |
| Volume fraction $\varepsilon_s$ | 0.49 | 0.335 |
| Electrode thickness $L$ | 85.2 μm | 75.6 μm |
| Transfer coefficient $\alpha$ | 0.5 | 0.5 |
| Reaction rate constant $k_{ref}$ | $6.48 \times 10^{-7}$ | $3.42 \times 10^{-6}$ |
| Stoichiometry range | 0.03 – 0.90 | 0.93 – 0.36 |
| Cell electrode area $A_{cell}$ | 0.1027 m² | — |

**Output:** Normalized concentration profiles (center-to-surface), surface & average stoichiometries, concentration gradient magnitude, diffusion limitation indicator.

---

### 5. Battery Pack Model

Configurable $N_{series} \times N_{parallel}$ cell array with manufacturing variation and inter-cell thermal coupling.

**Pack electrical model:**

$$V_{pack} = \frac{1}{N_{parallel}} \sum_{j=1}^{N_{parallel}} \sum_{i=1}^{N_{series}} V_{cell,ij}$$

$$I_{string} = \frac{I_{pack}}{N_{parallel}}$$

**Manufacturing variation** (deterministic seed = 42 for reproducibility):

$$C_{cell} \sim \mathcal{N}\!\left(C_{nom},\; \sigma_{cap} = C_{nom} \times \frac{\text{variation\%}}{100}\right), \quad \min: 0.8 \cdot C_{nom}$$

$$R_{0,cell} \sim R_{0,nom} \times \mathcal{N}(1.0,\; \text{variation\%}/100), \quad \min: 0.8 \times R_{0,nom}$$

**Thermal coupling** (surface-to-surface heat transfer between adjacent cells):

$$Q_{ij} = G \cdot (T_{surface,i} - T_{surface,j})$$

| Coupling Type | Conductance |
|---------------|-------------|
| Series-adjacent (same string) | $G_{full} = 0.5$ W/K |
| Cross-string (parallel) | $G_{cross} = 0.6 \times G_{full}$ |

**Edge cell convection enhancement:**

$$h_{conv,edge} = h_{base} \times (1 + 0.15 \times \text{exposed\_faces})$$

$$h_{conv,interior} = h_{base} \times 0.75$$

**Heat injection to surface node:**

$$\Delta T_{surface} = \frac{Q_{coupling} \cdot dt}{m_s \cdot C_{p,s}}$$

| Pack Parameter | Default |
|----------------|---------|
| $N_{series}$ | 1 |
| $N_{parallel}$ | 1 |
| Base capacity | 50.0 Ah |
| Capacity variation | 2.0% |
| Resistance variation | 3.0% |
| Inter-cell thermal conductance | 0.5 W/K |
| Initial SOC | 0.8 |
| Degradation time factor | 100× |

---

### 6. Battery Management System (BMS)

Rule-based BMS with fault detection, passive balancing, and contactor control.

**Fault detection thresholds:**

| Fault Type | Trigger Condition |
|------------|-------------------|
| Over-voltage | $V_{cell} > 4.25$ V |
| Under-voltage | $V_{cell} < 2.50$ V |
| Over-temperature | $T_{cell} > 55$°C |
| Under-temperature | $T_{cell} < -20$°C |
| Thermal runaway | $T_{cell} > 75$°C |
| Over-current | $I_{pack} > 150$ A |
| Cell imbalance | $\Delta V_{max} > 0.05$ V |

**Passive balancing** (resistive bleeding):

$$I_{bleed} = \begin{cases} 0.05 \;\text{A} & \text{if } V_{cell} - V_{min,pack} > 0.01 \;\text{V} \\ 0 & \text{otherwise} \end{cases}$$

**Contactor control:**
- Pre-charge delay: 2.0 s before main contactor closes
- Thermal runaway detected → immediate contactor open (emergency disconnect)
- Fault history: stores last 50 events with onset and clearance timestamps

---

### 7. Model Coupling & Integration

The `BatteryCell` class integrates all sub-models in a tightly coupled loop executed each time step:

```
┌─────────────────────────────────────────────────────────────────────┐
│                        BatteryCell.step(I, dt)                      │
│                                                                     │
│   1. ECM step(I, dt, T, cap_factor, res_factor)                    │
│        → V_terminal, SOC, power losses                              │
│                                                                     │
│   2. Thermal step(I, V, T_core, T_surface, Q_gen, dt)             │
│        → T_core_new, T_surface_new                                  │
│                                                                     │
│   3. Degradation step(I, V, T, SOC, dt × time_factor)             │
│        → capacity_retention, resistance_factor, SOH                 │
│                                                                     │
│   4. SPM step(I, T, dt)                                            │
│        → concentration profiles, gradients, stoichiometries         │
│                                                                     │
│   Return: 50+ field state dictionary                                │
└─────────────────────────────────────────────────────────────────────┘
```

The degradation model feeds capacity and resistance factors **back into the ECM** on the next step, creating a closed-loop aging feedback. The thermal model receives heat generation from the ECM, and both ECM and SPM receive the updated temperature for Arrhenius-corrected parameters.

**Energy efficiency tracking** (computed by the simulation engine):

$$\eta_{coulombic} = \frac{Ah_{discharge}}{Ah_{charge}} \times 100\%$$

$$\eta_{energy} = \frac{Wh_{discharge}}{Wh_{charge}} \times 100\%$$

**CC-CV phase detection:** The engine identifies the charging phase (`CC`, `CV`, or `idle`) from current and voltage trends and annotates each data frame for the CC-CV chart.

---

## Technology Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Simulation Engine** | Python 3.11+ / NumPy / SciPy | ODE/PDE solving, electrochemical models |
| **Backend API** | FastAPI + uvicorn + WebSocket | Real-time streaming, REST configuration |
| **3D Rendering** | Three.js / React Three Fiber / Drei | GPU-accelerated battery visualization |
| **UI Framework** | React 18 + TypeScript 5.3 | Type-safe component architecture |
| **Build Tool** | Vite 5 | Fast HMR, optimized builds |
| **Charts** | Recharts 2.10 | Time-series and analytical charts |
| **State Management** | Zustand 4.4 | Reactive simulation state |
| **Styling** | Tailwind CSS 3.4 | Dark-theme UI |
| **GUI Controls** | Leva 0.9 | Debug parameter tuning |

---

## Project Structure

```
battery_simulator/
├── backend/
│   ├── main.py                          # FastAPI app entry point, default configs
│   ├── requirements.txt                 # Python dependencies
│   ├── models/
│   │   ├── equivalent_circuit.py        # 2RC Thevenin ECM + EIS impedance
│   │   ├── thermal.py                   # 2-state lumped thermal model
│   │   ├── degradation.py               # SEI, cycle aging, Li plating, RUL
│   │   ├── electrochemical.py           # Single Particle Model (SPM)
│   │   ├── battery_cell.py              # Integrated cell digital twin
│   │   ├── battery_pack.py              # N×M pack with thermal coupling
│   │   └── bms.py                       # Battery Management System
│   ├── simulation/
│   │   ├── engine.py                    # Async simulation loop, RK4, energy tracking
│   │   └── profiles.py                  # Load profiles (CC, CCCV, drive, solar, aging)
│   └── api/
│       ├── routes.py                    # REST endpoints (20+)
│       ├── websocket.py                 # WebSocket streaming + auto-cycling
│       └── schemas.py                   # Pydantic request/response models
│
├── frontend/
│   ├── package.json
│   ├── vite.config.ts
│   ├── tailwind.config.js
│   └── src/
│       ├── main.tsx                     # React entry point
│       ├── App.tsx                      # Root component
│       ├── index.css                    # Global Tailwind styles
│       ├── types/
│       │   └── battery.ts              # TypeScript types (80+ fields)
│       ├── utils/
│       │   └── colors.ts              # SOC/SOH/temp color mapping
│       ├── hooks/
│       │   ├── useBatteryState.ts     # Zustand store (simulation + pack + UI state)
│       │   └── useSimulation.ts       # WebSocket connection & control hook
│       ├── context/                    # React context providers
│       └── components/
│           ├── Dashboard.tsx           # Main layout with tabbed views
│           ├── Scene.tsx               # Three.js canvas (single cell / pack)
│           ├── BatteryCell3D.tsx       # 3D prismatic cell with animations
│           ├── PackView3D.tsx          # 3D pack grid with thermal links
│           ├── PackBuilder.tsx         # Pack configuration UI
│           ├── ParticleFlow.tsx        # Li-ion transport particle system
│           ├── HeatMap.tsx             # 3D temperature heat map overlay
│           ├── Charts.tsx              # Time-series charts (SOC, V, I, T, SOH)
│           ├── Controls.tsx            # Simulation control panel
│           ├── StatusPanel.tsx         # Real-time metrics HUD + pack summary
│           ├── NyquistPlot.tsx         # EIS Nyquist diagram
│           ├── DQDVChart.tsx           # Differential capacity dQ/dV analysis
│           ├── CCCVChart.tsx           # CC-CV charging curves
│           ├── RULPanel.tsx            # RUL prediction analytics dashboard
│           ├── BMSPanel.tsx            # BMS fault status panel
│           ├── BMSDashboard.tsx        # Full BMS monitoring with circuit diagram
│           ├── MLExportPanel.tsx       # ML dataset generation UI
│           └── ExportButton.tsx        # CSV/JSON history download
│
├── start.ps1                           # PowerShell launch script
└── README.md
```

---

## Quick Start

### Prerequisites

- **Python 3.11+** with pip
- **Node.js 18+** with npm

### Option 1: PowerShell Launch Script

```powershell
.\start.ps1
```

This creates the Python venv, installs all dependencies, and starts both servers automatically.

### Option 2: Manual Setup

#### Backend

```bash
cd backend

# Create virtual environment
python -m venv venv
venv\Scripts\activate          # Windows
# source venv/bin/activate     # Linux/Mac

# Install dependencies
pip install -r requirements.txt

# Start the server (port 8001)
uvicorn main:app --reload --host 0.0.0.0 --port 8001 --ws-ping-interval 30 --ws-ping-timeout 30
```

#### Frontend

```bash
cd frontend

# Install dependencies
npm install

# Start dev server (port 5173)
npm run dev
```

Open **http://localhost:5173** in your browser. API docs available at **http://localhost:8001/docs**.

---

## Usage Guide

### Simulation Controls

1. **Select a Load Profile** — Choose from constant current, CC-CV charging, drive cycle, solar + storage, or cycle aging
2. **Set Initial Conditions** — Adjust starting SOC (0–100%), cell temperature, and ambient temperature
3. **Configure Cell** — Set capacity, toggle thermal / degradation / electrochemical models on/off
4. **Build a Pack** — Configure N×M grid with manufacturing variation and thermal coupling
5. **Start Simulation** — Click Start and watch the 3D battery respond in real-time
6. **Adjust Speed** — Use the speed slider (1× to 200× real-time)
7. **Reset** — Full reset of single cell, pack, BMS, degradation history, and all chart data

### Load Profiles

| Profile | Description | Key Parameters |
|---------|-------------|----------------|
| **Constant Discharge** | Fixed C-rate discharge to SOC floor | C-rate (0.1 – 3C), SOC min (0.05) |
| **Constant Charge** | Fixed C-rate charge to SOC ceiling | C-rate (0.1 – 3C), SOC max (0.95) |
| **CC-CV Charge** | Industry-standard constant-current / constant-voltage | CC at 0.5C → CV at 4.2 V → cutoff at 1.25 A |
| **Drive Cycle** | Simulated EV driving with regen braking | Aggressiveness (0.5 – 2.0×), urban + highway sinusoids |
| **Solar + Storage** | 24h PV self-consumption with household load | PV peak (kW), base load, morning/evening peaks |
| **Cycle Aging** | Repeated charge-discharge for degradation studies | C-rate, SOC range, rest periods between cycles |

The simulation auto-cycles between discharge and charge profiles when one completes, running indefinitely until stopped.

### 3D Visualization

- **Battery color** changes with SOC (green → yellow → red)
- **Particle flow** — 200-particle system showing Li-ion transport; speed proportional to current magnitude, direction flips on charge/discharge
- **Heat map overlay** — colored tiles (blue → red) appear as temperature deviates from ambient
- **Terminal glow** indicates current flow intensity
- **Internal layers** (anode / separator / cathode) pulse with electrochemical activity
- **SOH degradation** appears as surface discoloration and opacity changes
- **Cutaway / X-ray mode** reveals internal electrode layers
- **Pack grid** — click any cell to zoom in; thermal links drawn as colored lines (blue → red); current-flow arrows animate between cells

### Analysis Views

| View | Description |
|------|-------------|
| **Charts** | 4 synchronized time-series: SOC & Voltage, Current & Power, Temperature, SOH & Degradation |
| **Nyquist Plot** | EIS impedance spectrum ($\text{Re}(Z)$ vs $-\text{Im}(Z)$) at configurable temperature — shows ohmic, charge transfer, and diffusion arcs |
| **dQ/dV** | Differential capacity from charge history — peaks indicate phase transitions; broadening signals aging |
| **CC-CV** | Dual Y-axis view of voltage + current during CC-CV charging; color-coded CC/CV regions with transition annotation |
| **RUL** | Remaining Useful Life gauge, SOH trend line with EOL threshold + knee-point, degradation pie chart (SEI / Cycle / Plating), resistance growth, confidence interval |
| **BMS Dashboard** | Animated contactor circuit diagram, live per-cell voltage / temp / SOC bars, fault list, balancing activity, fault history |
| **ML Export** | Configure cycling experiments and export ML-ready datasets |

### ML Dataset Export

Generate labeled datasets for battery state-of-health (SOH) machine learning research:

**Available columns:**

| Column | Description |
|--------|-------------|
| `cycle` | Cycle number |
| `step` | Step within cycle |
| `time_s` | Elapsed time (s) |
| `current_a` | Applied current (A) |
| `voltage_v` | Terminal voltage (V) |
| `soc` | State of charge (0–1) |
| `temperature_c` | Cell temperature (°C) |
| `soh_pct` | State of health (%) |
| `sei_loss_pct` | SEI capacity loss (%) |
| `cycle_loss_pct` | Cycle aging loss (%) |
| `plating_loss_pct` | Plating loss (%) |
| `resistance_factor` | Normalized resistance growth |
| `capacity_retention` | Remaining capacity fraction |
| `ah_throughput` | Cumulative Ah throughput |
| `energy_wh` | Cumulative energy (Wh) |
| `heat_gen_w` | Heat generation rate (W) |
| `dv_dt` | Voltage rate of change (V/s) |
| `di_dt` | Current rate of change (A/s) |
| `rul_cycles` | Estimated remaining cycles |
| `is_charging` | Boolean charge flag |
| `c_rate` | Instantaneous C-rate |
| `dod` | Depth of discharge |
| `impedance_re` | Real part of impedance (Ω) |
| `impedance_im` | Imaginary part of impedance (Ω) |

**Suggested ML targets:**
- SOH prediction from voltage/current/temperature time series
- RUL prediction from degradation trajectory
- Anomaly detection from impedance spectra
- Degradation mode classification (SEI vs. cycle vs. plating)
- Capacity estimation from EIS features

Export formats: **CSV** or **JSON**.

---

## API Reference

### REST Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/status` | Simulation status and summary statistics |
| `GET` | `/api/profiles` | List of available load profiles |
| `GET` | `/api/state` | Latest simulation state (50+ fields) |
| `GET` | `/api/visualization` | 3D visualization data (geometry, heat map, ions) |
| `GET` | `/api/history` | Time-series history for charting |
| `POST` | `/api/configure/cell` | Configure cell parameters |
| `POST` | `/api/configure/simulation` | Set dt, speed, max time |
| `POST` | `/api/profile` | Select and configure load profile |
| `POST` | `/api/reset` | Reset simulation state |
| `POST` | `/api/run/batch` | Run batch simulation (blocking) |
| `GET` | `/api/export/json` | Download history as JSON file |
| `GET` | `/api/export/csv` | Download history as CSV file |
| `GET` | `/api/eis?temp_c=25` | EIS impedance spectrum at given temperature |
| `GET` | `/api/rul` | RUL prediction with knee-point and confidence |
| `GET` | `/api/pack/status` | Pack status with per-cell data and thermal links |
| `POST` | `/api/pack/configure` | Create/reconfigure pack (n_series, n_parallel, ...) |
| `GET` | `/api/bms/status` | BMS faults, contactor state, balancing status |
| `POST` | `/api/export/ml-dataset` | Generate ML-ready cycling dataset |
| `GET` | `/api/export/ml-dataset/schema` | ML dataset column descriptions and target suggestions |

### WebSocket Protocol

Connect to `ws://localhost:8001/ws/simulation` for real-time streaming.

**Client → Server messages:**

```json
{"action": "start"}
{"action": "pause"}
{"action": "resume"}
{"action": "stop"}
{"action": "reset", "soc": 0.8, "temperature_c": 25, "reset_degradation": true}
{"action": "set_speed", "value": 50}
{"action": "set_profile", "type": "drive_cycle", "params": {"aggressiveness": 1.5}}
{"action": "set_ambient_temp", "value": 35}
{"action": "configure_cell", "capacity_ah": 50, "enable_thermal": true}
{"action": "configure_pack", "n_series": 4, "n_parallel": 2}
```

**Server → Client messages:**

| Type | Description |
|------|-------------|
| `state` | Full battery state every output interval (50+ fields + pack cell data + thermal links) |
| `status` | Status changes: `running`, `idle`, `paused` |
| `config` | Configuration acknowledgments (speed, etc.) |
| `profile` | Active profile information |
| `error` | Error messages |

All request messages are validated via **Pydantic schemas** with discriminated unions.

---

## Cell Specifications

### NMC622/Graphite — 50 Ah Prismatic Cell

| Parameter | Value |
|-----------|-------|
| Chemistry | LiNi₀.₆Mn₀.₂Co₀.₂O₂ / Graphite |
| Nominal Capacity | 50 Ah |
| Nominal Voltage | 3.7 V |
| Energy | 185 Wh |
| Voltage Window | 2.5 – 4.2 V |
| Form Factor | Prismatic (148 × 91 × 27 mm) |
| Mass | ~800 g |
| Energy Density | ~230 Wh/kg |

### Degradation Summary

| Mechanism | Root Cause | Key Driver | Effect |
|-----------|-----------|------------|--------|
| **SEI Growth** | Electrolyte decomposition on graphite | Temperature, time ($\sqrt{t}$) | Capacity fade, resistance increase |
| **Cycle Aging** | Particle cracking, active material loss | Ah-throughput, DOD, temperature | Capacity fade, resistance increase |
| **Li Plating** | Metallic Li on anode at low $T$ / high $C$-rate | Low temperature, fast charging, high SOC | Irreversible capacity loss, safety risk |
| **$R$ Growth** | SEI thickening + contact loss | Combined SEI + cycle effects | Power fade, increased heat generation |

---

## Dependencies

### Backend (`requirements.txt`)

| Package | Version |
|---------|---------|
| FastAPI | ≥ 0.104.0 |
| uvicorn\[standard\] | ≥ 0.24.0 |
| NumPy | ≥ 1.26.0 |
| SciPy | ≥ 1.11.0 |
| websockets | ≥ 12.0 |
| Pydantic | ≥ 2.5.0 |

### Frontend (`package.json`)

| Package | Version |
|---------|---------|
| React | ^18.2.0 |
| Three.js | ^0.160.0 |
| @react-three/fiber | ^8.15.0 |
| @react-three/drei | ^9.92.0 |
| Recharts | ^2.10.0 |
| Zustand | ^4.4.7 |
| TypeScript | ^5.3.3 |
| Vite | ^5.0.8 |
| Tailwind CSS | ^3.4.0 |
| Leva | ^0.9.35 |

---

## License

MIT License — Free for educational, research, and commercial use.
