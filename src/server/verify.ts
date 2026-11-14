import { CLAUDE_DIR } from "./repos";
import { assertInProject, repoPath } from "./repos";
// Local verification (GLOSSARY: Verification run): one commit of a repo, running on a free port with
// seeded data, and a folder under STATE_DIR/verify/<id>/ that keeps the evidence and every log.
// A profile with `remote` tests an app that already runs on another machine: the run starts no app, checks
// the machine answers, and its stop command brings the folder home and clears the machine.
// A change can span repos: a round records each repo's commit, and a new round for the same work item starts
// from the last round's scripts, data and check list, so a re-run tests the new commits the same way.
// The agent writes results.json. Only the user writes confirm.json, so an agent can't sign off its own work.
import { closeSync, copyFileSync, existsSync, openSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";
import { herdrState } from "./herdr";
import { isDev, note, read, type Ctx } from "./runner";
import { STATE_DIR } from "./config";

export const VERIFY_DIR = join(STATE_DIR, "verify");
const ID = /^[A-Za-z0-9._-]+$/;
const FILE = /^[A-Za-z0-9._ @-]+(\/[A-Za-z0-9._ @-]+)?$/;

export type RunState = "starting" | "running" | "stopped" | "failed";
export type Check = { id: string; title: string; source?: string; criterion?: string; surface?: string; status: "pending" | "testing" | "pass" | "fail" | "not-tested" | "not-compared"; note?: string; evidence?: string[] };
export type Confirm = { verdict: "confirmed" | "rejected"; at: string; note?: string };
export type VerifyRun = {
  id: string; key: string | null; pr: string | null; repo: string; commit: string; state: RunState; step: string | null; error: string | null;
  port: number | null; url: string | null; pid: number | null; worktree: string | null; agent: string | null; startedAt: string; stoppedAt: string | null;
  /** The first login, for the run page. */
  login: { user: string; password: string } | null;
  /** Each seeded account, with the page and the field names a test needs to log in. */
  logins?: Login[];
  /** The Claude Code project folder of the session that tests this run. */
  transcriptDir?: string | null;
  /** The machine the app runs on, for a remote profile. The run has no process of its own here. */
  machine?: string | null;
  /** Every repo in the change and the commit this round tests, `repo` included. */
  commits?: Record<string, string>;
  /** The round this one followed, whose scripts and checks it started from. */
  previous?: string | null;
};

/** A run's state now: a local run whose app has exited has stopped; a remote run lives until it is stopped. */
export const liveState = (r: Pick<VerifyRun, "state" | "machine" | "pid">, isAlive: (pid: number | null) => boolean): RunState =>
  r.state === "running" && !r.machine && !isAlive(r.pid) ? "stopped" : r.state;
export type Stage = { name: string; state: "done" | "now" | "todo" | "failed" };
export type VerifyView = VerifyRun & { checks: Check[]; confirms: Record<string, Confirm>; files: string[]; logEmails: LogEmail[]; session: { pane: string; status: string } | null; stages: Stage[] };

/** What a run is doing now, in the order a run goes. */
export function stagesOf(r: Pick<VerifyRun, "state" | "agent" | "error">, checks: Pick<Check, "id" | "status">[], confirms: Record<string, unknown>, sessionStatus: string | null): Stage[] {
  const verdicts = checks.length > 0 && checks.every((c) => confirms[c.id]);
  const working = sessionStatus === "working" || sessionStatus === "blocked";
  const up = r.state !== "starting" && !(r.state === "failed");
  const reported = checks.length > 0 && !working && !checks.some((c) => c.status === "pending" || c.status === "testing");
  const seq: [string, boolean][] = [["Set up", up || r.agent !== null], ["App up", up], ["Agent testing", reported], ["Your verdicts", verdicts]];
  const at = seq.findIndex(([, done]) => !done);
  return seq.map(([name, done], i) => ({ name, state: done ? "done" : i === at ? (r.state === "failed" ? "failed" : "now") : "todo" }));
}
export type Login = { label: string; path: string; user: string; password: string; userField: string; passwordField: string; permissions?: string };
/**
 * How a repo's app comes up for a run. `remote`: the app already runs on `machine`; `check` must exit 0 when
 * it answers, `url` is where the user opens it, and `stop` runs when the run stops. Commands take {dir} (the
 * run folder) and {id}.
 */
export type Profile = { logins?: Login[]; setup: string[][]; links?: string[]; start: string[]; env?: Record<string, string>; health: string;
  remote?: { machine: string; url: string; check: string[]; stop?: string[] } };

/** The commits of a new round: the last round's, then the repos named now, then the run's own repo. */
export function roundCommits(prev: Pick<VerifyRun, "repo" | "commit" | "commits"> | null, repo: string, commit: string, also: Record<string, string> = {}): Record<string, string> {
  const before = prev ? { [prev.repo]: prev.commit, ...(prev.commits ?? {}) } : {};
  return { ...before, ...also, [repo]: commit };
}
const sameCommits = (a: Record<string, string>, b: Record<string, string>) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

/** The files a round hands to the next: its scripts, data and notes. Evidence, results and verdicts stay with their round. */
const OWN = new Set(["run.json", "results.json", "confirm.json", "log-emails.json", "transcript.jsonl", "transcript.txt", "meta.json"]);
export const carried = (names: string[]) => names.filter((n) => /\.(sh|cjs|mjs|js|ts|py|sql|md|json|txt)$/i.test(n) && !OWN.has(n) && !/\.log$/i.test(n));
/** The checks a new round starts from: the same list, each one pending again, with no note or evidence. */
export const resetChecks = (checks: Check[]): Check[] => checks.map(({ note: _n, evidence: _e, status: _s, ...c }) => ({ ...c, status: "pending" as const }));

const dirOf = (id: string) => { if (!ID.test(id)) throw new Error("bad run id"); return join(VERIFY_DIR, id); };
const readJson = <T,>(f: string, fallback: T): T => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return fallback; } };
const save = (r: VerifyRun) => writeFileSync(join(dirOf(r.id), "run.json"), JSON.stringify(r, null, 1));
const load = (id: string) => readJson<VerifyRun | null>(join(dirOf(id), "run.json"), null);
const alive = (pid: number | null) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch { return false; } };

