#!/bin/bash

echo "Stopping MediaScope services..."

# Kill backend (port 8000)
if lsof -ti:8000 > /dev/null 2>&1; then
    echo "Stopping backend on port 8000..."
    kill $(lsof -ti:8000) 2>/dev/null
    echo "✓ Backend stopped"
else
    echo "Backend not running"
fi

# Kill frontend (port 3000)
if lsof -ti:3000 > /dev/null 2>&1; then
    echo "Stopping frontend on port 3000..."
    kill $(lsof -ti:3000) 2>/dev/null
    echo "✓ Frontend stopped"
else
    echo "Frontend not running"
fi

# Clean up PID file
rm -f backend.pid

echo "All services stopped!"
