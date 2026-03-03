/**
 * BMS Dashboard — Full Battery Management System monitoring view
 *
 * Redesigned to:
 *   1. Fit within the viewport (grid layout, no endless scroll)
 *   2. Clear, purposeful animated contactor circuit diagram
 *   3. Live animations on every component — simulates real-life BMS
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useBatteryStore } from '../hooks/useBatteryState';
import { API_BASE } from '../config';

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

const LIMITS = {
  cellVMax: 4.25, cellVMin: 2.50,
  cellTempMax: 55, cellTempCritical: 75, cellTempMin: -20,
  packCurrentMax: 150, imbalanceVThreshold: 0.05,
};

const FAULT_META: Record<string, { color: string; icon: string; desc: string; severity: 'critical' | 'warn' | 'info' }> = {
  THERMAL_RUNAWAY: { color: '#ef4444', icon: '🔥', desc: 'Cell temp > 75°C — contactor opens', severity: 'critical' },
  OVER_TEMP:       { color: '#f97316', icon: '🌡️', desc: 'Cell temp above 55°C', severity: 'warn' },
  OVER_VOLTAGE:    { color: '#eab308', icon: '⚡', desc: 'Cell > 4.25V limit', severity: 'warn' },
  UNDER_VOLTAGE:   { color: '#eab308', icon: '🔋', desc: 'Cell < 2.50V limit', severity: 'warn' },
  OVER_CURRENT:    { color: '#f97316', icon: '⚠️', desc: 'Pack current > 150A', severity: 'warn' },
  CELL_IMBALANCE:  { color: '#3b82f6', icon: '⚖️', desc: 'Voltage spread > 50mV', severity: 'info' },
  UNDER_TEMP:      { color: '#06b6d4', icon: '❄️', desc: 'Cell temp below -20°C', severity: 'info' },
};

/* ── Global CSS for animations (injected once) ─────────────── */
const GLOBAL_CSS = `
@keyframes fadeSlideIn{ from{opacity:0;transform:translateY(-8px)} to{opacity:1;transform:translateY(0)} }
@keyframes shake { 0%,100%{transform:translateX(0)} 25%{transform:translateX(-2px)} 75%{transform:translateX(2px)} }
@keyframes glowPulse { 0%,100%{box-shadow:0 0 4px var(--glow)} 50%{box-shadow:0 0 16px var(--glow)} }
@keyframes bleedRing  { 0%{transform:scale(1);opacity:.7} 100%{transform:scale(1.4);opacity:0} }
@keyframes livePing   { 0%,100%{opacity:1} 50%{opacity:.3} }
@keyframes barGrow    { from{transform:scaleX(0)} to{transform:scaleX(1)} }
`;