const settingUp = new Set<string>();

export type LogEmail = { logger: string; message: string; count: number };
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

/** The log lines that hold an email address, grouped by logger and message, with each address masked. The app should not log emails. */
export function findLogEmails(log: string): LogEmail[] {
  const found = new Map<string, LogEmail>();
  for (const line of log.split("\n")) {
    if (line.search(EMAIL) < 0) continue;
    const masked = line.replace(EMAIL, "<email>");
    let logger = "unknown", message = masked.slice(0, 200);
    try { const j = JSON.parse(masked); logger = String(j.name ?? logger); message = String(j.message ?? message).slice(0, 200); } catch {}
    const k = `${logger}|${message}`;
    const f = found.get(k);
    if (f) f.count++; else found.set(k, { logger, message, count: 1 });
  }
  return [...found.values()].sort((a, b) => b.count - a.count);
}

const scanned = new Map<string, number>();
/** Keeps a run's findings in log-emails.json, and reads the log again only when it changed. */
function scanRunLog(id: string): LogEmail[] {
  const log = join(dirOf(id), "server.log"), out = join(dirOf(id), "log-emails.json");
  if (!existsSync(log)) return [];
  const m = statSync(log).mtimeMs;
  if (scanned.get(id) === m && existsSync(out)) return readJson(out, []);
  const found = findLogEmails(readFileSync(log, "utf8"));
  scanned.set(id, m);
  writeFileSync(out, JSON.stringify(found, null, 1));
  return found;
}

/** Every email-logging site that any run saw, for cleaning up later. */
export function trackedLogEmails(): (LogEmail & { runs: string[] })[] {
  const all = new Map<string, LogEmail & { runs: string[] }>();
  for (const r of listRuns()) for (const f of r.logEmails) {
    const k = `${f.logger}|${f.message}`, a = all.get(k);
    if (a) { a.count += f.count; a.runs.push(r.id); } else all.set(k, { ...f, runs: [r.id] });
  }
  return [...all.values()].sort((a, b) => b.count - a.count);
}

/** The Claude Code project folder for a working directory. */
export const projectDirOf = (cwd: string) => join(CLAUDE_DIR, "projects", cwd.replace(/[/.]/g, "-"));

