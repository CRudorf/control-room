// Deploying from inside the control room (ADR 0005): an agent's sandbox can't run launchctl, write
// ~/Library or drive Chrome for the layout check, so the running server does it. It only ever ships
// GitHub's main: it fetches main into the clone the install came from, takes bin/deploy.sh from that
// commit, and runs it detached in its own session, so the restart it ends with doesn't kill it.
// `bun run ship` starts it and waits for the new server to answer with the new commit.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEV, ROOT, STATE_DIR } from "./config";
import { note, read } from "./runner";

const LOG = join(STATE_DIR, "deploy.log");
const SCRIPT = join(STATE_DIR, "deploy.sh");
const STATE = join(STATE_DIR, "deploy.json");

type Deploy = { pid: number; at: string; target: string };

const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const state = (): Deploy | null => { try { return JSON.parse(readFileSync(STATE, "utf8")); } catch { return null; } };

/** The commit running now, what's on GitHub's main, and the last deploy's log. */
export async function deployStatus() {
  const d = state();
  const running = !!d && alive(d.pid);
  const installed = (await read(["git", "-C", ROOT, "rev-parse", "HEAD"]).catch(() => "")).trim();
  const log = existsSync(LOG) ? readFileSync(LOG, "utf8").split("\n").slice(-40).join("\n") : "";
  return { running, installed, target: d?.target ?? null, at: d?.at ?? null, log };
}

/** Starts a deploy of GitHub's main. Refuses while one is running. */
export async function startDeploy(trigger: string) {
  if (DEV) throw new Error("a dev server doesn't deploy; the installed one does");
  const d = state();
  if (d && alive(d.pid)) throw new Error(`a deploy of ${d.target.slice(0, 7)} is already running (since ${d.at})`);
  // The clone the install came from: the app's origin.
  const repo = (await read(["git", "-C", ROOT, "remote", "get-url", "origin"])).trim();
  if (!existsSync(join(repo, ".git"))) throw new Error(`the install's origin isn't a local clone: ${repo}`);
  await read(["git", "-C", repo, "fetch", "-q", "origin", "main"]);
  const target = (await read(["git", "-C", repo, "rev-parse", "origin/main"])).trim();
  // The deploy script from the commit that ships, not whatever the checkout has.
  writeFileSync(SCRIPT, await read(["git", "-C", repo, "show", `${target}:bin/deploy.sh`]), { mode: 0o700 });
  writeFileSync(LOG, `deploying ${target} from ${repo} (${trigger}) at ${new Date().toISOString()}\n`);
  // os.setsid puts it in its own session: launchd's restart of this job leaves it running.
  const py = "import os,sys; os.setsid(); f=os.open(sys.argv[2], os.O_WRONLY|os.O_APPEND|os.O_CREAT); os.dup2(f,1); os.dup2(f,2); os.execvp('bash', ['bash', sys.argv[1]])";
  const p = Bun.spawn(["python3", "-c", py, SCRIPT, LOG], { env: { ...process.env, CR_DEPLOY_REPO: repo, PATH: `${dirname(process.execPath)}:/opt/homebrew/bin:/usr/local/bin:${process.env.PATH ?? "/usr/bin:/bin"}` }, stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  p.unref();
  const rec: Deploy = { pid: p.pid, at: new Date().toISOString(), target };
  writeFileSync(STATE, JSON.stringify(rec));
  note({ item: null, trigger }, "deploy", target.slice(0, 7), "started");
  return rec;
}
