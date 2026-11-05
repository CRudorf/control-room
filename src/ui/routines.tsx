// Routines: prompts the control room starts on its own, daily or weekly, when the user starts work or at a
// set time (server/routines.ts). Each can run now, pause, change or go. The friction review is one by
// default, with a link to its newest report. The weekly improvement loop shows here too, with its own Run now.
import { useEffect, useState } from "react";
import type { Routine, RoutineRun } from "../shared/types";
import { focusText, post, toast } from "./actions";

const DAYS = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const blank = (): Routine => ({ id: "", name: "", prompt: "", repos: [], cadence: "daily", weekday: 1, weekdaysOnly: true, when: "start", enabled: true });
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);

type Live = Record<string, { pane: string; status: string; workspace: string; machine: string | null }>;
type State = { routines: Routine[]; runs: Record<string, RoutineRun>; repos: string[]; idle: number | null; startHour: number; machines: string[]; loop: { week: string; at: string; agent: string | null; error: string | null } | null; live: Live; friction: { path: string; at: string } | null };

const STATUS: Record<string, string> = { working: "working", blocked: "waiting on you", done: "finished", idle: "idle", unknown: "open" };

/** Each agent a run started: where it is and how it's doing, with a button to open it; or that it's closed. */
function RunAgents({ names, live }: { names: string[]; live: Live }) {
  const open = async (pane: string, name: string) => toast(focusText(await post("/api/agent/focus", { pane }), name));
  if (!names.length) return null;
  return (
    <div className="run-agents">
      {names.map((n) => { const a = live[n]; return (
        <span key={n} className="run-agent">
          <i className={`dot ${a?.status ?? "gone"}`} /><b>{n}</b>
          <span className="st dim">{a ? `${STATUS[a.status] ?? a.status} · ${a.machine ? `${a.machine} · ` : ""}${a.workspace}` : "closed"}</span>
          {a && <button className="btn sm" onClick={() => void open(a.pane, n)}>Open</button>}
        </span>
      ); })}
    </div>
  );
}

const runOnText = (r: Routine, machines: string[]) =>
  !machines.length ? "" : r.brief === "sessions" ? ", on this Mac, where its sessions are" : r.runOn === "local" ? ", on this Mac only" : `, on ${machines.join(" or ")} first, else this Mac`;

