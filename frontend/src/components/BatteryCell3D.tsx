/**
 * 3D Battery Cell Visualization
 *
 * Renders a prismatic Li-ion battery cell with:
 *   - Dynamic color based on SOC (green→yellow→red)
 *   - Temperature heat map overlay (cool blue→hot red)
 *   - SOH degradation visual (surface wear/opacity)
 *   - Animated internal layers (anode, separator, cathode)
 *   - Terminal posts with current flow indication
 *   - Pulsing/breathing animation to show simulation is active
 */

import { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useBatteryStore } from '../hooks/useBatteryState';
import { socToColor, tempToColor, sohToColor } from '../utils/colors';

/** Clipping plane used by cutaway mode to slice the front half of the shell */
const CUTAWAY_PLANE = new THREE.Plane(new THREE.Vector3(0, 0, -1), 0);

/** Scale factor: real meters → scene units (1m = 20 units for visibility) */
const SCALE = 20;

/** Per-cell state that can be passed in from a pack view */
export interface CellStateOverride {
  soc: number;
  tempC: number;
  tempSurfaceC?: number;
  soh: number;
  seiLoss: number;
  platingLoss: number;
  current: number;
  isEdge?: boolean;
  heatW?: number;
  resistanceFactor?: number;
  cycleLoss?: number;
  heatGenW?: number;
}

interface Props {
  position?: [number, number, number];
  /** Override battery state with per-cell data (used in pack grid) */
  cellState?: CellStateOverride;
  /** When true, disable floating / rocking animation (pack grid mode) */
  staticPose?: boolean;
}

