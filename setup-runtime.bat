@echo off
setlocal enabledelayedexpansion

echo.
echo ====================================================
echo   node-thermal-printer-js Runtime Setup
echo ====================================================
echo.

:: Get start time using PowerShell for precision
for /f %%A in ('powershell -Command "Get-Date -UFormat %%s"') do set SCRIPT_START=%%A

:: Check for admin privileges
openfiles >nul 2>&1
if errorlevel 1 (
  echo [WARNING] Admin privileges recommended for package manager access.
  echo Running with limited permissions - some installs may fail.
  echo.
)

:: Check and install Node.js
for /f %%A in ('powershell -Command "Get-Date -UFormat %%s"') do set STEP1_START=%%A
echo [1/3] Checking Node.js...
where node >nul 2>&1
if errorlevel 1 (
  echo [INSTALL] Node.js not found. Installing...
  where winget >nul 2>&1
  if not errorlevel 1 (
    echo Using winget...
    winget install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
  ) else (
    where choco >nul 2>&1
    if not errorlevel 1 (
      echo Using Chocolatey...
      choco install -y nodejs-lts
    ) else (
      echo [ERROR] No package manager found ^(winget/choco^).
      echo Please install Node.js manually: https://nodejs.org/ ^(LTS version^)
      pause
      exit /b 1
    )
  )
) else (
  for /f "tokens=1" %%A in ('node -v') do (
    echo [OK] Node.js: %%A
  )
)
for /f %%A in ('powershell -Command "Get-Date -UFormat %%s"') do set STEP1_END=%%A
set /a STEP1_TIME=!STEP1_END! - !STEP1_START!
echo     Time: !STEP1_TIME!s
echo.

:: Check and install Python
for /f %%A in ('powershell -Command "Get-Date -UFormat %%s"') do set STEP2_START=%%A
echo [2/3] Checking Python...
where python3 >nul 2>&1
if errorlevel 1 (
  where python >nul 2>&1
  if errorlevel 1 (
    where py >nul 2>&1
    if errorlevel 1 (
      echo [INSTALL] Python not found. Installing...
      where winget >nul 2>&1
      if not errorlevel 1 (
        echo Using winget...
        winget install -e --id Python.Python.3.11 --accept-package-agreements --accept-source-agreements
      ) else (
        where choco >nul 2>&1
        if not errorlevel 1 (
          echo Using Chocolatey...
          choco install -y python
        ) else (
          echo [ERROR] No package manager found ^(winget/choco^).
          echo Please install Python manually: https://www.python.org/downloads/ ^(3.9 or higher^)
          echo IMPORTANT: Check "Add Python to PATH" during installation
          pause
          exit /b 1
        )
      )
    ) else (
      for /f "tokens=2" %%A in ('py --version') do (
        echo [OK] Python: %%A
      )
    )
  ) else (
    for /f "tokens=2" %%A in ('python --version') do (
      echo [OK] Python: %%A
    )
  )
) else (
  for /f "tokens=2" %%A in ('python3 --version') do (
    echo [OK] Python: %%A
  )
)
for /f %%A in ('powershell -Command "Get-Date -UFormat %%s"') do set STEP2_END=%%A
set /a STEP2_TIME=!STEP2_END! - !STEP2_START!
echo     Time: !STEP2_TIME!s
echo.

:: Install bleak library
for /f %%A in ('powershell -Command "Get-Date -UFormat %%s"') do set STEP3_START=%%A
echo [3/3] Installing bleak library...
python -m pip install bleak >nul 2>&1
if errorlevel 1 (
  python3 -m pip install bleak >nul 2>&1
  if errorlevel 1 (
    py -m pip install bleak >nul 2>&1
    if errorlevel 1 (
      echo [WARNING] Could not auto-install bleak.
      echo Attempting manual install...
      pip install bleak
      if errorlevel 1 (
        echo [ERROR] Failed to install bleak library.
        echo Please run manually: pip install bleak
        pause
        exit /b 1
      )
    ) else (
      echo [OK] Bleak installed
    )
  ) else (
    echo [OK] Bleak installed
  )
) else (
  echo [OK] Bleak installed
)
for /f %%A in ('powershell -Command "Get-Date -UFormat %%s"') do set STEP3_END=%%A
set /a STEP3_TIME=!STEP3_END! - !STEP3_START!
echo     Time: !STEP3_TIME!s
echo.

:: Calculate total time
for /f %%A in ('powershell -Command "Get-Date -UFormat %%s"') do set SCRIPT_END=%%A
set /a TOTAL_TIME=!SCRIPT_END! - !SCRIPT_START!

echo ====================================================
echo   Setup Complete!
echo ====================================================
echo.
echo Timing:
echo   Step 1 ^(Node.js^):  !STEP1_TIME!s
echo   Step 2 ^(Python^):   !STEP2_TIME!s
echo   Step 3 ^(Bleak^):    !STEP3_TIME!s
echo   ---
echo   Total time:       !TOTAL_TIME!s
echo.
echo IMPORTANT: If Node.js or Python were just installed,
echo restart this terminal window to refresh the PATH.
echo.
echo You can now run the printer application.
echo.
pause

