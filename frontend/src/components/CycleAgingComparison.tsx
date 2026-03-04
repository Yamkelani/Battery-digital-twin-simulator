/**
 * Cycle Aging Comparison Panel
 *
 * Runs client-side projections for side-by-side comparison of
 * how different chemistries / conditions / C-rates age over time.
 *
 * Features:
 *   - Select up to 4 scenarios (chemistry + temp + C-rate)
 *   - Projected SOH curves over 0-3000 cycles
 *   - SEI / Cycle / Plating contribution stacked area
 *   - End-of-life crossover markers
 *   - Summary comparison table
 */

import { useState, useMemo, useCallback } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend,
  AreaChart, Area,
} from 'recharts';
import { Plus, Trash2, Play, FlaskConical, Zap } from 'lucide-react';

/* ── Chemistry presets (client-side degradation parameters) ─ */
interface ChemParam {
  name: string;
  k_sei: number;     // SEI growth rate
  k_cyc: number;     // Cycle aging rate
  k_plating: number; // Plating rate
  eol: number;       // EOL threshold (fraction)
  color: string;
}

const CHEM_PRESETS: Record<string, ChemParam> = {
  nmc622:  { name: 'NMC622',       k_sei: 2.0e-5, k_cyc: 8.0e-5, k_plating: 2.0e-6, eol: 0.70, color: '#3b82f6' },
  nmc811:  { name: 'NMC811',       k_sei: 2.8e-5, k_cyc: 1.2e-4, k_plating: 3.0e-6, eol: 0.70, color: '#8b5cf6' },
  lfp:     { name: 'LFP',          k_sei: 1.0e-5, k_cyc: 4.0e-5, k_plating: 1.0e-6, eol: 0.70, color: '#22c55e' },
  nca:     { name: 'NCA',          k_sei: 3.0e-5, k_cyc: 1.0e-4, k_plating: 2.5e-6, eol: 0.70, color: '#f97316' },
  lto:     { name: 'LTO',          k_sei: 0.5e-5, k_cyc: 2.0e-5, k_plating: 0.5e-6, eol: 0.70, color: '#06b6d4' },
  solid:   { name: 'Solid-State',  k_sei: 0.8e-5, k_cyc: 3.0e-5, k_plating: 0.3e-6, eol: 0.70, color: '#ec4899' },
};

interface Scenario {
  id: number;
  chemistry: string;
  tempC: number;
  cRate: number;
  dod: number;
}

/* ── Simple degradation projection (Arrhenius + sqrt/linear) ── */
function projectAging(chem: ChemParam, tempC: number, cRate: number, dod: number, maxCycles: number) {
  const R = 8.314;
  const Tref = 298.15;
  const T = tempC + 273.15;
  const arrh = Math.exp(-24000 / R * (1 / T - 1 / Tref));

  const points: { cycle: number; soh: number; sei: number; cyc: number; plating: number }[] = [];
  let seiLoss = 0;
  let cycLoss = 0;
  let platLoss = 0;

  for (let c = 0; c <= maxCycles; c += 10) {
    // SEI: sqrt(time/cycles), calendar-like
    seiLoss = chem.k_sei * arrh * Math.sqrt(c * 3600) * 100;
    // Cycle: proportional to Ah throughput scaled by DOD stress
    cycLoss = chem.k_cyc * arrh * Math.pow(c * dod * 50, 0.55) * 100;
    // Plating: cold + high C-rate
    const platFactor = tempC < 15 ? (15 - tempC) / 15 : 0;
    const crateFactor = cRate > 0.5 ? (cRate - 0.5) : 0;
    platLoss = chem.k_plating * platFactor * crateFactor * c * 100;

    const totalLoss = Math.min(seiLoss + cycLoss + platLoss, 100);
    const soh = Math.max(100 - totalLoss, 0);

    points.push({
      cycle: c,
      soh: +soh.toFixed(2),
      sei: +seiLoss.toFixed(3),
      cyc: +cycLoss.toFixed(3),
      plating: +platLoss.toFixed(3),
    });

    if (soh <= chem.eol * 100) break;
  }
  return points;
}

let nextId = 1;

