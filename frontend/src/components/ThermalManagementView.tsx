/**
 * Thermal Management View
 *
 * Visualises the pack-level thermal landscape:
 *   - Heat-map grid of cell temperatures (core + surface)
 *   - Coolant flow lines with animated particles
 *   - Live min / max / avg temperature gauges
 *   - Thermal resistance + heat dissipation metrics
 *   - Per-cell heat-generation bar chart
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, Legend,
} from 'recharts';
import { Thermometer, Wind, Flame, Snowflake, ArrowDown, ArrowUp, RefreshCw } from 'lucide-react';
import { useBatteryStore } from '../hooks/useBatteryState';
import { API_BASE } from '../config';

/* ── Types ───────────────────────────────────────────────── */
interface CellThermal {
  cell_id: string;
  temp_c: number;
  temp_surface_c: number;
  temp_gradient_c: number;
  heat_w: number;
  soc: number;
  current: number;
}

/* ── Helpers ─────────────────────────────────────────────── */
function tempColor(t: number): string {
  const norm = Math.max(0, Math.min((t - 20) / 40, 1));
  if (norm < 0.5) {
    const r = Math.round(norm * 2 * 255);
    return `rgb(${r}, ${Math.round(100 + norm * 310)}, 255)`;
  }
  const r = 255;
  const g = Math.round(255 - (norm - 0.5) * 2 * 255);
  return `rgb(${r}, ${Math.max(g, 0)}, ${Math.round(50 - norm * 50)})`;
}

function GaugeRing({ value, max, label, unit, color }: { value: number; max: number; label: string; unit: string; color: string }) {
  const pct = Math.min(value / max, 1);
  const r = 40;
  const circ = 2 * Math.PI * r;
  const dash = circ * pct;
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width={96} height={96} className="-rotate-90">
        <circle cx="48" cy="48" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={8} />
        <circle
          cx="48" cy="48" r={r} fill="none" stroke={color} strokeWidth={8}
          strokeDasharray={`${dash} ${circ - dash}`} strokeLinecap="round"
          className="transition-all duration-500"
        />
      </svg>
      <div className="absolute mt-6 flex flex-col items-center">
        <span className="text-xl font-bold text-white">{value.toFixed(1)}</span>
        <span className="text-[10px] text-panel-muted">{unit}</span>
      </div>
      <span className="text-xs text-panel-muted mt-1">{label}</span>
    </div>
  );
}

/* ── Coolant animation CSS ───────────────────────────────── */
const coolantCSS = `
@keyframes coolantFlow {
  0%   { background-position: 0% 0%; }
  100% { background-position: 200% 0%; }
}
.coolant-pipe {
  background: repeating-linear-gradient(
    90deg,
    rgba(56,189,248,0.0) 0%,
    rgba(56,189,248,0.5) 25%,
    rgba(56,189,248,0.0) 50%
  );
  background-size: 200% 100%;
  animation: coolantFlow 2s linear infinite;
}
`;

