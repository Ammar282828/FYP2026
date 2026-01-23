#!/bin/bash
cd ~/Downloads/files
source venv/bin/activate

echo "Starting MediaScope Backend..."
python3 mediascope_api.py
