/**
 * Differential Capacity (dQ/dV) Chart
 *
 * Computes dQ/dV from the charge history in the Zustand store and
 * renders it as a line chart. Peaks in the curve indicate phase
 * transitions and are useful aging indicators.
 */

import { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Label,
} from 'recharts';
import { useBatteryStore } from '../hooks/useBatteryState';

interface DQDVPoint {
  voltage: number;
  dqdv: number;
}

export default function DQDVChart() {
  const chartHistory = useBatteryStore((s) => s.chartHistory);

  const dqdvData = useMemo<DQDVPoint[]>(() => {
    if (chartHistory.length < 10) return [];

    // Sort by voltage for a cleaner curve
    const sorted = [...chartHistory].sort((a, b) => a.voltage - b.voltage);

    const points: DQDVPoint[] = [];
    const windowSize = 5; // smoothing window

    for (let i = windowSize; i < sorted.length - windowSize; i++) {
      const dV = sorted[i + windowSize].voltage - sorted[i - windowSize].voltage;
      if (Math.abs(dV) < 1e-6) continue;

      const dSOC =
        sorted[i + windowSize].soc - sorted[i - windowSize].soc;
      // dQ/dV ≈ ΔQ / ΔV  where Q is proportional to SOC
      // We use SOC (%) directly → result in %/V
      const dqdv = dSOC / dV;

      points.push({
        voltage: Math.round(sorted[i].voltage * 1000) / 1000,
        dqdv: Math.round(Math.abs(dqdv) * 100) / 100,
      });
    }

    // De-duplicate close voltages (average dqdv)
    const bucketSize = 0.005; // 5 mV buckets
    const buckets = new Map<number, { sum: number; count: number }>();
    for (const p of points) {
      const key = Math.round(p.voltage / bucketSize) * bucketSize;
      const b = buckets.get(key) ?? { sum: 0, count: 0 };
      b.sum += p.dqdv;
      b.count += 1;
      buckets.set(key, b);
    }

    return Array.from(buckets.entries())
      .map(([v, b]) => ({ voltage: v, dqdv: b.sum / b.count }))
      .sort((a, b) => a.voltage - b.voltage);
  }, [chartHistory]);

  if (dqdvData.length < 5) {
    return (
      <div className="flex items-center justify-center h-full text-panel-muted text-xs">
        Collecting data for dQ/dV…
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={dqdvData} margin={{ top: 10, right: 20, bottom: 25, left: 25 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
        <XAxis
          dataKey="voltage"
          type="number"
          domain={['auto', 'auto']}
          tick={{ fontSize: 10, fill: 'var(--muted)' }}
        >
          <Label
            value="Voltage [V]"
            position="bottom"
            offset={5}
            style={{ fontSize: 10, fill: 'var(--muted)' }}
          />
        </XAxis>
        <YAxis
          domain={[0, 'auto']}
          tick={{ fontSize: 10, fill: 'var(--muted)' }}
        >
          <Label
            value="| dQ/dV | [%/V]"
            angle={-90}
            position="left"
            offset={10}
            style={{ fontSize: 10, fill: 'var(--muted)' }}
          />
        </YAxis>
        <Tooltip
          contentStyle={{
            backgroundColor: 'var(--surface)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            fontSize: 10,
          }}
          formatter={(v: number) => `${v.toFixed(2)} %/V`}
          labelFormatter={(v: number) => `${v.toFixed(3)} V`}
        />
        <Line
          type="monotone"
          dataKey="dqdv"
          stroke="#f472b6"
          strokeWidth={1.5}
          dot={false}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
