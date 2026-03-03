/**
 * Export Button — Download CSV or JSON
 */

import { useState, useCallback } from 'react';
import { API_BASE } from '../config';

export default function ExportButton() {
  const [busy, setBusy] = useState(false);

  const download = useCallback(async (format: 'csv' | 'json') => {
    setBusy(true);
    try {
      const resp = await fetch(`${API_BASE}/export/${format}`);
      if (!resp.ok) throw new Error(await resp.text());
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `battery_simulation.${format}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Export failed:', err);
    } finally {
      setBusy(false);
    }
  }, []);

  return (
    <div className="flex gap-1">
      <button
        onClick={() => download('csv')}
        disabled={busy}
        className="flex-1 py-1.5 px-2 bg-panel-surface hover:bg-panel-border rounded-lg text-[10px] border border-panel-border transition-colors disabled:opacity-50"
        title="Download simulation data as CSV"
      >
        📥 CSV
      </button>
      <button
        onClick={() => download('json')}
        disabled={busy}
        className="flex-1 py-1.5 px-2 bg-panel-surface hover:bg-panel-border rounded-lg text-[10px] border border-panel-border transition-colors disabled:opacity-50"
        title="Download simulation data as JSON"
      >
        📥 JSON
      </button>
    </div>
  );
}
