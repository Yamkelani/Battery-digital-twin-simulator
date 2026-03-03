/**
 * PackView3D — 3D grid of BatteryCell3D components with inter-cell effects.
 *
 * Features:
 *   - Per-cell SOC, temperature, SOH, SEI, current, heat data
 *   - Inter-cell thermal links rendered as glowing lines (blue→red)
 *   - Current-flow arrows through series strings
 *   - Click any cell to zoom into a focused single-cell view
 *   - Cell ID labels above each cell
 */

import { useRef, useMemo, useEffect, useState, useCallback } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { type CellStateOverride } from './BatteryCell3D';
import { useBatteryStore } from '../hooks/useBatteryState';
import { socToColor, tempToColor } from '../utils/colors';

const API_BASE = 'http://localhost:8001/api';

/* ────── Data interfaces ───────────────────────────────────────── */

interface CellInfo {
  cell_id: string;
  soc: number;
  voltage: number;
  temp_c: number;
  soh_pct: number;
  sei_loss_pct: number;
  current: number;
  heat_w: number;
  capacity_ah: number;
}

interface ThermalLink {
  from: string;
  to: string;
  heat_flow_w: number;
  temp_diff_c: number;
}

interface PackData {
  cells: CellInfo[];
  n_cells: number;
  thermal_links: ThermalLink[];
  n_series: number;
  n_parallel: number;
}

/* ────── Layout constants ──────────────────────────────────────── */

const PACK_CELL_SCALE = 0.35;
const SPACING_X = 1.82 * PACK_CELL_SCALE + 0.25;
const SPACING_Z = 0.54 * PACK_CELL_SCALE + 0.40;

/* ── Shared lightweight GPU resources (created once, reused by all pack cells) ── */
const CELL_W = 0.091 * 20;
const CELL_H = 0.148 * 20;
const CELL_D = 0.027 * 20;
const _packBoxGeo = new THREE.BoxGeometry(CELL_W, CELL_H, CELL_D);
const _packEdgesGeo = new THREE.EdgesGeometry(_packBoxGeo);
const _packTermGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.2, 6);
const _packEdgeMat = new THREE.LineBasicMaterial({ color: '#64748b', transparent: true, opacity: 0.4 });
const _termPosMat = new THREE.MeshStandardMaterial({ color: '#cc3333', metalness: 0.7, roughness: 0.3 });
const _termNegMat = new THREE.MeshStandardMaterial({ color: '#3333cc', metalness: 0.7, roughness: 0.3 });

const MAX_PACK_CELLS = 64; // safety cap to prevent WebGL overload

/* ── Additional shared geometries for pack cell enrichment ──── */
const _packFillGeo = new THREE.BoxGeometry(CELL_W * 0.88, CELL_H, CELL_D * 0.88);
const _packSEIGeo = new THREE.BoxGeometry(CELL_W * 1.02, CELL_H * 1.02, CELL_D * 1.02);
const _packHeatGeo = new THREE.BoxGeometry(CELL_W * 1.01, CELL_H * 1.01, CELL_D * 1.01);

/**
 * Enriched lightweight cell for pack grid — shows SOC fill, heat overlay,
 * SEI accumulation, and breathing/pulsing animation while still sharing
 * geometries for GPU efficiency (~8 draw objects per cell).
 */
