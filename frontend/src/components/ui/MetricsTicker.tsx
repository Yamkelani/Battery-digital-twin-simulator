/**
 * MetricsTicker — Floating metrics overlay for 3D view
 *
 * Shows key real-time metrics as a compact floating HUD overlay
 * on top of the 3D scene, styled with glassmorphism.
 */

import { motion } from 'framer-motion';
import { useBatteryStore } from '../../hooks/useBatteryState';

function socColor(soc: number): string {
  if (soc > 0.5) return '#22c55e';
  if (soc > 0.2) return '#eab308';
  return '#ef4444';
}

function tempColor(temp: number): string {
  if (temp > 55) return '#ef4444';
  if (temp > 45) return '#f97316';
  if (temp > 35) return '#eab308';
  return '#3b82f6';
}

export default function MetricsTicker() {
  const bs = useBatteryStore((s) => s.batteryState);
  if (!bs) return null;

  const soc = bs.soc ?? 0.5;
  const voltage = bs.voltage ?? 3.7;
  const current = bs.current ?? 0;
  const tempC = bs.thermal_T_core_c ?? 25;
  const soh = bs.deg_soh_pct ?? 100;
  const power = bs.power_w ?? 0;

  const metrics = [
    { label: 'SOC',   value: `${(soc * 100).toFixed(1)}%`, color: socColor(soc) },
    { label: 'V',     value: `${voltage.toFixed(3)}V`,     color: '#3b82f6' },
    { label: 'I',     value: `${current.toFixed(2)}A`,     color: current < 0 ? '#22c55e' : current > 0 ? '#f97316' : '#94a3b8' },
    { label: 'T',     value: `${tempC.toFixed(1)}°C`,      color: tempColor(tempC) },
    { label: 'SOH',   value: `${soh.toFixed(1)}%`,         color: soh > 80 ? '#22c55e' : soh > 60 ? '#eab308' : '#ef4444' },
    { label: 'P',     value: `${power.toFixed(1)}W`,       color: '#a78bfa' },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="absolute top-4 left-4 z-10 flex gap-2"
    >
      {metrics.map(({ label, value, color }) => (
        <div
          key={label}
          className="px-3 py-1.5 rounded-lg border border-white/[0.08]
                     bg-black/40 text-sm font-mono select-none"
          style={{ backdropFilter: 'blur(12px)' }}
        >
          <span className="text-panel-muted/70 mr-1.5">{label}</span>
          <span style={{ color }} className="font-semibold">{value}</span>
        </div>
      ))}
    </motion.div>
  );
}
