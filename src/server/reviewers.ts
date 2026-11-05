// Default reviewers: who the user asks to review in each repo. Set in the project settings
// ({"repos": {"<repo>": {"reviewers": ["login"]}}}), else learned from whom the user re-requested there
// before. A PR of the user's that is ready and has no reviewer becomes the user's move: request them in one key,
// and a re-request after a feedback round adds them to whoever left the feedback.
import type { PrRow } from "../shared/types";
import { db } from "./db";
import { SETTINGS } from "./settings";

const short = (repo: string) => repo.split("/").pop()!.toLowerCase();

/** People asked at least twice in a repo, most asked first, up to three. Pure. `sent`: "owner/repo#12 → a, b". */
export function learned(sent: string[]): Map<string, string[]> {
  const counts = new Map<string, Map<string, number>>();
  for (const s of sent) {
    const m = s.match(/^(?:[\w.-]+\/)?([\w.-]+)#\d+ → (.+)$/);
    if (!m) continue;
    const by = counts.get(m[1].toLowerCase()) ?? new Map();
    for (const who of m[2].split(",").map((x) => x.trim()).filter(Boolean)) by.set(who, (by.get(who) ?? 0) + 1);
    counts.set(m[1].toLowerCase(), by);
  }
  return new Map([...counts].map(([repo, by]) => [repo, [...by].filter(([, n]) => n >= 2).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w]) => w)]));
}

let cache: { at: number; by: Map<string, string[]> } | null = null;
export function defaultReviewers(repo: string): string[] {
  const set = (SETTINGS as { repos?: Record<string, { reviewers?: string[] }> }).repos?.[short(repo)]?.reviewers;
  if (set?.length) return set;
  if (!cache || Date.now() - cache.at > 10 * 60_000) {
    const sent = db.query<{ sent: string }, []>("SELECT sent FROM action_records WHERE action = 'rerequest' AND dry_run = 0 AND result NOT LIKE 'failed%'").all().map((r) => r.sent);
    cache = { at: Date.now(), by: learned(sent) };
  }
  return cache.by.get(short(repo)) ?? [];
}

/**
 * A PR of the user's with its reviewers filled in. Pure given `defaults`: a re-request adds the defaults
 * to whoever gave feedback; a ready PR with nobody on it asks for the defaults.
 */
export function withReviewers(p: PrRow, defaults: string[]): PrRow {
  if (p.role !== "mine" || p.draft || p.merge_queue || !defaults.length) return p;
  const others = defaults.filter((d) => d.toLowerCase() !== p.author.toLowerCase());
  if (p.state === "re-request") return { ...p, rerequest: [...new Set([...(p.rerequest ?? []), ...others])] };
  const nobody = !p.pending_reviewers.length && !p.review_decision && !(p.feedback?.length);
  if (nobody && p.state === "waiting" && others.length) return { ...p, state: "re-request", rerequest: others };
  return p;
}
