/**
 * Pack Builder UI
 *
 * Configure series / parallel cell count, manufacturing variation,
 * and create a battery pack via REST API (reliable request-response).
 */

import { useState, useCallback } from 'react';
import { useBatteryStore } from '../hooks/useBatteryState';

const API_BASE = `http://${window.location.hostname}:8001/api`;

export default function PackBuilder() {

  const [nSeries, setNSeries] = useState(4);
  const [nParallel, setNParallel] = useState(2);
  const [capacityAh, setCapacityAh] = useState(50);
  const [variationPct, setVariationPct] = useState(2);
  const [enableBalancing, setEnableBalancing] = useState(true);
  const [thermalCoupling, setThermalCoupling] = useState(true);
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConfigure = useCallback(async () => {
    setLoading(true);
    setError(null);

    // Optimistic update — switch to pack view immediately
    useBatteryStore.getState().setPackConfig(nSeries, nParallel, nSeries * nParallel);

    try {
      const res = await fetch(`${API_BASE}/pack/configure`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          n_series: nSeries,
          n_parallel: nParallel,
          capacity_ah: capacityAh,
          variation_pct: variationPct,
          enable_balancing: enableBalancing,
          enable_thermal_coupling: thermalCoupling,
        }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ detail: res.statusText }));
        throw new Error(errData.detail || errData.message || `HTTP ${res.status}`);
      }

      const data = await res.json();
      // Confirm with server's authoritative values
      useBatteryStore.getState().setPackConfig(
        data.n_series ?? nSeries,
        data.n_parallel ?? nParallel,
        data.n_cells ?? nSeries * nParallel,
      );
      setConfigured(true);
    } catch (e: any) {
      // Revert optimistic update on failure
      useBatteryStore.getState().clearPack();
      setError(e.message || 'Failed to configure pack');
      setConfigured(false);
    } finally {
      setLoading(false);
    }
  }, [nSeries, nParallel, capacityAh, variationPct, enableBalancing, thermalCoupling]);

  return (
    <div className="space-y-2">
      <h4 className="text-[10px] text-panel-muted uppercase tracking-wider">
        Pack Configuration
      </h4>

      {/* Topology */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] text-panel-muted">Series</label>
          <input
            type="number"
            min={1}
            max={8}
            value={nSeries}
            onChange={(e) => setNSeries(Math.min(8, Math.max(1, Number(e.target.value) || 1)))}
            className="w-full mt-0.5 p-1.5 bg-panel-surface border border-panel-border rounded text-xs text-panel-text"
          />
        </div>
        <div>
          <label className="text-[10px] text-panel-muted">Parallel</label>
          <input
            type="number"
            min={1}
            max={8}
            value={nParallel}
            onChange={(e) => setNParallel(Math.min(8, Math.max(1, Number(e.target.value) || 1)))}
            className="w-full mt-0.5 p-1.5 bg-panel-surface border border-panel-border rounded text-xs text-panel-text"
          />
        </div>
      </div>

      {/* Cell capacity */}
      <div>
        <label className="text-[10px] text-panel-muted">
          Cell Capacity: {capacityAh} Ah
        </label>
        <input
          type="range"
          min={5}
          max={200}
          step={5}
          value={capacityAh}
          onChange={(e) => setCapacityAh(Number(e.target.value))}
          className="w-full h-1.5 rounded-lg appearance-none cursor-pointer accent-blue-500 bg-panel-border"
        />
      </div>

      {/* Variation */}
      <div>
        <label className="text-[10px] text-panel-muted">
          Mfg Variation: {variationPct}%
        </label>
        <input
          type="range"
          min={0}
          max={10}
          step={0.5}
          value={variationPct}
          onChange={(e) => setVariationPct(Number(e.target.value))}
          className="w-full h-1.5 rounded-lg appearance-none cursor-pointer accent-blue-500 bg-panel-border"
        />
      </div>

      {/* Toggles */}
      <div className="flex items-center justify-between text-xs text-panel-muted">
        <span>Passive Balancing</span>
        <button
          onClick={() => setEnableBalancing(!enableBalancing)}
          className={`w-9 h-5 rounded-full transition-colors relative ${
            enableBalancing ? 'bg-blue-600' : 'bg-panel-border'
          }`}
        >
          <div
            className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
              enableBalancing ? 'translate-x-4' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>

      <div className="flex items-center justify-between text-xs text-panel-muted">
        <span>Thermal Coupling</span>
        <button
          onClick={() => setThermalCoupling(!thermalCoupling)}
          className={`w-9 h-5 rounded-full transition-colors relative ${
            thermalCoupling ? 'bg-blue-600' : 'bg-panel-border'
          }`}
        >
          <div
            className={`absolute top-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
              thermalCoupling ? 'translate-x-4' : 'translate-x-0.5'
            }`}
          />
        </button>
      </div>

      {/* Build button */}
      <button
        onClick={handleConfigure}
        disabled={loading}
        className={`w-full py-2 px-3 rounded-lg font-semibold text-white text-xs transition-colors ${
          loading
            ? 'bg-indigo-400 cursor-wait'
            : 'bg-indigo-600 hover:bg-indigo-500'
        }`}
      >
        {loading ? '⏳ Configuring...' : configured ? '✓ Reconfigure Pack' : '⚡ Build Pack'}
      </button>

      {error && (
        <p className="text-[10px] text-red-400 text-center">
          Error: {error}
        </p>
      )}

      {configured && !error && (
        <p className="text-[10px] text-green-400 text-center">
          Pack: {nSeries}S{nParallel}P — {nSeries * nParallel} cells
        </p>
      )}
    </div>
  );
}
