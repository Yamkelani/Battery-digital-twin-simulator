/**
 * Battery Digital Twin — Type Definitions
 *
 * Mirrors the Python backend data structures for type-safe communication.
 */

// ─── Simulation State ──────────────────────────────────────────────────────

export interface BatteryState {
  // Metadata
  cell_id: string;
  chemistry: string;
  sim_time_s: number;
  sim_time_hours: number;
  step_count: number;

  // Electrical
  soc: number;
  soc_pct: number;
  voltage: number;
  ocv: number;
  current: number;
  power_w: number;
  c_rate: number;
  v_rc1: number;
  v_rc2: number;

  // Thermal
  thermal_T_core_c: number;
  thermal_T_surface_c: number;
  thermal_T_avg_c: number;
  thermal_T_ambient_c: number;
  thermal_Q_gen_w: number;
  thermal_Q_conv_w: number;
  thermal_Q_rad_w: number;
  thermal_Q_cond_w: number;
  thermal_gradient_c: number;
  thermal_overtemp_warning: boolean;
  thermal_runaway_risk: boolean;
  thermal_humidity_pct: number;
  thermal_dew_point_c: number;
  thermal_condensation_active: boolean;

  // Degradation
  deg_soh_pct: number;
  deg_capacity_retention: number;
  deg_resistance_factor: number;
  deg_sei_loss_pct: number;
  deg_cycle_loss_pct: number;
  deg_plating_loss_pct: number;
  deg_humidity_loss_pct: number;
  deg_total_ah_throughput: number;
  deg_equivalent_cycles: number;
  deg_total_energy_wh: number;
  deg_remaining_cycles: number;
  deg_is_eol: boolean;
  deg_total_time_hours: number;

  // Aging acceleration
  degradation_time_factor: number;

  // Electrochemical (concentration profiles)
  echem_neg_concentration: number[];
  echem_pos_concentration: number[];
  echem_neg_surface_stoich: number;
  echem_pos_surface_stoich: number;
  echem_neg_gradient: number;
  echem_pos_gradient: number;
  echem_diffusion_limitation: number;
  echem_r_normalized: number[];

  // Heat generation
  heat_ohmic_w: number;
  heat_polarization_w: number;
  heat_entropic_w: number;
  heat_total_w: number;

  // BMS (only present when pack is configured)
  bms?: BMSStatus;

  // Charging phase (CC-CV annotation)
  charging_phase?: string;

  // Energy efficiency
  coulombic_efficiency?: number;
  energy_efficiency?: number;
  charge_ah_in?: number;
  discharge_ah_out?: number;
  charge_energy_in?: number;
  discharge_energy_out?: number;

  // RUL predictions
  rul_cycles?: number;
  rul_soh?: number;
  rul_eol_threshold?: number;
  rul_degradation_rate?: number;
  rul_estimated_eol_hours?: number;

  // Temperature distribution
  temperature_distribution?: {
    positions: number[];
    temperatures_k: number[];
    temperatures_c: number[];
  };
}

// ─── Load Profile ──────────────────────────────────────────────────────────

export interface LoadProfile {
  id: string;
  name: string;
  description: string;
  params: string;
}

export interface ProfileConfig {
  profile_type: string;
  params: Record<string, number | string | boolean>;
}

// ─── Simulation Config ─────────────────────────────────────────────────────

export interface SimulationConfig {
  dt: number;
  output_interval: number;
  speed_multiplier: number;
  max_sim_time_s: number;
  degradation_acceleration: number;
}

// ─── WebSocket Messages ────────────────────────────────────────────────────

export type WSMessageType =
  | 'connected'
  | 'status'
  | 'profile'
  | 'config'
  | 'error';

export interface WSMessage {
  type: WSMessageType;
  status?: string;
  message?: string;
  profiles?: LoadProfile[];
  data?: BatteryState;
}

export type WSAction =
  | { action: 'start' }
  | { action: 'pause' }
  | { action: 'resume' }
  | { action: 'stop' }
  | { action: 'reset'; soc?: number; temperature_c?: number; reset_degradation?: boolean }
  | { action: 'set_speed'; value: number }
  | { action: 'set_profile'; type: string; params: Record<string, number> }
  | { action: 'set_ambient_temp'; value: number }
  | {
      action: 'configure_cell';
      capacity_ah?: number;
      soc?: number;
      temperature_c?: number;
      enable_thermal?: boolean;
      enable_degradation?: boolean;
      enable_electrochemical?: boolean;
      degradation_acceleration?: number;
    }
  | {
      action: 'configure_pack';
      n_series?: number;
      n_parallel?: number;
      capacity_ah?: number;
      variation_pct?: number;
      enable_balancing?: boolean;
      enable_thermal_coupling?: boolean;
    };

// ─── Chart Data ────────────────────────────────────────────────────────────

export interface ChartDataPoint {
  time: number;
  soc: number;
  voltage: number;
  current: number;
  temperature: number;
  soh: number;
  power: number;
  heatGen: number;
  chargingPhase?: string;       // 'cc' | 'cv' | 'complete' | 'charge' | 'discharge' | 'idle'
  coulombicEff?: number;        // %
  energyEff?: number;           // %
  rulCycles?: number;           // remaining cycles to EOL
}

// ─── 3D Visualization ──────────────────────────────────────────────────────

export interface VisualizationData {
  geometry: {
    length_m: number;
    width_m: number;
    height_m: number;
    form_factor: string;
  };
  soc_normalized: number;
  soh_normalized: number;
  thermal_stress: number;
  heat_map?: {
    positions: number[];
    temperatures_c: number[];
  };
  ion_flow: {
    rate: number;
    direction: 'charge' | 'discharge';
    neg_surface: number;
    pos_surface: number;
  };
}

// ─── Simulation Status ─────────────────────────────────────────────────────

export type SimStatus = 'idle' | 'running' | 'paused' | 'completed' | 'error' | 'connecting';

// ─── BMS Types ─────────────────────────────────────────────────────────────

export interface BMSStatus {
  contactor_closed: boolean;
  precharge_active: boolean;
  balancing_active: boolean;
  balancing_map: Record<string, boolean>;
  active_faults: string[];
  fault_count: number;
  fault_history: BMSFaultEvent[];
}

export interface BMSFaultEvent {
  fault: string;
  time_s: number;
  cleared: boolean;
}

// ─── RUL Prediction ────────────────────────────────────────────────────────

export interface RULPrediction {
  soh_pct: number;
  capacity_retention: number;
  equivalent_cycles: number;
  remaining_cycles: number;
  eol_threshold_pct: number;
  degradation_rate_per_cycle: number;
  total_capacity_loss_pct: number;
  sei_contribution_pct: number;
  cycle_contribution_pct: number;
  plating_contribution_pct: number;
  remaining_time_hours: number;
  confidence_pct: number;
  resistance_factor: number;
  total_ah_throughput: number;
  total_energy_wh: number;
  knee_point_soh: number;
  cycles_to_knee_point: number;
  is_eol: boolean;
  efficiency: {
    coulombic: number;
    energy: number;
    charge_ah: number;
    discharge_ah: number;
    charge_wh: number;
    discharge_wh: number;
  };
}
