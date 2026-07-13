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

$envVars = "DATA_DIR=/data,FINANCE_SHEET_ID=1UaFkSQ3wwrPt6pfZIfnNrlMQmerv-ZQ52KYyCF5rIvo,HEALTH_SHEET_ID=1IaAphdKbTYrX3OHL_CDsFieB1bi-H_DznRHdzaQwDfk,FINANCE_OWNER_EMAIL=parkergent7@gmail.com"

# Sign-in (Google identity + MFA). Production is password-free: ALLOW_PASSWORD_LOGIN
# is false, so /api/login is disabled and access requires Google sign-in + 2FA.
# Break-glass: set it to true and re-deploy ONLY if you get locked out of Google
# sign-in. Google's OAuth client (data/credentials.json in the bucket) must list the
# run.app /api/auth/google/callback redirect URI.
$envVars += ",ALLOWED_LOGIN_EMAILS=parkergent7@gmail.com,SESSION_LIFETIME_DAYS=7,ALLOW_PASSWORD_LOGIN=false"

$secretBindings = "ANTHROPIC_API_KEY=anthropic-api-key:latest,FLASK_SECRET=flask-secret:latest,GITHUB_TOKEN=github-token:latest"

Write-Host "==> Deploying to Cloud Run..." -ForegroundColor Cyan
gcloud run deploy $SERVICE `
    --source . `
    --region $REGION `
    --allow-unauthenticated `
    --memory 2Gi `
    --timeout 120 `
    --min-instances 0 `
    --max-instances 3 `
    --set-env-vars $envVars `
    --set-secrets $secretBindings `
    --add-volume "name=data,type=cloud-storage,bucket=$BUCKET" `
    --add-volume-mount "volume=data,mount-path=/data"

Write-Host ""
Write-Host "============================================" -ForegroundColor Green
Write-Host " Done! Open the URL above on your phone." -ForegroundColor Green
Write-Host "============================================" -ForegroundColor Green
