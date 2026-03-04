/**
 * StatusBar — Bottom status bar with live simulation metrics
 *
 * Shows connection status, sim time, speed, SOC mini-bar, temperature,
 * and pack cell mini-map when a pack is configured.
 */

import { motion } from 'framer-motion';
import {
  Wifi,
  WifiOff,
  Clock,
  Gauge,
  Thermometer,
  Battery,
  Cpu,
  Zap,
} from 'lucide-react';
import { useBatteryStore } from '../../hooks/useBatteryState';

function formatTime(seconds: number): string {
  if (!seconds || !isFinite(seconds)) return '0:00';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function socColor(soc: number): string {
  if (soc > 0.5) return '#22c55e';
  if (soc > 0.2) return '#eab308';
  return '#ef4444';
}

export default function StatusBar() {
  const status = useBatteryStore((s) => s.status);
  const bs = useBatteryStore((s) => s.batteryState);
  const speed = useBatteryStore((s) => s.speed);
  const packConfigured = useBatteryStore((s) => s.packConfigured);
  const packCellStates = useBatteryStore((s) => s.packCellStates);
  const packSeries = useBatteryStore((s) => s.packSeries);
  const packParallel = useBatteryStore((s) => s.packParallel);

  const isConnected = status !== 'idle' && status !== 'error' && status !== 'connecting';
  const soc = bs?.soc ?? 0;
  const voltage = bs?.voltage ?? 0;
  const current = bs?.current ?? 0;
  const tempC = bs?.thermal_T_core_c ?? 25;
  const simTime = bs?.sim_time_s ?? 0;

  return (
    <div className="h-7 flex items-center gap-4 px-3 bg-[#0a0f1e]/90 border-t border-white/[0.06]
                    text-[11px] text-panel-muted shrink-0 select-none"
         style={{ backdropFilter: 'blur(12px)' }}>
      {/* Connection status */}
      <div className="flex items-center gap-1.5">
        {isConnected ? (
          <Wifi className="w-3 h-3 text-green-400" />
        ) : (
          <WifiOff className="w-3 h-3 text-red-400" />
        )}
        <span className={isConnected ? 'text-green-400' : 'text-red-400'}>
          {status === 'running' ? 'LIVE' : status.toUpperCase()}
        </span>
      </div>

      <div className="w-px h-3.5 bg-white/[0.08]" />

      {/* Sim time */}
      <div className="flex items-center gap-1">
        <Clock className="w-3 h-3" />
        <span>{formatTime(simTime)}</span>
      </div>

      {/* Speed */}
      <div className="flex items-center gap-1">
        <Gauge className="w-3 h-3" />
        <span>{speed}x</span>
      </div>

      <div className="w-px h-3.5 bg-white/[0.08]" />

      {/* Voltage & Current */}
      <div className="flex items-center gap-1">
        <Zap className="w-3 h-3" />
        <span>{voltage.toFixed(2)}V</span>
        <span className="text-panel-muted/50">|</span>
        <span className={current < 0 ? 'text-green-400' : current > 0 ? 'text-orange-400' : ''}>
          {current.toFixed(2)}A
        </span>
      </div>

      {/* SOC mini-bar */}
      <div className="flex items-center gap-1.5">
        <Battery className="w-3 h-3" />
        <div className="w-16 h-2 rounded-full bg-white/[0.06] overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{ backgroundColor: socColor(soc) }}
            animate={{ width: `${Math.max(2, soc * 100)}%` }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
          />
        </div>
        <span>{(soc * 100).toFixed(1)}%</span>
      </div>

      {/* Temperature */}
      <div className="flex items-center gap-1">
        <Thermometer className="w-3 h-3" />
        <span className={tempC > 45 ? 'text-red-400' : tempC > 35 ? 'text-orange-400' : ''}>
          {tempC.toFixed(1)}°C
        </span>
      </div>

      <div className="flex-1" />

      {/* Pack mini-map */}
      {packConfigured && packCellStates && (
        <div className="flex items-center gap-1.5">
          <Cpu className="w-3 h-3" />
          <span className="text-[10px]">{packSeries}s{packParallel}p</span>
          <div className="flex gap-[2px]">
            {packCellStates.slice(0, 16).map((cell: any, i: number) => (
              <div
                key={i}
                className="w-1.5 h-3 rounded-[1px]"
                style={{ backgroundColor: socColor(cell.soc ?? 0), opacity: 0.8 }}
                title={`Cell ${i}: SOC ${((cell.soc ?? 0) * 100).toFixed(0)}%`}
              />
            ))}
            {packCellStates.length > 16 && (
              <span className="text-[9px] text-panel-muted/50 ml-0.5">+{packCellStates.length - 16}</span>
            )}
          </div>
        </div>
      )}

      {/* Keyboard hint */}
      <span className="text-[9px] text-panel-muted/40">Ctrl+K</span>
    </div>
  );
}