/** A session transcript as text for a person: what was said and which tools ran, with long output cut. */
export function transcriptText(jsonl: string): string {
  const out: string[] = [];
  const cut = (s: string, n = 1500) => (s.length > n ? `${s.slice(0, n)}... (${s.length - n} more)` : s);
  for (const line of jsonl.split("\n")) {
    let d: any;
    try { d = JSON.parse(line); } catch { continue; }
    if (d.type !== "user" && d.type !== "assistant") continue;
    const c = d.message?.content;
    for (const b of typeof c === "string" ? [{ type: "text", text: c }] : Array.isArray(c) ? c : []) {
      if (b.type === "text" && b.text?.trim()) out.push(`[${d.timestamp ?? ""}] ${d.type === "user" ? "USER" : "AGENT"}:\n${cut(b.text, 6000)}`);
      else if (b.type === "tool_use") out.push(`[${d.timestamp ?? ""}] TOOL ${b.name}:\n${cut(JSON.stringify(b.input))}`);
      else if (b.type === "tool_result") out.push(`RESULT:\n${cut(typeof b.content === "string" ? b.content : JSON.stringify(b.content ?? ""))}`);
    }
  }
  return out.join("\n\n") + "\n";
}

const transcriptSeen = new Map<string, number>();
/** Keeps the session's transcript in the run folder, as the raw file and as text, when it changed. */
function syncTranscript(r: VerifyRun) {
  const src = r.transcriptDir ?? (r.agent ? projectDirOf(join(repoPath(r.repo), ".claude", "worktrees", r.agent)) : null);
  if (!src || !existsSync(src)) return;
  const newest = readdirSync(src).filter((f) => f.endsWith(".jsonl")).map((f) => ({ f, m: statSync(join(src, f)).mtimeMs })).sort((a, b) => b.m - a.m)[0];
  if (!newest || newest.m < Date.parse(r.startedAt) || transcriptSeen.get(r.id) === newest.m) return;
  transcriptSeen.set(r.id, newest.m);
  const text = readFileSync(join(src, newest.f), "utf8");
  writeFileSync(join(dirOf(r.id), "transcript.jsonl"), text);
  writeFileSync(join(dirOf(r.id), "transcript.txt"), transcriptText(text));
}

/** Each file in a run folder, one level of subfolder deep. */
function filesIn(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => statSync(join(dir, n)).isDirectory() ? readdirSync(join(dir, n)).map((m) => `${n}/${m}`) : [n]).sort();
}

/** One run with its checks and the user's verdicts. A run whose server died reads as stopped. */
export function getRun(id: string): VerifyView | null {
  const r = load(id);
  if (!r) return null;
  const dir = dirOf(id);
  // Setup runs inside this server, so a restart ends it. A run left "starting" by an earlier server failed.
  if (r.state === "starting" && !settingUp.has(id)) { const failed = { ...r, state: "failed" as const, error: "the control room restarted during setup", step: null, stoppedAt: new Date().toISOString() }; save(failed); return getRun(id); }
  const state = liveState(r, alive);
  syncTranscript(r);
  const logEmails = scanRunLog(id);
  const checks = readJson<{ checks: Check[] }>(join(dir, "results.json"), { checks: [] }).checks ?? [];
  const confirms = readJson<Record<string, Confirm>>(join(dir, "confirm.json"), {});
  const a = r.agent ? herdrState().agents.find((x) => x.name === r.agent) : undefined;
  const session = a ? { pane: a.pane, status: a.status } : null;
  return { ...r, state, checks, confirms, files: filesIn(dir), logEmails, session, stages: stagesOf({ ...r, state }, checks, confirms, session?.status ?? null) };
}

