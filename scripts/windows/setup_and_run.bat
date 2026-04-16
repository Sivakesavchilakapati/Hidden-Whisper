@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "LOGFILE=%~dp0setup_and_run.log"
echo ==== Hidden Whisper setup log (%DATE% %TIME%) ==== > "%LOGFILE%"

echo [Hidden Whisper] Windows setup starting...
echo Log file: "%LOGFILE%"

:: Check admin rights
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Please run this script as Administrator.
  echo [ERROR] Script is not running as Administrator.>> "%LOGFILE%"
  goto :fail
)

cd /d "%~dp0\..\.."

where npm >nul 2>&1
if %errorlevel% neq 0 (
  echo npm is not installed. Install Node.js first: https://nodejs.org/
  echo [ERROR] npm not found in PATH.>> "%LOGFILE%"
  goto :fail
)

where choco >nul 2>&1
if %errorlevel% neq 0 (
  echo Chocolatey not found. Installing Chocolatey...
  echo [INFO] Installing Chocolatey because choco was not found.>> "%LOGFILE%"
  powershell -NoProfile -ExecutionPolicy Bypass -Command "Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://community.chocolatey.org/install.ps1'))" >> "%LOGFILE%" 2>&1

  set "PATH=%PATH%;%ProgramData%\chocolatey\bin;%ALLUSERSPROFILE%\chocolatey\bin"
  where choco >nul 2>&1
  if %errorlevel% neq 0 (
    if exist "%ProgramData%\chocolatey\bin\choco.exe" (
      set "PATH=%PATH%;%ProgramData%\chocolatey\bin"
    )
    where choco >nul 2>&1
  )

  where choco >nul 2>&1
  if %errorlevel% neq 0 (
    echo Chocolatey installed but choco is not in PATH for this session.
    echo [ERROR] choco still not discoverable after install.>> "%LOGFILE%"
    goto :fail
  )

  echo Chocolatey installed successfully. Re-running setup script...
  echo [INFO] Chocolatey ready. Re-running setup script.>> "%LOGFILE%"
  call "%~f0" %*
  exit /b %errorlevel%
)

echo Installing Tor service...
choco install tor -y >> "%LOGFILE%" 2>&1
if %errorlevel% neq 0 (
  echo Failed to install Tor via Chocolatey.
  echo [ERROR] choco install tor failed.>> "%LOGFILE%"
  goto :fail
)

call :ensure_tor_socks
if %errorlevel% neq 0 goto :fail

if /I "%INSTALL_INSPIRCD%"=="true" (
  echo Attempting InspIRCd install...
  choco install inspircd -y >> "%LOGFILE%" 2>&1
  if %errorlevel% neq 0 (
    echo InspIRCd package not available via Chocolatey on this machine.
    echo Install InspIRCd manually from https://www.inspircd.org/ if you need a local IRC server.
    echo [WARN] choco install inspircd failed.>> "%LOGFILE%"
  )
) else (
  echo Skipping InspIRCd install by default.
  echo [INFO] InspIRCd install skipped. Set INSTALL_INSPIRCD=true to try it.>> "%LOGFILE%"
)

echo Writing .env...
(
  echo HOST=0.0.0.0
  echo PORT=3000
  echo WS_PATH=/ws
  echo TOR_ENABLED=true
  echo TOR_SOCKS_HOST=127.0.0.1
  echo TOR_SOCKS_PORT=9050
  echo IRC_HOST=
  echo IRC_PORT=6667
  echo IRC_TLS=false
  echo IRC_TLS_REJECT_UNAUTHORIZED=true
  echo APP_ACCESS_TOKEN=
  echo ALLOW_CLIENT_IRC_SETTINGS=true
  echo MAX_TEXT_LEN=900
  echo MAX_NICK_LEN=24
) > .env
echo [INFO] Wrote .env with blank IRC host; configure onion in the app login screen.>> "%LOGFILE%"

echo Installing Node dependencies...
call npm install >> "%LOGFILE%" 2>&1
if %errorlevel% neq 0 (
  echo [ERROR] npm install failed.>> "%LOGFILE%"
  goto :fail
)

echo Building frontend...
call npm run build >> "%LOGFILE%" 2>&1
if %errorlevel% neq 0 (
  echo [ERROR] npm run build failed.>> "%LOGFILE%"
  goto :fail
)

echo Starting gateway on http://0.0.0.0:3000 ...
start "" "http://localhost:3000" >nul 2>&1
call npm run start

echo.
echo Setup script finished.
echo Log file: "%LOGFILE%"
pause
exit /b 0

:fail
echo.
echo Setup failed. Check log file:
echo "%LOGFILE%"
pause
exit /b 1

:ensure_tor_socks
echo Checking Tor SOCKS at 127.0.0.1:9050 ...
echo [INFO] Checking Tor SOCKS reachability on 127.0.0.1:9050.>> "%LOGFILE%"

powershell -NoProfile -Command "$r=Test-NetConnection -ComputerName 127.0.0.1 -Port 9050 -WarningAction SilentlyContinue; if($r.TcpTestSucceeded){exit 0}else{exit 1}" >nul 2>&1
if %errorlevel% equ 0 (
  echo [INFO] Tor SOCKS is already reachable.>> "%LOGFILE%"
  exit /b 0
)

set "TOR_EXE="
if exist "%ProgramData%\chocolatey\lib\tor\tools\tor\tor.exe" set "TOR_EXE=%ProgramData%\chocolatey\lib\tor\tools\tor\tor.exe"
if not defined TOR_EXE if exist "%ProgramFiles%\Tor\tor.exe" set "TOR_EXE=%ProgramFiles%\Tor\tor.exe"
if not defined TOR_EXE (
  for /f "usebackq delims=" %%P in (`where tor 2^>nul`) do (
    if not defined TOR_EXE set "TOR_EXE=%%P"
  )
)

if not defined TOR_EXE (
  echo Could not find tor.exe after install.
  echo [ERROR] tor.exe not found on disk.>> "%LOGFILE%"
  exit /b 1
)

echo Starting Tor client using: %TOR_EXE%
echo [INFO] Starting tor.exe: %TOR_EXE%>> "%LOGFILE%"
powershell -NoProfile -Command "Start-Process -FilePath '%TOR_EXE%' -ArgumentList '--SocksPort','9050' -WindowStyle Hidden" >> "%LOGFILE%" 2>&1

for /L %%N in (1,1,15) do (
  powershell -NoProfile -Command "$r=Test-NetConnection -ComputerName 127.0.0.1 -Port 9050 -WarningAction SilentlyContinue; if($r.TcpTestSucceeded){exit 0}else{exit 1}" >nul 2>&1
  if !errorlevel! equ 0 (
    echo [INFO] Tor SOCKS reachable after %%N checks.>> "%LOGFILE%"
    exit /b 0
  )
  timeout /t 1 >nul
)

echo Tor SOCKS is still not reachable on 127.0.0.1:9050.
echo [ERROR] Tor did not expose SOCKS on 9050 after retries.>> "%LOGFILE%"
exit /b 1
