#!/usr/bin/env bash
# Activate the repository-local venv.
# Usage (from the repo root): source backend/activate.sh
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source "$PROJECT_DIR/.venv/bin/activate"
echo "Activated venv: $VIRTUAL_ENV"
echo "Python: $(python --version)"
