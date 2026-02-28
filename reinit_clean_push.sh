#!/bin/bash
set -e

REPO_URL="https://Ammar282828@github.com/Ammar282828/FYP2026.git"

echo "🧹 Cleaning up old git history to remove secrets..."
# Remove the old git repository
rm -rf .git

echo "✨ Re-initializing repository..."
git init -b main

# Re-add files. Since we updated .gitignore, the secret file will now be excluded.
git add .

echo "📦 Creating fresh initial commit..."
git commit -m "Initial commit"

echo "🔗 setting remote to $REPO_URL..."
git remote add origin "$REPO_URL"

echo "🚀 Pushing to main..."
git push -u origin main --force
