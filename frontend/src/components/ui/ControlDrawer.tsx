/**
 * ControlDrawer — Slide-out controls panel
 *
 * Replaces the fixed left sidebar with a collapsible drawer that slides
 * in from the right, giving more screen real estate to the main content.
 */

import { motion, AnimatePresence } from 'framer-motion';
import { X, SlidersHorizontal } from 'lucide-react';
import Controls from '../Controls';

interface ControlDrawerProps {
  open: boolean;
  onClose: () => void;
}

export default function ControlDrawer({ open, onClose }: ControlDrawerProps) {
  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/30 backdrop-blur-[2px] z-40"
            onClick={onClose}
          />

          {/* Drawer panel */}
          <motion.aside
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            className="fixed top-0 right-0 h-full w-96 max-w-[85vw] z-50
                       bg-[#0f1729]/95 border-l border-white/[0.08] shadow-2xl shadow-black/40
                       flex flex-col"
            style={{ backdropFilter: 'blur(20px)' }}
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-white/[0.06]">
              <div className="flex items-center gap-2.5">
                <SlidersHorizontal className="w-5 h-5 text-blue-400" />
                <h2 className="text-base font-semibold text-white">Simulation Controls</h2>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 rounded-lg hover:bg-white/[0.06] text-panel-muted hover:text-white transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable controls body */}
            <div className="flex-1 overflow-y-auto">
              <Controls />
            </div>
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  );
}
