// Hand-over: a self-review's findings go to the PR's own session (tellagents.ts). Once that session's
// transcript shows it took them (the tell as a user turn, then a reply), the self-review session has
// nothing left to do: it closes, and reap() takes its worktree when nothing in it can be lost.
import { existsSync, readFileSync, statSync } from "node:fs";
import type { Agent, ReviewDrafts, WorkItem } from "../shared/types";
import { prRef } from "../shared/types";
import { closeAgent } from "./herdr";
import { readDrafts } from "./review";
import { ownerOf, selfReviewLine } from "./tellagents";
import { transcriptPath } from "./tasks";

/** True when a transcript has a user turn carrying `line` and an assistant turn after it. */
export function tookIt(transcript: string, line: string): boolean {
  if (!transcript.includes(line)) return false;
  let told = false;
  for (const l of transcript.split("\n")) {
    if (!l) continue;
    let e: any;
    try { e = JSON.parse(l); } catch { continue; }
    if (!told && e.type === "user") {
      const c = e.message?.content;
      const text = typeof c === "string" ? c : Array.isArray(c) ? c.map((b: any) => (typeof b?.text === "string" ? b.text : "")).join("\n") : "";
      if (text.includes(line)) told = true;
    } else if (told && e.type === "assistant") return true;
  }
  return false;
}

const reviewerOf = (agents: Agent[], ref: string) => {
  const short = `${ref.split("/").pop()}`.toLowerCase();
  return agents.find((a) => a.label.toLowerCase() === `selfreview ${short}`) ?? null;
};

export type Close = { item: string; pane: string; ref: string; sha: string };

/**
 * Self-review sessions whose findings the PR's owner has taken: idle, with an owner whose transcript
 * shows the tell and a reply. Pure; `draftsOf` and `transcriptOf` read the files.
 */
export function reviewersToClose(items: WorkItem[], draftsOf: (ref: string) => ReviewDrafts | null, transcriptOf: (a: Agent) => string | null): Close[] {
  const out: Close[] = [];
  for (const it of items) {
    for (const p of it.prs) {
      if (p.role !== "mine") continue;
      const r = reviewerOf(it.agents, prRef(p));
      if (!r || r.status === "working" || r.status === "blocked") continue;
      const d = draftsOf(prRef(p));
      if (!d?.sha) continue;
      const owner = ownerOf(p, it.agents);
      if (!owner || owner.pane === r.pane) continue;
      const t = transcriptOf(owner);
      if (t && tookIt(t, selfReviewLine(d))) out.push({ item: it.id, pane: r.pane, ref: prRef(p), sha: d.sha });
    }
  }
  return out;
}

/** Where Claude keeps a session's transcript: its folder is the session's cwd with / and . as -. */
export { transcriptPath };

// A transcript is read again only when it grew.
const cache = new Map<string, { size: number; text: string }>();
function transcriptOf(a: Agent): string | null {
  const f = transcriptPath(a);
  if (!f || !existsSync(f)) return null;
  const size = statSync(f).size, c = cache.get(f);
  if (c?.size === size) return c.text;
  const text = readFileSync(f, "utf8");
  cache.set(f, { size, text });
  return text;
}

// Each session and commit is closed once; a failed close is tried again on a later publish.
const closed = new Set<string>();
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

/** Closes each self-review session whose findings were handed over. */
export function closeHandedReviewers(items: WorkItem[]) {
  for (const c of reviewersToClose(items, readDrafts, transcriptOf)) {
    const key = `${c.pane}@${c.sha}`;
    if (closed.has(key)) continue;
    closed.add(key);
    closeAgent(c.pane, c.item)
      .then(() => log(`self-review of ${c.ref} at ${c.sha.slice(0, 7)} handed over: closed its session`))
      .catch((e) => { closed.delete(key); log(`closing the self-review of ${c.ref} failed:`, (e as Error).message); });
  }
}
