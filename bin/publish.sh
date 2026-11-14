#!/usr/bin/env bash
# Publishes this repo's main to the public base, as one new commit with no private history.
# The target and its identity come from the private ~/.config/control-room/projects.json: its "public" entry
# ({repo, ghConfigDir, gitName, gitEmail}), or the project that entry names.
# Usage: publish.sh "commit message"   Asks before it pushes.
#        publish.sh --dry-run          Shows what would change, and pushes nothing.
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
map="$HOME/.config/control-room/projects.json"
dry=0; msg=""
if [[ "${1:-}" == "--dry-run" ]]; then dry=1; else msg="${1:-}"; [[ -n "$msg" ]] || { echo "usage: publish.sh \"commit message\" | --dry-run"; exit 2; }; fi

read -r target gh_dir git_name git_email < <(python3 -c "
import json,os
d=json.load(open('$map'));p=d['public']
# The identity is the public entry's own, else its project's: a project here gets a launchd job of its own.
c={**d['projects'].get(p.get('project'),{}),**{k:p[k] for k in ('ghConfigDir','gitName','gitEmail') if k in p}}
print(p['repo'],os.path.expanduser(c['ghConfigDir']),c['gitName'],c['gitEmail'])")
export GH_CONFIG_DIR="$gh_dir"
owner="${target%%/*}"
[[ "$(gh api user --jq .login)" == "$owner" ]] || { echo "gh in $gh_dir is not signed in as $owner"; exit 1; }
[[ -z "$(git -C "$repo" status --porcelain)" ]] || { echo "commit your changes first"; exit 1; }
[[ "$(git -C "$repo" branch --show-current)" == "main" ]] || { echo "publish from main"; exit 1; }

work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
git() { command git -c credential.helper= -c 'credential.helper=!gh auth git-credential' "$@"; }
git clone -q "https://github.com/$target.git" "$work/public"
mkdir "$work/export"; command git -C "$repo" archive main | tar -x -C "$work/export"
# Work-only files stay out, and a public version replaces each file that has one. Both lists are private, so
# the public copy doesn't name what it leaves out: ~/.config/control-room/public-exclude.txt (paths) and
# ~/.config/control-room/public-overrides/ (files at their repo paths).
exclude="$HOME/.config/control-room/public-exclude.txt"; overrides="$HOME/.config/control-room/public-overrides"
if [[ -f "$exclude" ]]; then
  while IFS= read -r path; do
    [[ -z "$path" || "$path" == \#* ]] && continue
    [[ -e "$work/export/$path" ]] || { echo "public-exclude.txt names $path, which main doesn't have"; exit 1; }
    rm -rf "$work/export/$path"
  done < "$exclude"
fi
[[ -d "$overrides" ]] && rsync -a "$overrides/" "$work/export/"
rsync -a --delete --exclude .git "$work/export/" "$work/public/"
cd "$work/public"
git config user.name "$git_name"; git config user.email "$git_email"
git add -A
if git diff --cached --quiet; then echo "the public base already matches main"; exit 0; fi
git diff --cached --stat | tail -25
git commit -q -m "${msg:-dry run}"

# The check reads the files and every commit. Nothing goes out if it finds a private word.
bash "$repo/bin/publish-check.sh" .
ln -s "$repo/node_modules" node_modules
result="$(bun test 2>&1 | tail -4)"; rm node_modules
echo "$result" | grep -qE '^ *0 fail' || { echo "tests fail:"; echo "$result"; exit 1; }
echo "tests pass"

if [[ $dry == 1 ]]; then echo "dry run: nothing pushed"; exit 0; fi
read -r -p "Push this to the public $target? Type the repo name to confirm: " answer
[[ "$answer" == "$target" ]] || { echo "not pushed"; exit 1; }
git push -q origin main
echo "published: https://github.com/$target/commit/$(git rev-parse HEAD)"
