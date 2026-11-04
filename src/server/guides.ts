// Field guides: a page a review agent writes beside its drafts for a PR the user was asked to review, or
// for one of his own when it self-reviews it before his reviewers see it.
// It walks the change (flows, dependencies, anything measured, where bugs can hide) and every claim in it
// was checked by running code. The control room serves it locally, starts the agent on its own when
// a request lands or the author pushes, and promotes a guide to a claude.ai artifact on request.
import { existsSync, readFileSync } from "node:fs";
import type { GuideView, PrRow, WorkItem } from "../shared/types";
import { prRef } from "../shared/types";
import { load, save } from "./db";
import { read, write } from "./runner";
import { linkedGuide } from "./guidelinks";
import { startAgent } from "./handoff";
import { guideFile, guidePath, metaFile, personasFor, reviewPrompt } from "./review";

/** Agents running guides at once, at most; each is a full review. */
export const MAX_GUIDES = 2;

type Meta = { sha: string; at: string; url?: string };

function meta(ref: string): Meta | null {
  if (!existsSync(guideFile(ref)) || !existsSync(metaFile(ref))) return null;
  try { const m = JSON.parse(readFileSync(metaFile(ref), "utf8")); return m?.sha ? m : null; }
  catch { return null; } // half-written: read it next time
}

let linked: Record<string, string> = load<Record<string, string>>("guide_links") ?? {};

/** What the board shows for each PR with a guide. */
export function guideViews(it: WorkItem): GuideView[] {
  return it.prs.flatMap((p) => {
    const m = meta(prRef(p));
    return m ? [{ ref: prRef(p), path: guidePath(prRef(p)), sha: m.sha, at: m.at, stale: !(p.head.startsWith(m.sha) || m.sha.startsWith(p.head)), url: m.url ?? null,
      ...(p.role === "mine" ? { mine: true, linked: !!m.url && linked[prRef(p)] === m.url } : {}) }] : [];
  });
}

/** Adds each item's guides, and makes reading a current one the ⏎ on a review request. */
export function applyGuides(items: WorkItem[]): WorkItem[] {
  return items.map((it) => {
    const guide = guideViews(it);
    if (!guide.length) return it;
    const fresh = it.keyKind === "review" && !it.primary.agent ? guide.find((g) => !g.stale && g.ref === it.primary.pr) ?? guide.find((g) => !g.stale) : undefined;
    return { ...it, guide, ...(fresh ? { primary: { label: `Read the field guide to #${fresh.ref.split("#")[1]}`, url: fresh.path, pr: fresh.ref } } : {}) };
  });
}

/**
 * Reviews to start now, at most MAX_GUIDES running: requested PRs with no current guide and none
 * started for this head; and each of the user's own PRs once, a self-review before his reviewers look.
 * `selfDone` holds his PRs already self-reviewed (or there before self-review existed).
 */
export function toGuide(items: WorkItem[], started: Record<string, string>, lowMemory: boolean, selfDone: Record<string, string> = {}): { it: WorkItem; p: PrRow; own: boolean }[] {
  if (lowMemory) return [];
  const running = items.flatMap((it) => it.agents).filter((a) => a.status === "working" && /^(self)?review /.test(a.label)).length;
  const out: { it: WorkItem; p: PrRow; own: boolean }[] = [];
  for (const it of items) {
    if (it.lane === "parked" || it.agents.some((a) => a.status === "working" || a.status === "blocked")) continue;
    for (const p of it.prs) {
      if (p.role === "mine") {
        if (!selfDone[prRef(p)] && !p.merge_queue) out.push({ it, p, own: true });
        continue;
      }
      if (p.role !== "requested" || p.draft || started[prRef(p)] === p.head) continue;
      const g = it.guide?.find((x) => x.ref === prRef(p));
      if (g && !g.stale) continue;
      out.push({ it, p, own: false });
    }
  }
  // Someone waiting on a review comes before the user's own.
  return out.sort((a, b) => Number(a.own) - Number(b.own)).slice(0, Math.max(0, MAX_GUIDES - running));
}

