[CmdletBinding()]
param([ValidateSet('office-pdf','xlsx-recalculate','docx-create','pptx-create','cleanup')][string]$Operation,
      [string]$InputPath,[string]$OutputPath,[string]$StatePath)
$ErrorActionPreference='Stop'
if($Operation -eq 'cleanup') {
    if(Test-Path -LiteralPath $StatePath) {
        $state=Get-Content -Raw -Encoding UTF8 -LiteralPath $StatePath | ConvertFrom-Json
        $owned=Get-Process -Id $state.pid -ErrorAction SilentlyContinue
        if($owned -and $owned.ProcessName -in @('EXCEL','WINWORD','POWERPNT') -and
           $owned.StartTime.ToUniversalTime().Ticks.ToString() -ceq $state.started) {Stop-Process -InputObject $owned -Force}
    }
    exit 0
}
if(Test-Path -LiteralPath $OutputPath){throw 'Output exists'}
$ext=[IO.Path]::GetExtension($InputPath).ToLowerInvariant()
$kind=if($Operation -eq 'docx-create'){'word'}elseif($Operation -eq 'pptx-create'){'powerpoint'}elseif($ext -eq '.xlsx'){'excel'}elseif($ext -eq '.docx'){'word'}elseif($ext -eq '.pptx'){'powerpoint'}else{throw 'Only xlsx/docx/pptx inputs are supported'}
if($Operation -eq 'xlsx-recalculate' -and $kind -ne 'excel'){throw 'Recalculate requires xlsx'}
$processName=@{excel='EXCEL';word='WINWORD';powerpoint='POWERPNT'}[$kind]
$before=@(Get-Process -Name $processName -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Id)
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class RelayOfficeWindow { [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId); }'
$app=$null;$doc=$null;$owns=$false;$previousSecurity=$null
try {
    $app=New-Object -ComObject (@{excel='Excel.Application';word='Word.Application';powerpoint='PowerPoint.Application'}[$kind])
    $previousSecurity=$app.AutomationSecurity
    $app.AutomationSecurity=3
    # Word exposes HWND on a Window, not on Application. Create only our own
    # blank document to obtain it before opening any input document.
    if($kind -eq 'word'){$doc=$app.Documents.Add();$handle=$doc.ActiveWindow.Hwnd}else{$handle=$app.Hwnd}
    [uint32]$officePid=0
    [void][RelayOfficeWindow]::GetWindowThreadProcessId([IntPtr]$handle,[ref]$officePid)
    if(-not $officePid -or $officePid -in $before){throw 'Office reused an existing application. Close that application before retrying; existing documents were not changed.'}
    $owns=$true;$process=Get-Process -Id $officePid
    @{pid=$officePid;started=$process.StartTime.ToUniversalTime().Ticks.ToString()} | ConvertTo-Json | Set-Content -LiteralPath $StatePath -Encoding UTF8
    if($kind -eq 'excel') {
        $app.Visible=$false;$app.DisplayAlerts=$false;$app.EnableEvents=$false
        $doc=$app.Workbooks.Open($InputPath,0,$true)
        $app.CalculateFullRebuild()
        if($Operation -eq 'xlsx-recalculate'){$doc.SaveAs($OutputPath,51)}else{$doc.ExportAsFixedFormat(0,$OutputPath)}
    } elseif($kind -eq 'word') {
        $app.Visible=$false;$app.DisplayAlerts=0
        if($Operation -eq 'docx-create') {
            $data=Get-Content -Raw -Encoding UTF8 -LiteralPath $InputPath | ConvertFrom-Json
            $doc.Content.Text=(@($data.paragraphs) -join "`r")
            $doc.SaveAs2($OutputPath,12)
        } else {
            $doc.Close($false);[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($doc);$doc=$null
            $doc=$app.Documents.Open($InputPath,$false,$true,$false)
            $doc.ExportAsFixedFormat($OutputPath,17)
        }
    } else {
        if($Operation -eq 'pptx-create') {
            $data=Get-Content -Raw -Encoding UTF8 -LiteralPath $InputPath | ConvertFrom-Json
            $doc=$app.Presentations.Add(0)
            foreach($item in $data.slides) {
                $slide=$doc.Slides.Add($doc.Slides.Count+1,2)
                $slide.Shapes.Title.TextFrame.TextRange.Text=[string]$item.title
                $slide.Shapes.Placeholders.Item(2).TextFrame.TextRange.Text=(@($item.paragraphs) -join "`r")
            }
            $doc.SaveAs($OutputPath,24)
        } else {
            $doc=$app.Presentations.Open($InputPath,-1,0,0)
            $doc.SaveAs($OutputPath,32)
        }
    }
} finally {
    if($doc){try{if($kind -eq 'powerpoint'){$doc.Close()}else{$doc.Close($false)}}catch{};[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($doc)}
    if($app){if($owns){try{$app.Quit()}catch{}}elseif($null -ne $previousSecurity){try{$app.AutomationSecurity=$previousSecurity}catch{}};[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($app)}
}
