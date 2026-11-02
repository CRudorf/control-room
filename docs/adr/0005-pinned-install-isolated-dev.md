# launchd runs a pinned install; dev is isolated

Agents edit this repo, so launchd never runs the working checkout: it runs a clone at `~/Library/Application Support/control-room/app` pinned to `main`, updated by `bun run deploy` (pull, install, `launchctl kickstart -k`). A dev server on 4778 gets its own DB seeded from a copy of the installed one, with notifications off, polling off unless `--poll`, and teammate-visible writes sent to a dry-run sink that only leaves an action record marked `dry-run`. A broken branch can't take down the app watching it, or act twice as the user.
