/**
 * GlassPanel — Glassmorphism container with frosted-glass effect
 *
 * Provides a translucent, blurred backdrop panel used across the app
 * for a futuristic lab aesthetic.
 */

import { type ReactNode } from 'react';
import { motion, type HTMLMotionProps } from 'framer-motion';

interface GlassPanelProps extends HTMLMotionProps<'div'> {
  children: ReactNode;
  /** Extra intensity of blur (default 12) */
  blur?: number;
  /** Whether to show the glowing border accent */
  glow?: boolean;
  /** Padding preset */
  padding?: 'none' | 'sm' | 'md' | 'lg';
}

const padMap = { none: '', sm: 'p-2', md: 'p-4', lg: 'p-6' };

export default function GlassPanel({
  children,
  blur = 12,
  glow = false,
  padding = 'md',
  className = '',
  ...rest
}: GlassPanelProps) {
  return (
    <motion.div
      className={`
        relative rounded-xl border border-white/[0.08]
        bg-gradient-to-br from-white/[0.06] to-white/[0.02]
        shadow-lg shadow-black/20
        ${glow ? 'ring-1 ring-blue-500/20' : ''}
        ${padMap[padding]}
        ${className}
      `}
      style={{ backdropFilter: `blur(${blur}px)`, WebkitBackdropFilter: `blur(${blur}px)` }}
      {...rest}
    >
      {children}
    </motion.div>
  );
}
