/**
 * Battery State Store (Zustand)
 *
 * Central state management for the battery digital twin.
 * Stores current simulation state, history for charts, and UI state.
 */

import { create } from 'zustand';
import type { BatteryState, ChartDataPoint, SimStatus, LoadProfile } from '../types/battery';

const MAX_HISTORY = 2000;

interface BatteryStore {
  // Connection
  status: SimStatus;
  setStatus: (s: SimStatus) => void;

  // Current battery state
  batteryState: BatteryState | null;
  setBatteryState: (s: BatteryState) => void;

  // Chart history
  chartHistory: ChartDataPoint[];
  addChartPoint: (state: BatteryState) => void;
  clearHistory: () => void;

  // Available profiles
  profiles: LoadProfile[];
  setProfiles: (p: LoadProfile[]) => void;
  activeProfile: string;
  setActiveProfile: (p: string) => void;

  // UI state
  showDashboard: boolean;
  toggleDashboard: () => void;
  selectedView: '3d' | 'charts' | 'split' | 'nyquist' | 'dqdv';
  setSelectedView: (v: '3d' | 'charts' | 'split' | 'nyquist' | 'dqdv') => void;

  // Simulation speed
  speed: number;
  setSpeed: (s: number) => void;
}

export const useBatteryStore = create<BatteryStore>((set, get) => ({
  // Connection
  status: 'idle',
  setStatus: (status) => set({ status }),

  // Battery state
  batteryState: null,
  setBatteryState: (batteryState) => set({ batteryState }),

  // Chart history
  chartHistory: [],
  addChartPoint: (state) => {
    const point: ChartDataPoint = {
      time: state.sim_time_s ?? 0,
      soc: state.soc_pct ?? (state.soc ?? 0.5) * 100,
      voltage: state.voltage ?? 3.7,
      current: state.current ?? 0,
      temperature: state.thermal_T_core_c ?? 25,
      soh: state.deg_soh_pct ?? 100,
      power: state.power_w ?? 0,
      heatGen: state.heat_total_w ?? 0,
    };
    set((prev) => ({
      chartHistory:
        prev.chartHistory.length >= MAX_HISTORY
          ? [...prev.chartHistory.slice(-MAX_HISTORY + 1), point]
          : [...prev.chartHistory, point],
    }));
  },
  clearHistory: () => set({ chartHistory: [] }),

  // Profiles
  profiles: [],
  setProfiles: (profiles) => set({ profiles }),
  activeProfile: 'constant_discharge',
  setActiveProfile: (activeProfile) => set({ activeProfile }),

  // UI
  showDashboard: true,
  toggleDashboard: () => set((s) => ({ showDashboard: !s.showDashboard })),
  selectedView: 'split',
  setSelectedView: (selectedView) => set({ selectedView }),

  // Speed
  speed: 10,
  setSpeed: (speed) => set({ speed }),
}));
