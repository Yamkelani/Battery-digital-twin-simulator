/**
 * Parameter Sensitivity Sweep Panel
 *
 * Automated sweeps across temperature, C-rate, and DOD ranges
 * to visualize degradation sensitivity curves, capacity retention,
 * and lifetime predictions.
 */

import { useState, useMemo, useCallback } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, AreaChart, Area, RadarChart,
  PolarGrid, PolarAngleAxis, PolarRadiusAxis, Radar,
} from 'recharts';
import { SlidersHorizontal, Play, RotateCcw } from 'lucide-react';

/* ── Degradation model (simplified Arrhenius + power-law) ── */
interface SweepParams {
  label: string;
  temp: number;      // °C
  cRate: number;     // C
  dod: number;       // 0-1
  color: string;
}

const PARAM_COLORS = [
  '#3b82f6', '#ef4444', '#22c55e', '#f59e0b', '#8b5cf6',
  '#ec4899', '#06b6d4', '#f97316', '#14b8a6', '#6366f1',
];

function projectSOH(temp: number, cRate: number, dod: number, cycles: number): number {
  const Ea = 30000; // activation energy J/mol
  const R = 8.314;
  const Tref = 298.15;
  const T = temp + 273.15;
  const tempFactor = Math.exp((Ea / R) * (1 / Tref - 1 / T));

  const k_sei = 2e-5 * tempFactor;
  const k_cyc = 8e-5 * Math.pow(cRate, 0.6) * dod;
  const k_plating = (temp < 15 ? 1.5e-4 * (15 - temp) / 15 : 0) * cRate;

  const seiLoss = k_sei * Math.sqrt(cycles);
  const cycLoss = k_cyc * Math.pow(cycles, 0.8);
  const platLoss = k_plating * cycles * 0.5;

  return Math.max(0, 1 - seiLoss - cycLoss - platLoss);
}

/* ── Sweep type configs ─────────────────────────────────── */
type SweepType = 'temperature' | 'c_rate' | 'dod';

interface SweepConfig {
  type: SweepType;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
  defaultFixed: { temp: number; cRate: number; dod: number };
}

const SWEEP_CONFIGS: Record<SweepType, SweepConfig> = {
  temperature: {
    type: 'temperature', label: 'Temperature Sweep', unit: '°C',
    min: -10, max: 60, step: 5,
    defaultFixed: { temp: 25, cRate: 1, dod: 0.8 },
  },
  c_rate: {
    type: 'c_rate', label: 'C-Rate Sweep', unit: 'C',
    min: 0.2, max: 5, step: 0.4,
    defaultFixed: { temp: 25, cRate: 1, dod: 0.8 },
  },
  dod: {
    type: 'dod', label: 'Depth of Discharge Sweep', unit: '%',
    min: 10, max: 100, step: 10,
    defaultFixed: { temp: 25, cRate: 1, dod: 0.8 },
  },
};

