/**
 * Safety Abuse Testing Panel
 *
 * Simulates battery abuse scenarios with animated progress and results:
 *   - Nail penetration (ISC → thermal runaway)
 *   - Overcharge abuse (over-voltage → gas generation)
 *   - Crush / deformation (resistance increase → capacity loss)
 *   - External short circuit (extreme current → thermal event)
 *
 * Each scenario shows:
 *   - Animated progress timeline
 *   - Temperature / voltage / current response curves
 *   - Pass / fail safety assessment
 *   - Severity meter
 */

import { useState, useCallback, useRef } from 'react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, Legend,
} from 'recharts';
import { Shield, ShieldAlert, Crosshair, Zap, AlertTriangle, CheckCircle, Play, RotateCcw } from 'lucide-react';
import { API_BASE } from '../config';

/* ── Abuse Scenario Definitions ─────────────────────────── */
interface AbuseScenario {
  id: string;
  name: string;
  icon: typeof ShieldAlert;
  description: string;
  color: string;
  faultType: string;
  severity: number;
  durationS: number;
}

const SCENARIOS: AbuseScenario[] = [
  {
    id: 'nail', name: 'Nail Penetration', icon: Crosshair,
    description: 'Simulates internal short circuit from nail penetration — models ISC resistance drop, joule heating, and potential thermal runaway propagation.',
    color: '#ef4444', faultType: 'internal_short', severity: 0.85, durationS: 60,
  },
  {
    id: 'overcharge', name: 'Overcharge Abuse', icon: Zap,
    description: 'Forces charging beyond safe voltage limits — models lithium plating, gas generation, electrolyte decomposition, and cell swelling.',
    color: '#f59e0b', faultType: 'capacity_fade', severity: 0.7, durationS: 120,
  },
  {
    id: 'crush', name: 'Crush / Deformation', icon: ShieldAlert,
    description: 'Mechanical crush test — models progressive internal resistance increase, separator damage, and capacity loss from electrode cracking.',
    color: '#8b5cf6', faultType: 'capacity_fade', severity: 0.5, durationS: 30,
  },
  {
    id: 'ext_short', name: 'External Short', icon: AlertTriangle,
    description: 'Direct terminal-to-terminal short circuit — extreme discharge current, rapid joule heating, potential venting and thermal runaway.',
    color: '#f97316', faultType: 'internal_short', severity: 0.95, durationS: 15,
  },
];

/* ── Simulated response curve generator ─────────────────── */
function generateResponse(scenario: AbuseScenario): { time: number; temp: number; voltage: number; current: number }[] {
  const pts: { time: number; temp: number; voltage: number; current: number }[] = [];
  const dt = scenario.durationS / 100;
  let temp = 25;
  let voltage = 3.7;
  let current = 0;

  for (let i = 0; i <= 100; i++) {
    const t = i * dt;
    const frac = i / 100;

    switch (scenario.id) {
      case 'nail': {
        // Sharp ISC → temperature spike, voltage collapse
        const onset = 0.1;
        if (frac > onset) {
          const iscFrac = Math.min((frac - onset) / 0.3, 1);
          current = 150 * iscFrac * scenario.severity;
          temp = 25 + 200 * Math.pow(iscFrac, 1.5) * scenario.severity;
          voltage = 3.7 - 3.2 * iscFrac * scenario.severity;
        }
        break;
      }
      case 'overcharge': {
        // Gradual voltage rise → plating onset → gas → thermal
        voltage = 3.7 + frac * 1.8 * scenario.severity;
        current = -25 * (1 - frac * 0.5); // charging current reduces
        temp = 25 + frac * 80 * scenario.severity * (1 + Math.pow(frac, 3) * 2);
        break;
      }
      case 'crush': {
        // Step resistance → gradual capacity fade
        const crushPoint = 0.15;
        if (frac > crushPoint) {
          const cf = (frac - crushPoint) / (1 - crushPoint);
          current = 5 * Math.exp(-cf * 3);
          voltage = 3.7 - cf * 1.2 * scenario.severity;
          temp = 25 + cf * 40 * scenario.severity;
        }
        break;
      }
      case 'ext_short': {
        // Immediate massive current → rapid heating
        if (frac > 0.05) {
          const sf = Math.min((frac - 0.05) / 0.2, 1);
          current = 500 * sf * scenario.severity * Math.exp(-frac * 2);
          temp = 25 + 300 * (1 - Math.exp(-frac * 5)) * scenario.severity;
          voltage = 3.7 * Math.exp(-frac * 4 * scenario.severity);
        }
        break;
      }
    }

    pts.push({
      time: +t.toFixed(1),
      temp: +Math.max(temp, 25).toFixed(1),
      voltage: +Math.max(voltage, 0).toFixed(3),
      current: +Math.max(current, 0).toFixed(1),
    });
  }
  return pts;
}

