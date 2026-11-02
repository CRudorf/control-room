#!/usr/bin/env bash
# A Claude Code SessionStart hook: tells the agent how to look up its work item. It adds one line and
# fetches nothing, so the session pulls the detail only when it needs it.
root=$(cd "$(dirname "$0")/.." && pwd -P)
branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null) || exit 0
default=$(git symbolic-ref --short refs/remotes/origin/HEAD 2>/dev/null)
case "$branch" in HEAD|main|master|"${default#origin/}") exit 0 ;; esac
printf '`bun run --cwd "%s" item %s` shows the work item for this branch: its PRs, open feedback, failing checks and lessons.\n' "$root" "$branch"
