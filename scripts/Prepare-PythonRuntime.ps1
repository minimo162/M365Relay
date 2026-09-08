# Build-time only. No pip, installer, registry or global Python changes.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Destination,[string]$CacheDirectory)
$ErrorActionPreference='Stop'
$root=Split-Path -Parent $PSScriptRoot
$lock=Get-Content -Raw -Encoding UTF8 (Join-Path $root 'config/python-runtime.lock.json') | ConvertFrom-Json
if(-not $CacheDirectory){$CacheDirectory=Join-Path $root '.cache/python-runtime'}
$CacheDirectory=[IO.Path]::GetFullPath($CacheDirectory)
$Destination=[IO.Path]::GetFullPath($Destination)
New-Item -ItemType Directory -Force -Path $CacheDirectory,$Destination | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
function Fetch-Pinned($file,$url,$sha) {
    if($file -cnotmatch '^[A-Za-z0-9_.-]+$' -or $sha -cnotmatch '^[0-9a-f]{64}$') {throw 'Invalid Python artifact lock'}
    $uri=[Uri]$url
    if($uri.Scheme -cne 'https' -or $uri.Host -notin @('www.python.org','files.pythonhosted.org') -or $uri.UserInfo) {throw 'Untrusted Python artifact URL'}
    $path=Join-Path $CacheDirectory $file
    if(-not (Test-Path -LiteralPath $path)) {
        $part=$path+'.download'
        [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $part -TimeoutSec 180
        if((Get-FileHash -LiteralPath $part).Hash.ToLowerInvariant() -cne $sha){throw 'Downloaded Python artifact checksum mismatch'}
        Move-Item -LiteralPath $part -Destination $path
    }
    if((Get-FileHash -LiteralPath $path).Hash.ToLowerInvariant() -cne $sha){throw 'Cached Python artifact checksum mismatch'}
    return $path
}
function Expand-Pinned($path,$target,$wheel) {
    $zip=[IO.Compression.ZipFile]::OpenRead($path)
    try {
        foreach($entry in $zip.Entries) {
            $name=$entry.FullName
            if($name.EndsWith('/')){continue}
            # Console scripts require an installer; the app uses library APIs.
            if($wheel -and $name -match '^[^/]+\.data/scripts/'){continue}
            if($name -match '\.data/' -or $name.Contains('\') -or $name -cnotmatch '^[A-Za-z0-9@_.\-/]+$'){throw 'Unsupported Python archive entry'}
            $dest=[IO.Path]::GetFullPath((Join-Path $target $name))
            if(-not $dest.StartsWith($target+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Python archive escaped its directory'}
            New-Item -ItemType Directory -Force -Path ([IO.Path]::GetDirectoryName($dest)) | Out-Null
            [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,$dest,$false)
        }
    }finally{$zip.Dispose()}
}
if($lock.version -cne '3.13.15' -or $lock.arch -cne 'x64' -or $lock.platform -cne 'win'){throw 'Unsupported Python runtime lock'}
Expand-Pinned (Fetch-Pinned $lock.archive $lock.url $lock.sha256) $Destination $false
if((Get-FileHash (Join-Path $Destination 'python.exe')).Hash.ToLowerInvariant() -cne $lock.executableSha256){throw 'Python executable mismatch'}
$site=Join-Path $Destination 'Lib/site-packages';New-Item -ItemType Directory -Force -Path $site | Out-Null
foreach($p in $lock.packages){Expand-Pinned (Fetch-Pinned $p.file $p.url $p.sha256) $site $true}
# Keep isolation: no site/user packages, registry paths or PYTHONPATH fallback.
[IO.File]::WriteAllText((Join-Path $Destination 'python313._pth'),"python313.zip`n.`nLib/site-packages`n",[Text.UTF8Encoding]::new($false))
& (Join-Path $Destination 'python.exe') -I -B -c 'import sys,openpyxl,pypdf,pypdfium2; assert sys.version_info[:3] == (3,13,15); print(sys.version)'
if($LASTEXITCODE -ne 0){throw 'Python document import check failed'}
