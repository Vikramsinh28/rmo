#!/bin/bash
set -e

SOURCE="staging"
TARGET="main"

echo "Promoting $SOURCE → $TARGET via pull request"

git fetch origin

# Ensure source branch exists locally
git checkout "$SOURCE"
git pull origin "$SOURCE"

BRANCH="promote/${SOURCE}-to-${TARGET}-$(date +%Y%m%d%H%M%S)"
git checkout -b "$BRANCH"

git push -u origin "$BRANCH"

PR_URL=$(gh pr create \
  --base "$TARGET" \
  --head "$BRANCH" \
  --title "Promote ${SOURCE} to ${TARGET}" \
  --body "Automated promotion from \`${SOURCE}\` to \`${TARGET}\`.

This PR was created by \`deploy.sh\`. Review changes and merge when CI passes.")

echo "Pull request created: $PR_URL"
echo "Merge the PR after CI passes to complete the promotion."
