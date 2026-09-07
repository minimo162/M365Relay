# Build on Windows PowerShell 5.1+; no installed Node.js or npm is required.
[CmdletBinding()]
param([string]$NodeArchive, [string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version 2.0
$root = Split-Path -Parent $PSScriptRoot
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $root 'dist' }
$lock = Get-Content -LiteralPath (Join-Path $root 'config\node-runtime.lock.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$package = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($lock.version -cnotmatch '^22\.\d+\.\d+$' -or $lock.arch -cne 'x64' -or $lock.platform -cne 'win') { throw 'Unsupported runtime lock.' }
$prefix = "node-v$($lock.version)-win-x64"
if ($lock.archive -cne "$prefix.zip" -or $lock.url -cne "https://nodejs.org/dist/v$($lock.version)/$prefix.zip" -or $lock.sha256 -cnotmatch '^[0-9a-f]{64}$' -or $lock.executableSha256 -cnotmatch '^[0-9a-f]{64}$') { throw 'Invalid runtime lock.' }
if ($package.version -cnotmatch '^\d+\.\d+\.\d+$') { throw 'Invalid application version.' }
$revision = & git -C $root rev-parse HEAD
if ($LASTEXITCODE -ne 0 -or $revision -cnotmatch '^[0-9a-f]{40}$') { throw 'Build from a Git checkout.' }
$changes = & git -C $root status --porcelain --untracked-files=normal
if ($LASTEXITCODE -ne 0 -or $changes) { throw 'Commit all source changes before packaging. Untracked files outside ignored build directories are not permitted.' }
$null = New-Item -ItemType Directory -Force -Path $OutputDirectory
$OutputDirectory = (Resolve-Path -LiteralPath $OutputDirectory).Path
$work = Join-Path $OutputDirectory ('.build-' + [guid]::NewGuid().ToString('N'))
$null = New-Item -ItemType Directory -Path $work
try {
    if (-not $NodeArchive) {
        $NodeArchive = Join-Path $work $lock.archive
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -UseBasicParsing -Uri $lock.url -OutFile $NodeArchive -TimeoutSec 180
    }
    if ((Get-FileHash -LiteralPath $NodeArchive -Algorithm SHA256).Hash.ToLowerInvariant() -cne $lock.sha256) { throw 'Node.js archive SHA-256 does not match the committed official checksum.' }
    $stage = Join-Path $work 'M365Relay'
    $runtime = Join-Path $stage 'runtime'
    $null = New-Item -ItemType Directory -Force -Path $runtime
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $NodeArchive).Path)
    try {
        foreach ($name in @('node.exe','LICENSE')) {
            $entries = @($archive.Entries | Where-Object { $_.FullName -ceq "$prefix/$name" })
            if ($entries.Count -ne 1 -or $entries[0].Length -le 0) { throw "Official archive missing or duplicating $name" }
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entries[0], (Join-Path $runtime $name), $false)
        }
    } finally { $archive.Dispose() }
    if ((Get-FileHash -LiteralPath (Join-Path $runtime 'node.exe') -Algorithm SHA256).Hash.ToLowerInvariant() -cne $lock.executableSha256) { throw 'Extracted Node.js checksum mismatch.' }
    $env:NODE_OPTIONS = $null; $env:NODE_PATH = $null
    $actualVersion = & (Join-Path $runtime 'node.exe') --version
    if ($LASTEXITCODE -ne 0 -or $actualVersion -cne "v$($lock.version)") { throw 'Bundled runtime version check failed.' }
    # Curated distribution: never copy local settings, tokens, profiles, logs or npm.
    foreach ($relative in @('src','prompts','config','README.md','THIRD_PARTY.md','Bridge.cmd','Setup.cmd','Open-Copilot.cmd','Start-Bridge.cmd','package.json')) {
        if ($relative -in @('src','prompts','config')) {
            $null = New-Item -ItemType Directory -Force -Path (Join-Path $stage $relative)
            $pattern = if ($relative -eq 'src') { '*.mjs' } elseif ($relative -eq 'prompts') { '*.md' } else { '*.example.json' }
            Get-ChildItem -LiteralPath (Join-Path $root $relative) -File -Filter $pattern | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $stage $relative) }
        } else { Copy-Item -LiteralPath (Join-Path $root $relative) -Destination (Join-Path $stage $relative) }
    }
    Copy-Item -LiteralPath (Join-Path $root 'config\node-runtime.lock.json') -Destination (Join-Path $stage 'config')
    $null = New-Item -ItemType Directory -Path (Join-Path $stage 'scripts')
    foreach ($name in @('Launch.ps1','Verify-Distribution.ps1')) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $stage 'scripts') }
    $null = New-Item -ItemType Directory -Path (Join-Path $stage 'docs')
    foreach ($name in @('acceptance.md','architecture.md','distribution.md','test-results.md','sources.md','schema-compatibility.md','input-compatibility.md','dom-compatibility.md','release-notes.md')) { Copy-Item -LiteralPath (Join-Path $root "docs\$name") -Destination (Join-Path $stage 'docs') }
    $files = @(Get-ChildItem -LiteralPath $stage -Recurse -File | Sort-Object FullName | ForEach-Object {
        [ordered]@{ path = $_.FullName.Substring($stage.Length + 1).Replace('\','/'); sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
    })
    $manifest = [ordered]@{ schemaVersion=1; product='M365Relay'; version=$package.version; nodeVersion=$lock.version; sourceRevision=$revision; nodeArchiveSha256=$lock.sha256; files=$files }
    [IO.File]::WriteAllText((Join-Path $stage 'release-manifest.json'), ($manifest | ConvertTo-Json -Depth 8) + "`n", (New-Object Text.UTF8Encoding($false)))
    & (Join-Path $stage 'scripts\Verify-Distribution.ps1') -DistributionPath $stage
    $zipName = "M365Relay-$($package.version)-win-x64-$($revision.Substring(0,12)).zip"
    $zipPath = Join-Path $OutputDirectory $zipName
    if (Test-Path -LiteralPath $zipPath) { throw 'Distribution ZIP already exists; use a new output directory.' }
    [IO.Compression.ZipFile]::CreateFromDirectory($stage, $zipPath, [IO.Compression.CompressionLevel]::Optimal, $false)
    $digest = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
    [IO.File]::WriteAllText("$zipPath.sha256", "$digest  $zipName`n", (New-Object Text.UTF8Encoding($false)))
    Write-Output $zipPath
} finally { if (Test-Path -LiteralPath $work) { Remove-Item -LiteralPath $work -Recurse -Force } }
