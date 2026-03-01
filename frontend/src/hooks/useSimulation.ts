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

  const {
    status,
    setStatus,
    setBatteryState,
    addChartPoint,
    setProfiles,
    clearHistory,
    speed,
  } = useBatteryStore();

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
          return;
        }

        if (data.type === 'status') {
          setStatus(data.status as any);
          return;
        }

        if (data.type === 'error') {
          console.error('[WS] Error:', data.message);
          return;
        }

        if (data.type === 'profile' || data.type === 'config') {
          return;
        }

        // Simulation state update — ensure status shows running
        if (data.soc !== undefined) {
          setStatus('running');
          const state = data as BatteryState;
          setBatteryState(state);

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
    send,
    isConnected: wsRef.current?.readyState === WebSocket.OPEN,
  };
}
