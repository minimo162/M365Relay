# Manual Windows integration test: installed desktop PowerPoint required.
[CmdletBinding()]
param([Parameter(Mandatory=$true)][string]$PythonPath,[Parameter(Mandatory=$true)][string]$OutputDirectory)
$ErrorActionPreference='Stop'
if(Get-Process POWERPNT -ErrorAction SilentlyContinue){throw 'Close the test only: a pre-existing PowerPoint process is present; this test will not touch it.'}
$root=Split-Path -Parent $PSScriptRoot
$work=[IO.Path]::GetFullPath($OutputDirectory)
New-Item -ItemType Directory -Path $work -ErrorAction Stop | Out-Null
$inputFile=Join-Path $work 'request.json';$outputFile=Join-Path $work 'must-not-create.pptx';$original=Join-Path $work 'sentinel.pptx'
[IO.File]::WriteAllText($inputFile,'{"slides":[{"title":"New file","paragraphs":["Test"]}]}',[Text.UTF8Encoding]::new($false))
$app=$null;$deck=$null
try {
    $app=New-Object -ComObject PowerPoint.Application
    if($app.Presentations.Count -ne 0){throw 'Unexpected presentation exists; refuse to alter it.'}
    $deck=$app.Presentations.Add(0)
    $slide=$deck.Slides.Add(1,2)
    $slide.Shapes.Title.TextFrame.TextRange.Text='Preserved deck'
    $deck.SaveAs($original,24)
    $security=$app.AutomationSecurity
    $hash=(Get-FileHash -LiteralPath $original).Hash
    & $PythonPath -I -B (Join-Path $root 'python/document_runtime.py') pptx-create $inputFile $outputFile
    if($LASTEXITCODE -eq 0){throw 'Helper unexpectedly reused the existing application'}
    if(Test-Path -LiteralPath $outputFile){throw 'Rejected operation published output'}
    if($app.Presentations.Count -ne 1 -or $deck.Slides.Count -ne 1){throw 'Existing presentation was closed or modified'}
    if($deck.Slides.Item(1).Shapes.Title.TextFrame.TextRange.Text -cne 'Preserved deck'){throw 'Existing content changed'}
    if($app.AutomationSecurity -ne $security){throw 'Application setting changed'}
    if((Get-FileHash -LiteralPath $original).Hash -cne $hash){throw 'Existing file changed'}
    'PASS existing PowerPoint process, presentation, settings and file preserved'
} finally {
    if($deck){try{$deck.Close()}catch{};[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($deck)}
    if($app){if($deck -and $app.Presentations.Count -eq 0){try{$app.Quit()}catch{}};[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($app)}
}
