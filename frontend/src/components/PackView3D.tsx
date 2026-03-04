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
import { API_BASE } from '../config';

/* ────── Data interfaces ───────────────────────────────────────── */

interface CellInfo {
  cell_id: string;
  soc: number;
  voltage: number;
  temp_c: number;
  temp_surface_c: number;
  temp_gradient_c: number;
  soh_pct: number;
  sei_loss_pct: number;
  plating_loss_pct: number;
  cycle_loss_pct: number;
  resistance_factor: number;
  current: number;
  heat_w: number;
  capacity_ah: number;
  is_edge_cell: boolean;
  h_conv_effective: number;
}

interface ThermalLink {
  from: string;
  to: string;
  heat_flow_w: number;
  temp_diff_c: number;
  from_temp_c: number;
  to_temp_c: number;
  from_surface_c: number;
  to_surface_c: number;
  coupling_type: 'series' | 'parallel';
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
const _packSEIGeo = new THREE.BoxGeometry(CELL_W * 1.04, CELL_H * 1.04, CELL_D * 1.04);
const _packHeatGeo = new THREE.BoxGeometry(CELL_W * 1.01, CELL_H * 1.01, CELL_D * 1.01);
const _packPlatingGeo = new THREE.BoxGeometry(CELL_W * 0.84, CELL_H * 0.80, CELL_D * 0.15); // thin slab on anode face

/* Reusable temp Color objects — avoids per-frame allocations (GC pressure) */
const _tmpColor1 = new THREE.Color();
const _tmpColor2 = new THREE.Color();

/**
 * Enriched lightweight cell for pack grid — clearly shows:
 *  • SOC fill (green→yellow→red bar that rises/falls)
 *  • Heat overlay (blue→red outline shimmer when hot)
 *  • SEI accumulation (amber crust that slowly grows outward)
 *  • Lithium plating (silver-grey crystalline slab on anode face)
 *  • Breathing/terminal glow when current flows
 *
 * All animation is imperative (useFrame) — zero React re-renders.
 * All THREE.Color work reuses module-level objects — zero per-frame allocations.
 */
/** Safely coerce a number — returns fallback when value is NaN, Infinity, or nullish */
function safe(v: number | undefined | null, fallback: number): number {
  if (v == null || !Number.isFinite(v)) return fallback;
  return v;
}

function PackCellSimple({ cellState }: { cellState: CellStateOverride }) {
  const groupRef = useRef<THREE.Group>(null!);
  const shellRef = useRef<THREE.MeshStandardMaterial>(null!);
  const fillRef = useRef<THREE.Mesh>(null!);
  const fillMatRef = useRef<THREE.MeshStandardMaterial>(null!);
  const heatRef = useRef<THREE.MeshStandardMaterial>(null!);
  const seiRef = useRef<THREE.Mesh>(null!);
  const seiMatRef = useRef<THREE.MeshStandardMaterial>(null!);
  const platingRef = useRef<THREE.Mesh>(null!);
  const platingMatRef = useRef<THREE.MeshStandardMaterial>(null!);
  const termPosRef = useRef<THREE.Mesh>(null!);
  const termNegRef = useRef<THREE.Mesh>(null!);

  // Guard against NaN/undefined — prevents cells from going invisible
  const soh = safe(cellState.soh, 100);
  const opacity = Math.max(0.6, soh / 100) * 0.85;

  // Animate every frame — imperative updates, zero re-renders, zero allocations
  useFrame(() => {
    const t = Date.now() * 0.001;
    const _soc = safe(cellState.soc, 0.5);
    const _tempC = safe(cellState.tempC, 25);
    const _current = safe(cellState.current, 0);
    const _seiLoss = safe(cellState.seiLoss, 0);
    const _platingLoss = safe(cellState.platingLoss, 0);
    const _cycleLoss = safe(cellState.cycleLoss, 0);
    const _resFactor = safe(cellState.resistanceFactor, 1);
    const activity = Math.min(Math.abs(_current) / 20, 1);

    // ── Visual amplification: same non-linear mapping as single-cell view ──
    const seiVisual = Math.min(Math.pow(Math.max(_seiLoss / 3, 0), 0.55), 1.0);
    const platingVisual = Math.min(Math.pow(Math.max(_platingLoss / 0.5, 0), 0.5), 1.0);
    const cycleVisual = Math.min(Math.pow(Math.max(_cycleLoss / 2, 0), 0.5), 1.0);
    const degradationTotal = Math.min(seiVisual * 0.5 + platingVisual * 0.3 + cycleVisual * 0.2, 1.0);
    const resistVisual = Math.min((_resFactor - 1) * 3, 1.0);

    // ── Breathing + gas swelling ──
    if (groupRef.current) {
      const gasSwelling = 1 + seiVisual * 0.01;
      const breathe = gasSwelling + Math.sin(t * 3) * 0.006 * (1 + activity * 2);
      groupRef.current.scale.setScalar(breathe);
    }

    // ── Shell color: SOC-based green→yellow→red, subtly darkened by degradation ──
    if (shellRef.current) {
      _tmpColor1.set(socToColor(_soc));
      // Slight temperature tint (warm shift when hot)
      const tempInfluence = Math.max(0, (_tempC - 30) / 40) * 0.15;
      if (tempInfluence > 0.01) {
        _tmpColor2.set('#ff6644');
        _tmpColor1.lerp(_tmpColor2, tempInfluence);
      }
      // Darken slightly with total degradation (but don't make it amber)
      _tmpColor1.multiplyScalar(1.0 - degradationTotal * 0.25);
      shellRef.current.color.copy(_tmpColor1);
      shellRef.current.emissive.copy(_tmpColor1);
      shellRef.current.emissiveIntensity = activity * (0.08 + Math.sin(t * 4) * 0.04);
      shellRef.current.roughness = 0.3 + degradationTotal * 0.3;
    }

    // ── SOC fill bar — capacity-adjusted: degraded cells hold less charge ──
    if (fillRef.current && fillMatRef.current) {
      const effectiveCap = soh / 100;
      const fillH = Math.max(_soc * effectiveCap * CELL_H * 0.85, 0.01);
      fillRef.current.scale.y = fillH / CELL_H;
      fillRef.current.position.y = -CELL_H / 2 + fillH / 2 + CELL_H * 0.05;
      fillMatRef.current.opacity = 0.3 + activity * 0.15;
      // Update fill color to match SOC
      _tmpColor1.set(socToColor(_soc));
      fillMatRef.current.color.copy(_tmpColor1);
      fillMatRef.current.emissive.copy(_tmpColor1);
    }

    // ── Heat overlay — faint outline glow, only visible when temp > 30°C ──
    if (heatRef.current) {
      const heatNorm = Math.max(0, (_tempC - 30) / 30); // starts at 30°C
      heatRef.current.opacity = heatNorm * 0.25;  // subtle, max 0.25
      const hue = Math.max(0, 0.15 - heatNorm * 0.15);
      heatRef.current.color.setHSL(hue, 0.9, 0.5);
      heatRef.current.emissiveIntensity = heatNorm * 0.4;
      heatRef.current.emissive.setHSL(hue, 0.9, 0.5);
    }

    // ── SEI accumulation — amber/brown crust growing outward, amplified visual ──
    if (seiRef.current && seiMatRef.current) {
      // Scale grows up to +20% — clearly visible shell widening
      const grow = 1 + seiVisual * 0.20;
      seiRef.current.scale.set(grow, grow, grow);

      // Opacity: visible amber crust proportional to SEI growth
      const seiOpacity = seiVisual > 0.005 ? 0.08 + seiVisual * 0.50 : 0;
      const pulse = seiVisual > 0.3 ? Math.sin(t * 1.5) * 0.03 * seiVisual : 0;
      seiMatRef.current.opacity = Math.min(seiOpacity + pulse, 0.60);

      // Color progression: fresh amber → dark crusty brown
      const r = 0.82 - seiVisual * 0.45;
      const g = 0.60 - seiVisual * 0.37;
      const b = 0.12 - seiVisual * 0.05;
      seiMatRef.current.color.setRGB(r, g, b);
      seiMatRef.current.emissive.setRGB(r * 0.6, g * 0.5, b * 0.3);

      // Emissive: warm glow, subtle pulse when actively growing
      seiMatRef.current.emissiveIntensity = seiVisual * 0.5
        + (seiVisual > 0.01 ? Math.sin(t * 1.2) * 0.04 * seiVisual : 0);
      seiMatRef.current.roughness = 0.5 + seiVisual * 0.5;
    }

    // ── Lithium plating — silver/grey metallic slab, amplified visual ──
    if (platingRef.current && platingMatRef.current) {
      if (platingVisual > 0.005) {
        platingRef.current.visible = true;
        // Grows thicker as plating increases
        const thickness = 0.4 + platingVisual * 1.8;
        platingRef.current.scale.z = thickness;
        // Shifts from silver to darker grey as dendrites form
        const grey = 0.85 - platingVisual * 0.35;
        platingMatRef.current.color.setRGB(grey, grey, grey * 1.05);
        platingMatRef.current.opacity = 0.3 + platingVisual * 0.55;
        // Spiky shimmer effect for crystalline look
        platingMatRef.current.emissiveIntensity =
          0.15 + platingVisual * 0.45 + Math.sin(t * 8 + platingVisual * 20) * 0.08;
        platingMatRef.current.emissive.setRGB(0.5, 0.55, 0.6);
      } else {
        platingRef.current.visible = false;
      }
    }

    // ── Terminal glow — degraded by resistance growth ──
    const termGlow = activity * (0.4 + Math.sin(t * 6) * 0.3);
    const termFreshness = Math.max(1.0 - resistVisual, 0.15);
    if (termPosRef.current) {
      const mat = termPosRef.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = termGlow * 0.6 * termFreshness;
      mat.metalness = Math.max(0.8 - resistVisual * 0.5, 0.2);
      mat.roughness = Math.min(0.2 + resistVisual * 0.5, 0.7);
    }
    if (termNegRef.current) {
      const mat = termNegRef.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = termGlow * 0.6 * termFreshness;
      mat.metalness = Math.max(0.8 - resistVisual * 0.5, 0.2);
      mat.roughness = Math.min(0.2 + resistVisual * 0.5, 0.7);
    }
  });

  return (
    <group ref={groupRef}>
      {/* Shell — SOC-colored, subtly darkened by degradation */}
      <mesh geometry={_packBoxGeo} renderOrder={0}>
        <meshStandardMaterial
          ref={shellRef}
          color="#22c55e"
          metalness={0.4}
          roughness={0.3}
          transparent
          opacity={opacity}
          emissive="#22c55e"
          emissiveIntensity={0}
        />
      </mesh>

      {/* Wireframe edges */}
      <lineSegments geometry={_packEdgesGeo} material={_packEdgeMat} />

      {/* SOC fill level — green liquid bar */}
      <mesh ref={fillRef} geometry={_packFillGeo} position={[0, 0, 0]} renderOrder={1}>
        <meshStandardMaterial
          ref={fillMatRef}
          color="#22c55e"
          transparent
          opacity={0.3}
          emissive="#22c55e"
          emissiveIntensity={0.3}
          depthWrite={false}
        />
      </mesh>

      {/* Heat glow outline — subtle, only at elevated temps */}
      <mesh geometry={_packHeatGeo} renderOrder={2}>
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

      {/* SEI accumulation crust — amber shell that grows outward */}
      <mesh ref={seiRef} geometry={_packSEIGeo} renderOrder={3}>
        <meshStandardMaterial
          ref={seiMatRef}
          color="#b8860b"
          transparent
          opacity={0}
          roughness={0.85}
          metalness={0.05}
          emissive="#cd853f"
          emissiveIntensity={0}
          side={THREE.FrontSide}
          depthWrite={false}
        />
      </mesh>

      {/* Lithium plating — silver/grey metallic slab on anode face (front -Z) */}
      <mesh
        ref={platingRef}
        geometry={_packPlatingGeo}
        position={[0, 0, -(CELL_D * 0.55)]}
        visible={false}
        renderOrder={4}
      >
        <meshStandardMaterial
          ref={platingMatRef}
          color="#c0c0c0"
          transparent
          opacity={0}
          metalness={0.8}
          roughness={0.2}
          emissive="#8090a0"
          emissiveIntensity={0}
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

/* Shared geometries for heat flow arrows */
const _heatArrowConeGeo = new THREE.ConeGeometry(0.05, 0.14, 6);
const _heatArrowShaftGeo = new THREE.CylinderGeometry(0.018, 0.018, 1, 6);

/**
 * Directional heat flow arrows between cells — shows heat moving from
 * HOT → COLD based on actual temperature difference.
 *
 * Physics: Q = G × (T_surface_A − T_surface_B)
 *   - Positive Q → heat flows A→B (A is hotter)
 *   - Negative Q → heat flows B→A (B is hotter)
 *   - Arrow direction follows the sign of Q
 *   - Arrow color: hot source (red) → cold sink (blue) gradient
 *   - Arrow size proportional to |Q|
 *   - When temp diff is negligible (< 0.05°C), show a thin neutral line
 */
function HeatFlowLines({
  links,
  cellPositions,
}: {
  links: ThermalLink[];
  cellPositions: Map<string, [number, number, number]>;
}) {
  const groupRef = useRef<THREE.Group>(null!);

  // Animate arrow markers sliding along links each frame
  useFrame(() => {
    if (!groupRef.current) return;
    const t = Date.now() * 0.001;

    groupRef.current.children.forEach((linkGroup) => {
      // Each linkGroup: [tube, arrowCone1, arrowCone2?, shimmer]
      const ud = (linkGroup as any).__heatData;
      if (!ud) return;

      // Pulse opacity based on magnitude
      const basePulse = 0.3 + Math.sin(t * 2 + ud.idx) * 0.1;
      const tubeMesh = linkGroup.children[0] as THREE.Mesh;
      if (tubeMesh?.material) {
        (tubeMesh.material as THREE.MeshBasicMaterial).opacity =
          basePulse * ud.magnitudeNorm;
      }

      // Animate arrow cones sliding along the path (hot→cold direction)
      for (let ci = 1; ci < linkGroup.children.length; ci++) {
        const cone = linkGroup.children[ci] as THREE.Mesh;
        if (!cone || !(cone as any).__isArrow) continue;
        const offset = (ci - 1) * 0.5; // stagger multiple arrows
        const frac = ((t * ud.speed + offset) % 1);
        const pos = ud.start.clone().lerp(ud.end, frac);
        cone.position.copy(pos);
        // Fade near endpoints
        const edgeFade = Math.min(frac, 1 - frac) * 4;
        if (cone.material) {
          (cone.material as THREE.MeshBasicMaterial).opacity =
            Math.min(edgeFade, 1) * 0.85 * ud.magnitudeNorm;
        }
      }
    });
  });

  const linkElements = useMemo(() => {
    return links.map((link, idx) => {
      const pA = cellPositions.get(link.from);
      const pB = cellPositions.get(link.to);
      if (!pA || !pB) return null;

      const absQ = Math.abs(link.heat_flow_w);
      const absDiff = Math.abs(link.temp_diff_c);

      // Determine direction: heat flows from hot surface to cold surface
      // Positive heat_flow_w means from→to (from is hotter)
      const hotTowardB = link.heat_flow_w >= 0;
      const startPos = new THREE.Vector3(...(hotTowardB ? pA : pB));
      const endPos = new THREE.Vector3(...(hotTowardB ? pB : pA));

      // Lift above cells, arc through midpoint
      startPos.y += 0.55;
      endPos.y += 0.55;
      const mid = startPos.clone().lerp(endPos, 0.5);
      mid.y += 0.18;

      // Magnitude normalization (0→1 over 0→2W typical range)
      const magnitudeNorm = Math.min(absQ / 2.0, 1.0);
      const isSignificant = absDiff > 0.05;

      // Color: hot side (red) blending toward cool side (blue)
      // Stronger heat flow → more saturated red
      const hue = isSignificant
        ? 0.0 + (1 - magnitudeNorm) * 0.15  // red to orange-red
        : 0.55; // neutral blue-grey when no significant flow
      const sat = isSignificant ? 0.7 + magnitudeNorm * 0.3 : 0.2;
      const lum = 0.5;
      const tubeColor = new THREE.Color().setHSL(hue, sat, lum);

      // Tube radius proportional to heat flow
      const radius = isSignificant
        ? 0.012 + magnitudeNorm * 0.035
        : 0.008;

      const curve = new THREE.QuadraticBezierCurve3(startPos, mid, endPos);
      const tubeGeo = new THREE.TubeGeometry(curve, 12, radius, 6, false);

      // Arrow cone direction (oriented along hot→cold)
      const dir = endPos.clone().sub(startPos).normalize();
      const quat = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        dir,
      );

      // Arrow color: starts red (hot source), fades to blue (cold sink)
      const arrowColor = new THREE.Color().setHSL(
        isSignificant ? 0.05 : 0.55,
        isSignificant ? 0.9 : 0.2,
        0.55,
      );

      // Animation speed proportional to heat flow magnitude
      const speed = 0.3 + magnitudeNorm * 0.7;

      // Number of animated arrows: 1 for small flow, 2 for large
      const nArrows = magnitudeNorm > 0.5 && isSignificant ? 2 : 1;

      return {
        key: `${link.from}-${link.to}`,
        tubeGeo,
        tubeColor,
        arrowColor,
        quat,
        magnitudeNorm: Math.max(magnitudeNorm, 0.15),
        speed,
        nArrows,
        isSignificant,
        startPos,
        endPos,
        idx,
        couplingType: link.coupling_type,
      };
    }).filter(Boolean) as any[];
  }, [links, cellPositions]);

  return (
    <group ref={groupRef}>
      {linkElements.map((el) => {
        const g = (
          <group
            key={el.key}
            ref={(ref: any) => {
              if (ref) {
                (ref as any).__heatData = {
                  idx: el.idx,
                  magnitudeNorm: el.magnitudeNorm,
                  speed: el.speed,
                  start: el.startPos,
                  end: el.endPos,
                };
              }
            }}
          >
            {/* Thermal coupling tube */}
            <mesh geometry={el.tubeGeo}>
              <meshBasicMaterial
                color={el.tubeColor}
                transparent
                opacity={0.35}
              />
            </mesh>

            {/* Animated directional arrow cone(s) — only for significant flow */}
            {el.isSignificant && Array.from({ length: el.nArrows }).map((_, ci) => (
              <mesh
                key={ci}
                geometry={_heatArrowConeGeo}
                quaternion={el.quat}
                ref={(ref: any) => {
                  if (ref) (ref as any).__isArrow = true;
                }}
              >
                <meshBasicMaterial
                  color={el.arrowColor}
                  transparent
                  opacity={0.8}
                />
              </mesh>
            ))}
          </group>
        );
        return g;
      })}
    </group>
  );
}

/* Shared arrow resources — created once, reused forever */
const _arrowConeGeo = new THREE.ConeGeometry(0.06, 0.15, 6);
const _arrowMatDischarge = new THREE.MeshBasicMaterial({ color: '#ff6644', transparent: true, opacity: 0.7 });
const _arrowMatCharge = new THREE.MeshBasicMaterial({ color: '#44aaff', transparent: true, opacity: 0.7 });

/**
 * Animated arrows along series strings showing ELECTRICAL current flow.
 *
 * Physics:
 *   - Discharge (I > 0): conventional current flows + to − through the external
 *     circuit, i.e. from the first cell in the string toward the last.
 *   - Charge (I < 0): current direction reverses.
 *   - Arrow speed proportional to |I|.
 *
 * Rendered below cells (y − 0.35) to separate them from heat flow arrows (above).
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

        const current = cells[idxA].current;
        // Discharge (I > 0): flow from A→B
        // Charge (I < 0): flow from B→A
        const forward = current >= 0;
        result.push({
          start: new THREE.Vector3(...(forward ? posA : posB)),
          end: new THREE.Vector3(...(forward ? posB : posA)),
          current,
        });
      }
    }
    return result;
  }, [cells, cellPositions, nSeries, nParallel]);

  // Imperatively move meshes each frame — zero React re-renders
  useFrame(() => {
    if (!groupRef.current) return;
    const absI = arrows.length > 0 ? Math.abs(arrows[0].current) : 0;
    const speed = 0.3 + Math.min(absI / 30, 1) * 0.7; // faster with more current
    const frac = ((Date.now() * 0.001 * speed) % 1); // 0..1 repeating
    const children = groupRef.current.children as THREE.Mesh[];
    for (let i = 0; i < children.length && i < arrows.length; i++) {
      const a = arrows[i];
      const mesh = children[i];
      const pos = a.start.clone().lerp(a.end, frac);
      pos.y -= 0.35; // below cells
      mesh.position.copy(pos);
    }
  });

  if (arrows.length === 0) return null;

  return (
    <group ref={groupRef}>
      {arrows.map((a, i) => {
        // Orient cone along the (already direction-corrected) start→end
        const dir = a.end.clone().sub(a.start).normalize();
        const quat = new THREE.Quaternion().setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          dir,
        );
        return (
          <mesh
            key={i}
            geometry={_arrowConeGeo}
            material={a.current >= 0 ? _arrowMatDischarge : _arrowMatCharge}
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
  const lastGoodPackRef = useRef<PackData | null>(null);
  const setFocusedCellId = useBatteryStore((s) => s.setFocusedCellId);

  // Real-time WS pack data from the store (updated every sim step)
  const wsCellStates = useBatteryStore((s) => s.packCellStates);
  const wsThermalLinks = useBatteryStore((s) => s.packThermalLinks);
  const packSeries = useBatteryStore((s) => s.packSeries);
  const packParallel = useBatteryStore((s) => s.packParallel);
  const packCellCount = useBatteryStore((s) => s.packCells);

  /* ---- REST Polling (fallback — only when WS data is not flowing) ---- */
  const fetchPack = useCallback(async () => {
    try {
      const resp = await fetch(`${API_BASE}/pack/status`);
      if (!resp.ok) return;
      const json = await resp.json();
      if (json.status === 'ok') {
        setPackData(json as PackData);
      } else if (json.status === 'no_pack') {
        const { clearPack } = useBatteryStore.getState();
        clearPack();
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    // Initial fetch to get data immediately
    fetchPack();
    // Slower polling as fallback (WS provides real-time data)
    const id = setInterval(fetchPack, 5000);
    return () => clearInterval(id);
  }, [fetchPack]);

  // Merge WS data into packData when available (WS takes priority)
  const effectivePackData: PackData | null = useMemo(() => {
    if (wsCellStates && wsCellStates.length > 0) {
      return {
        cells: wsCellStates as CellInfo[],
        n_cells: wsCellStates.length,
        thermal_links: (wsThermalLinks ?? packData?.thermal_links ?? []) as ThermalLink[],
        n_series: packSeries,
        n_parallel: packParallel,
      };
    }
    return packData;
  }, [wsCellStates, wsThermalLinks, packSeries, packParallel, packData]);

  /* ---- Grid layout: cols = n_series, rows = n_parallel ---- */
  const layout = useMemo(() => {
    if (!effectivePackData) return { cols: 0, rows: 0 };
    const cols = effectivePackData.n_series ?? Math.ceil(Math.sqrt(effectivePackData.n_cells));
    const rows = effectivePackData.n_parallel ?? Math.ceil(effectivePackData.n_cells / cols);
    return { cols, rows };
  }, [effectivePackData]);

  /* ---- Cell positions map ---- */
  const cellPositions = useMemo(() => {
    const map = new Map<string, [number, number, number]>();
    if (!effectivePackData) return map;
    const halfW = ((layout.cols - 1) * SPACING_X) / 2;
    const halfZ = ((layout.rows - 1) * SPACING_Z) / 2;
    effectivePackData.cells.forEach((cell, idx) => {
      const col = idx % layout.cols;
      const row = Math.floor(idx / layout.cols);
      const x = col * SPACING_X - halfW;
      const z = row * SPACING_Z - halfZ;
      map.set(cell.cell_id, [x, 0, z]);
    });
    return map;
  }, [effectivePackData, layout]);

  // Keep a reference to the last valid pack data so cells don't vanish
  // during brief WS gaps or data transitions.
  const renderData = useMemo(() => {
    if (effectivePackData && effectivePackData.cells.length > 0) {
      lastGoodPackRef.current = effectivePackData;
      return effectivePackData;
    }
    return lastGoodPackRef.current;
  }, [effectivePackData]);

  if (!renderData || renderData.cells.length === 0) return null;

  const halfW = ((layout.cols - 1) * SPACING_X) / 2;
  const halfZ = ((layout.rows - 1) * SPACING_Z) / 2;

  return (
    <group ref={groupRef} position={[0, 0.5, 0]}>
      {/* ── Individual cells ──────────────────────────────────── */}
      {renderData.cells.slice(0, MAX_PACK_CELLS).map((cell, idx) => {
        const col = idx % layout.cols;
        const row = Math.floor(idx / layout.cols);
        const x = col * SPACING_X - halfW;
        const z = row * SPACING_Z - halfZ;

        const cellState: CellStateOverride = {
          soc: safe(cell.soc, 0.5),
          tempC: safe(cell.temp_c, 25),
          tempSurfaceC: safe(cell.temp_surface_c ?? cell.temp_c, 25),
          soh: safe(cell.soh_pct, 100),
          seiLoss: safe(cell.sei_loss_pct, 0),
          platingLoss: safe(cell.plating_loss_pct ?? 0, 0),
          current: safe(cell.current, 0),
          isEdge: cell.is_edge_cell ?? false,
          heatW: safe(cell.heat_w ?? 0, 0),
          resistanceFactor: safe(cell.resistance_factor ?? 1.0, 1.0),
          cycleLoss: safe(cell.cycle_loss_pct ?? 0, 0),
          heatGenW: safe(cell.heat_w ?? 0, 0),
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
            {renderData.cells.length <= 24 && (
              <CellLabel position={[x, 0.75, z]} label={cell.cell_id.replace('CELL_', 'C')} />
            )}
          </group>
        );
      })}

      {/* ── Inter-cell thermal links (skip for large packs) ──── */}
      {renderData.thermal_links && renderData.thermal_links.length > 0 && renderData.n_cells <= 32 && (
        <HeatFlowLines links={renderData.thermal_links} cellPositions={cellPositions} />
      )}

      {/* ── Current flow arrows (skip for large packs) ─────── */}
      {renderData.n_cells <= 32 && (
        <CurrentFlowArrows
          cells={renderData.cells}
          cellPositions={cellPositions}
          nSeries={renderData.n_series ?? 1}
          nParallel={renderData.n_parallel ?? 1}
        />
      )}
    </group>
  );
}
