/**
 * BMS (Battery Management System) Panel
 *
 * Displays real-time BMS status:
 *   - Active faults with severity coloring
 *   - Contactor & pre-charge state
 *   - Cell balancing activity
 *   - Fault history log
 */

import { useBatteryStore } from '../hooks/useBatteryState';

const FAULT_SEVERITY: Record<string, { color: string; bg: string; icon: string }> = {
  THERMAL_RUNAWAY: { color: 'text-red-400', bg: 'bg-red-500/20 border-red-500/40', icon: '🔥' },
  OVER_TEMP:       { color: 'text-orange-400', bg: 'bg-orange-500/20 border-orange-500/40', icon: '🌡️' },
  OVER_VOLTAGE:    { color: 'text-yellow-400', bg: 'bg-yellow-500/20 border-yellow-500/40', icon: '⚡' },
  UNDER_VOLTAGE:   { color: 'text-yellow-400', bg: 'bg-yellow-500/20 border-yellow-500/40', icon: '🔋' },
  OVER_CURRENT:    { color: 'text-orange-400', bg: 'bg-orange-500/20 border-orange-500/40', icon: '⚠️' },
  CELL_IMBALANCE:  { color: 'text-blue-400', bg: 'bg-blue-500/20 border-blue-500/40', icon: '⚖️' },
  UNDER_TEMP:      { color: 'text-cyan-400', bg: 'bg-cyan-500/20 border-cyan-500/40', icon: '❄️' },
};

function formatFault(fault: string): string {
  return fault.replace(/_/g, ' ');
}

function formatTime(s: number): string {
  if (s < 60) return `${s.toFixed(0)}s`;
  if (s < 3600) return `${(s / 60).toFixed(1)}m`;
  return `${(s / 3600).toFixed(2)}h`;
}

export default function BMSPanel() {
  const bms = useBatteryStore((s) => s.bmsStatus);
  const packConfigured = useBatteryStore((s) => s.packConfigured);

  if (!packConfigured) {
    return (
      <div className="bg-panel-surface rounded-lg p-3 border border-panel-border">
        <div className="text-[10px] text-panel-muted uppercase tracking-wider mb-1">
          Battery Management System
        </div>
        <p className="text-xs text-panel-muted text-center py-2">
          Configure a pack to activate BMS
        </p>
      </div>
    );
  }

  if (!bms) {
    return (
      <div className="bg-panel-surface rounded-lg p-3 border border-panel-border">
        <div className="text-[10px] text-panel-muted uppercase tracking-wider mb-1">
          Battery Management System
        </div>
        <p className="text-xs text-panel-muted text-center py-2 animate-pulse">
          Waiting for BMS data...
        </p>
      </div>
    );
  }

  const activeFaults = bms.active_faults ?? [];
  const hasFaults = activeFaults.length > 0;
  const balancingCells = Object.entries(bms.balancing_map ?? {}).filter(([, v]) => v);
  const recentFaults = (bms.fault_history ?? []).slice(-8).reverse();

  return (
    <div className="space-y-2">
      <div className="text-[10px] text-panel-muted uppercase tracking-wider">
        Battery Management System
      </div>

      {/* ── Contactor & Pre-charge ────────────────────────────── */}
      <div className="bg-panel-surface rounded-lg p-2 border border-panel-border">
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] text-panel-muted uppercase">Contactors</span>
          <div className="flex items-center gap-1.5">
            {bms.precharge_active && (
              <span className="text-[9px] bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded animate-pulse">
                PRE-CHG
              </span>
            )}
            <span
              className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                bms.contactor_closed
                  ? 'bg-green-500/20 text-green-400'
                  : 'bg-red-500/20 text-red-400'
              }`}
            >
              {bms.contactor_closed ? 'CLOSED' : 'OPEN'}
            </span>
          </div>
        </div>

        {/* Visual contactor diagram */}
        <div className="flex items-center justify-center gap-1 py-1">
          <div className="w-3 h-3 rounded bg-red-500/60 border border-red-500" title="Pack +" />
          <div
            className={`h-0.5 w-6 transition-colors ${
              bms.contactor_closed ? 'bg-green-400' : 'bg-red-400 opacity-30'
            }`}
          />
          <div
            className={`w-5 h-5 rounded border-2 flex items-center justify-center text-[8px] font-bold ${
              bms.contactor_closed
                ? 'border-green-400 text-green-400'
                : 'border-red-400 text-red-400'
            }`}
          >
            K
          </div>
          <div
            className={`h-0.5 w-6 transition-colors ${
              bms.contactor_closed ? 'bg-green-400' : 'bg-red-400 opacity-30'
            }`}
          />
          <div className="w-3 h-3 rounded bg-blue-500/60 border border-blue-500" title="Pack −" />
        </div>
      </div>

      {/* ── Active Faults ─────────────────────────────────────── */}
      {hasFaults ? (
        <div className="space-y-1">
          {activeFaults.map((fault) => {
            const sev = FAULT_SEVERITY[fault] ?? { color: 'text-gray-400', bg: 'bg-gray-500/20 border-gray-500/40', icon: '⚠️' };
            return (
              <div
                key={fault}
                className={`${sev.bg} border rounded-lg p-2 text-xs ${sev.color} font-semibold flex items-center gap-2 animate-pulse`}
              >
                <span>{sev.icon}</span>
                <span>{formatFault(fault)}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="bg-green-500/10 border border-green-500/30 rounded-lg p-2 text-xs text-green-400 text-center">
          ✓ No Active Faults
        </div>
      )}

      {/* ── Cell Balancing ────────────────────────────────────── */}
      <div className="bg-panel-surface rounded-lg p-2 border border-panel-border">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[10px] text-panel-muted uppercase">Passive Balancing</span>
          <span
            className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
              bms.balancing_active
                ? 'bg-blue-500/20 text-blue-400 animate-pulse'
                : 'bg-panel-bg text-panel-muted'
            }`}
          >
            {bms.balancing_active ? 'ACTIVE' : 'IDLE'}
          </span>
        </div>
        {balancingCells.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {balancingCells.map(([cellId]) => (
              <span
                key={cellId}
                className="text-[9px] bg-blue-500/20 text-blue-300 px-1.5 py-0.5 rounded"
                title={`Bleeding ${cellId}`}
              >
                {cellId.replace('cell_', 'C')}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* ── Fault History ─────────────────────────────────────── */}
      {recentFaults.length > 0 && (
        <div className="bg-panel-surface rounded-lg p-2 border border-panel-border">
          <div className="text-[10px] text-panel-muted uppercase mb-1">Fault Log</div>
          <div className="space-y-0.5 max-h-28 overflow-y-auto">
            {recentFaults.map((entry, i) => {
              const sev = FAULT_SEVERITY[entry.fault] ?? { color: 'text-gray-400', icon: '?' };
              return (
                <div
                  key={`${entry.fault}-${entry.time_s}-${i}`}
                  className="flex items-center gap-1.5 text-[10px]"
                >
                  <span className="text-[9px]">{sev.icon}</span>
                  <span className={entry.cleared ? 'text-panel-muted line-through' : sev.color}>
                    {formatFault(entry.fault)}
                  </span>
                  <span className="text-panel-muted ml-auto">
                    {formatTime(entry.time_s)}
                  </span>
                  {entry.cleared && (
                    <span className="text-green-500 text-[8px]">CLR</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
