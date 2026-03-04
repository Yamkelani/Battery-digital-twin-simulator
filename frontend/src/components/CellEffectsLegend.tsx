/**
 * CellEffectsLegend — Overlay legend for 3D battery cell visual effects
 *
 * Shows what each color/layer/animation means so users can understand
 * the visual representation of SEI growth, lithium plating, thermal effects,
 * degradation, humidity/corrosion, and charging states at a glance.
 *
 * Appears as a compact expandable panel in the bottom-left of the 3D scene.
 */

import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Info, ChevronDown, ChevronUp } from 'lucide-react';
import { useBatteryStore } from '../hooks/useBatteryState';

interface LegendItem {
  id: string;
  label: string;
  description: string;
  color: string;        // primary swatch color
  colorEnd?: string;    // gradient end (for ranges)
  shape: 'box' | 'bar' | 'ring' | 'slab' | 'glow' | 'dot' | 'stripe';
  active: boolean;      // currently visible in the scene
  value?: string;       // live value, e.g. "0.42%"
  severity?: number;    // 0–1, drives pulsing
}

function LegendSwatch({ item }: { item: LegendItem }) {
  const bg = item.colorEnd
    ? `linear-gradient(135deg, ${item.color}, ${item.colorEnd})`
    : item.color;

  const shapeClass =
    item.shape === 'ring' ? 'rounded-full border-2 border-current bg-transparent' :
    item.shape === 'slab' ? 'rounded-sm' :
    item.shape === 'bar' ? 'rounded-sm' :
    item.shape === 'dot' ? 'rounded-full' :
    item.shape === 'stripe' ? 'rounded-sm' :
    'rounded';

  return (
    <div className="relative flex-shrink-0">
      <div
        className={`w-6 h-6 ${shapeClass}`}
        style={{
          background: item.shape === 'ring' ? 'transparent' : bg,
          borderColor: item.shape === 'ring' ? item.color : undefined,
          borderWidth: item.shape === 'ring' ? '2.5px' : undefined,
          borderStyle: item.shape === 'ring' ? 'solid' : undefined,
        }}
      />
      {item.active && item.severity !== undefined && item.severity > 0.1 && (
        <motion.div
          className="absolute inset-0 rounded"
          style={{ background: item.color, opacity: 0.4 }}
          animate={{ opacity: [0.2, 0.5, 0.2] }}
          transition={{ duration: 1.5, repeat: Infinity }}
        />
      )}
    </div>
  );
}

