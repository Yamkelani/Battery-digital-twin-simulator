/**
 * Color utilities for battery visualization.
 *
 * Maps physical quantities to colors for 3D rendering:
 *   - SOC: green (high) → red (low)
 *   - Temperature: blue (cool) → red (hot)
 *   - SOH: green (healthy) → red (degraded)
 *   - Current: blue (charge) → red (discharge)
 */

import * as THREE from 'three';

/** Lerp between two hex colors. */
export function lerpColor(color1: string, color2: string, t: number): string {
  const c1 = new THREE.Color(color1);
  const c2 = new THREE.Color(color2);
  c1.lerp(c2, Math.max(0, Math.min(1, t)));
  return `#${c1.getHexString()}`;
}

/** SOC → color mapping: red (0%) → yellow (30%) → green (100%). */
export function socToColor(soc: number): string {
  if (soc < 0.15) return '#ef4444'; // Red
  if (soc < 0.3) return lerpColor('#ef4444', '#f97316', (soc - 0.15) / 0.15);
  if (soc < 0.5) return lerpColor('#f97316', '#eab308', (soc - 0.3) / 0.2);
  if (soc < 0.8) return lerpColor('#eab308', '#22c55e', (soc - 0.5) / 0.3);
  return '#22c55e'; // Green
}

/** Temperature → color: blue (cold) → green (normal) → red (hot). */
export function tempToColor(tempC: number): string {
  if (tempC < 10) return '#3b82f6'; // Blue - cold
  if (tempC < 25) return lerpColor('#3b82f6', '#22c55e', (tempC - 10) / 15);
  if (tempC < 40) return lerpColor('#22c55e', '#eab308', (tempC - 25) / 15);
  if (tempC < 50) return lerpColor('#eab308', '#f97316', (tempC - 40) / 10);
  if (tempC < 60) return lerpColor('#f97316', '#ef4444', (tempC - 50) / 10);
  return '#ef4444'; // Red - critical
}

/** SOH → color: red (degraded) → green (healthy). */
export function sohToColor(sohPct: number): string {
  if (sohPct > 90) return '#22c55e';
  if (sohPct > 80) return lerpColor('#22c55e', '#eab308', (90 - sohPct) / 10);
  if (sohPct > 70) return lerpColor('#eab308', '#f97316', (80 - sohPct) / 10);
  return '#ef4444';
}

/** Current → color: blue (charge) → grey (idle) → red (discharge). */
export function currentToColor(current: number, maxCurrent: number = 50): string {
  const normalized = current / maxCurrent;
  if (Math.abs(normalized) < 0.05) return '#64748b'; // Grey - idle
  if (normalized > 0) return lerpColor('#64748b', '#ef4444', normalized); // Discharge = red
  return lerpColor('#64748b', '#3b82f6', -normalized); // Charge = blue
}

/** Create a THREE.Color from temperature for heatmap shading. */
export function tempToThreeColor(tempC: number): THREE.Color {
  return new THREE.Color(tempToColor(tempC));
}

/** Concentration gradient → color for particle visualization. */
export function concentrationToColor(normalized: number): string {
  // 0 (depleted) = dark purple, 1 (full) = bright yellow
  if (normalized < 0.2) return lerpColor('#1e1b4b', '#7c3aed', normalized / 0.2);
  if (normalized < 0.5) return lerpColor('#7c3aed', '#06b6d4', (normalized - 0.2) / 0.3);
  if (normalized < 0.8) return lerpColor('#06b6d4', '#22c55e', (normalized - 0.5) / 0.3);
  return lerpColor('#22c55e', '#fbbf24', (normalized - 0.8) / 0.2);
}

/** Format time in hours:minutes:seconds. */
export function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

/** Format number with units. */
export function formatValue(value: number, unit: string, decimals: number = 1): string {
  return `${value.toFixed(decimals)} ${unit}`;
}
