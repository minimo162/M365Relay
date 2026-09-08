# Run on a Windows runner, with the actual bundled node.exe and no Node on PATH.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$ZipPath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$temp = Join-Path ([IO.Path]::GetTempPath()) ('M365Relay test ' + [guid]::NewGuid().ToString('N'))
$oldPath=$env:PATH; $oldHome=$env:M365_RELAY_HOME; $oldOptions=$env:NODE_OPTIONS
$checks=0
$gitExecutable = (Get-Command git -ErrorAction Stop).Source
try {
    $null = New-Item -ItemType Directory -Path $temp
    $app = Join-Path $temp 'App with spaces'
    $archiveCheck=[IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $ZipPath).Path)
    try { if (@($archiveCheck.Entries | Where-Object { $_.FullName.Contains('\') }).Count) { throw 'Distribution ZIP contains non-portable backslash paths.' } }
    finally { $archiveCheck.Dispose() }
    [IO.Compression.ZipFile]::ExtractToDirectory((Resolve-Path -LiteralPath $ZipPath).Path, $app)
    $env:PATH = "$env:SystemRoot\system32;$env:SystemRoot"
    $env:M365_RELAY_HOME = Join-Path $temp 'User state'
    $env:NODE_OPTIONS = '--definitely-invalid-inherited-option'
    $bridge = Join-Path $app 'Bridge.cmd'
    & $bridge help
    if ($LASTEXITCODE -ne 0) { throw 'Bundled help failed without PATH Node.' }; $checks++
    & $bridge init
    if ($LASTEXITCODE -ne 0) { throw 'Bundled init failed without PATH Node.' }; $checks++
    $tokenPath = Join-Path $env:M365_RELAY_HOME 'token.txt'
    $before = Get-Content -LiteralPath $tokenPath -Raw
    $settingsPath = Join-Path $env:M365_RELAY_HOME 'settings.json'
    $settings = Get-Content -LiteralPath $settingsPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $settings.port = 8742
    [IO.File]::WriteAllText($settingsPath, ($settings | ConvertTo-Json -Depth 8), (New-Object Text.UTF8Encoding($false)))
    $settingsBefore = (Get-FileHash -LiteralPath $settingsPath -Algorithm SHA256).Hash
    & $bridge init
    if ($LASTEXITCODE -ne 0 -or (Get-Content -LiteralPath $tokenPath -Raw) -cne $before) { throw 'Repeated init changed the connection key.' }; $checks++
    if ((Get-FileHash -LiteralPath $settingsPath -Algorithm SHA256).Hash -cne $settingsBefore) { throw 'Repeated init changed existing settings.' }; $checks++
    $manifest = Get-Content -LiteralPath (Join-Path $app 'release-manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $package = Get-Content -LiteralPath (Join-Path $app 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $revision = & $gitExecutable -C (Split-Path -Parent $PSScriptRoot) rev-parse HEAD
    if ($LASTEXITCODE -ne 0 -or $manifest.sourceRevision -cne $revision -or $manifest.version -cne $package.version) { throw 'Distribution provenance/version mismatch.' }
    if ([IO.Path]::GetFileName($ZipPath) -cne "M365Relay-$($package.version)-win-x64-$($revision.Substring(0,12)).zip") { throw 'Distribution filename mismatch.' }
    foreach ($doc in @('schema-compatibility.md','input-compatibility.md','release-notes.md','test-results.md','sources.md')) {
        if (-not (Test-Path -LiteralPath (Join-Path $app "docs\$doc"))) { throw "Distribution document missing: $doc" }
    }; $checks++
    # Exercise native document runtimes with the actual bundled Node, no PATH Node.
    $env:NODE_OPTIONS=$null
    & (Join-Path $app 'runtime\node.exe') (Join-Path $PSScriptRoot 'verify-document-runtime.mjs') $app $temp
    if ($LASTEXITCODE -ne 0) { throw 'Bundled document runtime verification failed.' }; $checks++
    $python = Join-Path $app 'runtime\python\python.exe'
    Move-Item -LiteralPath $python -Destination "$python.saved"
    & $bridge help
    if ($LASTEXITCODE -eq 0) { throw 'Missing bundled Python was accepted.' }; $checks++
    Move-Item -LiteralPath "$python.saved" -Destination $python
    $env:NODE_OPTIONS='--definitely-invalid-inherited-option'
    # Deliberately remove the runtime. A global fallback must never succeed.
    $node = Join-Path $app 'runtime\node.exe'
    if (-not ([IO.Path]::GetFullPath($node)).StartsWith(([IO.Path]::GetFullPath($temp) + [IO.Path]::DirectorySeparatorChar), [StringComparison]::OrdinalIgnoreCase)) { throw 'Runtime fixture is outside the test directory.' }
    Move-Item -LiteralPath $node -Destination "$node.saved"
    & $bridge help
    if ($LASTEXITCODE -eq 0) { throw 'Missing bundled runtime was accepted.' }; $checks++
    Move-Item -LiteralPath "$node.saved" -Destination $node
    # Deliberately corrupt code and runtime; integrity verification must fail closed.
    $cli = Join-Path $app 'src\cli.mjs'; $original=[IO.File]::ReadAllBytes($cli)
    [IO.File]::AppendAllText($cli, '// corrupted')
    & $bridge help
    if ($LASTEXITCODE -eq 0) { throw 'Corrupt application was accepted.' }; $checks++
    [IO.File]::WriteAllBytes($cli, $original)
    # A just-executed PE image can remain locked by Windows/scanners. Build a separate
    # fixture with a nonempty invalid runtime instead of editing that running image.
    # All other files and the original manifest remain byte-identical.
    $badApp = Join-Path $temp 'Corrupt runtime fixture'
    [IO.Compression.ZipFile]::ExtractToDirectory($ZipPath, $badApp)
    & (Join-Path $badApp 'scripts\Verify-Distribution.ps1') -DistributionPath $badApp
    $badRuntime = Join-Path $badApp 'runtime'
    [IO.File]::WriteAllBytes((Join-Path $badRuntime 'node.exe'), [byte[]]@(0x4d,0x5a,0x00))
    & (Join-Path $badApp 'Bridge.cmd') help
    if ($LASTEXITCODE -eq 0) { throw 'Corrupt runtime was accepted.' }; $checks++
    Write-Output "PASS: $checks Windows distribution checks (real bundled runtime, no PATH Node)."
    exit 0
} finally {
    $env:PATH=$oldPath; $env:M365_RELAY_HOME=$oldHome; $env:NODE_OPTIONS=$oldOptions
    if (Test-Path -LiteralPath $temp) {
        $resolvedTemp = [IO.Path]::GetFullPath($temp)
        if ([IO.Path]::GetDirectoryName($resolvedTemp) -ne ([IO.Path]::GetFullPath([IO.Path]::GetTempPath())).TrimEnd([IO.Path]::DirectorySeparatorChar) -or [IO.Path]::GetFileName($resolvedTemp) -cnotmatch '^M365Relay test [0-9a-f]{32}$') { throw 'Refusing cleanup outside the temporary test directory.' }
        Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
    }
}
