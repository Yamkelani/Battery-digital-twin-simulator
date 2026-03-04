/**
 * Main Dashboard Layout v2
 *
 * Professional layout with:
 *   - Icon sidebar navigation (left)
 *   - Resizable center content area
 *   - Slide-out control drawer (right)
 *   - Floating metrics overlay on 3D view
 *   - Command palette (Ctrl+K)
 *   - Toast notifications for sim events
 *   - Bottom status bar with pack mini-map
 *   - Animated view transitions
 *   - Error boundaries everywhere
 */

import { Component, type ReactNode, useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { Toaster } from 'sonner';
import { SlidersHorizontal } from 'lucide-react';

import Scene from './Scene';
import Charts from './Charts';
import StatusPanel from './StatusPanel';
import BMSDashboard from './BMSDashboard';
import NyquistPlot from './NyquistPlot';
import DQDVChart from './DQDVChart';
import CCCVChart from './CCCVChart';
import RULPanel from './RULPanel';
import MLExportPanel from './MLExportPanel';

import Sidebar from './ui/Sidebar';
import CommandPalette from './ui/CommandPalette';
import StatusBar from './ui/StatusBar';
import ControlDrawer from './ui/ControlDrawer';
import MetricsTicker from './ui/MetricsTicker';
import SimulationAlerts from './ui/SimulationAlerts';

import { useBatteryStore } from '../hooks/useBatteryState';
import { useKeyboardShortcuts } from '../hooks/useKeyboardShortcuts';
import { useSimulationToasts } from '../hooks/useSimulationToasts';

/* ─── Error Boundary ─────────────────────────────────────────────────── */

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
        <div className="flex items-center justify-center h-full text-panel-muted p-6">
          <div className="text-center max-w-xs">
            <div className="w-12 h-12 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-3">
              <span className="text-red-400 text-lg">!</span>
            </div>
            <p className="text-sm font-semibold text-red-400 mb-1">
              {this.props.label} Error
            </p>
            <p className="text-xs text-panel-muted mb-3">
              {this.state.error?.message ?? 'Component crashed'}
            </p>
            <button
              className="px-4 py-1.5 text-xs bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors"
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

/* ─── View transition wrapper ───────────────────────────────────────── */

const viewTransition = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.2, ease: 'easeOut' as const },
};

/* ─── Resize Handle ─────────────────────────────────────────────────── */

function ResizeHandle({ direction = 'vertical' }: { direction?: 'vertical' | 'horizontal' }) {
  return (
    <PanelResizeHandle
      className={`group relative flex items-center justify-center
        ${direction === 'vertical' ? 'h-2 cursor-row-resize' : 'w-2 cursor-col-resize'}
        hover:bg-blue-500/10 transition-colors`}
    >
      <div
        className={`rounded-full bg-white/[0.1] group-hover:bg-blue-400/50 transition-colors
          ${direction === 'vertical' ? 'w-8 h-[3px]' : 'h-8 w-[3px]'}`}
      />
    </PanelResizeHandle>
  );
}

/* ─── Dashboard ─────────────────────────────────────────────────────── */

