import { motion } from "motion/react";
import { useEffect, useState } from "react";
import type { Move, WorkItem } from "../shared/types";
import { post, toast } from "./actions";

const short = (repo: string) => repo.split("/").pop()!;

function at(hour: number, daysAhead: number, weekday?: number) {
  const d = new Date();
  if (weekday !== undefined) daysAhead = ((weekday - d.getDay() + 7) % 7) || 7;
  d.setDate(d.getDate() + daysAhead);
  d.setHours(hour, 0, 0, 0);
  return d;
}
const PRESETS: [string, () => Date | null][] = [
  ["1 hour", () => new Date(Date.now() + 3600_000)],
  ["3 hours", () => new Date(Date.now() + 3 * 3600_000)],
  ["Tomorrow 9am", () => at(9, 1)],
  ["Monday 9am", () => at(9, 0, 1)],
  ["No timer", () => null],
];
const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

export function Sheet({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div className="sheet" initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
        <h3>{title}</h3>
        {children}
      </motion.div>
    </div>
  );
}

/** Park: out of the lanes and silent until the timer, or until a person does something new on it. */
export function ParkSheet({ it, onClose }: { it: WorkItem; onClose: () => void }) {
  const [note, setNote] = useState("");
  const [preset, setPreset] = useState(2);
  const [custom, setCustom] = useState("");
  const until = custom ? new Date(custom) : PRESETS[preset][1]();
  const park = async () => {
    const r = await post("/api/park", { item: it.id, note: note.trim(), until: until?.toISOString() ?? null });
    toast(r.error ? `Couldn't park: ${r.error}` : `Parked ${it.key}${until ? ` until ${until.toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" })}` : ""}`);
    onClose();
  };
  return (
    <Sheet title={`Park ${it.key}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); void park(); }}>
        <input className="field" autoFocus placeholder="Why, for future you (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        <div className="chips" style={{ margin: "10px 0" }}>
          {PRESETS.map(([l], i) => <button type="button" key={l} className={`chip ${!custom && preset === i ? "on" : ""}`} onClick={() => { setCustom(""); setPreset(i); }}>{l}</button>)}
          <input type="datetime-local" className="field dt" value={custom} min={local(new Date())} onChange={(e) => setCustom(e.target.value)} />
        </div>
        <p className="st dim" style={{ margin: 0 }}>Silent while parked. Comes back {until ? `${until.toLocaleString([], { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}, or ` : ""}when a person comments, asks for changes or mentions you. Bots and CI don't wake it.</p>
        <div className="row"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" type="submit">Park <kbd>⏎</kbd></button></div>
      </form>
    </Sheet>
  );
}

const refOf = (p: { repo: string; number: number }) => `${p.repo}#${p.number}`;

/** Dependency: hold one of the work item's PRs until another PR merges, or until a named step is done. */
export function DependencySheet({ it, items, onClose }: { it: WorkItem; items: WorkItem[]; onClose: () => void }) {
  const mine = it.prs.filter((p) => p.role === "mine");
  const first = it.dependencies?.find((g) => !g.opened)?.ref ?? (mine[0] ? refOf(mine[0]) : "");
  const [ref, setRef] = useState(first);
  const [on, setOn] = useState("");
  const [step, setStep] = useState("");
  const current = it.dependencies?.find((g) => g.ref === ref);
  const others = items.flatMap((x) => x.prs).filter((p) => !it.prs.includes(p));
  const go = async (lift = false) => {
    const r = await post("/api/dependency", { ref, item: it.id, on: lift ? null : on || null, step: lift ? null : on ? null : step });
    toast(r.error ? `Couldn't add the dependency: ${r.error}` : lift ? `Removed the dependency on ${short(ref)}` : `${short(ref)} waits on ${on ? short(on) : step}`);
    onClose();
  };
  if (!mine.length) return (
    <Sheet title={`Dependency for ${it.key}`} onClose={onClose}>
      <p>Only your own PRs can be blocked.</p>
      <div className="row"><button className="btn" onClick={onClose}>OK</button></div>
    </Sheet>
  );
  return (
    <Sheet title={`Dependency for ${it.key}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); if (on || step.trim()) void go(); }}>
        {mine.length > 1 && (
          <ul className="pick-list">
            {mine.map((p) => <li key={refOf(p)}><label><input type="radio" checked={ref === refOf(p)} onChange={() => setRef(refOf(p))} /> <b>{short(refOf(p))}</b> {p.title}</label></li>)}
          </ul>
        )}
        {current && <p className="st">Waiting on <b>{current.on ? short(current.on) : current.step}</b> now.</p>}
        <label className="st dim">Waits until this PR merges</label>
        <select className="field" value={on} onChange={(e) => setOn(e.target.value)}>
          <option value="">(none: a named step instead)</option>
          {others.map((p) => <option key={refOf(p)} value={refOf(p)}>{short(refOf(p))} · {p.title}</option>)}
        </select>
        {!on && <input className="field" autoFocus placeholder="or a step, e.g. prod apply" value={step} onChange={(e) => setStep(e.target.value)} style={{ marginTop: 8 }} />}
        <p className="st dim" style={{ margin: "8px 0 0" }}>Sits in Waiting on others while blocked. A PR dependency lifts itself and notifies when that PR merges; lift a step dependency here.</p>
        <div className="row">
          {current && <button type="button" className="btn" onClick={() => void go(true)}>Lift dependency</button>}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" type="submit" disabled={!on && !step.trim()}>Add dependency <kbd>⏎</kbd></button>
        </div>
      </form>
    </Sheet>
  );
}

/** Move: put the work item's PRs into another work item, or out on their own. Local only. */
export function MoveSheet({ it, items, onClose }: { it: WorkItem; items: WorkItem[]; onClose: () => void }) {
  const mine = it.prs.filter((p) => p.role === "mine");
  const targets = items.filter((x) => x.id !== it.id && x.keyKind !== "review" && x.keyKind !== "agent");
  const [ref, setRef] = useState(mine[0] ? refOf(mine[0]) : "");
  const [to, setTo] = useState(mine.length > 1 ? "split" : targets[0]?.id ?? "");
  const moved = it.moved?.includes(ref);
  const go = async (reset = false) => {
    const t = targets.find((x) => x.id === to);
    const into: Move = t ? { id: t.id, key: t.key, kind: t.keyKind } : null;
    const r = await post("/api/move", { ref, into, reset });
    toast(r.error ? `Couldn't move: ${r.error}` : reset ? `${short(ref)} is back where its key puts it` : `Moved ${short(ref)} ${t ? `into ${t.key}` : "out on its own"}`);
    onClose();
  };
  if (!mine.length) return (
    <Sheet title={`Move ${it.key}`} onClose={onClose}>
      <p>Only your own PRs can be moved.</p>
      <div className="row"><button className="btn" onClick={onClose}>OK</button></div>
    </Sheet>
  );
  return (
    <Sheet title={`Move a PR of ${it.key}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); void go(); }}>
        {mine.length > 1 && (
          <ul className="pick-list">
            {mine.map((p) => <li key={refOf(p)}><label><input type="radio" checked={ref === refOf(p)} onChange={() => setRef(refOf(p))} /> <b>{short(refOf(p))}</b> {p.title}</label></li>)}
          </ul>
        )}
        <select className="field" autoFocus value={to} onChange={(e) => setTo(e.target.value)}>
          <option value="split">Its own work item</option>
          {targets.map((x) => <option key={x.id} value={x.id}>Into {x.key} · {x.title}</option>)}
        </select>
        <p className="st dim" style={{ margin: "8px 0 0" }}>Kept here only; nothing changes on GitHub or Jira.</p>
        <div className="row">
          {moved && <button type="button" className="btn" onClick={() => void go(true)}>Put back</button>}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" type="submit">Move <kbd>⏎</kbd></button>
        </div>
      </form>
    </Sheet>
  );
}

/** Remove: hide the work item's PRs, or whole repos, via prs.py's exclude list (editable in Removed). */
export function RemoveSheet({ it, onClose }: { it: WorkItem; onClose: () => void }) {
  const prs = it.prs.map((p) => ({ key: `${p.repo}#${p.number}`, label: `${short(p.repo)}#${p.number}`, title: p.title }));
  const repos = [...new Set(it.prs.map((p) => p.repo))];
  const [picked, setPicked] = useState<Set<string>>(new Set(prs.map((p) => p.key)));
  const [why, setWhy] = useState("");
  const toggle = (k: string) => setPicked((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
  if (!prs.length) return (
    <Sheet title={`Remove ${it.key}`} onClose={onClose}>
      <p>This is an agent with no PR. Use <b>Mark seen</b> or <b>Close session</b> in its pane, or park it.</p>
      <div className="row"><button className="btn" onClick={onClose}>OK</button></div>
    </Sheet>
  );
  const go = async () => {
    const r = await post("/api/remove", { item: it.id, keys: [...picked], why: why.trim() });
    toast(r.error ? `Couldn't remove: ${r.error}` : `Removed ${picked.size} from the board; restore from Removed (e)`);
    onClose();
  };
  return (
    <Sheet title={`Remove ${it.key}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); if (picked.size) void go(); }}>
        <ul className="pick-list">
          {prs.map((p) => <li key={p.key}><label><input type="checkbox" checked={picked.has(p.key)} onChange={() => toggle(p.key)} /> <b>{p.label}</b> {p.title}</label></li>)}
          {repos.map((r) => <li key={r}><label><input type="checkbox" checked={picked.has(r)} onChange={() => toggle(r)} /> every PR in <b>{short(r)}</b> (ignore the repo)</label></li>)}
        </ul>
        <input className="field" autoFocus placeholder="Why (optional, kept in the list)" value={why} onChange={(e) => setWhy(e.target.value)} />
        <p className="st dim" style={{ margin: "8px 0 0" }}>Hidden here and from prs.py in the terminal. Listed under Removed (e), where you can edit or restore it.</p>
        <div className="row"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" type="submit" disabled={!picked.size}>Remove <kbd>⏎</kbd></button></div>
      </form>
    </Sheet>
  );
}

/** The remove list (prs.py's exclude file): edit a reason or restore. */
export function Removed({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<{ key: string; why: string }[] | null>(null);
  const [file, setFile] = useState("");
  const [edits, setEdits] = useState<Record<string, string>>({});
  const load = async () => {
    const r = await fetch("/api/removed").then((x) => x.json()).catch(() => ({ error: "server unreachable" }));
    if (r.error) return toast(r.error);
    setEntries(r.entries);
    setFile(r.file);
    setEdits({});
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !(e.target as HTMLElement).closest("input")) { e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  const save = async (key: string) => { const r = await post("/api/removed", { key, why: edits[key] }); toast(r.error ?? `Saved ${key}`); void load(); };
  const restore = async (key: string) => { const r = await post("/api/removed", { key }); toast(r.error ?? `Restored ${key}; it's back after the next refresh`); void load(); };
  const takeOver = async (key: string) => { const r = await post("/api/adopt", { ref: key, note: "", item: null }); toast(r.error ?? `Took over ${key}; it's on the board as yours`); void load(); };
  return (
    <div className="tidy">
      <div className="tidy-head">
        <div><h2>Removed</h2><span className="st dim">{entries ? `${entries.length} hidden` : "Loading…"} · shared with prs.py · the file is {file}, edit it by hand too</span></div>
        <button className="btn" onClick={onClose}>Done <kbd>esc</kbd></button>
      </div>
      <div className="tidy-list">
        {entries?.map((e) => (
          <form key={e.key} className="hist-row removed" onSubmit={(ev) => { ev.preventDefault(); void save(e.key); }}>
            <b>{e.key}</b>
            <input className="field" value={edits[e.key] ?? e.why} placeholder="no reason given" onChange={(ev) => setEdits({ ...edits, [e.key]: ev.target.value })} />
            <div className="row-acts">
              {edits[e.key] !== undefined && edits[e.key] !== e.why && <button className="btn sm" type="submit">Save</button>}
              <button className="btn sm" type="button" onClick={() => restore(e.key)}>Restore</button>
              {e.key.includes("#") && <button className="btn sm" type="button" onClick={() => takeOver(e.key)} title="You're working on it now: back on the board as your PR">Take over</button>}
            </div>
          </form>
        ))}
        {entries && !entries.length && <div className="empty">Nothing removed. Press x on a work item to remove it.</div>}
      </div>
    </div>
  );
}

/** Effort: a named level above work items, for work spread over several keys. Local only. */
export function EffortSheet({ it, items, onClose }: { it: WorkItem; items: WorkItem[]; onClose: () => void }) {
  const names = [...new Set(items.flatMap((x) => (x.effort ? [x.effort] : [])))].sort();
  const [name, setName] = useState(it.effort ?? "");
  const go = async (effort: string | null) => {
    const r = await post("/api/effort", { key: it.key, effort });
    toast(r.error ? `Couldn't set the effort: ${r.error}` : effort ? `${it.key} is in ${effort}` : `${it.key} left ${it.effort}`);
    onClose();
  };
  return (
    <Sheet title={`Effort for ${it.key}`} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); if (name.trim()) void go(name.trim()); }}>
        <input className="field" autoFocus list="efforts" placeholder="e.g. retire the old tenants" value={name} onChange={(e) => setName(e.target.value)} />
        <datalist id="efforts">{names.map((n) => <option key={n} value={n} />)}</datalist>
        {names.length > 0 && <div className="chips" style={{ margin: "10px 0 0" }}>{names.map((n) => <button type="button" key={n} className={`chip ${name === n ? "on" : ""}`} onClick={() => setName(n)}>{n}</button>)}</div>}
        <p className="st dim" style={{ margin: "8px 0 0" }}>Group the board by effort with g. Kept here only.</p>
        <div className="row">
          {it.effort && <button type="button" className="btn" onClick={() => void go(null)}>Take out of {it.effort}</button>}
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" type="submit" disabled={!name.trim()}>Set <kbd>⏎</kbd></button>
        </div>
      </form>
    </Sheet>
  );
}
