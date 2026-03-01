/**
 * Real-Time Status Panel
 *
 * Displays key battery metrics in a compact HUD-style panel:
 *   - SOC gauge
 *   - Voltage
 *   - Current & C-rate
 *   - Temperature (core, surface, ambient)
 *   - SOH & degradation breakdown
 *   - Simulation time
 */

import { useBatteryStore } from '../hooks/useBatteryState';
import { socToColor, tempToColor, sohToColor, formatTime, formatValue } from '../utils/colors';

function MetricCard({
  label,
  value,
  unit,
  color,
  subtext,
}: {
  label: string;
  value: string;
  unit: string;
  color?: string;
  subtext?: string;
}) {
  return (
    <div className="bg-panel-surface rounded-lg p-2 border border-panel-border">
      <div className="text-[10px] text-panel-muted uppercase tracking-wider">{label}</div>
      <div className="flex items-baseline gap-1 mt-0.5">
        <span className="text-lg font-bold" style={{ color: color ?? '#e2e8f0' }}>
          {value}
        </span>
        <span className="text-xs text-panel-muted">{unit}</span>
      </div>
      {subtext && <div className="text-[10px] text-panel-muted mt-0.5">{subtext}</div>}
    </div>
  );
}

function SOCGauge({ soc }: { soc: number }) {
  const pct = Math.max(0, Math.min(100, soc * 100));
  const color = socToColor(soc);
  const circumference = 2 * Math.PI * 40;
  const dashOffset = circumference * (1 - soc);

  return (
    <div className="flex flex-col items-center bg-panel-surface rounded-lg p-3 border border-panel-border">
      <div className="text-[10px] text-panel-muted uppercase tracking-wider mb-1">
        State of Charge
      </div>
      <svg width="100" height="100" viewBox="0 0 100 100">
        {/* Background circle */}
        <circle
          cx="50"
          cy="50"
          r="40"
          fill="none"
          stroke="#1e293b"
          strokeWidth="8"
        />
        {/* SOC arc */}
        <circle
          cx="50"
          cy="50"
          r="40"
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform="rotate(-90 50 50)"
          style={{ transition: 'stroke-dashoffset 0.3s ease, stroke 0.3s ease' }}
        />
        {/* Center text */}
        <text x="50" y="46" textAnchor="middle" fill={color} fontSize="22" fontWeight="bold">
          {pct.toFixed(1)}
        </text>
        <text x="50" y="62" textAnchor="middle" fill="#94a3b8" fontSize="10">
          %
        </text>
      </svg>
    </div>
  );
}

