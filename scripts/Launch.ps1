# Windows PowerShell 5.1. Never use a PATH runtime or download at launch.
[CmdletBinding()]
param([ValidateSet('init','open','diagnose','serve','recover-lock','help')][string]$Action = 'help')
$ErrorActionPreference = 'Stop'
try {
    $root = Split-Path -Parent $PSScriptRoot
    & (Join-Path $PSScriptRoot 'Verify-Distribution.ps1') -DistributionPath $root
    $env:NODE_OPTIONS = $null
    $env:NODE_PATH = $null
    & (Join-Path $root 'runtime\node.exe') (Join-Path $root 'src\cli.mjs') $Action
    exit $LASTEXITCODE
} catch {
    [Console]::Error.WriteLine('M365Relay could not start. Use the complete Windows distribution ZIP, not GitHub Source code (zip).')
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
