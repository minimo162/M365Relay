[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$Destination)
$ErrorActionPreference='Stop'
$source=Join-Path (Split-Path -Parent $PSScriptRoot) 'vscode-bootstrap'
$package=Get-Content -LiteralPath (Join-Path $source 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if($package.name -cne 'first-run-model-setup' -or $package.publisher -cne 'm365relay' -or $package.version -cnotmatch '^\d+\.\d+\.\d+$'){throw 'Invalid bootstrap identity'}
New-Item -ItemType Directory -Force -Path $Destination | Out-Null
foreach($name in @('package.json','extension.cjs')){Copy-Item -LiteralPath (Join-Path $source $name) -Destination $Destination}
$manifest='<?xml version="1.0" encoding="utf-8"?><PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsix-schema/2011"><Metadata><Identity Language="en-US" Id="first-run-model-setup" Version="'+$package.version+'" Publisher="m365relay"/><DisplayName>M365Relay First Run</DisplayName><Description xml:space="preserve">Initialize the isolated M365Relay profile once.</Description><Properties><Property Id="Microsoft.VisualStudio.Code.Engine" Value="^1.90.0"/></Properties></Metadata><Installation><InstallationTarget Id="Microsoft.VisualStudio.Code"/></Installation><Dependencies/><Assets><Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true"/></Assets></PackageManifest>'
$types='<?xml version="1.0" encoding="utf-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="json" ContentType="application/json"/><Default Extension="cjs" ContentType="application/javascript"/><Default Extension="vsixmanifest" ContentType="text/xml"/></Types>'
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$zip=[IO.Compression.ZipFile]::Open((Join-Path ([IO.Path]::GetFullPath($Destination)) 'first-run-model-setup.vsix'),[IO.Compression.ZipArchiveMode]::Create)
try {
    foreach($name in @('package.json','extension.cjs')){[IO.Compression.ZipFileExtensions]::CreateEntryFromFile($zip,(Join-Path $source $name),('extension/'+$name)) | Out-Null}
    foreach($entry in @(@('extension.vsixmanifest',$manifest),@('[Content_Types].xml',$types))){
        $writer=[IO.StreamWriter]::new($zip.CreateEntry($entry[0]).Open(),[Text.UTF8Encoding]::new($false))
        try{$writer.Write($entry[1])}finally{$writer.Dispose()}
    }
}finally{$zip.Dispose()}
