# Integrity checks detect missing/mixed/corrupt files, not a malicious publisher.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$DistributionPath)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path -LiteralPath $DistributionPath).Path
$manifestPath = Join-Path $root 'release-manifest.json'
if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) { throw 'release-manifest.json is missing. Obtain a complete distribution ZIP.' }
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$lock = Get-Content -LiteralPath (Join-Path $root 'config\node-runtime.lock.json') -Raw -Encoding UTF8 | ConvertFrom-Json
$package = Get-Content -LiteralPath (Join-Path $root 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ($manifest.schemaVersion -ne 1 -or $manifest.product -cne 'M365Relay' -or $manifest.version -cne $package.version -or $manifest.nodeVersion -cne $lock.version -or $manifest.sourceRevision -cnotmatch '^[0-9a-f]{40}$') { throw 'Distribution identity mismatch.' }
$files = @($manifest.files)
if ($files.Count -lt 1) { throw 'Empty distribution manifest.' }
$seen = @{}
foreach ($entry in $files) {
    $relative = [string]$entry.path
    if ($relative -cnotmatch '^[A-Za-z0-9@_.\-/]+$' -or $relative.StartsWith('/') -or @($relative.Split('/') | Where-Object { $_ -eq '..' -or $_ -eq '.' -or $_ -eq '' }).Count -gt 0 -or $seen.ContainsKey($relative)) { throw 'Invalid or duplicate manifest path.' }
    $seen[$relative] = $true
    if ([string]$entry.sha256 -cnotmatch '^[0-9a-f]{64}$') { throw 'Invalid manifest hash.' }
    $path = Join-Path $root $relative
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing distribution file: $relative" }
    $item = Get-Item -LiteralPath $path
    if (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Linked distribution files are not supported.' }
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -cne $entry.sha256) { throw "Distribution hash mismatch: $relative" }
}
foreach ($required in @('runtime/node.exe','runtime/LICENSE','src/cli.mjs','src/desktop.mjs','src/run-log.mjs','src/model-selection.mjs','config/node-runtime.lock.json','prompts/m365-tool-router.md','scripts/Launch.ps1','scripts/Verify-Distribution.ps1','Bridge.cmd','Run.cmd','Setup.cmd','Recover.cmd')) {
    if (-not $seen.ContainsKey($required)) { throw "Required manifest entry missing: $required" }
}
if ((Get-FileHash -LiteralPath (Join-Path $root 'runtime\node.exe') -Algorithm SHA256).Hash.ToLowerInvariant() -cne $lock.executableSha256) { throw 'Bundled Node.js does not match the official pinned executable.' }

foreach($requiredPython in @('src/pdf-cli.mjs','src/pdf-process.mjs','src/pdf-output.mjs','python/document_runtime.py','python/Office-Native.ps1','config/python-runtime.lock.json','runtime/python/python.exe','runtime/python/python313.dll','runtime/python/python313.zip','runtime/python/python313._pth','runtime/python/LICENSE.txt')) {
    if(-not $seen.ContainsKey($requiredPython)){throw "Python runtime manifest entry missing: $requiredPython"}
}
$pythonLock=Get-Content -Raw -Encoding UTF8 (Join-Path $root 'config/python-runtime.lock.json') | ConvertFrom-Json
if((Get-FileHash (Join-Path $root 'runtime/python/python.exe')).Hash.ToLowerInvariant() -cne $pythonLock.executableSha256){throw 'Bundled Python does not match the pinned executable'}
