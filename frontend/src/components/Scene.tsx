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
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import BatteryCell3D, { type CellStateOverride } from './BatteryCell3D';
import ParticleFlow from './ParticleFlow';
import HeatMap from './HeatMap';
import PackView3D from './PackView3D';
import { useBatteryStore } from '../hooks/useBatteryState';

const API_BASE = 'http://localhost:8001/api';

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
        setCellState({
          soc: cell.soc,
          tempC: cell.temp_c,
          soh: cell.soh_pct,
          seiLoss: cell.sei_loss_pct ?? 0,
          current: cell.current ?? 0,
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
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 8, 5]} intensity={0.8} />
      <directionalLight position={[-3, 4, -5]} intensity={0.3} color="#6699ff" />
      <pointLight position={[0, -2, 3]} intensity={0.3} color="#ff9933" />

      {/* ── Battery Cell(s) ──────────────────────────────────────── */}
      {packConfigured ? (
        <>
          {/* Keep PackView3D always mounted so it retains data;
              toggle visibility when a cell is focused */}
          <group visible={!focusedCellId}>
            <PackView3D />
          </group>
          {/* Zoomed-in single cell from the pack */}
          {focusedCellId && <FocusedCellView cellId={focusedCellId} />}
        </>
      ) : (
        /* Single-cell mode (no pack configured) */
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
        width: '100%', height: '100%', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', background: '#0a0f1e', color: '#e2e8f0',
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
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      {/* Back button overlay when viewing a single cell from the pack */}
      {focusedCellId && (
        <button
          onClick={clearFocusedCell}
          style={{
            position: 'absolute',
            top: 12,
            left: 12,
            zIndex: 20,
            background: 'rgba(30,41,59,0.85)',
            color: '#e2e8f0',
            border: '1px solid #475569',
            borderRadius: 6,
            padding: '6px 14px',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            backdropFilter: 'blur(8px)',
          }}
        >
          ← Back to Pack
          <span style={{ opacity: 0.7, fontWeight: 400 }}>({focusedCellId})</span>
        </button>
      )}

      {/* Cutaway / X-ray toggle button */}
      {(!packConfigured || focusedCellId) && (
        <button
          onClick={toggleCutaway}
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            zIndex: 20,
            background: cutawayMode ? 'rgba(59,130,246,0.85)' : 'rgba(30,41,59,0.85)',
            color: '#e2e8f0',
            border: cutawayMode ? '1px solid #60a5fa' : '1px solid #475569',
            borderRadius: 6,
            padding: '6px 14px',
            cursor: 'pointer',
            fontSize: 13,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            backdropFilter: 'blur(8px)',
          }}
        >
          {cutawayMode ? '🔬' : '🔍'} {cutawayMode ? 'Solid View' : 'X-Ray Mode'}
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
        style={{ background: '#0a0f1e' }}
        onCreated={({ gl }: any) => {
          gl.setClearColor('#0a0f1e');
          gl.localClippingEnabled = true;
          // Listen for WebGL context loss
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