const whenText = (r: Routine, startHour: number) =>
  `${r.cadence === "daily" ? (r.weekdaysOnly ? "Every weekday" : "Every day") : `Every ${DAYS[r.weekday]}`}, ${r.when === "start" ? `when you start work (the first time you're at the Mac after ${startHour}am)` : `at ${r.when}`}`;

function runText(run: RoutineRun | undefined) {
  if (!run) return "Hasn't run yet.";
  const at = new Date(run.at).toLocaleString();
  if (run.error && !run.agents.length) return `Failed ${at}: ${run.error}`;
  const where = [...new Set(run.agents.map((a) => a.machine ?? "this Mac"))].join(" and ");
  const fell = run.agents.filter((a) => a.fellBack).map((a) => a.fellBack).join("; ");
  return `Ran ${at}${where ? ` on ${where}` : ""}${run.trigger === "routines page" ? " by hand" : ""}${run.agents.some((a) => a.dryRun) ? " (dev: recorded, nothing started)" : ""}${fell ? `. Fell back to this Mac: ${fell}` : ""}${run.error ? `. Failed in ${run.error}` : ""}`;
}

function Editor({ init, repos, machines, onDone }: { init: Routine; repos: string[]; machines: string[]; onDone: (saved: boolean) => void }) {
  const [r, setR] = useState(init);
  const [busy, setBusy] = useState(false);
  const isNew = !init.id;
  const set = <K extends keyof Routine>(k: K, v: Routine[K]) => setR((x) => ({ ...x, [k]: v }));
  const saveIt = async () => {
    setBusy(true);
    const res = await post("/api/routines", { op: "save", routine: { ...r, id: r.id || slug(r.name) } });
    setBusy(false);
    if (res.error) return toast(`Couldn't save: ${res.error}`);
    toast(`Saved ${r.name}`);
    onDone(true);
  };
  return (
    <form className="routine edit" onSubmit={(e) => { e.preventDefault(); void saveIt(); }}>
      <label><span className="st">NAME</span><input className="field" autoFocus value={r.name} placeholder="e.g. Morning Sentry check" onChange={(e) => set("name", e.target.value)} /></label>
      <label><span className="st">PROMPT</span><textarea className="field" rows={3} value={r.prompt} placeholder="Empty runs /signal-to-pr with no signal: it triages the repo's live Sentry errors into a menu for you" onChange={(e) => set("prompt", e.target.value)} /></label>
      <div className="row"><span className="st">REPOS</span>
        <span className="chips">{repos.map((n) => <button type="button" key={n} className={`chip ${r.repos.includes(n) ? "on" : ""}`} onClick={() => set("repos", r.repos.includes(n) ? r.repos.filter((x) => x !== n) : [...r.repos, n])}>{n}</button>)}</span>
      </div>
      <div className="row"><span className="st">RUNS</span>
        <select className="field" value={r.cadence} onChange={(e) => set("cadence", e.target.value as Routine["cadence"])}><option value="daily">Daily</option><option value="weekly">Weekly</option></select>
        {r.cadence === "daily"
          ? <label className="inline"><input type="checkbox" checked={r.weekdaysOnly} onChange={(e) => set("weekdaysOnly", e.target.checked)} /> Weekdays only</label>
          : <select className="field" value={r.weekday} onChange={(e) => set("weekday", Number(e.target.value))}>{DAYS.slice(1).map((d, i) => <option key={d} value={i + 1}>{d}</option>)}</select>}
        <select className="field" value={r.when === "start" ? "start" : "time"} onChange={(e) => set("when", e.target.value === "start" ? "start" : "09:00")}>
          <option value="start">When I start work</option><option value="time">At a time</option>
        </select>
        {r.when !== "start" && <input className="field" type="time" value={r.when} onChange={(e) => set("when", e.target.value)} />}
      </div>
      {machines.length > 0 && r.brief !== "sessions" && <div className="row"><span className="st">RUN ON</span>
        <select className="field" value={r.runOn ?? "machines"} onChange={(e) => set("runOn", e.target.value === "local" ? "local" : undefined)}>
          <option value="machines">{machines.join(", ")} first, else this Mac</option><option value="local">This Mac only</option>
        </select>
      </div>}
      <div className="row-acts">
        <button type="button" className="btn" onClick={() => onDone(false)}>Cancel</button>
        <button className="btn primary" type="submit" disabled={busy || !r.name.trim() || !r.repos.length}>{isNew ? "Add routine" : "Save"}</button>
      </div>
    </form>
  );
}

export function Routines({ onClose }: { onClose: () => void }) {
  const [s, setS] = useState<State | null>(null);
  const [editing, setEditing] = useState<Routine | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const load = () => void fetch("/api/routines").then((x) => x.json()).then(setS).catch(() => {});
  useEffect(load, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape" && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) { e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", k, true);
    return () => document.removeEventListener("keydown", k, true);
  }, [onClose]);
  const act = async (id: string, body: object, done: string) => {
    setBusy(id);
    const r = await post("/api/routines", body);
    setBusy(null);
    toast(r.error ? `Couldn't: ${r.error}` : done);
    load();
  };
  const runLoopNow = async () => {
    setBusy("loop");
    const r = await post("/api/loop", {});
    setBusy(null);
    toast(r.error ? `Couldn't start the loop: ${r.error}` : `Started ${r.agent}`);
    load();
  };
  return (
    <div className="routines">
      <div className="vv-head"><b className="vt">Routines</b><span className="st dim">Prompts the control room starts on its own, daily or weekly, in each repo you pick.{s?.idle != null ? ` You were last at the Mac ${s.idle < 120 ? "just now" : `${Math.round(s.idle / 60)} min ago`}.` : ""}</span>
        <div className="row-acts">
          {!editing && <button className="btn primary" onClick={() => setEditing(blank())}>New routine</button>}
          <button className="btn" onClick={onClose}>Close <kbd>esc</kbd></button>
        </div></div>
      <div className="routines-body">
        {editing && s && <Editor init={editing} repos={s.repos} machines={s.machines} onDone={(saved) => { setEditing(null); if (saved) load(); }} />}
        {!s && <div className="empty">Reading routines…</div>}
        {s && !s.routines.length && !editing && <div className="empty">No routines yet. A daily one with an empty prompt checks Sentry when you start work.</div>}
        {s?.routines.map((r) => (
          <div key={r.id} className={`routine ${r.enabled ? "" : "paused"}`}>
            <div className="routine-h"><b>{r.name}</b>{!r.enabled && <span className="st warn">paused</span>}<span className="st dim">{r.repos.join(", ")}</span></div>
            <div className="st">{whenText(r, s.startHour)}{runOnText(r, s.machines)}</div>
            {r.brief === "sessions"
              ? <div className="routine-prompt">
                  <span className="dim">Reads every session tied to a work item, with how each item moved on the board, and suggests what would take friction out of the workflow, one card per candidate.</span>
                  <details><summary className="st dim">Prompt</summary>{r.prompt}</details>
                  {s.friction && <a className="btn sm" href="/friction" target="_blank" rel="noreferrer">Open the latest report ({new Date(s.friction.at).toLocaleDateString()})</a>}
                </div>
              : <div className="routine-prompt">{r.prompt || <span className="dim">/signal-to-pr, no signal: triage the live Sentry errors</span>}</div>}
            <div className={`st ${s.runs[r.id]?.error ? "pen" : "dim"}`}>{runText(s.runs[r.id])}</div>
            <RunAgents names={s.runs[r.id]?.agents.filter((a) => !a.dryRun).map((a) => a.name) ?? []} live={s.live} />
            <div className="row-acts">
              <button className="btn" disabled={busy === r.id} onClick={() => void act(r.id, { op: "run", id: r.id }, `Started ${r.name}`)}>{busy === r.id ? "Starting…" : "Run now"}</button>
              <button className="btn" onClick={() => void act(r.id, { op: "save", routine: { ...r, enabled: !r.enabled } }, r.enabled ? `Paused ${r.name}` : `Resumed ${r.name}`)}>{r.enabled ? "Pause" : "Resume"}</button>
              <button className="btn" onClick={() => setEditing(r)}>Edit</button>
              <button className="btn" onClick={() => void act(r.id, { op: "delete", id: r.id }, `Deleted ${r.name}`)}>Delete</button>
            </div>
          </div>
        ))}
        {s && (
          <div className="routine builtin">
            <div className="routine-h"><b>Weekly improvement loop</b><span className="st dim">control-room</span></div>
            <div className="st">Every week, the first weekday morning between 9 and 12</div>
            <div className="routine-prompt dim">Writes a brief of the week's metrics, reports on it, files up to three proposals and opens a draft PR for the top one. Its report is on Metrics.</div>
            <div className={`st ${s.loop?.error ? "pen" : "dim"}`}>{s.loop ? `${s.loop.error ? "Failed" : "Ran"} ${new Date(s.loop.at).toLocaleString()}${s.loop.error ? `: ${s.loop.error}` : ""}` : "Hasn't run yet."}</div>
            <RunAgents names={s.loop?.agent ? [s.loop.agent] : []} live={s.live} />
            <div className="row-acts"><button className="btn" disabled={busy === "loop"} onClick={() => void runLoopNow()}>{busy === "loop" ? "Starting…" : "Run now"}</button></div>
          </div>
        )}
      </div>
    </div>
  );
}