/* ── Main Component ─────────────────────────────────────── */
export default function ParameterSweepPanel() {
  const [sweepType, setSweepType] = useState<SweepType>('temperature');
  const [maxCycles, setMaxCycles] = useState(2000);
  const [fixedTemp, setFixedTemp] = useState(25);
  const [fixedCRate, setFixedCRate] = useState(1);
  const [fixedDod, setFixedDod] = useState(0.8);

  const cfg = SWEEP_CONFIGS[sweepType];

  // Generate sweep values
  const sweepValues = useMemo(() => {
    const vals: number[] = [];
    for (let v = cfg.min; v <= cfg.max + 0.001; v += cfg.step) {
      vals.push(+v.toFixed(2));
    }
    return vals;
  }, [cfg]);

  // Build sweep result data
  const sweepData = useMemo(() => {
    // For each cycle count, compute SOH for each sweep value
    const cycleSteps = 100;
    const dcyc = maxCycles / cycleSteps;
    const results: Record<string, number | string>[] = [];

    for (let i = 0; i <= cycleSteps; i++) {
      const cyc = Math.round(i * dcyc);
      const row: Record<string, number | string> = { cycle: cyc };

      for (const sv of sweepValues) {
        let t = fixedTemp, cr = fixedCRate, d = fixedDod;
        let key = '';
        if (sweepType === 'temperature') { t = sv; key = `${sv}°C`; }
        else if (sweepType === 'c_rate') { cr = sv; key = `${sv}C`; }
        else { d = sv / 100; key = `${sv}%`; }

        row[key] = +(projectSOH(t, cr, d, cyc) * 100).toFixed(2);
      }
      results.push(row);
    }
    return results;
  }, [sweepType, sweepValues, fixedTemp, fixedCRate, fixedDod, maxCycles]);

  // Lifetime summary (cycles to 80% SOH)
  const lifetimeSummary = useMemo(() => {
    return sweepValues.map((sv) => {
      let t = fixedTemp, cr = fixedCRate, d = fixedDod;
      let label = '';
      if (sweepType === 'temperature') { t = sv; label = `${sv}°C`; }
      else if (sweepType === 'c_rate') { cr = sv; label = `${sv}C`; }
      else { d = sv / 100; label = `${sv}%`; }

      // Binary search for EOL (80%)
      let lo = 0, hi = 10000;
      while (hi - lo > 1) {
        const mid = (lo + hi) >> 1;
        projectSOH(t, cr, d, mid) >= 0.8 ? (lo = mid) : (hi = mid);
      }
      const eolCycles = lo;
      const soh500 = +(projectSOH(t, cr, d, 500) * 100).toFixed(1);
      const soh1000 = +(projectSOH(t, cr, d, 1000) * 100).toFixed(1);

      return { label, value: sv, eolCycles, soh500, soh1000
      };
    });
  }, [sweepType, sweepValues, fixedTemp, fixedCRate, fixedDod]);

  // Radar chart data for multi-factor sensitivity at 1000 cycles
  const radarData = useMemo(() => {
    const base = projectSOH(fixedTemp, fixedCRate, fixedDod, 1000) * 100;
    const pts = [
      { factor: 'Low Temp (0°C)', soh: +(projectSOH(0, fixedCRate, fixedDod, 1000) * 100).toFixed(1) },
      { factor: 'High Temp (45°C)', soh: +(projectSOH(45, fixedCRate, fixedDod, 1000) * 100).toFixed(1) },
      { factor: 'High C-Rate (3C)', soh: +(projectSOH(fixedTemp, 3, fixedDod, 1000) * 100).toFixed(1) },
      { factor: 'Low C-Rate (0.5C)', soh: +(projectSOH(fixedTemp, 0.5, fixedDod, 1000) * 100).toFixed(1) },
      { factor: 'Deep DOD (100%)', soh: +(projectSOH(fixedTemp, fixedCRate, 1.0, 1000) * 100).toFixed(1) },
      { factor: 'Shallow DOD (30%)', soh: +(projectSOH(fixedTemp, fixedCRate, 0.3, 1000) * 100).toFixed(1) },
    ];
    return pts;
  }, [fixedTemp, fixedCRate, fixedDod]);

  const sweepKeys = useMemo(() => {
    return sweepValues.map((sv) => {
      if (sweepType === 'temperature') return `${sv}°C`;
      if (sweepType === 'c_rate') return `${sv}C`;
      return `${sv}%`;
    });
  }, [sweepType, sweepValues]);

  return (
    <div className="h-full flex flex-col gap-4 p-4 overflow-y-auto text-white">
      {/* ── Header ───────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-violet-500/10 border border-violet-500/20">
          <SlidersHorizontal className="w-6 h-6 text-violet-400" />
        </div>
        <div>
          <h2 className="text-lg font-bold">Parameter Sensitivity Sweep</h2>
          <p className="text-xs text-panel-muted">Explore how temperature, C-rate, and DOD affect battery lifetime</p>
        </div>
      </div>

      {/* ── Controls ─────────────────────────────────── */}
      <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4">
        <div className="flex flex-wrap items-end gap-4">
          {/* Sweep type selector */}
          <div>
            <label className="text-[10px] text-panel-muted block mb-1">Sweep Parameter</label>
            <div className="flex gap-1 bg-white/[0.04] rounded-lg p-0.5">
              {(Object.keys(SWEEP_CONFIGS) as SweepType[]).map((st) => (
                <button
                  key={st}
                  onClick={() => setSweepType(st)}
                  className={`px-3 py-1.5 text-xs rounded-md transition-colors capitalize
                    ${sweepType === st
                      ? 'bg-white/[0.1] text-white font-semibold'
                      : 'text-panel-muted hover:text-white'}`}
                >
                  {SWEEP_CONFIGS[st].label.replace(' Sweep', '')}
                </button>
              ))}
            </div>
          </div>

          {/* Fixed parameters */}
          {sweepType !== 'temperature' && (
            <div>
              <label className="text-[10px] text-panel-muted block mb-1">Temperature (°C)</label>
              <input type="number" value={fixedTemp} onChange={(e) => setFixedTemp(+e.target.value)}
                className="w-20 px-2 py-1 rounded-md bg-white/[0.06] border border-white/[0.1] text-xs text-white" />
            </div>
          )}
          {sweepType !== 'c_rate' && (
            <div>
              <label className="text-[10px] text-panel-muted block mb-1">C-Rate (C)</label>
              <input type="number" value={fixedCRate} step={0.1} onChange={(e) => setFixedCRate(+e.target.value)}
                className="w-20 px-2 py-1 rounded-md bg-white/[0.06] border border-white/[0.1] text-xs text-white" />
            </div>
          )}
          {sweepType !== 'dod' && (
            <div>
              <label className="text-[10px] text-panel-muted block mb-1">DOD (%)</label>
              <input type="number" value={+(fixedDod * 100).toFixed(0)} step={10}
                onChange={(e) => setFixedDod(Math.max(0.05, Math.min(1, +e.target.value / 100)))}
                className="w-20 px-2 py-1 rounded-md bg-white/[0.06] border border-white/[0.1] text-xs text-white" />
            </div>
          )}

          <div>
            <label className="text-[10px] text-panel-muted block mb-1">Max Cycles</label>
            <input type="number" value={maxCycles} step={500} min={500} max={10000}
              onChange={(e) => setMaxCycles(+e.target.value)}
              className="w-24 px-2 py-1 rounded-md bg-white/[0.06] border border-white/[0.1] text-xs text-white" />
          </div>
        </div>
      </div>

      {/* ── Sweep Chart ──────────────────────────────── */}
      <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 min-h-[300px]">
        <h4 className="text-xs font-semibold text-violet-400 mb-2">{cfg.label} — SOH vs Cycles</h4>
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={sweepData}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
            <XAxis dataKey="cycle" tick={{ fill: '#94a3b8', fontSize: 9 }} label={{ value: 'Cycles', fill: '#94a3b8', fontSize: 10, position: 'insideBottom', offset: -2 }} />
            <YAxis tick={{ fill: '#94a3b8', fontSize: 9 }} domain={[0, 100]} unit="%" />
            <Tooltip contentStyle={{ background: '#0f1729ee', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 10 }} />
            <Legend wrapperStyle={{ fontSize: 10 }} />
            {sweepKeys.map((key, i) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                stroke={PARAM_COLORS[i % PARAM_COLORS.length]}
                dot={false}
                strokeWidth={1.5}
                name={key}
              />
            ))}
            {/* EOL reference */}
            <Line type="monotone" dataKey={() => 80} stroke="rgba(255,255,255,0.15)" strokeDasharray="6 3" dot={false} name="EOL (80%)" />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* ── Bottom row ───────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Radar chart */}
        <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 min-h-[280px]">
          <h4 className="text-xs font-semibold text-cyan-400 mb-2">Multi-Factor Sensitivity @ 1000 Cycles</h4>
          <ResponsiveContainer width="100%" height={240}>
            <RadarChart data={radarData} outerRadius={80}>
              <PolarGrid stroke="rgba(255,255,255,0.1)" />
              <PolarAngleAxis dataKey="factor" tick={{ fill: '#94a3b8', fontSize: 8 }} />
              <PolarRadiusAxis tick={{ fill: '#94a3b8', fontSize: 8 }} domain={[0, 100]} />
              <Radar name="SOH %" dataKey="soh" stroke="#06b6d4" fill="#06b6d4" fillOpacity={0.15} strokeWidth={2} />
            </RadarChart>
          </ResponsiveContainer>
        </div>

        {/* Lifetime summary table */}
        <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 overflow-auto">
          <h4 className="text-xs font-semibold text-amber-400 mb-2">Lifetime Summary</h4>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-panel-muted border-b border-white/[0.08]">
                <th className="text-left py-1 pr-3">{cfg.label.replace(' Sweep', '')}</th>
                <th className="text-right py-1 pr-3">EOL Cycles</th>
                <th className="text-right py-1 pr-3">SOH @500</th>
                <th className="text-right py-1">SOH @1000</th>
              </tr>
            </thead>
            <tbody>
              {lifetimeSummary.map((row, i) => (
                <tr key={row.label} className="border-b border-white/[0.04] hover:bg-white/[0.02]">
                  <td className="py-1 pr-3 font-medium" style={{ color: PARAM_COLORS[i % PARAM_COLORS.length] }}>{row.label}</td>
                  <td className="text-right py-1 pr-3 font-mono">{row.eolCycles.toLocaleString()}</td>
                  <td className="text-right py-1 pr-3">{row.soh500}%</td>
                  <td className="text-right py-1">{row.soh1000}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
