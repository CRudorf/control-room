// What the user got done over a span: today, the last 24 hours, the last 7 and 30 days. `summarize` is
// pure; `accomplished` gathers the PR history, his reviews of others' PRs, the control room's own
// records and the AI usage, and summarizes every span at once.
import type { Accomplished, Shipped, Span, UsageCoeffs } from "../shared/types";
import { db } from "./db";
import { read } from "./runner";
import { shipped } from "./shipped";
import { DEV } from "./config";
import type { PrFacts } from "./metrics";
import { historySyncedAt, prFacts, syncHistory } from "./history";
import { usd, weighted, type Turn } from "./tokens";
import { coeffs } from "./usage";

/** One review the user submitted on someone else's PR. */
export type Review = { ref: string; url: string; title: string; author: string; state: string; at: string };
/** A write the control room made for the user, from its action records. */
export type ActionRow = { at: string; action: string; trigger: string | null; sent: string | null };

const lite = (f: PrFacts) => ({ ref: f.ref, url: f.url, title: f.title, feature: f.feature });

/** One span's accomplishments from everything gathered. */
export function summarize(span: Span, from: string, facts: PrFacts[], reviews: Review[], records: ActionRow[], turns: Turn[], c: UsageCoeffs): Accomplished {
  const inSpan = (at: string | null | undefined) => !!at && at >= from;
  const merged = facts.filter((f) => inSpan(f.merged));
  const commits = facts.flatMap((f) => f.commits.filter((x) => inSpan(x.at)).map(() => f));
  const touched = [...merged, ...facts.filter((f) => inSpan(f.created)), ...commits];
  // Every inline reply is a COMMENTED review of its own: the verdict is the latest approval or change request.
  const byPr = new Map<string, Accomplished["reviewed"][number]>();
  for (const r of reviews.filter((x) => inSpan(x.at)).sort((a, b) => a.at.localeCompare(b.at))) {
    const e = byPr.get(r.ref) ?? { ref: r.ref, url: r.url, title: r.title, author: r.author, verdict: "commented", comments: 0 };
    if (r.state === "APPROVED" || r.state === "CHANGES_REQUESTED") e.verdict = r.state === "APPROVED" ? "approved" : "changes requested";
    else if (r.state === "COMMENTED") e.comments++;
    byPr.set(r.ref, e);
  }
  const rec = records.filter((r) => inSpan(r.at));
  const count = (action: string, trigger?: string) => rec.filter((r) => r.action === action && (!trigger || r.trigger === trigger)).length;
  const ts = turns.filter((t) => inSpan(t.at));
  const w = ts.reduce((a, t) => a + weighted(t), 0);
  const kwh = (w / 1e6) * c.whPerMTok / 1000;
  return {
    span, from,
    merged: merged.map(lite),
    opened: facts.filter((f) => inSpan(f.created)).map(lite),
    closed: facts.filter((f) => inSpan(f.closed)).map(lite),
    reviewed: [...byPr.values()],
    commits: commits.length,
    repos: [...new Set(touched.map((f) => f.repo.split("/").pop()!))].sort(),
    features: [...new Set(touched.map((f) => f.feature))],
    reviewsPosted: count("post-review"),
    // Recorded as "owner/repo#N: 3 comment(s), comment".
    commentsPosted: rec.filter((r) => r.action === "post-review").reduce((a, r) => a + Number(/: (\d+) comment/.exec(r.sent ?? "")?.[1] ?? 0), 0),
    replies: count("reply"),
    resolved: count("resolve"),
    rerequests: count("rerequest"),
    loopRounds: count("loop-report"),
    jira: rec.filter((r) => r.action === "jira-transition" && r.sent).map((r) => r.sent!),
    usage: ts.length ? { usd: ts.reduce((a, t) => a + usd(t), 0), kwh, liters: kwh * c.litersPerKwh, sessions: new Set(ts.filter((t) => t.dir).map((t) => t.session)).size } : null,
  };
}

/** Where each span starts. */
export function spans(now: Date): [Span, string][] {
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  const back = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
  return [["today", midnight.toISOString()], ["24h", back(1)], ["7d", back(7)], ["30d", back(30)]];
}

const REVIEWS = `query($q: String!, $after: String, $me: String!) {
  viewer { login }
  search(query: $q, type: ISSUE, first: 50, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest { number title url repository { nameWithOwner } author { login }
      reviews(first: 100, author: $me) { nodes { state submittedAt } } } }
  }
}`;

const gh = (args: string[]) => read(["gh", ...args]);

let me: string | null = null;
let cached: { at: number; reviews: Review[] } | null = null;

/** The user's reviews of others' PRs in the last 30 days; cached for 5 minutes. */
async function reviews(): Promise<Review[]> {
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.reviews;
  me ??= (await gh(["api", "user", "--jq", ".login"])).trim();
  const since = new Date(Date.now() - 31 * 86_400_000).toISOString().slice(0, 10);
  const out: Review[] = [];
  let after: string | null = null;
  do {
    const res: any = JSON.parse(await gh(["api", "graphql", "-f", `query=${REVIEWS}`, "-f", `q=is:pr reviewed-by:${me} -author:${me} updated:>=${since}`, "-f", `me=${me}`, ...(after ? ["-f", `after=${after}`] : [])]));
    for (const n of res.data.search.nodes) {
      if (!n?.repository) continue;
      for (const r of n.reviews.nodes) {
        if (r.state === "PENDING") continue;
        out.push({ ref: `${n.repository.nameWithOwner}#${n.number}`, url: n.url, title: n.title, author: n.author?.login ?? "ghost", state: r.state, at: r.submittedAt });
      }
    }
    after = res.data.search.pageInfo.hasNextPage ? res.data.search.pageInfo.endCursor : null;
  } while (after);
  cached = { at: Date.now(), reviews: out };
  return out;
}

/** Every span's accomplishments; brings the PR history up to date first when it's over 10 minutes old. */
export async function accomplished(): Promise<{ spans: Accomplished[]; syncedAt: string | null; reviewsError: string | null; shipped: Shipped[] }> {
  const last = historySyncedAt();
  if (!last || Date.now() - Date.parse(last) > 10 * 60_000) await Promise.race([syncHistory(), Bun.sleep(25_000)]);
  const from30 = spans(new Date())[3][1];
  let revs: Review[] = [], reviewsError: string | null = null;
  try { revs = await reviews(); } catch (e) { reviewsError = (e as Error).message; }
  const records = db.query<ActionRow, [string]>(`SELECT at, action, trigger, sent FROM action_records WHERE dry_run = ${DEV ? 1 : 0} AND at >= ? AND (result IS NULL OR result NOT LIKE 'failed%')`).all(from30);
  const turns = db.query<Turn, [string]>("SELECT * FROM usage_turns WHERE at >= ?").all(from30);
  const facts = prFacts().filter((f) => (f.merged ?? f.closed ?? "") >= from30 || f.created >= from30 || f.commits.some((c) => c.at >= from30));
  const c = coeffs();
  return { spans: spans(new Date()).map(([s, from]) => summarize(s, from, facts, revs, records, turns, c)), syncedAt: historySyncedAt(), reviewsError, shipped: shipped() };
}

