@echo off
REM MediaScope Setup Script for Windows
REM This script sets up the entire project automatically

echo ================================
echo MediaScope Automatic Setup
echo ================================
echo.

REM Check if Python is installed
echo Checking prerequisites...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo X Python is not installed. Please install it from https://www.python.org/downloads/
    pause
    exit /b 1
)
echo [OK] Python found

REM Check if Node.js is installed
node --version >nul 2>&1
if %errorlevel% neq 0 (
    echo X Node.js is not installed. Please install it from https://nodejs.org/
    pause
    exit /b 1
)
echo [OK] Node.js found

REM Check if PostgreSQL is installed
psql --version >nul 2>&1
if %errorlevel% neq 0 (
    echo X PostgreSQL is not installed. Please install it from https://www.postgresql.org/download/
    pause
    exit /b 1
)
echo [OK] PostgreSQL found

echo.
echo Step 1: Setting up Python virtual environment
python -m venv venv
call venv\Scripts\activate.bat
echo [OK] Virtual environment created

echo.
echo Step 2: Installing Python dependencies
python -m pip install --upgrade pip
pip install -r requirements.txt
echo [OK] Python packages installed

echo.
echo Step 3: Installing spaCy language model
python -m spacy download en_core_web_sm
echo [OK] spaCy model downloaded

echo.
echo Step 4: Setting up PostgreSQL database
echo Creating database...

REM Create database (suppress errors if already exists)
createdb -U postgres mediascope 2>nul

REM Create user and grant privileges
psql -U postgres -c "CREATE USER mediascope_user WITH PASSWORD 'mediascope_pass';" 2>nul
psql -U postgres -c "GRANT ALL PRIVILEGES ON DATABASE mediascope TO mediascope_user;" 2>nul

REM Create tables from schema
echo Creating database tables...
psql -U postgres -d mediascope -f database_schema.sql

REM Grant permissions on all tables to mediascope_user
psql -U postgres -d mediascope -c "GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO mediascope_user;" 2>nul
psql -U postgres -d mediascope -c "GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO mediascope_user;" 2>nul

echo [OK] Database tables created

echo [OK] Database setup complete

echo.
echo Step 5: Creating environment file
if not exist .env (
    (
        echo # Database Configuration
        echo DB_HOST=localhost
        echo DB_NAME=mediascope
        echo DB_USER=mediascope_user
        echo DB_PASSWORD=mediascope_pass
        echo.
        echo # CORS Configuration
        echo ALLOWED_ORIGINS=http://localhost:3000,http://localhost:3001
        echo.
        echo # API Configuration
        echo API_PORT=8000
        echo.
        echo # Legacy settings
        echo DATABASE_URL=postgresql://mediascope_user:mediascope_pass@localhost:5432/mediascope
        echo ELASTICSEARCH_URL=http://elasticsearch:9200
        echo.
        echo # Gemini API Key - GET THIS FROM: https://makersuite.google.com/app/apikey
        echo GEMINI_API_KEY=your_gemini_api_key_here
    ) > .env
    echo [OK] .env file created
) else (
    echo [!] .env file already exists. Skipping...
)

echo.
echo Step 6: Installing frontend dependencies
cd mediascope-frontend
call npm install
cd ..
echo [OK] Frontend packages installed

echo.
echo Step 7: Updating frontend configuration
(
    echo # Development API URL ^(localhost^)
    echo REACT_APP_API_URL=http://localhost:8000
) > mediascope-frontend\.env.local
echo [OK] Frontend configured for local development

echo.
echo ================================
echo Setup Complete!
echo ================================
echo.
echo NEXT STEPS:
echo.
echo 1. Make sure PostgreSQL is running:
echo    - Open Services app and start PostgreSQL
echo.
echo 2. Start the backend ^(Terminal 1^):
echo    - venv\Scripts\activate
echo    - python mediascope_api.py
echo.
echo 3. Start the frontend ^(Terminal 2^):
echo    - cd mediascope-frontend
echo    - npm start
echo.
echo 4. Open http://localhost:3000 in your browser
echo.
echo ================================
echo Happy searching!
echo ================================
echo.
pause
