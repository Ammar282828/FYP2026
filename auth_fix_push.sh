#!/bin/bash
set -e

# We include the username in the URL to force git to authenticate as 'Ammar282828'
# instead of the cached user 'am08721'.
REPO_URL="https://Ammar282828@github.com/Ammar282828/FYP2026.git"

echo "Updating remote 'origin' to force username: Ammar282828..."
git remote set-url origin "$REPO_URL"

echo "Pushing to main..."
echo "NOTE: If prompted for a password, you must use a GitHub Personal Access Token (classic), NOT your account password."
git push -u origin main