/* ── Severity gauge ──────────────────────────────────────── */
function SeverityGauge({ value, color }: { value: number; color: string }) {
  const segments = 10;
  const filled = Math.round(value * segments);
  return (
    <div className="flex gap-0.5 items-center">
      {Array.from({ length: segments }).map((_, i) => (
        <div
          key={i}
          className="w-2.5 h-6 rounded-sm transition-all duration-300"
          style={{
            background: i < filled ? color : 'rgba(255,255,255,0.06)',
            opacity: i < filled ? 0.5 + (i / segments) * 0.5 : 1,
          }}
        />
      ))}
      <span className="ml-2 text-xs font-bold" style={{ color }}>
        {(value * 100).toFixed(0)}%
      </span>
    </div>
  );
}

/* ── Main Component ──────────────────────────────────────── */
export default function SafetyAbusePanel() {
  const [selected, setSelected] = useState<AbuseScenario>(SCENARIOS[0]);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [response, setResponse] = useState<ReturnType<typeof generateResponse> | null>(null);
  const [result, setResult] = useState<'pass' | 'fail' | null>(null);
  const timerRef = useRef<number>(0);

  const runTest = useCallback(() => {
    setRunning(true);
    setProgress(0);
    setResponse(null);
    setResult(null);

    // Also inject the fault into the real simulation backend (best-effort)
    fetch(`${API_BASE}/fault/inject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fault_type: selected.faultType,
        severity: selected.severity,
        delay_s: 0,
      }),
    }).catch(() => {});

    // Animate progress bar over the scenario duration
    const totalMs = selected.durationS * 50; // accelerated for UI
    const stepMs = 30;
    let elapsed = 0;

    const tick = () => {
      elapsed += stepMs;
      const pct = Math.min(elapsed / totalMs, 1);
      setProgress(pct);

      if (pct >= 1) {
        // Generate simulated response curves
        const data = generateResponse(selected);
        setResponse(data);
        const maxTemp = Math.max(...data.map((d) => d.temp));
        setResult(maxTemp > 150 ? 'fail' : 'pass');
        setRunning(false);
        return;
      }
      timerRef.current = window.setTimeout(tick, stepMs);
    };
    tick();
  }, [selected]);

  const reset = useCallback(() => {
    clearTimeout(timerRef.current);
    setRunning(false);
    setProgress(0);
    setResponse(null);
    setResult(null);
    // Clear faults on backend
    fetch(`${API_BASE}/fault/clear`, { method: 'POST' }).catch(() => {});
  }, []);

  return (
    <div className="h-full flex flex-col gap-4 p-4 overflow-y-auto text-white">
      {/* ── Header ─────────────────────────────────────── */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-red-500/10 border border-red-500/20">
          <Shield className="w-6 h-6 text-red-400" />
        </div>
        <div>
          <h2 className="text-lg font-bold">Safety Abuse Testing</h2>
          <p className="text-xs text-panel-muted">Simulate battery abuse scenarios and analyze thermal/electrical response</p>
        </div>
      </div>

      {/* ── Scenario selector ──────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {SCENARIOS.map((sc) => {
          const Icon = sc.icon;
          const isActive = selected.id === sc.id;
          return (
            <button
              key={sc.id}
              onClick={() => { setSelected(sc); reset(); }}
              className={`p-3 rounded-xl border text-left transition-all duration-200
                ${isActive
                  ? 'border-white/20 bg-white/[0.06]'
                  : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.04]'}`}
              style={isActive ? { borderLeftColor: sc.color, borderLeftWidth: 3 } : {}}
            >
              <Icon className="w-5 h-5 mb-1.5" style={{ color: sc.color }} />
              <div className="text-sm font-semibold">{sc.name}</div>
              <div className="text-[10px] text-panel-muted mt-0.5 line-clamp-2">{sc.description.slice(0, 80)}...</div>
            </button>
          );
        })}
      </div>

      {/* ── Selected scenario detail ───────────────────── */}
      <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h3 className="text-sm font-semibold" style={{ color: selected.color }}>{selected.name}</h3>
            <p className="text-xs text-panel-muted mt-1 max-w-lg">{selected.description}</p>
            <div className="mt-3 flex items-center gap-4">
              <div>
                <span className="text-[10px] text-panel-muted">Severity</span>
                <SeverityGauge value={selected.severity} color={selected.color} />
              </div>
              <div>
                <span className="text-[10px] text-panel-muted">Duration</span>
                <div className="text-sm font-semibold">{selected.durationS}s</div>
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button
              onClick={runTest}
              disabled={running}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium
                         bg-red-500/20 text-red-400 border border-red-500/30
                         hover:bg-red-500/30 disabled:opacity-40 transition-colors"
            >
              <Play className="w-4 h-4" /> Run Test
            </button>
            <button
              onClick={reset}
              className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm
                         text-panel-muted hover:text-white border border-white/[0.08]
                         hover:bg-white/[0.06] transition-colors"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Progress bar */}
        {(running || progress > 0) && (
          <div className="mt-4">
            <div className="flex items-center justify-between text-[10px] text-panel-muted mb-1">
              <span>{running ? 'Running abuse test...' : 'Complete'}</span>
              <span>{(progress * 100).toFixed(0)}%</span>
            </div>
            <div className="w-full h-2 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-100"
                style={{ width: `${progress * 100}%`, background: selected.color }}
              />
            </div>
          </div>
        )}

        {/* Result badge */}
        {result && (
          <div className={`mt-3 inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold
            ${result === 'pass'
              ? 'bg-green-500/15 text-green-400 border border-green-500/30'
              : 'bg-red-500/15 text-red-400 border border-red-500/30'}`}>
            {result === 'pass' ? <CheckCircle className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
            {result === 'pass' ? 'PASS — No thermal runaway detected' : 'FAIL — Thermal runaway triggered (T > 150°C)'}
          </div>
        )}
      </div>

      {/* ── Response curves ────────────────────────────── */}
      {response && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Temperature */}
          <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 min-h-[220px]">
            <h4 className="text-xs font-semibold text-red-400 mb-2">Temperature Response</h4>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={response}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="time" tick={{ fill: '#94a3b8', fontSize: 9 }} unit="s" />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 9 }} unit="°C" />
                <Tooltip contentStyle={{ background: '#0f1729ee', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }} />
                <ReferenceLine y={150} stroke="#ef4444" strokeDasharray="3 3" label={{ value: 'Runaway', fill: '#ef4444', fontSize: 9 }} />
                <Line type="monotone" dataKey="temp" stroke="#ef4444" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Voltage */}
          <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 min-h-[220px]">
            <h4 className="text-xs font-semibold text-blue-400 mb-2">Voltage Response</h4>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={response}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="time" tick={{ fill: '#94a3b8', fontSize: 9 }} unit="s" />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 9 }} unit="V" domain={[0, 'auto']} />
                <Tooltip contentStyle={{ background: '#0f1729ee', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }} />
                <Line type="monotone" dataKey="voltage" stroke="#3b82f6" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Current */}
          <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-4 min-h-[220px]">
            <h4 className="text-xs font-semibold text-amber-400 mb-2">Current Response</h4>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={response}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
                <XAxis dataKey="time" tick={{ fill: '#94a3b8', fontSize: 9 }} unit="s" />
                <YAxis tick={{ fill: '#94a3b8', fontSize: 9 }} unit="A" />
                <Tooltip contentStyle={{ background: '#0f1729ee', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 11 }} />
                <Line type="monotone" dataKey="current" stroke="#f59e0b" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