/* ── Main Component ──────────────────────────────────────── */
export default function ThermalManagementView() {
  const packCellStates = useBatteryStore((s) => s.packCellStates);
  const packThermalLinks = useBatteryStore((s) => s.packThermalLinks);
  const batteryState = useBatteryStore((s) => s.batteryState);
  const packSeries = useBatteryStore((s) => s.packSeries);
  const packParallel = useBatteryStore((s) => s.packParallel);
  const [history, setHistory] = useState<{ time: number; min: number; max: number; avg: number }[]>([]);

  // Build cell thermal array from WS data or single-cell fallback
  const cells: CellThermal[] = useMemo(() => {
    if (packCellStates && packCellStates.length > 0) {
      return packCellStates.map((c: any) => ({
        cell_id: c.cell_id ?? 'CELL',
        temp_c: c.temp_c ?? 25,
        temp_surface_c: c.temp_surface_c ?? c.temp_c ?? 25,
        temp_gradient_c: c.temp_gradient_c ?? 0,
        heat_w: c.heat_w ?? 0,
        soc: c.soc ?? 0.5,
        current: c.current ?? 0,
      }));
    }
    if (batteryState) {
      return [{
        cell_id: 'CELL_001',
        temp_c: batteryState.thermal_T_core_c ?? 25,
        temp_surface_c: batteryState.thermal_T_surface_c ?? 25,
        temp_gradient_c: (batteryState.thermal_T_core_c ?? 25) - (batteryState.thermal_T_surface_c ?? 25),
        heat_w: batteryState.heat_total_w ?? 0,
        soc: (batteryState.soc ?? 0.5),
        current: batteryState.current ?? 0,
      }];
    }
    return [];
  }, [packCellStates, batteryState]);

  // Stats
  const stats = useMemo(() => {
    if (cells.length === 0) return { min: 25, max: 25, avg: 25, spread: 0, totalHeat: 0 };
    const temps = cells.map((c) => c.temp_c);
    const min = Math.min(...temps);
    const max = Math.max(...temps);
    const avg = temps.reduce((a, b) => a + b, 0) / temps.length;
    const totalHeat = cells.reduce((s, c) => s + c.heat_w, 0);
    return { min, max, avg, spread: max - min, totalHeat };
  }, [cells]);

  // Append to temp timeline
  useEffect(() => {
    const t = batteryState?.sim_time_s ?? 0;
    if (t > 0 && cells.length > 0) {
      setHistory((prev) => {
        const last = prev[prev.length - 1];
        if (last && Math.abs(last.time - t) < 0.5) return prev;
        const next = [...prev, { time: t, min: stats.min, max: stats.max, avg: stats.avg }];
        return next.length > 300 ? next.slice(-300) : next;
      });
    }
  }, [batteryState?.sim_time_s, stats, cells.length]);

  // Ambient temp
  const ambientC = 25;
  const heatDissipated = stats.totalHeat; // W dissipated by convection+radiation

  // Heat generation bar data
  const barData = useMemo(() =>
    cells.map((c) => ({
      name: c.cell_id.replace('S', '').replace('_C', '-'),
      heat: +c.heat_w.toFixed(2),
      temp: +c.temp_c.toFixed(1),
    })),
  [cells]);

  const cols = packSeries || Math.ceil(Math.sqrt(cells.length));
  const rows = packParallel || Math.ceil(cells.length / cols);

  return (
    <div className="h-full flex flex-col gap-3 p-4 overflow-y-auto text-white">
      <style>{coolantCSS}</style>

      {/* ── Top KPI row ──────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
        {[
          { icon: Thermometer, label: 'Core Avg', val: `${stats.avg.toFixed(1)}°C`, color: tempColor(stats.avg) },
          { icon: ArrowUp, label: 'Hot Spot', val: `${stats.max.toFixed(1)}°C`, color: '#ef4444' },
          { icon: ArrowDown, label: 'Cold Spot', val: `${stats.min.toFixed(1)}°C`, color: '#38bdf8' },
          { icon: Flame, label: 'Total Heat', val: `${stats.totalHeat.toFixed(1)} W`, color: '#f97316' },
          { icon: Wind, label: 'Spread ΔT', val: `${stats.spread.toFixed(2)}°C`, color: stats.spread > 3 ? '#eab308' : '#22c55e' },
          { icon: Snowflake, label: 'Ambient', val: `${ambientC}°C`, color: '#7dd3fc' },
        ].map(({ icon: Icon, label, val, color }) => (
          <div key={label} className="bg-white/[0.04] border border-white/[0.06] rounded-xl p-3 flex items-center gap-3">
            <div className="p-2 rounded-lg" style={{ background: `${color}22` }}>
              <Icon className="w-5 h-5" style={{ color }} />
            </div>
            <div>
              <div className="text-xs text-panel-muted">{label}</div>
              <div className="text-sm font-semibold" style={{ color }}>{val}</div>
            </div>
          </div>
        ))}
      </div>

      {/* ── Main body ─────────────────────────────────────── */}
      <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 gap-4 min-h-0">

        {/* ── LEFT: Thermal Heatmap Grid ─────────────────── */}
        <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 flex flex-col">
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Thermometer className="w-4 h-4 text-orange-400" />
            Cell Temperature Map
          </h3>

          {cells.length === 0 ? (
            <div className="flex-1 flex items-center justify-center text-panel-muted text-sm">
              No cell data — configure a pack or start a simulation
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center gap-2">
              {/* Coolant inlet pipe */}
              <div className="flex items-center gap-2 w-full max-w-md">
                <Wind className="w-4 h-4 text-sky-400" />
                <div className="flex-1 h-2 rounded-full coolant-pipe" />
                <span className="text-[10px] text-sky-400">IN {ambientC}°C</span>
              </div>

              {/* Cell grid */}
              <div
                className="grid gap-1.5 w-full max-w-md"
                style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}
              >
                {cells.map((c) => {
                  const bg = tempColor(c.temp_c);
                  return (
                    <div
                      key={c.cell_id}
                      className="relative rounded-lg border border-white/10 p-1.5 text-center
                                 transition-colors duration-300 group cursor-default"
                      style={{ background: bg + '33', borderColor: bg + '66' }}
                    >
                      <div className="text-[9px] text-white/60 truncate">{c.cell_id.replace('S','').replace('_C','-')}</div>
                      <div className="text-sm font-bold" style={{ color: bg }}>{c.temp_c.toFixed(1)}°</div>
                      <div className="text-[9px] text-white/40">Surf {c.temp_surface_c.toFixed(1)}°</div>

                      {/* Tooltip on hover */}
                      <div className="absolute z-30 bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block
                                      bg-gray-900/95 border border-white/10 rounded-lg p-2 text-left min-w-[120px] shadow-xl">
                        <p className="text-[10px] font-semibold text-white">{c.cell_id}</p>
                        <p className="text-[10px] text-panel-muted">Core: {c.temp_c.toFixed(1)}°C</p>
                        <p className="text-[10px] text-panel-muted">Surface: {c.temp_surface_c.toFixed(1)}°C</p>
                        <p className="text-[10px] text-panel-muted">ΔT: {c.temp_gradient_c.toFixed(2)}°C</p>
                        <p className="text-[10px] text-panel-muted">Heat: {c.heat_w.toFixed(2)} W</p>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Coolant outlet pipe */}
              <div className="flex items-center gap-2 w-full max-w-md">
                <span className="text-[10px] text-red-400">OUT ~{(ambientC + stats.spread * 0.4).toFixed(1)}°C</span>
                <div className="flex-1 h-2 rounded-full coolant-pipe" style={{ animationDirection: 'reverse' }} />
                <Wind className="w-4 h-4 text-red-400" />
              </div>

              {/* Color legend */}
              <div className="flex items-center gap-2 mt-2">
                <span className="text-[10px] text-panel-muted">20°C</span>
                <div className="h-2 w-32 rounded-full" style={{
                  background: 'linear-gradient(90deg, #3b82f6, #22c55e, #eab308, #ef4444)',
                }} />
                <span className="text-[10px] text-panel-muted">60°C</span>
              </div>
            </div>
          )}
        </div>

        {/* ── RIGHT: Charts ──────────────────────────────── */}
        <div className="flex flex-col gap-3">
          {/* Temperature timeline */}
          <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 flex-1 min-h-[200px]">
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <Thermometer className="w-4 h-4 text-blue-400" />
              Temperature Timeline
            </h3>
            <ResponsiveContainer width="100%" height="85%">
              <LineChart data={history}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="time" tick={{ fill: '#94a3b8', fontSize: 10 }} tickFormatter={(t) => `${(t/60).toFixed(0)}m`} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} domain={['auto', 'auto']} unit="°C" />
                <Tooltip contentStyle={{ background: '#0f1729ee', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="max" stroke="#ef4444" name="Hot Spot" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="avg" stroke="#eab308" name="Average" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="min" stroke="#38bdf8" name="Cold Spot" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Heat generation per cell */}
          <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 min-h-[180px]">
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
              <Flame className="w-4 h-4 text-orange-400" />
              Heat Generation per Cell
            </h3>
            <ResponsiveContainer width="100%" height={140}>
              <BarChart data={barData}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 9 }} />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 10 }} unit=" W" />
                <Tooltip contentStyle={{ background: '#0f1729ee', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }} />
                <Bar dataKey="heat" fill="#f97316" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
