/**
 * Simulation Controls
 *
 * Control panel for managing the simulation:
 *   - Start / Pause / Resume / Reset buttons
 *   - Load profile selection
 *   - Simulation speed slider
 *   - Initial conditions (SOC, temperature)
 *   - Model toggles (thermal, degradation, electrochemical)
 */

import { useState, useCallback } from 'react';
import { useBatteryStore } from '../hooks/useBatteryState';
import { useSimulation } from '../hooks/useSimulation';
import ExportButton from './ExportButton';
import PackBuilder from './PackBuilder';

export default function Controls() {
  const {
    status,
    start,
    stop,
    pause,
    resume,
    reset,
    setSimSpeed,
    setProfile,
    setAmbientTemp,
    configureCell,
  } = useSimulation();

  const speed = useBatteryStore((s) => s.speed);
  const setSpeed = useBatteryStore((s) => s.setSpeed);
  const profiles = useBatteryStore((s) => s.profiles);
  const activeProfile = useBatteryStore((s) => s.activeProfile);
  const setActiveProfile = useBatteryStore((s) => s.setActiveProfile);

  // Local state for controls
  const [initialSOC, setInitialSOC] = useState(0.8);
  const [initialTemp, setInitialTemp] = useState(25);
  const [ambientTemp, setAmbientTempLocal] = useState(25);
  const [cRate, setCRate] = useState(0.5);
  const [pvPeak, setPvPeak] = useState(5.0);
  const [aggressiveness, setAggressiveness] = useState(1.0);
  const [enableThermal, setEnableThermal] = useState(true);
  const [enableDegradation, setEnableDegradation] = useState(true);
  const [enableElectrochemical, setEnableElectrochemical] = useState(true);
  const [degradationAccel, setDegradationAccel] = useState(1);

  const handleProfileChange = useCallback(
    (profileId: string) => {
      setActiveProfile(profileId);
      const params: Record<string, number> = {};

      switch (profileId) {
        case 'constant_discharge':
        case 'constant_charge':
          params.c_rate = cRate;
          break;
        case 'cccv_charge':
          params.c_rate = cRate;
          break;
        case 'drive_cycle':
          params.aggressiveness = aggressiveness;
          params.duration_s = 3600;
          break;
        case 'solar_storage':
          params.pv_peak_kw = pvPeak;
          params.duration_s = 86400;
          break;
        case 'cycle_aging':
          params.c_rate = cRate;
          params.num_cycles = 50;
          break;
      }

      setProfile(profileId, params);
    },
    [cRate, aggressiveness, pvPeak, setProfile, setActiveProfile],
  );

  const handleSpeedChange = useCallback(
    (val: number) => {
      setSpeed(val);
      setSimSpeed(val);
    },
    [setSpeed, setSimSpeed],
  );

  const handleReset = useCallback(() => {
    reset(initialSOC, initialTemp, true);
  }, [reset, initialSOC, initialTemp]);

  const handleAmbientTemp = useCallback(
    (val: number) => {
      setAmbientTempLocal(val);
      setAmbientTemp(val);
    },
    [setAmbientTemp],
  );

  const handleReconfigure = useCallback(() => {
    configureCell({
      capacity_ah: 50,
      soc: initialSOC,
      temperature_c: initialTemp,
      enable_thermal: enableThermal,
      enable_degradation: enableDegradation,
      enable_electrochemical: enableElectrochemical,
      degradation_acceleration: degradationAccel,
    });
  }, [configureCell, initialSOC, initialTemp, enableThermal, enableDegradation, enableElectrochemical, degradationAccel]);

  const isRunning = status === 'running';
  const isPaused = status === 'paused';
  const isIdle = status === 'idle' || status === 'completed';
  const isActive = !isIdle && status !== 'connecting' && status !== 'error';

  return (
    <div className="p-3 space-y-3 overflow-y-auto max-h-full text-panel-text text-sm">
      {/* Status indicator */}
      <div className="flex items-center gap-2 mb-2">
        <div
          className={`w-2.5 h-2.5 rounded-full ${
            isRunning
              ? 'bg-green-500 animate-pulse'
              : isPaused
                ? 'bg-yellow-500'
                : status === 'connecting'
                  ? 'bg-blue-500 animate-pulse'
                  : status === 'error'
                    ? 'bg-red-500'
                    : 'bg-gray-500'
          }`}
        />
        <span className="text-xs uppercase tracking-wider text-panel-muted">
          {status}
        </span>
      </div>

      {/* ─── Playback Controls ──────────────────────────────────── */}
      <div className="flex gap-2">
        {isIdle && (
          <button
            onClick={start}
            className="flex-1 py-2 px-3 bg-green-600 hover:bg-green-500 rounded-lg font-semibold text-white text-xs transition-colors"
          >
            ▶ Start
          </button>
        )}
        {isRunning && (
          <button
            onClick={pause}
            className="flex-1 py-2 px-3 bg-yellow-600 hover:bg-yellow-500 rounded-lg font-semibold text-white text-xs transition-colors"
          >
            ⏸ Pause
          </button>
        )}
        {isPaused && (
          <button
            onClick={resume}
            className="flex-1 py-2 px-3 bg-blue-600 hover:bg-blue-500 rounded-lg font-semibold text-white text-xs transition-colors"
          >
            ▶ Resume
          </button>
        )}
        {isActive && (
          <button
            onClick={stop}
            className="py-2 px-3 bg-red-600 hover:bg-red-500 rounded-lg font-semibold text-white text-xs transition-colors"
          >
            ⏹ Stop
          </button>
        )}
        <button
          onClick={handleReset}
          className="py-2 px-3 bg-panel-surface hover:bg-panel-border rounded-lg text-xs border border-panel-border transition-colors"
        >
          ↺ Reset
        </button>
      </div>

      {/* ─── Speed Control ──────────────────────────────────────── */}
      <div>
        <label className="text-[10px] text-panel-muted uppercase tracking-wider">
          Simulation Speed: {speed}x
        </label>
        <input
          type="range"
          min="1"
          max="200"
          step="1"
          value={speed}
          onChange={(e) => handleSpeedChange(Number(e.target.value))}
          className="w-full h-1.5 mt-1 rounded-lg appearance-none cursor-pointer accent-blue-500 bg-panel-border"
        />
        <div className="flex justify-between text-[9px] text-panel-muted">
          <span>1x</span>
          <span>100x</span>
          <span>200x</span>
        </div>
      </div>

      {/* ─── Load Profile ───────────────────────────────────────── */}
      <div>
        <label className="text-[10px] text-panel-muted uppercase tracking-wider">
          Load Profile
        </label>
        <select
          value={activeProfile}
          onChange={(e) => handleProfileChange(e.target.value)}
          className="w-full mt-1 p-2 bg-panel-surface border border-panel-border rounded-lg text-xs text-panel-text"
        >
          <option value="constant_discharge">Constant Discharge</option>
          <option value="constant_charge">Constant Charge</option>
          <option value="cccv_charge">CCCV Charging</option>
          <option value="drive_cycle">Drive Cycle (EV)</option>
          <option value="solar_storage">Solar + Storage</option>
          <option value="cycle_aging">Cycle Aging Test</option>
        </select>
      </div>

      {/* Profile-specific params */}
      {(activeProfile.includes('constant') ||
        activeProfile === 'cccv_charge' ||
        activeProfile === 'cycle_aging') && (
        <SliderControl
          label={`C-Rate: ${cRate.toFixed(1)}C`}
          value={cRate}
          min={0.1}
          max={3.0}
          step={0.1}
          onChange={(v) => setCRate(v)}
        />
      )}

      {activeProfile === 'drive_cycle' && (
        <SliderControl
          label={`Aggressiveness: ${aggressiveness.toFixed(1)}x`}
          value={aggressiveness}
          min={0.5}
          max={2.0}
          step={0.1}
          onChange={(v) => setAggressiveness(v)}
        />
      )}

      {activeProfile === 'solar_storage' && (
        <SliderControl
          label={`PV Peak: ${pvPeak.toFixed(1)} kW`}
          value={pvPeak}
          min={1}
          max={15}
          step={0.5}
          onChange={(v) => setPvPeak(v)}
        />
      )}

      {/* ─── Initial Conditions ─────────────────────────────────── */}
      <div className="border-t border-panel-border pt-2">
        <h4 className="text-[10px] text-panel-muted uppercase tracking-wider mb-2">
          Initial Conditions
        </h4>

        <SliderControl
          label={`Initial SOC: ${(initialSOC * 100).toFixed(0)}%`}
          value={initialSOC}
          min={0.05}
          max={1.0}
          step={0.05}
          onChange={setInitialSOC}
        />

        <SliderControl
          label={`Initial Temp: ${initialTemp}°C`}
          value={initialTemp}
          min={-10}
          max={50}
          step={1}
          onChange={setInitialTemp}
        />

        <SliderControl
          label={`Ambient Temp: ${ambientTemp}°C`}
          value={ambientTemp}
          min={-10}
          max={50}
          step={1}
          onChange={handleAmbientTemp}
        />
      </div>

      {/* ─── Model Toggles ──────────────────────────────────────── */}
      <div className="border-t border-panel-border pt-2">
        <h4 className="text-[10px] text-panel-muted uppercase tracking-wider mb-2">
          Physics Models
        </h4>

        <ToggleSwitch label="Thermal Model" value={enableThermal} onChange={setEnableThermal} />
        <ToggleSwitch label="Degradation Model" value={enableDegradation} onChange={setEnableDegradation} />
        <ToggleSwitch label="Electrochemical (SPM)" value={enableElectrochemical} onChange={setEnableElectrochemical} />

        {enableDegradation && (
          <SliderControl
            label={`Aging Acceleration: ${degradationAccel}x`}
            value={degradationAccel}
            min={1}
            max={1000}
            step={10}
            onChange={setDegradationAccel}
          />
        )}

        <button
          onClick={handleReconfigure}
          className="w-full mt-2 py-1.5 px-3 bg-panel-surface hover:bg-panel-border rounded-lg text-xs border border-panel-border transition-colors"
        >
          Apply Configuration
        </button>
      </div>

      {/* ─── Data Export ────────────────────────────────────────── */}
      <div className="border-t border-panel-border pt-2">
        <h4 className="text-[10px] text-panel-muted uppercase tracking-wider mb-2">
          Data Export
        </h4>
        <ExportButton />
      </div>

      {/* ─── Pack Builder ───────────────────────────────────────── */}
      <div className="border-t border-panel-border pt-2">
        <PackBuilder />
      </div>
    </div>
  );
}

// ─── Reusable UI Components ────────────────────────────────────────────────

function SliderControl({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="mb-2">
      <label className="text-[10px] text-panel-muted">{label}</label>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full h-1.5 rounded-lg appearance-none cursor-pointer accent-blue-500 bg-panel-border"
      />
    </div>
  );
}

function ToggleSwitch({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between mb-1.5">
      <span className="text-xs text-panel-muted">{label}</span>
      <button
        onClick={() => onChange(!value)}
        className={`w-9 h-5 rounded-full transition-colors relative ${
          value ? 'bg-blue-600' : 'bg-panel-border'
        }`}
      >
        <div
          className={`w-3.5 h-3.5 bg-white rounded-full absolute top-0.5 transition-transform ${
            value ? 'translate-x-4' : 'translate-x-0.5'
          }`}
        />
      </button>
    </div>
  );
}
