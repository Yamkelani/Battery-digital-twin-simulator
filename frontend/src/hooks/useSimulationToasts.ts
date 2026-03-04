/**
 * Toast notifications for simulation status changes ONLY
 *
 * Fires brief, non-blocking toasts when the simulation state changes
 * (start, stop, pause, resume, error). Persistent warnings like
 * over-temperature, EOL, low SOC are handled by the inline
 * SimulationAlerts component instead — no more pop-ups hiding controls.
 */

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useBatteryStore } from './useBatteryState';

export function useSimulationToasts() {
  const status = useBatteryStore((s: any) => s.status);
  const prevStatus = useRef(status);

  // Status change toasts — brief and non-blocking
  useEffect(() => {
    if (prevStatus.current !== status) {
      switch (status) {
        case 'running':
          if (prevStatus.current === 'paused') {
            toast.success('Simulation resumed', { duration: 1500 });
          } else {
            toast.success('Simulation started', { duration: 1500 });
          }
          break;
        case 'paused':
          toast('Simulation paused', { icon: '⏸️', duration: 1500 });
          break;
        case 'completed':
          toast.success('Simulation completed', { duration: 2000 });
          break;
        case 'error':
          toast.error('Simulation error — check console', { duration: 3000 });
          break;
      }
      prevStatus.current = status;
    }
  }, [status]);
}
