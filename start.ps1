# Battery Digital Twin — Quick Start Script (Windows)
# Run this from the project root: .\start.ps1

Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  Battery Digital Twin - 3D Simulator" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

# Check Python
$python = Get-Command python -ErrorAction SilentlyContinue
if (-not $python) {
    Write-Host "ERROR: Python not found. Install Python 3.11+ first." -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Python found: $($python.Source)" -ForegroundColor Green

# Check Node
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host "ERROR: Node.js not found. Install Node.js 18+ first." -ForegroundColor Red
    exit 1
}
Write-Host "[OK] Node.js found: $(node --version)" -ForegroundColor Green

Write-Host ""
Write-Host "--- Setting up Backend ---" -ForegroundColor Yellow

# Backend setup
Push-Location backend

if (-not (Test-Path "venv")) {
    Write-Host "Creating Python virtual environment..."
    python -m venv venv
}

Write-Host "Activating virtual environment..."
& .\venv\Scripts\Activate.ps1

Write-Host "Installing Python dependencies..."
pip install -r requirements.txt --quiet

Write-Host "Starting FastAPI server (background)..."
$backendJob = Start-Job -ScriptBlock {
    Set-Location $using:PWD
    & .\venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000
}
Write-Host "[OK] Backend starting on http://localhost:8000" -ForegroundColor Green

Pop-Location

Write-Host ""
Write-Host "--- Setting up Frontend ---" -ForegroundColor Yellow

Push-Location frontend

if (-not (Test-Path "node_modules")) {
    Write-Host "Installing npm dependencies..."
    npm install
}

Write-Host ""
Write-Host "================================================" -ForegroundColor Cyan
Write-Host "  Starting frontend dev server..." -ForegroundColor Cyan
Write-Host "  Open http://localhost:5173 in your browser" -ForegroundColor Cyan
Write-Host "  API docs: http://localhost:8000/docs" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host ""

npm run dev

Pop-Location

# Cleanup
Stop-Job $backendJob -ErrorAction SilentlyContinue
Remove-Job $backendJob -ErrorAction SilentlyContinue