function PackCellSimple({ cellState }: { cellState: CellStateOverride }) {
  const groupRef = useRef<THREE.Group>(null!);
  const shellRef = useRef<THREE.MeshStandardMaterial>(null!);
  const fillRef = useRef<THREE.Mesh>(null!);
  const fillMatRef = useRef<THREE.MeshStandardMaterial>(null!);
  const heatRef = useRef<THREE.MeshStandardMaterial>(null!);
  const seiRef = useRef<THREE.Mesh>(null!);
  const seiMatRef = useRef<THREE.MeshStandardMaterial>(null!);
  const termPosRef = useRef<THREE.Mesh>(null!);
  const termNegRef = useRef<THREE.Mesh>(null!);

  // Memoize base color for shell
  const color = useMemo(() => {
    const base = new THREE.Color(socToColor(cellState.soc));
    const temp = new THREE.Color(tempToColor(cellState.tempC));
    return base.lerp(temp, 0.3);
  }, [cellState.soc, cellState.tempC]);

  const socColor = useMemo(() => new THREE.Color(socToColor(cellState.soc)), [cellState.soc]);

  const opacity = Math.max(0.5, cellState.soh / 100) * 0.85;

  // Animate every frame — imperative updates, zero re-renders
  useFrame(() => {
    const t = Date.now() * 0.001;
    const activity = Math.min(Math.abs(cellState.current) / 20, 1);

    // Breathing scale based on current
    if (groupRef.current) {
      const breathe = 1 + Math.sin(t * 3) * 0.008 * (1 + activity * 2);
      groupRef.current.scale.setScalar(breathe);
    }

    // Shell emissive pulse when active
    if (shellRef.current) {
      shellRef.current.emissiveIntensity = activity * (0.15 + Math.sin(t * 4) * 0.08);
    }

    // SOC fill height
    if (fillRef.current && fillMatRef.current) {
      const fillH = Math.max(cellState.soc * CELL_H * 0.85, 0.01);
      fillRef.current.scale.y = fillH / CELL_H;
      fillRef.current.position.y = -CELL_H / 2 + fillH / 2 + CELL_H * 0.05;
      fillMatRef.current.opacity = 0.25 + activity * 0.15;
    }

    // Heat overlay — intensity based on temperature (25°C baseline)
    if (heatRef.current) {
      const heatNorm = Math.max(0, (cellState.tempC - 25) / 35);
      heatRef.current.opacity = heatNorm * 0.45;
      // Color shifts blue→yellow→red
      const hue = Math.max(0, 0.15 - heatNorm * 0.15); // 0.15 (yellow) → 0 (red)
      heatRef.current.color.setHSL(hue, 0.9, 0.5);
      heatRef.current.emissiveIntensity = heatNorm * 0.6;
      heatRef.current.emissive.setHSL(hue, 0.9, 0.5);
    }

    // SEI layer
    if (seiRef.current && seiMatRef.current) {
      const seiLoss = cellState.seiLoss;
      const amplified = seiLoss > 0 ? Math.max(seiLoss, 0.3) + seiLoss * 8 : 0;
      const grow = 1 + amplified * 0.012;
      seiRef.current.scale.set(grow, grow, grow);
      seiMatRef.current.opacity = amplified > 0 ? Math.min(0.06 + amplified * 0.08, 0.45) : 0;
    }

    // Terminal glow pulsing when current flows
    const termGlow = activity * (0.5 + Math.sin(t * 6) * 0.4);
    if (termPosRef.current) {
      const mat = termPosRef.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = termGlow * 0.7;
    }
    if (termNegRef.current) {
      const mat = termNegRef.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = termGlow * 0.7;
    }
  });

  return (
    <group ref={groupRef}>
      {/* Shell */}
      <mesh geometry={_packBoxGeo}>
        <meshStandardMaterial
          ref={shellRef}
          color={color}
          metalness={0.4}
          roughness={0.3}
          transparent
          opacity={opacity}
          emissive={color}
          emissiveIntensity={0}
        />
      </mesh>

      {/* Wireframe edges */}
      <lineSegments geometry={_packEdgesGeo} material={_packEdgeMat} />

      {/* SOC fill indicator */}
      <mesh ref={fillRef} geometry={_packFillGeo} position={[0, 0, 0]}>
        <meshStandardMaterial
          ref={fillMatRef}
          color={socColor}
          transparent
          opacity={0.25}
          emissive={socColor}
          emissiveIntensity={0.35}
          depthWrite={false}
        />
      </mesh>

      {/* Heat overlay */}
      <mesh geometry={_packHeatGeo}>
        <meshStandardMaterial
          ref={heatRef}
          color="#ff6600"
          transparent
          opacity={0}
          emissive="#ff4400"
          emissiveIntensity={0}
          side={THREE.FrontSide}
          depthWrite={false}
        />
      </mesh>

      {/* SEI accumulation layer */}
      <mesh ref={seiRef} geometry={_packSEIGeo}>
        <meshStandardMaterial
          ref={seiMatRef}
          color="#b8860b"
          transparent
          opacity={0}
          roughness={0.9}
          metalness={0.1}
          side={THREE.FrontSide}
          depthWrite={false}
        />
      </mesh>

      {/* Positive terminal */}
      <mesh
        ref={termPosRef}
        geometry={_packTermGeo}
        position={[CELL_W * 0.25, CELL_H / 2 + 0.1, 0]}
      >
        <meshStandardMaterial
          color="#cc3333"
          metalness={0.7}
          roughness={0.3}
          emissive="#ff0000"
          emissiveIntensity={0}
        />
      </mesh>

      {/* Negative terminal */}
      <mesh
        ref={termNegRef}
        geometry={_packTermGeo}
        position={[-CELL_W * 0.25, CELL_H / 2 + 0.1, 0]}
      >
        <meshStandardMaterial
          color="#3333cc"
          metalness={0.7}
          roughness={0.3}
          emissive="#0000ff"
          emissiveIntensity={0}
        />
      </mesh>
    </group>
  );
}

/* ────── Sub-components ────────────────────────────────────────── */

