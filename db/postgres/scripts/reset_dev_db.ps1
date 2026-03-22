#Requires -Version 5.1
<#
.SYNOPSIS
    Drops and recreates caro_dev from scratch, then runs all migrations and seeds.

.DESCRIPTION
    Useful for resetting to a clean state during development.

    Steps:
      1. Prompts for confirmation — the drop is irreversible
      2. Prompts for the postgres password (once — forwarded to setup_dev_db.ps1)
      3. Drops caro_dev if it exists (terminates open connections first)
      4. Calls setup_dev_db.ps1 to recreate and seed the database

    Connects as the postgres superuser on localhost:5432.

.EXAMPLE
    .\reset_dev_db.ps1
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ── Paths ──────────────────────────────────────────────────────────────────────
$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$SetupScript = Join-Path $ScriptDir 'setup_dev_db.ps1'

# ── Config ─────────────────────────────────────────────────────────────────────
$PgHost = 'localhost'
$PgPort = '5432'
$PgUser = 'postgres'
$DbName = 'caro_dev'

# ── Helpers ────────────────────────────────────────────────────────────────────
function Write-Step { param([string]$Msg) Write-Host "`n==> $Msg" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Msg) Write-Host "    OK  $Msg" -ForegroundColor Green }
function Write-Skip { param([string]$Msg) Write-Host "    --  $Msg" -ForegroundColor Yellow }
function Write-Fail { param([string]$Msg) Write-Host "    ERR $Msg" -ForegroundColor Red }

# ── Verify setup script exists ─────────────────────────────────────────────────
if (-not (Test-Path $SetupScript)) {
    Write-Fail "setup_dev_db.ps1 not found at: $SetupScript"
    exit 1
}

# ── Verify psql ────────────────────────────────────────────────────────────────
if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
    Write-Fail 'psql not found on PATH. Install PostgreSQL client tools and retry.'
    exit 1
}

# ── Confirmation prompt ────────────────────────────────────────────────────────
Write-Host ''
Write-Host "  WARNING: This will DROP the '$DbName' database and all its data." `
    -ForegroundColor Yellow
Write-Host '  This cannot be undone.' -ForegroundColor Yellow
Write-Host ''
$Confirm = Read-Host "  Type 'yes' to continue"
if ($Confirm -ne 'yes') {
    Write-Host "`n  Aborted — no changes made.`n" -ForegroundColor Yellow
    exit 0
}

# ── Password prompt (once — forwarded to setup_dev_db.ps1) ────────────────────
Write-Step "Enter password for PostgreSQL user '$PgUser'"
$SecurePass = Read-Host -Prompt 'Password' -AsSecureString
$PlainPass  = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
                  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecurePass))

$BaseArgs = @('-h', $PgHost, '-p', $PgPort, '-U', $PgUser)

# ── Verify connectivity ────────────────────────────────────────────────────────
Write-Step 'Verifying PostgreSQL connection'

$env:PGPASSWORD = $PlainPass
$Exists = (& psql @BaseArgs -d postgres -tAc `
    "SELECT 1 FROM pg_database WHERE datname = '$DbName'" 2>&1)
$env:PGPASSWORD = ''

if ($LASTEXITCODE -ne 0) {
    Write-Fail 'Could not connect to PostgreSQL. Check host, port, user, and password.'
    exit 1
}
Write-Ok 'Connected'

# ── Drop database if it exists ─────────────────────────────────────────────────
Write-Step "Dropping database '$DbName'"

if ($Exists -match '1') {
    # Terminate all open connections before dropping so the DROP does not block
    $TerminateSql = @"
SELECT pg_terminate_backend(pid)
FROM   pg_stat_activity
WHERE  datname = '$DbName'
  AND  pid <> pg_backend_pid();
"@
    $env:PGPASSWORD = $PlainPass
    & psql @BaseArgs -d postgres -c $TerminateSql 2>&1 | Out-Null
    & psql @BaseArgs -d postgres -c "DROP DATABASE $DbName" 2>&1 | Out-Null
    $env:PGPASSWORD = ''

    if ($LASTEXITCODE -ne 0) {
        Write-Fail "Failed to drop database '$DbName'."
        exit 1
    }
    Write-Ok "Database '$DbName' dropped"
} else {
    Write-Skip "Database '$DbName' does not exist — nothing to drop"
}

# ── Delegate to setup_dev_db.ps1 (password forwarded — no second prompt) ──────
Write-Step 'Calling setup_dev_db.ps1'

& $SetupScript -Password $SecurePass

if ($LASTEXITCODE -ne 0) {
    Write-Fail 'setup_dev_db.ps1 reported a failure.'
    exit 1
}
