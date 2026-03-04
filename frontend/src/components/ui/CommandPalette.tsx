/**
 * Command Palette — Cmd+K style quick-action search
 *
 * Provides instant access to views, actions, and settings via keyboard.
 * Uses cmdk (https://cmdk.paco.me/) under the hood.
 */

import { useEffect, useState, useCallback } from 'react';
import { Command } from 'cmdk';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Box,
  BarChart3,
  LayoutDashboard,
  Activity,
  CircleDot,
  Cpu,
  BatteryCharging,
  TrendingUp,
  Database,
  Play,
  Pause,
  RotateCcw,
  Square,
  Sun,
  Moon,
  Download,
  Gauge,
  type LucideIcon,
} from 'lucide-react';
import { useBatteryStore } from '../../hooks/useBatteryState';
import {
  simStart,
  simPause,
  simResume,
  simStop,
  simReset,
} from '../../services/simulationSocket';
import { useTheme } from '../../context/ThemeContext';

type ViewId = '3d' | 'charts' | 'split' | 'nyquist' | 'dqdv' | 'bms' | 'cccv' | 'rul' | 'ml-data';

interface CommandItem {
  id: string;
  label: string;
  icon: LucideIcon;
  group: string;
  action: () => void;
  shortcut?: string;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export default function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [search, setSearch] = useState('');
  const setSelectedView = useBatteryStore((s) => s.setSelectedView);
  const status = useBatteryStore((s) => s.status);
  const { theme, toggleTheme } = useTheme();

  // Build command list
  const commands: CommandItem[] = [
    // Navigation
    { id: 'view-overview',  label: 'Go to Overview',       icon: LayoutDashboard, group: 'Navigation', action: () => setSelectedView('split') },
    { id: 'view-3d',        label: 'Go to 3D Scene',       icon: Box,             group: 'Navigation', action: () => setSelectedView('3d'), shortcut: '2' },
    { id: 'view-charts',    label: 'Go to Time Series',    icon: BarChart3,       group: 'Navigation', action: () => setSelectedView('charts'), shortcut: '3' },
    { id: 'view-bms',       label: 'Go to BMS Dashboard',  icon: Cpu,             group: 'Navigation', action: () => setSelectedView('bms') },
    { id: 'view-nyquist',   label: 'Go to Nyquist Plot',   icon: CircleDot,       group: 'Navigation', action: () => setSelectedView('nyquist') },
    { id: 'view-dqdv',      label: 'Go to dQ/dV Analysis', icon: Activity,        group: 'Navigation', action: () => setSelectedView('dqdv') },
    { id: 'view-cccv',      label: 'Go to CC-CV Charge',   icon: BatteryCharging, group: 'Navigation', action: () => setSelectedView('cccv') },
    { id: 'view-rul',       label: 'Go to RUL Prediction', icon: TrendingUp,      group: 'Navigation', action: () => setSelectedView('rul') },
    { id: 'view-ml',        label: 'Go to ML Dataset',     icon: Database,        group: 'Navigation', action: () => setSelectedView('ml-data') },

    // Simulation control
    ...(status === 'idle' || status === 'completed'
      ? [{ id: 'sim-start',    label: 'Start Simulation',    icon: Play,          group: 'Simulation', action: simStart,  shortcut: 'Space' }]
      : []),
    ...(status === 'running'
      ? [{ id: 'sim-pause',    label: 'Pause Simulation',    icon: Pause,         group: 'Simulation', action: simPause,  shortcut: 'Space' }]
      : []),
    ...(status === 'paused'
      ? [{ id: 'sim-resume',   label: 'Resume Simulation',   icon: Play,          group: 'Simulation', action: simResume, shortcut: 'Space' }]
      : []),
    { id: 'sim-stop',     label: 'Stop Simulation',      icon: Square,        group: 'Simulation', action: simStop,   shortcut: 'Esc' },
    { id: 'sim-reset',    label: 'Reset Simulation',     icon: RotateCcw,     group: 'Simulation', action: () => simReset(0.8, 25, true), shortcut: 'R' },

    // Settings
    { id: 'toggle-theme',  label: `Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`, icon: theme === 'dark' ? Sun : Moon, group: 'Settings', action: toggleTheme },
  ];

  // Close on Escape
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        if (open) onClose();
      }
    };
    document.addEventListener('keydown', down);
    return () => document.removeEventListener('keydown', down);
  }, [open, onClose]);

  const handleSelect = useCallback(
    (id: string) => {
      const cmd = commands.find((c) => c.id === id);
      cmd?.action();
      onClose();
      setSearch('');
    },
    [commands, onClose],
  );

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/50 backdrop-blur-sm z-[100]"
            onClick={onClose}
          />

          {/* Palette */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: -20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -20 }}
            transition={{ type: 'spring', stiffness: 400, damping: 30 }}
            className="fixed top-[20%] left-1/2 -translate-x-1/2 w-[520px] max-w-[90vw] z-[101]"
          >
            <Command
              className="rounded-xl border border-white/[0.1] bg-[#0f1729]/95 shadow-2xl shadow-black/40 overflow-hidden"
              style={{ backdropFilter: 'blur(20px)' }}
            >
              <div className="flex items-center border-b border-white/[0.06] px-3">
                <Gauge className="w-4 h-4 text-panel-muted mr-2 shrink-0" />
                <Command.Input
                  value={search}
                  onValueChange={setSearch}
                  placeholder="Type a command or search..."
                  className="flex-1 py-3 bg-transparent text-sm text-white placeholder:text-panel-muted
                             outline-none border-none"
                />
                <kbd className="text-[10px] text-panel-muted/60 px-1.5 py-0.5 rounded border border-white/[0.08] bg-white/[0.04]">
                  ESC
                </kbd>
              </div>

              <Command.List className="max-h-[300px] overflow-y-auto p-2">
                <Command.Empty className="py-6 text-center text-sm text-panel-muted">
                  No results found.
                </Command.Empty>

                {['Navigation', 'Simulation', 'Settings'].map((group) => {
                  const items = commands.filter((c) => c.group === group);
                  if (items.length === 0) return null;
                  return (
                    <Command.Group key={group} heading={group}>
                      <p className="text-[9px] uppercase tracking-widest text-panel-muted/50 px-2 py-1">{group}</p>
                      {items.map((cmd) => {
                        const Icon = cmd.icon;
                        return (
                          <Command.Item
                            key={cmd.id}
                            value={cmd.label}
                            onSelect={() => handleSelect(cmd.id)}
                            className="flex items-center gap-3 px-2 py-2 rounded-lg cursor-pointer text-sm text-panel-muted
                                       data-[selected=true]:bg-white/[0.06] data-[selected=true]:text-white
                                       transition-colors"
                          >
                            <Icon className="w-4 h-4 shrink-0" />
                            <span className="flex-1">{cmd.label}</span>
                            {cmd.shortcut && (
                              <kbd className="text-[10px] text-panel-muted/50 px-1.5 py-0.5 rounded border border-white/[0.06] bg-white/[0.03]">
                                {cmd.shortcut}
                              </kbd>
                            )}
                          </Command.Item>
                        );
                      })}
                    </Command.Group>
                  );
                })}
              </Command.List>
            </Command>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