export default function Dashboard() {
  const selectedView = useBatteryStore((s) => s.selectedView);
  const [cmdPaletteOpen, setCmdPaletteOpen] = useState(false);
  const [controlDrawerOpen, setControlDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // Activate keyboard shortcuts
  useKeyboardShortcuts();

  // Fire toast notifications on sim events
  useSimulationToasts();

  // Ctrl+K global shortcut
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCmdPaletteOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const handleOpenSettings = useCallback(() => {
    setControlDrawerOpen(true);
  }, []);

  return (
    <div className="w-screen h-screen flex flex-col bg-[#080d1a] text-panel-text overflow-hidden">
      {/* Sonner Toaster */}
      <Toaster
        position="top-right"
        toastOptions={{
          style: {
            background: 'rgba(15, 23, 41, 0.95)',
            border: '1px solid rgba(255,255,255,0.08)',
            color: '#e2e8f0',
            backdropFilter: 'blur(12px)',
          },
        }}
        richColors
      />

      {/* Command Palette */}
      <CommandPalette open={cmdPaletteOpen} onClose={() => setCmdPaletteOpen(false)} />

      {/* Control Drawer */}
      <ControlDrawer open={controlDrawerOpen} onClose={() => setControlDrawerOpen(false)} />

      {/* ─── Main row: Sidebar + Content ─── */}
      <div className="flex-1 flex min-h-0">
        {/* Icon Sidebar */}
        <Sidebar
          onOpenCommandPalette={() => setCmdPaletteOpen(true)}
          onOpenSettings={handleOpenSettings}
        />

        {/* ─── Content Area ─── */}
        <main className="flex-1 flex flex-col min-w-0 min-h-0 relative">
          {/* Toolbar */}
          <div className="h-12 flex items-center justify-between px-5 bg-[#0c1222]/60 border-b border-white/[0.06] shrink-0"
               style={{ backdropFilter: 'blur(12px)' }}>
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold text-white capitalize">
                {selectedView === 'ml-data' ? 'ML Dataset' :
                 selectedView === 'dqdv' ? 'dQ/dV Analysis' :
                 selectedView === 'cccv' ? 'CC-CV Charging' :
                 selectedView === 'rul' ? 'RUL Prediction' :
                 selectedView === 'bms' ? 'BMS Dashboard' :
                 selectedView === 'nyquist' ? 'Nyquist (EIS)' :
                 selectedView === '3d' ? '3D Visualization' :
                 selectedView === 'charts' ? 'Time Series' :
                 'Overview'}
              </span>
              <span className="text-[11px] text-panel-muted/50 border border-white/[0.06] rounded px-2 py-0.5">
                {selectedView.toUpperCase()}
              </span>
            </div>

            <button
              onClick={() => setControlDrawerOpen(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm
                         text-panel-muted hover:text-white hover:bg-white/[0.06]
                         border border-white/[0.06] transition-colors"
            >
              <SlidersHorizontal className="w-4 h-4" />
              Controls
            </button>
          </div>

          {/* View content with animated transitions */}
          <div className="flex-1 min-h-0 relative">
            <AnimatePresence mode="wait">
              {selectedView === 'split' && (
                <motion.div key="split" className="absolute inset-0" {...viewTransition}>
                  <PanelGroup orientation="vertical" className="h-full">
                    <Panel defaultSize={60} minSize={30}>
                      <div className="h-full relative">
                        <ErrorBoundary label="3D Scene">
                          <Scene />
                        </ErrorBoundary>
                        <MetricsTicker />
                        <SimulationAlerts />
                      </div>
                    </Panel>
                    <ResizeHandle direction="vertical" />
                    <Panel defaultSize={40} minSize={20}>
                      <PanelGroup orientation="horizontal" className="h-full">
                        <Panel defaultSize={65} minSize={30}>
                          <div className="h-full overflow-y-auto">
                            <ErrorBoundary label="Charts">
                              <Charts />
                            </ErrorBoundary>
                          </div>
                        </Panel>
                        <ResizeHandle direction="horizontal" />
                        <Panel defaultSize={35} minSize={20}>
                          <div className="h-full overflow-y-auto">
                            <ErrorBoundary label="Status Panel">
                              <StatusPanel />
                            </ErrorBoundary>
                          </div>
                        </Panel>
                      </PanelGroup>
                    </Panel>
                  </PanelGroup>
                </motion.div>
              )}

              {selectedView === '3d' && (
                <motion.div key="3d" className="absolute inset-0" {...viewTransition}>
                  <ErrorBoundary label="3D Scene">
                    <Scene />
                  </ErrorBoundary>
                  <MetricsTicker />
                  <SimulationAlerts />
                </motion.div>
              )}

              {selectedView === 'charts' && (
                <motion.div key="charts" className="absolute inset-0 overflow-y-auto" {...viewTransition}>
                  <ErrorBoundary label="Charts">
                    <Charts />
                  </ErrorBoundary>
                </motion.div>
              )}

              {selectedView === 'nyquist' && (
                <motion.div key="nyquist" className="absolute inset-0 p-4" {...viewTransition}>
                  <ErrorBoundary label="Nyquist">
                    <NyquistPlot />
                  </ErrorBoundary>
                </motion.div>
              )}

              {selectedView === 'dqdv' && (
                <motion.div key="dqdv" className="absolute inset-0 p-4" {...viewTransition}>
                  <ErrorBoundary label="dQ/dV">
                    <DQDVChart />
                  </ErrorBoundary>
                </motion.div>
              )}

              {selectedView === 'bms' && (
                <motion.div key="bms" className="absolute inset-0 overflow-hidden" {...viewTransition}>
                  <ErrorBoundary label="BMS">
                    <BMSDashboard />
                  </ErrorBoundary>
                </motion.div>
              )}

              {selectedView === 'cccv' && (
                <motion.div key="cccv" className="absolute inset-0 overflow-y-auto" {...viewTransition}>
                  <ErrorBoundary label="CC-CV">
                    <CCCVChart />
                  </ErrorBoundary>
                </motion.div>
              )}

              {selectedView === 'rul' && (
                <motion.div key="rul" className="absolute inset-0 overflow-hidden" {...viewTransition}>
                  <ErrorBoundary label="RUL">
                    <RULPanel />
                  </ErrorBoundary>
                </motion.div>
              )}

              {selectedView === 'ml-data' && (
                <motion.div key="ml-data" className="absolute inset-0 overflow-hidden" {...viewTransition}>
                  <ErrorBoundary label="ML Data">
                    <MLExportPanel />
                  </ErrorBoundary>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </main>
      </div>

      {/* ─── Bottom Status Bar ─── */}
      <StatusBar />
    </div>
  );
}
