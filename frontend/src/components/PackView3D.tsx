/**
 * PackView3D — 3D grid of battery cells colour-coded by SOC / temperature.
 *
 * Fetches per-cell data from /api/pack/status and renders a grid
 * using React Three Fiber.
 */

import { useRef, useMemo, useEffect, useState, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const API_BASE = 'http://localhost:8001/api';

interface CellInfo {
  cell_id: string;
  soc: number;
  voltage: number;
  temp_c: number;
  soh_pct: number;
  capacity_ah: number;
}

interface PackData {
  cells: CellInfo[];
  n_cells: number;
}

/**
 * Maps a normalised value [0–1] to a colour gradient (blue → green → red).
 */
function valueToColor(t: number): THREE.Color {
  const c = new THREE.Color();
  if (t < 0.5) {
    c.setRGB(0, t * 2, 1 - t * 2); // blue → green
  } else {
    c.setRGB((t - 0.5) * 2, 1 - (t - 0.5) * 2, 0); // green → red
  }
  return c;
}

export default function PackView3D({ colorMode = 'soc' }: { colorMode?: 'soc' | 'temp' | 'soh' }) {
  const groupRef = useRef<THREE.Group>(null!);
  const [packData, setPackData] = useState<PackData | null>(null);

  const fetchPack = useCallback(async () => {
    try {
      const resp = await fetch(`${API_BASE}/pack/status`);
      if (!resp.ok) return;
      const json = await resp.json();
      if (json.status === 'ok') setPackData(json);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetchPack();
    const id = setInterval(fetchPack, 2000);
    return () => clearInterval(id);
  }, [fetchPack]);

  // Compute grid layout (try to be roughly square)
  const layout = useMemo(() => {
    if (!packData) return { cols: 0, rows: 0 };
    const n = packData.n_cells;
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    return { cols, rows };
  }, [packData]);

  // Slow rotation
  useFrame((_, delta) => {
    if (groupRef.current) {
      groupRef.current.rotation.y += delta * 0.08;
    }
  });

  if (!packData || packData.cells.length === 0) {
    return null; // nothing to render
  }

  const spacing = 1.4;
  const halfW = ((layout.cols - 1) * spacing) / 2;
  const halfH = ((layout.rows - 1) * spacing) / 2;

  return (
    <group ref={groupRef}>
      {packData.cells.map((cell, idx) => {
        const col = idx % layout.cols;
        const row = Math.floor(idx / layout.cols);
        const x = col * spacing - halfW;
        const z = row * spacing - halfH;

        let t = 0;
        if (colorMode === 'soc') t = cell.soc;
        else if (colorMode === 'temp') t = Math.min((cell.temp_c - 20) / 40, 1);
        else if (colorMode === 'soh') t = 1 - cell.soh_pct / 100;

        const color = valueToColor(t);

        return (
          <mesh key={cell.cell_id} position={[x, 0, z]}>
            <boxGeometry args={[0.9, 1.6, 0.6]} />
            <meshStandardMaterial color={color} roughness={0.4} metalness={0.3} />
          </mesh>
        );
      })}
    </group>
  );
}
