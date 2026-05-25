[CmdletBinding()]
param(
    [switch]$Apply
)

$ErrorActionPreference = "Stop"
$Root = Resolve-Path (Join-Path $PSScriptRoot "..")

$namePatterns = @(
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    "htmlcov",
    ".coverage",
    "*.pyc",
    "*.pyo",
    "*.pyd",
    "*.log",
    "local-*.png"
)

$excludePath = '[\\/]\.git([\\/]|$)|[\\/]\.venv([\\/]|$)|[\\/]venv([\\/]|$)'

$items = Get-ChildItem -LiteralPath $Root -Force -Recurse -ErrorAction SilentlyContinue |
    Where-Object {
        if ($_.FullName -match $excludePath) {
            return $false
        }
        foreach ($pattern in $namePatterns) {
            if ($_.Name -like $pattern) {
                return $true
            }
        }
        return $false
}

$items = $items | Sort-Object FullName -Unique

$containerPaths = @(
    $items |
        Where-Object { $_.PSIsContainer } |
        ForEach-Object { $_.FullName.TrimEnd("\", "/") + [System.IO.Path]::DirectorySeparatorChar }
)

$items = $items | Where-Object {
    foreach ($containerPath in $containerPaths) {
        if (-not $_.PSIsContainer -and $_.FullName.StartsWith($containerPath, [System.StringComparison]::OrdinalIgnoreCase)) {
            return $false
        }
    }
    return $true
}

if (-not $items) {
    Write-Host "No generated cleanup targets found."
    exit 0
}

$items | Select-Object FullName, Mode, Length, LastWriteTime | Format-Table -AutoSize

if (-not $Apply) {
    Write-Host ""
    Write-Host "Preview only. Re-run with -Apply to remove these targets."
    exit 0
}

foreach ($item in $items) {
    Remove-Item -LiteralPath $item.FullName -Recurse -Force -ErrorAction SilentlyContinue
}

Write-Host "Cleanup complete."
