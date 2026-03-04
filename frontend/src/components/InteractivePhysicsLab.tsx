/**
 * Interactive Physics Lab — Real-time Battery Physics Explorer
 *
 * Provides instant visual feedback as users drag sliders to change
 * temperature, C-rate, SOC, and DOD. Each slider immediately updates
 * animated physics diagrams showing:
 *   - OCV curve with operating point marker
 *   - Internal resistance vs temperature
 *   - Polarization (overpotential) breakdown
 *   - Diffusion-limited current
 *   - SEI growth rate
 *   - Lithium plating risk
 *
 * Educational tooltips explain the physics behind each curve.
 */

import { useState, useMemo, useRef, useEffect } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceDot, Area, AreaChart,
  Legend, ComposedChart, Bar,
} from 'recharts';
import { motion, AnimatePresence } from 'framer-motion';
import { Atom, Lightbulb, ChevronDown, ChevronUp, Info, Thermometer, Zap, Battery } from 'lucide-react';

/* ── Physics Models (client-side, instant feedback) ──────── */

function computeOCV(soc: number): number {
  // 6th-order polynomial fit for NMC cell OCV
  const x = Math.max(0, Math.min(1, soc));
  return (
    3.0 +
    1.2 * x -
    0.8 * x * x +
    0.6 * x * x * x -
    0.15 * Math.exp(-20 * x) +
    0.05 * Math.exp(10 * (x - 1))
  );
}

function computeResistance(tempC: number, soc: number): number {
  // Arrhenius-based internal resistance
  const T = tempC + 273.15;
  const Tref = 298.15;
  const Ea = 20000;
  const R_gas = 8.314;
  const R0 = 0.02; // base resistance at 25°C
  const socFactor = 1 + 0.3 * Math.exp(-10 * soc) + 0.2 * Math.exp(10 * (soc - 1));
  return R0 * Math.exp((Ea / R_gas) * (1 / T - 1 / Tref)) * socFactor;
}

function computePolarization(current: number, tempC: number, soc: number) {
  const R_int = computeResistance(tempC, soc);
  const ohmic = current * R_int;
  const T = tempC + 273.15;
  const i0 = 2.0 * Math.exp(-30000 / 8.314 * (1 / T - 1 / 298.15)); // exchange current density
  const activation = (8.314 * T / (0.5 * 96485)) * Math.asinh(current / (2 * i0));
  const D_eff = 1e-10 * Math.exp(-25000 / 8.314 * (1 / T - 1 / 298.15));
  const concentration = 0.01 * current / Math.max(D_eff * 1e6, 0.001);
  return { ohmic: Math.abs(ohmic), activation: Math.abs(activation), concentration: Math.abs(concentration), total: Math.abs(ohmic) + Math.abs(activation) + Math.abs(concentration) };
}

function computeSEIGrowthRate(tempC: number, soc: number): number {
  const T = tempC + 273.15;
  const k_sei = 2e-5 * Math.exp(30000 / 8.314 * (1 / 298.15 - 1 / T));
  const socMultiplier = soc > 0.8 ? 1 + (soc - 0.8) * 5 : 1;
  return k_sei * socMultiplier * 1e6; // scaled for display
}

function computePlatingRisk(tempC: number, cRate: number, soc: number): number {
  // Risk factor 0-100%
  let risk = 0;
  if (tempC < 15) risk += (15 - tempC) * 3;
  if (cRate > 1) risk += (cRate - 1) * 20;
  if (soc > 0.8) risk += (soc - 0.8) * 100;
  return Math.min(100, Math.max(0, risk));
}

function computeHeatGeneration(current: number, tempC: number, soc: number): { joule: number; entropic: number; total: number } {
  const R = computeResistance(tempC, soc);
  const joule = current * current * R;
  const entropic = Math.abs(current) * 0.002 * (tempC + 273.15); // simplified dOCV/dT
  return { joule, entropic, total: joule + entropic };
}

/* ── Info Tooltip ─────────────────────────────────────────── */
function PhysicsTooltip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-block ml-1.5">
      <button
        onClick={() => setOpen(!open)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="text-blue-400/60 hover:text-blue-400 transition-colors"
      >
        <Info className="w-3.5 h-3.5" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.95 }}
            className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-64 p-3 rounded-xl
                       bg-[#0f1729]/95 border border-blue-500/20 shadow-xl text-xs text-slate-300 leading-relaxed"
            style={{ backdropFilter: 'blur(12px)' }}
          >
            <div className="flex items-start gap-2">
              <Lightbulb className="w-4 h-4 text-yellow-400 shrink-0 mt-0.5" />
              <span>{text}</span>
            </div>
            <div className="absolute left-1/2 -translate-x-1/2 -bottom-1 w-2 h-2 rotate-45 bg-[#0f1729] border-r border-b border-blue-500/20" />
          </motion.div>
        )}
      </AnimatePresence>
    </span>
  );
}

