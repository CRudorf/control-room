#!/usr/bin/env bash
# Install or update the copy launchd runs, pinned to main (ADR 0005), then restart it.
set -euo pipefail
# The server runs a copy of this script from its state folder and names the clone in CR_DEPLOY_REPO.
repo="${CR_DEPLOY_REPO:-$(cd "$(dirname "$0")/.." && pwd)}"
app="$HOME/Library/Application Support/control-room/app"
logs="$HOME/Library/Logs/control-room"
label=com.control-room.app
plist="$HOME/Library/LaunchAgents/$label.plist"

# Nothing ships with a broken layout: overlaps, sideways scroll, squeezed panes or cut-off controls.
if [[ "${SKIP_LAYOUT:-}" != 1 ]]; then
  bun "$repo/scripts/layout-check.ts" || { echo "not deployed: fix the layout, or SKIP_LAYOUT=1 bun run deploy"; exit 1; }
fi

if [[ -d "$app/.git" ]]; then
  # From the server, ship the GitHub main it just fetched into the clone, not the clone's local main.
  src=main
  [[ -n "${CR_DEPLOY_REPO:-}" ]] && src=refs/remotes/origin/main
  git -C "$app" fetch -q origin "$src"
  git -C "$app" reset -q --hard FETCH_HEAD
else
  git clone -q --branch main "$repo" "$app"
fi
(cd "$app" && bun install --frozen-lockfile --silent)
echo "installed $(git -C "$app" log -1 --format='%h %s')"

# Control Room.app: the notifier, and what launchd runs so the login item carries its name.
bundle="$HOME/Applications/Control Room.app"
mkdir -p "$HOME/Applications"
bash "$app/bin/build-app.sh" "$HOME/Applications" | tail -1

mkdir -p "$HOME/Library/LaunchAgents"
# One launchd job for each project in the private map. The default project keeps the plain label.
map="$HOME/.config/control-room/projects.json"
projects="$(python3 -c "import json;d=json.load(open('$map'));print('\\n'.join(f\"{n} {c.get('port',4777)} {'1' if n==d.get('default') else '0'}\" for n,c in d['projects'].items()))")"
while read -r project port isdefault; do
  if [[ "$isdefault" == 1 ]]; then jlabel="$label"; jlogs="$logs"; else jlabel="$label.$project"; jlogs="$logs-$project"; fi
  jplist="$HOME/Library/LaunchAgents/$jlabel.plist"
  mkdir -p "$jlogs"
  sed -e "s|@LABEL@|$jlabel|" -e "s|@PROJECT@|$project|" -e "s|@BUN@|$(command -v bun)|" -e "s|@APPBUNDLE@|$bundle|" -e "s|@APP@|$app|" -e "s|@LOGS@|$jlogs|" -e "s|@HOME@|$HOME|" \
    "$repo/bin/launchd.plist" > "$jplist"
  if launchctl print "gui/$UID/$jlabel" >/dev/null 2>&1; then
    launchctl bootout "gui/$UID/$jlabel"
    sleep 1
  fi
  # The skills ship with the project. Each project's Claude config gets the same base, and tunes it in its own folder.
  jclaude="$(python3 -c "import json,os;print(os.path.expanduser(json.load(open('$map'))['projects']['$project'].get('claudeConfigDir','~/.claude')))")"
  mkdir -p "$jclaude/skills" "$jclaude/scripts"
  for s in "$repo"/skills/*/; do rsync -a --delete "$s" "$jclaude/skills/$(basename "$s")/"; done
  ln -sf "$repo/scripts/verify.py" "$jclaude/scripts/verify.py"
  # Third-party skills are not in this repo: copy from the config that has them.
  [[ -d "$jclaude/skills/statechart" || ! -d "$HOME/.claude/skills/statechart" ]] || rsync -a "$HOME/.claude/skills/statechart/" "$jclaude/skills/statechart/"
  launchctl bootstrap "gui/$UID" "$jplist"
  echo "running $project: http://127.0.0.1:$port  (logs: $jlogs/server.log)"
done <<< "$projects"
