#Requires -Version 5.1
<#
.SYNOPSIS
    Start (or restart) the FWT backend.
.DESCRIPTION
    Activates the venv and runs uvicorn on port 8000.
    Run this each time you open a new terminal session.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$scriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot   = Split-Path -Parent $scriptDir
$backendDir = Join-Path $repoRoot 'fwt-backend'
$venvDir    = Join-Path $backendDir '.venv'
$uvicorn    = Join-Path $venvDir 'Scripts\uvicorn.exe'
$envFile    = Join-Path $backendDir '.env'

if (-not (Test-Path $uvicorn)) {
    Write-Host "[FWT] uvicorn not found. Run scripts\install.ps1 first." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path $envFile)) {
    Write-Host "[FWT] .env missing. Run scripts\install.ps1 to create it." -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "  Starting FWT backend on http://localhost:8000" -ForegroundColor Cyan
Write-Host "  Interactive docs: http://localhost:8000/docs" -ForegroundColor Cyan
Write-Host "  Press Ctrl+C to stop." -ForegroundColor Yellow
Write-Host ""

Push-Location $backendDir
& $uvicorn main:app --reload --port 8000
Pop-Location
