<#
.SYNOPSIS
  Battery Digital Twin — Cross-Platform Build Script

.DESCRIPTION
  Builds the Battery Digital Twin for multiple platforms:
    - Web (PWA)      : Static files ready for hosting
    - Windows         : Electron installer (.exe)
    - Android         : Capacitor → Android Studio project
    - iOS             : Capacitor → Xcode project

.PARAMETER Target
  Build target: web, windows, android, ios, all

.EXAMPLE
  .\build.ps1 -Target web
  .\build.ps1 -Target windows
  .\build.ps1 -Target android
  .\build.ps1 -Target all
#>

param(
    [Parameter(Position = 0)]
    [ValidateSet('web', 'windows', 'android', 'ios', 'all')]
    [string]$Target = 'web'
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Frontend = Join-Path $Root 'frontend'
$Backend = Join-Path $Root 'backend'

function Write-Step($msg) { Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "  ✓ $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  ⚠ $msg" -ForegroundColor Yellow }

# ─── Prerequisites check ────────────────────────────────────────────────────

Write-Step "Checking prerequisites..."

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { throw "Node.js is required. Install from https://nodejs.org/" }
Write-Ok "Node.js $(node --version)"

$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npm) { throw "npm is required." }
Write-Ok "npm $(npm --version)"

# ─── Build Web (PWA) ────────────────────────────────────────────────────────

function Build-Web {
    Write-Step "Building Web (PWA)..."
    Set-Location $Frontend

    Write-Host "  Installing dependencies..."
    npm ci --legacy-peer-deps 2>$null | Out-Null

    Write-Host "  Generating icons..."
    node scripts/generate-icons.cjs
    node scripts/convert-icons-to-png.cjs

    Write-Host "  Building production bundle..."
    npx tsc --noEmit
    npx vite build

    $distPath = Join-Path $Frontend 'dist'
    Write-Ok "Web build complete → $distPath"
    Write-Host "  Deploy the dist/ folder to any static host (Vercel, Netlify, etc.)"
    Write-Host "  The PWA will be installable from the browser on any device."
}

# ─── Build Windows (Electron) ───────────────────────────────────────────────

function Build-Windows {
    Write-Step "Building Windows (Electron)..."
    Set-Location $Frontend

    Write-Host "  Installing dependencies..."
    npm ci --legacy-peer-deps 2>$null | Out-Null

    Write-Host "  Building Electron app..."
    npm run electron:build:win

    $releasePath = Join-Path $Root 'release'
    Write-Ok "Windows build complete → $releasePath"
    Write-Host "  The .exe installer is in the release/ folder."
}

# ─── Build Android (Capacitor) ──────────────────────────────────────────────

function Build-Android {
    Write-Step "Building Android (Capacitor)..."
    Set-Location $Frontend

    Write-Host "  Installing dependencies..."
    npm ci --legacy-peer-deps 2>$null | Out-Null

    Write-Host "  Building web bundle..."
    npx tsc --noEmit
    npx vite build

    Write-Host "  Syncing Capacitor..."
    npx cap sync android

    $androidPath = Join-Path $Frontend 'android'
    Write-Ok "Android project synced → $androidPath"
    Write-Host "  Open in Android Studio: npx cap open android"
    Write-Host "  Or run on device:       npx cap run android"

    $hasAS = Get-Command "studio64" -ErrorAction SilentlyContinue
    if (-not $hasAS) {
        Write-Warn "Android Studio not found in PATH. Install from https://developer.android.com/studio"
    }
}

# ─── Build iOS (Capacitor) ──────────────────────────────────────────────────

function Build-iOS {
    Write-Step "Building iOS (Capacitor)..."
    Set-Location $Frontend

    if ($env:OS -match 'Windows') {
        Write-Warn "iOS builds require macOS with Xcode. Syncing web assets only..."
    }

    Write-Host "  Installing dependencies..."
    npm ci --legacy-peer-deps 2>$null | Out-Null

    Write-Host "  Building web bundle..."
    npx tsc --noEmit
    npx vite build

    Write-Host "  Syncing Capacitor..."
    npx cap sync ios

    $iosPath = Join-Path $Frontend 'ios'
    Write-Ok "iOS project synced → $iosPath"
    Write-Host "  Open in Xcode (macOS): npx cap open ios"
    Write-Host "  Or run on device:       npx cap run ios"
}

# ─── Execute ─────────────────────────────────────────────────────────────────

try {
    switch ($Target) {
        'web'     { Build-Web }
        'windows' { Build-Windows }
        'android' { Build-Android }
        'ios'     { Build-iOS }
        'all'     {
            Build-Web
            Build-Windows
            Build-Android
            Build-iOS
        }
    }

    Write-Host "`n" -NoNewline
    Write-Step "Build complete! 🎉"
    Set-Location $Root

} catch {
    Write-Host "`n  ✗ Build failed: $_" -ForegroundColor Red
    Set-Location $Root
    exit 1
}
