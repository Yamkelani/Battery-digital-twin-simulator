/**
 * Quick Start Presets — One-click simulation scenarios
 *
 * A landing/welcome view that shows when the simulator starts.
 * Replaces the "stare at empty charts" experience with:
 *   - Hero introduction to the simulator
 *   - One-click preset cards that auto-configure and start the simulation
 *   - Visual learning path for beginners
 *   - Live system health indicators
 */

import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Zap, Battery, Thermometer, Activity, Rocket, ArrowRight,
  BookOpen, Monitor, Cpu, BarChart3, Gauge, Play,
} from 'lucide-react';
import { API_BASE } from '../config';
import { useBatteryStore } from '../hooks/useBatteryState';

/* ── Preset Definitions ─────────────────────────────────── */
interface Preset {
  id: string;
  name: string;
  description: string;
  icon: typeof Battery;
  color: string;
  gradient: string;
  duration: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  config: {
    profile: string;
    profileParams: Record<string, number>;
    soc: number;
    temp: number;
    speed: number;
    enableDegradation: boolean;
    degradationAccel: number;
  };
  navigateTo: string;
}

const PRESETS: Preset[] = [
  {
    id: 'basic_discharge', name: 'Basic Discharge', icon: Battery, color: '#22c55e',
    gradient: 'from-green-600/20 to-emerald-600/20',
    description: 'Watch a battery discharge from 100% to 0%. Observe voltage curves, heat generation and SOC depletion.',
    duration: '~2 min', difficulty: 'beginner',
    config: {
      profile: 'constant_discharge', profileParams: { c_rate: 1.0 },
      soc: 1.0, temp: 25, speed: 20, enableDegradation: false, degradationAccel: 1,
    },
    navigateTo: 'split',
  },
  {
    id: 'cccv_charge', name: 'CC-CV Charging', icon: Zap, color: '#3b82f6',
    gradient: 'from-blue-600/20 to-indigo-600/20',
    description: 'Charge from 20% using the CC-CV protocol. See the transition from constant current to constant voltage phase.',
    duration: '~3 min', difficulty: 'beginner',
    config: {
      profile: 'cccv_charge', profileParams: { c_rate: 1.0 },
      soc: 0.2, temp: 25, speed: 30, enableDegradation: false, degradationAccel: 1,
    },
    navigateTo: 'cccv',
  },
  {
    id: 'ev_trip', name: 'EV Drive Cycle', icon: Activity, color: '#f59e0b',
    gradient: 'from-amber-600/20 to-orange-600/20',
    description: 'Dynamic driving pattern with acceleration, braking, and regeneration. Observe varying power demand.',
    duration: '~2 min', difficulty: 'intermediate',
    config: {
      profile: 'drive_cycle', profileParams: { aggressiveness: 1.2, duration_s: 3600 },
      soc: 0.85, temp: 25, speed: 40, enableDegradation: false, degradationAccel: 1,
    },
    navigateTo: 'charts',
  },
  {
    id: 'thermal_stress', name: 'Thermal Stress Test', icon: Thermometer, color: '#ef4444',
    gradient: 'from-red-600/20 to-rose-600/20',
    description: 'High C-rate discharge in a hot environment. Watch thermal management struggle to keep cells cool.',
    duration: '~2 min', difficulty: 'intermediate',
    config: {
      profile: 'constant_discharge', profileParams: { c_rate: 3.0 },
      soc: 1.0, temp: 40, speed: 15, enableDegradation: true, degradationAccel: 1,
    },
    navigateTo: 'thermal',
  },
  {
    id: 'aging_test', name: 'Battery Aging', icon: Gauge, color: '#a78bfa',
    gradient: 'from-violet-600/20 to-purple-600/20',
    description: 'Accelerated cycle aging — observe SOH degradation, capacity fade, and resistance growth over hundreds of cycles.',
    duration: '~5 min', difficulty: 'advanced',
    config: {
      profile: 'cycle_aging', profileParams: { c_rate: 1.0, num_cycles: 50 },
      soc: 0.9, temp: 35, speed: 200, enableDegradation: true, degradationAccel: 100,
    },
    navigateTo: 'aging',
  },
  {
    id: 'solar_day', name: 'Solar Storage Day', icon: Monitor, color: '#fb923c',
    gradient: 'from-orange-600/20 to-amber-600/20',
    description: 'Simulate a full 24-hour solar + battery cycle: daytime charging from PV, evening peak shaving.',
    duration: '~4 min', difficulty: 'intermediate',
    config: {
      profile: 'solar_storage', profileParams: { pv_peak_kw: 5, duration_s: 86400 },
      soc: 0.4, temp: 22, speed: 100, enableDegradation: false, degradationAccel: 1,
    },
    navigateTo: 'charts',
  },
];

