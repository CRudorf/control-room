// Other machines that run agents (Settings: Machines). Each runs its own herdr, reached through an ssh tunnel
// from a local socket to its herdr socket. The tunnel's ssh is the control master, so git, ls and rsync on the
// machine reuse its connection. Routines start there first and fall back to this Mac (routines.ts).
import { existsSync, readdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { PORT, ROOT } from "./config";
import { requestAt } from "./herdrsock";
import { CLAUDE_DIR, PROJECT, PROJECTS_PATH } from "./repos";
import { type Machine, onSettingsChange, SETTINGS } from "./settings";

const log = (...a: unknown[]) => console.log(new Date().toISOString(), ...a);

/** The machines agents can run on, in the order they're tried. */
export const machines = (): Machine[] => (SETTINGS.machines ?? []).filter((m) => m.enabled !== false);
export const machine = (name: string) => machines().find((m) => m.name === name) ?? null;
export const reposRoot = (m: Machine) => m.reposRoot ?? "~/Projects";

type Link = { proc: ReturnType<typeof Bun.spawn> | null; home: string | null; up: boolean; error: string | null; tried: number; connecting: Promise<void> | null };
const links = new Map<string, Link>();
const link = (m: Machine) => links.get(m.name) ?? links.set(m.name, { proc: null, home: null, up: false, error: null, tried: 0, connecting: null }).get(m.name)!;

// Short paths in /tmp: a unix socket path has a length limit, and the port keeps the dev server's apart.
const sockPath = (m: Machine) => `/tmp/cr-${PORT}-${m.name}.sock`;
const ctlPath = (m: Machine) => `/tmp/cr-${PORT}-${m.name}.ctl`;
const SSH = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=6"];
const RETRY_MS = 60_000;

/** A word the remote shell reads as itself. */
const q = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

/** A path on the machine with its ~ spelled out, once its home is known. */
export const remotePath = (m: Machine, p: string) => { const h = link(m).home; return h ? p.replace(/^~(?=\/|$)/, h) : p; };

async function run(cmd: string[], timeoutMs: number): Promise<string> {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => p.kill(), timeoutMs);
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  clearTimeout(timer);
  if (code !== 0) throw new Error((err.trim().split("\n").pop() || `exit ${code}`).slice(0, 200));
  return out;
}

/** Runs a command on the machine, each word quoted, through the tunnel's connection when it's up. */
export const onMachine = (m: Machine, args: string[], timeoutMs = 20_000) =>
  run(["ssh", ...SSH, "-S", ctlPath(m), m.ssh, args.map((a) => q(remotePath(m, a))).join(" ")], timeoutMs);

/** The local socket for a machine's herdr while its tunnel is up, else null. */
export function machineSocket(name: string): string | null {
  const m = machine(name);
  return m && link(m).up ? sockPath(m) : null;
}

/** Opens the tunnel if it's down, at most once a minute after a failure. Resolves either way; `up` says how it went. */
export function connect(m: Machine, force = false): Promise<void> {
  const l = link(m);
  if (l.connecting) return l.connecting;
  if (l.up && l.proc?.exitCode === null) return Promise.resolve();
  if (!force && Date.now() - l.tried < RETRY_MS) return Promise.resolve();
  l.tried = Date.now();
  l.connecting = (async () => {
    try {
      l.home ??= (await run(["ssh", ...SSH, m.ssh, `printf %s "$HOME"`], 15_000)).trim();
      for (const p of [sockPath(m), ctlPath(m)]) rmSync(p, { force: true });
      l.proc?.kill();
      const proc = Bun.spawn(["ssh", ...SSH, "-o", "ExitOnForwardFailure=yes", "-o", "StreamLocalBindUnlink=yes", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3",
        "-M", "-S", ctlPath(m), "-N", "-L", `${sockPath(m)}:${l.home}/.config/herdr/herdr.sock`, m.ssh], { stdout: "ignore", stderr: "pipe" });
      l.proc = proc;
      void proc.exited.then(async () => {
        if (l.proc !== proc) return;
        l.up = false;
        l.error = (await new Response(proc.stderr as ReadableStream).text().catch(() => "")).trim().split("\n").pop() || "the tunnel closed";
        log(`machine ${m.name}: ${l.error}`);
      });
      for (let i = 0; i < 40 && !existsSync(sockPath(m)) && proc.exitCode === null; i++) await Bun.sleep(200);
      await requestAt(sockPath(m), "session.snapshot", {}, 8000);
      l.up = true;
      l.error = null;
      log(`machine ${m.name}: connected`);
    } catch (e) {
      l.up = false;
      l.error = (e as Error).message;
    } finally { l.connecting = null; }
  })();
  return l.connecting;
}

