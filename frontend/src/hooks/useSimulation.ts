/**
 * WebSocket Simulation Hook
 *
 * Manages the WebSocket connection to the backend simulation engine.
 * Handles:
 *   - Auto-reconnect on disconnect
 *   - Sending control commands (start, pause, resume, reset)
 *   - Receiving and parsing simulation state updates
 *   - Updating the Zustand store with live data
 */

import { useEffect, useRef, useCallback } from 'react';
import { useBatteryStore } from './useBatteryState';
import type { BatteryState, WSAction } from '../types/battery';

const WS_URL = `ws://${window.location.hostname}:8001/ws/simulation`;
const RECONNECT_DELAY = 2000;

export function useSimulation() {
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout>>();
  const frameCounter = useRef(0);

  // Use individual selectors so this hook ONLY re-renders when `status`
  // changes — not on every simulation frame (batteryState, chartHistory, etc.)
  const status = useBatteryStore((s) => s.status);
  const setStatus = useBatteryStore((s) => s.setStatus);
  const setBatteryState = useBatteryStore((s) => s.setBatteryState);
  const addChartPoint = useBatteryStore((s) => s.addChartPoint);
  const setProfiles = useBatteryStore((s) => s.setProfiles);
  const clearHistory = useBatteryStore((s) => s.clearHistory);

  // ─── Connect to WebSocket ──────────────────────────────────────────────────

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setStatus('connecting');
    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('[WS] Connected to simulation server');
      setStatus('idle');
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === 'connected') {
          // Server auto-starts, set status to running
          setStatus(data.status === 'running' ? 'running' : 'idle');
          if (data.profiles) {
            setProfiles(data.profiles);
          }
          // Sync pack state with the backend
          if (data.pack && data.pack.n_cells > 1) {
            const { setPackConfig } = useBatteryStore.getState();
            setPackConfig(
              data.pack.n_series ?? 1,
              data.pack.n_parallel ?? 1,
              data.pack.n_cells ?? 1,
            );
          } else {
            // Server has no pack — only clear if user hasn't locally
            // configured one (avoids race where REST configured the pack
            // but WS reconnects before the server registers it).
            const { packConfigured, clearPack } = useBatteryStore.getState();
            if (!packConfigured) {
              clearPack();
            }
          }
          return;
        }

        if (data.type === 'status') {
          // Map non-standard statuses to known SimStatus values
          const st = data.status === 'cycling' ? 'running' : data.status;
          setStatus(st as any);
          return;
        }

        if (data.type === 'error') {
          console.error('[WS] Error:', data.message);
          return;
        }

        if (data.type === 'profile' || data.type === 'config') {
          return;
        }

        if (data.type === 'pack_configured') {
          const { setPackConfig } = useBatteryStore.getState();
          setPackConfig(
            data.n_series ?? 1,
            data.n_parallel ?? 1,
            data.n_cells ?? 1,
          );
          return;
        }

        // Simulation state update — data frames arrive while running
        if (data.soc !== undefined) {
          const state = data as BatteryState;
          setBatteryState(state);

          // Extract BMS data if present (only when a pack is configured)
          if (state.bms) {
            useBatteryStore.getState().setBmsStatus(state.bms);
          }

          // Add to chart history (every Nth frame to limit memory)
          frameCounter.current++;
          if (frameCounter.current % 2 === 0) {
            addChartPoint(state);
          }
        }
      } catch (e) {
        console.error('[WS] Parse error:', e);
      }
    };

    ws.onclose = () => {
      console.log('[WS] Disconnected');
      setStatus('idle');
      reconnectTimer.current = setTimeout(connect, RECONNECT_DELAY);
    };

    ws.onerror = (err) => {
      console.error('[WS] Error:', err);
      ws.close();
    };
  }, [setStatus, setBatteryState, addChartPoint, setProfiles]);

  // ─── Send Commands ────────────────────────────────────────────────────────

  const send = useCallback((msg: WSAction) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(msg));
    } else {
      console.warn('[WS] Not connected, cannot send:', msg);
    }
  }, []);

  const start = useCallback(() => send({ action: 'start' }), [send]);
  const pause = useCallback(() => send({ action: 'pause' }), [send]);
  const resume = useCallback(() => send({ action: 'resume' }), [send]);
  const stop = useCallback(() => send({ action: 'stop' }), [send]);

  const reset = useCallback(
    (soc = 0.8, tempC = 25, resetDeg = false) => {
      clearHistory();
      frameCounter.current = 0;
      send({
        action: 'reset',
        soc,
        temperature_c: tempC,
        reset_degradation: resetDeg,
      });
    },
    [send, clearHistory],
  );

  const setSimSpeed = useCallback(
    (value: number) => send({ action: 'set_speed', value }),
    [send],
  );

  const setProfile = useCallback(
    (type: string, params: Record<string, number> = {}) =>
      send({ action: 'set_profile', type, params }),
    [send],
  );

  const setAmbientTemp = useCallback(
    (value: number) => send({ action: 'set_ambient_temp', value }),
    [send],
  );

  const configureCell = useCallback(
    (config: Partial<WSAction & { action: 'configure_cell' }>) =>
      send({ action: 'configure_cell', ...config } as any),
    [send],
  );

  // ─── Lifecycle ────────────────────────────────────────────────────────────

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
    };
  }, [connect]);

  return {
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
    isConnected: wsRef.current?.readyState === WebSocket.OPEN,
  };
}
