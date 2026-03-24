@echo off
chcp 65001 >nul 2>&1
setlocal enabledelayedexpansion

set "MODE=%~1"
set "ACTION=%~2"

if "%MODE%"=="" set "MODE=dev"
if "%ACTION%"=="" set "ACTION=up"

if "%MODE%"=="dev" (
    set "ENV_FILE=.env.dev"
    set "COMPOSE_FILES=-f docker-compose.yml -f docker-compose.dev.yml"
    goto :run
)
if "%MODE%"=="prod" (
    set "ENV_FILE=.env.prod"
    set "COMPOSE_FILES=-f docker-compose.yml -f docker-compose.prod.yml"
    goto :run
)

echo Usage: %~nx0 [dev / prod] [up / down / build / logs / restart / ps]
echo.
echo Modes:
echo   dev   - Development (volume mount + hot reload)
echo   prod  - Production (optimized build images)
echo.
echo Actions:
echo   up      - Start services (default)
echo   down    - Stop and remove services
echo   build   - Build/rebuild images
echo   logs    - Follow service logs
echo   restart - Restart services
echo   ps      - Show running services
exit /b 1

:run
if not exist "%ENV_FILE%" (
    echo Error: %ENV_FILE% not found.
    echo Copy .env.example to %ENV_FILE% and configure it first.
    exit /b 1
)

if "%ACTION%"=="up" goto :do_up
if "%ACTION%"=="down" goto :do_down
if "%ACTION%"=="build" goto :do_build
if "%ACTION%"=="logs" goto :do_logs
if "%ACTION%"=="restart" goto :do_restart
if "%ACTION%"=="ps" goto :do_ps

echo Unknown action: %ACTION%
echo Valid actions: up, down, build, logs, restart, ps
exit /b 1

:do_up
echo Starting Docmost (%MODE% mode)...
docker compose %COMPOSE_FILES% --env-file %ENV_FILE% up -d --build
echo.
echo Services started. Use '%~nx0 %MODE% logs' to view logs.
goto :eof

:do_down
echo Stopping Docmost (%MODE% mode)...
docker compose %COMPOSE_FILES% --env-file %ENV_FILE% down
goto :eof

:do_build
echo Building Docmost (%MODE% mode)...
docker compose %COMPOSE_FILES% --env-file %ENV_FILE% build
goto :eof

:do_logs
docker compose %COMPOSE_FILES% --env-file %ENV_FILE% logs -f
goto :eof

:do_restart
echo Restarting Docmost (%MODE% mode)...
docker compose %COMPOSE_FILES% --env-file %ENV_FILE% restart
goto :eof

:do_ps
docker compose %COMPOSE_FILES% --env-file %ENV_FILE% ps
goto :eof
