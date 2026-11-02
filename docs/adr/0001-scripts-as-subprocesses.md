# The server calls prs.py and jira.py; it doesn't port them

The control room is a Bun/TypeScript server, but GitHub and Jira reads and writes go through `prs.py` and `jira.py` run as subprocesses (`--json`), with new subcommands added there when the server needs them. The scripts already encode the triage rules the user trusts from the terminal, and porting them would leave two sources of truth that drift. The scripts move into this repo under `scripts/`, symlinked back to `~/.claude/scripts/`, so they're versioned with the server that depends on them.

## Consequences

The only GitHub call the server makes itself is the cheap 2-minute change detector; everything that interprets a PR goes through `prs.py`. Don't "fix" a subprocess call by inlining the query.
