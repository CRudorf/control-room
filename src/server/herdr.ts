import { dirInProject, repoInProject } from "./repos";
// herdr's socket: a snapshot of every agent, kept fresh by per-pane status
// subscriptions and reconciled on the Settings page's interval (herdr control surface research).
// Another machine's herdr (machines.ts) joins the same snapshot: its pane, tab and workspace ids carry
// the machine's name ("box/w1:p1"), and every request about one goes to the herdr that holds it.
import { connect, type Socket } from "node:net";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import type { Agent, AgentStatus } from "../shared/types";
import { DEV } from "./config";
import { db, load, save } from "./db";
import { turnEnds, turnStarts, type Turn } from "./notify";
import { forgetTasks, taskOf } from "./tasks";
import { note } from "./runner";
import { every } from "./every";
import { type Machine, tuning } from "./settings";
import { requestAt } from "./herdrsock";
import { machine, machines, machineSocket, onMachine, remotePath, reposRoot } from "./machines";

const SOCKET = process.env.HERDR_SOCKET_PATH ?? join(homedir(), ".config/herdr/herdr.sock");
const GLOBAL_EVENTS = ["pane.created", "pane.closed", "pane.exited", "pane.agent_detected", "tab.created", "tab.closed", "tab.renamed", "workspace.renamed"];

/** One request to this Mac's herdr, on its own connection. */
export const request = <T = any>(method: string, params: object = {}, timeoutMs = 10_000): Promise<T> => requestAt<T>(SOCKET, method, params, timeoutMs);

/** The machine an id is on and its id there: "box/w1:p1" is w1:p1 on box; a bare id is this Mac's. */
export function onWhich(id: string): { machine: string | null; id: string } {
  const i = id.indexOf("/");
  return i < 0 ? { machine: null, id } : { machine: id.slice(0, i), id: id.slice(i + 1) };
}
const tag = (machine: string | null, id: string) => (machine ? `${machine}/${id}` : id);

/** A request to the herdr of `machine` (null: this Mac). */
export function requestOn<T = any>(machine: string | null, method: string, params: object = {}, timeoutMs = 10_000): Promise<T> {
  if (!machine) return request<T>(method, params, timeoutMs);
  const sock = machineSocket(machine);
  return sock ? requestAt<T>(sock, method, params, timeoutMs) : Promise.reject(new Error(`${machine} isn't connected`));
}

/** A request about a pane or tab, to the herdr that holds it, with the id it has there. */
export function requestFor<T = any>(id: string, method: string, params: (id: string) => object, timeoutMs = 10_000): Promise<T> {
  const w = onWhich(id);
  return requestOn<T>(w.machine, method, params(w.id), timeoutMs);
}

type Git = (cwd: string, ...args: string[]) => Promise<string | null>;
const gitLocal: Git = async (cwd, ...args) => {
  const p = Bun.spawn(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "ignore" });
  const [out, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
  return code === 0 ? out.trim() : null;
};
const gitOn = (m: Machine): Git => (cwd, ...args) => onMachine(m, ["git", "-C", cwd, ...args], 10_000).then((o) => o.trim(), () => null);