/* ── Animated Gauge ──────────────────────────────────────── */
function RiskGauge({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div className="flex flex-col items-center">
      <svg width="80" height="50" viewBox="0 0 80 50">
        {/* Background arc */}
        <path d="M10 45 A 30 30 0 0 1 70 45" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" strokeLinecap="round" />
        {/* Value arc */}
        <motion.path
          d="M10 45 A 30 30 0 0 1 70 45"
          fill="none"
          stroke={color}
          strokeWidth="6"
          strokeLinecap="round"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: value / 100 }}
          transition={{ type: 'spring', stiffness: 60 }}
          style={{ filter: `drop-shadow(0 0 4px ${color}50)` }}
        />
        <text x="40" y="42" textAnchor="middle" fill="white" fontSize="13" fontWeight="bold">
          {value.toFixed(0)}%
        </text>
      </svg>
      <span className="text-[10px] text-panel-muted mt-0.5">{label}</span>
    </div>
  );
}

/* ── Interactive Slider ──────────────────────────────────── */
function PhysicsSlider({
  label, value, min, max, step, unit, color, onChange, tooltip,
}: {
  label: string; value: number; min: number; max: number; step: number;
  unit: string; color: string; onChange: (v: number) => void; tooltip: string;
}) {
  return (
    <div className="bg-white/[0.03] rounded-xl p-3 border border-white/[0.06]">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center">
          <span className="text-xs font-medium text-slate-300">{label}</span>
          <PhysicsTooltip text={tooltip} />
        </div>
        <motion.span
          className="text-sm font-bold"
          style={{ color }}
          key={value}
          initial={{ scale: 1.15 }}
          animate={{ scale: 1 }}
          transition={{ duration: 0.15 }}
        >
          {value.toFixed(step < 1 ? 1 : 0)}{unit}
        </motion.span>
      </div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(+e.target.value)}
        className="w-full h-2 rounded-full appearance-none cursor-pointer"
        style={{
          background: `linear-gradient(to right, ${color} ${((value - min) / (max - min)) * 100}%, rgba(255,255,255,0.08) ${((value - min) / (max - min)) * 100}%)`,
        }}
      />
      <div className="flex justify-between text-[9px] text-panel-muted mt-0.5">
        <span>{min}{unit}</span>
        <span>{max}{unit}</span>
      </div>
    </div>
  );
}

