@echo off
setlocal
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup.ps1"
if errorlevel 1 (
  echo.
  echo Setup chua hoan tat. Xem loi phia tren.
  pause
  exit /b 1
)
echo Setup da xong. Mo Start-Muse-Web.cmd de su dung.
pause
