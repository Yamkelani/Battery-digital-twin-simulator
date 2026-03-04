/**
 * Keyboard Shortcuts Hook
 *
 * Binds global keyboard shortcuts for simulation control:
 *   Space  → pause / resume
 *   R      → reset
 *   +/=    → speed up
 *   -      → slow down
 *   Escape → stop
 *
 * Uses singleton commands from simulationSocket — no extra WS connections.
 */

import { useEffect, useCallback } from 'react';
import { useBatteryStore } from './useBatteryState';
import {
  simPause,
  simResume,
  simStop,
  simReset,
  simSetSpeed,
} from '../services/simulationSocket';

export function useKeyboardShortcuts() {
  const status = useBatteryStore((s) => s.status);
  const speed = useBatteryStore((s) => s.speed);
  const setSpeed = useBatteryStore((s) => s.setSpeed);

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      // Ignore if user is typing in an input / textarea / select
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      switch (e.key) {
        case ' ':
          e.preventDefault();
          if (status === 'running') simPause();
          else if (status === 'paused') simResume();
          break;

        case 'r':
        case 'R':
          simReset(0.8, 25, true);
          break;

        case '+':
        case '=': {
          const newSpeed = Math.min(speed + 10, 200);
          setSpeed(newSpeed);
          simSetSpeed(newSpeed);
          break;
        }

        case '-': {
          const newSpeed = Math.max(speed - 10, 1);
          setSpeed(newSpeed);
          simSetSpeed(newSpeed);
          break;
        }

        case 'Escape':
          simStop();
          break;

        default:
          break;
      }
    },
    [status, speed, setSpeed],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleKey]);
}
