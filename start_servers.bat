@echo off
echo ===================================================
echo Starting My Mockmate Application
echo ===================================================

REM Check if backend\venv exists
if not exist "%~dp0backend\venv" (
    echo Virtual environment not found in %~dp0backend\venv!
    echo Please ensure the backend\venv folder exists.
    pause
    exit /b
)

REM Start Backend
echo Starting Backend Server on port 8000...
start "My Mockmate Backend" cmd /k "cd /d ""%~dp0backend"" && call venv\Scripts\activate && python -m uvicorn api:app --reload --port 8000"

REM Start Frontend
echo Starting Frontend Server...
cd /d "%~dp0frontend"
if not exist "node_modules" (
    echo Installing frontend dependencies...
    call npm install
)
start "My Mockmate Frontend" cmd /k "cd /d ""%~dp0frontend"" && npm run dev"

echo ===================================================
echo Application started!
echo.
echo Backend running at: http://127.0.0.1:8000
echo Frontend running at: http://localhost:5173
echo.
echo IMPORTANT: 
echo 1. Two new terminal windows have opened. Keep them OPEN.
echo 2. If you close them, the website will stop working.
echo ===================================================
pause
