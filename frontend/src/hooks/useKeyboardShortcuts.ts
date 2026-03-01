/**
 * Keyboard Shortcuts Hook
 *
 * Binds global keyboard shortcuts for simulation control:
 *   Space  → pause / resume
 *   R      → reset
 *   +/=    → speed up
 *   -      → slow down
 *   Escape → stop
 */

import { useEffect, useCallback } from 'react';
import { useBatteryStore } from './useBatteryState';
import { useSimulation } from './useSimulation';

export function useKeyboardShortcuts() {
  const { status } = useBatteryStore();
  const { pause, resume, stop, reset, setSimSpeed } = useSimulation();
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
          if (status === 'running') pause();
          else if (status === 'paused') resume();
          break;

        case 'r':
        case 'R':
          reset(0.8, 25, true);
          break;

        case '+':
        case '=': {
          const newSpeed = Math.min(speed + 10, 200);
          setSpeed(newSpeed);
          setSimSpeed(newSpeed);
          break;
        }

        case '-': {
          const newSpeed = Math.max(speed - 10, 1);
          setSpeed(newSpeed);
          setSimSpeed(newSpeed);
          break;
        }

        case 'Escape':
          stop();
          break;

        default:
          break;
      }
    },
    [status, pause, resume, stop, reset, speed, setSpeed, setSimSpeed],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleKey]);
}
