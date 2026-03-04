/**
 * Scenario Wizard — Guided simulation setup for common battery scenarios
 *
 * Step-by-step wizard that walks users through:
 *   1. Pick a scenario (Cold Weather, Fast Charge, Long Storage, EV Highway, etc.)
 *   2. Customize key parameters with visual previews
 *   3. Review & launch simulation
 *
 * Each scenario has educational descriptions explaining what to observe.
 */

import { useState, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Rocket, Snowflake, Zap, Sun, Car, Factory, Battery, Timer, Droplets,
  ArrowRight, ArrowLeft, Check, Play, Thermometer, Gauge, Info,
} from 'lucide-react';
import { API_BASE } from '../config';
import { useBatteryStore } from '../hooks/useBatteryState';

/* ── Scenario Definitions ───────────────────────────────── */
interface ScenarioDef {
  id: string;
  name: string;
  icon: typeof Snowflake;
  color: string;
  tagline: string;
  description: string;
  learnPoints: string[];
  defaults: {
    profile: string;
    soc: number;
    temp: number;
    ambientTemp: number;
    cRate: number;
    speed: number;
    humidity: number;
    enableThermal: boolean;
    enableDegradation: boolean;
    enableElectrochemical: boolean;
    degradationAccel: number;
  };
}

const SCENARIOS: ScenarioDef[] = [
  {
    id: 'cold_start', name: 'Cold Weather Start', icon: Snowflake, color: '#38bdf8',
    tagline: 'Simulate a battery in freezing conditions',
    description: 'Explore how sub-zero temperatures dramatically increase internal resistance, reduce available capacity, and risk lithium plating during charging. Watch the voltage sag under load and observe the thermal model warming the cell.',
    learnPoints: [
      'Internal resistance follows Arrhenius law — doubles every ~10°C drop',
      'Lithium plating risk increases at low temps + fast charging',
      'Self-heating from I²R losses gradually improves performance',
      'Available capacity is reduced (kinetic limitation, not actual loss)',
    ],
    defaults: {
      profile: 'constant_discharge', soc: 0.9, temp: -5, ambientTemp: -10,
      cRate: 0.5, speed: 20, humidity: 30, enableThermal: true, enableDegradation: true,
      enableElectrochemical: true, degradationAccel: 1,
    },
  },
  {
    id: 'fast_charge', name: 'Fast Charging Session', icon: Zap, color: '#fbbf24',
    tagline: 'Push the limits with high C-rate charging',
    description: 'Observe constant-current / constant-voltage (CC-CV) charging protocol. See how high C-rates generate significant heat, and how the BMS transitions from CC to CV phase to protect the cell.',
    learnPoints: [
      'CC phase: current is constant, voltage rises toward limit',
      'CV phase: voltage is held, current tapers exponentially',
      'Higher C-rates → more heat → potentially faster degradation',
      'The CC-CV transition point depends on internal resistance',
    ],
    defaults: {
      profile: 'cccv_charge', soc: 0.15, temp: 25, ambientTemp: 25,
      cRate: 2.0, speed: 30, humidity: 50, enableThermal: true, enableDegradation: true,
      enableElectrochemical: true, degradationAccel: 1,
    },
  },
  {
    id: 'ev_highway', name: 'EV Highway Drive', icon: Car, color: '#34d399',
    tagline: 'Realistic electric vehicle driving pattern',
    description: 'A dynamic drive cycle with acceleration, cruising, regenerative braking, and varying loads. Observe transient thermal behavior and how SOC decreases non-linearly due to varying power demand.',
    learnPoints: [
      'Regenerative braking charges the battery during deceleration',
      'Peak power demands cause temporary voltage drops',
      'Temperature rises during aggressive driving segments',
      'SOC consumption rate varies with driving aggressiveness',
    ],
    defaults: {
      profile: 'drive_cycle', soc: 0.85, temp: 25, ambientTemp: 30,
      cRate: 1.0, speed: 40, humidity: 55, enableThermal: true, enableDegradation: true,
      enableElectrochemical: true, degradationAccel: 1,
    },
  },
  {
    id: 'solar_storage', name: 'Solar + Battery Storage', icon: Sun, color: '#fb923c',
    tagline: 'Simulate a day of home solar storage',
    description: 'Model a 24-hour cycle with solar charging during the day and household load discharge in the evening. See the interplay between PV generation, battery state, and energy management.',
    learnPoints: [
      'Solar generation follows a bell curve peaking at noon',
      'Battery charges during PV surplus, discharges during demand',
      'Low C-rates during slow charging minimize degradation',
      'Temperature cycles with ambient and self-heating effects',
    ],
    defaults: {
      profile: 'solar_storage', soc: 0.4, temp: 22, ambientTemp: 22,
      cRate: 0.5, speed: 100, humidity: 45, enableThermal: true, enableDegradation: true,
      enableElectrochemical: true, degradationAccel: 1,
    },
  },
  {
    id: 'cycle_aging', name: 'Accelerated Aging Test', icon: Timer, color: '#a78bfa',
    tagline: 'Watch the battery degrade over many cycles',
    description: 'Run an accelerated aging test to observe capacity fade and resistance growth over hundreds of cycles. The degradation model combines SEI growth, active material loss, and lithium inventory loss.',
    learnPoints: [
      'SEI layer grows proportional to √t (parabolic kinetics)',
      'Cycle aging follows a power law with cycle count',
      'Higher temperatures accelerate all degradation mechanisms',
      'SOH gradually decreases — watch for the "knee" point',
    ],
    defaults: {
      profile: 'cycle_aging', soc: 0.9, temp: 35, ambientTemp: 25,
      cRate: 1.0, speed: 200, humidity: 85, enableThermal: true, enableDegradation: true,
      enableElectrochemical: true, degradationAccel: 100,
    },
  },
  {
    id: 'thermal_runaway', name: 'Thermal Safety Study', icon: Thermometer, color: '#ef4444',
    tagline: 'Explore thermal management failure scenarios',
    description: 'Inject a fault and observe how heat accumulates. Study the interplay between heat generation, cooling capacity, and the thermal runaway threshold. Key for understanding BMS safety limits.',
    learnPoints: [
      'Joule heating (I²R) is the primary heat source during operation',
      'Thermal runaway starts when heat generation exceeds dissipation',
      'Separator shutdown occurs around 130°C in most cells',
      'BMS should disconnect load before critical temperature',
    ],
    defaults: {
      profile: 'constant_discharge', soc: 1.0, temp: 40, ambientTemp: 45,
      cRate: 3.0, speed: 15, humidity: 60, enableThermal: true, enableDegradation: true,
      enableElectrochemical: true, degradationAccel: 1,
    },
  },
];

