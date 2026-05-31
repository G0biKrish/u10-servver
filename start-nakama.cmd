@echo off
title U10 Nakama Server Starter
color 0A

echo ==================================================
echo         Starting U10 Nakama Server
echo ==================================================
echo.

:: Verify Docker is running
docker info >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Docker is not running or docker command not found.
    echo         Please start Docker Desktop and try again.
    echo.
    pause
    exit /b 1
)

:: Navigate to the directory of this script
cd /d "%~dp0"

echo [1/3] Spinning up Nakama and Postgres containers...
docker-compose up -d

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Failed to execute docker-compose up.
    echo.
    pause
    exit /b 1
)

echo.
echo [2/3] Waiting for Postgres to become healthy...
:wait_postgres
docker inspect u10-postgres --format "{{.State.Health.Status}}" > "%TEMP%\pg_status.txt" 2>&1
set /p PG_STATUS=<"%TEMP%\pg_status.txt"
if not "%PG_STATUS%"=="healthy" (
    echo ... Postgres state is: %PG_STATUS% (waiting for healthy...)
    timeout /t 2 /nobreak > nul
    goto wait_postgres
)
echo [OK] Postgres is healthy!

echo.
echo [3/3] Waiting for Nakama container to initialize...
:wait_nakama
docker inspect u10-nakama --format "{{.State.Health.Status}}" > "%TEMP%\nakama_status.txt" 2>&1
set /p NAKAMA_STATUS=<"%TEMP%\nakama_status.txt"
if not "%NAKAMA_STATUS%"=="healthy" (
    echo ... Nakama state is: %NAKAMA_STATUS% (initializing runtime...)
    timeout /t 2 /nobreak > nul
    goto wait_nakama
)
echo [OK] Nakama is healthy and ready!

echo.
echo ==================================================
echo   Nakama Server is Live!
echo   - API Endpoint:      http://localhost:7350
echo   - Developer Console: http://localhost:7351
echo ==================================================
echo.
echo Registered JavaScript/TypeScript RPCs:
docker logs u10-nakama --tail 100 2>&1 | findstr /i "Registered JavaScript runtime RPC"
echo.
pause
