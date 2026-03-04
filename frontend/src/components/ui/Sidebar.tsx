/**
 * Sidebar Navigation — Icon-based vertical sidebar (VS Code-like)
 *
 * Replaces the flat tab bar with an elegant icon sidebar.
 * Each view has a Lucide icon, tooltip, and keyboard shortcut hint.
 */

import { useState, useCallback } from 'react';
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
  Settings,
  Sun,
  Moon,
  ChevronLeft,
  ChevronRight,
  Zap,
  Search,
  Flame,
  FlaskConical,
  Shield,
  BarChart2,
  SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';
import { useBatteryStore } from '../../hooks/useBatteryState';
import { useTheme } from '../../context/ThemeContext';

type ViewId = '3d' | 'charts' | 'split' | 'nyquist' | 'dqdv' | 'bms' | 'cccv' | 'rul' | 'ml-data' | 'thermal' | 'aging' | 'safety' | 'balancing' | 'sweep';

interface NavItem {
  id: ViewId;
  label: string;
  icon: LucideIcon;
  shortcut?: string;
  group: 'views' | 'analysis' | 'data';
}

const navItems: NavItem[] = [
  { id: 'split',   label: 'Overview',     icon: LayoutDashboard, shortcut: '1', group: 'views' },
  { id: '3d',      label: '3D Scene',     icon: Box,             shortcut: '2', group: 'views' },
  { id: 'charts',  label: 'Time Series',  icon: BarChart3,       shortcut: '3', group: 'views' },
  { id: 'bms',     label: 'BMS Dashboard', icon: Cpu,            shortcut: '4', group: 'analysis' },
  { id: 'nyquist', label: 'Nyquist (EIS)', icon: CircleDot,      shortcut: '5', group: 'analysis' },
  { id: 'dqdv',    label: 'dQ/dV Analysis', icon: Activity,      shortcut: '6', group: 'analysis' },
  { id: 'cccv',    label: 'CC-CV Charge',  icon: BatteryCharging, shortcut: '7', group: 'analysis' },
  { id: 'thermal', label: 'Thermal Mgmt',   icon: Flame,           shortcut: undefined, group: 'analysis' },
  { id: 'safety',  label: 'Abuse Testing',  icon: Shield,          shortcut: undefined, group: 'analysis' },
  { id: 'balancing', label: 'SOC & Balance', icon: BarChart2,      shortcut: undefined, group: 'analysis' },
  { id: 'aging',   label: 'Cycle Aging',    icon: FlaskConical,    shortcut: undefined, group: 'data' },
  { id: 'sweep',   label: 'Param Sweep',    icon: SlidersHorizontal, shortcut: undefined, group: 'data' },
  { id: 'rul',     label: 'RUL Prediction', icon: TrendingUp,    shortcut: '8', group: 'data' },
  { id: 'ml-data', label: 'ML Dataset',    icon: Database,       shortcut: '9', group: 'data' },
];

interface SidebarProps {
  onOpenCommandPalette: () => void;
  onOpenSettings: () => void;
}

