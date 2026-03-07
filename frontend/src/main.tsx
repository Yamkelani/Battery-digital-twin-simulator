import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';

// ─── PWA Service Worker Registration ────────────────────────────────────────
// vite-plugin-pwa handles registration automatically via registerType: 'autoUpdate'

// ─── Capacitor Platform Init ────────────────────────────────────────────────
async function initPlatform() {
  try {
    // Dynamically import Capacitor plugins only in native context
    if ((window as any).Capacitor?.isNativePlatform?.()) {
      const { StatusBar } = await import('@capacitor/status-bar');
      const { SplashScreen } = await import('@capacitor/splash-screen');

      await StatusBar.setBackgroundColor({ color: '#0f172a' });
      await SplashScreen.hide();
      console.log('[Platform] Running in Capacitor native shell');
    }
  } catch (e) {
    // Not in Capacitor — that's fine
  }
}

initPlatform();

// ─── React App Mount ────────────────────────────────────────────────────────
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
