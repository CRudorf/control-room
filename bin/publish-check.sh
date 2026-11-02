#!/usr/bin/env bash
# Stops a push that would publish a private word. The list is private: ~/.config/control-room/public-blocklist.txt.
# Usage: publish-check.sh [folder]. Checks the files of a git repo and the messages of all its commits.
set -euo pipefail
dir="${1:-.}"
list="$HOME/.config/control-room/public-blocklist.txt"
[[ -s "$list" ]] || { echo "no blocklist at $list: refusing"; exit 1; }
cd "$dir"
hits="$(git grep -n -I -i -F -f "$list" HEAD -- . || true)"
msgs="$(git log --all --format='%H %an %ae %B' | grep -i -F -f "$list" || true)"
if [[ -n "$hits$msgs" ]]; then
  echo "BLOCKED: private words found"
  printf '%s\n' "$hits" | cut -d: -f2-3 | sort -u | head -40
  [[ -z "$msgs" ]] || echo "and in commit messages or authors"
  exit 1
fi
echo "clean: no private words in the files or commits"
