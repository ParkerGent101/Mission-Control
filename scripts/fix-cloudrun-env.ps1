# Mission Control -Fix Cloud Run environment variables & secrets
#
# Adds the missing GITHUB_TOKEN secret and ensures all env vars are correct.
# Safe to re-run: reads current config and merges rather than replacing.
#
# Usage:
#   powershell -ExecutionPolicy Bypass -File scripts\fix-cloudrun-env.ps1

$PROJECT_ID = "mission-control-496004"
$REGION     = "us-central1"
$SERVICE    = "mission-control"

# Free Plaid accounts can run against Sandbox. Use "production" only with a Production
# secret and access to real bank data.
$PLAID_ENV = "sandbox"

# Set $PLAID_REDIRECT_URI only AFTER registering the exact URL in the Plaid dashboard
# (an unregistered redirect URI breaks every bank link). Needed for OAuth banks (Fidelity).
$PLAID_REDIRECT_URI = ""   # e.g. "https://mission-control-568559213462.us-central1.run.app/"
$REQUIRED_ENV = "DATA_DIR=/data,FINANCE_SHEET_ID=1UaFkSQ3wwrPt6pfZIfnNrlMQmerv-ZQ52KYyCF5rIvo,PLAID_ENV=$PLAID_ENV"
if ($PLAID_REDIRECT_URI) { $REQUIRED_ENV += ",PLAID_REDIRECT_URI=$PLAID_REDIRECT_URI" }

Write-Host "==> Mission Control: Fix Cloud Run Environment" -ForegroundColor Cyan
Write-Host ""

# --- Pre-flight ---
if (-not (Get-Command gcloud -ErrorAction SilentlyContinue)) {
    Write-Host "ERROR: gcloud not found on PATH. Install Google Cloud SDK first." -ForegroundColor Red
    exit 1
}

gcloud config set project $PROJECT_ID --quiet

# --- Read current Cloud Run config ---
Write-Host "==> Reading current Cloud Run configuration..." -ForegroundColor Cyan
$svcJson = gcloud run services describe $SERVICE --region $REGION --format json 2>$null | ConvertFrom-Json

if (-not $svcJson) {
    Write-Host "ERROR: Could not describe service '$SERVICE'. Are you authenticated?" -ForegroundColor Red
    Write-Host "Run: gcloud auth login" -ForegroundColor Yellow
    exit 1
}

# Extract current secret bindings from Cloud Run
$currentSecrets = @{}
$containers = $svcJson.spec.template.spec.containers
if ($containers -and $containers[0].env) {
    foreach ($envVar in $containers[0].env) {
        if ($envVar.valueFrom -and $envVar.valueFrom.secretKeyRef) {
            $secretName = $envVar.valueFrom.secretKeyRef.name
            $currentSecrets[$envVar.name] = $secretName
        }
    }
}

Write-Host "  Current secret bindings: $($currentSecrets.Keys -join ', ')" -ForegroundColor Gray

# --- Check / create github-token secret ---
Write-Host ""
Write-Host "==> Checking Secret Manager for 'github-token'..." -ForegroundColor Cyan

$existingSecrets = gcloud secrets list --format="value(name)" --project $PROJECT_ID 2>$null
$hasGithubToken = $existingSecrets -contains "github-token"

if ($hasGithubToken) {
    Write-Host "  'github-token' already exists in Secret Manager." -ForegroundColor Green
} else {
    Write-Host "  'github-token' NOT found. Creating it now." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Paste your GitHub Personal Access Token (needs 'repo' scope for ParkerGent101/CUA-Website):" -ForegroundColor White
    $githubPat = Read-Host
    if (-not $githubPat.Trim()) {
        Write-Host "ERROR: No token provided. Exiting." -ForegroundColor Red
        exit 1
    }
    $tmp = [System.IO.Path]::GetTempFileName()
    [System.IO.File]::WriteAllText($tmp, $githubPat.Trim())
    gcloud secrets create github-token --data-file=$tmp --project $PROJECT_ID
    if ($LASTEXITCODE -ne 0) {
        Write-Host "ERROR: Failed to create secret." -ForegroundColor Red
        Remove-Item $tmp -Force
        exit 1
    }
    Remove-Item $tmp -Force
    Write-Host "  Secret 'github-token' created." -ForegroundColor Green
}

# --- Build merged --set-secrets string ---
# Always include all three; add GITHUB_TOKEN to whatever was there
$secretBindings = "ANTHROPIC_API_KEY=anthropic-api-key:latest,FLASK_SECRET=flask-secret:latest,GITHUB_TOKEN=github-token:latest"

# Bind Plaid bank-sync secrets only if they exist (keeps this safe to run pre-Plaid)
if (($existingSecrets -contains "plaid-client-id") -and ($existingSecrets -contains "plaid-secret")) {
    $secretBindings += ",PLAID_CLIENT_ID=plaid-client-id:latest,PLAID_SECRET=plaid-secret:latest"
    Write-Host "  Plaid secrets found - binding bank sync." -ForegroundColor Gray
} else {
    Write-Host "  Plaid secrets not found - skipping bank sync binding." -ForegroundColor Yellow
}

# --- Update Cloud Run service ---
Write-Host ""
Write-Host "==> Updating Cloud Run service with all secrets and env vars..." -ForegroundColor Cyan

gcloud run services update $SERVICE `
    --region $REGION `
    --set-env-vars $REQUIRED_ENV `
    --set-secrets $secretBindings

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: gcloud run services update failed." -ForegroundColor Red
    exit 1
}

# --- Verify ---
Write-Host ""
Write-Host "==> Verifying update..." -ForegroundColor Cyan
$updated = gcloud run services describe $SERVICE --region $REGION --format json 2>$null | ConvertFrom-Json
$updatedEnv = $updated.spec.template.spec.containers[0].env
$found = @{}
foreach ($e in $updatedEnv) {
    if ($e.valueFrom -and $e.valueFrom.secretKeyRef) {
        $found[$e.name] = $e.valueFrom.secretKeyRef.name
    }
    if ($e.value) {
        $found[$e.name] = $e.value
    }
}

$checks = @("ANTHROPIC_API_KEY", "FLASK_SECRET", "GITHUB_TOKEN", "DATA_DIR", "FINANCE_SHEET_ID")
foreach ($k in $checks) {
    if ($found.ContainsKey($k)) {
        Write-Host "  [OK] $k = $($found[$k])" -ForegroundColor Green
    } else {
        Write-Host "  [MISSING] $k" -ForegroundColor Red
    }
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host " Done! Band push to comingupaces.net should" -ForegroundColor Green
Write-Host " now work. Test it from the Band card." -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
