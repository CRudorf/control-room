// Review curation (Action flows): a review agent writes its findings as structured drafts pinned
// to the commit it reviewed; the user picks and edits them, and one sheet posts them as a single review.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Draft, PrRow, ReviewDrafts } from "../shared/types";
import { prRef } from "../shared/types";
import { DEV, INSTALLED_STATE_DIR } from "./config";
import { read, write } from "./runner";
import { lessonsFor, TESTS_RULE } from "./lessons";

// Agents always write where the installed app reads, even when a dev server built the prompt.
const DIR = join(INSTALLED_STATE_DIR, "reviews");
mkdirSync(DIR, { recursive: true });

const file = (ref: string) => join(DIR, ref.replace(/[/#]/g, "__") + ".json");
export const draftsFile = file;

// Self-review findings the user dismissed, with why. Kept apart from the drafts so a re-review, which
// rewrites the drafts, keeps them and is told not to raise them again.
const DISMISSED = join(DIR, "dismissed");
mkdirSync(DISMISSED, { recursive: true });
type Dismissal = { path: string; title: string; reason: string; at: string; sha: string };
const dismissedFile = (ref: string) => join(DISMISSED, ref.replace(/[/#]/g, "__") + ".json");
const sameFinding = (a: { path: string; title: string }, b: { path: string; title: string }) => a.path === b.path && a.title === b.title;
export function dismissals(ref: string): Dismissal[] {
  try { return JSON.parse(readFileSync(dismissedFile(ref), "utf8")); } catch { return []; }
}
/** Dismisses one drafted finding with a reason, or with a null reason, brings it back. */
export function dismissFinding(ref: string, id: number, reason: string | null) {
  const d = readDrafts(ref);
  const f = d?.findings.find((x) => x.id === id);
  if (!d || !f) throw new Error("no such finding");
  const rest = dismissals(ref).filter((x) => !sameFinding(x, f));
  const next = reason?.trim() ? [...rest, { path: f.path, title: f.title, reason: reason.trim(), at: new Date().toISOString(), sha: d.sha }] : rest;
  writeFileSync(dismissedFile(ref), JSON.stringify(next, null, 2));
}
/** The findings still open: not dismissed. */
export const openFindings = (d: ReviewDrafts) => d.findings.filter((f) => !f.dismissed);

// Field guides (guides.ts) are written by the same review, beside the drafts.
const GUIDES = join(INSTALLED_STATE_DIR, "guides");
mkdirSync(GUIDES, { recursive: true });
const guideBase = (ref: string) => join(GUIDES, ref.replace(/[/#]/g, "__"));
export const guideFile = (ref: string) => `${guideBase(ref)}.html`;
export const metaFile = (ref: string) => `${guideBase(ref)}.json`;
/** Where the board links a guide; the page is same-origin, so the cookie comes along. */
export const guidePath = (ref: string) => `/guide/${encodeURIComponent(ref)}`;

/** The guide part of a review prompt. */
export function guidePrompt(p: PrRow): string {
  const ref = prRef(p);
  return `Last, write me a field guide to this PR: one self-contained HTML page at \`${guideFile(ref)}\`, then \`${metaFile(ref)}\` as {"sha": "<the commit you reviewed: git rev-parse HEAD>", "at": "<now, ISO 8601>"}. Keep any "url" already in that JSON. If the HTML is already there, it's the guide for an earlier commit: read it first, carry its risks forward, and mark the ones the new commits fixed as Fixed.

The guide is how I understand the PR before reading the diff. Shape it like this:
- Header: an eyebrow line "${p.repo} · PR ${p.number} · head <first 8 of the sha>", a title saying in plain words what the PR does, and two or three sentences on why. Then a legend of the three marks: Confirmed bug, Where bugs can hide, Fixed since first review.
- One numbered section per area the PR changes (a function, a component, a flow), each with:
  - the file it lives in and who calls it, in a sentence or two
  - "The flow": a mermaid flowchart of how it runs, branches included
  - "The dependencies" (or "State and who touches it"): a table of what decides what, and the rule
  - anything you measured, drawn to scale as inline SVG with the numbers you logged and what you ran to get them
  - "Where bugs can happen here": cards marked Bug (one of your verified findings: the input, the output, file:line), Watch (where one could hide and why, file:line), or Fixed (since the earlier guide)
- "How this was checked": the tests, runs and measurements, with counts and the commit.

Write plainly, short sentences, no em dashes. Only claims you checked by running code. Every file, function or line you name links to it on GitHub at the commit you reviewed: \`<a href="https://github.com/${p.repo}/blob/<sha>/<path>#L12-L20"><code>file.ts:12-20</code></a>\`. Code in another repo links to that repo at the commit you read it at.

Page rules: colors as CSS variables on :root, with a dark set under @media (prefers-color-scheme: dark); fonts from Google Fonts are fine; mermaid only from https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js; nothing else external; readable at 375px wide.`;
}

/** Reviewers a review runs as: three for a change whose complexity is deep or critical, else two. */
export const personasFor = (p: PrRow) => (p.complexity?.tier === "deep" || p.complexity?.tier === "critical" ? 3 : 2);

/** A review of someone else's PR, or with `own`, a self-review of the user's before his reviewers see it. */
export function reviewPrompt(p: PrRow, personas: number, own = false): string {
  const ref = `${p.repo}#${p.number}`;
  return `Run a ${personas} person multi-persona review on ${own ? "my own " : ""}PR ${ref} ("${p.title}")${own ? ", before my reviewers see it: be the reviewers I'm about to get, including the review bots (CodeRabbit and the like), and find what they would" : ""}. Check it out in your worktree first: \`git fetch origin pull/${p.number}/head && git switch --detach FETCH_HEAD\` (plain git works in the sandbox; \`gh pr checkout\` fails TLS there). Any finding gets verified locally and empirically by running actual code; note the input and output that confirm it. Drop findings you can't confirm. ${TESTS_RULE}

${own && lessonsFor(p.repo).length ? `My merged PRs in this repo have broken things before. Check this one can't do the same, and make each that applies a finding:\n${lessonsFor(p.repo).map((l) => `- ${l.text} (${l.ref.split("/").pop()}${l.files?.length ? `, in ${l.files.join(", ")}` : ""})`).join("\n")}\n\n` : ""}${own && dismissals(ref).length ? `I've dismissed these findings before. Don't raise them again unless the reason no longer holds:\n${dismissals(ref).map((x) => `- ${x.title} (${x.path}): ${x.reason}`).join("\n")}\n\n` : ""}${own ? "Then draft the findings for me to fix, each body saying what's wrong and the fix. Make no code changes, push nothing and post nothing to the PR." : "Then draft the findings to pass on as a code reviewer, as inline comments on the PR. Make no code changes and post nothing to the PR."}

Write the drafts as JSON to \`${file(ref)}\` (create the folder if needed), replacing any earlier file:

{"pr": "${ref}", "sha": "<the commit you reviewed: git rev-parse HEAD>", "findings": [
  {"path": "src/x.ts", "line": 42, "start_line": null, "rank": "blocking|important|should-do|nit", "title": "short label", "body": "the comment exactly as it should appear on the PR"}
]}

\`line\` is the line in the new version of the file and must be inside the PR's diff; \`start_line\` is set only for a multi-line range. Rank with blocking / important / should-do / nit, most severe first. The rank goes in its field only: never put it, or a label like "Nit:", in the body. Then give me the same findings as a short list here. ${PERSONAS_WAIT}

${guidePrompt(p)}`;
}

const PERSONAS_WAIT = "Wait until every persona has reported before you write the drafts or answer me; never report while one is still running.";

/** Marks a review prompt that continues an earlier review rather than starting over; its session keeps its context. */
export const DELTA_MARK = "since your review at";
const sameHead = (a: string, b: string) => !!a && !!b && (a.startsWith(b) || b.startsWith(a));

/** A re-review: what changed since the drafts' commit, checked against the findings already drafted or posted. */
export function deltaPrompt(p: PrRow, d: ReviewDrafts, own = false): string {
  const ref = prRef(p);
  return `PR ${ref} ("${p.title}") moved ${DELTA_MARK} ${d.sha.slice(0, 8)}; its head is now ${p.head.slice(0, 8)}. Don't review it from scratch. In your worktree: \`git fetch origin pull/${p.number}/head && git switch --detach FETCH_HEAD && git diff ${d.sha}..${p.head}\`.

1. Read \`${file(ref)}\`${d.posted ? ` (posted ${d.posted.at.slice(0, 10)} as ${d.posted.event.toLowerCase()})` : ""}. For each finding, check it against the new code by running it: drop the ones the new commits fixed, keep the rest.
2. Review only the new commits, as the same personas, and add a finding for each new problem you can confirm by running code. Check that no test was weakened, skipped or deleted to make a finding go away.
3. Rewrite the drafts file pinned to the new commit (\`git rev-parse HEAD\`), same shape as before.${own ? " Make no code changes, push nothing and post nothing." : " Post nothing to the PR."}
4. Update the field guide at \`${guideFile(ref)}\` the same way: mark what the new commits fixed as Fixed.

${PERSONAS_WAIT} Then tell me in a short list: fixed, still open, new.`;
}

/**
 * The prompt a review start gets: a delta when an earlier review left drafts at another commit, else the
 * full review. Null: the drafts are already at the PR's head, so there's nothing new to review.
 */
export function reviewStart(p: PrRow, personas: number, own = false, d: ReviewDrafts | null = readDrafts(prRef(p))): string | null {
  if (!d?.sha || d.error) return reviewPrompt(p, personas, own);
  if (sameHead(d.sha, p.head)) return null;
  return deltaPrompt(p, d, own);
}

/** A drafted body without a rank label in front: the rank is for the user, not the author. */
export function stripRank(body: string): string {
  // A label is the rank word with a delimiter after it: "Nit:", "[nit]", "**Important:**", "nitpick -".
  return body.replace(/^\s*(?:\*\*|\[|\()?\s*(?:blocking|important|should[- ]do|nit(?:pick)?)\s*(?:(?:\*\*|\]|\))\s*[:\-–]?|[:\-–])\s*(?:\*\*)?\s*/i, "");
}

export type Proposal = { event: "COMMENT" | "APPROVE" | "REQUEST_CHANGES"; picked: number[]; summary: string; why: string };

/**
 * The verdict a review's drafts call for, in the user's usual shape: a blocking finding requests changes
 * with everything but nits inline; otherwise approve, with important and should-do inline while the
 * drafts match the head, and the rest named in a short non-blocking summary.
 */
export function proposeVerdict(d: ReviewDrafts, pushedSince = false, outside: number[] = []): Proposal {
  const open = openFindings(d);
  const inline = (f: Draft) => !outside.includes(f.id) && !pushedSince;
  const blocking = open.filter((f) => f.rank === "blocking");
  if (blocking.length) {
    const picked = open.filter((f) => f.rank !== "nit" && inline(f)).map((f) => f.id);
    return { event: "REQUEST_CHANGES", picked, summary: "", why: `${blocking.length} blocking` };
  }
  const picked = open.filter((f) => (f.rank === "important" || f.rank === "should-do") && inline(f)).map((f) => f.id);
  const rest = open.filter((f) => !picked.includes(f.id));
  const summary = rest.length ? `Approving. Non-blocking:\n${rest.map((f) => `- ${f.title} (\`${f.path}:${f.line}\`)`).join("\n")}` : "";
  return { event: "APPROVE", picked, summary, why: open.length ? "nothing blocking" : "no findings" };
}

const RANKS = ["blocking", "important", "should-do", "nit"];

export function readDrafts(ref: string): ReviewDrafts | null {
  const f = file(ref);
  if (!existsSync(f)) return null;
  try {
    const d = JSON.parse(readFileSync(f, "utf8"));
    const gone = dismissals(ref);
    const findings: Draft[] = (d.findings ?? []).map((x: any, i: number) => {
      const f: Draft = {
        id: i, path: String(x.path ?? ""), line: Number(x.line) || 0, start_line: x.start_line ? Number(x.start_line) : null,
        rank: RANKS.includes(x.rank) ? x.rank : "should-do", title: String(x.title ?? ""), body: String(x.body ?? ""),
      };
      const g = gone.find((y) => sameFinding(y, f));
      return g ? { ...f, dismissed: { reason: g.reason, at: g.at } } : f;
    }).sort((a: Draft, b: Draft) => RANKS.indexOf(a.rank) - RANKS.indexOf(b.rank));
    return { pr: ref, sha: String(d.sha ?? ""), findings, posted: d.posted ?? null };
  } catch (e) {
    return { pr: ref, sha: "", findings: [], posted: null, error: `can't read the drafts: ${(e as Error).message}` };
  }
}

/** Refs with drafts not yet posted, and how many open findings each holds. */
export function pendingDrafts(): Map<string, number> {
  const out = new Map<string, number>();
  for (const name of readdirSync(DIR).filter((n) => n.endsWith(".json"))) {
    const ref = name.slice(0, -5).replace("__", "/").replace("__", "#");
    const d = readDrafts(ref);
    const n = d ? openFindings(d).length : 0;
    if (d && !d.posted && n) out.set(ref, n);
  }
  return out;
}

const run = (cmd: string[], input?: string) => read(cmd, { input });

// The new-side lines each file's diff touches at a commit: a comment can only land on one of these.
const diffCache = new Map<string, Map<string, Set<number>>>();
export async function diffLines(p: PrRow, sha: string): Promise<Map<string, Set<number>>> {
  const key = `${p.repo}#${p.number}@${sha}`;
  if (diffCache.has(key)) return diffCache.get(key)!;
  const files = JSON.parse(await run(["gh", "api", "--paginate", "--slurp", `repos/${p.repo}/pulls/${p.number}/files?per_page=100`])).flat() as { filename: string; patch?: string }[];
  const map = new Map<string, Set<number>>();
  for (const f of files) {
    const lines = new Set<number>();
    let n = 0;
    for (const l of (f.patch ?? "").split("\n")) {
      const h = l.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
      if (h) { n = Number(h[1]); continue; }
      if (l.startsWith("-")) continue;
      lines.add(n);
      n++;
    }
    map.set(f.filename, lines);
  }
  diffCache.set(key, map);
  return map;
}

export type Picked = { id: number; path: string; line: number; start_line: number | null; body: string };

/** Posts the picked drafts as one review on the commit they were written against, with a summary body only when the user kept one. */
export async function postReview(item: string, p: PrRow, drafts: ReviewDrafts, picked: Picked[], event: "COMMENT" | "APPROVE" | "REQUEST_CHANGES", summary = "") {
  const threads = picked.map((c) => ({ path: c.path, line: c.line, side: "RIGHT", ...(c.start_line && c.start_line < c.line ? { startLine: c.start_line, startSide: "RIGHT" } : {}), body: stripRank(c.body) }));
  const body = summary.trim() || undefined;
  const dropped = drafts.findings.filter((f) => !picked.some((c) => c.id === f.id)).map((f) => ({ rank: f.rank, title: f.title }));
  const edited = picked.filter((c) => drafts.findings.find((f) => f.id === c.id)?.body !== c.body).length;
  const query = `mutation($id: ID!, $sha: GitObjectID!, $event: PullRequestReviewEvent!, $threads: [DraftPullRequestReviewThread], $body: String) {
        addPullRequestReview(input: {pullRequestId: $id, commitOID: $sha, event: $event, threads: $threads, body: $body}) { pullRequestReview { url state } } }`;
  const result = await write({ item, trigger: "curation" }, "post-review", `${p.repo}#${p.number}: ${picked.length} comment(s), ${event.toLowerCase()}`, async () => {
    const out = JSON.parse(await run(["gh", "api", "graphql", "--input", "-"], JSON.stringify({ query, variables: { id: p.id, sha: drafts.sha, event, threads, body } })));
    if (out.errors) throw new Error(out.errors.map((e: any) => e.message).join("; "));
    return out.data.addPullRequestReview.pullRequestReview.url as string;
  }, { drafted: JSON.stringify(drafts.findings), detail: { picked, dropped, edited, sha: drafts.sha, summary: body ?? null } });
  if (!DEV) {
    const raw = JSON.parse(readFileSync(file(drafts.pr), "utf8"));
    writeFileSync(file(drafts.pr), JSON.stringify({ ...raw, posted: { at: new Date().toISOString(), url: result, event, count: picked.length } }, null, 2));
  }
  return result;
}
