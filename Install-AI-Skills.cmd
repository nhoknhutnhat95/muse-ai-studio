@echo off
setlocal
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-skills.ps1" %*
if errorlevel 1 (
  echo.
  echo Cai skill chua xong. Xem loi phia tren.
  pause
  exit /b 1
)
echo Skill da cai. Mo chat moi trong Codex hoac Claude Code.
pause
