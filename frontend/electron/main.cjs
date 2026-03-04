/**
 * Battery Digital Twin — Electron Main Process
 * ==============================================
 * Spawns the Python FastAPI backend, waits for it to be ready,
 * then opens the React frontend in a BrowserWindow.
 */

const { app, BrowserWindow, dialog, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');

// ─── Configuration ──────────────────────────────────────────────────────────

const BACKEND_PORT = 8001;
const BACKEND_HOST = '127.0.0.1';
const BACKEND_URL = `http://${BACKEND_HOST}:${BACKEND_PORT}`;
const isDev = !app.isPackaged;

let mainWindow = null;
let backendProcess = null;

// ─── Paths ──────────────────────────────────────────────────────────────────

function getBackendPath() {
  if (isDev) {
    return path.join(__dirname, '..', '..', 'backend');
  }
  // In production, backend is bundled alongside the app
  return path.join(process.resourcesPath, 'backend');
}

function getPythonPath() {
  if (isDev) {
    const venvPython = path.join(getBackendPath(), 'venv', 'Scripts', 'python.exe');
    if (fs.existsSync(venvPython)) return venvPython;
    // Fallback for non-Windows
    const venvPythonUnix = path.join(getBackendPath(), 'venv', 'bin', 'python');
    if (fs.existsSync(venvPythonUnix)) return venvPythonUnix;
    return 'python';
  }
  // Production: use bundled Python
  if (process.platform === 'win32') {
    const bundledPython = path.join(process.resourcesPath, 'python', 'python.exe');
    if (fs.existsSync(bundledPython)) return bundledPython;
    // Fall back to venv in resources
    return path.join(process.resourcesPath, 'backend', 'venv', 'Scripts', 'python.exe');
  }
  return path.join(process.resourcesPath, 'python', 'bin', 'python3');
}

// ─── Backend Management ─────────────────────────────────────────────────────

function isBackendRunning() {
  return new Promise((resolve) => {
    const req = http.get(`${BACKEND_URL}/`, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function startBackend() {
  return new Promise(async (resolve, reject) => {
    // First check if backend is already running (e.g. started externally)
    const alreadyRunning = await isBackendRunning();
    if (alreadyRunning) {
      console.log('[Electron] Backend is already running externally, skipping spawn.');
      resolve();
      return;
    }

    const pythonPath = getPythonPath();
    const backendPath = getBackendPath();

    console.log(`[Electron] Starting backend...`);
    console.log(`[Electron]   Python: ${pythonPath}`);
    console.log(`[Electron]   Backend dir: ${backendPath}`);

    backendProcess = spawn(
      pythonPath,
      [
        '-m', 'uvicorn', 'main:app',
        '--host', BACKEND_HOST,
        '--port', String(BACKEND_PORT),
        '--ws', 'wsproto',
        '--ws-ping-interval', '30',
        '--ws-ping-timeout', '30',
      ],
      {
        cwd: backendPath,
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PYTHONDONTWRITEBYTECODE: '1',
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1',
        },
      }
    );

    backendProcess.stdout.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) console.log(`[Backend] ${msg}`);
    });

    backendProcess.stderr.on('data', (data) => {
      const msg = data.toString().trim();
      if (msg) console.log(`[Backend] ${msg}`);
    });

    backendProcess.on('error', (err) => {
      console.error(`[Electron] Failed to start backend: ${err.message}`);
      reject(err);
    });

    backendProcess.on('exit', (code) => {
      console.log(`[Electron] Backend exited with code ${code}`);
      backendProcess = null;
    });

    // Poll until backend is ready
    waitForBackend(30000)
      .then(() => {
        console.log('[Electron] Backend is ready!');
        resolve();
      })
      .catch(reject);
  });
}

function waitForBackend(timeoutMs) {
  const startTime = Date.now();
  return new Promise((resolve, reject) => {
    const check = () => {
      if (Date.now() - startTime > timeoutMs) {
        return reject(new Error('Backend failed to start within timeout'));
      }

      const req = http.get(`${BACKEND_URL}/`, (res) => {
        if (res.statusCode === 200) {
          resolve();
        } else {
          setTimeout(check, 500);
        }
      });

      req.on('error', () => {
        setTimeout(check, 500);
      });

      req.setTimeout(2000, () => {
        req.destroy();
        setTimeout(check, 500);
      });
    };

    setTimeout(check, 1000); // Give it a second before first check
  });
}

function stopBackend() {
  if (backendProcess) {
    console.log('[Electron] Stopping backend...');
    if (process.platform === 'win32') {
      spawn('taskkill', ['/pid', String(backendProcess.pid), '/f', '/t']);
    } else {
      backendProcess.kill('SIGTERM');
    }
    backendProcess = null;
  }
}

// ─── Window Management ──────────────────────────────────────────────────────

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    title: 'Battery Digital Twin — 3D Simulator',
    icon: path.join(__dirname, '..', 'public', 'battery.svg'),
    backgroundColor: '#0f172a',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
    },
  });

  // Graceful show
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Load the app
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ─── App Lifecycle ──────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  try {
    await startBackend();
    createWindow();
  } catch (err) {
    console.error('[Electron] Startup failed:', err);
    dialog.showErrorBox(
      'Startup Error',
      `Failed to start the battery simulation backend.\n\n${err.message}\n\nMake sure Python and dependencies are installed.`
    );
    app.quit();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopBackend();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopBackend();
});

app.on('will-quit', () => {
  stopBackend();
});
