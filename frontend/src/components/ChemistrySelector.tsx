/**
 * Chemistry Selector — Drop-down to switch between battery chemistry presets
 *
 * Fetches available chemistries from the backend API and allows
 * the user to switch chemistry with one click. Shows key specs
 * (voltage, energy density, cycle life) for each option.
 */

import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { FlaskConical, ChevronDown, Zap, Battery, RefreshCw } from 'lucide-react';
import { API_BASE } from '../config';

interface ChemistryInfo {
  id: string;
  name: string;
  description: string;
  cathode: string;
  anode: string;
  nominal_voltage: number;
  voltage_range: [number, number];
  energy_density_wh_kg: number;
  cycle_life: number;
}

export default function ChemistrySelector() {
  const [chemistries, setChemistries] = useState<ChemistryInfo[]>([]);
  const [selected, setSelected] = useState<string>('nmc622');
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);

  // Fetch available chemistries on mount
  useEffect(() => {
    fetch(`${API_BASE}/chemistries`)
      .then((r) => r.json())
      .then((data) => {
        if (data.chemistries) setChemistries(data.chemistries);
      })
      .catch(() => {});
  }, []);

  const handleSelect = useCallback(
    async (id: string) => {
      setSelected(id);
      setExpanded(false);
      setLoading(true);
      try {
        await fetch(`${API_BASE}/configure/chemistry`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chemistry_id: id,
            capacity_ah: 50,
            initial_soc: 0.8,
            initial_temperature_c: 25,
          }),
        });
      } catch {
        /* ignore */
      }
      setLoading(false);
    },
    [],
  );

  const current = chemistries.find((c) => c.id === selected);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <FlaskConical className="w-3.5 h-3.5 text-purple-400" />
        <span className="text-[10px] text-panel-muted uppercase tracking-wider font-semibold">
          Cell Chemistry
        </span>
        {loading && <RefreshCw className="w-3 h-3 text-blue-400 animate-spin" />}
      </div>

      {/* Selected chemistry display */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-2 rounded-lg
                   border border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.06]
                   transition-colors text-left"
      >
        <div>
          <p className="text-xs font-semibold text-white">{current?.name ?? 'NMC622/Graphite'}</p>
          <p className="text-[10px] text-panel-muted mt-0.5">
            {current ? `${current.nominal_voltage}V · ${current.energy_density_wh_kg} Wh/kg · ${current.cycle_life} cycles` : '3.7V · 180 Wh/kg'}
          </p>
        </div>
        <ChevronDown className={`w-4 h-4 text-panel-muted transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {/* Chemistry dropdown */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="space-y-1 pt-1">
              {chemistries.map((chem) => (
                <button
                  key={chem.id}
                  onClick={() => handleSelect(chem.id)}
                  className={`w-full text-left p-2 rounded-lg border transition-colors text-xs
                    ${selected === chem.id
                      ? 'border-blue-500/30 bg-blue-500/10 text-white'
                      : 'border-white/[0.06] bg-white/[0.02] hover:bg-white/[0.06] text-panel-muted hover:text-white'
                    }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold">{chem.name}</span>
                    <span className="text-[9px] text-panel-muted">{chem.nominal_voltage}V</span>
                  </div>
                  <p className="text-[10px] text-panel-muted/80 mt-0.5">{chem.description}</p>
                  <div className="flex gap-3 mt-1 text-[9px]">
                    <span className="flex items-center gap-0.5">
                      <Zap className="w-2.5 h-2.5" />
                      {chem.energy_density_wh_kg} Wh/kg
                    </span>
                    <span className="flex items-center gap-0.5">
                      <Battery className="w-2.5 h-2.5" />
                      {chem.cycle_life} cycles
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
