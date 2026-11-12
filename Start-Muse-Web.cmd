@echo off
setlocal
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1" %*
if not errorlevel 1 exit /b 0
echo.
echo Muse Web chua khoi dong duoc. Xem thong bao loi o tren.
echo Nhan phim bat ky de dong cua so.
pause >nul
exit /b 1
