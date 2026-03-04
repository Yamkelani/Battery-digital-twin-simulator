/**
 * Live Parameter Tuner — Real-time simulation parameter adjustment
 *
 * A floating control surface that lets users adjust simulation
 * parameters WHILE the simulation is running and see immediate effects:
 *   - Temperature sliders with instant visual feedback
 *   - C-rate / current override
 *   - Fault injection quick-buttons
 *   - Live mini-charts showing recent trends
 *   - Parameter impact indicators
 *
 * This bridges the gap between the static Controls drawer and
 * the main visualization, making the sim feel "alive".
 */

import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  LineChart, Line, ResponsiveContainer, YAxis, ReferenceLine,
} from 'recharts';
import {
  SlidersHorizontal, Thermometer, Zap, AlertTriangle, Wind, X,
  ChevronDown, ChevronUp, Activity, RotateCcw, Gauge,
} from 'lucide-react';
import { API_BASE } from '../config';
import { useBatteryStore } from '../hooks/useBatteryState';

/* ── Sparkline ───────────────────────────────────────────── */
function Sparkline({ data, color, height = 40 }: { data: number[]; color: string; height?: number }) {
  const chartData = useMemo(() => data.map((v, i) => ({ i, v })), [data]);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={chartData}>
        <Line type="monotone" dataKey="v" stroke={color} dot={false} strokeWidth={1.5} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

/* ── Impact indicator ────────────────────────────────────── */
function ImpactPill({ label, level }: { label: string; level: 'low' | 'medium' | 'high' }) {
  const colors = {
    low: 'bg-green-500/15 text-green-400 border-green-500/30',
    medium: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
    high: 'bg-red-500/15 text-red-400 border-red-500/30',
  };
  return (
    <span className={`px-2 py-0.5 rounded-full text-[9px] font-medium border ${colors[level]}`}>
      {label}: {level}
    </span>
  );
}

/* ── Quick Fault Button ──────────────────────────────────── */
function FaultButton({ label, faultType, severity, color, icon: Icon }: {
  label: string; faultType: string; severity: number; color: string; icon: typeof AlertTriangle;
}) {
  const [active, setActive] = useState(false);

  const toggle = useCallback(async () => {
    if (active) {
      await fetch(`${API_BASE}/fault/clear`, { method: 'POST' }).catch(() => {});
      setActive(false);
    } else {
      await fetch(`${API_BASE}/fault/inject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fault_type: faultType, severity, delay_s: 0 }),
      }).catch(() => {});
      setActive(true);
    }
  }, [active, faultType, severity]);

  return (
    <motion.button
      onClick={toggle}
      whileTap={{ scale: 0.95 }}
      className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs border transition-all
        ${active
          ? `bg-opacity-20 border-opacity-40 font-semibold`
          : 'bg-white/[0.02] border-white/[0.08] text-panel-muted hover:text-white hover:bg-white/[0.04]'}`}
      style={active ? { background: `${color}20`, borderColor: `${color}40`, color } : {}}
    >
      <Icon className="w-3 h-3" />
      {active ? `■ ${label}` : label}
    </motion.button>
  );
}

/* ── Main Component ─────────────────────────────────────── */
export default function LiveParameterTuner() {
  const batteryState = useBatteryStore((s: any) => s.batteryState);
  const chartHistory = useBatteryStore((s: any) => s.chartHistory);
  const status = useBatteryStore((s: any) => s.status);

  const [ambientTemp, setAmbientTemp] = useState(25);
  const [simSpeed, setSimSpeed] = useState(10);
  const [expandedGroup, setExpandedGroup] = useState<string | null>('thermal');

  // Recent history for sparklines  
  const recentHistory = useMemo(() => {
    const h = chartHistory ?? [];
    const last50 = h.slice(-50);
    return {
      voltage: last50.map((p: any) => p.voltage ?? 3.7),
      current: last50.map((p: any) => p.current ?? 0),
      temp: last50.map((p: any) => p.temperature ?? 25),
      soc: last50.map((p: any) => p.soc ?? 50),
      soh: last50.map((p: any) => p.soh ?? 100),
      power: last50.map((p: any) => p.power ?? 0),
    };
  }, [chartHistory]);

  // Send ambient temp change to backend
  const handleAmbientChange = useCallback(async (t: number) => {
    setAmbientTemp(t);
    await fetch(`${API_BASE}/configure/simulation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ambient_temp_c: t }),
    }).catch(() => {});
  }, []);

  // Send speed change
  const handleSpeedChange = useCallback(async (s: number) => {
    setSimSpeed(s);
    await fetch(`${API_BASE}/configure/simulation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ speed: s }),
    }).catch(() => {});
  }, []);

  const bs = batteryState;
  const isRunning = status === 'running';

  const toggleGroup = (g: string) => setExpandedGroup(expandedGroup === g ? null : g);

  return (
    <div className="h-full flex flex-col gap-4 p-4 overflow-y-auto text-white">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
          <SlidersHorizontal className="w-6 h-6 text-amber-400" />
        </div>
        <div>
          <h2 className="text-lg font-bold">Live Parameter Tuner</h2>
          <p className="text-xs text-panel-muted">Adjust parameters in real-time and see immediate effects</p>
        </div>
        {isRunning && (
          <motion.div
            className="ml-auto flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-500/15 border border-green-500/30"
            animate={{ opacity: [1, 0.6, 1] }}
            transition={{ duration: 1.5, repeat: Infinity }}
          >
            <div className="w-2 h-2 rounded-full bg-green-400" />
            <span className="text-[10px] font-semibold text-green-400">LIVE</span>
          </motion.div>
        )}
      </div>

      {/* ── Live Sparkline Grid ───────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {[
          { label: 'Voltage', value: bs?.voltage?.toFixed(3) ?? '--', unit: 'V', color: '#3b82f6', data: recentHistory.voltage },
          { label: 'Current', value: bs?.current?.toFixed(1) ?? '--', unit: 'A', color: '#f59e0b', data: recentHistory.current },
          { label: 'Temperature', value: bs?.thermal_T_core_c?.toFixed(1) ?? '--', unit: '°C', color: '#ef4444', data: recentHistory.temp },
          { label: 'SOC', value: typeof bs?.soc_pct === 'number' ? bs.soc_pct.toFixed(1) : (typeof bs?.soc === 'number' ? (bs.soc * 100).toFixed(1) : '--'), unit: '%', color: '#22c55e', data: recentHistory.soc },
          { label: 'SOH', value: bs?.deg_soh_pct?.toFixed(1) ?? '--', unit: '%', color: '#a78bfa', data: recentHistory.soh },
          { label: 'Power', value: bs?.power_w?.toFixed(1) ?? '--', unit: 'W', color: '#ec4899', data: recentHistory.power },
        ].map((metric) => (
          <div key={metric.label} className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-3">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] text-panel-muted uppercase tracking-wider">{metric.label}</span>
              <span className="text-xs font-bold" style={{ color: metric.color }}>
                {metric.value}<span className="text-[9px] font-normal text-panel-muted ml-0.5">{metric.unit}</span>
              </span>
            </div>
            <Sparkline data={metric.data} color={metric.color} height={36} />
          </div>
        ))}
      </div>

      {/* ── Control Groups ───────────────────────────── */}
      {/* Thermal Controls */}
      <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl overflow-hidden">
        <button
          onClick={() => toggleGroup('thermal')}
          className="w-full flex items-center justify-between p-3 hover:bg-white/[0.02] transition-colors"
        >
          <div className="flex items-center gap-2">
            <Thermometer className="w-4 h-4 text-red-400" />
            <span className="text-sm font-semibold">Thermal Controls</span>
            <ImpactPill label="Heat" level={ambientTemp > 35 ? 'high' : ambientTemp > 20 ? 'medium' : 'low'} />
          </div>
          {expandedGroup === 'thermal' ? <ChevronUp className="w-4 h-4 text-panel-muted" /> : <ChevronDown className="w-4 h-4 text-panel-muted" />}
        </button>
        <AnimatePresence>
          {expandedGroup === 'thermal' && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="px-3 pb-3"
            >
              <div className="p-3 bg-white/[0.02] rounded-lg border border-white/[0.04]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-slate-300">Ambient Temperature</span>
                  <motion.span
                    className="text-sm font-bold text-red-400"
                    key={ambientTemp}
                    initial={{ scale: 1.2 }}
                    animate={{ scale: 1 }}
                  >
                    {ambientTemp}°C
                  </motion.span>
                </div>
                <input
                  type="range" min={-20} max={60} step={1} value={ambientTemp}
                  onChange={(e) => handleAmbientChange(+e.target.value)}
                  className="w-full h-2 rounded-full appearance-none cursor-pointer"
                  style={{
                    background: `linear-gradient(to right, #3b82f6, #22c55e 30%, #f59e0b 60%, #ef4444 100%)`,
                  }}
                />
                <div className="flex justify-between text-[9px] text-panel-muted mt-0.5">
                  <span>-20°C (Arctic)</span>
                  <span>25°C (Room)</span>
                  <span>60°C (Desert)</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Speed Control */}
      <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl overflow-hidden">
        <button
          onClick={() => toggleGroup('speed')}
          className="w-full flex items-center justify-between p-3 hover:bg-white/[0.02] transition-colors"
        >
          <div className="flex items-center gap-2">
            <Gauge className="w-4 h-4 text-blue-400" />
            <span className="text-sm font-semibold">Simulation Speed</span>
          </div>
          {expandedGroup === 'speed' ? <ChevronUp className="w-4 h-4 text-panel-muted" /> : <ChevronDown className="w-4 h-4 text-panel-muted" />}
        </button>
        <AnimatePresence>
          {expandedGroup === 'speed' && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="px-3 pb-3"
            >
              <div className="p-3 bg-white/[0.02] rounded-lg border border-white/[0.04]">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-slate-300">Speed Multiplier</span>
                  <span className="text-sm font-bold text-blue-400">{simSpeed}x</span>
                </div>
                <input
                  type="range" min={1} max={200} step={1} value={simSpeed}
                  onChange={(e) => handleSpeedChange(+e.target.value)}
                  className="w-full h-2 rounded-full appearance-none cursor-pointer accent-blue-500"
                  style={{
                    background: `linear-gradient(to right, #3b82f6 ${(simSpeed / 200) * 100}%, rgba(255,255,255,0.08) ${(simSpeed / 200) * 100}%)`,
                  }}
                />
                <div className="flex gap-2 mt-2">
                  {[1, 10, 50, 100, 200].map((s) => (
                    <button
                      key={s}
                      onClick={() => handleSpeedChange(s)}
                      className={`px-2 py-0.5 rounded text-[10px] border transition-colors
                        ${simSpeed === s
                          ? 'bg-blue-500/20 border-blue-500/40 text-blue-400'
                          : 'border-white/[0.08] text-panel-muted hover:text-white'}`}
                    >
                      {s}x
                    </button>
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Fault Injection Quick Access */}
      <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl overflow-hidden">
        <button
          onClick={() => toggleGroup('faults')}
          className="w-full flex items-center justify-between p-3 hover:bg-white/[0.02] transition-colors"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <span className="text-sm font-semibold">Quick Fault Injection</span>
          </div>
          {expandedGroup === 'faults' ? <ChevronUp className="w-4 h-4 text-panel-muted" /> : <ChevronDown className="w-4 h-4 text-panel-muted" />}
        </button>
        <AnimatePresence>
          {expandedGroup === 'faults' && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="px-3 pb-3"
            >
              <div className="flex flex-wrap gap-2">
                <FaultButton label="Internal Short" faultType="internal_short" severity={0.7} color="#ef4444" icon={Zap} />
                <FaultButton label="Capacity Fade" faultType="capacity_fade" severity={0.5} color="#f59e0b" icon={Activity} />
                <FaultButton label="Resistance Rise" faultType="resistance_increase" severity={0.4} color="#f97316" icon={Thermometer} />
                <FaultButton label="Sensor Fault" faultType="sensor_drift" severity={0.3} color="#8b5cf6" icon={Activity} />
              </div>
              <div className="mt-2 text-[10px] text-panel-muted">
                Click to toggle fault injection. Effects are visible immediately in live data.
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Connection / status footer */}
      <div className="mt-auto pt-2 border-t border-white/[0.06] flex items-center justify-between text-[10px] text-panel-muted">
        <span>Status: <span className={isRunning ? 'text-green-400' : 'text-yellow-400'}>{status}</span></span>
        <span>Sim time: {bs?.sim_time_s?.toFixed(1) ?? 0}s</span>
      </div>
    </div>
  );
}
