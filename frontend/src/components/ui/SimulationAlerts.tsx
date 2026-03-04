/**
 * SimulationAlerts — Compact, non-blocking inline alerts
 *
 * Replaces intrusive toast pop-ups for persistent simulation warnings
 * (EOL, over-temperature, thermal runaway, low SOC). Shows as small
 * pill-shaped indicators anchored to the bottom-left of the 3D scene,
 * never obscuring controls or requiring dismissal.
 */

import { useMemo } from 'react';
import { AlertTriangle, Thermometer, Battery, Flame, X } from 'lucide-react';
import { useBatteryStore } from '../../hooks/useBatteryState';

interface Alert {
  id: string;
  icon: typeof AlertTriangle;
  label: string;
  detail: string;
  color: string; // tailwind text- color
  bgColor: string; // tailwind bg- + border classes
}

export default function SimulationAlerts() {
  const bs = useBatteryStore((s: any) => s.batteryState);
  const status = useBatteryStore((s: any) => s.status);

  const alerts = useMemo<Alert[]>(() => {
    if (!bs || status !== 'running') return [];

    const list: Alert[] = [];

    // Thermal runaway — most critical
    if (bs.thermal_runaway_risk) {
      list.push({
        id: 'runaway',
        icon: Flame,
        label: 'THERMAL RUNAWAY',
        detail: `Core: ${(bs.thermal_T_core_c ?? 0).toFixed(0)}°C`,
        color: 'text-red-300',
        bgColor: 'bg-red-500/15 border-red-500/30',
      });
    }

    // Over-temperature (>55°C)
    if (bs.thermal_T_core_c > 55 && !bs.thermal_runaway_risk) {
      list.push({
        id: 'overtemp',
        icon: Thermometer,
        label: 'High Temp',
        detail: `${(bs.thermal_T_core_c ?? 0).toFixed(1)}°C`,
        color: 'text-orange-300',
        bgColor: 'bg-orange-500/15 border-orange-500/30',
      });
    }

    // End of life
    if (bs.deg_is_eol) {
      list.push({
        id: 'eol',
        icon: Battery,
        label: 'End of Life',
        detail: `SOH: ${(bs.deg_soh_pct ?? 0).toFixed(1)}%`,
        color: 'text-amber-300',
        bgColor: 'bg-amber-500/15 border-amber-500/30',
      });
    }

    // Low SOC (<5%)
    if (bs.soc < 0.05) {
      list.push({
        id: 'lowsoc',
        icon: Battery,
        label: 'Low Battery',
        detail: `SOC: ${((bs.soc ?? 0) * 100).toFixed(1)}%`,
        color: 'text-yellow-300',
        bgColor: 'bg-yellow-500/15 border-yellow-500/30',
      });
    }

    return list;
  }, [bs, status]);

  if (alerts.length === 0) return null;

  return (
    <div className="absolute bottom-14 left-4 z-20 flex flex-col gap-1.5 pointer-events-none">
      {alerts.map((alert) => {
        const Icon = alert.icon;
        return (
          <div
            key={alert.id}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-full border
                        backdrop-blur-md text-xs font-medium ${alert.bgColor} ${alert.color}
                        animate-in fade-in slide-in-from-left-2 duration-300`}
          >
            <Icon className="w-3.5 h-3.5 flex-shrink-0" />
            <span className="font-semibold">{alert.label}</span>
            <span className="opacity-70">·</span>
            <span className="opacity-80">{alert.detail}</span>
          </div>
        );
      })}
    </div>
  );
}
