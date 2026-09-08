#Requires -Version 5.1
[CmdletBinding()]
param([string]$Source, [string]$LocalRoot, [string]$Workspace, [switch]$SyncOnly, [ValidateSet('run','recover-lock')][string]$Action = 'run')
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Set-StrictMode -Version 2.0
$utf8 = New-Object Text.UTF8Encoding($false)

function Read-Json([string]$Path) {
    if ((Get-Item -LiteralPath $Path).Length -gt 4194304) { throw 'Metadata is too large.' }
    Get-Content -LiteralPath $Path -Raw -Encoding UTF8 | ConvertFrom-Json
}
function Get-ContentFile([string]$From, [string]$To, [int]$TimeoutSeconds) {
    if ($From -match '^https://') {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -UseBasicParsing -Uri $From -OutFile $To -TimeoutSec $TimeoutSeconds
    } elseif ($From -match '^\w+://') { throw 'Only HTTPS or a shared/local path is supported.' }
    else { Copy-Item -LiteralPath $From -Destination $To }
}
function Assert-Channel($Channel) {
    if ($Channel.schemaVersion -ne 1 -or $Channel.product -cne 'M365Relay' -or
        [string]$Channel.version -cnotmatch '^\d+\.\d+\.\d+$' -or
        [string]$Channel.revision -cnotmatch '^[0-9a-f]{40}$' -or
        [string]$Channel.sha256 -cnotmatch '^[0-9a-f]{64}$' -or
        [string]$Channel.manifestSha256 -cnotmatch '^[0-9a-f]{64}$' -or
        [string]$Channel.archive -cnotmatch '^M365Relay-[0-9.]+-win-x64-[0-9a-f]{12}\.zip$') { throw 'Invalid update metadata.' }
    $expected = "M365Relay-$($Channel.version)-win-x64-$($Channel.revision.Substring(0,12)).zip"
    if ($Channel.archive -cne $expected) { throw 'Update identity mismatch.' }
}
function Assert-LocalApp([string]$Directory, $Channel) {
    Assert-Channel $Channel
    # Verify cached code without executing any script from the cache first.
    $manifestPath = Join-Path $Directory 'release-manifest.json'
    if ((Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant() -cne $Channel.manifestSha256) { throw 'Local manifest checksum mismatch.' }
    $manifest = Read-Json $manifestPath
    if ($manifest.sourceRevision -cne $Channel.revision -or $manifest.version -cne $Channel.version) { throw 'Local application identity mismatch.' }
    $seen = @{}
    foreach ($entry in $manifest.files) {
        $relative = [string]$entry.path
        if ($relative -cnotmatch '^[A-Za-z0-9@_./-]+$' -or $relative.StartsWith('/') -or
            @($relative.Split('/') | Where-Object { $_ -eq '..' -or $_ -eq '.' -or $_ -eq '' }).Count -gt 0 -or $seen.ContainsKey($relative)) { throw 'Invalid local manifest path.' }
        $seen[$relative] = $true
        $file = Join-Path $Directory $relative
        $nativeFile = if ($file.StartsWith('\\')) { '\\?\UNC\' + $file.Substring(2) } else { '\\?\' + $file }
        if (([IO.File]::GetAttributes($nativeFile) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'Linked application file.' }
        $stream = [IO.File]::OpenRead($nativeFile)
        $hasher = [Security.Cryptography.SHA256]::Create()
        try { $digest = ([BitConverter]::ToString($hasher.ComputeHash($stream))).Replace('-','').ToLowerInvariant() }
        finally { $stream.Dispose(); $hasher.Dispose() }
        if ($digest -cne $entry.sha256) { throw 'Local application checksum mismatch.' }
    }
    foreach ($required in @('runtime/node.exe','src/cli.mjs','scripts/Launch.ps1','scripts/Verify-Distribution.ps1')) {
        if (-not $seen.ContainsKey($required)) { throw 'Required application file missing.' }
    }
}
function Expand-CheckedZip([string]$ZipPath, [string]$Destination) {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($ZipPath)
    try {
        $seen = @{}; [long]$total = 0
        if ($zip.Entries.Count -gt 5000) { throw 'Too many archive entries.' }
        foreach ($entry in $zip.Entries) {
            $name = $entry.FullName
            if ($name -cnotmatch '^[A-Za-z0-9@_./-]+$' -or $name.StartsWith('/') -or
                @($name.TrimEnd('/').Split('/') | Where-Object { $_ -eq '..' -or $_ -eq '.' -or $_ -eq '' }).Count -gt 0 -or
                $seen.ContainsKey($name.ToLowerInvariant())) { throw 'Unsafe or duplicate archive path.' }
            $seen[$name.ToLowerInvariant()] = $true
            $total += $entry.Length
            if ($total -gt 536870912 -or (($entry.ExternalAttributes -shr 16) -band 61440) -eq 40960) { throw 'Unsafe archive entry.' }
        }
        foreach ($entry in $zip.Entries) {
            $target = [IO.Path]::GetFullPath((Join-Path $Destination $entry.FullName))
            if (-not $target.StartsWith($Destination.TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Archive path escaped staging.' }
            if ($entry.FullName.EndsWith('/')) { New-Item -ItemType Directory -Force -Path $target | Out-Null }
            else {
                New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($target)) | Out-Null
                # .NET Framework ZIP extraction uses legacy MAX_PATH unless the
                # already-normalized, scope-checked path uses extended syntax.
                $nativeTarget = if ($target.StartsWith('\\')) { '\\?\UNC\' + $target.Substring(2) } else { '\\?\' + $target }
                [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $nativeTarget, $false)
            }
        }
    } finally { $zip.Dispose() }
}

$guard = $null; $attempt = $null
try {
    if (-not $LocalRoot) {
        $LocalRoot = if ($env:M365_RELAY_HOME) { $env:M365_RELAY_HOME } elseif ($env:M365_BRIDGE_HOME) { $env:M365_BRIDGE_HOME } else { Join-Path $env:LOCALAPPDATA 'M365Relay' }
    }
    $LocalRoot = [IO.Path]::GetFullPath($LocalRoot)
    $apps = Join-Path $LocalRoot 'app'; $versions = Join-Path $apps 'versions'
    New-Item -ItemType Directory -Force -Path $versions | Out-Null
    $currentFile = Join-Path $apps 'current.json'
    try { $guard = [IO.File]::Open((Join-Path $apps 'update.lock'), [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None) }
    catch { throw '別の起動処理が更新を確認しています。少し待ってから開き直してください。' }
    $current = $null; $selected = $null
    if (Test-Path -LiteralPath $currentFile) {
        $current = Read-Json $currentFile
        Assert-Channel $current
    }
    try {
        if (-not $Source) {
            $Source = (Get-Content -LiteralPath (Join-Path $PSScriptRoot 'source.txt') -Raw -Encoding UTF8).Trim()
            if ($Source -notmatch '^\w+://' -and -not [IO.Path]::IsPathRooted($Source)) { $Source = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot $Source)) }
        }
        if (-not $Source) { throw 'Update source is missing.' }
        Write-Host 'M365Relayの更新を確認しています。'
        $attempt = Join-Path $apps ('download-' + [guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $attempt | Out-Null
        $metadata = Join-Path $attempt 'update.json'
        Get-ContentFile $Source $metadata 10
        $channel = Read-Json $metadata; Assert-Channel $channel
        $id = $channel.revision + '-' + $channel.sha256.Substring(0,12)
        $destination = Join-Path $versions $id
        if (-not (Test-Path -LiteralPath $destination)) {
            Write-Host ('本体を取得しています: ' + $channel.version)
            $archiveSource = if ($Source -match '^https://') { (New-Object Uri((New-Object Uri($Source)), [string]$channel.archive)).AbsoluteUri } else { Join-Path (Split-Path -Parent $Source) $channel.archive }
            $archive = Join-Path $attempt 'app.zip'
            Get-ContentFile $archiveSource $archive 180
            if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() -cne $channel.sha256) { throw 'Downloaded archive checksum mismatch.' }
            $stage = Join-Path $attempt 'unpacked'; New-Item -ItemType Directory -Path $stage | Out-Null
            Expand-CheckedZip $archive $stage
            Assert-LocalApp $stage $channel
            # Only a validated staging directory is moved, within this cache root.
            if ([IO.Path]::GetDirectoryName($stage) -ne $attempt -or [IO.Path]::GetDirectoryName($destination) -ne $versions) { throw 'Invalid promotion path.' }
            Move-Item -LiteralPath $stage -Destination $destination
        }
        Assert-LocalApp $destination $channel
        if (-not $current -or $current.sha256 -cne $channel.sha256 -or $current.revision -cne $channel.revision) {
            $next = Join-Path $apps ('current-' + [guid]::NewGuid().ToString('N') + '.tmp')
            [IO.File]::WriteAllText($next, ($channel | ConvertTo-Json -Depth 5), $utf8)
            if (Test-Path -LiteralPath $currentFile) { [IO.File]::Replace($next, $currentFile, (Join-Path $apps ('previous-' + [guid]::NewGuid().ToString('N') + '.json'))) }
            else { [IO.File]::Move($next, $currentFile) }
        }
        $selected = $destination
    } catch {
        if (-not $current) { throw }
        $selected = Join-Path $versions ($current.revision + '-' + $current.sha256.Substring(0,12))
        Assert-LocalApp $selected $current
        Write-Host '更新を取得できなかったため、検証済みの前回版を使用します。'
        Write-Warning $_.Exception.Message
    }
    $guard.Dispose(); $guard = $null
    if ($SyncOnly) { Write-Output $selected; exit 0 }
    $env:M365_RELAY_HOME = $LocalRoot
    $env:NODE_OPTIONS = $null; $env:NODE_PATH = $null
    if ($Action -eq 'recover-lock') { Write-Host '停止済みプロセスの起動ロックを確認します。' } else { Write-Host 'ローカルのM365Relayを起動します。' }
    & (Join-Path $selected 'scripts\Launch.ps1') -Action $Action -Workspace $Workspace
    exit $LASTEXITCODE
} catch {
    [Console]::Error.WriteLine('M365Relayを起動できませんでした。配布元への接続を確認して、もう一度起動してください。')
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
} finally {
    if ($guard) { $guard.Dispose() }
    if ($attempt -and (Test-Path -LiteralPath $attempt)) {
        $cleanup = [IO.Path]::GetFullPath($attempt)
        if ([IO.Path]::GetDirectoryName($cleanup) -ne [IO.Path]::GetFullPath($apps) -or [IO.Path]::GetFileName($cleanup) -cnotmatch '^download-[0-9a-f]{32}$') { throw 'Invalid download cleanup path.' }
        try { Remove-Item -LiteralPath $cleanup -Recurse -Force } catch { Write-Warning '一時ダウンロードの削除を完了できませんでした。' }
    }
}
