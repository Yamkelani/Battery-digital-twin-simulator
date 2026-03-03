/**
 * RUL (Remaining Useful Life) Analytics Panel
 *
 * Comprehensive battery prognostics dashboard:
 *   - Large RUL gauge (remaining cycles)
 *   - SOH trend with EOL threshold + knee-point marker
 *   - Degradation breakdown pie (SEI / Cycle / Plating contributions)
 *   - Resistance growth tracking
 *   - Confidence indicator
 *   - Efficiency metrics (coulombic + energy round-trip)
 *   - Estimated remaining lifetime in hours
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine as _ReferenceLine,
  Legend,
  PieChart,
  Pie,
  Cell,
  AreaChart,
  Area,
} from 'recharts';
import { useBatteryStore } from '../hooks/useBatteryState';
import type { RULPrediction } from '../types/battery';

// Workaround for Recharts v2 type issue with React 18
const ReferenceLine = _ReferenceLine as any;
import { API_BASE } from '../config';

/* ── Helper ────────────────────────────────────────────────── */

function formatCycles(n: number) {
  if (n >= 10000) return `${(n / 1000).toFixed(1)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(2)}k`;
  return n.toFixed(0);
}

function formatHours(h: number) {
  if (h < 1) return `${(h * 60).toFixed(0)}m`;
  if (h < 24) return `${h.toFixed(1)}h`;
  if (h < 720) return `${(h / 24).toFixed(1)}d`;
  if (h < 8760) return `${(h / 720).toFixed(1)}mo`;
  return `${(h / 8760).toFixed(1)}y`;
}

const PIE_COLORS = ['#eab308', '#f97316', '#ef4444'];

/* ── Large RUL Gauge ───────────────────────────────────────── */

function RULGauge({ remaining, total, isEol }: { remaining: number; total: number; isEol: boolean }) {
  const fraction = Math.min(remaining / Math.max(total, 1), 1);
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - fraction);

  // Color: green → yellow → orange → red as life depletes
  const hue = fraction * 120; // 120=green, 0=red
  const color = isEol ? '#ef4444' : `hsl(${hue}, 80%, 50%)`;

  return (
    <div className="flex flex-col items-center">
      <svg width="180" height="180" viewBox="0 0 180 180">
        {/* Outer glow */}
        <circle cx="90" cy="90" r={radius + 5} fill="none" stroke={color} strokeWidth="1" opacity={0.15} />
        {/* Background track */}
        <circle cx="90" cy="90" r={radius} fill="none" stroke="#1e293b" strokeWidth="10" />
        {/* Animated arc */}
        <circle
          cx="90" cy="90" r={radius}
          fill="none" stroke={color} strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform="rotate(-90 90 90)"
          style={{ transition: 'stroke-dashoffset 1s ease, stroke 0.5s ease' }}
        />
        {/* Tick marks at 25%, 50%, 75% */}
        {[0.25, 0.5, 0.75].map((t) => {
          const angle = -90 + t * 360;
          const rad = (angle * Math.PI) / 180;
          const x1 = 90 + (radius - 8) * Math.cos(rad);
          const y1 = 90 + (radius - 8) * Math.sin(rad);
          const x2 = 90 + (radius + 8) * Math.cos(rad);
          const y2 = 90 + (radius + 8) * Math.sin(rad);
          return <line key={t} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#334155" strokeWidth="2" />;
        })}
        {/* Center text */}
        <text x="90" y="78" textAnchor="middle" fill={color} fontSize="28" fontWeight="bold">
          {formatCycles(remaining)}
        </text>
        <text x="90" y="96" textAnchor="middle" fill="#94a3b8" fontSize="11">
          cycles remaining
        </text>
        {isEol && (
          <text x="90" y="114" textAnchor="middle" fill="#ef4444" fontSize="12" fontWeight="bold">
            END OF LIFE
          </text>
        )}
      </svg>
    </div>
  );
}

/* ── SOH Trend Chart ───────────────────────────────────────── */

