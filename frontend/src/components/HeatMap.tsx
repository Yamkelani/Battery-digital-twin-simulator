/**
 * Temperature Heat Map Visualization
 *
 * Renders a 3D heat map overlay on the battery cell showing
 * temperature distribution from core to surface.
 *
 * Uses a grid of colored tiles where color represents temperature:
 *   - Blue: cold (< 20°C)
 *   - Green: normal (25°C)
 *   - Yellow: warm (35°C)
 *   - Orange: hot (45°C)
 *   - Red: critical (> 55°C)
 *
 * Tile opacity is driven by:
 *   - Temperature deviation from ambient
 *   - Active heat generation rate (ohmic + polarization + entropic)
 * The map shows realistic thermal asymmetry: terminals (top) glow hotter
 * due to tab-welding resistance, edges are cooler from convection.
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
  const cellD = 0.027 * SCALE;

  const tempCore = batteryState?.thermal_T_core_c ?? 25;
  const tempSurface = batteryState?.thermal_T_surface_c ?? 25;
  const gradient = batteryState?.thermal_gradient_c ?? 0;
  const heatGenW = batteryState?.heat_total_w ?? 0;
  const heatOhmic = batteryState?.heat_ohmic_w ?? 0;

  // Generate heat map grid — now uses heat generation for opacity too
  const heatData = useMemo(() => {
    const cells: Array<{
      position: [number, number, number];
      color: string;
      opacity: number;
      emissiveIntensity: number;
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

        // Terminal proximity factor — tabs at top = more ohmic heat there
        const terminalProximity = Math.max(0, (iy / GRID_Y - 0.7)) * 3.3; // top 30% of cell
        const tabHeatBias = terminalProximity * Math.min(heatOhmic / 3, 1);

        // Temperature at this point: parabolic profile from core to surface
        // Plus extra heat near current collector tabs at top
        const baseTemp = tempCore - (tempCore - tempSurface) * distFromCenter * distFromCenter;
        const temp = baseTemp + tabHeatBias * 3; // up to +3°C at tabs

        // Opacity driven by BOTH temperature deviation and active heat generation
        const tempDiff = Math.abs(temp - 25);
        const heatActivity = Math.min(heatGenW / 5, 1.0);  // 5W = fully active
        const opacity = Math.min(
          0.12 + tempDiff / 25 * 0.45 + heatActivity * 0.15,
          0.75,
        );

        // Emissive glow: more intense where heat is being generated
        const emGlow = 0.2 + heatActivity * 0.4 + tabHeatBias * 0.2;

        cells.push({
          position: [x, y, 0],
          color: tempToColor(temp),
          opacity,
          emissiveIntensity: emGlow,
        });
      }
    }

    return { cells, tileW, tileH };
  }, [tempCore, tempSurface, cellW, cellH, heatGenW, heatOhmic]);

  // Only render if there's a meaningful temperature signal
  if (Math.abs(tempCore - 25) < 0.3 && gradient < 0.05 && heatGenW < 0.05) return null;

  return (
    <group position={[0, 0, cellD * 0.5 + 0.02]}>
      {heatData.cells.map((cell, i) => (
        <mesh key={i} position={cell.position as any}>
          <planeGeometry args={[heatData.tileW * 0.95, heatData.tileH * 0.95]} />
          <meshStandardMaterial
            color={cell.color}
            transparent
            opacity={cell.opacity}
            emissive={cell.color}
            emissiveIntensity={cell.emissiveIntensity}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  );
}
