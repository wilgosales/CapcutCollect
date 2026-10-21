$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$editors = @(Get-CimInstance Win32_Process -Filter "Name='CapCut.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine -notmatch '--type=' })
if ($editors.Count -ne 1) { throw 'Open one CapCut instance and leave it on the home screen before starting Collect.' }
if (!(Test-Path -LiteralPath '.\node_modules\yazl')) { throw 'Missing dependencies. Run npm install in the workspace.' }
& node (Join-Path $PSScriptRoot 'src\cli.cjs') integrate --pid $editors[0].ProcessId
exit $LASTEXITCODE