function SOHTrendChart({ eolThreshold, kneeSoh }: { eolThreshold: number; kneeSoh: number }) {
  const data = useBatteryStore((s) => s.chartHistory);
  const last300 = data.slice(-300);

  return (
    <div className="bg-panel-surface rounded-xl p-3 border border-panel-border">
      <div className="text-xs font-semibold text-panel-text mb-2">SOH Trend & Prediction</div>
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={last300} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis
              dataKey="time"
              tick={{ fontSize: 9, fill: '#94a3b8' }}
              tickFormatter={(s: number) => s < 60 ? `${s.toFixed(0)}s` : `${(s / 60).toFixed(0)}m`}
            />
            <YAxis domain={[75, 100]} tick={{ fontSize: 9, fill: '#94a3b8' }} />
            <Tooltip
              contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 6, fontSize: 11 }}
            />
            {/* EOL threshold */}
            <ReferenceLine
              y={eolThreshold}
              stroke="#ef4444"
              strokeDasharray="5 3"
              label={{ value: 'EOL', position: 'right', style: { fontSize: 9, fill: '#ef4444' } }}
            />
            {/* Knee point */}
            <ReferenceLine
              y={kneeSoh}
              stroke="#eab308"
              strokeDasharray="3 3"
              label={{ value: 'Knee', position: 'right', style: { fontSize: 9, fill: '#eab308' } }}
            />
            <Area
              type="monotone"
              dataKey="soh"
              stroke="#06b6d4"
              fill="#06b6d4"
              fillOpacity={0.15}
              strokeWidth={2}
              name="SOH %"
              dot={false}
              animationDuration={0}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ── Degradation Breakdown Pie ─────────────────────────────── */