export default function BatteryCell3D({ position = [0, 0, 0], cellState, staticPose = false }: Props) {
  const groupRef = useRef<THREE.Group>(null);
  const shellRef = useRef<THREE.Mesh>(null);
  const anodeRef = useRef<THREE.Mesh>(null);
  const cathodeRef = useRef<THREE.Mesh>(null);
  const separatorRef = useRef<THREE.Mesh>(null);
  const heatGlowRef = useRef<THREE.PointLight>(null);
  const terminalPosRef = useRef<THREE.Mesh>(null);
  const terminalNegRef = useRef<THREE.Mesh>(null);
  const fillRef = useRef<THREE.Mesh>(null);
  const pulseRef = useRef<THREE.Mesh>(null);
  const seiRef = useRef<THREE.Mesh>(null);
  const seiMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const heatmapRef = useRef<THREE.Mesh>(null);
  const heatmapMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const platingRef = useRef<THREE.Mesh>(null);
  const platingMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const humidityRef = useRef<THREE.Mesh>(null);
  const humidityMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const accelRingRef = useRef<THREE.Mesh>(null);
  const accelRingMatRef = useRef<THREE.MeshStandardMaterial>(null);
  const dropletGroupRef = useRef<THREE.Group>(null);

  const batteryState = useBatteryStore((s) => s.batteryState);
  const cutawayMode = useBatteryStore((s) => s.cutawayMode);

  // Thermal heatmap canvas texture
  const heatmapTexture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 128;
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    return tex;
  }, []);

  // Cell dimensions (prismatic)
  const cellW = 0.091 * SCALE; // width
  const cellH = 0.148 * SCALE; // height
  const cellD = 0.027 * SCALE; // depth

  // Derived state — cellState override takes priority over global store
  // Use safe() to guard against NaN/Infinity from simulation edge cases
  const _safe = (v: number | undefined | null, fb: number) =>
    v != null && Number.isFinite(v) ? v : fb;

  const soc = _safe(cellState?.soc ?? batteryState?.soc, 0.5);
  const tempC = _safe(cellState?.tempC ?? batteryState?.thermal_T_core_c, 25);
  const soh = _safe(cellState?.soh ?? batteryState?.deg_soh_pct, 100);
  const seiLoss = _safe(cellState?.seiLoss ?? batteryState?.deg_sei_loss_pct, 0);
  const platingLoss = _safe(cellState?.platingLoss ?? batteryState?.deg_plating_loss_pct, 0);
  const current = _safe(cellState?.current ?? batteryState?.current, 0);
  const resistanceFactor = _safe(cellState?.resistanceFactor ?? batteryState?.deg_resistance_factor, 1.0);
  const cycleLoss = _safe(cellState?.cycleLoss ?? batteryState?.deg_cycle_loss_pct, 0);
  const heatGenW = _safe(cellState?.heatGenW ?? batteryState?.heat_total_w, 0);
  const humidityPct = _safe(batteryState?.thermal_humidity_pct, 50);
  const condensationActive = batteryState?.thermal_condensation_active ?? false;
  const degradationTimeFactor = _safe(batteryState?.degradation_time_factor, 1);
  const isCharging = current < 0;
  const isDischarging = current > 0;

  // ── Visual amplification: non-linear mapping so small degradation values ──
  // ── are still visible. A digital-twin demo must show *what* happens even ──
  // ── if absolute magnitudes are scaled for visibility.                    ──
  const seiVisual = Math.min(Math.pow(Math.max(seiLoss / 3, 0), 0.55), 1.0);
  const platingVisual = Math.min(Math.pow(Math.max(platingLoss / 0.5, 0), 0.5), 1.0);
  const cycleVisual = Math.min(Math.pow(Math.max(cycleLoss / 2, 0), 0.5), 1.0);
  const resistVisual = Math.min((resistanceFactor - 1.0) * 3, 1.0);

  // Colors
  const socColor = useMemo(() => new THREE.Color(socToColor(soc)), [soc]);
  const tempColor = useMemo(() => new THREE.Color(tempToColor(tempC)), [tempC]);
  const sohColor = useMemo(() => new THREE.Color(sohToColor(soh)), [soh]);

  // Shell material — blends SOC color with temperature, darkened by degradation
  const totalDeg = Math.min(seiVisual * 0.5 + platingVisual * 0.3 + cycleVisual * 0.2, 1.0);
  const shellMaterial = useMemo(() => {
    const baseColor = socColor.clone().lerp(tempColor, 0.3);
    baseColor.multiplyScalar(1.0 - totalDeg * 0.3);
    return new THREE.MeshStandardMaterial({
      color: baseColor,
      metalness: Math.max(0.4 - totalDeg * 0.2, 0.1),
      roughness: Math.min(0.3 + totalDeg * 0.4, 0.8),
      transparent: true,
      opacity: cutawayMode ? 0.08 : 0.85,
      side: THREE.DoubleSide,
      clippingPlanes: cutawayMode ? [CUTAWAY_PLANE] : [],
      clipShadows: true,
    });
  }, [socColor, tempColor, cutawayMode, totalDeg]);

  // Internal layer materials
  const anodeMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#1a1a2e',
        metalness: cutawayMode ? 0.3 : 0.6,
        roughness: cutawayMode ? 0.5 : 0.4,
        emissive: cutawayMode
          ? '#221133'
          : isDischarging ? '#440000' : isCharging ? '#000044' : '#000000',
        emissiveIntensity: cutawayMode
          ? 0.6
          : Math.min(Math.abs(current) / 50, 1) * 0.5,
        transparent: cutawayMode,
        opacity: cutawayMode ? 0.92 : 1,
      }),
    [current, isCharging, isDischarging, cutawayMode],
  );

  const cathodeMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#2d1b69',
        metalness: cutawayMode ? 0.3 : 0.6,
        roughness: cutawayMode ? 0.5 : 0.4,
        emissive: cutawayMode
          ? '#331144'
          : isCharging ? '#440000' : isDischarging ? '#000044' : '#000000',
        emissiveIntensity: cutawayMode
          ? 0.6
          : Math.min(Math.abs(current) / 50, 1) * 0.5,
        transparent: cutawayMode,
        opacity: cutawayMode ? 0.92 : 1,
      }),
    [current, isCharging, isDischarging, cutawayMode],
  );

  const separatorMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: cutawayMode ? '#ffffff' : '#e0e0e0',
        transparent: true,
        opacity: cutawayMode ? 0.7 : 0.4,
        roughness: 0.8,
        emissive: cutawayMode ? '#aaaaaa' : '#000000',
        emissiveIntensity: cutawayMode ? 0.3 : 0,
      }),
    [cutawayMode],
  );

  // SOC fill level — adjusted for capacity degradation (SOH)
  // Fill represents actual usable energy: degraded cells hold less charge
  const effectiveCapacity = soh / 100;
  const fillHeight = useMemo(() => cellH * soc * effectiveCapacity * 0.85, [soc, effectiveCapacity, cellH]);

  // Animate — breathing, floating, glow, rotation
  useFrame((_state: any, delta: number) => {
    if (!groupRef.current) return;

    const t = Date.now() * 0.001;

    if (!staticPose) {
      // Gentle floating animation
      groupRef.current.position.y = position[1] + Math.sin(t * 1.2) * 0.08;

      // Gentle rocking (not continuous rotation) so layers stay oriented
      groupRef.current.rotation.y = Math.sin(t * 0.4) * 0.15;
    }

    // Breathing scale based on current activity + subtle swelling from gas generation
    const activity = Math.min(Math.abs(current) / 20, 1);
    const gasSwelling = 1 + seiVisual * 0.015; // subtle internal gas build-up
    const breathe = gasSwelling + Math.sin(t * 3) * 0.01 * (1 + activity * 2);
    groupRef.current.scale.setScalar(breathe);

    // Heat glow intensity — driven by actual heat generation, not just temp
    if (heatGlowRef.current) {
      const heatFromTemp = Math.max(0, (tempC - 25) / 35) * 2;
      const heatFromGen = Math.min(heatGenW / 5, 2); // heat generation power
      const heatIntensity = Math.max(heatFromTemp, heatFromGen);
      heatGlowRef.current.intensity = heatIntensity + Math.sin(t * 4) * 0.2;
      // Color shifts: low heat = orange, high heat = bright red
      const heatRatio = Math.min(heatIntensity / 3, 1);
      heatGlowRef.current.color.setRGB(1, 0.3 * (1 - heatRatio), 0);
    }

    // ── Terminal glow — degraded by resistance growth ──
    // Fresh terminals: bright pulsing glow. Aged: dull, dark, high-resistance.
    const terminalEmissive = Math.min(Math.abs(current) / 50, 1);
    const pulse = 0.5 + Math.sin(t * 6) * 0.5;
    const termFreshness = Math.max(1.0 - resistVisual, 0.15); // clamp so never fully dead
    if (terminalPosRef.current) {
      const mat = terminalPosRef.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = terminalEmissive * pulse * 0.8 * termFreshness;
      mat.metalness = Math.max(0.8 - resistVisual * 0.5, 0.2);
      mat.roughness = Math.min(0.2 + resistVisual * 0.5, 0.7);
      // Color darkens as resistance grows (corrosion/oxidation)
      const rFade = 1 - resistVisual * 0.4;
      mat.color.setRGB(0.8 * rFade, 0.2 * rFade, 0.2 * rFade);
    }
    if (terminalNegRef.current) {
      const mat = terminalNegRef.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = terminalEmissive * pulse * 0.8 * termFreshness;
      mat.metalness = Math.max(0.8 - resistVisual * 0.5, 0.2);
      mat.roughness = Math.min(0.2 + resistVisual * 0.5, 0.7);
      const rFade = 1 - resistVisual * 0.4;
      mat.color.setRGB(0.2 * rFade, 0.2 * rFade, 0.8 * rFade);
    }

    // Pulse overlay (energy ring)
    if (pulseRef.current) {
      const mat = pulseRef.current.material as THREE.MeshStandardMaterial;
      mat.opacity = activity * (0.1 + Math.sin(t * 5) * 0.08);
      pulseRef.current.scale.setScalar(1 + Math.sin(t * 3) * 0.03);
    }

    // SOC fill height animation (smooth) — accounts for capacity degradation
    if (fillRef.current) {
      const targetY = -cellH / 2 + fillHeight / 2 + cellH * 0.05;
      fillRef.current.position.y += (targetY - fillRef.current.position.y) * delta * 3;
      fillRef.current.scale.y = fillHeight > 0.01 ? 1 : 0;
    }

    // ── SEI layer — amplified visual: amber crust that darkens to brown ──
    // Uses seiVisual (non-linear amplification) so even small loss is visible
    // Pulse speed increases when aging is accelerated
    const seiPulseSpeed = degradationTimeFactor > 1.5
      ? 1.2 + Math.min(Math.log10(degradationTimeFactor), 3) * 2
      : 1.2;
    if (seiRef.current && seiMatRef.current) {
      const growFactor = 1 + seiVisual * 0.25; // up to +25% shell expansion
      seiRef.current.scale.set(growFactor, growFactor, growFactor);
      seiMatRef.current.opacity = seiVisual > 0.005
        ? Math.min(0.08 + seiVisual * 0.55, 0.65)
        : 0;
      // Color progression: fresh amber → dark crusty brown as SEI thickens
      const r = 0.82 - seiVisual * 0.45; // 0.82 → 0.37
      const g = 0.60 - seiVisual * 0.37; // 0.60 → 0.23
      const b = 0.12 - seiVisual * 0.05; // 0.12 → 0.07
      seiMatRef.current.color.setRGB(r, g, b);
      seiMatRef.current.emissive.setRGB(r * 0.6, g * 0.5, b * 0.3);
      seiMatRef.current.emissiveIntensity = 0.1 + seiVisual * 0.4
        + (seiVisual > 0.01 ? Math.sin(t * seiPulseSpeed) * 0.05 * seiVisual : 0); // pulse = active growth; faster when accelerated
      // Surface gets rougher/crustier as SEI builds
      seiMatRef.current.roughness = 0.5 + seiVisual * 0.5;
      seiMatRef.current.metalness = Math.max(0.1 - seiVisual * 0.1, 0);
    }

    // ── Lithium plating — amplified visual: silver metallic deposit on anode ──
    if (platingRef.current && platingMatRef.current) {
      if (platingVisual > 0.005) {
        platingRef.current.visible = true;
        // Thickness grows substantially with plating
        const thickness = 0.4 + platingVisual * 2.0;
        platingRef.current.scale.z = thickness;
        platingRef.current.scale.x = 1 + platingVisual * 0.1;
        platingRef.current.scale.y = 1 + platingVisual * 0.05;
        // Colour: bright silver → dull grey as dendrites form
        const grey = 0.85 - platingVisual * 0.35;
        platingMatRef.current.color.setRGB(grey, grey, grey * 1.05);
        platingMatRef.current.opacity = 0.3 + platingVisual * 0.55;
        // Crystalline flash/shimmer at edges
        platingMatRef.current.emissiveIntensity =
          0.15 + platingVisual * 0.45 + Math.sin(t * 8 + platingVisual * 20) * 0.08;
        platingMatRef.current.emissive.setRGB(0.5, 0.55, 0.6);
        platingMatRef.current.metalness = 0.9 - platingVisual * 0.3;
        platingMatRef.current.roughness = 0.1 + platingVisual * 0.4;
      } else {
        platingRef.current.visible = false;
      }
    }

    // ── Thermal heatmap texture — uses cellState temps when available (pack mode) ──
    if (heatmapTexture) {
      const canvas = heatmapTexture.image as HTMLCanvasElement;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        // Use cellState surface temp if available (pack/focused view), else global
        const coreTemp = cellState?.tempC ?? batteryState?.thermal_T_core_c ?? 25;
        const surfTemp = cellState?.tempSurfaceC ?? batteryState?.thermal_T_surface_c ?? 25;
        const ambTemp = 25;
        const range = 40; // normalise 25..65 °C
        const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
        // top = surface, center = core, bottom = surface
        const tSurf = Math.min((surfTemp - ambTemp) / range, 1);
        const tCore = Math.min((coreTemp - ambTemp) / range, 1);
        const surfHex = `hsl(${(1 - tSurf) * 240}, 90%, 50%)`;
        const coreHex = `hsl(${(1 - tCore) * 240}, 90%, 50%)`;
        grad.addColorStop(0, surfHex);
        grad.addColorStop(0.5, coreHex);
        grad.addColorStop(1, surfHex);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        heatmapTexture.needsUpdate = true;
      }
    }

    // ── Humidity Fog Layer — blue-green mist that intensifies with RH ──
    if (humidityRef.current && humidityMatRef.current) {
      const rhNorm = Math.max(humidityPct - 30, 0) / 70; // visible from 30% RH upward
      humidityMatRef.current.opacity = rhNorm * 0.25 + (rhNorm > 0.3 ? Math.sin(t * 0.8) * 0.04 : 0);
      // Color shifts: low humidity = faint cyan, high humidity = deep teal, condensation = blue-white
      if (condensationActive) {
        humidityMatRef.current.color.setRGB(0.6, 0.8, 1.0);
        humidityMatRef.current.emissiveIntensity = 0.15 + Math.sin(t * 2) * 0.05;
        humidityMatRef.current.emissive.setRGB(0.3, 0.5, 0.7);
      } else {
        const r = 0.05 + rhNorm * 0.1;
        const g = 0.35 + rhNorm * 0.15;
        const b = 0.4 + rhNorm * 0.2;
        humidityMatRef.current.color.setRGB(r, g, b);
        humidityMatRef.current.emissiveIntensity = rhNorm * 0.1;
        humidityMatRef.current.emissive.setRGB(r * 0.5, g * 0.5, b * 0.5);
      }
      // Subtle breathing/swirl at high humidity
      const swirl = 1 + (rhNorm > 0.2 ? Math.sin(t * 0.6) * 0.01 * rhNorm : 0);
      humidityRef.current.scale.set(swirl, swirl, swirl);
    }

    // ── Condensation Droplets — small spheres that appear/pulse on cell surface ──
    if (dropletGroupRef.current) {
      const showDroplets = condensationActive || humidityPct > 70;
      dropletGroupRef.current.visible = showDroplets;
      if (showDroplets) {
        // Gentle shimmer
        dropletGroupRef.current.children.forEach((child, i) => {
          const mesh = child as THREE.Mesh;
          const mat = mesh.material as THREE.MeshStandardMaterial;
          const phase = i * 1.37; // golden-ratio offset for organic look
          const shimmer = 0.4 + Math.sin(t * 2.5 + phase) * 0.3;
          mat.opacity = shimmer;
          // Slight scale pulse
          const s = 0.8 + Math.sin(t * 1.8 + phase) * 0.2;
          mesh.scale.setScalar(s);
        });
      }
    }

    // ── Accelerated Aging Ring — fast-forward indicator when time_factor > 1 ──
    if (accelRingRef.current && accelRingMatRef.current) {
      const isAccelerated = degradationTimeFactor > 1.5;
      accelRingRef.current.visible = isAccelerated;
      if (isAccelerated) {
        const accelNorm = Math.min(Math.log10(degradationTimeFactor) / 3, 1); // 0..1 for 1x..1000x
        // Fast spinning ring — rotation speed proportional to acceleration factor
        accelRingRef.current.rotation.z += delta * (2 + accelNorm * 8);
        // Pulsing opacity
        accelRingMatRef.current.opacity = 0.15 + accelNorm * 0.3 + Math.sin(t * (3 + accelNorm * 6)) * 0.1;
        // Color: blue (mild accel) → magenta (extreme accel)
        const ar = 0.3 + accelNorm * 0.6;
        const ag = 0.2 * (1 - accelNorm);
        const ab = 0.8;
        accelRingMatRef.current.color.setRGB(ar, ag, ab);
        accelRingMatRef.current.emissive.setRGB(ar * 0.7, ag * 0.5, ab * 0.7);
        accelRingMatRef.current.emissiveIntensity = 0.3 + accelNorm * 0.5;
      }
    }
  });

  // Stable droplet positions (generated once)
  const dropletPositions = useMemo(() => {
    const positions: [number, number, number][] = [];
    // Seed deterministic positions on cell surfaces
    const rng = (seed: number) => {
      let s = seed;
      return () => { s = (s * 16807 + 0) % 2147483647; return s / 2147483647; };
    };
    const rand = rng(42);
    for (let i = 0; i < 12; i++) {
      const face = Math.floor(rand() * 4); // top, front, back, sides
      let x: number, y: number, z: number;
      if (face === 0) { // top
        x = (rand() - 0.5) * cellW * 0.9;
        y = cellH / 2 + 0.02;
        z = (rand() - 0.5) * cellD * 0.9;
      } else if (face === 1) { // front
        x = (rand() - 0.5) * cellW * 0.9;
        y = (rand() - 0.5) * cellH * 0.8;
        z = cellD / 2 + 0.02;
      } else if (face === 2) { // back
        x = (rand() - 0.5) * cellW * 0.9;
        y = (rand() - 0.5) * cellH * 0.8;
        z = -(cellD / 2 + 0.02);
      } else { // side
        x = (rand() > 0.5 ? 1 : -1) * (cellW / 2 + 0.02);
        y = (rand() - 0.5) * cellH * 0.8;
        z = (rand() - 0.5) * cellD * 0.9;
      }
      positions.push([x, y, z]);
    }
    return positions;
  }, [cellW, cellH, cellD]);

  const layerThickness = cellD * 0.15;
  const layerGap = cellD * 0.02;

  return (
    <group ref={groupRef} position={position}>
      {/* ── Battery Shell (Prismatic Casing) ────────────────────────── */}
      <mesh ref={shellRef} material={shellMaterial}>
        <boxGeometry args={[cellW, cellH, cellD]} />
      </mesh>

      {/* ── Wire-frame outline for visibility ──────────────────────── */}
      <lineSegments>
        <edgesGeometry args={[new THREE.BoxGeometry(cellW, cellH, cellD)]} />
        <lineBasicMaterial color="#64748b" transparent opacity={0.4} />
      </lineSegments>

      {/* ── SOC Fill Indicator (internal glow) ──────────────────────── */}
      <mesh ref={fillRef} position={[0, -cellH / 2 + fillHeight / 2 + cellH * 0.05, 0]}>
        <boxGeometry args={[cellW * 0.9, Math.max(fillHeight, 0.01), cellD * 0.9]} />
        <meshStandardMaterial
          color={socColor}
          transparent
          opacity={0.3}
          emissive={socColor}
          emissiveIntensity={0.4}
        />
      </mesh>

      {/* ── Internal Electrode Layers ──────────────────────────────── */}
      {/* Anode (Graphite - dark) */}
      <mesh
        ref={anodeRef}
        position={[0, 0, -(layerThickness + layerGap)]}
        material={anodeMaterial}
      >
        <boxGeometry args={[cellW * 0.85, cellH * 0.85, layerThickness]} />
      </mesh>

      {/* Separator (white, translucent) */}
      <mesh ref={separatorRef} position={[0, 0, 0]} material={separatorMaterial}>
        <boxGeometry args={[cellW * 0.87, cellH * 0.87, layerThickness * 0.3]} />
      </mesh>

      {/* Cathode (NMC - purple) */}
      <mesh
        ref={cathodeRef}
        position={[0, 0, layerThickness + layerGap]}
        material={cathodeMaterial}
      >
        <boxGeometry args={[cellW * 0.85, cellH * 0.85, layerThickness]} />
      </mesh>

      {/* ── Terminal Posts ─────────────────────────────────────────── */}
      {/* Positive terminal */}
      <mesh
        ref={terminalPosRef}
        position={[cellW * 0.25, cellH / 2 + 0.15, 0]}
      >
        <cylinderGeometry args={[0.08, 0.08, 0.3, 16]} />
        <meshStandardMaterial
          color="#cc3333"
          metalness={0.8}
          roughness={0.2}
          emissive="#ff0000"
          emissiveIntensity={0}
        />
      </mesh>

      {/* Negative terminal */}
      <mesh
        ref={terminalNegRef}
        position={[-cellW * 0.25, cellH / 2 + 0.15, 0]}
      >
        <cylinderGeometry args={[0.08, 0.08, 0.3, 16]} />
        <meshStandardMaterial
          color="#3333cc"
          metalness={0.8}
          roughness={0.2}
          emissive="#0000ff"
          emissiveIntensity={0}
        />
      </mesh>

      {/* ── Energy Pulse Ring (shows activity) ────────────────────── */}
      <mesh ref={pulseRef} position={[0, 0, cellD / 2 + 0.02]}>
        <ringGeometry args={[cellW * 0.35, cellW * 0.38, 32]} />
        <meshStandardMaterial
          color={isCharging ? '#3b82f6' : isDischarging ? '#ef4444' : '#64748b'}
          transparent
          opacity={0}
          emissive={isCharging ? '#3b82f6' : isDischarging ? '#ef4444' : '#334155'}
          emissiveIntensity={0.8}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* ── Heat Glow (point light at core) ───────────────────────── */}
      <pointLight
        ref={heatGlowRef}
        position={[0, 0, 0]}
        color="#ff4400"
        intensity={0}
        distance={5}
        decay={2}
      />

      {/* ── SEI Accumulation Layer (wraps entire cell, grows thicker) ── */}
      <mesh ref={seiRef}>
        <boxGeometry args={[cellW * 1.03, cellH * 1.03, cellD * 1.03]} />
        <meshStandardMaterial
          ref={seiMatRef as any}
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

      {/* ── Lithium Plating (silver/grey slab on anode face) ── */}
      <mesh
        ref={platingRef}
        position={[0, 0, -(cellD * 0.55)]}
        visible={false}
      >
        <boxGeometry args={[cellW * 0.84, cellH * 0.80, cellD * 0.15]} />
        <meshStandardMaterial
          ref={platingMatRef as any}
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

      {/* ── SOH Degradation Tint (all-face overlay, becomes more visible) ── */}
      {/* Triggers at 98% SOH using amplified visual so degradation is always visible */}
      {soh < 98 && (
        <mesh>
          <boxGeometry args={[cellW * 1.02, cellH * 1.02, cellD * 1.02]} />
          <meshStandardMaterial
            color={sohColor}
            transparent
            opacity={Math.min((100 - soh) / 60, 0.5)}
            roughness={1}
            side={THREE.FrontSide}
            depthWrite={false}
          />
        </mesh>
      )}

      {/* ── Dead Capacity Indicator (dark region at top of fill) ── */}
      {soh < 99.5 && (
        <mesh position={[0, cellH / 2 - cellH * (1 - effectiveCapacity) * 0.85 / 2 - cellH * 0.02, 0]}>
          <boxGeometry args={[cellW * 0.88, Math.max(cellH * (1 - effectiveCapacity) * 0.85, 0.01), cellD * 0.88]} />
          <meshStandardMaterial
            color="#1a1a1a"
            transparent
            opacity={Math.min((100 - soh) * 0.08, 0.5)}
            roughness={1}
            depthWrite={false}
          />
        </mesh>
      )}

      {/* ── Thermal Heatmap Overlay — opacity driven by heat generation ── */}
      <mesh ref={heatmapRef}>
        <boxGeometry args={[cellW * 1.005, cellH * 1.005, cellD * 1.005]} />
        <meshStandardMaterial
          ref={heatmapMatRef as any}
          map={heatmapTexture}
          transparent
          opacity={Math.min(0.15 + Math.max(0, (tempC - 25) / 30) * 0.45, 0.65)}
          roughness={1}
          side={THREE.FrontSide}
          depthWrite={false}
        />
      </mesh>

      {/* ── Humidity Fog Layer — cyan mist around cell, intensity driven by RH ── */}
      <mesh ref={humidityRef}>
        <boxGeometry args={[cellW * 1.08, cellH * 1.08, cellD * 1.08]} />
        <meshStandardMaterial
          ref={humidityMatRef as any}
          color="#1a8a8a"
          transparent
          opacity={0}
          roughness={1}
          metalness={0}
          emissive="#1a6a7a"
          emissiveIntensity={0}
          side={THREE.FrontSide}
          depthWrite={false}
        />
      </mesh>

      {/* ── Condensation Droplets — small water spheres on cell surface ── */}
      <group ref={dropletGroupRef} visible={false}>
        {dropletPositions.map((pos, i) => (
          <mesh key={i} position={pos}>
            <sphereGeometry args={[0.03 + (i % 3) * 0.01, 8, 8]} />
            <meshStandardMaterial
              color="#80d0ff"
              transparent
              opacity={0.5}
              metalness={0.3}
              roughness={0.1}
              emissive="#40a0cc"
              emissiveIntensity={0.2}
              depthWrite={false}
            />
          </mesh>
        ))}
      </group>

      {/* ── Accelerated Aging Ring — spinning ring indicator for time-compressed aging ── */}
      <mesh ref={accelRingRef} position={[0, -cellH / 2 - 0.15, 0]} rotation={[Math.PI / 2, 0, 0]} visible={false}>
        <torusGeometry args={[cellW * 0.45, 0.03, 8, 32]} />
        <meshStandardMaterial
          ref={accelRingMatRef as any}
          color="#7c3aed"
          transparent
          opacity={0}
          emissive="#7c3aed"
          emissiveIntensity={0.4}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}
