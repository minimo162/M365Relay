#Requires -Version 5.1
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$ZipPath, [Parameter(Mandatory=$true)][string]$OutputDirectory, [string]$Source)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$ZipPath = (Resolve-Path -LiteralPath $ZipPath).Path
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead($ZipPath)
try {
    $entries = @($zip.Entries | Where-Object FullName -CEQ 'release-manifest.json')
    if ($entries.Count -ne 1) { throw 'Expected one release manifest.' }
    $reader = New-Object IO.StreamReader($entries[0].Open())
    try { $manifestText = $reader.ReadToEnd(); $manifest = $manifestText | ConvertFrom-Json } finally { $reader.Dispose() }
} finally { $zip.Dispose() }
if ($manifest.product -cne 'M365Relay' -or $manifest.sourceRevision -cnotmatch '^[0-9a-f]{40}$' -or $manifest.version -cnotmatch '^\d+\.\d+\.\d+$') { throw 'Invalid release identity.' }
$name = "M365Relay-$($manifest.version)-win-x64-$($manifest.sourceRevision.Substring(0,12)).zip"
if ([IO.Path]::GetFileName($ZipPath) -cne $name) { throw 'Archive filename mismatch.' }
$channelDir = Join-Path $OutputDirectory '_updates'; $launcherDir = Join-Path $OutputDirectory '_launcher'
New-Item -ItemType Directory -Force -Path $channelDir,$launcherDir | Out-Null
$archiveTarget = Join-Path $channelDir $name
$archiveHash = (Get-FileHash -LiteralPath $ZipPath -Algorithm SHA256).Hash.ToLowerInvariant()
if (Test-Path -LiteralPath $archiveTarget) {
    if ((Get-FileHash -LiteralPath $archiveTarget -Algorithm SHA256).Hash.ToLowerInvariant() -cne $archiveHash) { throw 'A different archive already uses this release identity.' }
} else {
    $archiveTemp = Join-Path $channelDir ('archive-' + [guid]::NewGuid().ToString('N') + '.tmp')
    Copy-Item -LiteralPath $ZipPath -Destination $archiveTemp
    if ((Get-FileHash -LiteralPath $archiveTemp -Algorithm SHA256).Hash.ToLowerInvariant() -cne $archiveHash) { throw 'Archive copy checksum mismatch.' }
    [IO.File]::Move($archiveTemp,$archiveTarget)
}
Copy-Item -LiteralPath (Join-Path $root 'launcher\M365Relay.cmd') -Destination $OutputDirectory
Copy-Item -LiteralPath (Join-Path $root 'launcher\Update.ps1') -Destination $launcherDir
$utf8 = New-Object Text.UTF8Encoding($false)
if (-not $Source) {
    $priorSource = Join-Path $launcherDir 'source.txt'
    $Source = if (Test-Path -LiteralPath $priorSource) { (Get-Content -LiteralPath $priorSource -Raw -Encoding UTF8).Trim() } else { '..\_updates\update.json' }
}
[IO.File]::WriteAllText((Join-Path $launcherDir 'source.txt'), $Source, $utf8)
$sha = [Security.Cryptography.SHA256]::Create()
try { $manifestHash = ([BitConverter]::ToString($sha.ComputeHash($utf8.GetBytes($manifestText)))).Replace('-','').ToLowerInvariant() } finally { $sha.Dispose() }
$channel = [ordered]@{schemaVersion=1;product='M365Relay';version=$manifest.version;revision=$manifest.sourceRevision;archive=$name;sha256=(Get-FileHash -LiteralPath $ZipPath -Algorithm SHA256).Hash.ToLowerInvariant();manifestSha256=$manifestHash}
$next = Join-Path $channelDir ('update-' + [guid]::NewGuid().ToString('N') + '.tmp')
[IO.File]::WriteAllText($next, ($channel | ConvertTo-Json), $utf8)
$current = Join-Path $channelDir 'update.json'
if (Test-Path -LiteralPath $current) { [IO.File]::Replace($next,$current,(Join-Path $channelDir ('previous-' + [guid]::NewGuid().ToString('N') + '.json'))) } else { [IO.File]::Move($next,$current) }
Write-Output (Join-Path $OutputDirectory 'M365Relay.cmd')
