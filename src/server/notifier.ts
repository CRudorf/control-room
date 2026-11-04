// Sends notification notes through Control Room.app (ADR 0004).
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { WorkItem } from "../shared/types";
import { DEV, PORT } from "./config";
import { load, save } from "./db";
import { note } from "./runner";
import { decide, resume, type Announced, type Note } from "./notify";

export const APP = join(homedir(), "Applications", "Control Room.app");
const BASE = `http://127.0.0.1:${PORT}/`;
const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

// Null until the first announcement after a start, which is a summary (notification rules).
// A restart within the hour (a deploy, a crash) picks up what was announced instead: no
// second summary, and nothing that happened while it was down is lost.
let seen: Set<string> | null = resume(load<Announced>("announced"), Date.now());

export function announce(items: WorkItem[]) {
  const r = decide(items, seen, BASE);
  seen = r.seen;
  save("announced", { at: Date.now(), keys: [...seen] } satisfies Announced);
  for (const n of r.notes) send(n);
}

/** One notification, outside the board's rules: a shipped PR that broke something, say. */
export function send(n: Note) {
  log(`notify${n.loud ? " (sound)" : ""}: ${n.title} | ${n.body}`);
  note({ item: n.thread === "summary" ? null : n.thread, trigger: n.loud ? "sound" : "silent" }, "notify", n.title, n.body);
  if (DEV) return; // dev never notifies (ADR 0005)
  if (!existsSync(APP)) { log(`no ${APP}; run bun run deploy`); return; }
  const args = ["--title", n.title, "--body", n.body, "--url", n.url, "--thread", n.thread, ...(n.loud ? ["--sound"] : [])];
  Bun.spawn(["open", "-n", "-g", APP, "--args", ...args], { stdout: "ignore", stderr: "ignore" });
}
