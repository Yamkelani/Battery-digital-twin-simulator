/**
 * Battery State Store (Zustand)
 *
 * Central state management for the battery digital twin.
 * Stores current simulation state, history for charts, and UI state.
 */

import { create } from 'zustand';
import type {
  BatteryState,
  ChartDataPoint,
  SimStatus,
  LoadProfile,
  BMSStatus,
  DashboardView,
  PackCellState,
  PackThermalLink,
} from '../types/battery';

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
  selectedView: DashboardView;
  setSelectedView: (v: DashboardView) => void;

  // Simulation speed
  speed: number;
  setSpeed: (s: number) => void;

  // Pack state
  packConfigured: boolean;
  packCells: number;
  packSeries: number;
  packParallel: number;
  setPackConfig: (n_series: number, n_parallel: number, n_cells: number) => void;
  clearPack: () => void;

  // Live pack cell data (from WebSocket)
  packCellStates: PackCellState[] | null;
  packThermalLinks: PackThermalLink[] | null;
  setPackCellStates: (cells: PackCellState[], links: PackThermalLink[]) => void;
  clearPackCellStates: () => void;

  // Focused cell (click-to-zoom in pack view)
  focusedCellId: string | null;
  setFocusedCellId: (id: string | null) => void;
  clearFocusedCell: () => void;

  // BMS state
  bmsStatus: BMSStatus | null;
  setBmsStatus: (s: BMSStatus) => void;

  // Cutaway / X-ray mode
  cutawayMode: boolean;
  toggleCutaway: () => void;
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
      chargingPhase: state.charging_phase ?? 'idle',
      coulombicEff: state.coulombic_efficiency ?? 0,
      energyEff: state.energy_efficiency ?? 0,
      rulCycles: state.rul_cycles ?? 0,
    };
    set((prev) => {
      // Efficient ring-buffer: mutate-in-place then return a new ref.
      // Avoids O(n) spread on every single data point.
      const history = prev.chartHistory;
      history.push(point);
      if (history.length > MAX_HISTORY) {
        // Trim oldest 10% in one slice instead of shifting 1-by-1
        const trimCount = Math.max(1, Math.floor(MAX_HISTORY * 0.1));
        return { chartHistory: history.slice(trimCount) };
      }
      // New array reference so Zustand/React detects the change
      return { chartHistory: [...history] };
    });
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

  // Pack
  packConfigured: false,
  packCells: 0,
  packSeries: 1,
  packParallel: 1,
  setPackConfig: (packSeries, packParallel, packCells) =>
    set({ packConfigured: true, packSeries, packParallel, packCells }),
  clearPack: () =>
    set({ packConfigured: false, packCells: 0, packSeries: 1, packParallel: 1, packCellStates: null, packThermalLinks: null }),

  // Live pack cell data
  packCellStates: null,
  packThermalLinks: null,
  setPackCellStates: (cells, links) => set({ packCellStates: cells, packThermalLinks: links }),
  clearPackCellStates: () => set({ packCellStates: null, packThermalLinks: null }),

  // Focused cell
  focusedCellId: null,
  setFocusedCellId: (focusedCellId) => set({ focusedCellId }),
  clearFocusedCell: () => set({ focusedCellId: null }),

  // BMS
  bmsStatus: null,
  setBmsStatus: (bmsStatus) => set({ bmsStatus }),

  // Cutaway
  cutawayMode: false,
  toggleCutaway: () => set((s) => ({ cutawayMode: !s.cutawayMode })),
}));
