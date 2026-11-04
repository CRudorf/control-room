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
  return `Run a ${personas} person multi-persona review on ${own ? "my own " : ""}PR ${ref} ("${p.title}")${own ? ", before my reviewers see it: be the reviewers I'm about to get, including the review bots (CodeRabbit and the like), and find what they would" : ""}. Check it out in your worktree first: \`gh pr checkout ${p.number} -R ${p.repo}\`. Any finding gets verified locally and empirically by running actual code; note the input and output that confirm it. Drop findings you can't confirm. ${TESTS_RULE}

${own && lessonsFor(p.repo).length ? `My merged PRs in this repo have broken things before. Check this one can't do the same, and make each that applies a finding:\n${lessonsFor(p.repo).map((l) => `- ${l.text} (${l.ref.split("/").pop()}${l.files?.length ? `, in ${l.files.join(", ")}` : ""})`).join("\n")}\n\n` : ""}${own && dismissals(ref).length ? `I've dismissed these findings before. Don't raise them again unless the reason no longer holds:\n${dismissals(ref).map((x) => `- ${x.title} (${x.path}): ${x.reason}`).join("\n")}\n\n` : ""}${own ? "Then draft the findings for me to fix, each body saying what's wrong and the fix. Make no code changes, push nothing and post nothing to the PR." : "Then draft the findings to pass on as a code reviewer, as inline comments on the PR. Make no code changes and post nothing to the PR."}

Write the drafts as JSON to \`${file(ref)}\` (create the folder if needed), replacing any earlier file:

{"pr": "${ref}", "sha": "<the commit you reviewed: git rev-parse HEAD>", "findings": [
  {"path": "src/x.ts", "line": 42, "start_line": null, "rank": "blocking|important|should-do|nit", "title": "short label", "body": "the comment exactly as it should appear on the PR"}
]}

\`line\` is the line in the new version of the file and must be inside the PR's diff; \`start_line\` is set only for a multi-line range. Rank with blocking / important / should-do / nit, most severe first. Then give me the same findings as a short list here.

${guidePrompt(p)}`;
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

/** Posts the picked drafts as one review on the commit they were written against; no summary body. */
export async function postReview(item: string, p: PrRow, drafts: ReviewDrafts, picked: Picked[], event: "COMMENT" | "APPROVE" | "REQUEST_CHANGES") {
  const threads = picked.map((c) => ({ path: c.path, line: c.line, side: "RIGHT", ...(c.start_line && c.start_line < c.line ? { startLine: c.start_line, startSide: "RIGHT" } : {}), body: c.body }));
  const dropped = drafts.findings.filter((f) => !picked.some((c) => c.id === f.id)).map((f) => ({ rank: f.rank, title: f.title }));
  const edited = picked.filter((c) => drafts.findings.find((f) => f.id === c.id)?.body !== c.body).length;
  const query = `mutation($id: ID!, $sha: GitObjectID!, $event: PullRequestReviewEvent!, $threads: [DraftPullRequestReviewThread]) {
        addPullRequestReview(input: {pullRequestId: $id, commitOID: $sha, event: $event, threads: $threads}) { pullRequestReview { url state } } }`;
  const result = await write({ item, trigger: "curation" }, "post-review", `${p.repo}#${p.number}: ${picked.length} comment(s), ${event.toLowerCase()}`, async () => {
    const out = JSON.parse(await run(["gh", "api", "graphql", "--input", "-"], JSON.stringify({ query, variables: { id: p.id, sha: drafts.sha, event, threads } })));
    if (out.errors) throw new Error(out.errors.map((e: any) => e.message).join("; "));
    return out.data.addPullRequestReview.pullRequestReview.url as string;
  }, { drafted: JSON.stringify(drafts.findings), detail: { picked, dropped, edited, sha: drafts.sha } });
  if (!DEV) {
    const raw = JSON.parse(readFileSync(file(drafts.pr), "utf8"));
    writeFileSync(file(drafts.pr), JSON.stringify({ ...raw, posted: { at: new Date().toISOString(), url: result, event, count: picked.length } }, null, 2));
  }
  return result;
}
