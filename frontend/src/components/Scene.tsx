/**
 * Main 3D Scene
 *
 * Composes the Three.js scene with:
 *   - Battery cell 3D model (single or pack grid)
 *   - Focused cell detail view (click a pack cell to zoom in)
 *   - Ion flow particles
 *   - Temperature heat map
 *   - Orbit controls for camera manipulation
 *   - Lighting setup
 *   - Simple grid floor
 */

import { Suspense, useRef, useMemo, useEffect, useState, useCallback } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Environment } from '@react-three/drei';
import * as THREE from 'three';
import BatteryCell3D, { type CellStateOverride } from './BatteryCell3D';
import ParticleFlow from './ParticleFlow';
import HeatMap from './HeatMap';
import PackView3D from './PackView3D';
import { useBatteryStore } from '../hooks/useBatteryState';
import { API_BASE } from '../config';

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

/**
 * FocusedCellView — renders a single full-size cell from the pack,
 * fed by the per-cell data from the pack status API.
 */
function FocusedCellView({ cellId }: { cellId: string }) {
  const [cellState, setCellState] = useState<CellStateOverride | null>(null);

  const fetchCellState = useCallback(async () => {
    try {
      const resp = await fetch(`${API_BASE}/pack/status`);
      if (!resp.ok) return;
      const json = await resp.json();
      if (json.status !== 'ok') return;
      const cell = json.cells?.find((c: any) => c.cell_id === cellId);
      if (cell) {
        const _s = (v: any, fb: number) => (v != null && Number.isFinite(v) ? v : fb);
        setCellState({
          soc: _s(cell.soc, 0.5),
          tempC: _s(cell.temp_c, 25),
          tempSurfaceC: _s(cell.temp_surface_c, 25),
          soh: _s(cell.soh_pct, 100),
          seiLoss: _s(cell.sei_loss_pct, 0),
          platingLoss: _s(cell.plating_loss_pct, 0),
          current: _s(cell.current, 0),
          resistanceFactor: _s(cell.resistance_factor, 1.0),
          cycleLoss: _s(cell.cycle_loss_pct, 0),
          heatGenW: _s(cell.heat_w, 0),
        });
      }
    } catch {
      /* ignore */
    }
  }, [cellId]);

  useEffect(() => {
    fetchCellState();
    const id = setInterval(fetchCellState, 1500);
    return () => clearInterval(id);
  }, [fetchCellState]);

  return (
    <>
      <BatteryCell3D position={[0, 0.5, 0]} cellState={cellState ?? undefined} />
      <ParticleFlow />
      <HeatMap />
    </>
  );
}

function SceneContent() {
  const packConfigured = useBatteryStore((s) => s.packConfigured);
  const focusedCellId = useBatteryStore((s) => s.focusedCellId);

  return (
    <>
      {/* ── Lighting ─────────────────────────────────────────────── */}
      <ambientLight intensity={0.4} />
      <directionalLight position={[5, 8, 5]} intensity={0.9} castShadow />
      <directionalLight position={[-3, 4, -5]} intensity={0.3} color="#6699ff" />
      <pointLight position={[0, -2, 3]} intensity={0.3} color="#ff9933" />
      {/* Subtle rim light */}
      <pointLight position={[-5, 2, -5]} intensity={0.2} color="#8b5cf6" />

      {/* ── Environment HDRI for reflections ─────────────────────── */}
      <Environment preset="city" background={false} />

      {/* ── Battery Cell(s) ──────────────────────────────────────── */}
      {packConfigured ? (
        <>
          <group visible={!focusedCellId}>
            <PackView3D />
          </group>
          {focusedCellId && <FocusedCellView cellId={focusedCellId} />}
        </>
      ) : (
        <>
          <BatteryCell3D position={[0, 0.5, 0]} />
          <ParticleFlow />
          <HeatMap />
        </>
      )}

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
        maxDistance={packConfigured && !focusedCellId ? 30 : 15}
        minPolarAngle={Math.PI * 0.1}
        maxPolarAngle={Math.PI * 0.85}
        target={[0, 0.5, 0]}
      />
    </>
  );
}

export default function Scene() {
  const focusedCellId = useBatteryStore((s) => s.focusedCellId);
  const clearFocusedCell = useBatteryStore((s) => s.clearFocusedCell);
  const packConfigured = useBatteryStore((s) => s.packConfigured);
  const packCells = useBatteryStore((s) => s.packCells);
  const cutawayMode = useBatteryStore((s) => s.cutawayMode);
  const toggleCutaway = useBatteryStore((s) => s.toggleCutaway);
  const [webglError, setWebglError] = useState(false);

  // Lower DPR for larger packs to reduce GPU load
  const dpr: [number, number] = packConfigured && packCells > 16 ? [1, 1] : [1, 2];

  if (webglError) {
    return (
      <div style={{
        position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', background: '#080d1a', color: '#e2e8f0',
        gap: 16, fontFamily: 'system-ui',
      }}>
        <p style={{ fontSize: 18, fontWeight: 600 }}>3D Scene Error</p>
        <p style={{ fontSize: 13, opacity: 0.7 }}>WebGL context was lost. This can happen with large pack configurations.</p>
        <button
          onClick={() => setWebglError(false)}
          style={{
            padding: '8px 20px', background: '#3b82f6', color: '#fff',
            border: 'none', borderRadius: 6, cursor: 'pointer', fontWeight: 600,
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      {/* Back button overlay when viewing a single cell from the pack */}
      {focusedCellId && (
        <button
          onClick={clearFocusedCell}
          className="absolute top-3 left-3 z-20 glass-card px-3 py-1.5 text-xs font-semibold text-white
                     flex items-center gap-1.5 cursor-pointer hover:bg-white/[0.08] transition-colors"
        >
          ← Back to Pack
          <span className="opacity-60 font-normal">({focusedCellId})</span>
        </button>
      )}

      {/* Cutaway / X-ray toggle */}
      {(!packConfigured || focusedCellId) && (
        <button
          onClick={toggleCutaway}
          className={`absolute top-3 right-3 z-20 glass-card px-3 py-1.5 text-xs font-semibold text-white
                     flex items-center gap-1.5 cursor-pointer hover:bg-white/[0.08] transition-colors
                     ${cutawayMode ? 'ring-1 ring-blue-400/50' : ''}`}
        >
          {cutawayMode ? '🔬 Solid View' : '🔍 X-Ray Mode'}
        </button>
      )}

      <Canvas
        camera={{
          position: [4, 3, 5],
          fov: 50,
          near: 0.1,
          far: 100,
        }}
        dpr={dpr}
        gl={{
          antialias: packCells <= 16,
          alpha: false,
          powerPreference: 'high-performance',
          failIfMajorPerformanceCaveat: false,
        }}
        style={{ background: '#080d1a' }}
        onCreated={({ gl }: any) => {
          gl.setClearColor('#080d1a');
          gl.localClippingEnabled = true;
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.2;
          const canvas = gl.domElement;
          canvas.addEventListener('webglcontextlost', (e: Event) => {
            e.preventDefault();
            console.error('[Scene] WebGL context lost');
            setWebglError(true);
          });
        }}
      >
        <Suspense fallback={null}>
          <SceneContent />
        </Suspense>
      </Canvas>
    </div>
  );
}
