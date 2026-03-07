/**
 * API Configuration
 * ==================
 * Centralized backend URL config that works across ALL platforms:
 *   - Browser (Vite dev proxy)
 *   - Electron desktop (local backend spawned by main process)
 *   - PWA / hosted web app (configurable backend URL)
 *   - Capacitor iOS / Android (remote backend URL)
 *
 * Override via environment variables (set in .env files):
 *   VITE_API_BASE  →  full URL to API, e.g. https://api.example.com/api
 *   VITE_WS_URL    →  full WebSocket URL, e.g. wss://api.example.com/ws/simulation
 */

// ─── Platform detection ─────────────────────────────────────────────────────

/** Running inside Electron? */
export const isElectron = !!(window as any).electronAPI?.isElectron;

/** Running inside a Capacitor native shell (iOS/Android)? */
export const isCapacitor = !!(window as any).Capacitor?.isNativePlatform?.();

/** Running as a regular browser / PWA? */
export const isWeb = !isElectron && !isCapacitor;

// ─── Backend URL resolution ─────────────────────────────────────────────────

const DEFAULT_BACKEND_PORT = 8001;
const DEFAULT_BACKEND_HOST = '127.0.0.1';
const LOCAL_HTTP = `http://${DEFAULT_BACKEND_HOST}:${DEFAULT_BACKEND_PORT}`;
const LOCAL_WS = `ws://${DEFAULT_BACKEND_HOST}:${DEFAULT_BACKEND_PORT}`;

function resolveApiBase(): string {
  // 1. Explicit env override always wins
  if (import.meta.env.VITE_API_BASE) {
    return import.meta.env.VITE_API_BASE;
  }
  // 2. Electron & Capacitor: connect directly to backend
  if (isElectron || isCapacitor) {
    return `${LOCAL_HTTP}/api`;
  }
  // 3. Web — dev mode uses Vite proxy, prod uses same-origin or env var
  if (import.meta.env.DEV) {
    return '/api'; // Vite proxy
  }
  return `${LOCAL_HTTP}/api`;
}

function resolveWsUrl(): string {
  // 1. Explicit env override
  if (import.meta.env.VITE_WS_URL) {
    return import.meta.env.VITE_WS_URL;
  }
  // 2. Electron & Capacitor
  if (isElectron || isCapacitor) {
    return `${LOCAL_WS}/ws/simulation`;
  }
  // 3. Web — dev uses Vite proxy, prod uses direct
  if (import.meta.env.DEV) {
    // Vite proxy rewrites /ws → ws://localhost:8001
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${window.location.host}/ws/simulation`;
  }
  return `${LOCAL_WS}/ws/simulation`;
}

export const API_BASE = resolveApiBase();
export const WS_URL = resolveWsUrl();
