# Mission Control -Cloud Run deployment (PowerShell)
#
# Normal deploy (code + data changes):
#   powershell -ExecutionPolicy Bypass -File deploy.ps1
#
# Code-only deploy (DO NOT overwrite live GCS data with local data/*.json):
#   powershell -ExecutionPolicy Bypass -File deploy.ps1 -SkipData
#
# First-time setup (enables APIs, creates bucket & secrets):
#   powershell -ExecutionPolicy Bypass -File deploy.ps1 -Setup

param([switch]$Setup, [switch]$SkipData)

$PROJECT_ID = "mission-control-496004"
$REGION     = "us-central1"
$SERVICE    = "mission-control"
$BUCKET     = "parker-mission-control-data"

# OAuth banks (Fidelity, Chase, etc.): register this EXACT url as an allowed redirect
# URI in the Plaid dashboard FIRST, then set it here. Leave "" until registered - an
# unregistered redirect URI makes every bank link fail, not just OAuth ones.
$PLAID_REDIRECT_URI = ""   # e.g. "https://mission-control-568559213462.us-central1.run.app/"

Write-Host "==> Setting project..." -ForegroundColor Cyan
gcloud config set project $PROJECT_ID

if ($Setup) {
    Write-Host "==> [Setup] Enabling APIs..." -ForegroundColor Yellow
    gcloud services enable run.googleapis.com cloudbuild.googleapis.com secretmanager.googleapis.com storage.googleapis.com

    Write-Host "==> [Setup] Creating data bucket..." -ForegroundColor Yellow
    gcloud storage buckets create "gs://$BUCKET" --location=$REGION --uniform-bucket-level-access 2>$null
    if ($LASTEXITCODE -ne 0) { Write-Host "  (bucket already exists, skipping)" }

    Write-Host "==> [Setup] Storing API key in Secret Manager..." -ForegroundColor Yellow
    $apiKey = Read-Host "Paste your ANTHROPIC_API_KEY"
    $tmp = [System.IO.Path]::GetTempFileName()
    [System.IO.File]::WriteAllText($tmp, $apiKey)
    gcloud secrets create anthropic-api-key --data-file=$tmp 2>$null
    if ($LASTEXITCODE -ne 0) {
        gcloud secrets versions add anthropic-api-key --data-file=$tmp
    }
    Remove-Item $tmp

    Write-Host "==> [Setup] Storing Flask secret..." -ForegroundColor Yellow
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    $bytes = New-Object byte[] 32
    $rng.GetBytes($bytes)
    $flaskSecret = [System.Convert]::ToBase64String($bytes)
    $tmp = [System.IO.Path]::GetTempFileName()
    [System.IO.File]::WriteAllText($tmp, $flaskSecret)
    gcloud secrets create flask-secret --data-file=$tmp 2>$null
    if ($LASTEXITCODE -ne 0) { Write-Host "  (flask-secret exists, skipping)" }
    Remove-Item $tmp

    Write-Host "==> [Setup] Storing Plaid credentials (optional - press Enter to skip)..." -ForegroundColor Yellow
    $plaidId = Read-Host "Paste your PLAID_CLIENT_ID (or Enter to skip bank sync)"
    if ($plaidId.Trim()) {
        $tmp = [System.IO.Path]::GetTempFileName()
        [System.IO.File]::WriteAllText($tmp, $plaidId.Trim())
        gcloud secrets create plaid-client-id --data-file=$tmp 2>$null
        if ($LASTEXITCODE -ne 0) { gcloud secrets versions add plaid-client-id --data-file=$tmp }
        Remove-Item $tmp

        $plaidSecret = Read-Host "Paste your PLAID_SECRET (production)"
        $tmp = [System.IO.Path]::GetTempFileName()
        [System.IO.File]::WriteAllText($tmp, $plaidSecret.Trim())
        gcloud secrets create plaid-secret --data-file=$tmp 2>$null
        if ($LASTEXITCODE -ne 0) { gcloud secrets versions add plaid-secret --data-file=$tmp }
        Remove-Item $tmp
    } else {
        Write-Host "  (skipped Plaid - add later: gcloud secrets create plaid-client-id / plaid-secret)" -ForegroundColor Gray
    }
}

if ($SkipData) {
    Write-Host "==> Skipping data upload (-SkipData): live GCS data left untouched." -ForegroundColor Yellow
} else {
    Write-Host "==> Syncing data to GCS (force-uploading key files)..." -ForegroundColor Cyan
    # Data files live at bucket ROOT (mounted at /data on Cloud Run), not in a data/ prefix
    $dataFiles = @(
        "shows.json","band_songs.json","band_contacts.json","band_content.json",
        "finances.json","savings.json","health.json","agenda.json","tasks.json",
        "reminders.json","work_tasks.json",
        "holidays.json","subscriptions.json","drive_config.json"
    )
    foreach ($f in $dataFiles) {
        $local = "data\$f"
        if (Test-Path $local) {
            gcloud storage cp $local "gs://$BUCKET/$f" 2>$null
            Write-Host "  uploaded $f"
        }
    }
}

# Env vars: append the Plaid OAuth redirect URI only when it's been configured above.
$envVars = "DATA_DIR=/data,FINANCE_SHEET_ID=1UaFkSQ3wwrPt6pfZIfnNrlMQmerv-ZQ52KYyCF5rIvo,HEALTH_SHEET_ID=1IaAphdKbTYrX3OHL_CDsFieB1bi-H_DznRHdzaQwDfk,FINANCE_OWNER_EMAIL=parkergent7@gmail.com,PLAID_ENV=production"
if ($PLAID_REDIRECT_URI) { $envVars += ",PLAID_REDIRECT_URI=$PLAID_REDIRECT_URI" }

# Only bind Plaid secrets if they exist in Secret Manager, so a deploy never fails
# when bank sync hasn't been configured yet.
$secretBindings = "ANTHROPIC_API_KEY=anthropic-api-key:latest,FLASK_SECRET=flask-secret:latest,GITHUB_TOKEN=github-token:latest"
$existingSecrets = gcloud secrets list --format="value(name)" 2>$null
if (($existingSecrets -contains "plaid-client-id") -and ($existingSecrets -contains "plaid-secret")) {
    $secretBindings += ",PLAID_CLIENT_ID=plaid-client-id:latest,PLAID_SECRET=plaid-secret:latest"
    Write-Host "==> Plaid secrets found - binding bank sync." -ForegroundColor Gray
} else {
    Write-Host "==> Plaid secrets not found - deploying without bank sync (create plaid-client-id/plaid-secret then re-deploy)." -ForegroundColor Yellow
}

Write-Host "==> Deploying to Cloud Run..." -ForegroundColor Cyan
gcloud run deploy $SERVICE `
    --source . `
    --region $REGION `
    --allow-unauthenticated `
    --memory 512Mi `
    --timeout 120 `
    --min-instances 1 `
    --set-env-vars $envVars `
    --set-secrets $secretBindings `
    --add-volume "name=data,type=cloud-storage,bucket=$BUCKET" `
    --add-volume-mount "volume=data,mount-path=/data"

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host " Done! Open the URL above on your phone." -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
