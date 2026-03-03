/**
 * ML Dataset Export Panel
 *
 * Allows users to configure and download ML-ready battery cycling datasets.
 * Supports CSV and JSON export with configurable cycling parameters.
 */

import { useState, useCallback } from 'react';

const API_BASE = 'http://localhost:8001/api';

interface MLConfig {
  num_cycles: number;
  sample_interval_s: number;
  c_rate: number;
  temperature_c: number;
  soc_upper: number;
  soc_lower: number;
  include_eis: boolean;
  capacity_ah: number;
  noise_sigma: number;
  format: 'csv' | 'json';
}

const DEFAULT_CONFIG: MLConfig = {
  num_cycles: 200,
  sample_interval_s: 10,
  c_rate: 1.0,
  temperature_c: 25,
  soc_upper: 1.0,
  soc_lower: 0.1,
  include_eis: false,
  capacity_ah: 50,
  noise_sigma: 0.002,
  format: 'csv',
};

const PRESETS: Record<string, Partial<MLConfig> & { label: string; description: string }> = {
  soh_prediction: {
    label: 'SOH Prediction',
    description: 'Long cycling for state-of-health estimation model',
    num_cycles: 500,
    sample_interval_s: 30,
    c_rate: 1.0,
    temperature_c: 25,
    noise_sigma: 0.002,
  },
  rul_estimation: {
    label: 'RUL Estimation',
    description: 'Extended aging for remaining useful life prediction',
    num_cycles: 1000,
    sample_interval_s: 60,
    c_rate: 0.5,
    temperature_c: 30,
    noise_sigma: 0.001,
  },
  anomaly_detection: {
    label: 'Anomaly Detection',
    description: 'Dense sampling at varying conditions for anomaly models',
    num_cycles: 100,
    sample_interval_s: 5,
    c_rate: 2.0,
    temperature_c: 35,
    noise_sigma: 0.005,
  },
  degradation_modes: {
    label: 'Degradation Modes',
    description: 'Multi-mechanism dataset with SEI, cycling & plating labels',
    num_cycles: 300,
    sample_interval_s: 10,
    c_rate: 1.5,
    temperature_c: 20,
    include_eis: true,
    noise_sigma: 0.002,
  },
  eis_capacity: {
    label: 'EIS-based Capacity',
    description: 'Impedance-focused dataset for capacity estimation from EIS',
    num_cycles: 200,
    sample_interval_s: 30,
    c_rate: 0.5,
    temperature_c: 25,
    include_eis: true,
    noise_sigma: 0.001,
  },
};