// Which repo, branch, upstream branch and commit an agent's foreground directory is on;
// git calls cached for a minute. An agent may work on a local branch of its own that it
// pushes to a PR's branch, so the upstream and the commit tie it to the PR too.
type GitInfo = { at: number; repo: string | null; branch: string | null; upstream: string | null; head: string | null };
const gitCache = new Map<string, GitInfo>();
async function gitInfo(cwd: string, m: Machine | null = null): Promise<GitInfo> {
  const key = tag(m?.name ?? null, cwd), git = m ? gitOn(m) : gitLocal;
  const hit = gitCache.get(key);
  if (hit && Date.now() - hit.at < 60_000) return hit;
  let repo: string | null = null, branch: string | null = null;
  const out = await git(cwd, "rev-parse", "--abbrev-ref", "HEAD", "--path-format=absolute", "--git-common-dir").catch(() => null);
  if (out) {
    const [b, common] = out.split("\n");
    branch = b === "HEAD" ? null : b;
    repo = basename(common) === ".git" ? basename(dirname(common)) : basename(common).replace(/\.git$/, "");
  }
  const up = repo ? await git(cwd, "rev-parse", "--abbrev-ref", "@{upstream}").catch(() => null) : null;
  const head = repo ? await git(cwd, "rev-parse", "HEAD").catch(() => null) : null;
  const v = { at: Date.now(), repo, branch, upstream: up?.replace(/^[^/]+\//, "") ?? null, head };
  gitCache.set(key, v);
  return v;
}

let agents: Agent[] = [];
// herdr reports a finish in a tab some herdr window is showing as `idle`, not `done`,
// so a finish is tracked here as working → idle/done, whatever herdr thinks was seen.
const lastStatus = new Map<string, AgentStatus>();
const finishedAt = new Map<string, number>();
// Each pane's last finish and turn (notification rules), kept across restarts so a deploy doesn't
// announce a finish the user was there for; and the panes the control room has just prompted, whose
// next turn never answers a finish.
const turns = new Map<string, Turn>(Object.entries(load<Record<string, Turn>>("turns") ?? {}));
const byBoard = new Set<string>();
// "Mark seen" from the control room: pane → the state seq it was dismissed at. Kept across
// restarts; it lapses as soon as the agent changes state again.
const dismissed = new Map<string, number>(Object.entries(load<Record<string, number>>("dismissed") ?? {}));
// pane → its status and when it took it, kept across restarts. An agent first seen mid-status has
// no time: when it started is unknown.
const since = new Map<string, { status: AgentStatus; at: string | null }>(Object.entries(load<Record<string, { status: AgentStatus; at: string | null }>>("agent_since") ?? {}));
let sinceSaved = "";
let up = false;
let error: string | null = null;
let onChange: () => void = () => {};

export const herdrState = () => ({ agents, up, error });

/** The control room is about to prompt this pane itself: the turn it starts isn't the user replying, so its finish notifies. */
export const promptedByBoard = (pane: string) => void byBoard.add(pane);
/** herdr refused that prompt: the next turn is the user's again. */
export const unprompted = (pane: string) => void byBoard.delete(pane);

// Settles after the first snapshot attempt, so callers that join tabs to work items see agents.
let settle = () => {};
const first = new Promise<void>((r) => (settle = r));
export const herdrReady = () => first;

/** Each machine's herdr snapshot, its ids tagged with the machine; a machine that fails is left out and says why. */
export const machineErrors = new Map<string, string>();
type Source = { m: Machine | null; s: any };
async function readSources(): Promise<Source[]> {
  const local: Source = { m: null, s: (await request("session.snapshot")).snapshot };
  const remote = await Promise.all(machines().map(async (m): Promise<Source | null> => {
    try {
      const s = (await requestOn(m.name, "session.snapshot")).snapshot;
      machineErrors.delete(m.name);
      const t = (o: any, ...keys: string[]) => ({ ...o, ...Object.fromEntries(keys.filter((k) => o[k]).map((k) => [k, tag(m.name, o[k])])) });
      return { m, s: { ...s, tabs: s.tabs.map((x: any) => t(x, "tab_id", "workspace_id")), workspaces: s.workspaces.map((x: any) => t(x, "workspace_id")),
        agents: s.agents.map((x: any) => t(x, "pane_id", "tab_id", "workspace_id")) } };
    } catch (e) { machineErrors.set(m.name, (e as Error).message); return null; }
  }));
  return [local, ...remote.filter((x): x is Source => !!x)];
}

/** Whether a directory on another machine is in one of this project's repos there. */
function remoteInProject(m: Machine, cwd: string) {
  const root = remotePath(m, reposRoot(m)).replace(/\/$/, "") + "/";
  return cwd.startsWith(root) && repoInProject(cwd.slice(root.length).split("/")[0]);
}

async function snapshot() {
  try {
    const sources = await readSources();
    const tabs = new Map<string, any>(sources.flatMap(({ s }) => s.tabs.map((t: any) => [t.tab_id, t])));
    const workspaces = new Map<string, any>(sources.flatMap(({ s }) => s.workspaces.map((w: any) => [w.workspace_id, w])));
    const next: Agent[] = [];
    let turnsChanged = false;
    for (const { m, s } of sources) for (const a of s.agents) {
      if (a.agent !== "claude") continue;
      const cwd = a.foreground_cwd || a.cwd;
      // A session of another project is not visible here.
      if (!(m ? remoteInProject(m, cwd) : dirInProject(cwd))) continue;
      const g = await gitInfo(cwd, m);
      const seq = a.state_change_seq ?? 0;
      let status = (a.agent_status ?? "unknown") as AgentStatus;
      if (dismissed.has(a.pane_id) && dismissed.get(a.pane_id) !== seq && status !== "done") dismissed.delete(a.pane_id);
      if (dismissed.get(a.pane_id) === seq && status === "done") status = "idle";
      const prev = lastStatus.get(a.pane_id);
      if (status === "working") {
        finishedAt.delete(a.pane_id);
        // A new turn, not one resumed from a dialog.
        if (prev === "idle" || prev === "done") {
          turns.set(a.pane_id, turnStarts(turns.get(a.pane_id), Date.now(), byBoard.has(a.pane_id)));
          byBoard.delete(a.pane_id);
          turnsChanged = true;
        }
      } else if ((status === "idle" || status === "done") && prev === "working") {
        finishedAt.set(a.pane_id, seq);
        turns.set(a.pane_id, turnEnds(turns.get(a.pane_id), Date.now()));
        turnsChanged = true;
      }
      lastStatus.set(a.pane_id, status);
      const was = since.get(a.pane_id);
      if (!was || was.status !== status) since.set(a.pane_id, { status, at: was ? new Date().toISOString() : null });
      next.push({
        pane: a.pane_id, tab: a.tab_id, workspace: a.workspace_id, machine: m?.name ?? null,
        name: a.name ?? null, label: tabs.get(a.tab_id)?.label ?? a.terminal_title_stripped ?? a.pane_id,
        title: a.terminal_title_stripped ?? "", workspaceLabel: workspaces.get(a.workspace_id)?.label ?? "",
        status, cwd, repo: g.repo, branch: g.branch, upstream: g.upstream, head: g.head,
        session: a.agent_session?.value ?? null, focused: !!a.focused, seq,
        finishedSeq: dismissed.get(a.pane_id) === seq ? null : finishedAt.get(a.pane_id) ?? null,
        replied: turns.get(a.pane_id)?.replied ?? false,
        since: since.get(a.pane_id)!.at,
      });
      Object.assign(next[next.length - 1], taskOf(next[next.length - 1]));
    }
    // Panes that are gone drop out; the rest are kept for the next restart.
    for (const p of [...since.keys()]) if (!next.some((a) => a.pane === p)) since.delete(p);
    forgetTasks(new Set(next.map((a) => a.pane)));
    const kept = JSON.stringify(Object.fromEntries(since));
    if (kept !== sinceSaved) { save("agent_since", JSON.parse(kept)); sinceSaved = kept; }
    for (const pane of turns.keys()) if (!next.some((a) => a.pane === pane)) { turns.delete(pane); turnsChanged = true; }
    if (turnsChanged) save("turns", Object.fromEntries(turns));
    const changed = JSON.stringify(next) !== JSON.stringify(agents);
    const panesChanged = next.map((a) => a.pane).join() !== agents.map((a) => a.pane).join();
    agents = next;
    up = true;
    error = null;
    if (panesChanged) resubscribe();
    if (changed) onChange();
    settle();
  } catch (e) {
    const was = up;
    up = false;
    error = (e as Error).message;
    if (was) { agents = []; onChange(); }
    settle();
  }
}

// One event subscription per herdr: "" is this Mac's, else the machine's name.
const subs = new Map<string, Socket>();
let pending: ReturnType<typeof setTimeout> | null = null;
const soon = () => { if (!pending) pending = setTimeout(() => { pending = null; void snapshot(); }, 400); };
const sourceNames = () => ["", ...machines().map((m) => m.name).filter((n) => machineSocket(n))];

function resubscribe() {
  for (const k of [...subs.keys()]) if (!sourceNames().includes(k)) { subs.get(k)?.destroy(); subs.delete(k); }
  for (const k of sourceNames()) subscribe(k);
}

function subscribe(key: string) {
  subs.get(key)?.destroy();
  const path = key ? machineSocket(key) : SOCKET;
  if (!path) return;
  const sock = connect(path);
  subs.set(key, sock);
  let buf = "";
  const subscriptions = [
    ...GLOBAL_EVENTS.map((type) => ({ type })),
    ...agents.filter((a) => (a.machine ?? "") === key).map((a) => ({ type: "pane.agent_status_changed", pane_id: onWhich(a.pane).id })),
  ];
  sock.on("connect", () => sock.write(JSON.stringify({ id: "sub", method: "events.subscribe", params: { subscriptions } }) + "\n"));
  sock.on("data", (d) => {
    buf += d.toString();
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      try {
        const msg = JSON.parse(line);
        if (msg.event) soon();
        else if (msg.error) sock.destroy(); // a stale pane or lost events: the next snapshot resubscribes
      } catch {}
    }
  });
  const drop = () => { if (subs.get(key) === sock) subs.delete(key); };
  sock.on("error", drop);
  sock.on("close", drop);
}

export function startHerdr(changed: () => void) {
  onChange = changed;
  void snapshot();
  // A dropped subscription comes back on the next reconcile.
  every(tuning.herdrMs, () => void snapshot().then(() => { for (const k of sourceNames()) if (!subs.has(k) && (k || up)) subscribe(k); }));
}

const labelOf = (a: Agent | undefined, pane: string) => (a ? `${a.workspaceLabel} / ${a.label}` : pane);

/** Takes a finished agent off the board without showing it in herdr. */
export function dismissAgent(pane: string, item: string | null, how = "seen") {
  const a = agents.find((x) => x.pane === pane);
  dismissed.set(pane, a?.seq ?? 0);
  finishedAt.delete(pane);
  save("dismissed", Object.fromEntries(dismissed));
  note({ item, trigger: "agent pane" }, "mark-seen", labelOf(a, pane), how, { detail: { pane } });
  void snapshot();
}

/** Ends an agent's session: its pane, or its whole tab when it's alone there. Resumable from History. */
export async function closeAgent(pane: string, item: string | null) {
  const a = agents.find((x) => x.pane === pane);
  const w = onWhich(pane);
  const { snapshot: s } = await requestOn(w.machine, "session.snapshot");
  const tab = s.panes.find((p: any) => p.pane_id === w.id)?.tab_id;
  const alone = s.panes.filter((p: any) => p.tab_id === tab).length === 1;
  let result = DEV ? "dry run" : "closed";
  try {
    if (!DEV) await (alone ? requestOn(w.machine, "tab.close", { tab_id: tab }) : requestOn(w.machine, "pane.close", { pane_id: w.id }));
  } catch (e) {
    result = `failed: ${(e as Error).message}`;
  }
  const resume = a?.session ? [`${w.machine ? `ssh -t ${machine(w.machine)?.ssh ?? w.machine} ` : ""}cd '${a.cwd}' && claude --resume ${a.session}`] : [];
  note({ item, trigger: "agent pane" }, alone ? "close-tab" : "close-pane", labelOf(a, pane), result, { detail: { agent: a, resume } });
  void snapshot();
  if (result.startsWith("failed")) throw new Error(result);
  return { closed: alone ? "tab" : "pane" };
}

// What answering a Claude dialog takes: move, pick, confirm, back out, interrupt.
export const KEYS = new Set(["enter", "esc", "up", "down", "tab", "shift+tab", "ctrl+c", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);

/** Presses keys in an agent's pane: how a permission or question dialog gets answered. */
export async function sendKeys(pane: string, keys: string[], item: string | null) {
  const bad = keys.filter((k) => !KEYS.has(k));
  if (!keys.length || bad.length) throw new Error(`not a key the board sends: ${bad.join(", ") || "none"}`);
  const a = agents.find((x) => x.pane === pane);
  let result = DEV ? "dry run" : "sent";
  try {
    if (!DEV) await requestFor(pane, "pane.send_keys", (id) => ({ pane_id: id, keys }));
  } catch (e) {
    result = `failed: ${(e as Error).message}`;
  }
  note({ item, trigger: "agent pane" }, "keys-agent", labelOf(a, pane), result, { detail: { keys } });
  if (result.startsWith("failed")) throw new Error(result.slice(8));
  soon();
}

// Typing straight into a session from the board: text as typed, and the editing keys.
const TYPED_KEYS = new Set([...KEYS, "backspace", "left", "right"]);
const isTypedKey = (k: string) => TYPED_KEYS.has(k) || /^ctrl\+[a-z]$/.test(k);
export type Typed = { text: string } | { key: string };
// What's been typed into each pane since its last Enter, so History records whole lines.
const lines = new Map<string, string>();

/** Writes keystrokes typed in the board's console to the pane, in order. A line is recorded when Enter submits it. */
export async function typeInto(pane: string, ops: Typed[], item: string | null) {
  const bad = ops.flatMap((o) => ("key" in o && !isTypedKey(o.key) ? [o.key] : []));
  if (bad.length) throw new Error(`not a key the board sends: ${bad.join(", ")}`);
  const a = agents.find((x) => x.pane === pane);
  if (!a) throw new Error("that session isn't open any more");
  for (const o of ops) {
    if ("text" in o) {
      if (!DEV) await requestFor(pane, "pane.send_text", (id) => ({ pane_id: id, text: o.text }));
      lines.set(pane, (lines.get(pane) ?? "") + o.text);
      continue;
    }
    if (!DEV) await requestFor(pane, "pane.send_keys", (id) => ({ pane_id: id, keys: [o.key] }));
    if (o.key === "backspace") lines.set(pane, (lines.get(pane) ?? "").slice(0, -1));
    else if (o.key === "ctrl+u" || o.key === "ctrl+c") lines.delete(pane);
    else if (o.key === "enter") {
      note({ item, trigger: "console" }, "type-agent", labelOf(a, pane), DEV ? "dry run" : "sent", { detail: { text: lines.get(pane) ?? "" } });
      lines.delete(pane);
      finishedAt.delete(pane);
    }
  }
  soon();
}

/** Types a message into an agent and submits it. herdr refuses while a dialog is open. */
export async function sendToAgent(pane: string, text: string, item: string | null, trigger = "agent pane") {
  const a = agents.find((x) => x.pane === pane);
  let result = DEV ? "dry run" : "sent";
  // The user's own message from the agent pane is a reply; the loop's and new feedback's aren't.
  if (trigger !== "agent pane") promptedByBoard(pane);
  try {
    if (!DEV) await requestFor(pane, "agent.prompt", (id) => ({ target: id, text }));
  } catch (e) {
    result = `failed: ${(e as Error).message}`;
    unprompted(pane);
  }
  note({ item, trigger: trigger }, "message-agent", labelOf(a, pane), result, { detail: { text } });
  if (result.startsWith("failed")) throw new Error(result.slice(8));
  finishedAt.delete(pane); // answered: no longer waiting on the user
  void snapshot();
}

/** The agent's recent output, as plain text. */
export async function readAgent(pane: string): Promise<string> {
  const r = await requestFor(pane, "pane.read", (id) => ({ pane_id: id, source: "recent_unwrapped", lines: 120 }));
  return r.read?.text ?? r.text ?? "";
}

const sh = async (cmd: string[]) => {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "ignore" });
  const [out, code] = await Promise.all([new Response(p.stdout).text(), p.exited]);
  return code === 0 ? out.trim() : "";
};