export default function CellEffectsLegend() {
  const [expanded, setExpanded] = useState(true);
  const batteryState = useBatteryStore((s) => s.batteryState);

  const items: LegendItem[] = useMemo(() => {
    const s = batteryState;
    const seiLoss = s?.deg_sei_loss_pct ?? 0;
    const platingLoss = s?.deg_plating_loss_pct ?? 0;
    const cycleLoss = s?.deg_cycle_loss_pct ?? 0;
    const tempC = s?.thermal_T_core_c ?? 25;
    const soh = s?.deg_soh_pct ?? 100;
    const current = s?.current ?? 0;
    const humidity = s?.thermal_humidity_pct ?? (s as any)?.humidity_pct ?? 0;
    const condensation = s?.thermal_condensation_active ?? false;
    const timeFactor = s?.degradation_time_factor ?? 1;
    const soc = s?.soc ?? 0.5;
    const resFactor = s?.deg_resistance_factor ?? 1;

    return [
      {
        id: 'soc-fill',
        label: 'SOC Fill Level',
        description: 'Internal liquid bar showing state of charge. Green = high, Yellow = mid, Red = low.',
        color: soc > 0.5 ? '#22c55e' : soc > 0.2 ? '#eab308' : '#ef4444',
        shape: 'bar',
        active: true,
        value: `${(soc * 100).toFixed(0)}%`,
      },
      {
        id: 'sei-layer',
        label: 'SEI Layer Growth',
        description: 'Amber → brown crust growing outward. Solid Electrolyte Interphase consuming lithium. Grows with √t (Arrhenius-accelerated).',
        color: '#d4a017',
        colorEnd: '#5c3a0a',
        shape: 'box',
        active: seiLoss > 0.005,
        value: `${seiLoss.toFixed(2)}%`,
        severity: Math.min(seiLoss / 3, 1),
      },
      {
        id: 'plating',
        label: 'Lithium Plating',
        description: 'Silver/grey metallic slab on anode face (-Z). Dendrite formation from low-temp or high C-rate charging. Safety hazard.',
        color: '#c0c0c0',
        colorEnd: '#708090',
        shape: 'slab',
        active: platingLoss > 0.005,
        value: `${platingLoss.toFixed(3)}%`,
        severity: Math.min(platingLoss / 0.5, 1),
      },
      {
        id: 'thermal-glow',
        label: 'Thermal Heat Map',
        description: 'Blue → Red overlay showing temperature distribution. Orange glow = elevated temperature, red = danger zone.',
        color: '#3b82f6',
        colorEnd: '#ef4444',
        shape: 'glow',
        active: tempC > 28,
        value: `${tempC.toFixed(1)}°C`,
        severity: Math.min(Math.max(tempC - 25, 0) / 35, 1),
      },
      {
        id: 'soh-tint',
        label: 'SOH Degradation Tint',
        description: 'Darkening overlay as State of Health decreases. Fresh = bright, aged = dark/muted surface with increased roughness.',
        color: '#f59e0b',
        colorEnd: '#78350f',
        shape: 'box',
        active: soh < 98,
        value: `${soh.toFixed(1)}%`,
        severity: Math.min((100 - soh) / 15, 1),
      },
      {
        id: 'dead-capacity',
        label: 'Dead Capacity Zone',
        description: 'Dark region at top of cell showing permanently lost capacity. Grows as SEI + cycling consume lithium inventory.',
        color: '#1a1a1a',
        shape: 'bar',
        active: soh < 99.5,
        value: `${(100 - soh).toFixed(1)}% lost`,
      },
      {
        id: 'terminal-glow',
        label: 'Terminal Resistance',
        description: 'Terminal post brightness = current flow × freshness. Dim/dark terminals = high resistance growth (corrosion/oxidation).',
        color: current < 0 ? '#3b82f6' : '#ef4444',
        shape: 'dot',
        active: Math.abs(current) > 0.1 || resFactor > 1.05,
        value: resFactor > 1.01 ? `R×${resFactor.toFixed(2)}` : 'Fresh',
        severity: Math.min((resFactor - 1) * 3, 1),
      },
      {
        id: 'pulse-ring',
        label: 'Activity Pulse Ring',
        description: 'Blue ring = charging, Red ring = discharging. Pulse speed proportional to current magnitude.',
        color: current < 0 ? '#3b82f6' : current > 0 ? '#ef4444' : '#64748b',
        shape: 'ring',
        active: Math.abs(current) > 0.5,
        value: current < -0.1 ? 'Charging' : current > 0.1 ? 'Discharging' : 'Idle',
      },
      {
        id: 'humidity',
        label: 'Humidity / Moisture',
        description: `Blue-green fog/mist = high ambient humidity. Accelerates corrosion and connector degradation.${condensation ? ' ⚠ Condensation is active — water droplets visible on cell!' : ' Condensation droplets visible > 70% RH.'}`,
        color: condensation ? '#80d0ff' : '#06b6d4',
        colorEnd: '#0e7490',
        shape: 'stripe',
        active: humidity > 10,
        value: humidity > 0 ? `${humidity.toFixed(0)}% RH${condensation ? ' 💧' : ''}` : 'N/A',
        severity: Math.min(humidity / 100, 1),
      },
      {
        id: 'accel-aging',
        label: 'Accelerated Aging',
        description: 'Spinning purple/magenta ring at cell base indicates time-compressed aging. Faster spin = higher acceleration factor. SEI pulse also speeds up.',
        color: '#7c3aed',
        colorEnd: '#a855f7',
        shape: 'ring',
        active: timeFactor > 1.5,
        value: timeFactor > 1.5 ? `${timeFactor.toFixed(0)}× faster` : 'Normal',
        severity: Math.min(Math.log10(Math.max(timeFactor, 1)) / 3, 1),
      },
      {
        id: 'cycle-aging',
        label: 'Cycle Aging',
        description: 'Mechanical degradation from repeated charge/discharge. Contributes to surface darkening and capacity loss.',
        color: '#8b5cf6',
        colorEnd: '#4c1d95',
        shape: 'box',
        active: cycleLoss > 0.005,
        value: `${cycleLoss.toFixed(2)}%`,
        severity: Math.min(cycleLoss / 2, 1),
      },
    ];
  }, [batteryState]);

  const activeCount = items.filter((i) => i.active).length;

  return (
    <div className="absolute bottom-4 left-4 z-20 select-none" style={{ maxWidth: 520 }}>
      {/* Toggle button */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="glass-card px-4 py-3 text-base font-semibold text-white flex items-center gap-3
                   cursor-pointer hover:bg-white/[0.08] transition-colors mb-2"
      >
        <Info className="w-6 h-6 text-blue-400" />
        <span>Visual Effects Legend</span>
        <span className="ml-1 text-sm px-2.5 py-1 rounded-full bg-blue-500/20 text-blue-400">
          {activeCount} active
        </span>
        {expanded ? <ChevronDown className="w-5 h-5 ml-auto" /> : <ChevronUp className="w-5 h-5 ml-auto" />}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2 }}
            className="glass-card overflow-hidden"
          >
            <div className="p-3 space-y-1.5 max-h-[60vh] overflow-y-auto scrollbar-thin">
              {items.map((item) => (
                <motion.div
                  key={item.id}
                  className={`flex items-start gap-3 px-3 py-2.5 rounded-lg transition-colors text-sm
                    ${item.active ? 'bg-white/[0.04]' : 'opacity-40'}`}
                  layout
                >
                  <LegendSwatch item={item} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`text-base font-bold tracking-wide ${item.active ? 'text-white' : 'text-slate-500'}`}>
                        {item.label}
                      </span>
                      {item.value && (
                        <span
                          className="shrink-0 font-mono text-sm font-semibold px-2.5 py-1 rounded bg-white/[0.08]"
                          style={{ color: item.active ? item.color : '#64748b' }}
                        >
                          {item.value}
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-slate-300 leading-relaxed mt-0.5">{item.description}</p>
                  </div>
                </motion.div>
              ))}

              {/* Accelerated aging indicator */}
              <div className="border-t border-white/[0.06] mt-2 pt-2.5 px-3">
                <div className="flex items-center gap-3 text-sm text-slate-300">
                  <motion.div
                    className="w-3.5 h-3.5 rounded-full bg-violet-500"
                    animate={{ scale: [1, 1.3, 1] }}
                    transition={{ duration: 0.6, repeat: Infinity }}
                  />
                  <span>Pulsing effects = actively growing / changing</span>
                </div>
                <div className="flex items-center gap-3 text-sm text-slate-300 mt-1.5">
                  <div className="w-3.5 h-3.5 rounded-full bg-slate-600" />
                  <span>Greyed items = effect not currently active</span>
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
