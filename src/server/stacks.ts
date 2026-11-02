// Stacks: a PR of the user's built on another of his that's still in review. Both target the base branch,
// so CI runs on each and the child's diff carries the parent's commits until the parent merges. A stack
// is found from commits (the child contains the parent's head) and remembered by the parent heads the
// child contained, so it holds after the parent moves on; the review loop then brings the parent's
// latest into the child.
import type { PrRow } from "../shared/types";
import { prRef } from "../shared/types";
import { load, save } from "./db";
import { read } from "./runner";

type Known = Record<string, { on: string; heads: string[] }>;
let known: Known = load<Known>("stacks") ?? {};
// `repo|ancestor|head` → whether head contains ancestor. Commits don't change, so it never goes stale.
const contains = new Map<string, boolean>();
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

async function has(repo: string, ancestor: string, head: string): Promise<boolean> {
  if (ancestor === head) return false;
  const k = `${repo}|${ancestor}|${head}`;
  if (contains.has(k)) return contains.get(k)!;
  let out: string;
  try { out = await read(["gh", "api", `repos/${repo}/compare/${ancestor}...${head}`, "--jq", "[.status, .behind_by] | @tsv"]); }
  catch (e) {
    // A commit GitHub no longer has (a force-push) contains nothing; anything else is asked again next time.
    if (/HTTP 404/.test((e as Error).message)) { contains.set(k, false); return false; }
    throw e;
  }
  const [status, behind] = out.trim().split("\t");
  const yes = status === "ahead" && behind === "0";
  contains.set(k, yes);
  return yes;
}

/** Finds which of the user's open PRs build on which; one pass after each poll. */
export async function findStacks(rows: PrRow[]) {
  const mine = rows.filter((p) => p.role === "mine");
  const next: Known = {};
  try {
    for (const c of mine) {
      const ref = prRef(c);
      const others = mine.filter((p) => p.repo === c.repo && p !== c);
      const candidates: PrRow[] = [];
      for (const p of others) {
        const before = known[ref]?.on === prRef(p) ? known[ref].heads : [];
        if (await has(c.repo, p.head, c.head)) candidates.push(p);
        else for (const h of before) if (await has(c.repo, h, c.head)) { candidates.push(p); break; }
      }
      if (!candidates.length) continue;
      // A stack of three: the nearest parent is the candidate that contains the others.
      let parent = candidates[0], best = -1;
      for (const p of candidates) {
        let n = 0;
        for (const q of candidates) if (q !== p && (await has(c.repo, q.head, p.head))) n++;
        if (n > best) { best = n; parent = p; }
      }
      const prev = known[ref]?.on === prRef(parent) ? known[ref].heads : [];
      const heads = (await has(c.repo, parent.head, c.head)) && !prev.includes(parent.head) ? [...prev, parent.head] : prev;
      next[ref] = { on: prRef(parent), heads };
    }
  } catch (e) {
    log("stack check failed:", (e as Error).message);
    return; // keep what was known
  }
  if (JSON.stringify(next) !== JSON.stringify(known)) {
    for (const [c, s] of Object.entries(next)) if (known[c]?.on !== s.on) log(`stack: ${c} builds on ${s.on}`);
    known = next;
    save("stacks", known);
  }
}

/** Adds `stack` to a PR that builds on another open one: its parent, and whether the parent has moved past it. */
export function withStack(rows: PrRow[]): (p: PrRow) => PrRow {
  const byRef = new Map(rows.map((p) => [prRef(p), p]));
  return (p) => {
    const s = known[prRef(p)];
    const parent = s && byRef.get(s.on);
    if (!parent) return p;
    const behind = contains.get(`${p.repo}|${parent.head}|${p.head}`) === false;
    return { ...p, stack: { on: s.on, number: parent.number, branch: parent.branch, head: parent.head, behind } };
  };
}
