/**
 * Nyquist (EIS) Plot
 *
 * Fetches impedance spectrum from the backend and renders as
 * a Nyquist plot (Re(Z) vs −Im(Z)).
 */

import { useEffect, useState, useCallback } from 'react';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Label,
} from 'recharts';
import { API_BASE } from '../config';

interface EISPoint {
  re: number;
  im: number;
}

export default function NyquistPlot() {
  const [data, setData] = useState<EISPoint[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchEIS = useCallback(async () => {
    setLoading(true);
    try {
      const resp = await fetch(`${API_BASE}/eis?temp_c=25`);
      if (!resp.ok) return;
      const json = await resp.json();
      const points: EISPoint[] = json.Z_real.map((re: number, i: number) => ({
        re: re * 1000,          // convert Ω → mΩ
        im: json.Z_imag[i] * 1000,
      }));
      setData(points);
    } catch {
      /* network error */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchEIS();
    const id = setInterval(fetchEIS, 10_000); // refresh every 10 s
    return () => clearInterval(id);
  }, [fetchEIS]);

  if (loading && data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-panel-muted text-xs">
        Loading EIS…
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ScatterChart margin={{ top: 10, right: 20, bottom: 25, left: 25 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--grid)" />
        <XAxis
          type="number"
          dataKey="re"
          name="Re(Z)"
          tick={{ fontSize: 10, fill: 'var(--muted)' }}
        >
          <Label
            value="Re(Z) [mΩ]"
            position="bottom"
            offset={5}
            style={{ fontSize: 10, fill: 'var(--muted)' }}
          />
        </XAxis>
        <YAxis
          type="number"
          dataKey="im"
          name="−Im(Z)"
          tick={{ fontSize: 10, fill: 'var(--muted)' }}
        >
          <Label
            value="−Im(Z) [mΩ]"
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
          formatter={(v: number) => `${v.toFixed(3)} mΩ`}
        />
        <Scatter data={data} fill="#38bdf8" line={{ stroke: '#38bdf8' }} lineType="joint" />
      </ScatterChart>
    </ResponsiveContainer>
  );
}
