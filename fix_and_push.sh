#!/bin/bash
set -e

REPO_URL="https://github.com/Ammar282828/FYP2026/"

echo "Configuring remote 'origin' to $REPO_URL..."

# Update the existing 'origin' remote to point to the new URL
git remote set-url origin "$REPO_URL"

# Ensure all files are staged
git add .

# Commit any pending changes (fails silently if nothing to commit, which is fine)
git commit -m "Update for new repository" || true

# Rename branch to main just in case it's 'master'
git branch -M main

echo "Pushing to main..."
git push -u origin main
