/**
 * API Configuration
 * ==================
 * Centralized backend URL config that works in both
 * browser (Vite dev proxy) and Electron (direct connection) modes.
 */

const BACKEND_PORT = 8001;
const BACKEND_HOST = '127.0.0.1';

/**
 * In Electron production mode, window.location is file:// so we must
 * connect directly to the backend. In Vite dev, the proxy handles it,
 * but we also allow direct connection for simplicity.
 */
export const API_BASE = `http://${BACKEND_HOST}:${BACKEND_PORT}/api`;
export const WS_URL = `ws://${BACKEND_HOST}:${BACKEND_PORT}/ws/simulation`;
