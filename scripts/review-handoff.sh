#!/usr/bin/env bash
# Open one herdr tab per PR and start Claude there.
#   default:    a fresh worktree and a multi-persona review of someone's PR
#   --feedback: work the open feedback on one of your own PRs (prs.py prompt);
#               the agent drafts, then pushes and re-requests review once you approve
#
# usage: review-handoff.sh [--personas N | --feedback] REF...
#   REF: PR URL, owner/repo#N, repo#N, or a bare N (repo of the current dir)
set -euo pipefail

personas=2
mode=review
refs=()
while (($#)); do
  case "$1" in
    --personas) personas="$2"; shift 2 ;;
    --feedback) mode=feedback; shift ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) refs+=("$1"); shift ;;
  esac
done
((${#refs[@]})) || { echo "no PRs given" >&2; exit 2; }

[[ "${HERDR_ENV:-}" == 1 ]] || { echo "not running inside herdr" >&2; exit 1; }
workspace="${HERDR_WORKSPACE_ID:?}"

resolve() {
  local ref="$1"
  if [[ "$ref" =~ github\.com/([^/]+)/([^/]+)/pull/([0-9]+) ]]; then
    echo "${BASH_REMATCH[1]} ${BASH_REMATCH[2]} ${BASH_REMATCH[3]}"
  elif [[ "$ref" =~ ^([^/#]+)/([^/#]+)#([0-9]+)$ ]]; then
    echo "${BASH_REMATCH[1]} ${BASH_REMATCH[2]} ${BASH_REMATCH[3]}"
  elif [[ "$ref" =~ ^([^/#]+)#([0-9]+)$ ]]; then
    local org
    org=$(jq -r '.org // empty' ~/.config/control-room/config.json 2>/dev/null) || true
    [[ -n "$org" ]] || return 1
    echo "$org ${BASH_REMATCH[1]} ${BASH_REMATCH[2]}"
  elif [[ "$ref" =~ ^#?([0-9]+)$ ]]; then
    local nwo
    nwo=$(gh repo view --json nameWithOwner -q .nameWithOwner)
    echo "${nwo%%/*} ${nwo##*/} ${BASH_REMATCH[1]}"
  else
    return 1
  fi
}

failed=0
for ref in "${refs[@]}"; do
  if ! read -r owner repo number < <(resolve "$ref"); then
    echo "skip $ref: can't parse" >&2; failed=1; continue
  fi
  checkout="$HOME/Projects/$repo"
  if [[ ! -d "$checkout/.git" ]]; then
    echo "skip $owner/$repo#$number: no checkout at $checkout" >&2; failed=1; continue
  fi

  slug=$(printf '%s' "$repo" | tr 'A-Z_' 'a-z-' | tr -cd 'a-z0-9-')
  if [[ $mode == feedback ]]; then
    # The prompt sets up its own worktree on the PR branch.
    if ! prompt=$("$HOME/.claude/scripts/prs.py" prompt "$owner/$repo#$number"); then
      failed=1; continue
    fi
    agent=$(printf 'fx-%s-%s' "${slug:0:20}" "$number")
    label="fix $repo#$number"
    claude_args=(--name "feedback $repo#$number")
  else
    prompt="Run a $personas person multi-persona review on PR $owner/$repo#$number  - any findings get locally verified empirically by running actual code, see input/outputs for confirmation. Then we draft the findings we want to pass on as a code reviewer, inline on the PR. We dont make any changes, we just do the review. only give me the drafted comments as a list, do NOT post anything to the pr yet"
    agent=$(printf 'rv-%s-%s' "${slug:0:20}" "$number")
    label="$repo#$number"
    claude_args=(--worktree "review-$slug-$number" --name "review $repo#$number")
  fi

  tab=$(herdr tab create --workspace "$workspace" --cwd "$checkout" --label "$label" --no-focus)
  pane=$(jq -r '.result.root_pane.pane_id' <<<"$tab")
  # A new tab's shell takes a moment to reach its prompt.
  for _ in {1..20}; do
    herdr pane wait-output "$pane" --regex '(?m)[%$#] ?$' --timeout 500 >/dev/null 2>&1 && break
  done
  if ! herdr agent start "$agent" --kind claude --pane "$pane" --timeout 60000 -- "${claude_args[@]}" >/dev/null ||
     ! herdr agent prompt "$agent" "$prompt" >/dev/null; then
    echo "failed $owner/$repo#$number: see tab $label" >&2; failed=1; continue
  fi

  echo "$owner/$repo#$number -> tab $(jq -r '.result.tab.tab_id' <<<"$tab"), agent $agent"
done
exit "$failed"
