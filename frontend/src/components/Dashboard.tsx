/**
 * Main Dashboard Layout
 *
 * Composes the full application layout:
 *   - Left panel: Simulation controls
 *   - Center: 3D scene (top) + Charts (bottom)
 *   - Right panel: Real-time status metrics
 *   - Error boundaries to prevent blank screen on crash
 *   - Theme toggle (dark/light)
 *   - Keyboard shortcuts
 */

import { Component, type ReactNode } from 'react';
import Scene from './Scene';
import Charts from './Charts';
import Controls from './Controls';
import StatusPanel from './StatusPanel';
import BMSDashboard from './BMSDashboard';
import NyquistPlot from './NyquistPlot';
import DQDVChart from './DQDVChart';
import CCCVChart from './CCCVChart';
import RULPanel from './RULPanel';
import { useBatteryStore } from '../hooks/useBatteryState';
import { useTheme } from '../context/ThemeContext';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';

/** Error Boundary — catches React crashes and shows fallback instead of blank screen */
class ErrorBoundary extends Component<
  { children: ReactNode; label: string },
  { hasError: boolean; error?: Error }
> {
  constructor(props: { children: ReactNode; label: string }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: any) {
    console.error(`[ErrorBoundary:${this.props.label}]`, error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-full bg-panel-surface text-panel-muted p-4">
          <div className="text-center">
            <p className="text-sm font-semibold text-red-400 mb-1">
              {this.props.label} Error
            </p>
            <p className="text-xs text-panel-muted">
              {this.state.error?.message ?? 'Component crashed'}
            </p>
            <button
              className="mt-2 px-3 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-500"
              onClick={() => this.setState({ hasError: false })}
            >
              Retry
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
export default function Dashboard() {
  const selectedView = useBatteryStore((s) => s.selectedView);
  const setSelectedView = useBatteryStore((s) => s.setSelectedView);
  const { theme, toggleTheme } = useTheme();

  // Activate keyboard shortcuts (Space, R, +/-, Esc)
  useKeyboardShortcuts();

  return (
    <div className="w-screen h-screen flex bg-panel-bg text-panel-text overflow-hidden">
      {/* ─── Left Panel: Controls ────────────────────────────────── */}
      <aside className="w-64 shrink-0 bg-panel-surface border-r border-panel-border flex flex-col">
        <div className="p-3 border-b border-panel-border flex items-center justify-between">
          <div>
            <h1 className="text-sm font-bold text-white flex items-center gap-2">
              <span className="text-lg">🔋</span>
              Battery Digital Twin
            </h1>
            <p className="text-[10px] text-panel-muted mt-0.5">
              3D Li-ion Simulation Engine
            </p>
          </div>
          {/* Theme toggle */}
          <button
            onClick={toggleTheme}
            className="p-1.5 rounded-lg bg-panel-bg hover:bg-panel-border transition-colors text-sm"
            title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <Controls />
        </div>
      </aside>

      {/* ─── Center: 3D Scene + Charts ──────────────────────────── */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* View toggle */}
        <div className="flex items-center gap-1 p-1.5 bg-panel-surface border-b border-panel-border">
          <ViewButton
            label="3D View"
            active={selectedView === '3d'}
            onClick={() => setSelectedView('3d')}
          />
          <ViewButton
            label="Charts"
            active={selectedView === 'charts'}
            onClick={() => setSelectedView('charts')}
          />
          <ViewButton
            label="Split"
            active={selectedView === 'split'}
            onClick={() => setSelectedView('split')}
          />
          <ViewButton
            label="Nyquist"
            active={selectedView === 'nyquist' as any}
            onClick={() => setSelectedView('nyquist' as any)}
          />
          <ViewButton
            label="dQ/dV"
            active={selectedView === 'dqdv' as any}
            onClick={() => setSelectedView('dqdv' as any)}
          />
          <ViewButton
            label="BMS"
            active={selectedView === 'bms' as any}
            onClick={() => setSelectedView('bms' as any)}
          />
          <ViewButton
            label="CC-CV"
            active={selectedView === 'cccv' as any}
            onClick={() => setSelectedView('cccv' as any)}
          />
          <ViewButton
            label="RUL"
            active={selectedView === 'rul' as any}
            onClick={() => setSelectedView('rul' as any)}
          />
          <div className="ml-auto text-[9px] text-panel-muted hidden sm:block">
            ⌨ Space·R·+/−·Esc
          </div>
        </div>

        {/* Content area */}
        <div className="flex-1 flex flex-col min-h-0">
          {selectedView === '3d' && (
            <div className="flex-1">
              <ErrorBoundary label="3D Scene">
                <Scene />
              </ErrorBoundary>
            </div>
          )}

          {selectedView === 'charts' && (
            <div className="flex-1 overflow-y-auto">
              <ErrorBoundary label="Charts">
                <Charts />
              </ErrorBoundary>
            </div>
          )}

          {selectedView === 'split' && (
            <>
              <div className="flex-1 min-h-0" style={{ flex: '1.2' }}>
                <ErrorBoundary label="3D Scene">
                  <Scene />
                </ErrorBoundary>
              </div>
              <div className="border-t border-panel-border" style={{ flex: '0.8', minHeight: 300 }}>
                <ErrorBoundary label="Charts">
                  <Charts />
                </ErrorBoundary>
              </div>
            </>
          )}

          {(selectedView as string) === 'nyquist' && (
            <div className="flex-1 p-4">
              <ErrorBoundary label="Nyquist Plot">
                <NyquistPlot />
              </ErrorBoundary>
            </div>
          )}

          {(selectedView as string) === 'dqdv' && (
            <div className="flex-1 p-4">
              <ErrorBoundary label="dQ/dV Chart">
                <DQDVChart />
              </ErrorBoundary>
            </div>
          )}

          {(selectedView as string) === 'bms' && (
            <div className="flex-1">
              <ErrorBoundary label="BMS Dashboard">
                <BMSDashboard />
              </ErrorBoundary>
            </div>
          )}

          {(selectedView as string) === 'cccv' && (
            <div className="flex-1 overflow-y-auto">
              <ErrorBoundary label="CC-CV Chart">
                <CCCVChart />
              </ErrorBoundary>
            </div>
          )}

          {(selectedView as string) === 'rul' && (
            <div className="flex-1">
              <ErrorBoundary label="RUL Analytics">
                <RULPanel />
              </ErrorBoundary>
            </div>
          )}
        </div>
      </main>

      {/* ─── Right Panel: Status ─────────────────────────────────── */}
      <aside className="w-60 shrink-0 bg-panel-surface border-l border-panel-border flex flex-col">
        <div className="p-2 border-b border-panel-border">
          <h2 className="text-xs font-semibold text-panel-muted uppercase tracking-wider">
            Real-Time Metrics
          </h2>
        </div>
        <div className="flex-1 overflow-y-auto">
          <ErrorBoundary label="Status Panel">
            <StatusPanel />
          </ErrorBoundary>
        </div>
      </aside>
    </div>
  );
}

function ViewButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
        active
          ? 'bg-blue-600 text-white'
          : 'bg-panel-bg text-panel-muted hover:text-panel-text'
      }`}
    >
      {label}
    </button>
  );
}
