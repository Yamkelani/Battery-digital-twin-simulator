/**
 * useSimulation Hook — Thin Wrapper
 * ====================================
 * Returns simulation control functions and the current status.
 *
 * The actual WebSocket lives in services/simulationSocket.ts (singleton).
 * This hook is safe to call from any number of components — it does NOT
 * create new connections.  All consumers share one WebSocket.
 */

import { useEffect, useCallback } from 'react';
import { useBatteryStore } from './useBatteryState';
import {
  connectSimulation,
  simStart,
  simPause,
  simResume,
  simStop,
  simReset,
  simSetSpeed,
  simSetProfile,
  simSetAmbientTemp,
  simConfigureCell,
} from '../services/simulationSocket';

let _connectionInitialized = false;

export function useSimulation() {
  const status = useBatteryStore((s) => s.status);

  // Connect once on first mount — the singleton handles reconnection.
  useEffect(() => {
    if (!_connectionInitialized) {
      _connectionInitialized = true;
      connectSimulation();
    }
  }, []);

  const start = useCallback(() => simStart(), []);
  const pause = useCallback(() => simPause(), []);
  const resume = useCallback(() => simResume(), []);
  const stop = useCallback(() => simStop(), []);

  const reset = useCallback(
    (soc = 0.8, tempC = 25, resetDeg = false) => simReset(soc, tempC, resetDeg),
    [],
  );

  const setSimSpeed = useCallback((value: number) => simSetSpeed(value), []);

  const setProfile = useCallback(
    (type: string, params: Record<string, number> = {}) => simSetProfile(type, params),
    [],
  );

  const setAmbientTemp = useCallback(
    (value: number) => simSetAmbientTemp(value),
    [],
  );

  const configureCell = useCallback(
    (config: Record<string, any>) => simConfigureCell(config),
    [],
  );

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
  };
}
