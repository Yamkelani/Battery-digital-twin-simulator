# Cross-Platform Build Guide

Battery Digital Twin runs on **4 platforms** from a single codebase:

| Platform | Technology | Backend |
|----------|-----------|---------|
| 🌐 Web (PWA) | Vite + Service Worker | Hosted server |
| 🖥️ Windows | Electron | Bundled Python (local) |
| 🤖 Android | Capacitor | Remote server |
| 🍎 iOS | Capacitor | Remote server |

---

## Prerequisites

| Tool | Required For | Install |
|------|-------------|---------|
| Node.js 18+ | All | [nodejs.org](https://nodejs.org/) |
| Python 3.10+ | Backend / Windows | [python.org](https://www.python.org/) |
| Android Studio | Android | [developer.android.com](https://developer.android.com/studio) |
| Xcode 15+ | iOS | Mac App Store (macOS only) |

---

## Quick Start (Development)

```bash
# 1. Start the backend
cd backend
python -m venv venv
.\venv\Scripts\activate        # Windows
pip install -r requirements.txt
python -m uvicorn main:app --host 0.0.0.0 --port 8001 --reload

# 2. Start the frontend
cd frontend
npm install --legacy-peer-deps
npm run dev                    # Opens at http://localhost:5173
```

---

## 🌐 Web App (PWA)

The web app is installable from any modern browser (Chrome, Edge, Safari, Firefox).

### Build
```bash
cd frontend
npm run build:web
```

### Deploy
Upload the `frontend/dist/` folder to any static hosting:
- **Vercel**: `npx vercel --prod`
- **Netlify**: drag & drop `dist/` folder
- **GitHub Pages**: push `dist/` to `gh-pages` branch
- **Docker**: see below

### Backend for Web
Deploy the Python backend separately:
```bash
cd backend
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8001
```

Then set `VITE_API_BASE` and `VITE_WS_URL` in `.env.production` to point to your backend URL.

### Docker (Optional)
```dockerfile
# Frontend
FROM node:18-alpine AS build
WORKDIR /app
COPY frontend/ .
RUN npm ci --legacy-peer-deps && npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html

# Backend
FROM python:3.11-slim
WORKDIR /app
COPY backend/ .
RUN pip install -r requirements.txt
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8001"]
```

---

## 🖥️ Windows Desktop (Electron)

Creates a standard Windows installer (.exe) with the Python backend bundled.

### Development
```bash
cd frontend
npm run electron:dev      # Runs Vite + Electron concurrently
```

### Build Installer
```bash
cd frontend
npm run build:win         # Creates release/Battery Digital Twin-Setup-1.0.0.exe
```

Or use the PowerShell script:
```powershell
.\build.ps1 -Target windows
```

The installer:
- Bundles the React frontend + Python backend
- Auto-starts the backend on launch
- Creates Start Menu & Desktop shortcuts
- Supports custom install directory

---

## 🤖 Android

Uses Capacitor to wrap the web app in a native Android shell.

### Setup (One-time)
```bash
cd frontend
npm run cap:add:android   # Already done if android/ folder exists
```

### Build & Run
```bash
cd frontend
npm run build:android     # Build web + sync to Android project

# Open in Android Studio
npm run cap:open:android

# Or run directly on connected device
npm run cap:run:android
```

### Configure Backend URL
Edit `.env.capacitor` (or `.env.production`):
```env
VITE_API_BASE=https://your-server.com/api
VITE_WS_URL=wss://your-server.com/ws/simulation
```

Then rebuild: `npm run build:android`

### Generate APK
In Android Studio: **Build → Generate Signed Bundle / APK**

---

## 🍎 iOS

Uses Capacitor to wrap the web app in a native iOS shell. **Requires macOS with Xcode**.

### Setup (One-time)
```bash
cd frontend
npm run cap:add:ios       # Already done if ios/ folder exists
```

### Build & Run
```bash
cd frontend
npm run build:ios         # Build web + sync to iOS project

# Open in Xcode
npm run cap:open:ios

# Or run on connected device
npm run cap:run:ios
```

### Configure Backend URL
Same as Android — edit `.env.capacitor`:
```env
VITE_API_BASE=https://your-server.com/api
VITE_WS_URL=wss://your-server.com/ws/simulation
```

### App Store Submission
1. Set up an Apple Developer account ($99/year)
2. Configure signing in Xcode
3. Archive and upload via Xcode Organizer

---

## Build All Platforms

```powershell
.\build.ps1 -Target all
```

Or individually:
```powershell
.\build.ps1 -Target web
.\build.ps1 -Target windows
.\build.ps1 -Target android
.\build.ps1 -Target ios
```

---

## Environment Variables

| Variable | Purpose | Example |
|----------|---------|---------|
| `VITE_API_BASE` | Backend REST API URL | `https://api.example.com/api` |
| `VITE_WS_URL` | Backend WebSocket URL | `wss://api.example.com/ws/simulation` |

These are set in `.env` files:
- `.env` — local development (no overrides needed)
- `.env.production` — web deployment
- `.env.capacitor` — mobile builds

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                    React + Three.js                   │
│                   (Single Codebase)                   │
├──────────┬──────────┬──────────┬────────────────────┤
│  Browser │ Electron │ Capacitor│   Capacitor         │
│   (PWA)  │ (Win/Mac)│ (Android)│    (iOS)            │
├──────────┴──────────┴──────────┴────────────────────┤
│           HTTP REST + WebSocket (JSON)                │
├─────────────────────────────────────────────────────┤
│              Python FastAPI Backend                    │
│         (Local for Desktop, Hosted for Mobile)        │
└─────────────────────────────────────────────────────┘
```

---

## Customizing Icons

Regenerate all icons:
```bash
cd frontend
npm run icons:generate
```

To use custom artwork, replace `public/icons/icon-512x512.svg` and re-run the script.

---

## Troubleshooting

| Issue | Solution |
|-------|----------|
| PWA not installable | Serve over HTTPS (required for service workers) |
| Android build fails | Ensure Android SDK 33+ installed in Android Studio |
| iOS build fails | Requires macOS + Xcode 15+ with valid signing |
| WebSocket fails on mobile | Ensure backend URL uses `wss://` (not `ws://`) |
| Electron blank screen | Check backend started (look for port 8001 in Task Manager) |
