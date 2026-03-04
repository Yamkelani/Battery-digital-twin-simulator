/**
 * Fault Injection Panel — Simulate battery faults for testing
 *
 * Allows injecting internal shorts, thermal runaway, sensor drift,
 * and capacity fade to test system responses and BMS behavior.
 */

import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Flame, Radio, BatteryWarning, X, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { API_BASE } from '../config';

interface FaultType {
  id: string;
  label: string;
  description: string;
  icon: typeof AlertTriangle;
  color: string;
}

const FAULT_TYPES: FaultType[] = [
  {
    id: 'internal_short',
    label: 'Internal Short',
    description: 'Parallel leakage resistance draining current and generating heat',
    icon: Zap,
    color: '#ef4444',
  },
  {
    id: 'thermal_runaway',
    label: 'Thermal Runaway',
    description: 'Exothermic self-heating cascade — temperature rises uncontrollably',
    icon: Flame,
    color: '#f97316',
  },
  {
    id: 'sensor_drift',
    label: 'Sensor Drift',
    description: 'Progressive offset in voltage and temperature sensor readings',
    icon: Radio,
    color: '#eab308',
  },
  {
    id: 'capacity_fade',
    label: 'Capacity Fade',
    description: 'Instant capacity reduction — simulates sudden degradation event',
    icon: BatteryWarning,
    color: '#a855f7',
  },
];

export default function FaultInjectionPanel() {
  const [expanded, setExpanded] = useState(false);
  const [activeFaults, setActiveFaults] = useState<Set<string>>(new Set());
  const [severity, setSeverity] = useState(0.5);

  const injectFault = useCallback(
    async (faultId: string) => {
      try {
        const resp = await fetch(`${API_BASE}/fault/inject`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fault_type: faultId,
            severity,
            delay_s: 0,
          }),
        });
        const data = await resp.json();
        if (data.status === 'ok') {
          setActiveFaults((prev) => new Set(prev).add(faultId));
          toast.warning(`Fault injected: ${data.message}`, { duration: 4000 });
        }
      } catch {
        toast.error('Failed to inject fault');
      }
    },
    [severity],
  );

  const clearFaults = useCallback(async () => {
    try {
      await fetch(`${API_BASE}/fault/clear`, { method: 'POST' });
      setActiveFaults(new Set());
      toast.success('All faults cleared');
    } catch {
      toast.error('Failed to clear faults');
    }
  }, []);

  return (
    <div className="space-y-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 w-full"
      >
        <AlertTriangle className="w-3.5 h-3.5 text-orange-400" />
        <span className="text-[10px] text-panel-muted uppercase tracking-wider font-semibold">
          Fault Injection
        </span>
        {activeFaults.size > 0 && (
          <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-400 font-bold">
            {activeFaults.size} active
          </span>
        )}
      </button>

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden space-y-2"
          >
            {/* Severity slider */}
            <div>
              <label className="text-[10px] text-panel-muted flex items-center justify-between">
                <span>Severity: {(severity * 100).toFixed(0)}%</span>
                <span className="text-[9px]">
                  {severity < 0.3 ? 'Mild' : severity < 0.7 ? 'Moderate' : 'Severe'}
                </span>
              </label>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={severity}
                onChange={(e) => setSeverity(Number(e.target.value))}
                className="w-full h-1.5 rounded-lg appearance-none cursor-pointer"
                style={{
                  background: `linear-gradient(to right, #22c55e, #eab308, #ef4444)`,
                }}
              />
            </div>

            {/* Fault buttons */}
            <div className="grid grid-cols-2 gap-1.5">
              {FAULT_TYPES.map((fault) => {
                const Icon = fault.icon;
                const isActive = activeFaults.has(fault.id);
                return (
                  <button
                    key={fault.id}
                    onClick={() => injectFault(fault.id)}
                    className={`p-2 rounded-lg border text-left transition-all text-[10px]
                      ${isActive
                        ? 'border-red-500/40 bg-red-500/10 ring-1 ring-red-500/20'
                        : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.06]'
                      }`}
                  >
                    <Icon className="w-3.5 h-3.5 mb-1" style={{ color: fault.color }} />
                    <p className="font-semibold text-white/90">{fault.label}</p>
                    <p className="text-panel-muted/70 mt-0.5 line-clamp-2" style={{ fontSize: 9 }}>
                      {fault.description}
                    </p>
                    {isActive && (
                      <span className="inline-block mt-1 text-[8px] px-1 py-0.5 rounded bg-red-500/20 text-red-400">
                        ACTIVE
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Clear all button */}
            {activeFaults.size > 0 && (
              <button
                onClick={clearFaults}
                className="w-full py-1.5 px-3 rounded-lg text-xs font-medium
                           border border-green-500/20 bg-green-500/10 text-green-400
                           hover:bg-green-500/20 transition-colors flex items-center justify-center gap-1.5"
              >
                <X className="w-3 h-3" />
                Clear All Faults
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
