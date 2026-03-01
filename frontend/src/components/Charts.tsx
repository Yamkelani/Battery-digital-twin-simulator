/**
 * Time-Series Charts
 *
 * Real-time charts showing battery state evolution:
 *   1. SOC & Voltage vs Time
 *   2. Current & Power vs Time
 *   3. Temperature vs Time
 *   4. SOH & Degradation vs Time
 */

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  Area,
  AreaChart,
  ComposedChart,
  Bar,
} from 'recharts';
import { useBatteryStore } from '../hooks/useBatteryState';

const CHART_MARGIN = { top: 5, right: 10, left: 0, bottom: 5 };
const AXIS_STYLE = { fontSize: 10, fill: '#94a3b8' };
const GRID_STYLE = { strokeDasharray: '3 3', stroke: '#1e293b' };

function formatTimeAxis(seconds: number) {
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

/** SOC & Voltage chart */
function SOCVoltageChart() {
  const data = useBatteryStore((s) => s.chartHistory);
  const last200 = data.slice(-200);

  return (
    <div className="h-full">
      <h3 className="text-xs font-semibold text-panel-muted mb-1 px-1">SOC & VOLTAGE</h3>
      <ResponsiveContainer width="100%" height="90%">
        <ComposedChart data={last200} margin={CHART_MARGIN}>
          <CartesianGrid {...GRID_STYLE} />
          <XAxis dataKey="time" tick={AXIS_STYLE} tickFormatter={formatTimeAxis} />
          <YAxis yAxisId="soc" domain={[0, 100]} tick={AXIS_STYLE} />
          <YAxis yAxisId="voltage" orientation="right" domain={[2.5, 4.3]} tick={AXIS_STYLE} />
          <Tooltip
            contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 6 }}
            labelFormatter={formatTimeAxis}
          />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Area
            yAxisId="soc"
            type="monotone"
            dataKey="soc"
            stroke="#22c55e"
            fill="#22c55e"
            fillOpacity={0.15}
            strokeWidth={2}
            name="SOC %"
            dot={false}
          />
          <Line
            yAxisId="voltage"
            type="monotone"
            dataKey="voltage"
            stroke="#3b82f6"
            strokeWidth={2}
            name="Voltage (V)"
            dot={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Current & Power chart */
function CurrentPowerChart() {
  const data = useBatteryStore((s) => s.chartHistory);
  const last200 = data.slice(-200);

  return (
    <div className="h-full">
      <h3 className="text-xs font-semibold text-panel-muted mb-1 px-1">CURRENT & POWER</h3>
      <ResponsiveContainer width="100%" height="90%">
        <ComposedChart data={last200} margin={CHART_MARGIN}>
          <CartesianGrid {...GRID_STYLE} />
          <XAxis dataKey="time" tick={AXIS_STYLE} tickFormatter={formatTimeAxis} />
          <YAxis yAxisId="current" tick={AXIS_STYLE} />
          <YAxis yAxisId="power" orientation="right" tick={AXIS_STYLE} />
          <Tooltip
            contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 6 }}
            labelFormatter={formatTimeAxis}
          />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Line
            yAxisId="current"
            type="monotone"
            dataKey="current"
            stroke="#f97316"
            strokeWidth={2}
            name="Current (A)"
            dot={false}
          />
          <Line
            yAxisId="power"
            type="monotone"
            dataKey="power"
            stroke="#a855f7"
            strokeWidth={1.5}
            name="Power (W)"
            dot={false}
            strokeDasharray="4 2"
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Temperature chart */
function TemperatureChart() {
  const data = useBatteryStore((s) => s.chartHistory);
  const last200 = data.slice(-200);

  return (
    <div className="h-full">
      <h3 className="text-xs font-semibold text-panel-muted mb-1 px-1">TEMPERATURE</h3>
      <ResponsiveContainer width="100%" height="90%">
        <AreaChart data={last200} margin={CHART_MARGIN}>
          <CartesianGrid {...GRID_STYLE} />
          <XAxis dataKey="time" tick={AXIS_STYLE} tickFormatter={formatTimeAxis} />
          <YAxis tick={AXIS_STYLE} />
          <Tooltip
            contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 6 }}
            labelFormatter={formatTimeAxis}
          />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Area
            type="monotone"
            dataKey="temperature"
            stroke="#ef4444"
            fill="#ef4444"
            fillOpacity={0.2}
            strokeWidth={2}
            name="Core Temp (°C)"
            dot={false}
          />
          <Area
            type="monotone"
            dataKey="heatGen"
            stroke="#f97316"
            fill="#f97316"
            fillOpacity={0.1}
            strokeWidth={1}
            name="Heat Gen (W)"
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/** SOH & Degradation chart */
function DegradationChart() {
  const data = useBatteryStore((s) => s.chartHistory);
  const last200 = data.slice(-200);

  return (
    <div className="h-full">
      <h3 className="text-xs font-semibold text-panel-muted mb-1 px-1">STATE OF HEALTH</h3>
      <ResponsiveContainer width="100%" height="90%">
        <LineChart data={last200} margin={CHART_MARGIN}>
          <CartesianGrid {...GRID_STYLE} />
          <XAxis dataKey="time" tick={AXIS_STYLE} tickFormatter={formatTimeAxis} />
          <YAxis domain={[80, 100]} tick={AXIS_STYLE} />
          <Tooltip
            contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 6 }}
            labelFormatter={formatTimeAxis}
          />
          <Legend wrapperStyle={{ fontSize: 10 }} />
          <Line
            type="monotone"
            dataKey="soh"
            stroke="#06b6d4"
            strokeWidth={2}
            name="SOH %"
            dot={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** All charts composed together */
export default function Charts() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-2 h-full p-2">
      <div className="bg-panel-surface rounded-lg p-2 border border-panel-border min-h-[180px]">
        <SOCVoltageChart />
      </div>
      <div className="bg-panel-surface rounded-lg p-2 border border-panel-border min-h-[180px]">
        <CurrentPowerChart />
      </div>
      <div className="bg-panel-surface rounded-lg p-2 border border-panel-border min-h-[180px]">
        <TemperatureChart />
      </div>
      <div className="bg-panel-surface rounded-lg p-2 border border-panel-border min-h-[180px]">
        <DegradationChart />
      </div>
    </div>
  );
}
