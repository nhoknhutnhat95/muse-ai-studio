@echo off
setlocal
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\restart.ps1" %*
if not errorlevel 1 exit /b 0
echo.
echo Chua khoi dong lai Muse Web. Xem thong bao o tren.
pause
exit /b 1
