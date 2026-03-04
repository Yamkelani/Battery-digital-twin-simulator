/**
 * Toast notifications for simulation events
 *
 * Fires toasts on key simulation events:
 *   - Simulation start/stop/pause/complete
 *   - Over-temperature warnings
 *   - SOC limits (empty/full)
 *   - BMS balancing active
 *   - End-of-life reached
 */

import { useEffect, useRef } from 'react';
import { toast } from 'sonner';
import { useBatteryStore } from './useBatteryState';

export function useSimulationToasts() {
  const bs = useBatteryStore((s: any) => s.batteryState);
  const status = useBatteryStore((s: any) => s.status);
  const prevStatus = useRef(status);
  const warned = useRef({
    overtemp: false,
    lowSOC: false,
    fullSOC: false,
    eol: false,
    runaway: false,
  });

  // Status change toasts
  useEffect(() => {
    if (prevStatus.current !== status) {
      switch (status) {
        case 'running':
          if (prevStatus.current === 'paused') {
            toast.success('Simulation resumed', { duration: 2000 });
          } else {
            toast.success('Simulation started', { duration: 2000 });
          }
          // Reset warnings on new run
          warned.current = { overtemp: false, lowSOC: false, fullSOC: false, eol: false, runaway: false };
          break;
        case 'paused':
          toast('Simulation paused', { icon: '⏸️', duration: 2000 });
          break;
        case 'completed':
          toast.success('Simulation completed', { duration: 3000 });
          break;
        case 'error':
          toast.error('Simulation error — check console', { duration: 5000 });
          break;
      }
      prevStatus.current = status;
    }
  }, [status]);

  // Battery state warnings
  useEffect(() => {
    if (!bs || status !== 'running') return;

    // Over-temperature warning (>55°C)
    if (bs.thermal_T_core_c > 55 && !warned.current.overtemp) {
      warned.current.overtemp = true;
      toast.warning(`High temperature: ${bs.thermal_T_core_c.toFixed(1)}°C`, {
        description: 'Core temperature exceeds safe operating range',
        duration: 5000,
      });
    } else if (bs.thermal_T_core_c < 50) {
      warned.current.overtemp = false;
    }

    // Thermal runaway risk
    if (bs.thermal_runaway_risk && !warned.current.runaway) {
      warned.current.runaway = true;
      toast.error('THERMAL RUNAWAY RISK', {
        description: `Core: ${bs.thermal_T_core_c.toFixed(0)}°C — Immediate shutdown recommended`,
        duration: 10000,
      });
    }

    // Low SOC (<5%)
    if (bs.soc < 0.05 && !warned.current.lowSOC) {
      warned.current.lowSOC = true;
      toast.warning('Battery nearly empty', {
        description: `SOC: ${(bs.soc * 100).toFixed(1)}%`,
        duration: 4000,
      });
    } else if (bs.soc > 0.1) {
      warned.current.lowSOC = false;
    }

    // Full SOC (>99%)
    if (bs.soc > 0.99 && !warned.current.fullSOC) {
      warned.current.fullSOC = true;
      toast.success('Battery fully charged', {
        description: `SOC: ${(bs.soc * 100).toFixed(1)}%`,
        duration: 3000,
      });
    } else if (bs.soc < 0.95) {
      warned.current.fullSOC = false;
    }

    // End of life
    if (bs.deg_is_eol && !warned.current.eol) {
      warned.current.eol = true;
      toast.error('End-of-Life reached', {
        description: `SOH: ${bs.deg_soh_pct.toFixed(1)}% — Battery has degraded below usable threshold`,
        duration: 8000,
      });
    }
  }, [bs, status]);
}