/** Colored line between two cells showing direction + magnitude of heat flow */
function HeatFlowLines({
  links,
  cellPositions,
}: {
  links: ThermalLink[];
  cellPositions: Map<string, [number, number, number]>;
}) {
  const meshRef = useRef<THREE.Group>(null!);

  useFrame(() => {
    if (!meshRef.current) return;
    const t = Date.now() * 0.003;
    // pulse the heat lines gently
    meshRef.current.children.forEach((child, i) => {
      const mat = (child as THREE.Mesh).material as THREE.MeshBasicMaterial;
      if (mat) {
        mat.opacity = 0.3 + Math.sin(t + i) * 0.15;
      }
    });
  });

  const geometries = useMemo(() => {
    return links
      .map((link) => {
        const pA = cellPositions.get(link.from);
        const pB = cellPositions.get(link.to);
        if (!pA || !pB) return null;

        // Color: blue (cold side) → red (hot side) based on temp_diff
        const absDiff = Math.min(Math.abs(link.temp_diff_c), 10);
        const intensity = absDiff / 10;
        const color = new THREE.Color().setHSL(
          0.6 - intensity * 0.6, // 0.6 = blue → 0 = red
          0.9,
          0.5,
        );

        // Tube width proportional to heat flow magnitude
        const absHeat = Math.min(Math.abs(link.heat_flow_w), 5);
        const radius = 0.015 + (absHeat / 5) * 0.04;

        const start = new THREE.Vector3(...pA);
        const end = new THREE.Vector3(...pB);
        // Lift above the cells a bit
        start.y += 0.6;
        end.y += 0.6;
        const mid = start.clone().lerp(end, 0.5);
        mid.y += 0.2; // arc upward slightly

        const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
        const tubeGeo = new THREE.TubeGeometry(curve, 12, radius, 6, false);

        return { geometry: tubeGeo, color, key: `${link.from}-${link.to}` };
      })
      .filter(Boolean) as { geometry: THREE.TubeGeometry; color: THREE.Color; key: string }[];
  }, [links, cellPositions]);

  return (
    <group ref={meshRef}>
      {geometries.map(({ geometry, color, key }) => (
        <mesh key={key} geometry={geometry}>
          <meshBasicMaterial color={color} transparent opacity={0.4} />
        </mesh>
      ))}
    </group>
  );
}

/* Shared arrow resources — created once, reused forever */
const _arrowConeGeo = new THREE.ConeGeometry(0.06, 0.15, 6);
const _arrowMatDischarge = new THREE.MeshBasicMaterial({ color: '#ff6644', transparent: true, opacity: 0.8 });
const _arrowMatCharge = new THREE.MeshBasicMaterial({ color: '#44aaff', transparent: true, opacity: 0.8 });

/**
 * Animated arrows along series strings — uses imperative animation (no React
 * re-renders) to avoid creating thousands of geometries/materials per second.
 */
function CurrentFlowArrows({
  cells,
  cellPositions,
  nSeries,
  nParallel,
}: {
  cells: CellInfo[];
  cellPositions: Map<string, [number, number, number]>;
  nSeries: number;
  nParallel: number;
}) {
  const groupRef = useRef<THREE.Group>(null!);

  // Build static arrow descriptors
  const arrows = useMemo(() => {
    if (cells.length === 0) return [];
    const result: { start: THREE.Vector3; end: THREE.Vector3; current: number }[] = [];
    for (let p = 0; p < nParallel; p++) {
      for (let s = 0; s < nSeries - 1; s++) {
        const idxA = p * nSeries + s;
        const idxB = p * nSeries + s + 1;
        if (idxA >= cells.length || idxB >= cells.length) continue;
        const posA = cellPositions.get(cells[idxA].cell_id);
        const posB = cellPositions.get(cells[idxB].cell_id);
        if (!posA || !posB) continue;
        result.push({
          start: new THREE.Vector3(...posA),
          end: new THREE.Vector3(...posB),
          current: cells[idxA].current,
        });
      }
    }
    return result;
  }, [cells, cellPositions, nSeries, nParallel]);

  // Imperatively move meshes each frame — zero React re-renders
  useFrame(() => {
    if (!groupRef.current) return;
    const frac = ((Date.now() * 0.001) % 1); // 0..1 repeating
    const children = groupRef.current.children as THREE.Mesh[];
    for (let i = 0; i < children.length && i < arrows.length; i++) {
      const a = arrows[i];
      const mesh = children[i];
      const pos = a.start.clone().lerp(a.end, frac);
      pos.y -= 0.3;
      mesh.position.copy(pos);
    }
  });

  if (arrows.length === 0) return null;

  return (
    <group ref={groupRef}>
      {arrows.map((a, i) => {
        // Orient cone once (static quaternion)
        const dir = a.end.clone().sub(a.start).normalize();
        if (a.current < 0) dir.negate();
        const quat = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          dir,
        );
        return (
          <mesh
            key={i}
            geometry={_arrowConeGeo}
            material={a.current > 0 ? _arrowMatDischarge : _arrowMatCharge}
            quaternion={quat}
          />
        );
      })}
    </group>
  );
}

