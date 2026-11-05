// A session's digest for the friction review: the user's typed turns, permission refusals by reason,
// compactions and /clears. Kept in SQLite, so a session stays readable after Claude Code deletes its
// transcript, and so the review counts these instead of scraping every transcript again.
import { existsSync, readFileSync, statSync } from "node:fs";
import { db } from "./db";

db.exec("CREATE TABLE IF NOT EXISTS session_digests (session TEXT PRIMARY KEY, size INTEGER NOT NULL, digest TEXT NOT NULL)");

export type Digest = {
  /** The user's typed turns, oldest first, each cut to 500 characters. */
  turns: { at: string; text: string }[];
  /** Tool calls refused: by the auto mode classifier (by its reason), by the user, or by worktree isolation. */
  denials: Record<string, number>;
  compactions: number;
  clears: number;
};

const NOT_TYPED = /^\s*<(local-command|command-message|task-notification|system-reminder|bash-|user-prompt-submit-hook)|^\s*Caveat: The messages below|^\s*\[Request interrupted/;
const textOf = (c: unknown): string => (typeof c === "string" ? c : Array.isArray(c) ? c.map((b: any) => (typeof b?.content === "string" ? b.content : typeof b?.text === "string" ? b.text : Array.isArray(b?.content) ? textOf(b.content) : "")).join("\n") : "");

/** A transcript's digest. Pure. */
export function digestOf(jsonl: string): Digest {
  const d: Digest = { turns: [], denials: {}, compactions: 0, clears: 0 };
  const deny = (k: string) => (d.denials[k] = (d.denials[k] ?? 0) + 1);
  for (const line of jsonl.split("\n")) {
    if (!line.trim()) continue;
    let e: any;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.type === "system" && e.subtype === "compact_boundary") { d.compactions++; continue; }
    if (e.type !== "user") continue;
    const c = e.message?.content;
    if (typeof c === "string") {
      if (c.includes("<command-name>/clear</command-name>")) { d.clears++; continue; }
      if (c.startsWith("This session is being continued from a previous conversation")) { if (!e.isCompactSummary) d.compactions++; continue; }
      if (NOT_TYPED.test(c) || e.isMeta || e.isCompactSummary) continue;
      d.turns.push({ at: e.timestamp ?? "", text: c.replace(/\s+/g, " ").trim().slice(0, 500) });
      continue;
    }
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (b?.type !== "tool_result" || !b.is_error) continue;
      const t = textOf(b.content);
      const why = t.match(/auto mode classifier\. Reason: \[([^\]]+)\]/)?.[1];
      if (why) deny(why);
      else if (/doesn't want to proceed|user rejected|was rejected by the user/i.test(t)) deny("user rejected");
      else if (/isolated in the worktree/.test(t)) deny("worktree isolation");
      else if (/Operation not permitted|sandbox/i.test(t) && /denied|not permitted/i.test(t)) deny("sandbox");
    }
  }
  return d;
}

const get = db.query<{ size: number; digest: string }, [string]>("SELECT size, digest FROM session_digests WHERE session = ?");
const put = db.query("INSERT INTO session_digests (session, size, digest) VALUES (?, ?, ?) ON CONFLICT(session) DO UPDATE SET size = excluded.size, digest = excluded.digest");

/** A session's digest: read again when its transcript grew, else the one kept, which outlives the transcript. */
export function sessionDigest(session: string, transcript: string | null): Digest | null {
  const kept = get.get(session);
  if (!transcript || !existsSync(transcript)) return kept ? JSON.parse(kept.digest) : null;
  const size = statSync(transcript).size;
  if (kept && kept.size === size) return JSON.parse(kept.digest);
  const d = digestOf(readFileSync(transcript, "utf8"));
  put.run(session, size, JSON.stringify(d));
  return d;
}