const DIFFICULTY_COLORS = {
  beginner: { bg: 'bg-green-500/15', text: 'text-green-400', border: 'border-green-500/30' },
  intermediate: { bg: 'bg-amber-500/15', text: 'text-amber-400', border: 'border-amber-500/30' },
  advanced: { bg: 'bg-red-500/15', text: 'text-red-400', border: 'border-red-500/30' },
};

/* ── Learning Path ───────────────────────────────────────── */
const LEARNING_STEPS = [
  { icon: Battery, label: 'Basic Discharge', desc: 'Understand voltage-SOC curves', view: 'split' },
  { icon: Zap, label: 'CC-CV Charging', desc: 'Learn charging protocol phases', view: 'cccv' },
  { icon: Thermometer, label: 'Thermal Effects', desc: 'Explore temperature impact', view: 'thermal' },
  { icon: Activity, label: 'Physics Lab', desc: 'Interactive physics exploration', view: 'physics' },
  { icon: Gauge, label: 'Degradation', desc: 'Observe battery aging', view: 'aging' },
  { icon: Cpu, label: 'BMS Analysis', desc: 'Battery management system', view: 'bms' },
];

/* ── Main Component ─────────────────────────────────────── */
export default function QuickStartPresets() {
  const setSelectedView = useBatteryStore((s: any) => s.setSelectedView);
  const status = useBatteryStore((s: any) => s.status);
  const [launching, setLaunching] = useState<string | null>(null);

  const handlePreset = useCallback(async (preset: Preset) => {
    setLaunching(preset.id);
    try {
      // Configure cell
      await fetch(`${API_BASE}/configure/cell`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          capacity_ah: 50,
          soc: preset.config.soc,
          temperature_c: preset.config.temp,
          enable_thermal: true,
          enable_degradation: preset.config.enableDegradation,
          enable_electrochemical: true,
          degradation_acceleration: preset.config.degradationAccel,
        }),
      });

      // Set profile
      await fetch(`${API_BASE}/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_id: preset.config.profile, params: preset.config.profileParams }),
      });

      // Set speed
      await fetch(`${API_BASE}/configure/simulation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ speed: preset.config.speed }),
      });

      // Navigate to best view
      setSelectedView(preset.navigateTo);
    } catch (e) {
      console.error('Preset launch failed:', e);
    } finally {
      setLaunching(null);
    }
  }, [setSelectedView]);

  const container = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.08 } },
  };
  const item = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0 },
  };

  return (
    <div className="h-full flex flex-col gap-6 p-6 overflow-y-auto text-white">
      {/* ── Hero Section ──────────────────────────────── */}
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center py-6"
      >
        <motion.div
          className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-blue-500/10 border border-blue-500/20 mb-4"
          animate={{ borderColor: ['rgba(59,130,246,0.2)', 'rgba(59,130,246,0.4)', 'rgba(59,130,246,0.2)'] }}
          transition={{ duration: 3, repeat: Infinity }}
        >
          <Zap className="w-4 h-4 text-blue-400" />
          <span className="text-xs text-blue-400 font-medium">Battery Digital Twin Simulator</span>
        </motion.div>
        <h1 className="text-2xl font-bold mb-2">
          Choose a Scenario to Get Started
        </h1>
        <p className="text-sm text-panel-muted max-w-lg mx-auto leading-relaxed">
          Each preset auto-configures the simulation and navigates to the best view.
          Open the <strong className="text-slate-300">Controls drawer</strong> (top-right) and press <strong className="text-slate-300">Start</strong> to begin.
        </p>
      </motion.div>

      {/* ── Preset Cards ─────────────────────────────── */}
      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
      >
        {PRESETS.map((preset) => {
          const Icon = preset.icon;
          const diff = DIFFICULTY_COLORS[preset.difficulty];
          const isLaunching = launching === preset.id;

          return (
            <motion.button
              key={preset.id}
              variants={item}
              whileHover={{ scale: 1.02, y: -3 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => handlePreset(preset)}
              disabled={isLaunching}
              className={`p-5 rounded-2xl border border-white/[0.06] bg-gradient-to-br ${preset.gradient}
                         text-left transition-all group relative overflow-hidden`}
            >
              {/* Glow effect */}
              <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity"
                   style={{ background: `radial-gradient(circle at 50% 0%, ${preset.color}10, transparent 70%)` }} />

              <div className="relative z-10">
                <div className="flex items-center justify-between mb-3">
                  <div className="p-2 rounded-lg" style={{ background: `${preset.color}20`, border: `1px solid ${preset.color}30` }}>
                    <Icon className="w-5 h-5" style={{ color: preset.color }} />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-medium border ${diff.bg} ${diff.text} ${diff.border}`}>
                      {preset.difficulty}
                    </span>
                  </div>
                </div>

                <h3 className="text-sm font-bold mb-1 group-hover:text-white transition-colors">{preset.name}</h3>
                <p className="text-xs text-panel-muted leading-relaxed mb-3">{preset.description}</p>

                <div className="flex items-center justify-between">
                  <span className="text-[10px] text-panel-muted">{preset.duration}</span>
                  <div className="flex items-center gap-1 text-[10px] font-medium" style={{ color: preset.color }}>
                    {isLaunching ? (
                      <motion.div animate={{ rotate: 360 }} transition={{ duration: 0.8, repeat: Infinity, ease: 'linear' }}>
                        <Gauge className="w-3 h-3" />
                      </motion.div>
                    ) : (
                      <>
                        <Play className="w-3 h-3" />
                        <span>Launch</span>
                        <ArrowRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
                      </>
                    )}
                  </div>
                </div>
              </div>
            </motion.button>
          );
        })}
      </motion.div>

      {/* ── Learning Path ────────────────────────────── */}
      <div className="mt-2">
        <div className="flex items-center gap-2 mb-3">
          <BookOpen className="w-4 h-4 text-indigo-400" />
          <span className="text-sm font-semibold">Suggested Learning Path</span>
        </div>
        <div className="flex items-center gap-2 overflow-x-auto pb-2">
          {LEARNING_STEPS.map((ls, i) => {
            const Icon = ls.icon;
            return (
              <div key={i} className="flex items-center gap-2 shrink-0">
                <motion.button
                  whileHover={{ y: -2 }}
                  onClick={() => setSelectedView(ls.view)}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.06]
                             hover:bg-white/[0.06] transition-colors min-w-[140px]"
                >
                  <div className="w-6 h-6 rounded-full bg-indigo-500/15 flex items-center justify-center shrink-0">
                    <span className="text-[10px] font-bold text-indigo-400">{i + 1}</span>
                  </div>
                  <div className="text-left">
                    <div className="text-[11px] font-medium">{ls.label}</div>
                    <div className="text-[9px] text-panel-muted">{ls.desc}</div>
                  </div>
                </motion.button>
                {i < LEARNING_STEPS.length - 1 && (
                  <ArrowRight className="w-3 h-3 text-panel-muted shrink-0" />
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
