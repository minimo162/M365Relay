#Requires -Version 5.1
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$FirstZip,[string]$SecondZip)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$trial = Join-Path $root ('.local\updater-test-' + [guid]::NewGuid().ToString('N'))
$share = Join-Path $trial 'Share with spaces'; $userRoot = Join-Path $trial 'Local user'
$source = Join-Path $share '_updates\update.json'; $count=0
New-Item -ItemType Directory -Force -Path $userRoot | Out-Null
if (-not $SecondZip) {
    # A changed release identity fixture, not a separately published release.
    $fixture = Join-Path $trial 'second-release-fixture'
    Expand-Archive -LiteralPath $FirstZip -DestinationPath $fixture
    $manifestFile = Join-Path $fixture 'release-manifest.json'
    $fixtureManifest = Get-Content $manifestFile -Raw -Encoding UTF8 | ConvertFrom-Json
    $fixtureManifest.sourceRevision = 'f' * 40
    [IO.File]::WriteAllText($manifestFile, ($fixtureManifest | ConvertTo-Json -Depth 12), (New-Object Text.UTF8Encoding($false)))
    $SecondZip = Join-Path $trial ("M365Relay-$($fixtureManifest.version)-win-x64-ffffffffffff.zip")
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $fixtureZip=[IO.Compression.ZipFile]::Open($SecondZip,[IO.Compression.ZipArchiveMode]::Create)
    try {
        Get-ChildItem -LiteralPath $fixture -Recurse -File -Force | ForEach-Object {
            $name=$_.FullName.Substring($fixture.Length+1).Replace('\','/')
            $null=[IO.Compression.ZipFileExtensions]::CreateEntryFromFile($fixtureZip,$_.FullName,$name)
        }
    } finally { $fixtureZip.Dispose() }
}
[IO.File]::WriteAllText((Join-Path $userRoot 'user-work.txt'),'keep user work')
$userHash=(Get-FileHash (Join-Path $userRoot 'user-work.txt')).Hash
function Run-Update([int]$Expected=0) {
    & "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File (Join-Path $root 'launcher\Update.ps1') -Source $source -LocalRoot $userRoot -SyncOnly
    if ($LASTEXITCODE -ne $Expected) { throw "Unexpected updater exit: $LASTEXITCODE" }
}
Run-Update 1; $count++
& (Join-Path $PSScriptRoot 'New-UpdateChannel.ps1') -ZipPath $FirstZip -OutputDirectory $share
Run-Update; $count++
$currentPath=Join-Path $userRoot 'app\current.json'
$first=Get-Content $currentPath -Raw | ConvertFrom-Json
$firstBytes=[IO.File]::ReadAllText($currentPath)
Run-Update
if ([IO.File]::ReadAllText($currentPath) -cne $firstBytes) { throw 'Unchanged update rewrote pointer.' }; $count++
& (Join-Path $PSScriptRoot 'New-UpdateChannel.ps1') -ZipPath $SecondZip -OutputDirectory $share
Run-Update
$second=Get-Content $currentPath -Raw | ConvertFrom-Json
if ($first.revision -eq $second.revision) { throw 'Update did not activate a new revision.' }; $count++
$secondBytes=[IO.File]::ReadAllText($currentPath)
$metadata=[IO.File]::ReadAllText($source)
# A checksum-valid archive must still not escape its extraction directory.
$channel=$metadata | ConvertFrom-Json
$archivePath=Join-Path (Split-Path -Parent $source) $channel.archive
$unsafeZip=Join-Path $trial 'unsafe.zip'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$unsafe=[IO.Compression.ZipFile]::Open($unsafeZip,[IO.Compression.ZipArchiveMode]::Create)
try { $writer=New-Object IO.StreamWriter(($unsafe.CreateEntry('../outside.txt')).Open()); try { $writer.Write('unsafe') } finally { $writer.Dispose() } } finally { $unsafe.Dispose() }
Copy-Item -LiteralPath $archivePath -Destination ($archivePath+'.saved')
Copy-Item -LiteralPath $unsafeZip -Destination $archivePath -Force
$channel.sha256=(Get-FileHash $unsafeZip).Hash.ToLowerInvariant()
$channel | ConvertTo-Json | Set-Content -LiteralPath $source -Encoding UTF8
Run-Update
if ([IO.File]::ReadAllText($currentPath) -cne $secondBytes -or (Get-ChildItem -LiteralPath $trial -Recurse -Filter outside.txt)) { throw 'Unsafe archive escaped or activated.' }; $count++
Copy-Item -LiteralPath ($archivePath+'.saved') -Destination $archivePath -Force
# Simulate a corrupt release with a different digest so it cannot hit cache.
$bad=$metadata | ConvertFrom-Json; $bad.sha256='0'*64
$bad | ConvertTo-Json | Set-Content -LiteralPath $source -Encoding UTF8
Run-Update
if ([IO.File]::ReadAllText($currentPath) -cne $secondBytes) { throw 'Failed update changed current.' }; $count++
[IO.File]::WriteAllText($source,'invalid json')
Run-Update; $count++
$held=[IO.File]::Open((Join-Path $userRoot 'app\update.lock'),[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite,[IO.FileShare]::None)
try { Run-Update 1 } finally { $held.Dispose() }; $count++
# With update source unavailable, corrupt cached code must not execute.
$installed=Join-Path $userRoot ('app\versions\'+$second.revision+'-'+$second.sha256.Substring(0,12))
[IO.File]::AppendAllText((Join-Path $installed 'src\cli.mjs'),'corruption')
Run-Update 1; $count++
if ((Get-FileHash (Join-Path $userRoot 'user-work.txt')).Hash -cne $userHash) { throw 'User work changed.' }; $count++
Write-Output "PASS: $count updater scenarios. Evidence retained: $trial"