/** Floating cell ID label using a sprite */
function CellLabel({ position, label }: { position: [number, number, number]; label: string }) {
  const canvasTexture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 48;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, 128, 48);
    ctx.fillStyle = '#000000';
    ctx.globalAlpha = 0.5;
    ctx.fillRect(0, 8, 128, 32);
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 18px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 64, 24);
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    return tex;
  }, [label]);

  return (
    <sprite position={position} scale={[0.6, 0.22, 1]}>
      <spriteMaterial map={canvasTexture} transparent depthWrite={false} />
    </sprite>
  );
}

/* ────── Main PackView3D ───────────────────────────────────────── */

export default function PackView3D() {
  const groupRef = useRef<THREE.Group>(null!);
  const [packData, setPackData] = useState<PackData | null>(null);
  const setFocusedCellId = useBatteryStore((s) => s.setFocusedCellId);

  /* ---- Polling ---- */
  const fetchPack = useCallback(async () => {
    try {
      const resp = await fetch(`${API_BASE}/pack/status`);
      if (!resp.ok) return;
      const json = await resp.json();
      if (json.status === 'ok') {
        setPackData(json as PackData);
      } else if (json.status === 'no_pack') {
        // Pack was lost (server restart) — fall back to single cell
        const { clearPack } = useBatteryStore.getState();
        clearPack();
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    fetchPack();
    const id = setInterval(fetchPack, 1500);
    return () => clearInterval(id);
  }, [fetchPack]);

  /* ---- Grid layout ---- */
  const layout = useMemo(() => {
    if (!packData) return { cols: 0, rows: 0 };
    const n = packData.n_cells;
    const cols = Math.ceil(Math.sqrt(n));
    const rows = Math.ceil(n / cols);
    return { cols, rows };
  }, [packData]);

  /* ---- Cell positions map ---- */
  const cellPositions = useMemo(() => {
    const map = new Map<string, [number, number, number]>();
    if (!packData) return map;
    const halfW = ((layout.cols - 1) * SPACING_X) / 2;
    const halfZ = ((layout.rows - 1) * SPACING_Z) / 2;
    packData.cells.forEach((cell, idx) => {
      const col = idx % layout.cols;
      const row = Math.floor(idx / layout.cols);
      const x = col * SPACING_X - halfW;
      const z = row * SPACING_Z - halfZ;
      map.set(cell.cell_id, [x, 0, z]);
    });
    return map;
  }, [packData, layout]);

  if (!packData || packData.cells.length === 0) return null;

  const halfW = ((layout.cols - 1) * SPACING_X) / 2;
  const halfZ = ((layout.rows - 1) * SPACING_Z) / 2;

  return (
    <group ref={groupRef} position={[0, 0.5, 0]}>
      {/* ── Individual cells ──────────────────────────────────── */}
      {packData.cells.slice(0, MAX_PACK_CELLS).map((cell, idx) => {
        const col = idx % layout.cols;
        const row = Math.floor(idx / layout.cols);
        const x = col * SPACING_X - halfW;
        const z = row * SPACING_Z - halfZ;

        const cellState: CellStateOverride = {
          soc: cell.soc,
          tempC: cell.temp_c,
          soh: cell.soh_pct,
          seiLoss: cell.sei_loss_pct,
          current: cell.current,
        };

        return (
          <group key={cell.cell_id}>
            {/* Clickable wrapper */}
            <group
              position={[x, 0, z]}
              scale={PACK_CELL_SCALE}
              onClick={(e) => {
                e.stopPropagation();
                setFocusedCellId(cell.cell_id);
              }}
              onPointerOver={(e) => {
                e.stopPropagation();
                document.body.style.cursor = 'pointer';
              }}
              onPointerOut={() => {
                document.body.style.cursor = 'default';
              }}
            >
              <PackCellSimple cellState={cellState} />
            </group>

            {/* Label — skip for large packs to save GPU textures */}
            {packData.cells.length <= 24 && (
              <CellLabel position={[x, 0.75, z]} label={cell.cell_id.replace('CELL_', 'C')} />
            )}
          </group>
        );
      })}

      {/* ── Inter-cell thermal links (skip for large packs) ──── */}
      {packData.thermal_links && packData.thermal_links.length > 0 && packData.n_cells <= 32 && (
        <HeatFlowLines links={packData.thermal_links} cellPositions={cellPositions} />
      )}

      {/* ── Current flow arrows (skip for large packs) ─────── */}
      {packData.n_cells <= 32 && (
        <CurrentFlowArrows
          cells={packData.cells}
          cellPositions={cellPositions}
          nSeries={packData.n_series ?? 1}
          nParallel={packData.n_parallel ?? 1}
        />
      )}
    </group>
  );
}
