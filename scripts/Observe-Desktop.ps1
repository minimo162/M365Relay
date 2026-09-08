param([Parameter(Mandatory=$true)][int]$ProcessId,
      [Parameter(Mandatory=$true)][string]$ExpectedPath,
      [int]$TimeoutMilliseconds=35000)
$ErrorActionPreference='Stop'
$targetProcess=$null
try {
    $targetProcess=Get-Process -Id $ProcessId
    if ($targetProcess.HasExited) { exit 2 }
    if (-not [string]::Equals([IO.Path]::GetFullPath($targetProcess.Path),[IO.Path]::GetFullPath($ExpectedPath),[StringComparison]::OrdinalIgnoreCase)) { exit 4 }
    $watch=[Diagnostics.Stopwatch]::StartNew()
    while ($watch.ElapsedMilliseconds -lt $TimeoutMilliseconds) {
        $targetProcess.Refresh()
        if ($targetProcess.HasExited) { exit 2 }
        if ($targetProcess.MainWindowHandle -ne [IntPtr]::Zero) {
            [Console]::Out.Write('window_ready')
            exit 0
        }
        Start-Sleep -Milliseconds 100
    }
    exit 3
} catch { exit 4 }
finally { if ($targetProcess) { $targetProcess.Dispose() } }
