# SQLite for control room state; marks and excludes stay in prs.py's files

Work item overrides (attach/split), dependencies, parking, ignored repos and action records live in SQLite at `~/Library/Application Support/control-room/state.db`. Marks and excludes stay in `~/.claude/prs-marks.json` and `prs-exclude.txt`, owned by `prs.py`, which the server reads and writes only through `prs.py`. That split looks odd, but it keeps `prs.py` working unchanged from the terminal, and action records (kept forever, queried later) rule out JSON for the rest.
