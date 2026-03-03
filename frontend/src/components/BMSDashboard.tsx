/**
 * BMS Dashboard — Full-width Battery Management System view
 *
 * Provides a comprehensive, animated pack management interface:
 *   - Pack overview: voltage, current, power, temp spread
 *   - Per-cell voltage bars with OV/UV safety limits
 *   - Per-cell temperature bars with overtemp/critical limits
 *   - Per-cell SOC comparison bars
 *   - Animated contactor state machine with current flow
 *   - Active faults with animated severity-based entrance
 *   - Animated cell balancing visualization with bleed indicators
 *   - Protection action log with real-time descriptions
 *   - Fault history timeline
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useBatteryStore } from '../hooks/useBatteryState';

const API_BASE = 'http://localhost:8001/api';

/* ── Types ─────────────────────────────────────────────────── */

interface CellInfo {
  cell_id: string;
  soc: number;
  voltage: number;
  temp_c: number;
  soh_pct: number;
  sei_loss_pct: number;
  current: number;
  heat_w: number;
  capacity_ah: number;
}

/* ── BMS Safety Limits (match backend BMSConfig defaults) ─── */

const LIMITS = {
  cellVMax: 4.25,
  cellVMin: 2.50,
  cellTempMax: 55,
  cellTempCritical: 75,
  cellTempMin: -20,
  packCurrentMax: 150,
  imbalanceVThreshold: 0.05,
};

/* ── Fault severity ────────────────────────────────────────── */

const FAULT_META: Record<string, { color: string; bg: string; icon: string; desc: string }> = {
  THERMAL_RUNAWAY: { color: '#ef4444', bg: 'bg-red-500/20 border-red-500/50', icon: '🔥', desc: 'Critical — cell temp exceeds 75°C, contactor opens immediately' },
  OVER_TEMP:       { color: '#f97316', bg: 'bg-orange-500/20 border-orange-500/50', icon: '🌡️', desc: 'Cell temperature above 55°C limit' },
  OVER_VOLTAGE:    { color: '#eab308', bg: 'bg-yellow-500/20 border-yellow-500/50', icon: '⚡', desc: 'Cell voltage exceeds 4.25V upper limit' },
  UNDER_VOLTAGE:   { color: '#eab308', bg: 'bg-yellow-500/20 border-yellow-500/50', icon: '🔋', desc: 'Cell voltage below 2.50V lower limit' },
  OVER_CURRENT:    { color: '#f97316', bg: 'bg-orange-500/20 border-orange-500/50', icon: '⚠️', desc: 'Pack current exceeds 150A maximum' },
  CELL_IMBALANCE:  { color: '#3b82f6', bg: 'bg-blue-500/20 border-blue-500/50', icon: '⚖️', desc: 'Voltage spread across cells > 50mV' },
  UNDER_TEMP:      { color: '#06b6d4', bg: 'bg-cyan-500/20 border-cyan-500/50', icon: '❄️', desc: 'Cell temperature below -20°C limit' },
};

function formatFault(f: string) { return f.replace(/_/g, ' '); }
function formatTime(s: number) {
  if (s < 60) return `${s.toFixed(0)}s`;
  if (s < 3600) return `${(s / 60).toFixed(1)}m`;
  return `${(s / 3600).toFixed(1)}h`;
}

/* ── Sub-components ────────────────────────────────────────── */

function PackOverviewCard({ label, value, unit, color, sub }: {
  label: string; value: string; unit: string; color: string; sub?: string;
}) {
  return (
    <div className="bg-panel-surface rounded-xl p-3 border border-panel-border flex-1 min-w-[140px]">
      <div className="text-[10px] text-panel-muted uppercase tracking-wider">{label}</div>
      <div className="flex items-baseline gap-1 mt-1">
        <span className="text-2xl font-bold" style={{ color }}>{value}</span>
        <span className="text-xs text-panel-muted">{unit}</span>
      </div>
      {sub && <div className="text-[10px] text-panel-muted mt-0.5">{sub}</div>}
    </div>
  );
}

