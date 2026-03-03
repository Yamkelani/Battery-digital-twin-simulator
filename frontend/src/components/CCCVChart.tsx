/**
 * CC-CV Charging Chart
 *
 * Displays the classic Constant Current → Constant Voltage charging curves:
 *   - Left Y-axis: Voltage (V) rising during CC, held constant during CV
 *   - Right Y-axis: Current (A) constant during CC, tapering during CV
 *   - Color-coded background regions for CC (blue) and CV (green) phases
 *   - Transition point annotation
 *   - SOC overlay as fill area
 */

import { useMemo } from 'react';
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  ReferenceLine as _ReferenceLine,
  ReferenceArea as _ReferenceArea,
} from 'recharts';
import { useBatteryStore } from '../hooks/useBatteryState';

// Workaround for Recharts v2 type issue with React 18
const ReferenceLine = _ReferenceLine as any;
const ReferenceArea = _ReferenceArea as any;

const CHART_MARGIN = { top: 10, right: 15, left: 5, bottom: 5 };
const AXIS_STYLE = { fontSize: 10, fill: '#94a3b8' };
const GRID_STYLE = { strokeDasharray: '3 3', stroke: '#1e293b' };

function formatTimeAxis(seconds: number) {
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

/** Custom tooltip for CC-CV */
function CCCVTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const phase = payload[0]?.payload?.chargingPhase;
  const phaseLabel =
    phase === 'cc' ? '⚡ CC Phase' :
    phase === 'cv' ? '🔋 CV Phase' :
    phase === 'complete' ? '✓ Complete' :
    phase === 'charge' ? '🔌 Charging' :
    phase === 'discharge' ? '📤 Discharging' : '⏸ Idle';

  return (
    <div className="bg-gray-900/95 border border-gray-700 rounded-lg p-3 shadow-xl backdrop-blur-sm">
      <div className="text-xs text-gray-400 mb-1">{formatTimeAxis(label)}</div>
      <div className="text-xs font-bold mb-2" style={{
        color: phase === 'cc' ? '#3b82f6' : phase === 'cv' ? '#22c55e' : '#94a3b8'
      }}>
        {phaseLabel}
      </div>
      {payload.map((entry: any, i: number) => (
        <div key={i} className="flex items-center gap-2 text-xs">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-gray-400">{entry.name}:</span>
          <span className="font-mono text-gray-200">
            {typeof entry.value === 'number' ? entry.value.toFixed(entry.name.includes('Voltage') ? 3 : 1) : entry.value}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Main CC-CV Chart */
function CCCVMainChart() {
  const data = useBatteryStore((s) => s.chartHistory);
  const last300 = data.slice(-300);

  // Find CC→CV transition point
  const transitionIdx = useMemo(() => {
    for (let i = 1; i < last300.length; i++) {
      if (last300[i - 1]?.chargingPhase === 'cc' && last300[i]?.chargingPhase === 'cv') {
        return i;
      }
    }
    return -1;
  }, [last300]);

  const transitionTime = transitionIdx >= 0 ? last300[transitionIdx]?.time : null;

  // Determine CC and CV time ranges for shading
  const ccTimes = last300.filter((d) => d.chargingPhase === 'cc');
  const cvTimes = last300.filter((d) => d.chargingPhase === 'cv');

  const ccStart = ccTimes.length > 0 ? ccTimes[0].time : undefined;
  const ccEnd = ccTimes.length > 0 ? ccTimes[ccTimes.length - 1].time : undefined;
  const cvStart = cvTimes.length > 0 ? cvTimes[0].time : undefined;
  const cvEnd = cvTimes.length > 0 ? cvTimes[cvTimes.length - 1].time : undefined;

  return (
    <div className="h-full">
      <h3 className="text-xs font-semibold text-panel-muted mb-1 px-1 flex items-center gap-2">
        CC-CV CHARGING PROFILE
        {transitionTime !== null && (
          <span className="text-[10px] text-blue-400 bg-blue-500/10 px-2 py-0.5 rounded">
            CC→CV @ {formatTimeAxis(transitionTime)}
          </span>
        )}
      </h3>
      <ResponsiveContainer width="100%" height="90%">
        <ComposedChart data={last300} margin={CHART_MARGIN}>
          <CartesianGrid {...GRID_STYLE} />

          {/* Phase shading */}
          {ccStart !== undefined && ccEnd !== undefined && (
            <ReferenceArea x1={ccStart} x2={ccEnd} fill="#3b82f6" fillOpacity={0.06} />
          )}
          {cvStart !== undefined && cvEnd !== undefined && (
            <ReferenceArea x1={cvStart} x2={cvEnd} fill="#22c55e" fillOpacity={0.06} />
          )}

          <XAxis dataKey="time" tick={AXIS_STYLE} tickFormatter={formatTimeAxis} />
          <YAxis yAxisId="voltage" domain={[3.0, 4.4]} tick={AXIS_STYLE} label={{
            value: 'V', position: 'insideLeft', style: { fontSize: 10, fill: '#3b82f6' }
          }} />
          <YAxis yAxisId="current" orientation="right" tick={AXIS_STYLE} label={{
            value: 'A', position: 'insideRight', style: { fontSize: 10, fill: '#f97316' }
          }} />

          <Tooltip content={<CCCVTooltip />} />
          <Legend wrapperStyle={{ fontSize: 10 }} />

          {/* Transition line */}
          {transitionTime !== null && (
            <ReferenceLine
              x={transitionTime}
              stroke="#eab308"
              strokeDasharray="5 3"
              strokeWidth={2}
              label={{
                value: 'CC→CV',
                position: 'top',
                style: { fontSize: 11, fill: '#eab308', fontWeight: 'bold' },
              }}
            />
          )}

          {/* CV voltage limit */}
          <ReferenceLine
            yAxisId="voltage"
            y={4.2}
            stroke="#22c55e"
            strokeDasharray="3 3"
            strokeWidth={1}
          />

          <Line
            yAxisId="voltage"
            type="monotone"
            dataKey="voltage"
            stroke="#3b82f6"
            strokeWidth={2.5}
            name="Voltage (V)"
            dot={false}
            animationDuration={0}
          />
          <Line
            yAxisId="current"
            type="monotone"
            dataKey="current"
            stroke="#f97316"
            strokeWidth={2}
            name="Current (A)"
            dot={false}
            animationDuration={0}
          />
          <Area
            yAxisId="voltage"
            type="monotone"
            dataKey="soc"
            stroke="none"
            fill="#a855f7"
            fillOpacity={0.05}
            name="SOC %"
            dot={false}
            animationDuration={0}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Phase indicator strip */
function PhaseStrip() {
  const data = useBatteryStore((s) => s.chartHistory);
  const latest = data.length > 0 ? data[data.length - 1] : null;
  const phase = latest?.chargingPhase ?? 'idle';

  const ccCount = data.filter((d) => d.chargingPhase === 'cc').length;
  const cvCount = data.filter((d) => d.chargingPhase === 'cv').length;
  const total = Math.max(ccCount + cvCount, 1);

  return (
    <div className="bg-panel-surface rounded-lg p-3 border border-panel-border">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold text-panel-muted">CHARGING PHASE</h3>
        <div className={`px-2 py-0.5 rounded text-xs font-bold ${
          phase === 'cc' ? 'bg-blue-500/20 text-blue-400' :
          phase === 'cv' ? 'bg-green-500/20 text-green-400' :
          phase === 'complete' ? 'bg-emerald-500/20 text-emerald-400' :
          'bg-gray-500/20 text-gray-400'
        }`}>
          {phase === 'cc' ? '⚡ CONSTANT CURRENT' :
           phase === 'cv' ? '🔋 CONSTANT VOLTAGE' :
           phase === 'complete' ? '✓ COMPLETE' :
           phase === 'charge' ? '🔌 CHARGING' :
           phase === 'discharge' ? '📤 DISCHARGING' : '⏸ IDLE'}
        </div>
      </div>

      {/* Phase progress bar */}
      <div className="flex h-3 rounded-full overflow-hidden bg-panel-bg">
        <div
          className="bg-blue-500 transition-all duration-500"
          style={{ width: `${(ccCount / total) * 100}%` }}
          title={`CC: ${ccCount} samples`}
        />
        <div
          className="bg-green-500 transition-all duration-500"
          style={{ width: `${(cvCount / total) * 100}%` }}
          title={`CV: ${cvCount} samples`}
        />
      </div>
      <div className="flex justify-between mt-1 text-[9px] text-panel-muted">
        <span>CC Phase ({((ccCount / total) * 100).toFixed(0)}%)</span>
        <span>CV Phase ({((cvCount / total) * 100).toFixed(0)}%)</span>
      </div>
    </div>
  );
}

/** Efficiency gauge */
function EfficiencyGauges() {
  const data = useBatteryStore((s) => s.chartHistory);
  const latest = data.length > 0 ? data[data.length - 1] : null;
  const coulombic = latest?.coulombicEff ?? 0;
  const energy = latest?.energyEff ?? 0;

  return (
    <div className="bg-panel-surface rounded-lg p-3 border border-panel-border">
      <h3 className="text-xs font-semibold text-panel-muted mb-2">EFFICIENCY</h3>
      <div className="grid grid-cols-2 gap-3">
        <GaugeMini label="Coulombic" value={coulombic} color="#22c55e" />
        <GaugeMini label="Energy" value={energy} color="#3b82f6" />
      </div>
    </div>
  );
}

function GaugeMini({ label, value, color }: { label: string; value: number; color: string }) {
  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - Math.min(value, 100) / 100);

  return (
    <div className="flex flex-col items-center">
      <svg width="72" height="72" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r={radius} fill="none" stroke="#1e293b" strokeWidth="6" />
        <circle
          cx="40" cy="40" r={radius}
          fill="none" stroke={color} strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          transform="rotate(-90 40 40)"
          style={{ transition: 'stroke-dashoffset 0.5s ease' }}
        />
        <text x="40" y="37" textAnchor="middle" fill={color} fontSize="14" fontWeight="bold">
          {value.toFixed(1)}
        </text>
        <text x="40" y="50" textAnchor="middle" fill="#94a3b8" fontSize="9">%</text>
      </svg>
      <span className="text-[9px] text-panel-muted">{label}</span>
    </div>
  );
}

/** Full CC-CV Analytics view */
export default function CCCVChart() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 h-full p-2">
      {/* Main CC-CV Chart (spans full width on large screens) */}
      <div className="lg:col-span-2 bg-panel-surface rounded-lg p-2 border border-panel-border min-h-[250px]">
        <CCCVMainChart />
      </div>

      {/* Phase indicator */}
      <PhaseStrip />

      {/* Efficiency gauges */}
      <EfficiencyGauges />
    </div>
  );
}
