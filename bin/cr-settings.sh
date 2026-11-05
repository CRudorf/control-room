#!/usr/bin/env bash
# Adds what the friction review asked of the user's own Claude settings (~/.claude/settings.json), which
# agents may not write: allow rules for writes the user already approves every time, and the control
# room's SessionStart hook. Backs the file up first, keeps everything already there, and is safe to rerun.
set -eu
f="${CR_SETTINGS_FILE:-$HOME/.claude/settings.json}"
app="$HOME/Library/Application Support/control-room/app"
[ -f "$f" ] || echo '{}' > "$f"
cp "$f" "$f.bak-$(date +%Y%m%d%H%M%S)"
python3 - "$f" "$app" <<'PY'
import json, sys
path, app = sys.argv[1], sys.argv[2]
s = json.load(open(path))
allow = [
  "Bash(gh pr comment:*)",
  "Bash(gh pr edit --add-reviewer:*)",
  "Bash(gh pr ready:*)",
  "Bash(git push --force-with-lease:*)",
  "Bash(docker stop:*)",
  "Bash(docker compose stop:*)",
  "Bash(docker compose down:*)",
]
perms = s.setdefault("permissions", {})
have = perms.setdefault("allow", [])
added = [r for r in allow if r not in have]
have.extend(added)
hook = {"type": "command", "command": f'bun "{app}/src/server/sessionhook.ts"', "timeout": 5}
starts = s.setdefault("hooks", {}).setdefault("SessionStart", [])
if not any(h.get("command") == hook["command"] for e in starts for h in e.get("hooks", [])):
    starts.append({"hooks": [hook]})
    added.append("SessionStart hook: sessionhook.ts")
json.dump(s, open(path, "w"), indent=2)
print("\n".join(f"added {a}" for a in added) or "nothing to add; already set")
PY
