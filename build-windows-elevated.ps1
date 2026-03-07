<#
.SYNOPSIS
  Build the Windows Electron installer with elevated privileges.
  This script must be run as Administrator to allow symbolic link creation.
#>

$ErrorActionPreference = 'Stop'
$frontendDir = 'c:\source_code\battery_simulator\frontend'

Set-Location $frontendDir
Write-Host "==> Building Windows installer from $frontendDir" -ForegroundColor Cyan

# Skip code signing (no certificate configured)
$env:CSC_IDENTITY_AUTO_DISCOVERY = 'false'

Write-Host "==> Running: npm run electron:build:win" -ForegroundColor Cyan
npm run electron:build:win

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n✅ Build successful!" -ForegroundColor Green
    $release = 'c:\source_code\battery_simulator\release'
    Write-Host "Installer location: $release" -ForegroundColor Yellow
    Get-ChildItem $release -Filter "*.exe" | ForEach-Object {
        Write-Host "  → $($_.Name) ($([math]::Round($_.Length / 1MB, 1)) MB)" -ForegroundColor Green
    }
} else {
    Write-Host "`n❌ Build failed with exit code $LASTEXITCODE" -ForegroundColor Red
}

Write-Host "`nPress Enter to close..."
Read-Host