export default function StatusPanel() {
  const bs = useBatteryStore((s) => s.batteryState);
  const status = useBatteryStore((s) => s.status);

  if (!bs) {
    return (
      <div className="p-3 space-y-2">
        <div className="text-panel-muted text-sm text-center py-8">
          {status === 'connecting' ? 'Connecting...' : 'Waiting for simulation data...'}
        </div>
      </div>
    );
  }

  // Safe accessors
  const soc = bs.soc ?? 0.5;
  const voltage = bs.voltage ?? 3.7;
  const ocv = bs.ocv ?? 3.7;
  const current = bs.current ?? 0;
  const cRate = bs.c_rate ?? 0;
  const powerW = bs.power_w ?? 0;
  const tempCore = bs.thermal_T_core_c ?? 25;
  const tempSurface = bs.thermal_T_surface_c ?? 25;
  const heatTotal = bs.heat_total_w ?? 0;
  const gradient = bs.thermal_gradient_c ?? 0;
  const soh = bs.deg_soh_pct ?? 100;
  const resFactor = bs.deg_resistance_factor ?? 1;
  const eqCycles = bs.deg_equivalent_cycles ?? 0;
  const ahThrough = bs.deg_total_ah_throughput ?? 0;
  const seiLoss = bs.deg_sei_loss_pct ?? 0;
  const cycleLoss = bs.deg_cycle_loss_pct ?? 0;
  const platingLoss = bs.deg_plating_loss_pct ?? 0;
  const simTime = bs.sim_time_s ?? 0;
  const stepCount = bs.step_count ?? 0;

  return (
    <div className="p-2 space-y-2 overflow-y-auto max-h-full text-panel-text">
      {/* SOC Gauge */}
      <SOCGauge soc={soc} />

      {/* Electrical */}
      <div className="grid grid-cols-2 gap-1.5">
        <MetricCard
          label="Voltage"
          value={voltage.toFixed(3)}
          unit="V"
          color="#3b82f6"
          subtext={`OCV: ${ocv.toFixed(3)} V`}
        />
        <MetricCard
          label="Current"
          value={current.toFixed(1)}
          unit="A"
          color={current > 0 ? '#ef4444' : current < 0 ? '#3b82f6' : '#64748b'}
          subtext={`${cRate.toFixed(2)}C | ${current > 0 ? 'Discharge' : current < 0 ? 'Charge' : 'Idle'}`}
        />
      </div>

      <MetricCard
        label="Power"
        value={Math.abs(powerW).toFixed(1)}
        unit="W"
        color="#a855f7"
        subtext={powerW > 0 ? 'Discharging' : powerW < 0 ? 'Charging' : 'Idle'}
      />

      {/* Thermal */}
      <div className="grid grid-cols-2 gap-1.5">
        <MetricCard
          label="Core Temp"
          value={tempCore.toFixed(1)}
          unit="°C"
          color={tempToColor(tempCore)}
          subtext={`Surface: ${tempSurface.toFixed(1)}°C`}
        />
        <MetricCard
          label="Heat Gen"
          value={heatTotal.toFixed(2)}
          unit="W"
          color="#f97316"
          subtext={`ΔT: ${gradient.toFixed(2)}°C`}
        />
      </div>

      {/* Warnings */}
      {bs.thermal_overtemp_warning && (
        <div className="bg-yellow-500/20 border border-yellow-500/40 rounded-lg p-2 text-xs text-yellow-400">
          ⚠️ Over-temperature warning! ({tempCore.toFixed(1)}°C)
        </div>
      )}
      {bs.thermal_runaway_risk && (
        <div className="bg-red-500/20 border border-red-500/40 rounded-lg p-2 text-xs text-red-400 font-bold animate-pulse">
          🔥 THERMAL RUNAWAY RISK! ({tempCore.toFixed(1)}°C)
        </div>
      )}

      {/* Degradation */}
      <div className="grid grid-cols-2 gap-1.5">
        <MetricCard
          label="SOH"
          value={soh.toFixed(2)}
          unit="%"
          color={sohToColor(soh)}
          subtext={`R factor: ${resFactor.toFixed(3)}x`}
        />
        <MetricCard
          label="Cycles"
          value={eqCycles.toFixed(1)}
          unit=""
          color="#06b6d4"
          subtext={`${ahThrough.toFixed(0)} Ah total`}
        />
      </div>

      {/* Degradation breakdown */}
      <div className="bg-panel-surface rounded-lg p-2 border border-panel-border">
        <div className="text-[10px] text-panel-muted uppercase tracking-wider mb-1">
          Degradation Breakdown
        </div>
        <div className="space-y-1">
          <DegBar label="SEI Growth" value={seiLoss} color="#eab308" />
          <DegBar label="Cycle Aging" value={cycleLoss} color="#f97316" />
          <DegBar label="Li Plating" value={platingLoss} color="#ef4444" />
        </div>
      </div>

      {/* Simulation info */}
      <MetricCard
        label="Sim Time"
        value={formatTime(simTime)}
        unit=""
        subtext={`Step #${stepCount}`}
      />

      {bs.deg_is_eol && (
        <div className="bg-red-500/20 border border-red-500/40 rounded-lg p-2 text-xs text-red-400 font-bold text-center">
          ⛔ END OF LIFE REACHED (SOH &lt; 80%)
        </div>
      )}
    </div>
  );
}

function DegBar({ label, value, color }: { label: string; value: number; color: string }) {
  const width = Math.min(value * 5, 100); // Scale: 20% loss = full bar
  return (
    <div className="flex items-center gap-2">
      <div className="text-[10px] text-panel-muted w-16 shrink-0">{label}</div>
      <div className="flex-1 h-2 bg-panel-bg rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-300"
          style={{ width: `${width}%`, backgroundColor: color }}
        />
      </div>
      <div className="text-[10px] text-panel-muted w-12 text-right">{value.toFixed(3)}%</div>
    </div>
  );
}
