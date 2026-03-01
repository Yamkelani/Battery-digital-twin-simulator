/**
 * Main 3D Scene
 *
 * Composes the Three.js scene with:
 *   - Battery cell 3D model
 *   - Ion flow particles
 *   - Temperature heat map
 *   - Orbit controls for camera manipulation
 *   - Lighting setup
 *   - Simple grid floor
 */

import { Suspense, useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import BatteryCell3D from './BatteryCell3D';
import ParticleFlow from './ParticleFlow';
import HeatMap from './HeatMap';

/** Simple grid floor using plain Three.js */
function GridFloor() {
  const gridRef = useRef<THREE.GridHelper>(null);
  return (
    <gridHelper
      ref={gridRef}
      args={[20, 20, '#334155', '#1e293b']}
      position={[0, -1.5, 0]}
    />
  );
}

/** Animated background stars using raw geometry */
function SimpleStars() {
  const pointsRef = useRef<THREE.Points>(null);

  const { geometry, material } = useMemo(() => {
    const count = 500;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 30 + Math.random() * 40;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.random() * Math.PI;
      positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.15,
      color: '#6688cc',
      transparent: true,
      opacity: 0.6,
      sizeAttenuation: true,
    });
    return { geometry: geo, material: mat };
  }, []);

  useFrame((_state: any, delta: number) => {
    if (pointsRef.current) {
      pointsRef.current.rotation.y += delta * 0.02;
    }
  });

  return <points ref={pointsRef} geometry={geometry} material={material} />;
}

function SceneContent() {
  return (
    <>
      {/* ── Lighting ─────────────────────────────────────────────── */}
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 8, 5]} intensity={0.8} />
      <directionalLight position={[-3, 4, -5]} intensity={0.3} color="#6699ff" />
      <pointLight position={[0, -2, 3]} intensity={0.3} color="#ff9933" />

      {/* ── Battery Cell ─────────────────────────────────────────── */}
      <BatteryCell3D position={[0, 0.5, 0]} />

      {/* ── Ion Flow Particles ───────────────────────────────────── */}
      <ParticleFlow />

      {/* ── Heat Map Overlay ─────────────────────────────────────── */}
      <HeatMap />

      {/* ── Ground Grid ──────────────────────────────────────────── */}
      <GridFloor />

      {/* ── Background Stars ─────────────────────────────────────── */}
      <SimpleStars />

      {/* ── Camera Controls ──────────────────────────────────────── */}
      <OrbitControls
        makeDefault
        enablePan
        enableZoom
        enableRotate
        minDistance={2}
        maxDistance={15}
        minPolarAngle={Math.PI * 0.1}
        maxPolarAngle={Math.PI * 0.85}
        target={[0, 0.5, 0]}
      />
    </>
  );
}

export default function Scene() {
  return (
    <Canvas
      camera={{
        position: [4, 3, 5],
        fov: 50,
        near: 0.1,
        far: 100,
      }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: false }}
      style={{ background: '#0a0f1e' }}
      onCreated={({ gl }: any) => {
        gl.setClearColor('#0a0f1e');
      }}
    >
      <Suspense fallback={null}>
        <SceneContent />
      </Suspense>
    </Canvas>
  );
}
