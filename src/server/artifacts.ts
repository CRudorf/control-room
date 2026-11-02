// Artifacts: the files a work item left outside git (handoff docs, signal-to-pr run folders, demo
// GIFs and recordings), found by the key in their names and opened on the Mac from the detail.
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Artifact, WorkItem } from "../shared/types";
import { errorKey } from "./workitems";

const HOME = homedir();
const HANDOFFS = join(HOME, "handoffs");
const RUNS = join(HOME, "work-loop");
const MEDIA = [join(HOME, "Downloads"), join(HOME, "Desktop"), RUNS];
const MEDIA_EXT = /\.(gif|mp4|mov|webm|png)$/i;
const EVERY_MS = 5 * 60_000;
const JIRA = /(?<![A-Z0-9-])([A-Z][A-Z0-9]+-\d+)(?![A-Z0-9])/g;

/** The keys a file name mentions: a Sentry id, else Jira keys. */
export function keysIn(name: string): string[] {
  const upper = name.toUpperCase();
  const sentry = errorKey(upper);
  return [...new Set([...(sentry ? [sentry] : []), ...[...(sentry ? upper.replace(sentry, " ") : upper).matchAll(JIRA)].map((m) => m[1])])];
}

/** The names a work item's files can go by: its key, its Sentry id's tail, and its PRs' Jira keys. */
export function namesFor(it: Pick<WorkItem, "key" | "prs">): string[] {
  const out = new Set([it.key.toUpperCase()]);
  if (errorKey(it.key) === it.key) out.add(it.key.split("-").slice(-2).join("-"));
  for (const p of it.prs) for (const k of keysIn(p.title)) out.add(k);
  return [...out];
}

function list(dir: string, depth: number, visit: (path: string, name: string, isDir: boolean) => void) {
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) continue;
    const path = join(dir, name);
    let isDir = false;
    try { isDir = statSync(path).isDirectory(); } catch { continue; }
    visit(path, name, isDir);
    if (isDir && depth > 1) list(path, depth - 1, visit);
  }
}

let index = new Map<string, Artifact[]>();
let paths = new Set<string>();

function rebuild() {
  const next = new Map<string, Artifact[]>();
  const add = (keys: string[], a: Artifact) => { for (const k of keys) next.set(k, [...(next.get(k) ?? []), a]); };
  const at = (p: string) => statSync(p).mtime.toISOString();
  list(HANDOFFS, 1, (path, name, isDir) => { if (!isDir && name.endsWith(".md")) add(keysIn(name), { kind: "handoff", name, path, at: at(path) }); });
  // A run folder is named by its key, or a Sentry id's tail (API-1V).
  list(RUNS, 1, (path, name, isDir) => { if (isDir) add([name.toUpperCase(), ...keysIn(name)], { kind: "run", name: `${name}/`, path, at: at(path) }); });
  for (const dir of MEDIA) list(dir, 2, (path, name, isDir) => { if (!isDir && MEDIA_EXT.test(name)) add(keysIn(name), { kind: "media", name, path, at: at(path) }); });
  for (const as of next.values()) as.sort((a, b) => b.at.localeCompare(a.at));
  index = next;
  paths = new Set([...next.values()].flat().map((a) => a.path));
}

/** A work item's artifacts, newest first, each once. */
export function artifactsFor(it: WorkItem): Artifact[] {
  const seen = new Set<string>();
  return namesFor(it).flatMap((k) => index.get(k) ?? []).filter((a) => !seen.has(a.path) && seen.add(a.path))
    .sort((a, b) => b.at.localeCompare(a.at));
}

/** Opens an artifact with its default app (a folder in Finder). Only indexed paths. */
export async function openArtifact(path: string) {
  if (!paths.has(path)) throw new Error("not an artifact the board knows");
  const code = await Bun.spawn(["open", path]).exited;
  if (code !== 0) throw new Error(`open exited ${code}`);
}

export function startArtifacts(changed: () => void) {
  rebuild();
  setInterval(() => { rebuild(); changed(); }, EVERY_MS);
}