/** The runs, newest first. `key` keeps one work item's. */
export function listRuns(key?: string | null): VerifyView[] {
  if (!existsSync(VERIFY_DIR)) return [];
  const k = key?.toUpperCase();
  return readdirSync(VERIFY_DIR).filter((n) => ID.test(n)).flatMap((n) => { const v = getRun(n); return v ? [v] : []; })
    .filter((v) => !k || v.key?.toUpperCase() === k).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/** A path inside a run folder, or null. It refuses anything that leaves the folder. */
export function runFile(id: string, f: string): string | null {
  if (!ID.test(id) || !FILE.test(f) || f.includes("..")) return null;
  const p = join(VERIFY_DIR, id, f);
  return existsSync(p) ? p : null;
}

/** The end of a log in a run folder. */
export function tail(id: string, f: string, bytes = 16_000): string | null {
  const p = runFile(id, f);
  if (!p) return null;
  const b = readFileSync(p);
  return b.subarray(Math.max(0, b.length - bytes)).toString("utf8");
}

/** The run's overall result for the board. A check counts as passed only when the user confirmed it. */
export function summarize(v: Pick<VerifyView, "checks" | "confirms">) {
  const c = v.checks, ok = (x: Check) => v.confirms[x.id]?.verdict === "confirmed";
  const bad = c.filter((x) => v.confirms[x.id]?.verdict === "rejected" || (x.status === "fail" && !ok(x))).length;
  const open = c.filter((x) => !v.confirms[x.id] && x.status !== "fail").length;
  return { total: c.length, confirmed: c.filter(ok).length, failing: bad, open };
}

export function setConfirm(ctx: Ctx, id: string, check: string, verdict: Confirm["verdict"] | null, text = "") {
  const f = join(dirOf(id), "confirm.json");
  const all = readJson<Record<string, Confirm>>(f, {});
  if (verdict) all[check] = { verdict, at: new Date().toISOString(), ...(text ? { note: text } : {}) }; else delete all[check];
  writeFileSync(f, JSON.stringify(all, null, 1));
  note(ctx, "verify-confirm", `${id}: ${check}`, verdict ?? "cleared");
}

/** Confirms each check the agent passed that has no verdict yet. Fails and open items stay for the user. */
export function confirmPassing(ctx: Ctx, id: string): number {
  const v = getRun(id);
  if (!v) throw new Error("no such run");
  const all = { ...v.confirms };
  const at = new Date().toISOString();
  const open = v.checks.filter((c) => c.status === "pass" && !all[c.id]);
  for (const c of open) all[c.id] = { verdict: "confirmed", at, note: "confirm all passing" };
  writeFileSync(join(dirOf(id), "confirm.json"), JSON.stringify(all, null, 1));
  note(ctx, "verify-confirm", id, `confirmed ${open.length} passing`);
  return open.length;
}

export const profileFor = (repo: string): Profile | null =>
  readJson<Profile | null>(join(homedir(), ".config", "control-room", "verify", `${repo.split("/").pop()}.json`), null);

/** 32 random bytes in URL-safe base64 with padding, as Fernet requires. */
export const fernetKey = () => randomBytes(32).toString("base64").replace(/\+/g, "-").replace(/\//g, "_");

export const fill = (s: string, v: Record<string, string>) => s.replace(/\{(\w+)\}/g, (m, k) => v[k] ?? m);

const freePort = () => new Promise<number>((res, rej) => {
  const s = createServer(); s.once("error", rej);
  s.listen(0, "127.0.0.1", () => { const a = s.address(); const p = typeof a === "object" && a ? a.port : 0; s.close(() => res(p)); });
});

/** Runs one setup command in the user's login shell, so uv and npm resolve under launchd. Output is added to the end of the log. */
export async function sh(cmd: string[], cwd: string, log: string, env: Record<string, string> = {}) {
  const fd = openSync(log, "a");
  const p = Bun.spawn(["/bin/zsh", "-lc", 'exec "$@"', "--", ...cmd], { cwd, env: { ...process.env, ...env }, stdout: fd, stderr: fd });
  const code = await p.exited.finally(() => closeSync(fd));
  if (code !== 0) throw new Error(`${cmd.join(" ")} exited ${code}. See ${log.split("/").pop()}`);
}

const short = (repo: string) => repo.split("/").pop()!;

/** Starts a run: returns at once with the id, and the setup continues in the background. Dev records it and starts nothing. */
export async function startRun(o: { repo: string; ref: string; also?: { repo: string; ref: string }[]; key: string | null; pr: string | null; item: string | null; cwd?: string | null; agentPrompt?: (dir: string, id: string) => string; start?: (id: string, prompt: string) => Promise<{ name: string }> }) {
  assertInProject(o.repo);
  const name = short(o.repo);
  const profile = profileFor(name);
  if (!profile) throw new Error(`no verification profile at ~/.config/control-room/verify/${name}.json`);
  const clone = repoPath(name);
  const commit = (await read(["git", "-C", clone, "rev-parse", `${o.ref}^{commit}`])).trim();
  const also: Record<string, string> = {};
  for (const a of o.also ?? []) { assertInProject(a.repo); also[short(a.repo)] = (await read(["git", "-C", repoPath(short(a.repo)), "rev-parse", `${a.ref}^{commit}`])).trim(); }
  // One round for one set of commits, and one live round for a work item: an older round's app stops, and its evidence stays.
  const rounds = o.key ? listRuns(o.key) : [];
  const prev = rounds[0] ?? null;
  const commits = roundCommits(prev, name, commit, also);
  const same = rounds.find((x) => sameCommits(roundCommits(null, x.repo, x.commit, x.commits ?? {}), commits) && (x.state === "running" || x.state === "starting"));
  if (same) return { id: same.id, dir: dirOf(same.id), already: true };
  // The new round takes over the machines, so a replaced round stops without clearing them.
  for (const x of rounds.filter((x) => x.state === "running")) await stopRun({ item: o.item, trigger: "verify" }, x.id, { replaced: true }).catch(() => {});
  const id = `${(o.key ?? name).toLowerCase()}-${commit.slice(0, 7)}-${Date.now().toString(36)}`;
  const dir = dirOf(id);
  mkdirSync(dir, { recursive: true });
  if (prev) carryOver(prev.id, dir);
  const r: VerifyRun = { id, key: o.key, pr: o.pr, repo: name, commit, commits, previous: prev?.id ?? null, state: "starting", step: "worktree", error: null, port: null, url: null, pid: null, worktree: null, agent: null,
    startedAt: new Date().toISOString(), stoppedAt: null, login: profile.logins?.[0] ? { user: profile.logins[0].user, password: profile.logins[0].password } : null, logins: profile.logins ?? [], transcriptDir: o.cwd ? projectDirOf(o.cwd) : null };
  save(r);
  note({ item: o.item, trigger: "verify" }, "verify-start", id, isDev() ? "dry run" : "started", { detail: { commit, pr: o.pr } });
  if (isDev()) { save({ ...r, state: "stopped", step: null, stoppedAt: r.startedAt }); return { id, dir, dryRun: true }; }
  settingUp.add(id);
  void (profile.remote ? bringUpRemote(r, profile.remote, o) : bringUp(r, profile, clone, o)).finally(() => settingUp.delete(id)).catch((e) => { save({ ...load(id)!, state: "failed", error: (e as Error).message, stoppedAt: new Date().toISOString() }); note({ item: o.item, trigger: "verify" }, "verify-failed", id, (e as Error).message.slice(0, 200)); });
  return { id, dir };
}

/** Copies a round's scripts and data into a new round's folder, and its checks as pending. */
function carryOver(fromId: string, dir: string) {
  const from = dirOf(fromId);
  for (const n of carried(readdirSync(from).filter((n) => statSync(join(from, n)).isFile()))) copyFileSync(join(from, n), join(dir, n));
  const checks = readJson<{ checks: Check[] }>(join(from, "results.json"), { checks: [] }).checks ?? [];
  if (checks.length) writeFileSync(join(dir, "results.json"), JSON.stringify({ checks: resetChecks(checks) }, null, 1));
}

async function bringUp(r0: VerifyRun, p: Profile, clone: string, o: Parameters<typeof startRun>[0]) {
  let r = r0; const dir = dirOf(r.id);
  const step = (s: string, more: Partial<VerifyRun> = {}) => { r = { ...r, step: s, ...more }; save(r); };
  const worktree = join(clone, ".claude", "worktrees", `verify-${r.id}`);
  await sh(["git", "-C", clone, "worktree", "add", "-q", "--detach", worktree, r.commit], clone, join(dir, "setup.log"));
  for (const l of p.links ?? []) symlinkSync(join(clone, l), join(worktree, l));
  const port = await freePort();
  // A key for this run only, in Fernet's format, for forms that encrypt answers.
  const vars = { port: String(port), worktree, config: join(homedir(), ".config", "control-room", "verify"), fernet: fernetKey() };
  step("setup", { worktree, port });
  for (const c of p.setup) { step(c.join(" ")); await sh(c.map((x) => fill(x, vars)), worktree, join(dir, "setup.log")); }
  step("server");
  const env = Object.fromEntries(Object.entries(p.env ?? {}).map(([k, v]) => [k, fill(v, vars)]));
  const server = Bun.spawn(["/bin/zsh", "-lc", 'exec "$@"', "--", ...p.start], { cwd: worktree, env: { ...process.env, ...env }, stdout: Bun.file(join(dir, "server.log")), stderr: Bun.file(join(dir, "server.log")) });
  const url = `http://127.0.0.1:${port}`;
  step("waiting for the app", { pid: server.pid, url });
  for (let i = 0; ; i++) {
    const up = await fetch(url + p.health).then((x) => x.status < 500).catch(() => false);
    if (up) break;
    if (i >= 60 || server.exitCode !== null) throw new Error("the app did not answer. See server.log");
    await Bun.sleep(2000);
  }
  step("", { state: "running", step: null });
  note({ item: o.item, trigger: "verify" }, "verify-up", r.id, url);
  if (o.start && o.agentPrompt) { const a = await o.start(r.id, o.agentPrompt(dir, r.id)); r = { ...load(r.id)!, agent: a.name }; save(r); }
}

/** A remote run: no worktree and no app of its own, only a check that the machine's app answers. */
async function bringUpRemote(r0: VerifyRun, remote: NonNullable<Profile["remote"]>, o: Parameters<typeof startRun>[0]) {
  let r: VerifyRun = { ...r0, step: `checking ${remote.machine}`, machine: remote.machine, url: remote.url };
  save(r);
  const dir = dirOf(r.id);
  await sh(remote.check.map((x) => fill(x, { dir, id: r.id })), dir, join(dir, "setup.log"));
  r = { ...r, state: "running", step: null };
  save(r);
  note({ item: o.item, trigger: "verify" }, "verify-up", r.id, `${remote.machine} ${remote.url}`);
  if (o.start && o.agentPrompt) { const a = await o.start(r.id, o.agentPrompt(dir, r.id)); r = { ...load(r.id)!, agent: a.name }; save(r); }
}

/** The stop commands of a remote round: one for each machine that a repo of the change runs on, each once. */
export function stopCommands(r: Pick<VerifyRun, "repo" | "commits" | "machine">, profile: (repo: string) => Profile | null): string[][] {
  if (!r.machine) return [];
  const seen = new Set<string>();
  return [r.repo, ...Object.keys(r.commits ?? {})].flatMap((repo) => {
    const s = profile(repo)?.remote?.stop;
    if (!s || seen.has(s.join("\0"))) return [];
    seen.add(s.join("\0"));
    return [s];
  });
}

/**
 * Stops the app and removes the temporary worktree. A remote round runs the stop command of each machine its
 * change ran on, unless a newer round `replaced` it and now uses those machines. The evidence folder stays.
 */
export async function stopRun(ctx: Ctx, id: string, o: { replaced?: boolean } = {}) {
  const r = load(id);
  if (!r) throw new Error("no such run");
  for (const stop of o.replaced ? [] : stopCommands(r, profileFor))
    await sh(stop.map((x) => fill(x, { dir: dirOf(id), id })), dirOf(id), join(dirOf(id), "setup.log")).catch((e) => note(ctx, "verify-stop", id, (e as Error).message.slice(0, 200)));
  if (r.port) await read(["/bin/sh", "-c", `lsof -ti tcp:${r.port} | xargs kill 2>/dev/null; true`]).catch(() => {});
  if (r.pid && alive(r.pid)) { try { process.kill(r.pid); } catch {} }
  if (r.worktree && existsSync(r.worktree)) await read(["git", "-C", repoPath(r.repo), "worktree", "remove", "--force", r.worktree]).catch(() => {});
  save({ ...r, state: "stopped", step: null, pid: null, stoppedAt: new Date().toISOString() });
  note(ctx, "verify-stop", id, o.replaced ? "replaced by a newer round" : "stopped");
}

const sinceSeen = new Map<string, number | null>();
/**
 * How many of the PR's own files differ between a run's commit and the PR's head. 0 means the run tested
 * this change, under any hash or branch. A whole-tree diff would count the gap between two base branches. Null when git can't tell.
 */
export async function filesSince(repo: string, commit: string, head: string, base: string): Promise<number | null> {
  if (commit === head) return 0;
  const k = `${repo}:${commit}:${head}:${base}`;
  if (sinceSeen.has(k)) return sinceSeen.get(k)!;
  const clone = repoPath(repo);
  const lines = (o: string) => o.split("\n").filter(Boolean);
  // Every PR commit has an equal patch in the run's history: the same change, cherry-picked to another branch.
  const cherry = await read(["git", "-C", clone, "cherry", commit, head, `origin/${base}`]).catch(() => null);
  if (cherry !== null && !lines(cherry).some((l) => l.startsWith("+"))) { sinceSeen.set(k, 0); return 0; }
  const n = await read(["git", "-C", clone, "diff", "--name-only", `origin/${base}...${head}`])
    .then((o) => read(["git", "-C", clone, "diff", "--name-only", commit, head, "--", ...lines(o)]))
    .then((o) => lines(o).length).catch(() => null);
  if (n !== null) sinceSeen.set(k, n);
  return n;
}

/** The prompt for the agent that runs a run's checks. */
export const verifyPrompt = (dir: string, id: string) => `/verify-change --dir "${dir}" --id ${id}`;
