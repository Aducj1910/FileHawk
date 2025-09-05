#!/bin/bash
# Python launcher for FileFinder

# Get the directory where this script is located
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "Python environment not found. Running installer..."
    ./install_python.sh
    if [ $? -ne 0 ]; then
        echo "Failed to install Python environment"
        exit 1
    fi
fi

# Activate virtual environment and run the API
source venv/bin/activate
python api.py
