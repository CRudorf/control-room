import { repoInProject } from "./repos";
// The user's PR history for the metrics: every PR of his since METRICS_FROM, reduced to facts and
// kept in SQLite. Backfilled on first run, then refreshed for whatever changed since the last sync.
import { DEV, POLL } from "./config";
import { db, load, save } from "./db";
import { read } from "./runner";
import { factsOf, type PrFacts } from "./metrics";

export const METRICS_FROM = "2026-01-01";
// Bump when factsOf changes: the next sync refetches everything so old rows don't keep the old rules.
const FACTS_VERSION = 6;
const EVERY_MS = 6 * 3_600_000;
const RETRY_MS = 15 * 60_000;

db.exec(`CREATE TABLE IF NOT EXISTS pr_facts (ref TEXT PRIMARY KEY, created TEXT NOT NULL, facts TEXT NOT NULL)`);

const QUERY = `query($q: String!, $after: String) {
  search(query: $q, type: ISSUE, first: 5, after: $after) {
    issueCount pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest {
      number title url createdAt mergedAt closedAt additions deletions headRefName baseRefName mergeCommit { oid } repository { nameWithOwner }
      files(first: 60) { nodes { path } }
      reviews(first: 60) { nodes { state submittedAt author { __typename login } commit { oid } } }
      reviewThreads(first: 60) { nodes { comments(first: 1) { nodes { createdAt author { __typename login } } } } }
      comments(first: 60) { nodes { createdAt author { __typename login } } }
      commits(first: 60) { nodes { commit { oid committedDate parents { totalCount } authors(first: 3) { nodes { user { login } } } statusCheckRollup { state } } } }
      timelineItems(first: 40, itemTypes: [READY_FOR_REVIEW_EVENT, REVIEW_REQUESTED_EVENT]) { nodes { __typename
        ... on ReadyForReviewEvent { createdAt }
        ... on ReviewRequestedEvent { createdAt requestedReviewer { __typename ... on User { login } ... on Team { slug } } } } }
    } }
  }
}`;

// GitHub answers the heavy history query with a 502 or 504 now and then; those get three more tries.
async function gql(query: string, vars: Record<string, string | null> = {}, tries = 4): Promise<any> {
  const args = ["gh", "api", "graphql", "-f", `query=${query}`, ...Object.entries(vars).flatMap(([k, v]) => (v ? ["-f", `${k}=${v}`] : []))];
  let out: string;
  try { out = await read(args); }
  catch (e) {
    const err = (e as Error).message;
    if (tries > 1 && /HTTP 50[234]/.test(err)) {
      await Bun.sleep((5 - tries) * 5_000);
      return gql(query, vars, tries - 1);
    }
    throw new Error(`gh api graphql failed: ${err.slice(0, 300)}`);
  }
  const res = JSON.parse(out);
  if (res.errors) throw new Error(JSON.stringify(res.errors).slice(0, 300));
  return res.data;
}

const upsert = db.query("INSERT INTO pr_facts (ref, created, facts) VALUES (?, ?, ?) ON CONFLICT(ref) DO UPDATE SET created = excluded.created, facts = excluded.facts");

/** Fetches every PR of the user's matching `filter` (GitHub search caps one query at 1000). */
// `author:@me` matches nothing once a date filter is added, so search by login.
async function pull(filter: string): Promise<number> {
  const me = (await gql("query { viewer { login } }")).viewer.login;
  let after: string | null = null, n = 0;
  do {
    // A slow query comes back with an empty page instead of an error; ask for that page again.
    let d = await gql(QUERY, { q: `is:pr author:${me} ${filter}`, after });
    for (let i = 1; i < 4 && !d.search.nodes.length && d.search.issueCount > n; i++) {
      await Bun.sleep(i * 5_000);
      d = await gql(QUERY, { q: `is:pr author:${me} ${filter}`, after });
    }
    if (!d.search.nodes.length && d.search.issueCount > n) throw new Error(`GitHub returned an empty page for "${filter}"`);
    for (const node of d.search.nodes) {
      if (!node?.repository) continue;
      const f = factsOf(node, me);
      if (repoInProject(f.ref.split("#")[0])) upsert.run(f.ref, f.created, JSON.stringify(f));
      n++;
    }
    after = d.search.pageInfo.hasNextPage ? d.search.pageInfo.endCursor : null;
  } while (after);
  return n;
}

let running: Promise<void> | null = null;

/** Backfills month by month the first time, then pulls whatever was updated since the last sync. */
export function syncHistory(): Promise<void> {
  running ??= (async () => {
    const started = new Date().toISOString();
    const last = load<number>("history_version") === FACTS_VERSION ? load<string>("history_synced") : null;
    if (!last) {
      const now = new Date();
      for (let m = new Date(`${METRICS_FROM}T00:00:00Z`); m < now; m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))) {
        const end = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1));
        await pull(`created:${m.toISOString().slice(0, 10)}..${new Date(end.getTime() - 86_400_000).toISOString().slice(0, 10)}`);
      }
    } else {
      // A day of overlap: GitHub's search index lags a little.
      await pull(`updated:>=${new Date(Date.parse(last) - 86_400_000).toISOString().slice(0, 10)}`);
    }
    save("history_synced", started);
    save("history_version", FACTS_VERSION);
  })().catch((e) => console.error(new Date().toISOString(), "history sync failed:", (e as Error).message))
    .finally(() => { running = null; });
  return running;
}

export function historySyncedAt(): string | null {
  return load<string>("history_synced");
}

export function prFacts(): PrFacts[] {
  return db.query<{ facts: string }, []>("SELECT facts FROM pr_facts ORDER BY created").all().map((r) => JSON.parse(r.facts));
}

/** Syncs now, then every EVERY_MS; a failed sync tries again after RETRY_MS. */
export function startHistory() {
  if (DEV && !POLL) return;
  setInterval(() => {
    const last = historySyncedAt();
    if (!last || Date.now() - Date.parse(last) >= EVERY_MS) void syncHistory();
  }, RETRY_MS);
  void syncHistory();
}