/** Horizontal bar chart with safety limit markers */
function CellBarChart({ cells, accessor, label, unit, color, limits, domain }: {
  cells: CellInfo[];
  accessor: (c: CellInfo) => number;
  label: string;
  unit: string;
  color: string;
  limits?: { value: number; color: string; label: string }[];
  domain: [number, number];
}) {
  const [min, max] = domain;
  const range = max - min;

  return (
    <div className="bg-panel-surface rounded-xl p-3 border border-panel-border">
      <div className="text-xs font-semibold text-panel-text mb-2">{label}</div>
      <div className="space-y-1 relative">
        {cells.map((cell) => {
          const val = accessor(cell);
          const pct = Math.max(0, Math.min(100, ((val - min) / range) * 100));
          return (
            <div key={cell.cell_id} className="flex items-center gap-2">
              <div className="text-[9px] text-panel-muted w-10 text-right shrink-0 font-mono">
                {cell.cell_id.replace('S', '').replace('_C', '.')}
              </div>
              <div className="flex-1 h-4 bg-panel-bg rounded-sm relative overflow-hidden">
                {/* Safety limit lines */}
                {limits?.map((lim) => {
                  const limPct = ((lim.value - min) / range) * 100;
                  if (limPct < 0 || limPct > 100) return null;
                  return (
                    <div
                      key={lim.label}
                      className="absolute top-0 bottom-0 w-px z-10"
                      style={{ left: `${limPct}%`, backgroundColor: lim.color }}
                      title={`${lim.label}: ${lim.value}${unit}`}
                    />
                  );
                })}
                {/* Value bar */}
                <div
                  className="h-full rounded-sm transition-all duration-300"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: color,
                    opacity: 0.85,
                  }}
                />
              </div>
              <div className="text-[10px] text-panel-text w-14 text-right font-mono">
                {val.toFixed(unit === 'V' ? 3 : unit === '°C' ? 1 : 1)}{unit}
              </div>
            </div>
          );
        })}
      </div>

      {/* Legend for limit lines */}
      {limits && limits.length > 0 && (
        <div className="flex gap-3 mt-2 flex-wrap">
          {limits.map((lim) => (
            <div key={lim.label} className="flex items-center gap-1">
              <div className="w-2 h-2 rounded-sm" style={{ backgroundColor: lim.color }} />
              <span className="text-[9px] text-panel-muted">{lim.label} ({lim.value}{unit})</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Animated contactor state diagram with current flow */
function ContactorDiagram({ closed, precharge }: { closed: boolean; precharge: boolean }) {
  const [animPhase, setAnimPhase] = useState(0);
  const flowRef = useRef(0);

  // Animate current flow dots when contactor is closed
  useEffect(() => {
    if (!closed) { setAnimPhase(0); return; }
    const id = setInterval(() => {
      flowRef.current = (flowRef.current + 1) % 100;
      setAnimPhase(flowRef.current);
    }, 50);
    return () => clearInterval(id);
  }, [closed]);

  // Current flow dot positions (moves left-to-right when closed)
  const dotOffset = closed ? `${animPhase}%` : '0%';

  return (
    <div className="bg-panel-surface rounded-xl p-4 border border-panel-border">
      <div className="text-xs font-semibold text-panel-text mb-3">Contactor State Machine</div>

      {/* State machine indicator */}
      <div className="flex items-center justify-center gap-1 mb-4">
        {['OPEN', 'PRE-CHG', 'CLOSED'].map((label, i) => {
          const isActive =
            (i === 0 && !closed && !precharge) ||
            (i === 1 && precharge) ||
            (i === 2 && closed);
          return (
            <div key={label} className="flex items-center gap-1">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[8px] font-bold transition-all duration-500 ${
                isActive
                  ? 'bg-green-500 text-white shadow-lg shadow-green-500/30 scale-110'
                  : 'bg-panel-bg text-panel-muted border border-panel-border'
              }`}>
                {i + 1}
              </div>
              <span className={`text-[9px] transition-colors ${isActive ? 'text-green-400 font-bold' : 'text-panel-muted'}`}>
                {label}
              </span>
              {i < 2 && <span className="text-panel-muted mx-1">→</span>}
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-center gap-2 relative">
        {/* Pack + terminal */}
        <div className="flex flex-col items-center">
          <div className={`w-10 h-10 rounded-lg border-2 flex items-center justify-center text-xs font-bold transition-all duration-300 ${
            closed ? 'bg-red-500/20 border-red-500 text-red-400 shadow-lg shadow-red-500/20' : 'bg-red-500/10 border-red-500/50 text-red-400/60'
          }`}>+</div>
          <span className="text-[9px] text-panel-muted mt-1">Pack +</span>
        </div>

        {/* Current flow line with animated dots */}
        <div className="relative w-16 h-2">
          <div className={`absolute inset-0 rounded transition-colors duration-500 ${closed ? 'bg-green-400' : 'bg-gray-600/50'}`} />
          {closed && (
            <>
              <div className="absolute top-0 bottom-0 w-2 h-2 bg-white rounded-full animate-bounce" style={{ left: dotOffset, transition: 'left 0.05s linear' }} />
              <div className="absolute top-0 bottom-0 w-2 h-2 bg-white/50 rounded-full" style={{ left: `${(animPhase + 30) % 100}%`, transition: 'left 0.05s linear' }} />
            </>
          )}
        </div>

        {/* Contactor K1 */}
        <div className="flex flex-col items-center">
          <div className={`w-14 h-14 rounded-xl border-2 flex flex-col items-center justify-center transition-all duration-500 ${
            closed
              ? 'border-green-400 text-green-400 bg-green-500/10 shadow-lg shadow-green-500/30'
              : precharge
                ? 'border-yellow-400 text-yellow-400 bg-yellow-500/10 shadow-lg shadow-yellow-500/20 animate-pulse'
                : 'border-red-400 text-red-400 bg-red-500/10'
          }`}>
            <span className="text-lg font-bold">K1</span>
            <span className="text-[8px]">{closed ? 'ON' : precharge ? 'PRE' : 'OFF'}</span>
          </div>
          <span className={`text-[10px] font-bold mt-1 transition-colors duration-300 ${
            closed ? 'text-green-400' : precharge ? 'text-yellow-400 animate-pulse' : 'text-red-400'
          }`}>
            {closed ? '● CLOSED' : precharge ? '◐ PRE-CHG' : '○ OPEN'}
          </span>
        </div>

        {/* Current flow line */}
        <div className="relative w-16 h-2">
          <div className={`absolute inset-0 rounded transition-colors duration-500 ${closed ? 'bg-green-400' : 'bg-gray-600/50'}`} />
          {closed && (
            <>
              <div className="absolute top-0 bottom-0 w-2 h-2 bg-white rounded-full" style={{ left: `${(animPhase + 50) % 100}%`, transition: 'left 0.05s linear' }} />
              <div className="absolute top-0 bottom-0 w-2 h-2 bg-white/50 rounded-full" style={{ left: `${(animPhase + 80) % 100}%`, transition: 'left 0.05s linear' }} />
            </>
          )}
        </div>

        {/* Pack − terminal */}
        <div className="flex flex-col items-center">
          <div className={`w-10 h-10 rounded-lg border-2 flex items-center justify-center text-xs font-bold transition-all duration-300 ${
            closed ? 'bg-blue-500/20 border-blue-500 text-blue-400 shadow-lg shadow-blue-500/20' : 'bg-blue-500/10 border-blue-500/50 text-blue-400/60'
          }`}>−</div>
          <span className="text-[9px] text-panel-muted mt-1">Pack −</span>
        </div>
      </div>

      {precharge && (
        <div className="mt-3 text-center">
          <span className="text-[10px] bg-yellow-500/20 text-yellow-400 px-3 py-1 rounded-lg animate-pulse inline-flex items-center gap-1">
            <span className="inline-block w-2 h-2 bg-yellow-400 rounded-full animate-ping" />
            Pre-charge relay active — limiting inrush current
          </span>
        </div>
      )}

      {closed && (
        <div className="mt-3 text-center">
          <span className="text-[10px] bg-green-500/15 text-green-400 px-3 py-1 rounded-lg inline-flex items-center gap-1">
            <span className="inline-block w-2 h-2 bg-green-400 rounded-full" />
            Contactor closed — current flowing through pack
          </span>
        </div>
      )}
    </div>
  );
}

/** Active faults with animated entrance + severity-based shaking */
function FaultAlerts({ faults }: { faults: string[] }) {
  const [visible, setVisible] = useState<string[]>([]);
  const prevFaults = useRef<string[]>([]);

  // Animated entrance: new faults slide in
  useEffect(() => {
    const newFaults = faults.filter((f) => !prevFaults.current.includes(f));
    prevFaults.current = faults;
    if (newFaults.length > 0) {
      // Stagger new faults
      newFaults.forEach((f, i) => {
        setTimeout(() => setVisible((prev) => [...prev.filter((p) => faults.includes(p)), f]), i * 150);
      });
    }
    setVisible(faults);
  }, [faults]);

  if (faults.length === 0) {
    return (
      <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 flex items-center gap-3 transition-all duration-500">
        <div className="w-12 h-12 rounded-full bg-green-500/20 flex items-center justify-center text-green-400">
          <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <div>
          <div className="text-sm font-semibold text-green-400">All Systems Normal</div>
          <div className="text-[11px] text-green-400/70">No active faults — all cells within safety limits</div>
        </div>
        {/* Animated heartbeat indicator */}
        <div className="ml-auto flex items-center gap-1">
          <div className="w-2 h-2 bg-green-400 rounded-full animate-ping" />
          <span className="text-[10px] text-green-400">LIVE</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {faults.map((fault, idx) => {
        const meta = FAULT_META[fault] ?? { color: '#94a3b8', bg: 'bg-gray-500/20 border-gray-500/50', icon: '⚠️', desc: 'Unknown fault' };
        const isCritical = fault === 'THERMAL_RUNAWAY' || fault === 'OVER_TEMP';
        return (
          <div
            key={fault}
            className={`${meta.bg} border rounded-xl p-3 flex items-center gap-3 transition-all duration-300`}
            style={{
              animation: `${isCritical ? 'shake 0.5s ease-in-out infinite' : 'fadeSlideIn 0.3s ease-out'}`,
              animationDelay: `${idx * 100}ms`,
            }}
          >
            <div className="text-2xl shrink-0 relative">
              {meta.icon}
              {isCritical && (
                <div className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full animate-ping" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-bold" style={{ color: meta.color }}>{formatFault(fault)}</div>
              <div className="text-[10px] text-panel-muted">{meta.desc}</div>
            </div>
            <div className="text-right shrink-0">
              <div className={`text-[9px] font-bold px-2 py-0.5 rounded ${
                isCritical ? 'bg-red-500/30 text-red-400' : 'bg-orange-500/20 text-orange-400'
              }`}>
                {isCritical ? 'CRITICAL' : 'WARNING'}
              </div>
            </div>
          </div>
        );
      })}
      {/* CSS animations injected */}
      <style>{`
        @keyframes shake {
          0%, 100% { transform: translateX(0); }
          10%, 30%, 50%, 70%, 90% { transform: translateX(-2px); }
          20%, 40%, 60%, 80% { transform: translateX(2px); }
        }
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}

/** Animated balancing visualization with bleed pulse indicators */
function BalancingPanel({ active, balancingMap }: { active: boolean; balancingMap: Record<string, boolean> }) {
  const entries = Object.entries(balancingMap);
  const bleedingCells = entries.filter(([, v]) => v);
  const total = entries.length;
  const [pulsePhase, setPulsePhase] = useState(0);

  // Animated pulse for bleeding cells
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setPulsePhase((p) => (p + 1) % 3), 600);
    return () => clearInterval(id);
  }, [active]);

  return (
    <div className="bg-panel-surface rounded-xl p-4 border border-panel-border">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs font-semibold text-panel-text">Passive Cell Balancing</div>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded flex items-center gap-1 ${
          active ? 'bg-blue-500/20 text-blue-400' : 'bg-panel-bg text-panel-muted'
        }`}>
          {active && <span className="inline-block w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />}
          {active ? 'ACTIVE' : 'IDLE'}
        </span>
      </div>

      <div className="text-[10px] text-panel-muted mb-2">
        {active
          ? `Bleeding ${bleedingCells.length} of ${total} cells to equalize voltage`
          : 'All cells balanced — no resistive bleeding needed'}
      </div>

      {/* Cell grid showing bleed state with animated pulses */}
      <div className="grid grid-cols-6 gap-1.5">
        {entries.map(([cellId, bleeding], idx) => (
          <div
            key={cellId}
            className={`h-8 rounded text-[8px] font-mono flex flex-col items-center justify-center transition-all duration-300 relative ${
              bleeding
                ? 'bg-blue-500/30 text-blue-300 border border-blue-500/50 shadow-sm shadow-blue-500/20'
                : 'bg-panel-bg text-panel-muted border border-transparent'
            }`}
            title={`${cellId}: ${bleeding ? 'Bleeding 50mA — dissipating excess energy' : 'Balanced'}`}
          >
            {cellId.replace('S', '').replace('_C', '.')}
            {bleeding && (
              <>
                {/* Pulse ring animation */}
                <div
                  className="absolute inset-0 rounded border-2 border-blue-400/50"
                  style={{
                    animation: 'bleedPulse 1.2s ease-out infinite',
                    animationDelay: `${(idx * 200) % 1200}ms`,
                  }}
                />
                {/* Bleed current indicator */}
                <div className="text-[6px] text-blue-300/80 leading-none">
                  {['↓', '↕', '↓'][pulsePhase]}50mA
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      {active && (
        <div className="mt-3 space-y-1">
          <div className="text-[9px] text-blue-400/70 flex items-center gap-1">
            <span className="inline-block w-1.5 h-1.5 bg-blue-400 rounded-full animate-ping" />
            Bleed resistor: 50 mA per cell — equalizing toward lowest voltage cell
          </div>
          <div className="flex items-center gap-2 mt-1">
            <div className="flex-1 h-1 bg-panel-bg rounded-full">
              <div
                className="h-full bg-blue-400 rounded-full transition-all duration-1000"
                style={{ width: `${(bleedingCells.length / Math.max(total, 1)) * 100}%` }}
              />
            </div>
            <span className="text-[9px] text-blue-400">
              {bleedingCells.length}/{total}
            </span>
          </div>
        </div>
      )}

      <style>{`
        @keyframes bleedPulse {
          0% { transform: scale(1); opacity: 1; }
          100% { transform: scale(1.3); opacity: 0; }
        }
      `}</style>
    </div>
  );
}

/** Fault history timeline */
function FaultTimeline({ history }: { history: { fault: string; time_s: number; cleared: boolean }[] }) {
  const recent = history.slice(-15).reverse();
  if (recent.length === 0) return null;

  return (
    <div className="bg-panel-surface rounded-xl p-4 border border-panel-border">
      <div className="text-xs font-semibold text-panel-text mb-2">Fault History</div>
      <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
        {recent.map((entry, i) => {
          const meta = FAULT_META[entry.fault] ?? { color: '#94a3b8', icon: '?' };
          return (
            <div
              key={`${entry.fault}-${entry.time_s}-${i}`}
              className="flex items-center gap-2 text-[11px]"
              style={{ animation: 'fadeSlideIn 0.3s ease-out', animationDelay: `${i * 50}ms`, animationFillMode: 'both' }}
            >
              <span className="text-sm">{meta.icon}</span>
              <span className={`flex-1 ${entry.cleared ? 'text-panel-muted line-through' : ''}`}
                    style={{ color: entry.cleared ? undefined : meta.color }}>
                {formatFault(entry.fault)}
              </span>
              <span className="text-panel-muted font-mono text-[10px]">{formatTime(entry.time_s)}</span>
              {entry.cleared ? (
                <span className="text-green-500 text-[9px] font-bold">CLEARED</span>
              ) : (
                <span className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: meta.color }} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Real-time Protection Actions — shows what BMS is actively doing and why */
function ProtectionActions({ bms, cells, packMetrics }: {
  bms: any;
  cells: CellInfo[];
  packMetrics: any;
}) {
  const actions: { icon: string; title: string; desc: string; color: string; active: boolean }[] = [];

  // Contactor management
  if (bms.contactor_closed) {
    actions.push({
      icon: '🔌', title: 'Contactor Engaged',
      desc: 'Main contactor K1 closed — HV bus is live, current flowing to/from pack',
      color: '#22c55e', active: true,
    });
  } else if (bms.precharge_active) {
    actions.push({
      icon: '⚡', title: 'Pre-Charge Active',
      desc: 'Limiting inrush current through pre-charge resistor before closing main contactor',
      color: '#eab308', active: true,
    });
  } else {
    actions.push({
      icon: '🛑', title: 'Contactor Open',
      desc: 'HV bus disconnected — pack is isolated for safety',
      color: '#ef4444', active: true,
    });
  }

  // Cell balancing
  if (bms.balancing_active) {
    const bleedCount = Object.values(bms.balancing_map ?? {}).filter(Boolean).length;
    actions.push({
      icon: '⚖️', title: `Balancing ${bleedCount} Cells`,
      desc: `Bleeding excess voltage from ${bleedCount} high-SOC cells at 50mA to equalize pack. Spread: ${packMetrics?.vSpread ?? '?'}mV`,
      color: '#3b82f6', active: true,
    });
  }

  // Voltage monitoring
  const highVCells = cells.filter((c) => c.voltage > LIMITS.cellVMax);
  const lowVCells = cells.filter((c) => c.voltage < LIMITS.cellVMin);
  if (highVCells.length > 0) {
    actions.push({
      icon: '⬆️', title: `Over-Voltage: ${highVCells.length} cells`,
      desc: `Cells exceeding ${LIMITS.cellVMax}V limit: ${highVCells.map((c) => c.cell_id).join(', ')}`,
      color: '#eab308', active: true,
    });
  }
  if (lowVCells.length > 0) {
    actions.push({
      icon: '⬇️', title: `Under-Voltage: ${lowVCells.length} cells`,
      desc: `Cells below ${LIMITS.cellVMin}V limit: ${lowVCells.map((c) => c.cell_id).join(', ')}`,
      color: '#eab308', active: true,
    });
  }

  // Temperature monitoring
  const hotCells = cells.filter((c) => c.temp_c > LIMITS.cellTempMax);
  if (hotCells.length > 0) {
    actions.push({
      icon: '🌡️', title: `Over-Temp: ${hotCells.length} cells`,
      desc: `Cells exceeding ${LIMITS.cellTempMax}°C: ${hotCells.map((c) => `${c.cell_id} (${c.temp_c.toFixed(1)}°C)`).join(', ')}`,
      color: '#f97316', active: true,
    });
  }

  // Nominal monitoring when no faults
  if ((bms.active_faults ?? []).length === 0 && !bms.balancing_active) {
    actions.push({
      icon: '🔍', title: 'Monitoring',
      desc: 'Continuously checking all cells for voltage/temperature/current violations every cycle',
      color: '#22c55e', active: true,
    });
  }

  return (
    <div className="bg-panel-surface rounded-xl p-4 border border-panel-border">
      <div className="text-xs font-semibold text-panel-text mb-3 flex items-center gap-2">
        <span className="text-sm">🛡️</span>
        Active Protection Actions
        <span className="ml-auto text-[9px] text-panel-muted bg-panel-bg px-2 py-0.5 rounded">
          {actions.length} active
        </span>
      </div>
      <div className="space-y-2">
        {actions.map((action, i) => (
          <div
            key={action.title}
            className="flex items-start gap-2 bg-panel-bg rounded-lg p-2 border border-panel-border/50"
            style={{ animation: 'fadeSlideIn 0.3s ease-out', animationDelay: `${i * 80}ms`, animationFillMode: 'both' }}
          >
            <span className="text-sm mt-0.5 shrink-0">{action.icon}</span>
            <div className="flex-1 min-w-0">
              <div className="text-[11px] font-semibold" style={{ color: action.color }}>
                {action.title}
              </div>
              <div className="text-[9px] text-panel-muted leading-relaxed">{action.desc}</div>
            </div>
            <div
              className="w-2 h-2 rounded-full shrink-0 mt-1"
              style={{ backgroundColor: action.color, animation: action.active ? 'pulse 2s ease-in-out infinite' : 'none' }}
            />
          </div>
        ))}
      </div>
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}

/* ── Main BMSDashboard ─────────────────────────────────────── */

export default function BMSDashboard() {
  const bms = useBatteryStore((s) => s.bmsStatus);
  const packConfigured = useBatteryStore((s) => s.packConfigured);
  const [cells, setCells] = useState<CellInfo[]>([]);
  const [nSeries, setNSeries] = useState(0);
  const [nParallel, setNParallel] = useState(0);

  const fetchCells = useCallback(async () => {
    try {
      const resp = await fetch(`${API_BASE}/pack/status`);
      if (!resp.ok) return;
      const json = await resp.json();
      if (json.status === 'ok') {
        setCells(json.cells ?? []);
        setNSeries(json.n_series ?? 0);
        setNParallel(json.n_parallel ?? 0);
      }
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    if (!packConfigured) return;
    fetchCells();
    const id = setInterval(fetchCells, 1200);
    return () => clearInterval(id);
  }, [packConfigured, fetchCells]);

  // Derived pack metrics
  const packMetrics = useMemo(() => {
    if (cells.length === 0) return null;
    const voltages = cells.map((c) => c.voltage);
    const temps = cells.map((c) => c.temp_c);
    const socs = cells.map((c) => c.soc);
    const heats = cells.map((c) => c.heat_w);
    const sohs = cells.map((c) => c.soh_pct);
    const avgCurrent = cells[0]?.current ?? 0;

    const totalVoltage = nSeries > 0 ? voltages.reduce((a, b) => a + b, 0) / nParallel : 0;

    return {
      packVoltage: totalVoltage.toFixed(2),
      packCurrent: (avgCurrent * nParallel).toFixed(1),
      packPower: (totalVoltage * avgCurrent * nParallel).toFixed(1),
      vMin: Math.min(...voltages).toFixed(3),
      vMax: Math.max(...voltages).toFixed(3),
      vSpread: ((Math.max(...voltages) - Math.min(...voltages)) * 1000).toFixed(1),
      tMin: Math.min(...temps).toFixed(1),
      tMax: Math.max(...temps).toFixed(1),
      tSpread: (Math.max(...temps) - Math.min(...temps)).toFixed(2),
      socMin: (Math.min(...socs) * 100).toFixed(1),
      socMax: (Math.max(...socs) * 100).toFixed(1),
      totalHeat: heats.reduce((a, b) => a + b, 0).toFixed(2),
      sohMin: Math.min(...sohs).toFixed(1),
      avgSoh: (sohs.reduce((a, b) => a + b, 0) / sohs.length).toFixed(1),
      isCharging: avgCurrent < 0,
    };
  }, [cells, nSeries, nParallel]);

  /* ── Not configured state ─── */
  if (!packConfigured) {
    return (
      <div className="flex-1 flex items-center justify-center bg-panel-bg p-8">
        <div className="text-center max-w-md">
          <div className="text-5xl mb-4">🔋</div>
          <h2 className="text-xl font-bold text-panel-text mb-2">No Pack Configured</h2>
          <p className="text-sm text-panel-muted mb-4">
            The Battery Management System monitors pack-level safety, cell balancing, and contactor state.
            Configure a multi-cell pack in the left panel to activate the BMS.
          </p>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="bg-panel-surface rounded-lg p-3 border border-panel-border">
              <div className="text-lg mb-1">⚡</div>
              <div className="text-[10px] text-panel-muted">Voltage &amp; current fault protection</div>
            </div>
            <div className="bg-panel-surface rounded-lg p-3 border border-panel-border">
              <div className="text-lg mb-1">🌡️</div>
              <div className="text-[10px] text-panel-muted">Thermal runaway detection</div>
            </div>
            <div className="bg-panel-surface rounded-lg p-3 border border-panel-border">
              <div className="text-lg mb-1">⚖️</div>
              <div className="text-[10px] text-panel-muted">Passive cell balancing</div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ── Waiting for data ─── */
  if (!bms || cells.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-panel-bg">
        <div className="text-panel-muted animate-pulse">Loading BMS data...</div>
      </div>
    );
  }

  const activeFaults = bms.active_faults ?? [];
  const faultHistory = bms.fault_history ?? [];

  // Voltage domain: show a window around the actual values with limits visible
  const allVoltages = cells.map((c) => c.voltage);
  const vDomainMin = Math.min(LIMITS.cellVMin, ...allVoltages) - 0.1;
  const vDomainMax = Math.max(LIMITS.cellVMax, ...allVoltages) + 0.1;

  // Temperature domain
  const allTemps = cells.map((c) => c.temp_c);
  const tDomainMin = Math.min(0, ...allTemps) - 2;
  const tDomainMax = Math.max(LIMITS.cellTempMax + 5, ...allTemps);

  return (
    <div className="flex-1 overflow-y-auto bg-panel-bg p-4 space-y-4">
      {/* ── Header ─────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-bold text-panel-text flex items-center gap-2">
            <span className="text-xl">🛡️</span>
            Battery Management System
          </h2>
          <p className="text-[11px] text-panel-muted">
            {nSeries}S{nParallel}P · {cells.length} cells · Real-time pack safety monitoring
          </p>
        </div>
        <div className={`px-3 py-1.5 rounded-lg text-xs font-bold ${
          activeFaults.length > 0 ? 'bg-red-500/20 text-red-400 animate-pulse' : 'bg-green-500/20 text-green-400'
        }`}>
          {activeFaults.length > 0 ? `${activeFaults.length} FAULT${activeFaults.length > 1 ? 'S' : ''}` : 'NOMINAL'}
        </div>
      </div>

      {/* ── Active Faults (prominent, top of page) ── */}
      <FaultAlerts faults={activeFaults} />

      {/* ── Pack Overview Cards ────────────────────── */}
      {packMetrics && (
        <div className="flex flex-wrap gap-3">
          <PackOverviewCard
            label="Pack Voltage"
            value={packMetrics.packVoltage}
            unit="V"
            color="#3b82f6"
            sub={`${packMetrics.vMin} – ${packMetrics.vMax} V · Δ${packMetrics.vSpread} mV`}
          />
          <PackOverviewCard
            label="Pack Current"
            value={packMetrics.packCurrent}
            unit="A"
            color={packMetrics.isCharging ? '#3b82f6' : '#ef4444'}
            sub={packMetrics.isCharging ? 'Charging' : 'Discharging'}
          />
          <PackOverviewCard
            label="Pack Power"
            value={Math.abs(parseFloat(packMetrics.packPower)).toFixed(0)}
            unit="W"
            color="#a855f7"
          />
          <PackOverviewCard
            label="Temp Range"
            value={`${packMetrics.tMin}–${packMetrics.tMax}`}
            unit="°C"
            color="#f97316"
            sub={`ΔT: ${packMetrics.tSpread}°C`}
          />
          <PackOverviewCard
            label="SOC Range"
            value={`${packMetrics.socMin}–${packMetrics.socMax}`}
            unit="%"
            color="#22c55e"
          />
          <PackOverviewCard
            label="Pack Heat"
            value={packMetrics.totalHeat}
            unit="W"
            color="#f97316"
          />
        </div>
      )}

      {/* ── Charts Row ─────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Per-cell Voltage */}
        <CellBarChart
          cells={cells}
          accessor={(c) => c.voltage}
          label="Cell Voltages"
          unit="V"
          color="#3b82f6"
          domain={[vDomainMin, vDomainMax]}
          limits={[
            { value: LIMITS.cellVMax, color: '#ef4444', label: 'OV Limit' },
            { value: LIMITS.cellVMin, color: '#eab308', label: 'UV Limit' },
          ]}
        />

        {/* Per-cell Temperature */}
        <CellBarChart
          cells={cells}
          accessor={(c) => c.temp_c}
          label="Cell Temperatures"
          unit="°C"
          color="#f97316"
          domain={[tDomainMin, tDomainMax]}
          limits={[
            { value: LIMITS.cellTempMax, color: '#f97316', label: 'Over-Temp' },
            { value: LIMITS.cellTempCritical, color: '#ef4444', label: 'Critical' },
          ]}
        />

        {/* Per-cell SOC */}
        <CellBarChart
          cells={cells}
          accessor={(c) => c.soc * 100}
          label="Cell SOC"
          unit="%"
          color="#22c55e"
          domain={[0, 100]}
        />

        {/* Per-cell SOH */}
        <CellBarChart
          cells={cells}
          accessor={(c) => c.soh_pct}
          label="Cell SOH"
          unit="%"
          color="#06b6d4"
          domain={[70, 100]}
        />
      </div>

      {/* ── Contactor + Balancing + Protection Row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ContactorDiagram closed={bms.contactor_closed} precharge={bms.precharge_active} />
        <BalancingPanel active={bms.balancing_active} balancingMap={bms.balancing_map ?? {}} />
        <ProtectionActions bms={bms} cells={cells} packMetrics={packMetrics} />
      </div>

      {/* ── Fault History ──────────────────────────── */}
      <FaultTimeline history={faultHistory} />

      {/* ── Safety Limits Reference ────────────────── */}
      <div className="bg-panel-surface rounded-xl p-4 border border-panel-border">
        <div className="text-xs font-semibold text-panel-text mb-2">BMS Safety Configuration</div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-[10px]">
          <div>
            <span className="text-panel-muted">Cell V max:</span>{' '}
            <span className="text-panel-text font-mono">{LIMITS.cellVMax} V</span>
          </div>
          <div>
            <span className="text-panel-muted">Cell V min:</span>{' '}
            <span className="text-panel-text font-mono">{LIMITS.cellVMin} V</span>
          </div>
          <div>
            <span className="text-panel-muted">Temp max:</span>{' '}
            <span className="text-panel-text font-mono">{LIMITS.cellTempMax}°C</span>
          </div>
          <div>
            <span className="text-panel-muted">Temp critical:</span>{' '}
            <span className="text-panel-text font-mono">{LIMITS.cellTempCritical}°C</span>
          </div>
          <div>
            <span className="text-panel-muted">Pack I max:</span>{' '}
            <span className="text-panel-text font-mono">{LIMITS.packCurrentMax} A</span>
          </div>
          <div>
            <span className="text-panel-muted">Imbalance:</span>{' '}
            <span className="text-panel-text font-mono">{LIMITS.imbalanceVThreshold * 1000} mV</span>
          </div>
          <div>
            <span className="text-panel-muted">Balancing bleed:</span>{' '}
            <span className="text-panel-text font-mono">50 mA</span>
          </div>
          <div>
            <span className="text-panel-muted">Pre-charge:</span>{' '}
            <span className="text-panel-text font-mono">2.0 s</span>
          </div>
        </div>
      </div>
    </div>
  );
}
