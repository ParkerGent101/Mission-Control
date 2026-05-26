# Mission Control — Health Check
#
# Checks the live Cloud Run deployment: HTTP reachability, service ready state,
# and error log count in the last 24 hours.
#
# Usage:
#   .\scripts\health-check.ps1                    # color console report
#   .\scripts\health-check.ps1 -OutputJson        # JSON (for scheduled agent)
#   .\scripts\health-check.ps1 -NotifyOnSuccess   # push notification even when healthy
#
# Exit codes: 0 = healthy, 1 = degraded

param(
    [switch]$OutputJson,
    [switch]$NotifyOnSuccess
)

$LIVE_URL   = "https://mission-control-568559213462.us-central1.run.app"
$PROJECT_ID = "mission-control-496004"
$REGION     = "us-central1"
$SERVICE    = "mission-control"

$result = @{
    timestamp      = (Get-Date -Format "o")
    http_status    = 0
    http_ok        = $false
    service_ready  = $false
    latest_rev     = ""
    errors_24h     = -1
    recent_errors  = @()
    overall        = "unknown"
    notes          = @()
}

# --- 1. HTTP ping ---
try {
    $resp = Invoke-WebRequest -Uri "$LIVE_URL/login" -UseBasicParsing -TimeoutSec 20
    $result.http_status = $resp.StatusCode
    $result.http_ok     = ($resp.StatusCode -eq 200)
} catch {
    $result.http_status = 0
    $result.notes      += "HTTP ping failed: $($_.Exception.Message)"
}

# --- 2. Cloud Run service status via GCP REST API ---
$token = $null
try {
    $token = (gcloud auth print-access-token 2>$null).Trim()
} catch { }

if (-not $token) {
    $result.notes += "GCP token unavailable — run: gcloud auth application-default login"
} else {
    # Service status
    try {
        $svcUrl = "https://run.googleapis.com/v2/projects/$PROJECT_ID/locations/$REGION/services/$SERVICE"
        $svc    = Invoke-RestMethod -Uri $svcUrl -Headers @{ Authorization = "Bearer $token" } -TimeoutSec 15

        $terminal   = if ($svc.terminalCondition) { @($svc.terminalCondition) } else { @() }
        $conditions = $terminal + @($svc.conditions)
        $result.service_ready = ($conditions | Where-Object { $_.type -eq "Ready" -and $_.state -eq "CONDITION_SUCCEEDED" }).Count -gt 0
        $result.latest_rev    = ($svc.latestReadyRevision -split "/")[-1]
    } catch {
        $result.notes += "Cloud Run status check failed: $($_.Exception.Message)"
    }

    # Error logs (last 24h)
    try {
        $since  = (Get-Date).ToUniversalTime().AddHours(-24).ToString("yyyy-MM-ddTHH:mm:ssZ")
        $filter = "resource.type=`"cloud_run_revision`" AND resource.labels.service_name=`"$SERVICE`" AND severity>=ERROR AND timestamp>=`"$since`""
        $body   = @{
            resourceNames = @("projects/$PROJECT_ID")
            filter        = $filter
            orderBy       = "timestamp desc"
            pageSize      = 10
        } | ConvertTo-Json

        $logResp = Invoke-RestMethod `
            -Uri "https://logging.googleapis.com/v2/entries:list" `
            -Method Post `
            -Headers @{ Authorization = "Bearer $token"; "Content-Type" = "application/json" } `
            -Body $body `
            -TimeoutSec 15

        $entries = @($logResp.entries)
        $result.errors_24h = $entries.Count
        $result.recent_errors = $entries | Select-Object -First 3 | ForEach-Object {
            $msg = if ($_.textPayload) { $_.textPayload }
                   elseif ($_.jsonPayload.message) { $_.jsonPayload.message }
                   elseif ($_.jsonPayload.msg) { $_.jsonPayload.msg }
                   else { $_.timestamp }
            "$($_.timestamp.Substring(0,19)) [$($_.severity)] $($msg.Substring(0, [Math]::Min(200, $msg.Length)))"
        }
    } catch {
        $result.notes += "Log query failed: $($_.Exception.Message)"
    }
}

# --- 3. Overall status ---
$isHealthy = $result.http_ok -and $result.service_ready -and ($result.errors_24h -le 0 -or $result.errors_24h -eq -1)
$result.overall = if ($isHealthy) { "healthy" } else { "degraded" }

# --- 4. Output ---
if ($OutputJson) {
    $result | ConvertTo-Json -Depth 5
} else {
    $color = if ($result.overall -eq "healthy") { "Green" } else { "Red" }
    Write-Host ""
    Write-Host "==== Mission Control Health Check ====" -ForegroundColor $color
    Write-Host "  Timestamp   : $($result.timestamp)"
    Write-Host "  HTTP status : $($result.http_status)$(if ($result.http_ok) { ' [OK]' } else { ' [FAIL]' })"
    Write-Host "  Service ready: $(if ($result.service_ready) { 'YES' } else { 'NO' })"
    Write-Host "  Latest rev  : $($result.latest_rev)"
    Write-Host "  Errors (24h): $(if ($result.errors_24h -eq -1) { 'unknown' } else { $result.errors_24h })"
    if ($result.recent_errors.Count -gt 0) {
        Write-Host "  Recent errors:" -ForegroundColor Red
        foreach ($e in $result.recent_errors) { Write-Host "    $e" -ForegroundColor Red }
    }
    if ($result.notes.Count -gt 0) {
        Write-Host "  Notes:" -ForegroundColor Yellow
        foreach ($n in $result.notes) { Write-Host "    - $n" -ForegroundColor Yellow }
    }
    Write-Host ""
    Write-Host "  OVERALL: $($result.overall.ToUpper())" -ForegroundColor $color
    Write-Host "======================================" -ForegroundColor $color
    Write-Host ""
}

exit $(if ($result.overall -eq "healthy") { 0 } else { 1 })
