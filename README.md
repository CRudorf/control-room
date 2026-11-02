# control-room

A local control room for the user's work in flight. Planning lives in this repo's GitHub issues, tracker conventions in `docs/agents/issue-tracker.md`; vocabulary in `GLOSSARY.md`.

## Running it

- Where the work lives goes in `~/.config/control-room/config.json`, not the repo: `{"org": "acme", "sentryOrg": "acme", "jiraProjects": ["ABC"], "jiraSuggestSprints": ["Next up"], "jiraSuggestLabel": "cleanup"}`. `org` is what a bare `repo#123` means; without `sentryOrg` the after-merge watch skips Sentry. Suggestions read `jiraSuggestSprints` (default `["Next up"]`) after the active sprint and `jiraSuggestLabel` (default `cleanup`) in the backlog. All keys are optional.
- `bun run deploy` installs or updates the copy launchd runs (pinned to `main`) and restarts it on port 4777.
- `bun run open` signs Chrome in once and opens the app. Install it from Chrome's address bar to get its own window.
- `bun run dev` runs a dev server on 4778 against a copy of the installed state, without polling; add `-- --poll` to poll GitHub.
- `bun test` runs the tests. Logs: `~/Library/Logs/control-room/server.log`.

To point every Claude Code session at its work item, add `scripts/session-start.sh` as a `SessionStart` hook in `~/.claude/settings.json`. The control room never writes that file.

To set up GitHub Issues as a project's tracker, use the link in the Start box. It writes `tracker` to `~/.config/control-room/projects/<project>.json`. To stop issue writes that name private work in every repo of a project, add `scripts/issue-guard.py` as a `PreToolUse` hook with the matcher `Bash|mcp__.*` in that project's Claude settings. This repo has the hook already.

`scripts/` holds prs.py, jira.py, standup.py and review-handoff.sh; `~/.claude/scripts/` links to them.
