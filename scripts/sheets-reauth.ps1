# Mission Control - connect or re-authorize Google Drive/Sheets OAuth.
#
# This creates a persistent local OAuth token at data/drive_token.json.
# Re-run with -ResetToken when scopes change or Google returns a token/scope error.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\sheets-reauth.ps1
#   powershell -ExecutionPolicy Bypass -File scripts\sheets-reauth.ps1 -ResetToken

[CmdletBinding()]
param(
    [switch]$ResetToken,
    [switch]$SkipCloudSync,
    [int]$Port = 5000
)

$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent $PSScriptRoot
$BaseUrl = "http://localhost:$Port"
$CredentialsPath = Join-Path $ProjectDir "data\credentials.json"
$TokenPath = Join-Path $ProjectDir "data\drive_token.json"
$RootTokenPath = Join-Path $ProjectDir "drive_token.json"

function Read-DotEnvValue {
    param([string]$Name)

    $envPath = Join-Path $ProjectDir ".env"
    if (-not (Test-Path $envPath)) {
        return ""
    }

    foreach ($line in Get-Content -LiteralPath $envPath) {
        if ($line -match "^\s*$Name\s*=\s*(.*)\s*$") {
            return $Matches[1].Trim().Trim('"').Trim("'")
        }
    }
    return ""
}

function Test-LocalServer {
    try {
        Invoke-WebRequest -Uri "$BaseUrl/login" -UseBasicParsing -TimeoutSec 3 | Out-Null
        return $true
    } catch {
        return $false
    }
}

function Get-DriveStatus {
    try {
        return Invoke-RestMethod -Uri "$BaseUrl/api/drive/status" -Method Get -TimeoutSec 10
    } catch {
        return $null
    }
}

Set-Location $ProjectDir

Write-Host "==> Mission Control: Google Drive/Sheets OAuth" -ForegroundColor Cyan
Write-Host ""

$clientId = Read-DotEnvValue "GOOGLE_OAUTH_CLIENT_ID"
$clientSecret = Read-DotEnvValue "GOOGLE_OAUTH_CLIENT_SECRET"

if (-not (Test-Path $CredentialsPath) -and (-not $clientId -or -not $clientSecret)) {
    Write-Host "ERROR: Google OAuth client is not configured." -ForegroundColor Red
    Write-Host ""
    Write-Host "Use one of these options:" -ForegroundColor Yellow
    Write-Host "  1. Save downloaded OAuth JSON as: $CredentialsPath"
    Write-Host "  2. Or add these values to .env:"
    Write-Host "     GOOGLE_OAUTH_CLIENT_ID=your-client-id"
    Write-Host "     GOOGLE_OAUTH_CLIENT_SECRET=your-client-secret"
    Write-Host "     GOOGLE_OAUTH_PROJECT_ID=mission-control-496004"
    exit 1
}

if (-not (Test-Path $CredentialsPath)) {
    Write-Host "Using Google OAuth client values from .env." -ForegroundColor Green
}

if ($ResetToken) {
    Write-Host "Removing stale Drive token files..." -ForegroundColor Yellow
    Remove-Item -LiteralPath $TokenPath -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $RootTokenPath -Force -ErrorAction SilentlyContinue
}

if (-not (Test-LocalServer)) {
    Write-Host "Starting Flask on $BaseUrl ..." -ForegroundColor Yellow
    Start-Process python -ArgumentList "app.py" -WorkingDirectory $ProjectDir -WindowStyle Hidden

    $started = $false
    foreach ($i in 1..15) {
        Start-Sleep -Seconds 1
        if (Test-LocalServer) {
            $started = $true
            break
        }
    }

    if (-not $started) {
        Write-Host "ERROR: Flask did not start. Run python app.py manually and try again." -ForegroundColor Red
        exit 1
    }
}

$status = Get-DriveStatus
if ($status -and $status.connected -eq $true -and -not $ResetToken) {
    Write-Host "Google Drive/Sheets is already connected." -ForegroundColor Green
} else {
    $startUrl = "$BaseUrl/api/drive/auth/start"
    Write-Host "Opening browser for Google sign-in..." -ForegroundColor Green
    Write-Host "Auth start URL: $startUrl" -ForegroundColor Gray
    Start-Process $startUrl
    Write-Host "Complete the sign-in. The browser should redirect back to $BaseUrl."

    $connected = $false
    foreach ($elapsed in 2..90) {
        Start-Sleep -Seconds 2
        $status = Get-DriveStatus
        if ($status -and $status.connected -eq $true) {
            $connected = $true
            break
        }
        if (($elapsed % 10) -eq 0) {
            Write-Host "Waiting for OAuth callback..." -ForegroundColor Gray
        }
    }

    if (-not $connected) {
        Write-Host "ERROR: OAuth did not complete within the timeout." -ForegroundColor Red
        Write-Host "Check the browser window, then re-run this script." -ForegroundColor Yellow
        exit 1
    }

    Write-Host "Google Drive/Sheets connected." -ForegroundColor Green
}

$status = Get-DriveStatus
if ($status) {
    Write-Host ""
    Write-Host "Connection status:" -ForegroundColor Cyan
    Write-Host "  Connected      : $($status.connected)"
    Write-Host "  Finance sheet  : $($status.sheet_finance)"
    Write-Host "  Contacts sheet : $($status.sheet_contacts)"
    if ($status.error) {
        Write-Host "  Error          : $($status.error)" -ForegroundColor Yellow
    }
}

if (Test-Path $TokenPath) {
    Write-Host ""
    Write-Host "Persistent token saved at data\drive_token.json." -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "WARNING: data\drive_token.json was not created." -ForegroundColor Yellow
}

$bucket = Read-DotEnvValue "GCS_BUCKET"
if (-not $bucket) {
    $bucket = "parker-mission-control-data"
}

if (-not $SkipCloudSync -and (Get-Command gcloud -ErrorAction SilentlyContinue) -and (Test-Path $TokenPath)) {
    Write-Host ""
    Write-Host "Syncing token to gs://$bucket/ for Cloud Run..." -ForegroundColor Cyan
    gcloud storage cp $TokenPath "gs://$bucket/drive_token.json" 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Cloud token sync complete." -ForegroundColor Green
    } else {
        Write-Host "Cloud token sync failed. Local connection is still ready." -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Done." -ForegroundColor Green