function DegradationPie({ sei, cycle, plating }: { sei: number; cycle: number; plating: number }) {
  const data = [
    { name: 'SEI Growth', value: Math.max(sei, 0.1) },
    { name: 'Cycle Aging', value: Math.max(cycle, 0.1) },
    { name: 'Li Plating', value: Math.max(plating, 0.1) },
  ];

  return (
    <div className="bg-panel-surface rounded-xl p-3 border border-panel-border">
      <div className="text-xs font-semibold text-panel-text mb-1">Degradation Breakdown</div>
      <div className="flex items-center">
        <div className="w-28 h-28">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={25}
                outerRadius={45}
                dataKey="value"
                strokeWidth={0}
              >
                {data.map((_, i) => (
                  <Cell key={i} fill={PIE_COLORS[i]} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 6, fontSize: 10 }}
                formatter={(v: number) => `${v.toFixed(1)}%`}
              />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="flex-1 space-y-1.5 ml-2">
          {data.map((d, i) => (
            <div key={d.name} className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: PIE_COLORS[i] }} />
              <span className="text-[10px] text-panel-muted flex-1">{d.name}</span>
              <span className="text-[10px] font-mono text-panel-text">{d.value.toFixed(1)}%</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Stat Card ─────────────────────────────────────────────── */

function StatCard({ label, value, unit, color, icon, sub }: {
  label: string; value: string; unit: string; color: string; icon: string; sub?: string;
}) {
  return (
    <div className="bg-panel-surface rounded-xl p-3 border border-panel-border">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-sm">{icon}</span>
        <span className="text-[10px] text-panel-muted uppercase tracking-wider">{label}</span>
      </div>
      <div className="flex items-baseline gap-1">
        <span className="text-xl font-bold" style={{ color }}>{value}</span>
        <span className="text-xs text-panel-muted">{unit}</span>
      </div>
      {sub && <div className="text-[9px] text-panel-muted mt-0.5">{sub}</div>}
    </div>
  );
}

/* ── Confidence Bar ────────────────────────────────────────── */

function ConfidenceBar({ pct }: { pct: number }) {
  const clamped = Math.min(Math.max(pct, 0), 100);
  const color = clamped > 70 ? '#22c55e' : clamped > 40 ? '#eab308' : '#ef4444';

  return (
    <div className="bg-panel-surface rounded-xl p-3 border border-panel-border">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[10px] text-panel-muted uppercase tracking-wider">Prediction Confidence</span>
        <span className="text-xs font-bold" style={{ color }}>{clamped.toFixed(0)}%</span>
      </div>
      <div className="h-2 bg-panel-bg rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${clamped}%`, backgroundColor: color }}
        />
      </div>
      <div className="text-[9px] text-panel-muted mt-1">
        {clamped < 30 ? 'Low data — run more cycles for accurate prediction' :
         clamped < 70 ? 'Moderate confidence — prediction improving with data' :
         'High confidence — sufficient data for reliable prediction'}
      </div>
    </div>
  );
}

/* ── Efficiency Panel ──────────────────────────────────────── */

function EfficiencyPanel({ eff }: { eff: RULPrediction['efficiency'] | null }) {
  if (!eff) return null;

  return (
    <div className="bg-panel-surface rounded-xl p-3 border border-panel-border">
      <div className="text-xs font-semibold text-panel-text mb-2">Energy Efficiency</div>
      <div className="grid grid-cols-2 gap-3">
        <div className="text-center">
          <CircleGauge value={eff.coulombic} color="#22c55e" size={64} />
          <div className="text-[10px] text-panel-muted mt-1">Coulombic</div>
          <div className="text-[8px] text-panel-muted">
            {eff.charge_ah.toFixed(1)} Ah in / {eff.discharge_ah.toFixed(1)} Ah out
          </div>
        </div>
        <div className="text-center">
          <CircleGauge value={eff.energy} color="#3b82f6" size={64} />
          <div className="text-[10px] text-panel-muted mt-1">Round-Trip Energy</div>
          <div className="text-[8px] text-panel-muted">
            {eff.charge_wh.toFixed(1)} Wh in / {eff.discharge_wh.toFixed(1)} Wh out
          </div>
        </div>
      </div>
    </div>
  );
}

function CircleGauge({ value, color, size }: { value: number; color: string; size: number }) {
  const r = size / 2 - 6;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.min(value, 100) / 100);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="mx-auto">
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#1e293b" strokeWidth="5" />
      <circle
        cx={size/2} cy={size/2} r={r}
        fill="none" stroke={color} strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={c} strokeDashoffset={off}
        transform={`rotate(-90 ${size/2} ${size/2})`}
        style={{ transition: 'stroke-dashoffset 0.5s ease' }}
      />
      <text x={size/2} y={size/2 - 2} textAnchor="middle" fill={color} fontSize="12" fontWeight="bold">
        {value.toFixed(1)}
      </text>
      <text x={size/2} y={size/2 + 10} textAnchor="middle" fill="#94a3b8" fontSize="8">%</text>
    </svg>
  );
}

/* ── RUL Cycles Trend ──────────────────────────────────────── */

function RULTrendChart() {
  const data = useBatteryStore((s) => s.chartHistory);
  const sampled = data.filter((_, i) => i % 3 === 0).slice(-200);

  if (sampled.length < 5) return null;

  return (
    <div className="bg-panel-surface rounded-xl p-3 border border-panel-border">
      <div className="text-xs font-semibold text-panel-text mb-2">RUL Trend (Remaining Cycles)</div>
      <div className="h-32">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={sampled} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
            <XAxis
              dataKey="time"
              tick={{ fontSize: 9, fill: '#94a3b8' }}
              tickFormatter={(s: number) => s < 60 ? `${s.toFixed(0)}s` : `${(s / 60).toFixed(0)}m`}
            />
            <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} />
            <Tooltip
              contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 6, fontSize: 10 }}
              formatter={(v: number) => `${formatCycles(v)} cycles`}
            />
            <Line
              type="monotone"
              dataKey="rulCycles"
              stroke="#a855f7"
              strokeWidth={2}
              name="Remaining Cycles"
              dot={false}
              animationDuration={0}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

/* ── Main RUL Panel ────────────────────────────────────────── */

export default function RULPanel() {
  const [rul, setRul] = useState<RULPrediction | null>(null);
  const bs = useBatteryStore((s) => s.batteryState);

  const fetchRUL = useCallback(async () => {
    try {
      const resp = await fetch(`${API_BASE}/rul`);
      if (!resp.ok) return;
      const json = await resp.json();
      if (json.status === 'ok') setRul(json as RULPrediction);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    fetchRUL();
    const id = setInterval(fetchRUL, 2000);
    return () => clearInterval(id);
  }, [fetchRUL]);

  if (!rul) {
    return (
      <div className="flex-1 flex items-center justify-center bg-panel-bg">
        <div className="text-center">
          <div className="text-4xl mb-3">🔮</div>
          <div className="text-panel-muted text-sm">Loading RUL prediction...</div>
          <div className="text-panel-muted text-xs mt-1">Run the simulation to generate data</div>
        </div>
      </div>
    );
  }

  const totalEstCycles = rul.equivalent_cycles + rul.remaining_cycles;

  return (
    <div className="flex-1 overflow-y-auto bg-panel-bg p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-panel-text flex items-center gap-2">
            <span className="text-xl">🔮</span>
            Battery Prognostics & RUL
          </h2>
          <p className="text-[11px] text-panel-muted">
            Remaining Useful Life estimation · SOH: {rul.soh_pct.toFixed(2)}% · {rul.equivalent_cycles.toFixed(1)} equivalent cycles
          </p>
        </div>
        <div className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
          rul.is_eol ? 'bg-red-500/20 text-red-400 animate-pulse' :
          rul.soh_pct < 85 ? 'bg-yellow-500/20 text-yellow-400' :
          'bg-green-500/20 text-green-400'
        }`}>
          {rul.is_eol ? 'END OF LIFE' : rul.soh_pct < 85 ? 'DEGRADED' : 'HEALTHY'}
        </div>
      </div>

      {/* Top row: RUL Gauge + Key Metrics */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Gauge */}
        <div className="bg-panel-surface rounded-xl p-4 border border-panel-border flex flex-col items-center">
          <RULGauge remaining={rul.remaining_cycles} total={totalEstCycles} isEol={rul.is_eol} />
          <div className="text-xs text-panel-muted mt-1">
            of ~{formatCycles(totalEstCycles)} total estimated cycles
          </div>
        </div>

        {/* Key Metrics */}
        <div className="lg:col-span-2 grid grid-cols-2 md:grid-cols-3 gap-3">
          <StatCard
            icon="🔋" label="SOH" value={rul.soh_pct.toFixed(2)} unit="%"
            color={rul.soh_pct > 90 ? '#22c55e' : rul.soh_pct > 80 ? '#eab308' : '#ef4444'}
            sub={`Retention: ${(rul.capacity_retention * 100).toFixed(2)}%`}
          />
          <StatCard
            icon="🔄" label="Eq. Cycles" value={rul.equivalent_cycles.toFixed(1)} unit=""
            color="#06b6d4"
            sub={`${rul.total_ah_throughput.toFixed(0)} Ah throughput`}
          />
          <StatCard
            icon="⏱️" label="Est. Remaining" value={formatHours(rul.remaining_time_hours)} unit=""
            color="#a855f7"
            sub={`${formatCycles(rul.remaining_cycles)} cycles to EOL`}
          />
          <StatCard
            icon="📉" label="Deg Rate" value={(rul.degradation_rate_per_cycle * 100).toFixed(4)} unit="%/cyc"
            color="#f97316"
            sub={`Total loss: ${rul.total_capacity_loss_pct.toFixed(3)}%`}
          />
          <StatCard
            icon="⚡" label="Resistance" value={`${rul.resistance_factor.toFixed(3)}x`} unit=""
            color="#eab308"
            sub="Internal resistance growth"
          />
          <StatCard
            icon="⚡" label="Energy" value={rul.total_energy_wh.toFixed(0)} unit="Wh"
            color="#3b82f6"
            sub="Total energy throughput"
          />
        </div>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SOHTrendChart eolThreshold={rul.eol_threshold_pct} kneeSoh={rul.knee_point_soh} />
        <DegradationPie
          sei={rul.sei_contribution_pct}
          cycle={rul.cycle_contribution_pct}
          plating={rul.plating_contribution_pct}
        />
      </div>

      {/* Bottom Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ConfidenceBar pct={rul.confidence_pct} />
        <EfficiencyPanel eff={rul.efficiency} />
        <RULTrendChart />
      </div>

      {/* Knee Point Info */}
      {rul.cycles_to_knee_point > 0 && (
        <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-xl p-3 flex items-center gap-3">
          <span className="text-xl">⚠️</span>
          <div>
            <div className="text-sm font-semibold text-yellow-400">Degradation Knee Point</div>
            <div className="text-[11px] text-yellow-400/70">
              Estimated ~{formatCycles(rul.cycles_to_knee_point)} cycles until accelerated degradation begins
              (SOH drops below {rul.knee_point_soh}%). After this point, capacity loss accelerates significantly.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
