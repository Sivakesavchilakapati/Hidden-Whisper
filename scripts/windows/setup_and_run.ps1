$ErrorActionPreference = 'Stop'

Write-Host '[Hidden Whisper] Windows setup starting...'

function Test-TorSocks {
  try {
    $r = Test-NetConnection -ComputerName 127.0.0.1 -Port 9050 -WarningAction SilentlyContinue
    return [bool]$r.TcpTestSucceeded
  } catch {
    return $false
  }
}

function Ensure-TorSocks {
  if (Test-TorSocks) {
    Write-Host 'Tor SOCKS already reachable on 127.0.0.1:9050'
    return
  }

  $candidates = @(
    "$env:ProgramData\chocolatey\lib\tor\tools\tor\tor.exe",
    "$env:ProgramFiles\Tor\tor.exe"
  )

  foreach ($p in $candidates) {
    if (Test-Path $p) {
      Write-Host "Starting tor.exe: $p"
      Start-Process -FilePath $p -ArgumentList '--SocksPort','9050' -WindowStyle Hidden
      break
    }
  }

  for ($i = 0; $i -lt 15; $i++) {
    Start-Sleep -Seconds 1
    if (Test-TorSocks) {
      Write-Host 'Tor SOCKS is reachable.'
      return
    }
  }

  throw 'Tor SOCKS is not reachable on 127.0.0.1:9050.'
}

if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run PowerShell as Administrator and re-run this script.'
}

$root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $root

if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
  throw 'npm is not installed. Install Node.js first from https://nodejs.org/'
}

if (-not (Get-Command choco -ErrorAction SilentlyContinue)) {
  Write-Host 'Chocolatey not found. Installing Chocolatey...'
  Set-ExecutionPolicy Bypass -Scope Process -Force
  [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072
  Invoke-Expression ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))

  $env:Path += ";$env:ALLUSERSPROFILE\chocolatey\bin"
  if (-not (Get-Command choco -ErrorAction SilentlyContinue)) {
    throw 'Chocolatey install completed but choco is not available in this session.'
  }
}

choco install tor -y
Ensure-TorSocks
try {
  choco install inspircd -y
} catch {
  Write-Warning 'InspIRCd package not available in Chocolatey. Install manually from https://www.inspircd.org/'
}

$onionDefault = ''
$envFile = Join-Path $root '.env'
if (Test-Path $envFile) {
  $line = Get-Content $envFile | Where-Object { $_ -match '^IRC_HOST=' } | Select-Object -First 1
  if ($line) {
    $onionDefault = ($line -replace '^IRC_HOST=', '').Trim()
  }
}

if ($onionDefault) {
  $onion = Read-Host "Enter IRC onion host (default: $onionDefault)"
  if ([string]::IsNullOrWhiteSpace($onion)) { $onion = $onionDefault }
} else {
  $onion = Read-Host 'Enter IRC onion host (example: abc...xyz.onion)'
}

if ([string]::IsNullOrWhiteSpace($onion)) {
  throw 'Onion host is required.'
}

$onion = $onion.Trim().ToLowerInvariant()
if ($onion -notmatch '^[a-z2-7]{56}\.onion$' -and $onion -notmatch '^[a-z2-7][a-z2-7.-]*\.onion$') {
  throw "Onion host is invalid: $onion"
}

@"
HOST=0.0.0.0
PORT=3000
WS_PATH=/ws
TOR_ENABLED=true
TOR_SOCKS_HOST=127.0.0.1
TOR_SOCKS_PORT=9050
IRC_HOST=$onion
IRC_PORT=6667
IRC_TLS=false
IRC_TLS_REJECT_UNAUTHORIZED=true
APP_ACCESS_TOKEN=
ALLOW_CLIENT_IRC_SETTINGS=true
MAX_TEXT_LEN=900
MAX_NICK_LEN=24
"@ | Set-Content -Path (Join-Path $root '.env') -Encoding UTF8

npm install
npm run build
Start-Process 'http://localhost:3000' | Out-Null
npm run start
