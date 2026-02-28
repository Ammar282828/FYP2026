#!/bin/bash
set -e

# Initialize git repository with 'main' as the default branch
git init -b main

# Add all files, respecting .gitignore
git add .

# Create the initial commit
git commit -m "Initial commit"

echo ""
echo "✅ Repository initialized and all files committed."
echo ""
echo "To push to your new remote repository, run the following commands:"
echo "  git remote add origin <YOUR_NEW_REPO_URL>"
echo "  git push -u origin main"
