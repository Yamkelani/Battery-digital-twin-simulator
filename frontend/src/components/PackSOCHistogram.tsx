/**
 * Pack SOC Histogram & Cell Balancing View
 *
 * Live histogram of all cell SOCs in the pack, plus
 * active / passive balancing visualization.
 */

import { useMemo, useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, ReferenceLine, LineChart, Line,
  Legend, ScatterChart, Scatter, ZAxis,
} from 'recharts';
import { BarChart3, Activity, Zap } from 'lucide-react';
import { useBatteryStore } from '../hooks/useBatteryState';

/* ── Helpers ────────────────────────────────────────────── */
function socColor(soc: number): string {
  if (soc > 80) return '#22c55e';
  if (soc > 60) return '#84cc16';
  if (soc > 40) return '#eab308';
  if (soc > 20) return '#f97316';
  return '#ef4444';
}

function buildHistogram(values: number[], bins = 20) {
  const min = 0, max = 100;
  const binWidth = (max - min) / bins;
  const hist = Array.from({ length: bins }, (_, i) => ({
    range: `${(min + i * binWidth).toFixed(0)}-${(min + (i + 1) * binWidth).toFixed(0)}`,
    center: min + (i + 0.5) * binWidth,
    count: 0,
  }));
  for (const v of values) {
    const idx = Math.min(Math.floor((v - min) / binWidth), bins - 1);
    if (idx >= 0 && idx < bins) hist[idx].count++;
  }
  return hist;
}

/* ── Balancing simulation (client-side) ─────────────────── */
interface BalancingSnapshot {
  step: number;
  min: number;
  max: number;
  spread: number;
  avg: number;
}

function simulateBalancing(
  initialSocs: number[],
  mode: 'passive' | 'active',
  steps = 50,
): { snapshots: BalancingSnapshot[]; finalSocs: number[] } {
  const socs = [...initialSocs];
  const snapshots: BalancingSnapshot[] = [];

  for (let s = 0; s <= steps; s++) {
    const min = Math.min(...socs);
    const max = Math.max(...socs);
    const avg = socs.reduce((a, b) => a + b, 0) / socs.length;
    snapshots.push({ step: s, min: +min.toFixed(2), max: +max.toFixed(2), spread: +(max - min).toFixed(2), avg: +avg.toFixed(2) });

    if (s === steps) break;

    if (mode === 'passive') {
      // Passive: bleed top cell(s) down to avg
      for (let i = 0; i < socs.length; i++) {
        if (socs[i] > avg + 0.5) socs[i] -= Math.min(0.3, socs[i] - avg);
      }
    } else {
      // Active: transfer from top to bottom
      const iMax = socs.indexOf(max);
      const iMin = socs.indexOf(min);
      if (iMax !== iMin) {
        const delta = Math.min(0.4, (socs[iMax] - socs[iMin]) / 2);
        socs[iMax] -= delta;
        socs[iMin] += delta;
      }
    }
  }
  return { snapshots, finalSocs: socs };
}

