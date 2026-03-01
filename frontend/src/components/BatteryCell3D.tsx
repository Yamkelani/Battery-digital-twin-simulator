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

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useBatteryStore } from '../hooks/useBatteryState';
import { socToColor, tempToColor, sohToColor } from '../utils/colors';

/** Scale factor: real meters → scene units (1m = 20 units for visibility) */
const SCALE = 20;

interface Props {
  position?: [number, number, number];
}

export default function BatteryCell3D({ position = [0, 0, 0] }: Props) {
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

  const batteryState = useBatteryStore((s) => s.batteryState);

  // Cell dimensions (prismatic)
  const cellW = 0.091 * SCALE; // width
  const cellH = 0.148 * SCALE; // height
  const cellD = 0.027 * SCALE; // depth

  // Derived state with safe defaults
  const soc = batteryState?.soc ?? 0.5;
  const tempC = batteryState?.thermal_T_core_c ?? 25;
  const soh = batteryState?.deg_soh_pct ?? 100;
  const seiLoss = batteryState?.deg_sei_loss_pct ?? 0;
  const current = batteryState?.current ?? 0;
  const isCharging = current < 0;
  const isDischarging = current > 0;

  // Colors
  const socColor = useMemo(() => new THREE.Color(socToColor(soc)), [soc]);
  const tempColor = useMemo(() => new THREE.Color(tempToColor(tempC)), [tempC]);
  const sohColor = useMemo(() => new THREE.Color(sohToColor(soh)), [soh]);

  // Shell material — blends SOC color with temperature
  const shellMaterial = useMemo(() => {
    const baseColor = socColor.clone().lerp(tempColor, 0.3);
    return new THREE.MeshStandardMaterial({
      color: baseColor,
      metalness: 0.4,
      roughness: 0.3,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    });
  }, [socColor, tempColor]);

  // Internal layer materials
  const anodeMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#1a1a2e',
        metalness: 0.6,
        roughness: 0.4,
        emissive: isDischarging ? '#440000' : isCharging ? '#000044' : '#000000',
        emissiveIntensity: Math.min(Math.abs(current) / 50, 1) * 0.5,
      }),
    [current, isCharging, isDischarging],
  );

  const cathodeMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#2d1b69',
        metalness: 0.6,
        roughness: 0.4,
        emissive: isCharging ? '#440000' : isDischarging ? '#000044' : '#000000',
        emissiveIntensity: Math.min(Math.abs(current) / 50, 1) * 0.5,
      }),
    [current, isCharging, isDischarging],
  );

  const separatorMaterial = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: '#e0e0e0',
        transparent: true,
        opacity: 0.4,
        roughness: 0.8,
      }),
    [],
  );

  // SOC fill level (animated internal indicator)
  const fillHeight = useMemo(() => cellH * soc * 0.85, [soc, cellH]);

  // Animate — breathing, floating, glow, rotation
  useFrame((_state: any, delta: number) => {
    if (!groupRef.current) return;

    const t = Date.now() * 0.001;

    // Gentle floating animation
    groupRef.current.position.y = position[1] + Math.sin(t * 1.2) * 0.08;

    // Gentle rocking (not continuous rotation) so layers stay oriented
    groupRef.current.rotation.y = Math.sin(t * 0.4) * 0.15;

    // Breathing scale based on current activity
    const activity = Math.min(Math.abs(current) / 20, 1);
    const breathe = 1 + Math.sin(t * 3) * 0.01 * (1 + activity * 2);
    groupRef.current.scale.setScalar(breathe);

    // Heat glow intensity based on temperature
    if (heatGlowRef.current) {
      const heatIntensity = Math.max(0, (tempC - 25) / 35) * 2;
      heatGlowRef.current.intensity = heatIntensity + Math.sin(t * 4) * 0.2;
    }

    // Terminal glow pulsing based on current
    const terminalEmissive = Math.min(Math.abs(current) / 50, 1);
    const pulse = 0.5 + Math.sin(t * 6) * 0.5;
    if (terminalPosRef.current) {
      const mat = terminalPosRef.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = terminalEmissive * pulse * 0.8;
    }
    if (terminalNegRef.current) {
      const mat = terminalNegRef.current.material as THREE.MeshStandardMaterial;
      mat.emissiveIntensity = terminalEmissive * pulse * 0.8;
    }

    // Pulse overlay (energy ring)
    if (pulseRef.current) {
      const mat = pulseRef.current.material as THREE.MeshStandardMaterial;
      mat.opacity = activity * (0.1 + Math.sin(t * 5) * 0.08);
      pulseRef.current.scale.setScalar(1 + Math.sin(t * 3) * 0.03);
    }

    // SOC fill height animation (smooth)
    if (fillRef.current) {
      const targetY = -cellH / 2 + fillHeight / 2 + cellH * 0.05;
      fillRef.current.position.y += (targetY - fillRef.current.position.y) * delta * 3;
      fillRef.current.scale.y = fillHeight > 0.01 ? 1 : 0;
    }

    // SEI layer accumulation — grows thicker as sei_loss increases
    if (seiRef.current && seiMatRef.current) {
      // thickness: 0 at 0% loss, up to 8% larger at ~5% loss
      const growFactor = 1 + seiLoss * 0.016;
      seiRef.current.scale.set(growFactor, growFactor, growFactor);
      // opacity: fades in as loss grows (0 → 0.45)
      seiMatRef.current.opacity = Math.min(seiLoss * 0.09, 0.45);
    }
  });

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
        <boxGeometry args={[cellW * 1.01, cellH * 1.01, cellD * 1.01]} />
        <meshStandardMaterial
          ref={seiMatRef as any}
          color="#b8860b"
          transparent
          opacity={0}
          roughness={0.9}
          metalness={0.1}
          side={THREE.FrontSide}
          depthWrite={false}
        />
      </mesh>

      {/* ── SOH Degradation Tint (all-face overlay, becomes more visible) ── */}
      {soh < 95 && (
        <mesh>
          <boxGeometry args={[cellW * 1.02, cellH * 1.02, cellD * 1.02]} />
          <meshStandardMaterial
            color={sohColor}
            transparent
            opacity={Math.min((100 - soh) / 120, 0.5)}
            roughness={1}
            side={THREE.FrontSide}
            depthWrite={false}
          />
        </mesh>
      )}
    </group>
  );
}
