// Stop checks: what a repo's Stop hook ran when an agent last tried to finish on a branch. The hook
// (scripts/stop-check.sh, copied into the repo) writes the record; the work item shows it.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { StopCheck } from "../shared/types";
import { ROOT } from "./config";
import { repoPath } from "./repos";

export const CHECKS_DIR = process.env.CR_CHECKS_DIR ?? join(homedir(), ".config", "control-room", "checks");
mkdirSync(CHECKS_DIR, { recursive: true });

const short = (repo: string) => repo.split("/").pop()!;
export const checkFile = (repo: string, branch: string, dir = CHECKS_DIR) => join(dir, `${short(repo)}__${branch.replace(/\//g, "_")}.json`);

/** The last result on a branch, or null. A half-written or foreign file counts as none. */
export function readCheck(repo: string, branch: string, dir = CHECKS_DIR): StopCheck | null {
  const f = checkFile(repo, branch, dir);
  if (!existsSync(f)) return null;
  try {
    const r = JSON.parse(readFileSync(f, "utf8"));
    return typeof r.ok === "boolean" && Array.isArray(r.commands) ? { ...r, repo: short(repo) } : null;
  } catch { return null; }
}

/** The results on a work item's PR branches, one each. */
export function checksFor(prs: { repo: string; branch: string }[], dir = CHECKS_DIR): StopCheck[] {
  const seen = new Set<string>();
  return prs.flatMap((p) => {
    const k = `${short(p.repo)}/${p.branch}`;
    if (seen.has(k)) return [];
    seen.add(k);
    const c = readCheck(p.repo, p.branch, dir);
    return c ? [c] : [];
  });
}

/** One line per result, for the item view. */
export const checkLine = (c: StopCheck) =>
  `Stop checks on ${c.branch} ${c.ok ? "passed" : "FAILED"} at ${c.sha.slice(0, 8)}: ${c.commands.map((x) => `${x.command} (exit ${x.exit})`).join(", ")}`;

/** Of these repos, the ones checked out here without a Stop check. A repo not checked out is unknown, not a gap. */
export function reposWithoutChecks(repos: string[], has = (r: string) => existsSync(join(repoPath(r), ".claude", "stop-checks")), local = (r: string) => existsSync(repoPath(r))): string[] {
  return [...new Set(repos)].filter((r) => local(r) && !has(r)).sort();
}

/** The prompt for an agent that adds the Stop check to a repo, in a draft PR. */
export function checkHookPrompt(repo: string): string {
  return `Add a Stop check to ${repo}, so an agent can't finish here while the repo's fast checks fail.

1. Find this repo's typecheck and fast tests: package.json, Makefile and CI config. Choose commands that finish in under 2 minutes together. Do not include slow end-to-end suites.
2. Write them to \`.claude/stop-checks\`, one command per line.
3. Copy \`${join(ROOT, "scripts", "stop-check.sh")}\` to \`.claude/hooks/stop-check.sh\` without changes, and make it executable.
4. In \`.claude/settings.json\`, keep what is there and add a Stop hook: {"hooks": {"Stop": [{"hooks": [{"type": "command", "command": "\\"$CLAUDE_PROJECT_DIR\\"/.claude/hooks/stop-check.sh", "timeout": 300}]}]}}.
5. Show it works. Run the hook with a passing tree and note exit 0. Then break a check on purpose, run it, note exit 2, and undo the break. Note the commands and exit codes.

Then branch from the latest main as \`chore/stop-check\`, commit, push, and open a draft PR whose body says what it runs and shows those exit codes. Never merge. Tell me the PR link.`;
}
