/**
 * Electron Preload Script
 * ========================
 * Exposes a safe bridge between the renderer (React app) and Node.js.
 */

const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  platform: process.platform,
  versions: {
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  },
});
