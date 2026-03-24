param(
    [string]$MaintenanceDb = "postgres"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    throw "pnpm is required but was not found in PATH."
}

Write-Host "Using repo root: $repoRoot"
Write-Host "Maintenance database: $MaintenanceDb"
Write-Host "Running schema-only migration from .env.dev shape into .env.prod target..."

pnpm --dir $repoRoot --filter ./apps/server exec tsx src/database/schema-only-migration.ts --maintenance-db $MaintenanceDb