/** The .app whose window shows herdr: walk up from a herdr client process to its terminal app. */
async function terminalApp(): Promise<string | null> {
  const clients = (await sh(["ps", "-A", "-o", "pid=,comm="])).split("\n")
    .map((l) => l.trim().split(/\s+/)).filter(([, comm]) => comm && basename(comm) === "herdr").map(([pid]) => pid);
  for (const pid of clients) {
    let cur = pid;
    for (let i = 0; i < 12 && cur && cur !== "1"; i++) {
      const [ppid, ...comm] = (await sh(["ps", "-o", "ppid=,comm=", "-p", cur])).trim().split(/\s+/);
      const app = comm.join(" ").match(/^(.*?\.app)\/Contents\/MacOS\//)?.[1];
      if (app) return app;
      cur = ppid;
    }
  }
  return null;
}

/**
 * Show the agent in herdr and bring herdr's terminal to the front. This also marks a `done` agent as seen.
 * An agent on another machine is focused in that machine's herdr, which a terminal shows with `attach`.
 */
export async function focusAgent(pane: string): Promise<{ app: string | null; machine?: string; attach?: string }> {
  // pane.focus marks the tab seen like agent.focus, and unlike it also moves every
  // attached herdr window to the pane (herdr 0.9 client_views.rs). One call, one switch.
  await requestFor(pane, "pane.focus", (id) => ({ pane_id: id }));
  const w = onWhich(pane);
  if (w.machine) {
    finishedAt.delete(pane);
    soon();
    return { app: null, machine: w.machine, attach: `herdr --remote ${machine(w.machine)?.ssh ?? w.machine}` };
  }
  finishedAt.delete(pane); // looked at from the control room: no longer "finished"
  const app = await terminalApp();
  if (app) await sh(["open", "-a", app]);
  soon();
  return { app: app ? basename(app, ".app") : null };
}
