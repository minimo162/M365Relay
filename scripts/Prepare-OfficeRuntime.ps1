#Requires -Version 5.1
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Destination,[string]$SourceDirectory)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$root=Split-Path -Parent $PSScriptRoot
$contract=Get-Content -LiteralPath (Join-Path $root 'config\officecli-runtime.lock.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($contract.version -cnotmatch '^\d+\.\d+\.\d+$' -or $contract.platform -cne 'win' -or $contract.arch -cne 'x64') { throw 'Invalid OfficeCLI runtime contract.' }
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
foreach($file in $contract.files) {
    if ($file.name -cnotmatch '^[A-Za-z0-9.-]+$' -or $file.sha256 -cnotmatch '^[0-9a-f]{64}$') { throw 'Invalid OfficeCLI file contract.' }
    $target=Join-Path $Destination $file.name
    if ($SourceDirectory) { Copy-Item -LiteralPath (Join-Path $SourceDirectory $file.name) -Destination $target }
    else {
        [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -UseBasicParsing -Uri $file.url -OutFile $target -TimeoutSec 180
    }
    if ((Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -cne $file.sha256) { throw "OfficeCLI checksum mismatch: $($file.name)" }
}
$env:OFFICECLI_SKIP_UPDATE='1'; $env:OFFICECLI_NO_AUTO_RESIDENT='1'
$version=& (Join-Path $Destination 'officecli.exe') --version
if ($LASTEXITCODE -ne 0 -or $version.Trim() -cne $contract.version) { throw 'OfficeCLI executable version mismatch.' }
