@echo off
setlocal EnableExtensions

cd /d "%~dp0\..\.."

echo Checking local health endpoint...
powershell -NoProfile -Command "try { (Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3000/api/health).Content } catch { $_.Exception.Message; exit 1 }"
if %errorlevel% neq 0 exit /b 1

echo Checking Tor SOCKS port...
powershell -NoProfile -Command "$c = New-Object Net.Sockets.TcpClient; try { $c.Connect('127.0.0.1',9050); 'Tor SOCKS reachable' } catch { Write-Error 'Cannot connect to 127.0.0.1:9050'; exit 1 } finally { $c.Close() }"
if %errorlevel% neq 0 exit /b 1

echo Test completed.
