#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# wujian-dao -> GitHub one-click uploader
#
# Usage:
#   1) gh CLI installed & logged in:   ./push-to-github.sh [repo-name]
#   2) or with a Personal Access Token:
#      GITHUB_TOKEN=ghp_xxx ./push-to-github.sh [repo-name] [github-username]
#
# Creates the repo under your account (public), pushes all commits.
# ---------------------------------------------------------------------------
set -e

REPO_NAME="${1:-Noon-Islands}"
TOKEN="${GITHUB_TOKEN:-}"
GH_USER="${2:-}"

cd "$(dirname "$0")"

# Prefer gh CLI when it is authenticated
if command -v gh >/dev/null 2>&1 && gh auth status >/dev/null 2>&1; then
  echo "[1/3] Creating repo with gh CLI ..."
  gh repo create "$REPO_NAME" --public --source=. --remote=origin --push \
    --description "午间岛 - 组织身份即时通信与实名互认服务（Android/iOS/HarmonyOS/微信小程序, uni-app + Express）" || true
  git push -u origin main 2>/dev/null || git push -u origin master
  echo "Done: $(gh repo view --json url -q .url)"
  exit 0
fi

# Fallback: token + REST API
if [ -z "$TOKEN" ]; then
  echo "ERROR: no authenticated gh CLI and no GITHUB_TOKEN."
  echo "Fix one of:"
  echo "  a) install GitHub CLI (winget install GitHub.cli) then: gh auth login"
  echo "  b) create a PAT with 'repo' scope at https://github.com/settings/tokens"
  echo "     and re-run:  GITHUB_TOKEN=ghp_xxx ./push-to-github.sh"
  exit 1
fi

if [ -z "$GH_USER" ]; then
  GH_USER=$(curl -s -H "Authorization: Bearer $TOKEN" https://api.github.com/user | sed -n 's/.*"login": *"\([^"]*\)".*/\1/p' | head -1)
fi
echo "[1/3] GitHub account: $GH_USER"

echo "[2/3] Creating repo $REPO_NAME ..."
curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.github+json" \
  https://api.github.com/user/repos \
  -d "{\"name\":\"$REPO_NAME\",\"description\":\"午间岛 - 组织身份即时通信与实名互认服务（Android/iOS/HarmonyOS/微信小程序, uni-app + Express）\",\"private\":false}" | grep -q '"id"' || true

REMOTE="https://$GH_USER:$TOKEN@github.com/$GH_USER/$REPO_NAME.git"
git remote remove origin 2>/dev/null || true
git remote add origin "$REMOTE"

echo "[3/3] Pushing ..."
BRANCH=$(git branch --show-current)
git push -u "$REMOTE" "$BRANCH"
echo "Done: https://github.com/$GH_USER/$REPO_NAME"
