/**
 * Temperature Heat Map Visualization
 *
 * Renders a 3D heat map overlay on the battery cell showing
 * temperature distribution from core to surface.
 *
 * Uses a grid of colored boxes where color represents temperature:
 *   - Blue: cold (< 20°C)
 *   - Green: normal (25°C)
 *   - Yellow: warm (35°C)
 *   - Orange: hot (45°C)
 *   - Red: critical (> 55°C)
 */

import { useMemo } from 'react';
import * as THREE from 'three';
import { useBatteryStore } from '../hooks/useBatteryState';
import { tempToColor } from '../utils/colors';

const SCALE = 20;
const GRID_X = 8;
const GRID_Y = 12;

export default function HeatMap() {
  const batteryState = useBatteryStore((s) => s.batteryState);

  const cellW = 0.091 * SCALE;
  const cellH = 0.148 * SCALE;

  const tempCore = batteryState?.thermal_T_core_c ?? 25;
  const tempSurface = batteryState?.thermal_T_surface_c ?? 25;
  const gradient = batteryState?.thermal_gradient_c ?? 0;

  // Generate heat map grid
  const heatData = useMemo(() => {
    const cells: Array<{
      position: [number, number, number];
      color: string;
      opacity: number;
    }> = [];

    const tileW = (cellW * 0.95) / GRID_X;
    const tileH = (cellH * 0.95) / GRID_Y;

    for (let ix = 0; ix < GRID_X; ix++) {
      for (let iy = 0; iy < GRID_Y; iy++) {
        // Position in cell coordinates
        const x = -cellW * 0.95 / 2 + tileW * (ix + 0.5);
        const y = -cellH * 0.95 / 2 + tileH * (iy + 0.5);

        // Distance from center (0 to 1), used for core-to-surface temperature gradient
        const cx = (ix - GRID_X / 2) / (GRID_X / 2);
        const cy = (iy - GRID_Y / 2) / (GRID_Y / 2);
        const distFromCenter = Math.sqrt(cx * cx + cy * cy) / Math.SQRT2;

        // Temperature at this point: parabolic profile from core to surface
        const temp = tempCore - (tempCore - tempSurface) * distFromCenter * distFromCenter;

        // Opacity based on how different from ambient
        const tempDiff = Math.abs(temp - 25);
        const opacity = Math.min(0.15 + tempDiff / 35 * 0.5, 0.6);

        cells.push({
          position: [x, y, 0],
          color: tempToColor(temp),
          opacity,
        });
      }
    }

    return { cells, tileW, tileH };
  }, [tempCore, tempSurface, cellW, cellH]);

  // Only render if there's a meaningful temperature gradient
  if (Math.abs(tempCore - 25) < 0.5 && gradient < 0.1) return null;

  return (
    <group position={[0, 0, 0.091 * SCALE / 2 * 0.5 + 0.02]}>
      {heatData.cells.map((cell, i) => (
        <mesh key={i} position={cell.position as any}>
          <planeGeometry args={[heatData.tileW * 0.95, heatData.tileH * 0.95]} />
          <meshStandardMaterial
            color={cell.color}
            transparent
            opacity={cell.opacity}
            emissive={cell.color}
            emissiveIntensity={0.3}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}