let started: Record<string, string> = load<Record<string, string>>("guides") ?? {};
// The user's PRs self-reviewed: ref → the head it ran on. Null until the first pass, which counts every
// PR already open as done, so turning this on doesn't queue a review of each.
let selfDone: Record<string, string> | null = load<Record<string, string>>("selfreviews");
let busy = false;
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

/** Starts review agents for the guides that are due. */
export async function startGuides(items: WorkItem[], lowMemory: boolean, publish: () => void) {
  if (busy) return;
  busy = true;
  if (!selfDone) {
    selfDone = Object.fromEntries(items.flatMap((it) => it.prs).filter((p) => p.role === "mine").map((p) => [prRef(p), "before self-review"]));
    save("selfreviews", selfDone);
  }
  const due = toGuide(items, started, lowMemory, selfDone);
  try {
    for (const { it, p, own } of due) {
      if (own) selfDone[prRef(p)] = p.head;
      else started[prRef(p)] = p.head;
      save("guides", started);
      save("selfreviews", selfDone);
      try {
        await startAgent({ item: it.id, repo: p.repo, pr: prRef(p), kind: own ? "selfreview" : "review", prompt: reviewPrompt(p, personasFor(p), own), edited: false });
        log(`${own ? "self-review" : "field guide"} started on ${prRef(p)} at ${p.head.slice(0, 7)}`);
      } catch (e) {
        log(`field guide on ${prRef(p)} failed to start:`, (e as Error).message);
        // Refused or failed: not done, so the next pass tries again.
        if (own) delete selfDone[prRef(p)]; else delete started[prRef(p)];
        save("guides", started);
        save("selfreviews", selfDone);
      }
    }
  } finally {
    busy = false;
  }
  if (due.length) publish();
}

// An agent wrote the page from someone else's PR, so it runs sandboxed: an opaque origin with no way
// to the board's API, and scripts only from the mermaid CDN.
const CSP = "sandbox allow-scripts allow-popups allow-popups-to-escape-sandbox; default-src 'none'; script-src 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src data:; connect-src 'none'";

/** The guide page, for the /guide route, with the code it names linked to GitHub (guidelinks.ts). */
export async function guidePage(ref: string): Promise<Response> {
  const f = guideFile(ref);
  if (!/^[\w.-]+\/[\w.-]+#\d+$/.test(ref) || !existsSync(f)) return new Response("no guide for that PR yet", { status: 404 });
  const html = await linkedGuide(f, ref.split("#")[0], meta(ref)?.sha ?? null).catch(() => readFileSync(f, "utf8"));
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": CSP } });
}

/** Opens an agent that publishes the guide as a private claude.ai artifact and records its link. */
export async function promoteGuide(item: string, p: PrRow) {
  const ref = prRef(p);
  if (!meta(ref)) throw new Error("no guide for that PR yet");
  return startAgent({
    item, repo: p.repo, pr: ref, kind: "custom", edited: false,
    prompt: `Publish my field guide to PR ${ref} as a private artifact. The page is done: \`${guideFile(ref)}\`. Read it, then publish it with your Artifact tool as it is, with icon "review" and a one-sentence description of what the PR does. Don't change the page. If the guide JSON at \`${metaFile(ref)}\` already has a "url", publish to that url to update it. Then set "url" in that JSON to the artifact's link, keeping the other keys, and tell me the link.`,
  });
}

/** Adds the shared guide's link to the end of the user's PR body, once: the reviewers' way in. */
export async function linkGuide(p: PrRow): Promise<{ linked: string }> {
  const ref = prRef(p);
  const url = meta(ref)?.url;
  if (!url) throw new Error("promote the guide first; the PR body links its shared page");
  const body = (await read(["gh", "pr", "view", String(p.number), "-R", p.repo, "--json", "body", "--jq", ".body"])).replace(/\s+$/, "");
  if (!body.includes(url)) {
    const next = `${body}\n\nField guide: ${url}`;
    await write({ item: null, trigger: "guide" }, "link-guide", ref,
      () => read(["gh", "pr", "edit", String(p.number), "-R", p.repo, "--body", next]).then(() => "linked"), { drafted: next });
  }
  linked[ref] = url;
  save("guide_links", linked);
  return { linked: url };
}
