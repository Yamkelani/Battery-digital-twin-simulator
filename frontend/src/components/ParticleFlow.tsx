/**
 * Ion Flow Particle System
 *
 * Animated particle system visualizing lithium-ion transport
 * between anode and cathode during charge/discharge.
 *
 * - Discharge: ions flow from anode (left) → cathode (right)
 * - Charge: ions flow from cathode (right) → anode (left)
 * - Speed proportional to current magnitude
 * - Color indicates concentration state
 */

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { useBatteryStore } from '../hooks/useBatteryState';

const NUM_PARTICLES = 200;
const SCALE = 20;

export default function ParticleFlow() {
  const pointsRef = useRef<THREE.Points>(null);
  const batteryState = useBatteryStore((s) => s.batteryState);

  const current = batteryState?.current ?? 0;
  const resistanceFactor = batteryState?.deg_resistance_factor ?? 1.0;
  const diffusionLimit = batteryState?.echem_diffusion_limitation ?? 0;
  const cellW = 0.091 * SCALE;
  const cellH = 0.148 * SCALE;
  const cellD = 0.027 * SCALE;

  // Create particle positions & velocities
  const { positions, velocities, colors } = useMemo(() => {
    const pos = new Float32Array(NUM_PARTICLES * 3);
    const vel = new Float32Array(NUM_PARTICLES * 3);
    const col = new Float32Array(NUM_PARTICLES * 3);

    for (let i = 0; i < NUM_PARTICLES; i++) {
      const i3 = i * 3;
      // Random position within the cell volume
      pos[i3] = (Math.random() - 0.5) * cellW * 0.8;
      pos[i3 + 1] = (Math.random() - 0.5) * cellH * 0.7;
      pos[i3 + 2] = (Math.random() - 0.5) * cellD * 2;

      // Random velocity
      vel[i3] = (Math.random() - 0.5) * 0.1;
      vel[i3 + 1] = (Math.random() - 0.5) * 0.05;
      vel[i3 + 2] = (Math.random() - 0.5) * 0.2;

      // Default color (cyan for lithium ions)
      col[i3] = 0.1;
      col[i3 + 1] = 0.8;
      col[i3 + 2] = 1.0;
    }

    return { positions: pos, velocities: vel, colors: col };
  }, [cellW, cellH, cellD]);

  // Particle material - larger, brighter particles
  const material = useMemo(
    () =>
      new THREE.PointsMaterial({
        size: 0.1,
        vertexColors: true,
        transparent: true,
        opacity: 0.8,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        sizeAttenuation: true,
      }),
    [],
  );

  // Animate particles
  useFrame((_, delta) => {
    if (!pointsRef.current) return;

    const posAttr = pointsRef.current.geometry.attributes.position as THREE.BufferAttribute;
    const colAttr = pointsRef.current.geometry.attributes.color as THREE.BufferAttribute;
    const posArray = posAttr.array as Float32Array;
    const colArray = colAttr.array as Float32Array;

    // Speed decreases as internal resistance grows (ions face more impedance)
    // Diffusion limitation further slows transport
    const resistSlowdown = 1.0 / Math.max(resistanceFactor, 1.0);
    const diffusionSlowdown = Math.max(1.0 - diffusionLimit * 0.5, 0.3);
    const speed = Math.max(Math.abs(current) / 50, 0.15) * resistSlowdown * diffusionSlowdown;
    const direction = current > 0 ? 1 : current < 0 ? -1 : 0;
    const t = Date.now() * 0.001;

    for (let i = 0; i < NUM_PARTICLES; i++) {
      const i3 = i * 3;

      if (Math.abs(current) < 0.1) {
        // Brownian motion when idle — still visible
        posArray[i3] += (Math.random() - 0.5) * 0.02;
        posArray[i3 + 1] += (Math.random() - 0.5) * 0.02;
        posArray[i3 + 2] += (Math.random() - 0.5) * 0.02;
      } else {
        // Directed flow with swirl
        const swirl = Math.sin(t * 2 + i * 0.1) * 0.3;
        posArray[i3] += (velocities[i3] * delta * speed + swirl * delta);
        posArray[i3 + 1] += velocities[i3 + 1] * delta * speed;
        posArray[i3 + 2] += direction * speed * delta * 3 + velocities[i3 + 2] * delta * speed * 0.3;
      }

      // Wrap around for continuous flow
      const halfW = cellW * 0.4;
      const halfH = cellH * 0.35;
      const halfD = cellD * 1.2;

      if (posArray[i3] > halfW) posArray[i3] = -halfW;
      if (posArray[i3] < -halfW) posArray[i3] = halfW;
      if (posArray[i3 + 1] > halfH) posArray[i3 + 1] = -halfH;
      if (posArray[i3 + 1] < -halfH) posArray[i3 + 1] = halfH;
      if (posArray[i3 + 2] > halfD) posArray[i3 + 2] = -halfD;
      if (posArray[i3 + 2] < -halfD) posArray[i3 + 2] = halfD;

      // Color based on position (anode side = green, cathode side = purple)
      // Dimmed by resistance growth — aged cells have less vivid ion flow
      const frac = (posArray[i3 + 2] + halfD) / (2 * halfD); // 0→1 from anode to cathode
      const ageDim = resistSlowdown; // 1.0 when fresh, decreasing with age
      colArray[i3] = (0.1 + frac * 0.5) * ageDim;       // R
      colArray[i3 + 1] = (0.9 - frac * 0.5) * ageDim;   // G
      colArray[i3 + 2] = (0.4 + frac * 0.6) * ageDim;   // B
    }

    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;

    // Fade particles based on current magnitude
    material.opacity = Math.min(0.2 + speed * 0.8, 0.9);
  });

  const geometry = useMemo(() => {
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    return geom;
  }, [positions, colors]);

  return <points ref={pointsRef} geometry={geometry} material={material} />;
}
