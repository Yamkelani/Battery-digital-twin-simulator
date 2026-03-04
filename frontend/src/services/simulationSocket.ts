/**
 * Simulation WebSocket Singleton
 * ================================
 * A single, module-level WebSocket connection shared by the entire app.
 *
 * Architecture:
 *   - ONE WebSocket lives here — never in a React hook.
 *   - The Zustand store (useBatteryState) is updated directly.
 *   - React components call the exported `send*` functions.
 *   - Auto-reconnect on disconnect with back-off.
 *
 * This eliminates the root-cause bug where useSimulation() was called
 * from 3 different components (Controls, KeyboardShortcuts, CommandPalette),
 * each creating its own WebSocket connection.  Multiple connections caused
 * race conditions: commands from one connection didn't affect simulations
 * started by another, the backend's global `_simulation_task` got corrupted,
 * and status updates from 3 connections stomped on each other.
 */

import { WS_URL } from '../config';
import { useBatteryStore } from '../hooks/useBatteryState';
import type { BatteryState, WSAction } from '../types/battery';

// ─── Singleton state ─────────────────────────────────────────────────────────

let _ws: WebSocket | null = null;
let _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let _frameCounter = 0;
let _intentionalClose = false;

const RECONNECT_DELAY = 2000;

// ─── Internal helpers ────────────────────────────────────────────────────────

function getStore() {
  return useBatteryStore.getState();
}

function handleMessage(event: MessageEvent) {
  try {
    const raw: string = event.data;
    const sanitised = raw
      .replace(/\bNaN\b/g, 'null')
      .replace(/\b-?Infinity\b/g, 'null');
    const data = JSON.parse(sanitised);

    const store = getStore();

    // ── Connection acknowledgement ──
    if (data.type === 'connected') {
      const serverStatus = data.status;
      if (serverStatus === 'running' || serverStatus === 'paused') {
        store.setStatus(serverStatus);
      } else {
        store.setStatus('idle');
      }
      if (data.profiles) {
        store.setProfiles(data.profiles);
      }
      if (data.pack && data.pack.n_cells > 1) {
        store.setPackConfig(
          data.pack.n_series ?? 1,
          data.pack.n_parallel ?? 1,
          data.pack.n_cells ?? 1,
        );
      } else {
        if (!store.packConfigured) {
          store.clearPack();
        }
      }
      return;
    }

    // ── Status change (start/pause/resume/stop/reset/completed) ──
    if (data.type === 'status') {
      store.setStatus(data.status);
      return;
    }

    // ── Error ──
    if (data.type === 'error') {
      console.error('[WS] Server error:', data.message);
      return;
    }

    // ── Informational (profile change, config ack) ──
    if (data.type === 'profile' || data.type === 'config') {
      return;
    }

    // ── Pack configured ──
    if (data.type === 'pack_configured') {
      store.setPackConfig(
        data.n_series ?? 1,
        data.n_parallel ?? 1,
        data.n_cells ?? 1,
      );
      return;
    }

    // ── Simulation data frame ──
    if (data.soc !== undefined) {
      const state = data as BatteryState;
      store.setBatteryState(state);

      if (state.bms) {
        store.setBmsStatus(state.bms);
      }

      if (data.pack_cells && Array.isArray(data.pack_cells)) {
        store.setPackCellStates(data.pack_cells, data.pack_thermal_links ?? []);
        if (!store.packConfigured && data.pack_n_cells > 1) {
          store.setPackConfig(
            data.pack_n_series ?? 1,
            data.pack_n_parallel ?? 1,
            data.pack_n_cells ?? 1,
          );
        }
      }

      // Throttle chart history to every 2nd frame
      _frameCounter++;
      if (_frameCounter % 2 === 0) {
        store.addChartPoint(state);
      }
    }
  } catch (e) {
    console.error('[WS] Parse error:', e);
  }
}

// ─── Connection management ───────────────────────────────────────────────────

export function connectSimulation() {
  if (_ws && (_ws.readyState === WebSocket.OPEN || _ws.readyState === WebSocket.CONNECTING)) {
    return; // already connected or connecting
  }

  _intentionalClose = false;
  const store = getStore();
  store.setStatus('connecting');

  const ws = new WebSocket(WS_URL);
  _ws = ws;

  ws.onopen = () => {
    console.log('[WS] Connected to simulation server');
    // Status will be set properly when we receive the 'connected' message
  };

  ws.onmessage = handleMessage;

  ws.onclose = () => {
    console.log('[WS] Disconnected');
    _ws = null;
    if (!_intentionalClose) {
      store.setStatus('idle');
      _reconnectTimer = setTimeout(connectSimulation, RECONNECT_DELAY);
    }
  };

  ws.onerror = (err) => {
    console.error('[WS] Error:', err);
    ws.close();
  };
}

export function disconnectSimulation() {
  _intentionalClose = true;
  if (_reconnectTimer) {
    clearTimeout(_reconnectTimer);
    _reconnectTimer = null;
  }
  if (_ws) {
    _ws.close();
    _ws = null;
  }
}

// ─── Send a raw WS command ──────────────────────────────────────────────────

function send(msg: WSAction) {
  if (_ws?.readyState === WebSocket.OPEN) {
    _ws.send(JSON.stringify(msg));
  } else {
    console.warn('[WS] Not connected, cannot send:', msg);
  }
}

// ─── Public command API ──────────────────────────────────────────────────────

export function simStart() {
  send({ action: 'start' });
}

export function simPause() {
  send({ action: 'pause' });
}

export function simResume() {
  send({ action: 'resume' });
}

export function simStop() {
  send({ action: 'stop' });
}

export function simReset(soc = 0.8, tempC = 25, resetDeg = false) {
  const store = getStore();
  store.clearHistory();
  _frameCounter = 0;
  store.setStatus('idle');
  store.setBatteryState(null as unknown as BatteryState);
  store.clearPackCellStates();
  store.clearFocusedCell();
  store.setBmsStatus(null as any);
  send({
    action: 'reset',
    soc,
    temperature_c: tempC,
    reset_degradation: resetDeg,
  });
}

export function simSetSpeed(value: number) {
  send({ action: 'set_speed', value });
}

export function simSetProfile(type: string, params: Record<string, number> = {}) {
  send({ action: 'set_profile', type, params });
}

export function simSetAmbientTemp(value: number) {
  send({ action: 'set_ambient_temp', value });
}

export function simConfigureCell(config: Record<string, any>) {
  send({ action: 'configure_cell', ...config } as any);
}

export function simConfigurePack(config: Record<string, any>) {
  send({ action: 'configure_pack', ...config } as any);
}