/* ── Main Component ─────────────────────────────────────── */
export default function InteractivePhysicsLab() {
  const [temperature, setTemperature] = useState(25);
  const [cRate, setCRate] = useState(1.0);
  const [soc, setSOC] = useState(0.5);
  const [expandedSection, setExpandedSection] = useState<string | null>('ocv');

  const current = cRate * 50; // 50Ah cell

  // OCV curve data
  const ocvCurve = useMemo(() =>
    Array.from({ length: 101 }, (_, i) => {
      const s = i / 100;
      return { soc: s * 100, ocv: computeOCV(s) };
    })
  , []);

  // Resistance vs temperature
  const resTempCurve = useMemo(() =>
    Array.from({ length: 70 }, (_, i) => {
      const t = -10 + i;
      return { temp: t, resistance: computeResistance(t, soc) * 1000 }; // mΩ
    })
  , [soc]);

  // Polarization breakdown at current operating point
  const polarization = useMemo(
    () => computePolarization(current, temperature, soc),
    [current, temperature, soc],
  );

  // Polarization vs C-rate
  const polVsCRate = useMemo(() =>
    Array.from({ length: 51 }, (_, i) => {
      const cr = i * 0.1;
      const I = cr * 50;
      const p = computePolarization(I, temperature, soc);
      return { cRate: cr, ohmic: +p.ohmic.toFixed(4), activation: +p.activation.toFixed(4), concentration: +p.concentration.toFixed(4) };
    })
  , [temperature, soc]);

  // SEI growth rate vs temperature
  const seiVsTemp = useMemo(() =>
    Array.from({ length: 70 }, (_, i) => {
      const t = -10 + i;
      return { temp: t, seiRate: computeSEIGrowthRate(t, soc) };
    })
  , [soc]);

  // Heat generation
  const heat = useMemo(
    () => computeHeatGeneration(current, temperature, soc),
    [current, temperature, soc],
  );

  // Plating risk
  const platingRisk = useMemo(
    () => computePlatingRisk(temperature, cRate, soc),
    [temperature, cRate, soc],
  );

  // Current operating point
  const opVoltage = computeOCV(soc) - polarization.total * Math.sign(current);
  const opResistance = computeResistance(temperature, soc) * 1000;

  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  return (
    <div className="h-full flex flex-col gap-4 p-4 overflow-y-auto text-white">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/20">
          <Atom className="w-6 h-6 text-cyan-400" />
        </div>
        <div>
          <h2 className="text-lg font-bold">Interactive Physics Lab</h2>
          <p className="text-xs text-panel-muted">Drag sliders to explore battery electrochemistry in real-time</p>
        </div>
      </div>

      {/* ── Control Sliders ─────────────────────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <PhysicsSlider
          label="Temperature" value={temperature} min={-10} max={60} step={1} unit="°C" color="#ef4444"
          onChange={setTemperature}
          tooltip="Temperature affects reaction kinetics (Arrhenius law), ionic diffusion, SEI growth, and lithium plating risk. Higher temps accelerate degradation; lower temps increase resistance and plating."
        />
        <PhysicsSlider
          label="C-Rate" value={cRate} min={0.1} max={5} step={0.1} unit="C" color="#f59e0b"
          onChange={setCRate}
          tooltip="C-rate is the discharge/charge rate relative to capacity. 1C = full discharge in 1 hour. Higher C-rates cause more heat, larger overpotentials, and accelerated degradation."
        />
        <PhysicsSlider
          label="State of Charge" value={soc} min={0} max={1} step={0.01} unit="" color="#22c55e"
          onChange={setSOC}
          tooltip="SOC is the fraction of charge remaining. OCV varies nonlinearly with SOC. At extremes (very low or high SOC), resistance increases and side reactions accelerate."
        />
      </div>

      {/* ── Live KPIs ────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        {[
          { label: 'Open Circuit V', value: computeOCV(soc).toFixed(3), unit: 'V', color: '#3b82f6' },
          { label: 'Terminal V', value: opVoltage.toFixed(3), unit: 'V', color: '#60a5fa' },
          { label: 'Overpotential', value: (polarization.total * 1000).toFixed(1), unit: 'mV', color: '#f97316' },
          { label: 'Resistance', value: opResistance.toFixed(1), unit: 'mΩ', color: '#ef4444' },
          { label: 'Heat Gen', value: heat.total.toFixed(1), unit: 'W', color: '#eab308' },
          { label: 'Plating Risk', value: platingRisk.toFixed(0), unit: '%', color: platingRisk > 50 ? '#ef4444' : platingRisk > 20 ? '#f59e0b' : '#22c55e' },
        ].map((kpi) => (
          <motion.div
            key={kpi.label}
            className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-3 text-center"
            animate={{ borderColor: `${kpi.color}15` }}
          >
            <div className="text-[9px] text-panel-muted uppercase tracking-wider">{kpi.label}</div>
            <motion.div
              className="text-lg font-bold mt-0.5"
              style={{ color: kpi.color }}
              key={kpi.value}
              initial={{ scale: 1.1 }}
              animate={{ scale: 1 }}
            >
              {kpi.value}
              <span className="text-xs font-normal text-panel-muted ml-0.5">{kpi.unit}</span>
            </motion.div>
          </motion.div>
        ))}
      </div>

      {/* ── Expandable Chart Sections ────────────────── */}
      {[
        {
          id: 'ocv', title: 'Open Circuit Voltage vs SOC', icon: Battery, color: '#3b82f6',
          tooltip: 'The OCV-SOC relationship is the thermodynamic foundation of the cell. The curve shape reflects the crystal structure of the electrode materials and phase transitions during lithiation/delithiation.',
          chart: (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={ocvCurve}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="soc" tick={{ fill: '#94a3b8', fontSize: 9 }} unit="%" label={{ value: 'SOC (%)', fill: '#94a3b8', fontSize: 10, position: 'insideBottom', offset: -2 }} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 9 }} unit="V" domain={['auto', 'auto']} />
                <Tooltip contentStyle={{ background: '#0f1729ee', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }} />
                <Line type="monotone" dataKey="ocv" stroke="#3b82f6" dot={false} strokeWidth={2} name="OCV" />
                <ReferenceDot x={soc * 100} y={computeOCV(soc)} r={6} fill="#ef4444" stroke="#fff" strokeWidth={2} />
                <ReferenceLine x={soc * 100} stroke="#ef4444" strokeDasharray="4 4" strokeOpacity={0.4} />
              </LineChart>
            </ResponsiveContainer>
          ),
        },
        {
          id: 'resistance', title: 'Internal Resistance vs Temperature', icon: Thermometer, color: '#ef4444',
          tooltip: 'Internal resistance follows the Arrhenius equation: R = R₀·exp(Eₐ/R·(1/T - 1/T_ref)). Low temperatures dramatically increase resistance, reducing available power and causing voltage sag.',
          chart: (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={resTempCurve}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="temp" tick={{ fill: '#94a3b8', fontSize: 9 }} unit="°C" />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 9 }} unit="mΩ" />
                <Tooltip contentStyle={{ background: '#0f1729ee', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }} />
                <Line type="monotone" dataKey="resistance" stroke="#ef4444" dot={false} strokeWidth={2} name="R_int" />
                <ReferenceDot x={temperature} y={opResistance} r={6} fill="#3b82f6" stroke="#fff" strokeWidth={2} />
                <ReferenceLine x={temperature} stroke="#3b82f6" strokeDasharray="4 4" strokeOpacity={0.4} />
              </LineChart>
            </ResponsiveContainer>
          ),
        },
        {
          id: 'polarization', title: 'Polarization Breakdown vs C-Rate', icon: Zap, color: '#f59e0b',
          tooltip: 'Overpotential has 3 components: Ohmic (IR drop) — proportional to current; Activation — charge-transfer kinetics at electrode surfaces (Butler-Volmer); Concentration — mass-transport limitations at high rates.',
          chart: (
            <ResponsiveContainer width="100%" height={220}>
              <AreaChart data={polVsCRate}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="cRate" tick={{ fill: '#94a3b8', fontSize: 9 }} unit="C" />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 9 }} unit="V" />
                <Tooltip contentStyle={{ background: '#0f1729ee', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Area type="monotone" dataKey="ohmic" stackId="1" fill="#3b82f6" fillOpacity={0.3} stroke="#3b82f6" name="Ohmic" />
                <Area type="monotone" dataKey="activation" stackId="1" fill="#f59e0b" fillOpacity={0.3} stroke="#f59e0b" name="Activation" />
                <Area type="monotone" dataKey="concentration" stackId="1" fill="#ef4444" fillOpacity={0.3} stroke="#ef4444" name="Concentration" />
                <ReferenceLine x={cRate} stroke="white" strokeDasharray="4 4" strokeOpacity={0.5} />
              </AreaChart>
            </ResponsiveContainer>
          ),
        },
        {
          id: 'degradation', title: 'SEI Growth & Plating Risk', icon: Atom, color: '#8b5cf6',
          tooltip: 'SEI (Solid Electrolyte Interphase) grows ∝ √t via solvent reduction at the anode. Growth accelerates with temperature (Arrhenius). Lithium plating occurs when anode potential drops below 0V — triggered by cold temps, high SOC, and fast charging.',
          chart: (
            <div className="grid grid-cols-2 gap-4">
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={seiVsTemp}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                  <XAxis dataKey="temp" tick={{ fill: '#94a3b8', fontSize: 9 }} unit="°C" />
                  <YAxis tick={{ fill: '#94a3b8', fontSize: 9 }} />
                  <Tooltip contentStyle={{ background: '#0f1729ee', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }} />
                  <Line type="monotone" dataKey="seiRate" stroke="#8b5cf6" dot={false} strokeWidth={2} name="SEI Rate" />
                  <ReferenceDot x={temperature} y={computeSEIGrowthRate(temperature, soc)} r={6} fill="#ef4444" stroke="#fff" strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
              <div className="flex flex-col items-center justify-center gap-4">
                <RiskGauge value={platingRisk} label="Li Plating Risk" color={platingRisk > 50 ? '#ef4444' : platingRisk > 20 ? '#f59e0b' : '#22c55e'} />
                <RiskGauge
                  value={Math.min(100, heat.total / 5 * 100)}
                  label="Thermal Load"
                  color={heat.total > 3 ? '#ef4444' : heat.total > 1 ? '#f59e0b' : '#22c55e'}
                />
              </div>
            </div>
          ),
        },
      ].map((section) => {
        const Icon = section.icon;
        const isOpen = expandedSection === section.id;
        return (
          <motion.div
            key={section.id}
            className="bg-white/[0.03] border border-white/[0.06] rounded-xl overflow-hidden"
            layout
          >
            <button
              onClick={() => toggleSection(section.id)}
              className="w-full flex items-center justify-between p-4 hover:bg-white/[0.02] transition-colors"
            >
              <div className="flex items-center gap-2.5">
                <Icon className="w-4 h-4" style={{ color: section.color }} />
                <span className="text-sm font-semibold">{section.title}</span>
                <PhysicsTooltip text={section.tooltip} />
              </div>
              {isOpen ? <ChevronUp className="w-4 h-4 text-panel-muted" /> : <ChevronDown className="w-4 h-4 text-panel-muted" />}
            </button>
            <AnimatePresence>
              {isOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25 }}
                  className="px-4 pb-4"
                >
                  {section.chart}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        );
      })}
    </div>
  );
}