export default function MLExportPanel() {
  const [config, setConfig] = useState<MLConfig>({ ...DEFAULT_CONFIG });
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');

  const applyPreset = useCallback((key: string) => {
    const preset = PRESETS[key];
    if (!preset) return;
    setConfig(prev => ({ ...prev, ...preset }));
    setError('');
  }, []);

  const estimateRows = useCallback(() => {
    const stepsPerCycle = (config.capacity_ah / (config.c_rate * config.capacity_ah)) * 3600 / config.sample_interval_s;
    const rows = Math.round(stepsPerCycle * 2 * config.num_cycles);
    return rows;
  }, [config]);

  const estimateSize = useCallback(() => {
    const rows = estimateRows();
    const bytesPerRow = config.format === 'csv' ? 200 : 350;
    const totalMB = (rows * bytesPerRow) / (1024 * 1024);
    return totalMB;
  }, [estimateRows, config.format]);

  const generate = useCallback(async () => {
    setGenerating(true);
    setError('');
    setProgress('Generating dataset... This may take a moment for large cycle counts.');

    try {
      const resp = await fetch(`${API_BASE}/export/ml-dataset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });

      if (!resp.ok) {
        const errText = await resp.text();
        throw new Error(errText);
      }

      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `battery_ml_dataset.${config.format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setProgress(`Dataset downloaded (${(blob.size / (1024 * 1024)).toFixed(1)} MB)`);
    } catch (err: any) {
      setError(err.message || 'Export failed');
      setProgress('');
    } finally {
      setGenerating(false);
    }
  }, [config]);

  const numericInput = (
    label: string,
    key: keyof MLConfig,
    min: number,
    max: number,
    step: number,
    unit?: string,
  ) => (
    <div className="flex items-center justify-between gap-2">
      <label className="text-[11px] text-panel-muted whitespace-nowrap">{label}</label>
      <div className="flex items-center gap-1">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={config[key] as number}
          onChange={(e) => setConfig(prev => ({ ...prev, [key]: parseFloat(e.target.value) || min }))}
          className="w-20 px-1.5 py-0.5 rounded bg-panel-bg border border-panel-border text-[11px] text-panel-text text-right"
        />
        {unit && <span className="text-[9px] text-panel-muted w-6">{unit}</span>}
      </div>
    </div>
  );

  return (
    <div className="flex-1 overflow-y-auto p-4 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <div className="p-2 rounded-lg bg-gradient-to-br from-purple-600/20 to-blue-600/20">
          <span className="text-xl">🧠</span>
        </div>
        <div>
          <h2 className="text-sm font-bold text-panel-text">ML Dataset Generator</h2>
          <p className="text-[10px] text-panel-muted">
            Generate battery cycling datasets for training ML models
          </p>
        </div>
      </div>

      {/* Presets */}
      <div>
        <p className="text-[10px] font-semibold text-panel-muted uppercase tracking-wider mb-1.5">
          Quick Presets
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {Object.entries(PRESETS).map(([key, preset]) => (
            <button
              key={key}
              onClick={() => applyPreset(key)}
              className="text-left px-2 py-1.5 rounded-lg bg-panel-bg border border-panel-border hover:border-blue-500/50 hover:bg-blue-600/5 transition-colors"
            >
              <div className="text-[10px] font-medium text-panel-text">{preset.label}</div>
              <div className="text-[9px] text-panel-muted leading-tight">{preset.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Configuration */}
      <div className="space-y-2 bg-panel-bg rounded-lg p-3 border border-panel-border">
        <p className="text-[10px] font-semibold text-panel-muted uppercase tracking-wider">
          Configuration
        </p>
        {numericInput('Cycles', 'num_cycles', 1, 5000, 1)}
        {numericInput('Sample interval', 'sample_interval_s', 1, 300, 1, 's')}
        {numericInput('C-rate', 'c_rate', 0.1, 5, 0.1, 'C')}
        {numericInput('Temperature', 'temperature_c', -10, 60, 1, '°C')}
        {numericInput('SOC upper', 'soc_upper', 0.5, 1.0, 0.05)}
        {numericInput('SOC lower', 'soc_lower', 0.0, 0.5, 0.05)}
        {numericInput('Capacity', 'capacity_ah', 1, 500, 1, 'Ah')}
        {numericInput('Sensor noise σ', 'noise_sigma', 0, 0.05, 0.001)}

        <div className="flex items-center justify-between gap-2">
          <label className="text-[11px] text-panel-muted">Include EIS</label>
          <input
            type="checkbox"
            checked={config.include_eis}
            onChange={(e) => setConfig(prev => ({ ...prev, include_eis: e.target.checked }))}
            className="accent-blue-500"
          />
        </div>

        <div className="flex items-center justify-between gap-2">
          <label className="text-[11px] text-panel-muted">Format</label>
          <div className="flex gap-1">
            {(['csv', 'json'] as const).map(fmt => (
              <button
                key={fmt}
                onClick={() => setConfig(prev => ({ ...prev, format: fmt }))}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                  config.format === fmt
                    ? 'bg-blue-600 text-white'
                    : 'bg-panel-surface text-panel-muted hover:text-panel-text'
                }`}
              >
                {fmt.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Estimate */}
      <div className="bg-panel-bg rounded-lg p-3 border border-panel-border space-y-1">
        <p className="text-[10px] font-semibold text-panel-muted uppercase tracking-wider">
          Estimate
        </p>
        <div className="flex justify-between text-[11px]">
          <span className="text-panel-muted">Rows</span>
          <span className="text-panel-text font-medium">~{estimateRows().toLocaleString()}</span>
        </div>
        <div className="flex justify-between text-[11px]">
          <span className="text-panel-muted">File size</span>
          <span className="text-panel-text font-medium">~{estimateSize().toFixed(1)} MB</span>
        </div>
      </div>

      {/* ML Targets Info */}
      <div className="bg-panel-bg rounded-lg p-3 border border-panel-border">
        <p className="text-[10px] font-semibold text-panel-muted uppercase tracking-wider mb-1.5">
          Suggested ML Targets
        </p>
        <div className="space-y-1.5">
          {[
            { label: 'SOH Prediction', desc: 'Target: soh_pct — Features: V, I, T, Ah, cycle' },
            { label: 'RUL Estimation', desc: 'Target: rul_cycles — Features: SOH, R, Ah, DOD' },
            { label: 'Degradation Modes', desc: 'Target: SEI / cycle / plating loss — Features: V, I, T' },
            { label: 'Anomaly Detection', desc: 'Features: V, T, dV/dt, heat — detect outliers' },
            { label: 'Capacity from EIS', desc: 'Target: capacity_retention — Features: Z_re, Z_im' },
          ].map(({ label, desc }) => (
            <div key={label}>
              <div className="text-[10px] font-medium text-blue-400">{label}</div>
              <div className="text-[9px] text-panel-muted">{desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Dataset Columns */}
      <div className="bg-panel-bg rounded-lg p-3 border border-panel-border">
        <p className="text-[10px] font-semibold text-panel-muted uppercase tracking-wider mb-1.5">
          Dataset Columns (24)
        </p>
        <div className="flex flex-wrap gap-1">
          {[
            'cycle', 'step', 'time_s', 'current_a', 'voltage_v', 'soc',
            'temperature_c', 'soh_pct', 'sei_loss_pct', 'cycle_loss_pct',
            'plating_loss_pct', 'resistance_factor', 'capacity_retention',
            'ah_throughput', 'energy_wh', 'heat_gen_w', 'dv_dt', 'di_dt',
            'rul_cycles', 'is_charging', 'c_rate', 'dod',
            'impedance_re', 'impedance_im',
          ].map(col => (
            <span
              key={col}
              className="px-1.5 py-0.5 rounded bg-panel-surface text-[9px] text-panel-muted border border-panel-border"
            >
              {col}
            </span>
          ))}
        </div>
      </div>

      {/* Generate Button */}
      <button
        onClick={generate}
        disabled={generating}
        className={`w-full py-2.5 rounded-lg font-semibold text-sm transition-all ${
          generating
            ? 'bg-panel-border text-panel-muted cursor-wait'
            : 'bg-gradient-to-r from-purple-600 to-blue-600 text-white hover:from-purple-500 hover:to-blue-500 shadow-lg hover:shadow-purple-600/25'
        }`}
      >
        {generating ? 'Generating...' : `Generate ${config.format.toUpperCase()} Dataset`}
      </button>

      {/* Status */}
      {progress && (
        <div className="text-[11px] text-green-400 bg-green-400/10 rounded px-2 py-1">
          {progress}
        </div>
      )}
      {error && (
        <div className="text-[11px] text-red-400 bg-red-400/10 rounded px-2 py-1 break-words">
          {error}
        </div>
      )}
    </div>
  );
}
