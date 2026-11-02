// Unattended signal-to-pr runs: remembered when the Start box starts one, read back from the
// skill's run folder (~/work-loop/<id>/) when the agent finishes, dismissed by the user.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Run } from "../shared/types";
import { JIRA } from "./config";
import { load, save } from "./db";
import { note, read, write } from "./runner";
import { errorKey } from "./workitems";

const ROOT = join(homedir(), "work-loop");
const MAX_FILE = 40_000;

export const runs = () => new Map(Object.entries(load<Record<string, Run>>("runs") ?? {}));

export function addRun(key: string, agent: string) {
  save("runs", { ...Object.fromEntries(runs()), [key]: { key, at: new Date().toISOString(), agent } satisfies Run });
}



export function dismissRun(key: string, item: string | null) {
  const all = runs();
  all.delete(key);
  save("runs", Object.fromEntries(all));
  note({ item, trigger: "run review" }, "dismiss-run", key, "dismissed");
}

/** The run's folder: named by the key, by a Sentry id's last two parts, else the newest one started after the run. */
export function runDir(run: Run): string | null {
  const tail = errorKey(run.key) === run.key ? run.key.split("-").slice(-2).join("-") : null;
  for (const name of [run.key, tail]) if (name && existsSync(join(ROOT, name))) return join(ROOT, name);
  if (!existsSync(ROOT)) return null;
  const since = Date.parse(run.at);
  const fresh = readdirSync(ROOT).map((n) => join(ROOT, n))
    .filter((p) => { const s = statSync(p); return s.isDirectory() && s.birthtimeMs >= since; })
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  return fresh[0] ?? null;
}

/** What the run left: each text file in its folder, newest first. */
export function runFiles(run: Run) {
  const dir = runDir(run);
  if (!dir) return { dir: null, files: [] };
  const files = readdirSync(dir).filter((n) => /\.(md|txt)$/.test(n)).map((name) => {
    const p = join(dir, name);
    const text = readFileSync(p, "utf8");
    return { name, at: statSync(p).mtime.toISOString(), text: text.length > MAX_FILE ? text.slice(0, MAX_FILE) + "\n[…]" : text };
  }).sort((a, b) => b.at.localeCompare(a.at));
  return { dir, files };
}

/** Posts a drafted Jira comment from the run folder. Teammates see it, so the UI confirms first. */
export async function postComment(run: Run, file: string, trackerKey: string, item: string | null) {
  const dir = runDir(run);
  if (!dir || file.includes("/")) throw new Error("no such file in the run");
  const text = readFileSync(join(dir, file), "utf8").trim();
  return write({ item, trigger: "run review" }, "jira-comment", `${trackerKey} from ${file}`,
    () => read(["python3", JIRA, "comment", trackerKey, text]).then(() => "posted"));
}
