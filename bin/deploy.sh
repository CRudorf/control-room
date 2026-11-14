#!/usr/bin/env bash
# Install or update the copy launchd runs, pinned to main (ADR 0005), then restart it.
set -euo pipefail
# The clone to ship from. The control room's own deploy (src/server/deploy.ts) runs a copy of this script
# from GitHub's main and names the clone here.
repo="${CR_DEPLOY_REPO:-$(cd "$(dirname "$0")/.." && pwd)}"
app="$HOME/Library/Application Support/control-room/app"
logs="$HOME/Library/Logs/control-room"
label=com.control-room.app
plist="$HOME/Library/LaunchAgents/$label.plist"

# What ships: main, or GitHub's main when it's ahead, so a worktree that pushed main can deploy
# without moving the main checkout's branch.
git -C "$repo" fetch -q origin main || echo "couldn't fetch GitHub's main: deploying local main"
ref=refs/heads/main
if git -C "$repo" merge-base --is-ancestor main origin/main 2>/dev/null; then ref=refs/remotes/origin/main; fi

[[ -d "$app/.git" ]] || git clone -q --branch main "$repo" "$app"
prev="$(git -C "$app" rev-parse HEAD)"
git -C "$app" fetch -q "$repo" "$ref"
git -C "$app" reset -q --hard FETCH_HEAD
(cd "$app" && bun install --frozen-lockfile --silent)

# Nothing ships with a broken layout: overlaps, sideways scroll, squeezed panes or cut-off controls.
# The check runs on what was just installed; a failure puts the last install back before anything restarts.
if [[ "${SKIP_LAYOUT:-}" != 1 ]]; then
  if ! bun "$app/scripts/layout-check.ts"; then
    git -C "$app" reset -q --hard "$prev"
    (cd "$app" && bun install --frozen-lockfile --silent)
    echo "not deployed: fix the layout, or SKIP_LAYOUT=1 bun run deploy (kept $(git -C "$app" log -1 --format=%h))"
    exit 1
  fi
fi
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
    "$app/bin/launchd.plist" > "$jplist"
  if launchctl print "gui/$UID/$jlabel" >/dev/null 2>&1; then
    launchctl bootout "gui/$UID/$jlabel"
    sleep 1
  fi
  # The skills ship with the project. Each project's Claude config gets the same base, and tunes it in its own folder.
  jclaude="$(python3 -c "import json,os;print(os.path.expanduser(json.load(open('$map'))['projects']['$project'].get('claudeConfigDir','~/.claude')))")"
  mkdir -p "$jclaude/skills" "$jclaude/scripts"
  # From the installed copy, not the checkout that ran this: a worktree goes away and may hold unmerged work.
  for s in "$app"/skills/*/; do rsync -a --delete "$s" "$jclaude/skills/$(basename "$s")/"; done
  ln -sf "$app/scripts/verify.py" "$jclaude/scripts/verify.py"
  ln -sf "$app/scripts/pr-replies.py" "$jclaude/scripts/pr-replies.py"
  # Third-party skills are not in this repo: copy from the config that has them.
  [[ -d "$jclaude/skills/statechart" || ! -d "$HOME/.claude/skills/statechart" ]] || rsync -a "$HOME/.claude/skills/statechart/" "$jclaude/skills/statechart/"
  launchctl bootstrap "gui/$UID" "$jplist"
  echo "running $project: http://127.0.0.1:$port  (logs: $jlogs/server.log)"
done <<< "$projects"
