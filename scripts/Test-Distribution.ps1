# Run on a Windows runner, with the actual bundled node.exe and no Node on PATH.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$ZipPath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$temp = Join-Path ([IO.Path]::GetTempPath()) ('M365Relay test ' + [guid]::NewGuid().ToString('N'))
$oldPath=$env:PATH; $oldHome=$env:M365_RELAY_HOME; $oldOptions=$env:NODE_OPTIONS
$checks=0
try {
    $null = New-Item -ItemType Directory -Path $temp
    $app = Join-Path $temp 'App with spaces'
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
    & $bridge init
    if ($LASTEXITCODE -ne 0 -or (Get-Content -LiteralPath $tokenPath -Raw) -cne $before) { throw 'Repeated init changed the connection key.' }; $checks++
    # Deliberately remove the runtime. A global fallback must never succeed.
    $node = Join-Path $app 'runtime\node.exe'
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
    $stream=[IO.File]::Open($node,[IO.FileMode]::Open,[IO.FileAccess]::ReadWrite)
    try { $stream.Position=$stream.Length-1; $old=$stream.ReadByte(); $stream.Position=$stream.Length-1; $stream.WriteByte($old -bxor 1) } finally { $stream.Dispose() }
    & $bridge help
    if ($LASTEXITCODE -eq 0) { throw 'Corrupt runtime was accepted.' }; $checks++
    Write-Output "PASS: $checks Windows distribution checks (real bundled runtime, no PATH Node)."
    exit 0
} finally {
    $env:PATH=$oldPath; $env:M365_RELAY_HOME=$oldHome; $env:NODE_OPTIONS=$oldOptions
    if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Recurse -Force }
}
