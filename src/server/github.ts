import { repoInProject } from "./repos";
import { CLAUDE_DIR } from "./repos";
// The GitHub feed: a 1-point change detector every 2 minutes, prs.py's per-PR
// query for whatever changed, and a full prs.py reconcile every 20 minutes.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { PrRow } from "../shared/types";
import { prRef } from "../shared/types";
import { PRS } from "./config";
import { read } from "./runner";

const DETECTOR = `query {
  mine: search(query: "is:open is:pr archived:false author:@me", type: ISSUE, first: 50) { issueCount
    nodes { ... on PullRequest { number repository { nameWithOwner } updatedAt isInMergeQueue
      commits(last: 1) { nodes { commit { oid statusCheckRollup { state } } } } } } }
  requested: search(query: "is:open is:pr archived:false review-requested:@me", type: ISSUE, first: 50) {
    nodes { ... on PullRequest { number repository { nameWithOwner } updatedAt isDraft author { login } } } }
  reviewed: search(query: "is:open is:pr archived:false reviewed-by:@me -author:@me -review-requested:@me", type: ISSUE, first: 50) {
    nodes { ... on PullRequest { number repository { nameWithOwner } updatedAt } } }
}`;

type Section = "mine" | "requested" | "reviewed";

/** The PRs the user took over, from prs.py's list, as owner/repo#N. */
export function adoptedRefs(): string[] {
  try {
    return readFileSync(join(CLAUDE_DIR, "prs-adopted.txt"), "utf8").split("\n")
      .map((l) => l.trim().split(" ")[0]).filter((k) => k && !k.startsWith("#") && /^[\w.-]+\/[\w.-]+#\d+$/.test(k));
  } catch { return []; }
}
export type Fingerprints = Record<string, { section: Section; fp: string }>;

let user = "";

async function run(cmd: string[], timeoutMs = 60_000): Promise<string> {
  try {
    return await read(cmd, { timeoutMs, ...(user ? { env: { ...process.env, PRS_USER: user } } : {}) });
  } catch (e) {
    throw new Error(`${cmd.slice(0, 3).join(" ")} failed: ${(e as Error).message.slice(0, 400)}`);
  }
}

const prs = (...args: string[]) => run(["python3", PRS, ...args]);

/** Every open PR of the user's and every review request, triaged by prs.py. */
export async function reconcile(): Promise<{ user: string; rows: PrRow[] }> {
  const [m, q] = await Promise.all([prs("--mine", "--json"), prs("--json")]);
  const mine = JSON.parse(m);
  const queue = JSON.parse(q);
  user = mine.user;
  const rows: PrRow[] = [
    ...mine.mine.map((r: PrRow) => ({ ...r, role: "mine" })),
    ...queue.review_requested.map((r: PrRow) => ({ ...r, role: "requested" })),
    ...queue.reviewed_and_updated.map((r: PrRow) => ({ ...r, role: "requested", rereview: true })),
  ];
  // A second filter behind prs.py's: a row of another project never reaches the board.
  return { user, rows: rows.filter((r) => repoInProject(r.repo)) };
}

/** One cheap query: what's open, and a fingerprint that changes when a PR does. */
export async function detect(): Promise<{ fps: Fingerprints; overflow: boolean }> {
  // Taken-over PRs aren't the user's on GitHub, so the searches miss them: ask for each one by name.
  const adopted = adoptedRefs();
  const extra = adopted.map((ref, i) => {
    const [, owner, name, n] = ref.match(/^([^/]+)\/([^#]+)#(\d+)$/)!;
    return `t${i}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { pullRequest(number: ${n}) { number state repository { nameWithOwner } updatedAt isInMergeQueue
      commits(last: 1) { nodes { commit { oid statusCheckRollup { state } } } } } }`;
  }).join("\n");
  const res = JSON.parse(await run(["gh", "api", "graphql", "-f", `query=${extra ? DETECTOR.replace(/}$/, `${extra}\n}`) : DETECTOR}`]));
  if (res.errors) throw new Error(JSON.stringify(res.errors).slice(0, 400));
  const d = res.data;
  const fps: Fingerprints = {};
  const add = (section: Section, n: any, extra = "") => {
    if (!n?.repository) return;
    fps[prRef({ repo: n.repository.nameWithOwner, number: n.number })] = { section, fp: `${n.updatedAt}|${extra}` };
  };
  for (const n of d.mine.nodes) {
    const c = n?.commits?.nodes?.[0]?.commit;
    add("mine", n, `${c?.oid}|${c?.statusCheckRollup?.state}|${n.isInMergeQueue}`);
  }
  for (const n of d.requested.nodes) if (!(n?.isDraft && n.author?.login !== user)) add("requested", n);
  for (const n of d.reviewed.nodes) add("reviewed", n);
  // Last, so a taken-over PR that's also a review request counts as the user's.
  for (let i = 0; i < adopted.length; i++) {
    const n = d[`t${i}`]?.pullRequest;
    if (n?.state !== "OPEN") continue;
    const c = n.commits?.nodes?.[0]?.commit;
    add("mine", n, `${c?.oid}|${c?.statusCheckRollup?.state}|${n.isInMergeQueue}`);
  }
  return { fps, overflow: d.mine.issueCount > 50 };
}

/** One PR, re-triaged. Null when it no longer belongs on the board. */
export async function fetchOne(ref: string, section: Section): Promise<PrRow | null> {
  if (!repoInProject(ref.split("#")[0])) return null;
  const { pr } = JSON.parse(await prs("pr", ref, "--json"));
  if (!pr.open || pr.excluded) return null;
  if (section === "reviewed") {
    const moved = (pr.prior === "changes_requested" || pr.prior === "commented") && pr.pushed_since;
    return moved ? { ...pr, rereview: true } : null;
  }
  return pr;
}

/** Whether a PR is open, merged or closed, and when it stopped being open. */
export async function prState(ref: string): Promise<{ state: "open" | "merged" | "closed"; at: string | null }> {
  const [repo, n] = ref.split("#");
  const r = JSON.parse(await run(["gh", "api", `repos/${repo}/pulls/${n}`, "--jq", "{state, merged_at, closed_at}"]));
  return r.merged_at ? { state: "merged", at: r.merged_at } : r.state === "closed" ? { state: "closed", at: r.closed_at } : { state: "open", at: null };
}

/** How many commits `p`'s base has that its head doesn't. */
export async function behindBy(p: PrRow): Promise<number> {
  const out = await run(["gh", "api", `repos/${p.repo}/compare/${encodeURIComponent(p.base)}...${p.head}`, "--jq", ".behind_by"]);
  return Number(out.trim()) || 0;
}

/** Which refs need a refetch, and which have left the board. */
export function diff(prev: Fingerprints, next: Fingerprints) {
  const dirty = Object.keys(next).filter((k) => prev[k]?.fp !== next[k].fp || prev[k]?.section !== next[k].section);
  const gone = Object.keys(prev).filter((k) => !next[k]);
  return { dirty, gone };
}