/* ──────────────────────────────────────────────────────────── */
/*  Stat Card — compact overview metric with live color pulse  */
/* ──────────────────────────────────────────────────────────── */
function Stat({ label, value, unit, color, pulse, sub }: {
  label: string; value: string; unit: string; color: string; pulse?: boolean; sub?: string;
}) {
  return (
    <div
      className="rounded-lg p-2 border flex flex-col gap-0.5 min-w-0 overflow-hidden"
      style={{
        background: `${color}08`, borderColor: `${color}30`,
        animation: pulse ? 'glowPulse 2s ease-in-out infinite' : undefined,
        ['--glow' as any]: `${color}40`,
      }}
    >
      <span className="text-[9px] uppercase tracking-wider truncate" style={{ color: `${color}99` }}>{label}</span>
      <div className="flex items-baseline gap-1 min-w-0">
        <span className="text-lg font-bold tabular-nums truncate" style={{ color }}>{value}</span>
        <span className="text-[10px] shrink-0" style={{ color: `${color}80` }}>{unit}</span>
      </div>
      {sub && <span className="text-[9px] truncate" style={{ color: `${color}70` }}>{sub}</span>}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────── */
/*  Compact Cell Bars — animated horizontal bars + limits      */
/* ──────────────────────────────────────────────────────────── */
function CellBars({ cells, get, label, unit, color, domain, limits }: {
  cells: CellInfo[];
  get: (c: CellInfo) => number;
  label: string; unit: string; color: string;
  domain: [number, number];
  limits?: { at: number; color: string; tag: string }[];
}) {
  const [min, max] = domain;
  const span = max - min;
  return (
    <div className="rounded-lg border border-panel-border bg-panel-surface p-2.5 flex flex-col min-h-0 overflow-hidden">
      <div className="text-[10px] font-semibold text-panel-text mb-1.5 flex justify-between items-center shrink-0">
        {label}
        {limits && (
          <span className="flex gap-2">
            {limits.map(l => (
              <span key={l.tag} className="flex items-center gap-0.5 text-[8px]" style={{ color: l.color }}>
                <span className="w-1.5 h-1.5 rounded-sm" style={{ background: l.color }} />{l.tag} {l.at}{unit}
              </span>
            ))}
          </span>
        )}
      </div>
      <div className="flex-1 space-y-[3px] min-h-0 overflow-y-auto" style={{ maxHeight: Math.min(cells.length * 18, 160) }}>
        {cells.map(cell => {
          const v = get(cell);
          const pct = Math.max(0, Math.min(100, ((v - min) / span) * 100));
          const isWarn = limits?.some(l => (l.tag.includes('Max') || l.tag.includes('OV') || l.tag.includes('Over') || l.tag.includes('Crit')) ? v > l.at : v < l.at);
          return (
            <div key={cell.cell_id} className="flex items-center gap-1.5">
              <span className="text-[8px] text-panel-muted w-7 text-right font-mono shrink-0">
                {cell.cell_id.replace('S', '').replace('_C', '.')}
              </span>
              <div className="flex-1 h-3.5 bg-panel-bg rounded-sm relative overflow-hidden">
                {limits?.map(l => {
                  const lp = ((l.at - min) / span) * 100;
                  if (lp < 0 || lp > 100) return null;
                  return <div key={l.tag} className="absolute top-0 bottom-0 w-px z-10" style={{ left: `${lp}%`, background: l.color }} />;
                })}
                <div
                  className="h-full rounded-sm transition-all duration-500"
                  style={{
                    width: `${pct}%`,
                    background: isWarn ? '#ef4444' : color,
                    opacity: .85,
                    transformOrigin: 'left',
                    animation: 'barGrow .6s ease-out',
                  }}
                />
              </div>
              <span className="text-[9px] font-mono tabular-nums w-12 text-right" style={{ color: isWarn ? '#ef4444' : color }}>
                {v.toFixed(unit === 'V' ? 3 : 1)}{unit}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────── */
/*  SVG Circuit Contactor — the centerpiece, fully animated    */
/*                                                              */
/*  Shows: Battery → Fuse → Junction → Pre-charge path (K2 +  */
/*  resistor) → Main contactor K1 → Current sensor → Load     */
/*  with return path.  Animated electron dots flow when the     */
/*  circuit is closed.  Clear labels explain every component.   */
/* ──────────────────────────────────────────────────────────── */
function CircuitContactor({ closed, precharge, current, voltage, isCharging }: {
  closed: boolean; precharge: boolean; current: number; voltage: number; isCharging: boolean;
}) {
  const tick = useRef(0);
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    const id = setInterval(() => { tick.current++; setFrame(tick.current); }, 60);
    return () => clearInterval(id);
  }, []);

  // Electron dots positions along the main circuit loop
  const mainDots = useMemo(() => {
    if (!closed) return [];
    return Array.from({ length: 8 }, (_, i) => ((frame * 2 + i * 12.5) % 100));
  }, [closed, frame]);

  // Pre-charge path electron dots (slower)
  const preDots = useMemo(() => {
    if (!precharge) return [];
    return Array.from({ length: 4 }, (_, i) => ((frame * 0.8 + i * 25) % 100));
  }, [precharge, frame]);

  const state = closed ? 'CLOSED' : precharge ? 'PRE-CHARGE' : 'OPEN';
  const stateColor = closed ? '#22c55e' : precharge ? '#eab308' : '#ef4444';

  return (
    <div className="rounded-lg border border-panel-border bg-panel-surface p-3 flex flex-col">
      <div className="text-[10px] font-semibold text-panel-text mb-1 flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          <span className="text-sm">⚡</span> Pack Contactor Circuit
        </span>
        <span
          className="px-2 py-0.5 rounded text-[9px] font-bold flex items-center gap-1"
          style={{ background: `${stateColor}20`, color: stateColor }}
        >
          <span className="w-1.5 h-1.5 rounded-full" style={{
            background: stateColor,
            animation: (closed || precharge) ? 'livePing 1s ease infinite' : undefined
          }} />
          {state}
        </span>
      </div>

      {/* Purpose explanation — always visible so user knows what this is */}
      <div className="text-[9px] text-panel-muted mb-2 leading-relaxed">
        {closed
          ? '✅ Main contactor K1 engaged — high-voltage bus is live, current flowing between battery pack and load. The BMS continuously monitors for faults and will open the contactor if any safety limit is exceeded.'
          : precharge
          ? '⏳ Pre-charge relay K2 engaged — slowly charging load-side capacitors through a 50Ω resistor to prevent dangerous inrush current. Main contactor K1 will close once voltage equalizes (~2 seconds).'
          : '🔒 Pack is disconnected — no current path exists between battery and external circuit. The BMS will close the contactor when simulation starts and all safety checks pass.'}
      </div>

      {/* SVG Circuit Diagram */}
      <svg viewBox="0 0 420 190" className="w-full" preserveAspectRatio="xMidYMid meet" style={{ maxHeight: 160, minHeight: 100 }}>
        <defs>
          <pattern id="bmsGrid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#334155" strokeWidth="0.3" />
          </pattern>
          <filter id="electronGlow">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <rect width="420" height="190" fill="url(#bmsGrid)" rx="8" opacity=".3" />

        {/* ── Battery Pack (left) ── */}
        <g transform="translate(15,58)">
          <rect x="0" y="0" width="55" height="64" rx="7" fill="#0f172a" stroke={closed ? '#3b82f6' : '#334155'} strokeWidth="1.5" />
          {/* Battery fill level based on SOC proxy (voltage) */}
          <rect x="4" y={4 + 56 * (1 - Math.min(1, voltage / 17))}
                width="47" height={56 * Math.min(1, voltage / 17)}
                rx="4" fill={closed ? '#3b82f620' : '#33415520'}>
            {closed && <animate attributeName="opacity" values=".3;.6;.3" dur="2s" repeatCount="indefinite" />}
          </rect>
          <text x="27.5" y="22" textAnchor="middle" fill="#94a3b8" fontSize="8" fontWeight="600">BATTERY</text>
          <text x="27.5" y="33" textAnchor="middle" fill="#94a3b8" fontSize="7">PACK</text>
          <text x="27.5" y="47" textAnchor="middle" fill={stateColor} fontSize="10" fontWeight="700">{voltage.toFixed(1)}V</text>
          <text x="27.5" y="58" textAnchor="middle" fill="#94a3b8" fontSize="7">{Math.abs(current).toFixed(1)}A</text>
          {/* Positive terminal */}
          <rect x="14" y="-7" width="11" height="9" rx="2" fill="#ef4444" opacity=".85" />
          <text x="19.5" y="0" textAnchor="middle" fill="white" fontSize="8" fontWeight="700">+</text>
          {/* Negative terminal */}
          <rect x="30" y="-7" width="11" height="9" rx="2" fill="#3b82f6" opacity=".85" />
          <text x="35.5" y="0" textAnchor="middle" fill="white" fontSize="8" fontWeight="700">−</text>
        </g>

        {/* ── Wire: Battery+ → Fuse ── */}
        <line x1="70" y1="90" x2="98" y2="90" stroke={closed || precharge ? '#22c55e' : '#475569'} strokeWidth="2" />

        {/* ── Fuse ── */}
        <g transform="translate(98,82)">
          <rect x="0" y="0" width="32" height="16" rx="3" fill="#0f172a" stroke="#94a3b8" strokeWidth="1" />
          <line x1="7" y1="8" x2="25" y2="8" stroke="#94a3b8" strokeWidth="1.5" strokeDasharray="3,2" />
          <text x="16" y="28" textAnchor="middle" fill="#64748b" fontSize="6.5">FUSE</text>
          <text x="16" y="36" textAnchor="middle" fill="#475569" fontSize="5">150A</text>
        </g>

        {/* ── Wire: Fuse → Junction ── */}
        <line x1="130" y1="90" x2="160" y2="90" stroke={closed || precharge ? '#22c55e' : '#475569'} strokeWidth="2" />

        {/* ── Junction dot ── */}
        <circle cx="160" cy="90" r="3" fill={closed || precharge ? '#22c55e' : '#475569'} />

        {/* ══ PRE-CHARGE PATH (top bypass) ══ */}
        {/* Junction → up */}
        <line x1="160" y1="90" x2="160" y2="35" stroke={precharge ? '#eab308' : '#33415540'} strokeWidth={precharge ? 1.5 : 1} strokeDasharray={precharge ? '' : '3,3'} />
        {/* Left horizontal to K2 */}
        <line x1="160" y1="35" x2="180" y2="35" stroke={precharge ? '#eab308' : '#33415540'} strokeWidth={precharge ? 1.5 : 1} />
        {/* Pre-charge relay K2 */}
        <g transform="translate(180,22)">
          <rect x="0" y="0" width="38" height="26" rx="4"
                fill={precharge ? '#eab30812' : '#0f172a'}
                stroke={precharge ? '#eab308' : '#334155'}
                strokeWidth={precharge ? 1.5 : 0.8} />
          <text x="19" y="11" textAnchor="middle" fill={precharge ? '#eab308' : '#475569'} fontSize="9" fontWeight="700">K2</text>
          <text x="19" y="21" textAnchor="middle" fill={precharge ? '#eab308' : '#475569'} fontSize="6">
            {precharge ? 'CLOSED' : 'OPEN'}
          </text>
          {precharge && (
            <rect x="-2" y="-2" width="42" height="30" rx="5" fill="none" stroke="#eab30850" strokeWidth="1.5">
              <animate attributeName="opacity" values="1;.4;1" dur="1s" repeatCount="indefinite" />
            </rect>
          )}
        </g>
        {/* K2 → Resistor */}
        <line x1="218" y1="35" x2="240" y2="35" stroke={precharge ? '#eab308' : '#33415540'} strokeWidth={precharge ? 1.5 : 1} />
        {/* Pre-charge resistor (zigzag) */}
        <g transform="translate(240,27)">
          <polyline points="0,8 5,0 10,16 15,0 20,16 25,0 30,8" fill="none"
                    stroke={precharge ? '#eab308' : '#475569'} strokeWidth="1.2" />
          <text x="15" y="28" textAnchor="middle" fill="#64748b" fontSize="6">50Ω</text>
        </g>
        {/* Resistor → right junction */}
        <line x1="270" y1="35" x2="290" y2="35" stroke={precharge ? '#eab308' : '#33415540'} strokeWidth={precharge ? 1.5 : 1} />
        {/* Down from pre-charge path to main wire */}
        <line x1="290" y1="35" x2="290" y2="90" stroke={precharge ? '#eab308' : '#33415540'} strokeWidth={precharge ? 1.5 : 1} />

        {/* Pre-charge label */}
        <text x="235" y="18" textAnchor="middle" fill={precharge ? '#eab30890' : '#33415560'} fontSize="5.5" fontStyle="italic">
          PRE-CHARGE PATH
        </text>

        {/* Pre-charge electron dots */}
        {preDots.map((pos, i) => {
          const p = pos / 100;
          let cx: number, cy: number;
          if (p < 0.2) {
            cx = 160; cy = 90 - p / 0.2 * 55;
          } else if (p < 0.75) {
            cx = 160 + (p - 0.2) / 0.55 * 130; cy = 35;
          } else {
            cx = 290; cy = 35 + (p - 0.75) / 0.25 * 55;
          }
          return <circle key={`pre-${i}`} cx={cx} cy={cy} r="2.5" fill="#eab308" opacity=".9" filter="url(#electronGlow)" />;
        })}

        {/* ══ MAIN CONTACTOR K1 (on the main wire) ══ */}
        <g transform="translate(190,72)">
          <rect x="0" y="0" width="54" height="36" rx="6"
                fill={closed ? '#22c55e08' : '#0f172a'}
                stroke={closed ? '#22c55e' : precharge ? '#eab308' : '#ef4444'}
                strokeWidth="2" />
          <text x="27" y="16" textAnchor="middle" fill={closed ? '#22c55e' : '#94a3b8'} fontSize="13" fontWeight="800">K1</text>
          <text x="27" y="29" textAnchor="middle" fill={closed ? '#22c55e' : precharge ? '#eab308' : '#ef4444'} fontSize="7" fontWeight="600">
            {closed ? '● CLOSED' : precharge ? '◐ PRE' : '○ OPEN'}
          </text>
          {/* Glow ring when closed */}
          {closed && (
            <rect x="-3" y="-3" width="60" height="42" rx="8" fill="none" stroke="#22c55e40" strokeWidth="2">
              <animate attributeName="opacity" values="1;.3;1" dur="2s" repeatCount="indefinite" />
            </rect>
          )}
        </g>
        {/* Label */}
        <text x="217" y="118" textAnchor="middle" fill={closed ? '#22c55e80' : '#47556980'} fontSize="5.5">
          MAIN CONTACTOR
        </text>

        {/* Wire: Junction → K1 */}
        <line x1="160" y1="90" x2="190" y2="90" stroke={closed || precharge ? '#22c55e' : '#475569'} strokeWidth="2" />
        {/* Wire: K1 → junction out */}
        <line x1="244" y1="90" x2="290" y2="90" stroke={closed ? '#22c55e' : '#475569'} strokeWidth="2" />

        {/* ── Junction dot (right) ── */}
        <circle cx="290" cy="90" r="3" fill={closed ? '#22c55e' : '#475569'} />

        {/* ── Current Sensor ── */}
        <g transform="translate(300,80)">
          <circle cx="10" cy="10" r="10" fill="#0f172a" stroke="#a855f7" strokeWidth="1.2" />
          <text x="10" y="13" textAnchor="middle" fill="#a855f7" fontSize="9" fontWeight="700">A</text>
          <text x="10" y="30" textAnchor="middle" fill="#64748b" fontSize="5.5">SENSOR</text>
        </g>
        <line x1="290" y1="90" x2="290" y2="90" stroke={closed ? '#22c55e' : '#475569'} strokeWidth="2" />
        <line x1="320" y1="90" x2="340" y2="90" stroke={closed ? '#22c55e' : '#475569'} strokeWidth="2" />

        {/* ── Load (right) ── */}
        <g transform="translate(340,64)">
          <rect x="0" y="0" width="60" height="52" rx="7" fill="#0f172a" stroke={closed ? '#3b82f6' : '#334155'} strokeWidth="1.5" />
          <text x="30" y="18" textAnchor="middle" fill={closed ? '#3b82f6' : '#475569'} fontSize="9" fontWeight="600">LOAD</text>
          <text x="30" y="30" textAnchor="middle" fill={closed ? '#3b82f6' : '#475569'} fontSize="8" fontWeight="700">
            {closed ? `${Math.abs(voltage * current).toFixed(0)}W` : 'OFF'}
          </text>
          <text x="30" y="43" textAnchor="middle" fill="#475569" fontSize="6">
            {closed ? (isCharging ? 'CHARGER' : 'INVERTER') : 'STANDBY'}
          </text>
          {closed && (
            <rect x="-2" y="-2" width="64" height="56" rx="8" fill="none" stroke="#3b82f630" strokeWidth="1.5">
              <animate attributeName="opacity" values="1;.3;1" dur="2s" repeatCount="indefinite" />
            </rect>
          )}
        </g>

        {/* ── Return path (bottom wire) ── */}
        <line x1="400" y1="116" x2="400" y2="160" stroke={closed ? '#3b82f6' : '#33415540'} strokeWidth="2" />
        <line x1="400" y1="160" x2="42" y2="160" stroke={closed ? '#3b82f6' : '#33415540'} strokeWidth="2" />
        <line x1="42" y1="160" x2="42" y2="122" stroke={closed ? '#3b82f6' : '#33415540'} strokeWidth="2" />
        <text x="220" y="172" textAnchor="middle" fill="#475569" fontSize="6">RETURN PATH (−)</text>

        {/* ── Main flow electron dots ── */}
        {mainDots.map((pos, i) => {
          const p = pos / 100;
          let cx: number, cy: number;
          if (p < 0.48) {
            // Top wire: left to right (battery → load)
            cx = 70 + p / 0.48 * 270;
            cy = 90;
          } else if (p < 0.58) {
            // Down from load to bottom wire
            cx = 400;
            cy = 116 + (p - 0.48) / 0.1 * 44;
          } else if (p < 0.88) {
            // Bottom wire: right to left (return)
            cx = 400 - (p - 0.58) / 0.3 * 358;
            cy = 160;
          } else {
            // Up from bottom to battery−
            cx = 42;
            cy = 160 - (p - 0.88) / 0.12 * 38;
          }
          return (
            <circle key={`main-${i}`}
              cx={Math.min(405, Math.max(20, cx))} cy={cy}
              r="3" opacity=".85" filter="url(#electronGlow)"
              fill={isCharging ? '#3b82f6' : '#22c55e'} />
          );
        })}

        {/* Direction arrows when closed */}
        {closed && (
          <>
            <polygon points="148,86 158,90 148,94" fill="#22c55e" opacity=".5" />
            <polygon points="268,86 278,90 268,94" fill="#22c55e" opacity=".5" />
            <polygon points="220,164 210,160 220,156" fill="#3b82f6" opacity=".5" />
            <polygon points="80,164 70,160 80,156" fill="#3b82f6" opacity=".5" />
          </>
        )}

        {/* ── Legend ── */}
        <text x="10" y="185" fill="#334155" fontSize="5.5">
          BATTERY MANAGEMENT SYSTEM — CONTACTOR CIRCUIT DIAGRAM
        </text>
      </svg>

      {/* Status bar below circuit */}
      <div className="flex items-center gap-3 mt-1 text-[9px] flex-wrap">
        <span className="flex items-center gap-1" style={{ color: stateColor }}>
          <span className="w-1.5 h-1.5 rounded-full" style={{ background: stateColor, animation: 'livePing 1s infinite' }} />
          K1: {closed ? 'CLOSED' : 'OPEN'}
        </span>
        <span className="flex items-center gap-1" style={{ color: precharge ? '#eab308' : '#475569' }}>
          K2: {precharge ? 'PRE-CHARGE' : 'OPEN'}
        </span>
        <span className="flex items-center gap-1 text-panel-muted">
          Fuse: {LIMITS.packCurrentMax}A
        </span>
        <span className="text-panel-muted ml-auto">
          {closed ? `${isCharging ? '← Charging' : '→ Discharging'} @ ${Math.abs(current).toFixed(1)}A · ${Math.abs(voltage * current).toFixed(0)}W`
            : precharge ? 'Inrush protection — capacitor pre-charge in progress'
            : 'Circuit open — no current path'}
        </span>
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────── */
/*  Fault Alert Bar — compact, animated severity indicators    */
/* ──────────────────────────────────────────────────────────── */
function FaultBar({ faults }: { faults: string[] }) {
  if (faults.length === 0) {
    return (
      <div className="rounded-lg border border-green-500/30 bg-green-500/5 px-3 py-2 flex items-center gap-2">
        <svg className="w-4 h-4 text-green-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
        </svg>
        <span className="text-[11px] text-green-400 font-semibold">All Systems Normal</span>
        <span className="ml-auto flex items-center gap-1">
          <span className="w-1.5 h-1.5 bg-green-400 rounded-full" style={{ animation: 'livePing 1.5s infinite' }} />
          <span className="text-[9px] text-green-400/70">LIVE</span>
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-1.5">
      {faults.map((fault, i) => {
        const meta = FAULT_META[fault] ?? { color: '#94a3b8', icon: '⚠️', desc: 'Unknown', severity: 'info' as const };
        const isCrit = meta.severity === 'critical';
        return (
          <div
            key={fault}
            className="rounded-lg border px-3 py-2 flex items-center gap-2"
            style={{
              background: `${meta.color}10`, borderColor: `${meta.color}40`,
              animation: isCrit ? 'shake .4s ease-in-out infinite' : `fadeSlideIn .3s ease-out ${i * 80}ms both`,
            }}
          >
            <span className="text-base shrink-0 relative">
              {meta.icon}
              {isCrit && <span className="absolute -top-1 -right-1 w-2 h-2 bg-red-500 rounded-full animate-ping" />}
            </span>
            <div className="flex-1 min-w-0">
              <span className="text-[11px] font-bold" style={{ color: meta.color }}>
                {fault.replace(/_/g, ' ')}
              </span>
              <span className="text-[9px] text-panel-muted ml-2">{meta.desc}</span>
            </div>
            <span className="text-[8px] font-bold px-1.5 py-0.5 rounded" style={{
              background: `${meta.color}25`, color: meta.color
            }}>
              {isCrit ? 'CRITICAL' : 'WARNING'}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────── */
/*  Balancing Grid — compact animated cell bleeding display    */
/* ──────────────────────────────────────────────────────────── */
function BalancingGrid({ active, map }: { active: boolean; map: Record<string, boolean> }) {
  const entries = Object.entries(map);
  const bleeding = entries.filter(([, v]) => v);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick(t => (t + 1) % 60), 500);
    return () => clearInterval(id);
  }, [active]);

  return (
    <div className="rounded-lg border border-panel-border bg-panel-surface p-2.5 flex flex-col">
      <div className="text-[10px] font-semibold text-panel-text mb-1 flex items-center justify-between">
        <span>⚖️ Passive Cell Balancing</span>
        <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-1 ${
          active ? 'bg-blue-500/20 text-blue-400' : 'bg-panel-bg text-panel-muted'
        }`}>
          {active && <span className="w-1.5 h-1.5 bg-blue-400 rounded-full" style={{ animation: 'livePing 1s infinite' }} />}
          {active ? `ACTIVE — ${bleeding.length}/${entries.length}` : 'IDLE'}
        </span>
      </div>

      <div className="text-[9px] text-panel-muted mb-2 leading-relaxed">
        {active
          ? 'Bleed resistors are draining energy from high-SOC cells to equalize voltage across the pack. Blue cells are actively being balanced.'
          : 'All cell voltages are within 50mV of each other — no balancing needed. BMS checks every cycle.'}
      </div>

      <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5 flex-1">
        {entries.map(([id, bleed], idx) => (
          <div
            key={id}
            className="relative rounded h-9 flex flex-col items-center justify-center transition-all duration-300"
            style={{
              background: bleed ? '#3b82f618' : '#0f172a',
              border: `1px solid ${bleed ? '#3b82f650' : '#334155'}`,
              boxShadow: bleed ? '0 0 8px #3b82f620' : undefined,
            }}
          >
            <span className="text-[8px] font-mono" style={{ color: bleed ? '#60a5fa' : '#64748b' }}>
              {id.replace('S', '').replace('_C', '.')}
            </span>
            {bleed && (
              <>
                <span className="text-[6px] text-blue-300/80 leading-none mt-px">
                  {tick % 2 === 0 ? '↓' : '↕'}50mA
                </span>
                <div
                  className="absolute inset-0 rounded border border-blue-400/40"
                  style={{ animation: `bleedRing 1.2s ease-out infinite ${(idx * 200) % 1200}ms` }}
                />
              </>
            )}
          </div>
        ))}
      </div>

      {active && bleeding.length > 0 && (
        <div className="flex items-center gap-2 mt-2">
          <div className="flex-1 h-1 bg-panel-bg rounded-full overflow-hidden">
            <div className="h-full bg-blue-400 rounded-full transition-all duration-700"
                 style={{ width: `${(bleeding.length / Math.max(entries.length, 1)) * 100}%` }} />
          </div>
          <span className="text-[9px] text-blue-400 font-mono">{bleeding.length}/{entries.length}</span>
        </div>
      )}
    </div>
  );
}

/* ──────────────────────────────────────────────────────────── */
/*  Protection Status — live description of BMS actions        */
/* ──────────────────────────────────────────────────────────── */
function ProtectionStatus({ bms, cells, packMetrics }: { bms: any; cells: CellInfo[]; packMetrics: any }) {
  const items: { icon: string; text: string; color: string; live: boolean }[] = [];

  if (bms.contactor_closed) {
    items.push({ icon: '🔌', text: `Contactor K1 closed — HV bus active, ${packMetrics?.isCharging ? 'charging' : 'discharging'} @ ${Math.abs(packMetrics?.packCurrent ?? 0).toFixed(1)}A`, color: '#22c55e', live: true });
  } else if (bms.precharge_active) {
    items.push({ icon: '⚡', text: 'Pre-charge active (K2 ON) — limiting inrush through 50Ω resistor before closing K1', color: '#eab308', live: true });
  } else {
    items.push({ icon: '🛑', text: 'Contactor open — pack isolated, no current path to load', color: '#ef4444', live: false });
  }

  if (bms.balancing_active) {
    const n = Object.values(bms.balancing_map ?? {}).filter(Boolean).length;
    items.push({ icon: '⚖️', text: `Balancing ${n} cells via passive bleed @ 50mA each — Δ${packMetrics?.vSpread ?? '?'}mV spread`, color: '#3b82f6', live: true });
  }

  const hotCells = cells.filter(c => c.temp_c > LIMITS.cellTempMax);
  const highV = cells.filter(c => c.voltage > LIMITS.cellVMax);
  const lowV = cells.filter(c => c.voltage < LIMITS.cellVMin);
  if (hotCells.length) items.push({ icon: '🌡️', text: `Over-temp: ${hotCells.map(c => `${c.cell_id.replace('S','').replace('_C','.')} (${c.temp_c.toFixed(1)}°C)`).join(', ')}`, color: '#f97316', live: true });
  if (highV.length) items.push({ icon: '⬆️', text: `Over-voltage: ${highV.map(c => c.cell_id.replace('S','').replace('_C','.')).join(', ')} > ${LIMITS.cellVMax}V`, color: '#eab308', live: true });
  if (lowV.length) items.push({ icon: '⬇️', text: `Under-voltage: ${lowV.map(c => c.cell_id.replace('S','').replace('_C','.')).join(', ')} < ${LIMITS.cellVMin}V`, color: '#eab308', live: true });

  if ((bms.active_faults ?? []).length === 0 && !bms.balancing_active) {
    items.push({ icon: '🔍', text: 'Monitoring all cells — voltage, temperature, current within safe limits. BMS checks every simulation cycle.', color: '#22c55e', live: true });
  }

  return (
    <div className="rounded-lg border border-panel-border bg-panel-surface p-2.5 flex flex-col">
      <div className="text-[10px] font-semibold text-panel-text mb-1.5 flex items-center gap-1.5">
        🛡️ BMS Actions
        <span className="ml-auto text-[8px] text-panel-muted bg-panel-bg px-1.5 py-0.5 rounded">{items.length} active</span>
      </div>
      <div className="space-y-1.5 flex-1 overflow-y-auto">
        {items.map((item, i) => (
          <div key={i} className="flex items-start gap-1.5 rounded px-2 py-1.5 border border-panel-border/40 bg-panel-bg"
               style={{ animation: `fadeSlideIn .3s ease-out ${i * 60}ms both` }}>
            <span className="text-sm shrink-0">{item.icon}</span>
            <span className="text-[10px] flex-1 leading-relaxed" style={{ color: item.color }}>{item.text}</span>
            {item.live && <span className="w-1.5 h-1.5 rounded-full shrink-0 mt-1" style={{ background: item.color, animation: 'livePing 2s infinite' }} />}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────── */
/*  Fault Timeline — compact scrollable list                    */
/* ──────────────────────────────────────────────────────────── */
function FaultLog({ history }: { history: { fault: string; time_s: number; cleared: boolean }[] }) {
  const recent = history.slice(-12).reverse();
  if (recent.length === 0) return null;

  return (
    <div className="rounded-lg border border-panel-border bg-panel-surface p-2.5 flex flex-col">
      <div className="text-[10px] font-semibold text-panel-text mb-1.5">📋 Fault History</div>
      <div className="flex-1 space-y-1 overflow-y-auto max-h-28">
        {recent.map((e, i) => {
          const m = FAULT_META[e.fault] ?? { color: '#94a3b8', icon: '?' };
          return (
            <div key={`${e.fault}-${e.time_s}-${i}`} className="flex items-center gap-1.5 text-[10px]"
                 style={{ animation: `fadeSlideIn .2s ease-out ${i * 30}ms both` }}>
              <span className="text-xs">{m.icon}</span>
              <span className={e.cleared ? 'text-panel-muted line-through flex-1' : 'flex-1'} style={{ color: e.cleared ? undefined : m.color }}>
                {e.fault.replace(/_/g, ' ')}
              </span>
              <span className="text-panel-muted font-mono text-[9px]">
                {e.time_s < 60 ? `${e.time_s.toFixed(0)}s` : `${(e.time_s / 60).toFixed(1)}m`}
              </span>
              {e.cleared
                ? <span className="text-green-500 text-[8px] font-bold">✓</span>
                : <span className="w-1.5 h-1.5 rounded-full" style={{ background: m.color, animation: 'livePing 1.5s infinite' }} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────── */
/*  Safety Limits — collapsible reference                       */
/* ──────────────────────────────────────────────────────────── */
function SafetyRef() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-panel-border bg-panel-surface">
      <button onClick={() => setOpen(!open)} className="w-full text-left px-3 py-2 flex items-center gap-2 text-[10px] text-panel-muted hover:text-panel-text transition-colors">
        <span className={`transition-transform duration-200 ${open ? 'rotate-90' : ''}`}>▶</span>
        BMS Safety Configuration Reference
      </button>
      {open && (
        <div className="px-3 pb-2 grid grid-cols-2 md:grid-cols-4 gap-2 text-[9px] border-t border-panel-border/50 pt-2"
             style={{ animation: 'fadeSlideIn .2s ease-out' }}>
          {[
            ['Cell V max', `${LIMITS.cellVMax} V`], ['Cell V min', `${LIMITS.cellVMin} V`],
            ['Temp max', `${LIMITS.cellTempMax}°C`], ['Temp critical', `${LIMITS.cellTempCritical}°C`],
            ['Pack I max', `${LIMITS.packCurrentMax} A`], ['Imbalance', `${LIMITS.imbalanceVThreshold * 1000} mV`],
            ['Bleed rate', '50 mA'], ['Pre-charge', '2.0 s'],
          ].map(([k, v]) => (
            <div key={k}><span className="text-panel-muted">{k}: </span><span className="text-panel-text font-mono">{v}</span></div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   MAIN DASHBOARD
   ══════════════════════════════════════════════════════════════ */
export default function BMSDashboard() {
  const bms = useBatteryStore(s => s.bmsStatus);
  const packConfigured = useBatteryStore(s => s.packConfigured);
  const [cells, setCells] = useState<CellInfo[]>([]);
  const [nSeries, setNSeries] = useState(0);
  const [nParallel, setNParallel] = useState(0);

  const fetchCells = useCallback(async () => {
    try {
      const r = await fetch(`${API_BASE}/pack/status`);
      if (!r.ok) return;
      const j = await r.json();
      if (j.status === 'ok') { setCells(j.cells ?? []); setNSeries(j.n_series ?? 0); setNParallel(j.n_parallel ?? 0); }
    } catch { /* */ }
  }, []);

  useEffect(() => {
    if (!packConfigured) return;
    fetchCells();
    const id = setInterval(fetchCells, 1000);
    return () => clearInterval(id);
  }, [packConfigured, fetchCells]);

  const pm = useMemo(() => {
    if (cells.length === 0) return null;
    const vs = cells.map(c => c.voltage);
    const ts = cells.map(c => c.temp_c);
    const cur = cells[0]?.current ?? 0;
    const totalV = nSeries > 0 ? vs.reduce((a, b) => a + b, 0) / nParallel : 0;
    return {
      packVoltage: totalV, packCurrent: cur * nParallel, isCharging: cur < 0,
      vMin: Math.min(...vs), vMax: Math.max(...vs), vSpread: ((Math.max(...vs) - Math.min(...vs)) * 1000).toFixed(1),
      tMin: Math.min(...ts), tMax: Math.max(...ts), tSpread: (Math.max(...ts) - Math.min(...ts)).toFixed(2),
      socMin: (Math.min(...cells.map(c => c.soc)) * 100).toFixed(1),
      socMax: (Math.max(...cells.map(c => c.soc)) * 100).toFixed(1),
      totalHeat: cells.map(c => c.heat_w).reduce((a, b) => a + b, 0),
      avgSoh: (cells.map(c => c.soh_pct).reduce((a, b) => a + b, 0) / cells.length).toFixed(1),
    };
  }, [cells, nSeries, nParallel]);

  /* ── Not configured ── */
  if (!packConfigured) {
    return (
      <div className="flex-1 flex items-center justify-center bg-panel-bg p-6">
        <div className="text-center max-w-sm">
          <div className="text-5xl mb-3">🔋</div>
          <h2 className="text-lg font-bold text-panel-text mb-2">No Pack Configured</h2>
          <p className="text-sm text-panel-muted mb-4">
            Configure a multi-cell pack in the left panel to activate BMS monitoring.
          </p>
          <div className="grid grid-cols-3 gap-2 text-center text-[10px]">
            {[['⚡', 'Voltage & current fault protection'], ['🌡️', 'Thermal runaway detection'], ['⚖️', 'Passive cell balancing']].map(([ic, t]) => (
              <div key={t} className="bg-panel-surface rounded-lg p-2 border border-panel-border">
                <div className="text-lg mb-1">{ic}</div>
                <div className="text-panel-muted">{t}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  /* ── Loading ── */
  if (!bms || cells.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center bg-panel-bg">
        <div className="text-panel-muted animate-pulse text-sm">Loading BMS data...</div>
      </div>
    );
  }

  const faults = bms.active_faults ?? [];
  const history = bms.fault_history ?? [];
  const allV = cells.map(c => c.voltage);
  const allT = cells.map(c => c.temp_c);
  const vDom: [number, number] = [Math.min(LIMITS.cellVMin, ...allV) - 0.1, Math.max(LIMITS.cellVMax, ...allV) + 0.1];
  const tDom: [number, number] = [Math.min(0, ...allT) - 2, Math.max(LIMITS.cellTempMax + 5, ...allT)];

  return (
    <div className="flex-1 flex flex-col bg-panel-bg overflow-hidden min-h-0">
      <style>{GLOBAL_CSS}</style>

      {/* ── Sticky Header + Fault Bar ── */}
      <div className="shrink-0 px-3 pt-2 pb-1.5 space-y-1.5 border-b border-panel-border/30">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-bold text-panel-text flex items-center gap-2">
              🛡️ Battery Management System
            </h2>
            <p className="text-[10px] text-panel-muted">
              {nSeries}S{nParallel}P · {cells.length} cells · Live pack safety monitoring
            </p>
          </div>
          <div className={`px-3 py-1 rounded-lg text-xs font-bold flex items-center gap-1.5 ${
            faults.length > 0 ? 'bg-red-500/20 text-red-400' : 'bg-green-500/15 text-green-400'
          }`}>
            <span className="w-2 h-2 rounded-full" style={{
              background: faults.length > 0 ? '#ef4444' : '#22c55e',
              animation: 'livePing 1.5s infinite',
            }} />
            {faults.length > 0 ? `${faults.length} FAULT${faults.length > 1 ? 'S' : ''}` : 'NOMINAL'}
          </div>
        </div>
        <FaultBar faults={faults} />
      </div>

      {/* ── Scrollable content area ── */}
      <div className="flex-1 overflow-y-auto min-h-0 p-2.5 space-y-2">

        {/* Row 1: Pack overview stats */}
        {pm && (
          <div className="grid grid-cols-3 lg:grid-cols-6 gap-1.5">
            <Stat label="Pack Voltage" value={pm.packVoltage.toFixed(1)} unit="V" color="#3b82f6"
                  sub={`${pm.vMin.toFixed(2)}–${pm.vMax.toFixed(2)}V`}
                  pulse={faults.includes('OVER_VOLTAGE') || faults.includes('UNDER_VOLTAGE')} />
            <Stat label="Current" value={Math.abs(pm.packCurrent).toFixed(1)} unit="A"
                  color={pm.isCharging ? '#3b82f6' : '#ef4444'} sub={pm.isCharging ? '← Charging' : '→ Discharging'}
                  pulse={faults.includes('OVER_CURRENT')} />
            <Stat label="Power" value={Math.abs(pm.packVoltage * pm.packCurrent).toFixed(0)} unit="W" color="#a855f7" />
            <Stat label="Temp Range" value={`${pm.tMin.toFixed(0)}–${pm.tMax.toFixed(0)}`} unit="°C" color="#f97316"
                  sub={`ΔT ${pm.tSpread}°C`} pulse={faults.includes('OVER_TEMP') || faults.includes('THERMAL_RUNAWAY')} />
            <Stat label="SOC Range" value={`${pm.socMin}–${pm.socMax}`} unit="%" color="#22c55e" />
            <Stat label="Avg SOH" value={pm.avgSoh} unit="%" color="#06b6d4" sub={`Heat: ${pm.totalHeat.toFixed(1)}W`} />
          </div>
        )}

        {/* Row 2: Contactor circuit diagram (full width centerpiece) */}
        <CircuitContactor
          closed={bms.contactor_closed}
          precharge={bms.precharge_active}
          current={pm?.packCurrent ?? 0}
          voltage={pm?.packVoltage ?? 0}
          isCharging={pm?.isCharging ?? false}
        />

        {/* Row 3: Cell bar charts (2×2 grid) */}
        <div className="grid grid-cols-2 gap-1.5">
          <CellBars cells={cells} get={c => c.voltage} label="⚡ Cell Voltages" unit="V" color="#3b82f6"
                    domain={vDom} limits={[{ at: LIMITS.cellVMax, color: '#ef4444', tag: 'OV' }, { at: LIMITS.cellVMin, color: '#eab308', tag: 'UV' }]} />
          <CellBars cells={cells} get={c => c.temp_c} label="🌡️ Cell Temperatures" unit="°C" color="#f97316"
                    domain={tDom} limits={[{ at: LIMITS.cellTempMax, color: '#f97316', tag: 'Over' }, { at: LIMITS.cellTempCritical, color: '#ef4444', tag: 'Crit' }]} />
          <CellBars cells={cells} get={c => c.soc * 100} label="🔋 Cell SOC" unit="%" color="#22c55e" domain={[0, 100]} />
          <CellBars cells={cells} get={c => c.soh_pct} label="💚 Cell SOH" unit="%" color="#06b6d4" domain={[70, 100]} />
        </div>

        {/* Row 4: Balancing + Protection + Fault Log */}
        <div className="grid grid-cols-3 gap-1.5">
          <BalancingGrid active={bms.balancing_active} map={bms.balancing_map ?? {}} />
          <ProtectionStatus bms={bms} cells={cells} packMetrics={pm} />
          <FaultLog history={history} />
        </div>

        {/* Collapsible safety reference */}
        <SafetyRef />
      </div>
    </div>
  );
}
