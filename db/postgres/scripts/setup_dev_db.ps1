#Requires -Version 5.1
<#
.SYNOPSIS
    Creates the caro_dev PostgreSQL database and applies all migrations and seed data.

.DESCRIPTION
    1. Creates the caro_dev database (skips if it already exists)
    2. Runs migrations in order:
         001_create_tag_registry.sql
         002_create_registry_revisions.sql
    3. Runs dev_seed.sql

    Connects as the postgres superuser on localhost:5432.
    Prompts for the postgres password when -Password is not supplied.
    reset_dev_db.ps1 passes -Password directly so the user is prompted only once.

.PARAMETER Password
    Optional. The postgres superuser password as a SecureString.
    When omitted the script prompts interactively.

.EXAMPLE
    .\setup_dev_db.ps1

.EXAMPLE
    # Called internally by reset_dev_db.ps1 - password forwarded, no second prompt
    .\setup_dev_db.ps1 -Password $securePass
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $false)]
    [System.Security.SecureString]$Password
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
$ScriptDir     = Split-Path -Parent $MyInvocation.MyCommand.Path
$PostgresDir   = Split-Path -Parent $ScriptDir
$MigrationsDir = Join-Path $PostgresDir 'migrations'
$SeedsDir      = Join-Path $PostgresDir 'seeds'

$Migrations = @(
    Join-Path $MigrationsDir '001_create_tag_registry.sql'
    Join-Path $MigrationsDir '002_create_registry_revisions.sql'
)
$SeedFile = Join-Path $SeedsDir 'dev_seed.sql'

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
$PgHost = 'localhost'
$PgPort = '5432'
$PgUser = 'postgres'
$DbName = 'caro_dev'

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
function Write-Step { param([string]$Msg) Write-Host "`n==> $Msg" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Msg) Write-Host "    OK  $Msg" -ForegroundColor Green }
function Write-Skip { param([string]$Msg) Write-Host "    --  $Msg" -ForegroundColor Yellow }
function Write-Fail { param([string]$Msg) Write-Host "    ERR $Msg" -ForegroundColor Red }

function Invoke-Psql {
    param(
        [string[]]$Arguments,
        [string]  $Description
    )
    $env:PGPASSWORD = $PlainPassword
    try {
        & psql @Arguments 2>&1 | ForEach-Object { Write-Verbose $_ }
        if ($LASTEXITCODE -ne 0) {
            throw "psql exited with code $LASTEXITCODE while running: $Description"
        }
    }
    finally {
        $env:PGPASSWORD = ''
    }
}

# ---------------------------------------------------------------------------
# Verify psql is on PATH
# ---------------------------------------------------------------------------
Write-Step 'Checking for psql'
if (-not (Get-Command psql -ErrorAction SilentlyContinue)) {
    Write-Fail 'psql not found on PATH. Install PostgreSQL client tools and retry.'
    exit 1
}
Write-Ok 'psql found'

# ---------------------------------------------------------------------------
# Resolve password
# ---------------------------------------------------------------------------
if (-not $Password) {
    Write-Step "Enter password for PostgreSQL user '$PgUser'"
    $Password = Read-Host -Prompt 'Password' -AsSecureString
}

$PlainPassword = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
                     [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Password))

# ---------------------------------------------------------------------------
# Base psql args
# ---------------------------------------------------------------------------
$BaseArgs = @('-h', $PgHost, '-p', $PgPort, '-U', $PgUser)

# ---------------------------------------------------------------------------
# Step 1 - Create database if it does not exist
# ---------------------------------------------------------------------------
Write-Step "Creating database '$DbName' (if not exists)"

$env:PGPASSWORD = $PlainPassword
$Exists = (& psql @BaseArgs -d postgres -tAc `
    "SELECT 1 FROM pg_database WHERE datname = '$DbName'" 2>&1)
$env:PGPASSWORD = ''

if ($LASTEXITCODE -ne 0) {
    Write-Fail 'Could not connect to PostgreSQL. Check host, port, user, and password.'
    exit 1
}

if ($Exists -match '1') {
    Write-Skip "Database '$DbName' already exists - skipping CREATE"
} else {
    Invoke-Psql -Arguments (@($BaseArgs) + @('-d', 'postgres', '-c', "CREATE DATABASE $DbName")) `
                -Description "CREATE DATABASE $DbName"
    Write-Ok "Database '$DbName' created"
}

# Args for subsequent steps target caro_dev directly
$DbArgs = @('-h', $PgHost, '-p', $PgPort, '-U', $PgUser, '-d', $DbName)

# ---------------------------------------------------------------------------
# Step 2 - Run migrations
# ---------------------------------------------------------------------------
Write-Step 'Running migrations'

foreach ($File in $Migrations) {
    $Name = Split-Path -Leaf $File
    if (-not (Test-Path $File)) {
        Write-Fail "Migration file not found: $File"
        exit 1
    }
    Invoke-Psql -Arguments (@($DbArgs) + @('-f', $File)) -Description $Name
    Write-Ok $Name
}

# ---------------------------------------------------------------------------
# Step 3 - Run seed
# ---------------------------------------------------------------------------
Write-Step 'Running dev seed'

if (-not (Test-Path $SeedFile)) {
    Write-Fail "Seed file not found: $SeedFile"
    exit 1
}
Invoke-Psql -Arguments (@($DbArgs) + @('-f', $SeedFile)) -Description 'dev_seed.sql'
Write-Ok 'dev_seed.sql'

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
Write-Host "`n==> Setup complete. Database '$DbName' is ready on ${PgHost}:${PgPort}.`n" `
    -ForegroundColor Green
