#!/usr/bin/env bash
# A Claude Code Stop hook: runs the commands in .claude/stop-checks, one per line, and exit 2 sends the
# failure back to the agent. A repo keeps a copy at .claude/hooks/stop-check.sh.
# When the control room's checks folder exists, the result goes there, so the work item can show it.
set -u

input=$(cat)
root=$(git rev-parse --show-toplevel 2>/dev/null) || exit 0
cd "$root" || exit 0
[ -f .claude/stop-checks ] || exit 0

# Nothing changed on this branch: nothing to check.
base=$(git rev-parse --verify -q origin/HEAD || true)
if [ -z "$(git status --porcelain)" ] && { [ -z "$base" ] || [ "$(git rev-parse HEAD)" = "$base" ]; }; then exit 0; fi

json() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' | tr -d '\n\r\t'; }

dir="${CR_CHECKS_DIR:-$HOME/.config/control-room/checks}"
repo=$(basename "$(git remote get-url origin 2>/dev/null || printf '%s' "$root")" .git)
branch=$(git rev-parse --abbrev-ref HEAD)
name=$(printf '%s__%s' "$repo" "$branch" | tr '/' '_')
# record ok running commands: the board shows the checks as running until the result replaces this.
record() {
  [ -d "$dir" ] || return 0
  printf '{"repo":"%s","branch":"%s","sha":"%s","at":"%s","ok":%s,"running":%s,"commands":[%s]}\n' \
    "$(json "$repo")" "$(json "$branch")" "$(git rev-parse HEAD)" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$1" "$2" "$3" > "$dir/$name.json.tmp" \
    && mv "$dir/$name.json.tmp" "$dir/$name.json"
}
record true true ""

ok=true
ran=""
failed=""
while IFS= read -r cmd || [ -n "$cmd" ]; do
  case "$cmd" in ''|'#'*) continue ;; esac
  out=$(bash -c "$cmd" 2>&1)
  code=$?
  ran="$ran${ran:+,}{\"command\":\"$(json "$cmd")\",\"exit\":$code}"
  if [ "$code" -ne 0 ]; then
    ok=false
    failed="$failed\$ $cmd (exit $code)
$(printf '%s\n' "$out" | tail -n 30)
"
  fi
done < .claude/stop-checks

record "$ok" false "$ran"

[ "$ok" = true ] && exit 0
# The agent already retried once on this stop: let it stop, so a failure can't trap it. The record stays red.
if printf '%s' "$input" | grep -Eq '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then exit 0; fi
printf 'Checks failed. Fix them, or say why you cannot.\n%s' "$failed" >&2
exit 2