export default function Sidebar({ onOpenCommandPalette, onOpenSettings }: SidebarProps) {
  const selectedView = useBatteryStore((s) => s.selectedView);
  const setSelectedView = useBatteryStore((s) => s.setSelectedView);
  const { theme, toggleTheme } = useTheme();
  const [expanded, setExpanded] = useState(false);

  const handleNavClick = useCallback(
    (id: ViewId) => {
      setSelectedView(id);
    },
    [setSelectedView],
  );

  const groups = [
    { key: 'views', label: 'VIEWS' },
    { key: 'analysis', label: 'ANALYSIS' },
    { key: 'data', label: 'DATA' },
  ] as const;

  return (
    <motion.aside
      className="h-full flex flex-col bg-[#0c1222]/90 border-r border-white/[0.06] z-50"
      animate={{ width: expanded ? 220 : 64 }}
      transition={{ type: 'spring', stiffness: 300, damping: 30 }}
    >
      {/* ─── Logo ─── */}
      <div className="flex items-center justify-center h-16 border-b border-white/[0.06] shrink-0">
        <motion.div
          className="flex items-center gap-2.5 overflow-hidden"
          animate={{ width: expanded ? 200 : 36 }}
        >
          <Zap className="w-7 h-7 text-blue-400 shrink-0" />
          <AnimatePresence>
            {expanded && (
              <motion.span
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -10 }}
                className="text-base font-bold text-white whitespace-nowrap"
              >
                Battery Twin
              </motion.span>
            )}
          </AnimatePresence>
        </motion.div>
      </div>

      {/* ─── Search button ─── */}
      <button
        onClick={onOpenCommandPalette}
        className="mx-2 mt-2 flex items-center gap-2 px-2 py-1.5 rounded-lg
                   text-panel-muted hover:text-white hover:bg-white/[0.06] transition-colors"
        title="Command Palette (Ctrl+K)"
      >
        <Search className="w-5 h-5 shrink-0" />
        <AnimatePresence>
          {expanded && (
            <motion.span
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="text-sm whitespace-nowrap"
            >
              Search... <kbd className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-white/[0.08]">⌘K</kbd>
            </motion.span>
          )}
        </AnimatePresence>
      </button>

      {/* ─── Navigation groups ─── */}
      <nav className="flex-1 mt-2 overflow-y-auto overflow-x-hidden px-1.5 space-y-1">
        {groups.map(({ key, label }) => (
          <div key={key}>
            <AnimatePresence>
              {expanded && (
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="text-[11px] uppercase tracking-widest text-panel-muted/60 px-2 pt-3 pb-1"
                >
                  {label}
                </motion.p>
              )}
            </AnimatePresence>
            {navItems
              .filter((item) => item.group === key)
              .map((item) => {
                const isActive = selectedView === item.id;
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => handleNavClick(item.id)}
                    title={!expanded ? `${item.label} (${item.shortcut})` : undefined}
                    className={`
                      w-full flex items-center gap-3 px-2.5 py-2.5 rounded-lg text-sm font-medium
                      transition-all duration-150 relative group
                      ${isActive
                        ? 'bg-blue-500/15 text-blue-400'
                        : 'text-panel-muted hover:text-white hover:bg-white/[0.06]'}
                    `}
                  >
                    {/* Active indicator bar */}
                    {isActive && (
                      <motion.div
                        layoutId="sidebar-active"
                        className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-r bg-blue-400"
                        transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                      />
                    )}
                    <Icon className="w-5 h-5 shrink-0" />
                    <AnimatePresence>
                      {expanded && (
                        <motion.span
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -8 }}
                          className="whitespace-nowrap"
                        >
                          {item.label}
                        </motion.span>
                      )}
                    </AnimatePresence>
                    {expanded && item.shortcut && (
                      <span className="ml-auto text-[11px] text-panel-muted/50">{item.shortcut}</span>
                    )}
                  </button>
                );
              })}
          </div>
        ))}
      </nav>

      {/* ─── Bottom actions ─── */}
      <div className="border-t border-white/[0.06] p-2.5 space-y-1 shrink-0">
        <button
          onClick={onOpenSettings}
          className="w-full flex items-center gap-3 px-2.5 py-2.5 rounded-lg text-sm text-panel-muted
                     hover:text-white hover:bg-white/[0.06] transition-colors"
          title="Settings"
        >
          <Settings className="w-5 h-5 shrink-0" />
          {expanded && <span className="whitespace-nowrap">Settings</span>}
        </button>
        <button
          onClick={toggleTheme}
          className="w-full flex items-center gap-3 px-2.5 py-2.5 rounded-lg text-sm text-panel-muted
                     hover:text-white hover:bg-white/[0.06] transition-colors"
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
        >
          {theme === 'dark' ? (
            <Sun className="w-5 h-5 shrink-0" />
          ) : (
            <Moon className="w-5 h-5 shrink-0" />
          )}
          {expanded && <span className="whitespace-nowrap">{theme === 'dark' ? 'Light Mode' : 'Dark Mode'}</span>}
        </button>
        <button
          onClick={() => setExpanded(!expanded)}
          className="w-full flex items-center gap-3 px-2.5 py-2.5 rounded-lg text-sm text-panel-muted
                     hover:text-white hover:bg-white/[0.06] transition-colors"
          title={expanded ? 'Collapse sidebar' : 'Expand sidebar'}
        >
          {expanded ? (
            <ChevronLeft className="w-5 h-5 shrink-0" />
          ) : (
            <ChevronRight className="w-5 h-5 shrink-0" />
          )}
          {expanded && <span className="whitespace-nowrap">Collapse</span>}
        </button>
      </div>
    </motion.aside>
  );
}