export default function CycleAgingComparison() {
  const [scenarios, setScenarios] = useState<Scenario[]>([
    { id: nextId++, chemistry: 'nmc622', tempC: 25, cRate: 1.0, dod: 0.8 },
    { id: nextId++, chemistry: 'lfp', tempC: 25, cRate: 1.0, dod: 0.8 },
  ]);
  const [maxCycles, setMaxCycles] = useState(3000);

  const addScenario = useCallback(() => {
    if (scenarios.length >= 6) return;
    setScenarios((s) => [...s, { id: nextId++, chemistry: 'nmc622', tempC: 25, cRate: 1.0, dod: 0.8 }]);
  }, [scenarios.length]);

  const removeScenario = useCallback((id: number) => {
    setScenarios((s) => s.filter((sc) => sc.id !== id));
  }, []);

  const updateScenario = useCallback((id: number, field: keyof Scenario, value: any) => {
    setScenarios((s) => s.map((sc) => sc.id === id ? { ...sc, [field]: value } : sc));
  }, []);

  // Compute projections
  const projections = useMemo(() => {
    return scenarios.map((sc) => {
      const chem = CHEM_PRESETS[sc.chemistry] ?? CHEM_PRESETS.nmc622;
      return {
        scenario: sc,
        chem,
        data: projectAging(chem, sc.tempC, sc.cRate, sc.dod, maxCycles),
      };
    });
  }, [scenarios, maxCycles]);

  // Merge all projections into one chart dataset
  const merged = useMemo(() => {
    const map = new Map<number, any>();
    projections.forEach((proj, idx) => {
      proj.data.forEach((pt) => {
        const row = map.get(pt.cycle) ?? { cycle: pt.cycle };
        row[`soh_${idx}`] = pt.soh;
        row[`sei_${idx}`] = pt.sei;
        row[`cyc_${idx}`] = pt.cyc;
        row[`plat_${idx}`] = pt.plating;
        map.set(pt.cycle, row);
      });
    });
    return Array.from(map.values()).sort((a, b) => a.cycle - b.cycle);
  }, [projections]);

  // EOL cycles per scenario
  const eolCycles = useMemo(() => {
    return projections.map((p) => {
      const eolPt = p.data.find((d) => d.soh <= p.chem.eol * 100);
      return eolPt ? eolPt.cycle : null;
    });
  }, [projections]);

  return (
    <div className="h-full flex flex-col gap-4 p-4 overflow-y-auto text-white">
      {/* ── Scenario config row ─────────────────────────── */}
      <div className="flex flex-wrap gap-3 items-start">
        {scenarios.map((sc, idx) => {
          const chem = CHEM_PRESETS[sc.chemistry] ?? CHEM_PRESETS.nmc622;
          return (
            <div key={sc.id} className="bg-white/[0.04] border border-white/[0.08] rounded-xl p-3 min-w-[200px] space-y-2"
                 style={{ borderLeftColor: chem.color, borderLeftWidth: 3 }}>
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold" style={{ color: chem.color }}>
                  Scenario {idx + 1}
                </span>
                {scenarios.length > 1 && (
                  <button onClick={() => removeScenario(sc.id)} className="text-panel-muted hover:text-red-400 transition-colors">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <select
                value={sc.chemistry}
                onChange={(e) => updateScenario(sc.id, 'chemistry', e.target.value)}
                className="w-full bg-white/[0.06] border border-white/[0.08] rounded px-2 py-1 text-xs text-white"
              >
                {Object.entries(CHEM_PRESETS).map(([k, v]) => (
                  <option key={k} value={k}>{v.name}</option>
                ))}
              </select>
              <div className="grid grid-cols-3 gap-1">
                <label className="text-[10px] text-panel-muted">
                  Temp °C
                  <input type="number" value={sc.tempC} onChange={(e) => updateScenario(sc.id, 'tempC', +e.target.value)}
                    className="w-full bg-white/[0.06] border border-white/[0.08] rounded px-1.5 py-0.5 text-xs text-white mt-0.5" />
                </label>
                <label className="text-[10px] text-panel-muted">
                  C-rate
                  <input type="number" step={0.1} value={sc.cRate} onChange={(e) => updateScenario(sc.id, 'cRate', +e.target.value)}
                    className="w-full bg-white/[0.06] border border-white/[0.08] rounded px-1.5 py-0.5 text-xs text-white mt-0.5" />
                </label>
                <label className="text-[10px] text-panel-muted">
                  DOD
                  <input type="number" step={0.1} min={0.1} max={1} value={sc.dod} onChange={(e) => updateScenario(sc.id, 'dod', +e.target.value)}
                    className="w-full bg-white/[0.06] border border-white/[0.08] rounded px-1.5 py-0.5 text-xs text-white mt-0.5" />
                </label>
              </div>
              {eolCycles[idx] != null && (
                <div className="text-[10px] text-panel-muted">
                  EOL @ <span className="text-white font-semibold">{eolCycles[idx]}</span> cycles
                </div>
              )}
            </div>
          );
        })}
        {scenarios.length < 6 && (
          <button onClick={addScenario}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-dashed border-white/[0.15]
                       text-panel-muted hover:text-white hover:border-white/[0.3] transition-colors text-xs">
            <Plus className="w-4 h-4" /> Add Scenario
          </button>
        )}
      </div>

      {/* ── Charts ──────────────────────────────────────── */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4 min-h-0">
        {/* SOH comparison */}
        <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 min-h-[280px]">
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <FlaskConical className="w-4 h-4 text-blue-400" />
            SOH Projection
          </h3>
          <ResponsiveContainer width="100%" height="85%">
            <LineChart data={merged}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="cycle" tick={{ fill: '#94a3b8', fontSize: 10 }} label={{ value: 'Cycles', position: 'insideBottom', offset: -4, fill: '#94a3b8', fontSize: 10 }} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} domain={[60, 100]} unit="%" />
              <Tooltip contentStyle={{ background: '#0f1729ee', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="4 4" label={{ value: 'EOL 70%', fill: '#ef4444', fontSize: 10 }} />
              {projections.map((p, i) => (
                <Line key={i} type="monotone" dataKey={`soh_${i}`} name={`${p.chem.name} ${p.scenario.tempC}°C ${p.scenario.cRate}C`}
                  stroke={p.chem.color} dot={false} strokeWidth={2} />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Degradation breakdown (first scenario) */}
        <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 min-h-[280px]">
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
            <Zap className="w-4 h-4 text-amber-400" />
            Degradation Breakdown (Scenario 1)
          </h3>
          {projections.length > 0 && (
            <ResponsiveContainer width="100%" height="85%">
              <AreaChart data={projections[0].data}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="cycle" tick={{ fill: '#94a3b8', fontSize: 10 }} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} unit="%" />
                <Tooltip contentStyle={{ background: '#0f1729ee', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Area type="monotone" dataKey="sei" stackId="1" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.6} name="SEI" />
                <Area type="monotone" dataKey="cyc" stackId="1" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.6} name="Cycle" />
                <Area type="monotone" dataKey="plating" stackId="1" stroke="#94a3b8" fill="#94a3b8" fillOpacity={0.6} name="Plating" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* ── Summary table ───────────────────────────────── */}
      <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4">
        <h3 className="text-sm font-semibold mb-2">Comparison Summary</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-panel-muted border-b border-white/[0.06]">
                <th className="text-left py-1.5 px-2">#</th>
                <th className="text-left py-1.5 px-2">Chemistry</th>
                <th className="text-right py-1.5 px-2">Temp</th>
                <th className="text-right py-1.5 px-2">C-rate</th>
                <th className="text-right py-1.5 px-2">DOD</th>
                <th className="text-right py-1.5 px-2">EOL Cycles</th>
                <th className="text-right py-1.5 px-2">SOH @500</th>
                <th className="text-right py-1.5 px-2">SOH @1000</th>
              </tr>
            </thead>
            <tbody>
              {projections.map((p, i) => {
                const at500 = p.data.find((d) => d.cycle >= 500);
                const at1000 = p.data.find((d) => d.cycle >= 1000);
                return (
                  <tr key={i} className="border-b border-white/[0.04] hover:bg-white/[0.03]">
                    <td className="py-1.5 px-2">
                      <div className="w-3 h-3 rounded-full" style={{ background: p.chem.color }} />
                    </td>
                    <td className="py-1.5 px-2 font-medium">{p.chem.name}</td>
                    <td className="py-1.5 px-2 text-right">{p.scenario.tempC}°C</td>
                    <td className="py-1.5 px-2 text-right">{p.scenario.cRate}C</td>
                    <td className="py-1.5 px-2 text-right">{(p.scenario.dod * 100).toFixed(0)}%</td>
                    <td className="py-1.5 px-2 text-right font-semibold" style={{ color: p.chem.color }}>
                      {eolCycles[i] ?? '> ' + maxCycles}
                    </td>
                    <td className="py-1.5 px-2 text-right">{at500?.soh.toFixed(1) ?? '—'}%</td>
                    <td className="py-1.5 px-2 text-right">{at1000?.soh.toFixed(1) ?? '—'}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
