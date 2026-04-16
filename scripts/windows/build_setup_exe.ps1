$ErrorActionPreference = 'Stop'

Write-Host 'Building setup_and_run.exe from setup_and_run.ps1...'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$inputScript = Join-Path $scriptDir 'setup_and_run.ps1'
$outputExe = Join-Path $scriptDir 'setup_and_run.exe'

if (-not (Test-Path $inputScript)) {
  throw "Missing input script: $inputScript"
}

if (-not (Get-Module -ListAvailable -Name ps2exe)) {
  Write-Host 'Installing PS2EXE module (CurrentUser scope)...'
  Install-Module -Name ps2exe -Scope CurrentUser -Force -AllowClobber
}

Import-Module ps2exe
Invoke-ps2exe -inputFile $inputScript -outputFile $outputExe -x64 -noConsole:$false

Write-Host "Done: $outputExe"