/* ── Step indicator ──────────────────────────────────────── */
function StepIndicator({ step, total }: { step: number; total: number }) {
  return (
    <div className="flex items-center gap-2">
      {Array.from({ length: total }, (_, i) => (
        <div key={i} className="flex items-center gap-2">
          <motion.div
            className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold border-2 transition-all
              ${i < step ? 'bg-green-500/20 border-green-500 text-green-400' :
                i === step ? 'bg-blue-500/20 border-blue-500 text-blue-400' :
                'bg-white/[0.04] border-white/[0.1] text-panel-muted'}`}
            animate={i === step ? { scale: [1, 1.1, 1] } : {}}
            transition={{ duration: 0.5, repeat: i === step ? Infinity : 0, repeatDelay: 2 }}
          >
            {i < step ? <Check className="w-4 h-4" /> : i + 1}
          </motion.div>
          {i < total - 1 && (
            <div className={`w-12 h-0.5 rounded ${i < step ? 'bg-green-500/40' : 'bg-white/[0.08]'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

/* ── Main Component ─────────────────────────────────────── */
export default function ScenarioWizard() {
  const [step, setStep] = useState(0); // 0: pick, 1: customize, 2: review & launch
  const [selectedScenario, setSelectedScenario] = useState<ScenarioDef | null>(null);
  const [params, setParams] = useState(SCENARIOS[0].defaults);
  const [launching, setLaunching] = useState(false);
  const [launched, setLaunched] = useState(false);
  const setSelectedView = useBatteryStore((s: any) => s.setSelectedView);

  const handleSelect = useCallback((sc: ScenarioDef) => {
    setSelectedScenario(sc);
    setParams({ ...sc.defaults });
    setStep(1);
    setLaunched(false);
  }, []);

  const handleLaunch = useCallback(async () => {
    if (!selectedScenario) return;
    setLaunching(true);

    try {
      // 1. Configure cell
      await fetch(`${API_BASE}/configure/cell`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nominal_capacity_ah: 50,
          initial_soc: params.soc,
          initial_temperature_c: params.temp,
          enable_thermal: params.enableThermal,
          enable_degradation: params.enableDegradation,
          enable_electrochemical: params.enableElectrochemical,
        }),
      });

      // 2. Set profile
      const profileParams: Record<string, number> = {};
      if (params.profile.includes('constant') || params.profile === 'cccv_charge' || params.profile === 'cycle_aging') {
        profileParams.c_rate = params.cRate;
      }
      if (params.profile === 'cycle_aging') profileParams.num_cycles = 50;
      if (params.profile === 'solar_storage') profileParams.pv_peak_kw = 5;
      if (params.profile === 'drive_cycle') profileParams.aggressiveness = 1;

      await fetch(`${API_BASE}/profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ profile_type: params.profile, params: profileParams }),
      });

      // 3. Set speed & degradation acceleration
      await fetch(`${API_BASE}/configure/simulation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          speed_multiplier: params.speed,
          degradation_acceleration: params.degradationAccel,
          humidity_pct: params.humidity,
        }),
      });

      // 4. Navigate to overview
      setSelectedView('split');
      setLaunched(true);
    } catch (e) {
      console.error('Scenario launch failed:', e);
    } finally {
      setLaunching(false);
    }
  }, [selectedScenario, params, setSelectedView]);

  const updateParam = useCallback((key: string, value: any) => {
    setParams((p) => ({ ...p, [key]: value }));
  }, []);

  return (
    <div className="h-full flex flex-col gap-4 p-4 overflow-y-auto text-white">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-indigo-500/10 border border-indigo-500/20">
            <Rocket className="w-6 h-6 text-indigo-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold">Scenario Wizard</h2>
            <p className="text-xs text-panel-muted">Choose a scenario, customize, and launch your simulation</p>
          </div>
        </div>
        <StepIndicator step={step} total={3} />
      </div>

      <AnimatePresence mode="wait">
        {/* ── Step 0: Pick Scenario ───────────────────── */}
        {step === 0 && (
          <motion.div
            key="pick"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
          >
            {SCENARIOS.map((sc) => {
              const Icon = sc.icon;
              return (
                <motion.button
                  key={sc.id}
                  onClick={() => handleSelect(sc)}
                  whileHover={{ scale: 1.02, y: -2 }}
                  whileTap={{ scale: 0.98 }}
                  className="p-5 rounded-xl border border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.05]
                             text-left transition-colors group"
                >
                  <div className="flex items-center gap-3 mb-3">
                    <div className="p-2 rounded-lg" style={{ background: `${sc.color}15`, border: `1px solid ${sc.color}30` }}>
                      <Icon className="w-5 h-5" style={{ color: sc.color }} />
                    </div>
                    <h3 className="text-sm font-semibold group-hover:text-white transition-colors">{sc.name}</h3>
                  </div>
                  <p className="text-xs text-panel-muted leading-relaxed">{sc.tagline}</p>
                  <div className="mt-3 flex items-center gap-1 text-[10px]" style={{ color: sc.color }}>
                    <span>Explore</span>
                    <ArrowRight className="w-3 h-3 group-hover:translate-x-1 transition-transform" />
                  </div>
                </motion.button>
              );
            })}
          </motion.div>
        )}

        {/* ── Step 1: Customize ───────────────────────── */}
        {step === 1 && selectedScenario && (
          <motion.div
            key="customize"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="space-y-4"
          >
            {/* Scenario info */}
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5">
              <div className="flex items-start gap-3">
                {(() => { const Icon = selectedScenario.icon; return (
                  <div className="p-2 rounded-lg shrink-0" style={{ background: `${selectedScenario.color}15` }}>
                    <Icon className="w-5 h-5" style={{ color: selectedScenario.color }} />
                  </div>
                ); })()}
                <div>
                  <h3 className="text-sm font-semibold" style={{ color: selectedScenario.color }}>{selectedScenario.name}</h3>
                  <p className="text-xs text-panel-muted mt-1 leading-relaxed max-w-2xl">{selectedScenario.description}</p>
                </div>
              </div>

              {/* What to learn */}
              <div className="mt-4 bg-white/[0.02] rounded-lg p-3 border border-white/[0.04]">
                <div className="flex items-center gap-2 mb-2">
                  <Info className="w-3.5 h-3.5 text-blue-400" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-blue-400">What to observe</span>
                </div>
                <ul className="space-y-1.5">
                  {selectedScenario.learnPoints.map((point, i) => (
                    <li key={i} className="text-xs text-slate-300 flex items-start gap-2">
                      <span className="text-blue-400/60 mt-0.5">•</span>
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
            </div>

            {/* Parameter customization */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {[
                { key: 'soc', label: 'Initial SOC', value: params.soc, min: 0.05, max: 1, step: 0.05, unit: '', format: (v: number) => `${(v * 100).toFixed(0)}%`, color: '#22c55e', icon: Battery },
                { key: 'temp', label: 'Cell Temperature', value: params.temp, min: -20, max: 60, step: 1, unit: '°C', format: (v: number) => `${v}°C`, color: '#ef4444', icon: Thermometer },
                { key: 'ambientTemp', label: 'Ambient Temp', value: params.ambientTemp, min: -20, max: 60, step: 1, unit: '°C', format: (v: number) => `${v}°C`, color: '#f97316', icon: Thermometer },
                { key: 'cRate', label: 'C-Rate', value: params.cRate, min: 0.1, max: 5, step: 0.1, unit: 'C', format: (v: number) => `${v.toFixed(1)}C`, color: '#f59e0b', icon: Zap },
                { key: 'speed', label: 'Sim Speed', value: params.speed, min: 1, max: 200, step: 1, unit: 'x', format: (v: number) => `${v}x`, color: '#3b82f6', icon: Gauge },
                { key: 'humidity', label: 'Humidity', value: params.humidity, min: 0, max: 100, step: 5, unit: '%RH', format: (v: number) => `${v}%`, color: '#06b6d4', icon: Droplets },
                { key: 'degradationAccel', label: 'Aging Accel', value: params.degradationAccel, min: 1, max: 1000, step: 10, unit: 'x', format: (v: number) => `${v}x`, color: '#a78bfa', icon: Timer },
              ].map((ctrl) => {
                const Icon = ctrl.icon;
                return (
                  <div key={ctrl.key} className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5">
                        <Icon className="w-3.5 h-3.5" style={{ color: ctrl.color }} />
                        <span className="text-xs text-slate-300">{ctrl.label}</span>
                      </div>
                      <span className="text-sm font-bold" style={{ color: ctrl.color }}>
                        {ctrl.format(ctrl.value)}
                      </span>
                    </div>
                    <input
                      type="range" min={ctrl.min} max={ctrl.max} step={ctrl.step}
                      value={ctrl.value}
                      onChange={(e) => updateParam(ctrl.key, +e.target.value)}
                      className="w-full h-2 rounded-full appearance-none cursor-pointer"
                      style={{
                        background: `linear-gradient(to right, ${ctrl.color} ${((ctrl.value - ctrl.min) / (ctrl.max - ctrl.min)) * 100}%, rgba(255,255,255,0.08) ${((ctrl.value - ctrl.min) / (ctrl.max - ctrl.min)) * 100}%)`,
                      }}
                    />
                  </div>
                );
              })}
            </div>

            {/* Model toggles */}
            <div className="flex gap-3 flex-wrap">
              {[
                { key: 'enableThermal', label: 'Thermal Model', value: params.enableThermal },
                { key: 'enableDegradation', label: 'Degradation', value: params.enableDegradation },
                { key: 'enableElectrochemical', label: 'Electrochemical', value: params.enableElectrochemical },
              ].map((toggle) => (
                <button
                  key={toggle.key}
                  onClick={() => updateParam(toggle.key, !toggle.value)}
                  className={`px-3 py-1.5 rounded-lg text-xs border transition-all ${
                    toggle.value
                      ? 'bg-blue-500/15 border-blue-500/30 text-blue-400'
                      : 'bg-white/[0.02] border-white/[0.08] text-panel-muted'
                  }`}
                >
                  {toggle.value ? '✓ ' : ''}{toggle.label}
                </button>
              ))}
            </div>

            {/* Navigation */}
            <div className="flex justify-between pt-2">
              <button
                onClick={() => setStep(0)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm text-panel-muted hover:text-white
                           border border-white/[0.08] hover:bg-white/[0.04] transition-colors"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>
              <button
                onClick={() => setStep(2)}
                className="flex items-center gap-2 px-6 py-2 rounded-lg text-sm font-semibold
                           bg-blue-600/80 hover:bg-blue-600 text-white transition-colors"
              >
                Review <ArrowRight className="w-4 h-4" />
              </button>
            </div>
          </motion.div>
        )}

        {/* ── Step 2: Review & Launch ─────────────────── */}
        {step === 2 && selectedScenario && (
          <motion.div
            key="review"
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="space-y-4"
          >
            <div className="bg-white/[0.03] border border-white/[0.06] rounded-xl p-5">
              <h3 className="text-sm font-semibold mb-3" style={{ color: selectedScenario.color }}>
                Ready to Launch: {selectedScenario.name}
              </h3>

              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {[
                  { label: 'Profile', value: params.profile.replace(/_/g, ' ') },
                  { label: 'Initial SOC', value: `${(params.soc * 100).toFixed(0)}%` },
                  { label: 'Cell Temp', value: `${params.temp}°C` },
                  { label: 'Ambient', value: `${params.ambientTemp}°C` },
                  { label: 'C-Rate', value: `${params.cRate.toFixed(1)}C` },
                  { label: 'Speed', value: `${params.speed}x` },
                  { label: 'Humidity', value: `${params.humidity}% RH` },
                  { label: 'Aging Accel', value: `${params.degradationAccel}x` },
                  { label: 'Thermal', value: params.enableThermal ? 'ON' : 'OFF' },
                ].map((item) => (
                  <div key={item.label} className="bg-white/[0.02] rounded-lg p-2.5 border border-white/[0.04]">
                    <div className="text-[9px] text-panel-muted uppercase">{item.label}</div>
                    <div className="text-sm font-semibold capitalize mt-0.5">{item.value}</div>
                  </div>
                ))}
              </div>
            </div>

            {launched && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-green-500/10 border border-green-500/30 rounded-xl p-4 flex items-center gap-3"
              >
                <Check className="w-5 h-5 text-green-400" />
                <div>
                  <div className="text-sm font-semibold text-green-400">Scenario configured successfully!</div>
                  <div className="text-xs text-panel-muted mt-0.5">
                    Open the <strong>Controls drawer</strong> and press <strong>Start</strong> to begin the simulation.
                    Switch to the <strong>Overview</strong> tab to watch it run.
                  </div>
                </div>
              </motion.div>
            )}

            {/* Navigation */}
            <div className="flex justify-between pt-2">
              <button
                onClick={() => setStep(1)}
                className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm text-panel-muted hover:text-white
                           border border-white/[0.08] hover:bg-white/[0.04] transition-colors"
              >
                <ArrowLeft className="w-4 h-4" /> Customize
              </button>
              <button
                onClick={handleLaunch}
                disabled={launching}
                className="flex items-center gap-2 px-8 py-2.5 rounded-lg text-sm font-bold
                           bg-gradient-to-r from-green-600 to-emerald-600 hover:from-green-500 hover:to-emerald-500
                           text-white transition-all shadow-lg shadow-green-900/30
                           disabled:opacity-50"
              >
                {launching ? (
                  <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
                    <Gauge className="w-4 h-4" />
                  </motion.div>
                ) : (
                  <Play className="w-4 h-4" />
                )}
                {launching ? 'Configuring...' : 'Launch Scenario'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
