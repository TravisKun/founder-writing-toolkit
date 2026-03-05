#Requires -Version 5.1
<#
.SYNOPSIS
    FWT one-shot install + start script (Windows).
.DESCRIPTION
    - Checks prerequisites (git, python)
    - Optionally clones the repo (if not already present)
    - Creates/activates venv in fwt-backend/.venv
    - Installs pip dependencies
    - Creates fwt-backend/.env if missing (prompts for API key)
    - Starts uvicorn on port 8000
    - Health-checks the backend
    - Prints extension load instructions
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Colors ──────────────────────────────────────────────────────────────────
function Write-Step  { param($msg) Write-Host "`n==> $msg" -ForegroundColor Cyan }
function Write-Ok    { param($msg) Write-Host "    [OK] $msg" -ForegroundColor Green }
function Write-Warn  { param($msg) Write-Host "    [WARN] $msg" -ForegroundColor Yellow }
function Write-Fail  { param($msg) Write-Host "`n[FAIL] $msg" -ForegroundColor Red; exit 1 }

# ── 1. Prerequisites ─────────────────────────────────────────────────────────
Write-Step "Checking prerequisites"

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Fail "git not found. Install from https://git-scm.com/ and re-run."
}
Write-Ok "git found: $(git --version)"

$pythonCmd = $null
foreach ($candidate in @('python', 'python3', 'py')) {
    if (Get-Command $candidate -ErrorAction SilentlyContinue) {
        $ver = & $candidate --version 2>&1
        if ($ver -match '3\.\d+') { $pythonCmd = $candidate; break }
    }
}
if (-not $pythonCmd) {
    Write-Fail "Python 3 not found. Install from https://python.org/downloads/ and re-run."
}
Write-Ok "Python found: $($pythonCmd) ($(& $pythonCmd --version 2>&1))"

# ── 2. Repo location ──────────────────────────────────────────────────────────
Write-Step "Locating repo"

$scriptDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot   = Split-Path -Parent $scriptDir       # scripts/ lives one level under repo root
$backendDir = Join-Path $repoRoot 'fwt-backend'

if (-not (Test-Path (Join-Path $backendDir 'main.py'))) {
    Write-Warn "fwt-backend/main.py not found at: $backendDir"
    $cloneTarget = Join-Path $env:USERPROFILE 'fwt'
    if (Test-Path $cloneTarget) {
        Write-Warn "Target folder already exists: $cloneTarget — skipping clone."
        $repoRoot   = $cloneTarget
        $backendDir = Join-Path $repoRoot 'fwt-backend'
    } else {
        $repoUrl = Read-Host "Enter the GitHub repo URL to clone (e.g. https://github.com/zhuchenming818-hue/founder-writing-toolkit)"
        Write-Host "  Cloning into $cloneTarget ..."
        git clone $repoUrl $cloneTarget
        $repoRoot   = $cloneTarget
        $backendDir = Join-Path $repoRoot 'fwt-backend'
    }
}
Write-Ok "Repo root: $repoRoot"

# ── 3. Virtual environment ───────────────────────────────────────────────────
Write-Step "Setting up Python virtual environment"

$venvDir    = Join-Path $backendDir '.venv'
$venvPython = Join-Path $venvDir 'Scripts\python.exe'
$venvPip    = Join-Path $venvDir 'Scripts\pip.exe'

if (-not (Test-Path $venvPython)) {
    Write-Host "  Creating venv at $venvDir ..."
    & $pythonCmd -m venv $venvDir
} else {
    Write-Ok "venv already exists — skipping creation."
}

# ── 4. Install dependencies ───────────────────────────────────────────────────
Write-Step "Installing Python dependencies"

$reqFile = Join-Path $backendDir 'requirements.txt'
if (-not (Test-Path $reqFile)) { Write-Fail "requirements.txt not found at $reqFile" }

& $venvPip install --quiet --upgrade pip
& $venvPip install --quiet -r $reqFile
Write-Ok "Dependencies installed."

# ── 5. .env setup ─────────────────────────────────────────────────────────────
Write-Step "Configuring .env"

$envFile = Join-Path $backendDir '.env'
if (Test-Path $envFile) {
    Write-Ok ".env already exists — skipping (edit $envFile to change key)."
} else {
    Write-Host ""
    Write-Host "  You need an Anthropic API key. Get one at https://console.anthropic.com/settings/api-keys" -ForegroundColor Yellow
    Write-Host ""
    try {
        $apiKeySecure = Read-Host "  Enter your ANTHROPIC_API_KEY" -AsSecureString
        $bstr   = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($apiKeySecure)
        $apiKey = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    } catch {
        $apiKey = Read-Host "  Enter your ANTHROPIC_API_KEY"
    }
    if (-not $apiKey -or $apiKey.Trim() -eq '') { Write-Fail "API key cannot be empty." }

    $envContent = "ANTHROPIC_API_KEY=$($apiKey.Trim())`nANTHROPIC_MODEL=claude-sonnet-4-6`n"
    Set-Content -Path $envFile -Value $envContent -Encoding UTF8
    Write-Ok ".env created with ANTHROPIC_MODEL=claude-sonnet-4-6."
}

# ── 6. Start backend ──────────────────────────────────────────────────────────
Write-Step "Starting backend (uvicorn port 8000)"

$uvicorn = Join-Path $venvDir 'Scripts\uvicorn.exe'
if (-not (Test-Path $uvicorn)) { Write-Fail "uvicorn not found — dependency install may have failed." }

Push-Location $backendDir
Write-Host "  Launching uvicorn in a new window..."
Start-Process -FilePath $uvicorn `
    -ArgumentList 'main:app', '--reload', '--port', '8000' `
    -WorkingDirectory $backendDir `
    -WindowStyle Normal
Pop-Location

# Give the server a moment to start
Write-Host "  Waiting 3 seconds for server to start..."
Start-Sleep -Seconds 3

# ── 7. Health check ───────────────────────────────────────────────────────────
Write-Step "Health check: GET http://localhost:8000/health"

try {
    $resp = Invoke-RestMethod -Uri 'http://localhost:8000/health' -Method Get -TimeoutSec 5
    Write-Ok "Backend is UP — status=$($resp.status) model=$($resp.model)"
} catch {
    Write-Warn "Health check failed: $($_.Exception.Message)"
    Write-Host "  The server may still be starting. Try: curl http://localhost:8000/health" -ForegroundColor Yellow
}

# ── 8. Extension load instructions ───────────────────────────────────────────
Write-Host ""
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host "  Load the extension (3 steps):" -ForegroundColor Cyan
Write-Host ""
Write-Host "  1. Open Chrome or Edge and go to:" -ForegroundColor White
Write-Host "        chrome://extensions   (Chrome)" -ForegroundColor Yellow
Write-Host "        edge://extensions     (Edge)" -ForegroundColor Yellow
Write-Host ""
Write-Host "  2. Enable Developer mode (toggle, top-right)" -ForegroundColor White
Write-Host ""
Write-Host "  3. Click 'Load unpacked' and select:" -ForegroundColor White
$extPath = Join-Path $repoRoot 'extension'
Write-Host "        $extPath" -ForegroundColor Yellow
Write-Host ""
Write-Host "  First use: right-click the FWT toolbar icon -> 'Open side panel'" -ForegroundColor White
Write-Host "  After that: icon-click opens the panel automatically." -ForegroundColor White
Write-Host ""
Write-Host "  Backend docs: http://localhost:8000/docs" -ForegroundColor Cyan
Write-Host "═══════════════════════════════════════════════════════" -ForegroundColor Cyan
Write-Host ""
