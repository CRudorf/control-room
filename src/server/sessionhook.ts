// A Claude Code SessionStart hook: a session started anywhere, not only from the board, learns the work
// item its branch belongs to (its decisions, what changed since the user looked, its PRs) and is warned
// when another live session already owns that branch. Install: ~/s/cr-settings.sh (bin/cr-settings.sh).
// Never fails a session: any error prints nothing.
import { existsSync, readFileSync } from "node:fs";
import { PORT, TOKEN_PATH } from "./config";
import { HOSTNAME } from "./security";

type HookIn = { session_id?: string; cwd?: string; source?: string };

async function main() {
  const input = JSON.parse((await Bun.stdin.text()) || "{}") as HookIn;
  if (!input.cwd || !existsSync(TOKEN_PATH)) return;
  const branch = Bun.spawnSync(["git", "-C", input.cwd, "branch", "--show-current"]).stdout.toString().trim();
  if (!branch) return;
  const q = new URLSearchParams({ branch, session: input.session_id ?? "", cwd: input.cwd });
  const res = await fetch(`http://${HOSTNAME}:${PORT}/api/session-context?${q}`, {
    headers: { cookie: `cr=${readFileSync(TOKEN_PATH, "utf8").trim()}` }, signal: AbortSignal.timeout(3000),
  });
  if (!res.ok) return;
  const text = await res.text();
  if (text.trim()) console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: text } }));
}

await main().catch(() => {});
