// Product bounces: each time product asks a question on, or fails, an issue of the user's in Testing
// (GLOSSARY: Product testing), one record, with the PRs, branch and agent sessions behind the work.
// They feed the quality view and the weekly loop beside shipped PRs and lessons, so the harness learns
// what kinds of work product sends back.
import type { ItemBranch, Issue } from "../shared/types";
import { db } from "./db";
import { isDev, note } from "./runner";
import { outcomeOf } from "./acceptance";

export type Bounce = {
  ref: string; at: string; key: string; kind: "product-question" | "failed-testing"; by: string | null; text: string;
  prs: string[]; branch: string | null; agentSessions: string[];
};

/** The bounce an issue shows now, if any. `ref` dedupes it: the comment id of a question, the changelog id of a fail. */
export function bounceOf(j: Issue): Omit<Bounce, "prs" | "branch" | "agentSessions"> | null {
  const o = outcomeOf(j), t = j.testing;
  if (o === "failed" && t?.failed)
    return { ref: `${j.key}:fail:${t.failed.id}`, at: t.failed.at, key: j.key, kind: "failed-testing", by: t.failed.by, text: (t.failed.comment?.firstLine ?? "").slice(0, 500) };
  if (o === "question" && t?.lastComment)
    return { ref: `${j.key}:q:${t.lastComment.id}`, at: t.lastComment.at, key: j.key, kind: "product-question", by: t.lastComment.author, text: t.lastComment.firstLine.slice(0, 500) };
  return null;
}

const insert = db.query(`INSERT OR IGNORE INTO product_events (ref, at, key, kind, by, text, prs, branch, agent_sessions, dry_run)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
const sessions = db.query<{ sent: string | null; result: string | null }, [string]>(
  "SELECT sent, result FROM action_records WHERE action = 'start-agent' AND work_item = ? ORDER BY at");

/** Records each new bounce once (and an action record for it). Returns the new ones. */
export function recordBounces(issues: Iterable<Issue>, branchesFor: (key: string) => ItemBranch[], prsFor: (key: string) => string[]): Bounce[] {
  const fresh: Bounce[] = [];
  for (const j of issues) {
    const b = bounceOf(j);
    if (!b) continue;
    const bs = branchesFor(j.key);
    const agentSessions = sessions.all(j.key).map((r) => r.sent ?? r.result ?? "").filter(Boolean);
    const full: Bounce = { ...b, prs: prsFor(j.key), branch: bs[0] ? `${bs[0].repo}@${bs[0].name}` : null, agentSessions };
    const r = insert.run(full.ref, full.at, full.key, full.kind, full.by, full.text, JSON.stringify(full.prs), full.branch, JSON.stringify(agentSessions), isDev() ? 1 : 0);
    if (!r.changes) continue;
    note({ item: j.key, trigger: "jira" }, full.kind, j.key, full.text || null, { at: full.at, detail: full });
    fresh.push(full);
  }
  return fresh;
}

type Row = { ref: string; at: string; key: string; kind: Bounce["kind"]; by: string | null; text: string; prs: string; branch: string | null; agent_sessions: string };

/** Every bounce since `from`, newest first. */
export function bounces(from = ""): Bounce[] {
  return db.query<Row, [string, number]>("SELECT * FROM product_events WHERE at >= ? AND dry_run = ? ORDER BY at DESC").all(from, isDev() ? 1 : 0)
    .map((r) => ({ ref: r.ref, at: r.at, key: r.key, kind: r.kind, by: r.by, text: r.text, prs: JSON.parse(r.prs), branch: r.branch, agentSessions: JSON.parse(r.agent_sessions) }));
}
