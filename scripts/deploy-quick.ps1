# Mission Control - Quick Deploy
#
# Optionally commits staged/unstaged changes, then deploys to Cloud Run
# and verifies the live URL responds.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\deploy-quick.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\deploy-quick.ps1 -SkipCommit
#   powershell -ExecutionPolicy Bypass -File scripts\deploy-quick.ps1 -Message "fix: finance card fallback"
#   powershell -ExecutionPolicy Bypass -File scripts\deploy-quick.ps1 -SkipData   # code only; don't push local data/*.json to live

param(
    [string]$Message = "",
    [switch]$SkipCommit,
    [switch]$SkipData
)

# Treat native-command stderr lines as regular output, not PowerShell errors.
# Required for PS 5.1 where `git` writing to stderr otherwise sets $? = $false
# and can wedge subsequent try/catch parsing.
$ErrorActionPreference = "Continue"
$PSNativeCommandUseErrorActionPreference = $false

$LIVE_URL   = "https://mission-control-568559213462.us-central1.run.app"
$PROJECT_DIR = $PSScriptRoot | Split-Path -Parent

# Safe files - mirrors the $dataFiles list in deploy.ps1 and known source files
$SAFE_SOURCE = @("app.py", "requirements.txt", "Dockerfile", ".dockerignore", "deploy.ps1", "deploy.sh", "HANDOFF.md")
$SAFE_DATA   = @(
    "shows.json","band_songs.json","band_contacts.json","band_content.json",
    "finances.json","savings.json","health.json","agenda.json","tasks.json",
    "reminders.json","work_tasks.json","reading.json","gaming.json",
    "holidays.json","journal.json","subscriptions.json","drive_config.json"
)

Write-Host "==> Mission Control: Quick Deploy" -ForegroundColor Cyan
Write-Host ""

# --- Pre-flight ---
if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: gcloud not found on PATH." -ForegroundColor Red
    exit 1
}

Set-Location $PROJECT_DIR

# --- Git: optional commit ---
if (-not $SkipCommit) {
    $gitStatus = git status --porcelain 2>$null
    if ($gitStatus) {
        Write-Host "Uncommitted changes detected:" -ForegroundColor Yellow
        git status --short
        Write-Host ""

        if (-not $Message) {
            Write-Host "Commit message? (press Enter to skip commit):" -ForegroundColor White
            $Message = Read-Host
        }

        if ($Message.Trim()) {
            Write-Host "==> Staging safe files..." -ForegroundColor Cyan
            foreach ($f in $SAFE_SOURCE) {
                if (Test-Path $f) { git add $f }
            }
            # Stage static/ and templates/ directories
            if (Test-Path "static") { git add "static/" }
            if (Test-Path "templates") { git add "templates/" }
            # Stage safe data files
            foreach ($f in $SAFE_DATA) {
                $p = "data\$f"
                if (Test-Path $p) { git add $p }
            }
            # Stage .claude/ directory (slash commands, settings)
            if (Test-Path ".claude") { git add ".claude/" }

            git commit -m $Message.Trim()
            if ($LASTEXITCODE -ne 0) {
                Write-Host "ERROR: git commit failed." -ForegroundColor Red
                exit 1
            }
        } else {
            Write-Host "  Skipping commit." -ForegroundColor Gray
        }
    } else {
        Write-Host "  Working tree is clean." -ForegroundColor Gray
    }

    # Push to GitHub (non-fatal - stderr is captured by PowerShell automatically)
    Write-Host ""
    Write-Host "==> Pushing to GitHub..." -ForegroundColor Cyan
    git push origin main
    if ($LASTEXITCODE -ne 0) {
        Write-Host "  WARNING: git push failed (exit $LASTEXITCODE) - continuing with Cloud Run deploy." -ForegroundColor Yellow
    } else {
        Write-Host "  Pushed." -ForegroundColor Green
    }
}

# --- Deploy via existing deploy.ps1 ---
Write-Host ""
Write-Host "==> Deploying to Cloud Run (via deploy.ps1)..." -ForegroundColor Cyan
if ($SkipData) {
    Write-Host "  (-SkipData: live GCS data will NOT be overwritten)" -ForegroundColor Yellow
    & "$PROJECT_DIR\deploy.ps1" -SkipData
} else {
    & "$PROJECT_DIR\deploy.ps1"
}
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Deploy failed." -ForegroundColor Red
    exit 1
}

# --- Health check ---
Write-Host ""
Write-Host "==> Waiting 15s for Cloud Run to route traffic..." -ForegroundColor Cyan
Start-Sleep -Seconds 15

Write-Host "==> Health check: $LIVE_URL/login" -ForegroundColor Cyan
try {
    $resp = Invoke-WebRequest -Uri "$LIVE_URL/login" -UseBasicParsing -TimeoutSec 30
    if ($resp.StatusCode -eq 200) {
        Write-Host ""
        Write-Host "============================================" -ForegroundColor Green
        Write-Host " DEPLOYED and LIVE - HTTP $($resp.StatusCode)" -ForegroundColor Green
        Write-Host " $LIVE_URL" -ForegroundColor Green
        Write-Host "============================================" -ForegroundColor Green
    } else {
        Write-Host "WARNING: Unexpected status $($resp.StatusCode)" -ForegroundColor Yellow
    }
} catch {
    Write-Host ""
    Write-Host "============================================" -ForegroundColor Yellow
    Write-Host " Deploy likely succeeded but health check" -ForegroundColor Yellow
    Write-Host " timed out. Check manually: $LIVE_URL" -ForegroundColor Yellow
    Write-Host " Error: $($_.Exception.Message)" -ForegroundColor Yellow
    Write-Host "============================================" -ForegroundColor Yellow
}