/** Why an agent can't start on this machine in this repo now, or null when it can. */
export async function unready(m: Machine, repo: string): Promise<string | null> {
  await connect(m, true);
  const l = link(m);
  if (!l.up) return `${m.name} isn't reachable (${l.error ?? "no tunnel"})`;
  const dir = `${reposRoot(m)}/${repo}`;
  try { await onMachine(m, ["test", "-d", `${dir}/.git`], 10_000); }
  catch { return `${m.name} has no clone of ${repo} in ${reposRoot(m)}`; }
  // Claude refuses a worktree in a folder whose trust prompt nobody has answered; that answer is the user's to give.
  const trusted = await onMachine(m, ["python3", "-c", TRUSTED, remotePath(m, dir)], 10_000).then((o) => o.trim() === "yes", () => false);
  if (!trusted) return `Claude on ${m.name} doesn't trust ${repo} yet: run \`ssh -t ${m.ssh} 'cd ${dir} && claude'\` once and accept its trust prompt`;
  return null;
}

// Whether Claude's config there has accepted the folder's trust prompt, for it or a folder above it.
const TRUSTED = `import json, os, sys
d = json.load(open(os.path.expanduser("~/.claude.json"))).get("projects", {})
p = sys.argv[1]
while True:
    if d.get(p, {}).get("hasTrustDialogAccepted"): print("yes"); break
    if p in ("/", ""): print("no"); break
    p = os.path.dirname(p)`;

/** The repos cloned on a machine, read at most every five minutes. */
const reposSeen = new Map<string, { at: number; repos: string[] }>();
async function reposOn(m: Machine): Promise<string[]> {
  const hit = reposSeen.get(m.name);
  if (hit && Date.now() - hit.at < 300_000) return hit.repos;
  const repos = (await onMachine(m, ["ls", "-1", reposRoot(m)], 10_000)).split("\n").map((x) => x.trim()).filter(Boolean);
  reposSeen.set(m.name, { at: Date.now(), repos });
  return repos;
}

/** Each machine in Settings, enabled or not, with whether its tunnel is up and what it has cloned. */
export async function machineStatus() {
  return Promise.all((SETTINGS.machines ?? []).map(async (m) => {
    if (m.enabled === false) return { name: m.name, up: false, error: "off", repos: [] as string[] };
    await connect(m);
    const l = link(m);
    return { name: m.name, up: l.up, error: l.error, repos: l.up ? await reposOn(m).catch(() => []) : [] };
  }));
}

/**
 * Copies what an agent there needs from this Mac: the control room's skills, its scripts, and this project's
 * settings and tuning. Never a credential: a login or token the machine needs is set up there by the user.
 */
export async function syncTo(m: Machine) {
  const skills = existsSync(join(ROOT, "skills")) ? readdirSync(join(ROOT, "skills")).filter((n) => existsSync(join(CLAUDE_DIR, "skills", n))) : [];
  const conf = join(homedir(), ".config", "control-room");
  const copies: [string, string][] = [
    ...skills.map((n): [string, string] => [join(CLAUDE_DIR, "skills", n) + "/", `.claude/skills/${n}/`]),
    [join(CLAUDE_DIR, "scripts") + "/", ".claude/scripts/"],
    [PROJECTS_PATH, ".config/control-room/projects.json"],
  ];
  if (PROJECT) copies.push([join(conf, "projects", `${PROJECT}.json`), `.config/control-room/projects/${PROJECT}.json`], [join(conf, "projects", PROJECT) + "/", `.config/control-room/projects/${PROJECT}/`]);
  await onMachine(m, ["mkdir", "-p", "~/.claude/skills", "~/.claude/scripts", "~/.config/control-room/projects"], 10_000);
  for (const [from, to] of copies.filter(([from]) => existsSync(from.replace(/\/$/, ""))))
    await run(["rsync", "-az", "--exclude", "__pycache__", "-e", `ssh ${SSH.join(" ")} -S ${ctlPath(m)}`, from, `${m.ssh}:${to}`], 60_000);
}

/** Opens each machine's tunnel now, and again when Settings changes them. */
export function startMachines() {
  for (const m of machines()) void connect(m, true);
}

onSettingsChange(() => {
  const names = new Set(machines().map((m) => m.name));
  for (const [name, l] of links) if (!names.has(name)) { l.proc?.kill(); links.delete(name); }
  for (const m of machines()) void connect(m, true);
});
process.on("exit", () => { for (const l of links.values()) l.proc?.kill(); });
