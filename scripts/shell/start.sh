#!/bin/bash

# Navigate to project directory
cd ~/Downloads/files

echo "======================================"
echo "  Starting MediaScope Application"
echo "======================================"
echo ""

# Check if venv exists
if [ ! -d "venv" ]; then
    echo "Error: Virtual environment not found!"
    echo "Run: python3 -m venv venv && source venv/bin/activate && pip install fastapi uvicorn firebase-admin google-generativeai python-dotenv pydantic"
    exit 1
fi

# Start backend
echo "[1/2] Starting Backend API..."
source venv/bin/activate
nohup python3 mediascope_api.py > backend.log 2>&1 &
BACKEND_PID=$!
echo $BACKEND_PID > backend.pid
echo "      Backend PID: $BACKEND_PID"
echo "      Logs: tail -f backend.log"
echo ""

# Wait for backend to initialize
echo "      Waiting for backend to start..."
for i in {1..30}; do
    if lsof -i:8000 > /dev/null 2>&1; then
        echo "      ✓ Backend ready at http://localhost:8000"
        break
    fi
    sleep 1
done

# Start frontend
echo ""
echo "[2/2] Starting Frontend..."
cd mediascope-frontend
echo "      Frontend will open at http://localhost:3000"
echo ""
npm start