/* ── Main Component ─────────────────────────────────────── */
export default function PackSOCHistogram() {
  const packCellStates = useBatteryStore((s: any) => s.packCellStates);
  const batteryState = useBatteryStore((s: any) => s.batteryState);
  const [balancingMode, setBalancingMode] = useState<'passive' | 'active'>('active');

  // Extract live SOC values from pack or fallback
  const liveSocs = useMemo(() => {
    if (packCellStates && packCellStates.length > 0) {
      return packCellStates.map((c: any) => {
        const soc = typeof c.soc === 'number' ? c.soc : 50;
        return isNaN(soc) ? 50 : soc;
      });
    }
    // Generate synthetic spread around single-cell SOC
    const base = batteryState?.soc ?? 50;
    return Array.from({ length: 96 }, (_, i) => {
      const noise = (Math.sin(i * 1.7) * 4 + Math.cos(i * 0.8) * 2);
      return Math.max(0, Math.min(100, base + noise));
    });
  }, [packCellStates, batteryState?.soc]);

  const histogram = useMemo(() => buildHistogram(liveSocs, 20), [liveSocs]);

  const stats = useMemo(() => {
    const min = Math.min(...liveSocs);
    const max = Math.max(...liveSocs);
    const avg = liveSocs.reduce((a: number, b: number) => a + b, 0) / liveSocs.length;
    const std = Math.sqrt(liveSocs.reduce((a: number, b: number) => a + (b - avg) ** 2, 0) / liveSocs.length);
    return { min: +min.toFixed(2), max: +max.toFixed(2), avg: +avg.toFixed(2), spread: +(max - min).toFixed(2), std: +std.toFixed(3), n: liveSocs.length };
  }, [liveSocs]);

  // Cell SOC scatter for per-cell view
  const cellScatter = useMemo(() => liveSocs.map((soc: number, i: number) => ({ cell: i + 1, soc: +soc.toFixed(2), z: 1 })), [liveSocs]);

  // Balancing simulation
  const balResult = useMemo(() => simulateBalancing(liveSocs, balancingMode), [liveSocs, balancingMode]);

  return (
    <div className="h-full flex flex-col gap-4 p-4 overflow-y-auto text-white">
      {/* ── Header ───────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
          <BarChart3 className="w-6 h-6 text-emerald-400" />
        </div>
        <div>
          <h2 className="text-lg font-bold">Pack SOC Distribution & Cell Balancing</h2>
          <p className="text-xs text-panel-muted">{stats.n} cells &middot; Spread {stats.spread.toFixed(1)}% &middot; σ {stats.std.toFixed(2)}%</p>
        </div>
      </div>

      {/* ── KPIs ─────────────────────────────────────── */}
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
        {[
          { label: 'Avg SOC', value: `${stats.avg.toFixed(1)}%`, color: '#22c55e' },
          { label: 'Min SOC', value: `${stats.min.toFixed(1)}%`, color: '#ef4444' },
          { label: 'Max SOC', value: `${stats.max.toFixed(1)}%`, color: '#3b82f6' },
          { label: 'Spread', value: `${stats.spread.toFixed(1)}%`, color: '#eab308' },
          { label: 'Std Dev', value: `${stats.std.toFixed(2)}%`, color: '#8b5cf6' },
          { label: 'Cells', value: `${stats.n}`, color: '#64748b' },
        ].map((kpi) => (
          <div key={kpi.label} className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-3 text-center">
            <div className="text-[10px] text-panel-muted">{kpi.label}</div>
            <div className="text-base font-bold mt-0.5" style={{ color: kpi.color }}>{kpi.value}</div>
          </div>
        ))}
      </div>

      {/* ── Charts row 1 ─────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Histogram */}
        <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 min-h-[250px]">
          <h4 className="text-xs font-semibold text-emerald-400 mb-2">SOC Distribution Histogram</h4>
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={histogram} barCategoryGap={1}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="range" tick={{ fill: '#94a3b8', fontSize: 8 }} angle={-35} textAnchor="end" height={40} />
              <YAxis tick={{ fill: '#94a3b8', fontSize: 9 }} allowDecimals={false} />
              <Tooltip contentStyle={{ background: '#0f1729ee', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }} />
              <Bar dataKey="count" radius={[3, 3, 0, 0]}>
                {histogram.map((entry, i) => (
                  <Cell key={i} fill={socColor(entry.center)} fillOpacity={0.8} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Per-cell scatter */}
        <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 min-h-[250px]">
          <h4 className="text-xs font-semibold text-blue-400 mb-2">Per-Cell SOC</h4>
          <ResponsiveContainer width="100%" height={210}>
            <ScatterChart margin={{ top: 5, right: 10, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="cell" type="number" tick={{ fill: '#94a3b8', fontSize: 9 }} name="Cell #" />
              <YAxis dataKey="soc" type="number" tick={{ fill: '#94a3b8', fontSize: 9 }} domain={[0, 100]} name="SOC" unit="%" />
              <ZAxis dataKey="z" range={[30, 30]} />
              <Tooltip contentStyle={{ background: '#0f1729ee', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }} />
              <Scatter data={cellScatter} fill="#3b82f6">
                {cellScatter.map((entry: { cell: number; soc: number; z: number }, i: number) => (
                  <Cell key={i} fill={socColor(entry.soc)} />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Balancing section ────────────────────────── */}
      <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Activity className="w-4 h-4 text-yellow-400" />
            <h4 className="text-sm font-semibold">Cell Balancing Simulation</h4>
          </div>
          <div className="flex items-center gap-1 bg-white/[0.04] rounded-lg p-0.5">
            {(['passive', 'active'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setBalancingMode(m)}
                className={`px-3 py-1 text-xs rounded-md capitalize transition-colors
                  ${balancingMode === m
                    ? 'bg-white/[0.1] text-white font-semibold'
                    : 'text-panel-muted hover:text-white'}`}
              >
                {m === 'active' && <Zap className="w-3 h-3 inline mr-1" />}
                {m}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Spread convergence */}
          <div className="min-h-[200px]">
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={balResult.snapshots}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="step" tick={{ fill: '#94a3b8', fontSize: 9 }} label={{ value: 'Balancing Steps', fill: '#94a3b8', fontSize: 10, position: 'insideBottom', offset: -2 }} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 9 }} unit="%" />
                <Tooltip contentStyle={{ background: '#0f1729ee', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                <Line type="monotone" dataKey="max" stroke="#ef4444" dot={false} name="Max SOC" strokeWidth={2} />
                <Line type="monotone" dataKey="min" stroke="#3b82f6" dot={false} name="Min SOC" strokeWidth={2} />
                <Line type="monotone" dataKey="avg" stroke="#22c55e" dot={false} name="Avg SOC" strokeDasharray="4 2" />
                <ReferenceLine y={0} stroke="rgba(255,255,255,0.1)" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Spread reduction */}
          <div className="min-h-[200px]">
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={balResult.snapshots}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="step" tick={{ fill: '#94a3b8', fontSize: 9 }} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 9 }} unit="%" />
                <Tooltip contentStyle={{ background: '#0f1729ee', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }} />
                <Line type="monotone" dataKey="spread" stroke="#eab308" dot={false} name="SOC Spread" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
            <div className="text-center text-[10px] text-panel-muted mt-1">
              Spread: {balResult.snapshots[0]?.spread.toFixed(1)}% → {balResult.snapshots[balResult.snapshots.length - 1]?.spread.toFixed(1)}%
              ({balancingMode === 'active' ? 'Active transfer' : 'Passive dissipation'})
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
