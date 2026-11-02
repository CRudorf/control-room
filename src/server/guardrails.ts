import { CLAUDE_DIR } from "./repos";
// Guardrails: what stops an agent whatever the auto mode classifier decides. Reads the user's Claude
// Code settings and reports what's missing; it never writes them, the user changes settings himself.
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { read as runRead } from "./runner";

/** The parts of a Claude Code settings file the check reads. */
export type Settings = {
  permissions?: { deny?: string[] };
  sandbox?: { enabled?: boolean; failIfUnavailable?: boolean; allowUnsandboxedCommands?: boolean };
  autoMode?: { soft_deny?: string[] };
};

// What a Read deny rule has to mention for each kind of secret to count as covered.
const SECRETS: [string, RegExp][] = [
  [".env", /\.env\b/],
  ["keys (*.pem, *.key, ~/.ssh)", /\.pem\b|\.key\b|\.ssh\b|id_rsa|id_ed25519/],
  ["credentials (~/.aws, credentials files)", /credential|\.aws\b|secrets?\b/i],
];

/**
 * Gaps in the guardrails, one short line each. `local` (~/.claude/settings.local.json) overrides
 * `user` for single values and adds to its deny list; autoMode is only read from user settings.
 */
export function settingsGaps(user: Settings | null, local: Settings | null = null): string[] {
  const gaps: string[] = [];
  const deny = [...(user?.permissions?.deny ?? []), ...(local?.permissions?.deny ?? [])];
  const reads = deny.filter((r) => /^Read(\(|$)/.test(r));
  // A bare `Read` deny blocks every read, secrets included.
  const missing = reads.includes("Read") ? [] : SECRETS.filter(([, re]) => !reads.some((r) => re.test(r))).map(([name]) => name);
  if (missing.length) gaps.push(`No Read deny rule for ${missing.join(", ")}`);

  // Without the key, or with "$defaults" in it, the built-in production deploy rule applies.
  const soft = user?.autoMode?.soft_deny;
  if (soft && !soft.includes("$defaults") && !soft.some((r) => /prod/i.test(r) && /deploy/i.test(r)))
    gaps.push("autoMode.soft_deny drops the defaults and has no production deploy rule");

  const sandbox = { ...user?.sandbox, ...local?.sandbox };
  if (sandbox.enabled !== true) gaps.push("Sandbox is off (sandbox.enabled)");
  if (sandbox.failIfUnavailable !== true) gaps.push("Sandbox fails open when unavailable (sandbox.failIfUnavailable)");
  if (sandbox.allowUnsandboxedCommands !== false) gaps.push("Commands can retry outside the sandbox (sandbox.allowUnsandboxedCommands)");
  return gaps;
}

/** Repos whose default branch isn't protected, as gap lines. Unknown (no access) isn't a gap. */
export function protectionGaps(repos: Map<string, { branch: string; protected: boolean } | null>): string[] {
  return [...repos].filter(([, b]) => b && !b.protected).map(([repo, b]) => `${repo}: ${b!.branch} isn't protected`);
}

const read = (f: string): Settings | null => {
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, "utf8")); } catch { return null; }
};

const DAY = 24 * 3600_000;
const branches = new Map<string, { at: number; b: { branch: string; protected: boolean } | null }>();

async function gh(path: string, jq: string) {
  try { return (await runRead(["gh", "api", path, "--jq", jq], { stderr: "ignore" })).trim(); }
  catch { throw new Error(`gh api ${path} failed`); }
}

/** Whether a repo's default branch is protected, from GitHub at most once a day. */
async function defaultBranch(repo: string) {
  const hit = branches.get(repo);
  if (hit && Date.now() - hit.at < DAY) return hit.b;
  let b: { branch: string; protected: boolean } | null = null;
  try {
    const branch = await gh(`repos/${repo}`, ".default_branch");
    b = { branch, protected: (await gh(`repos/${repo}/branches/${encodeURIComponent(branch)}`, ".protected")) === "true" };
  } catch { /* no access: unknown */ }
  branches.set(repo, { at: Date.now(), b });
  return b;
}

/** Every guardrail gap: The user's settings, then the default branch of each repo with his open PRs. */
export async function guardrails(repos: string[]): Promise<string[]> {
  const dir = CLAUDE_DIR;
  const found = new Map(await Promise.all([...new Set(repos)].sort().map(async (r) => [r, await defaultBranch(r)] as const)));
  return [...settingsGaps(read(join(dir, "settings.json")), read(join(dir, "settings.local.json"))), ...protectionGaps(found)];
}
