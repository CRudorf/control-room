// The Start box: paste a Jira issue, Sentry issue or PostHog replay and a new herdr tab runs signal-to-pr
// on it; or describe a task and Claude starts on it as written. Left empty, it lists the Suggestions to
// pick up (GLOSSARY: Suggestion); ⏎ with none chosen still runs triage.
import { useEffect, useRef, useState } from "react";
import type { Suggestion as Sug, SuggestionsView, WorkItem } from "../shared/types";
import { post, toast } from "./actions";
import { Sheet } from "./lists";
import { SuggestionList } from "./suggestions";

type Suggestion = {
  signal: { kind: "jira" | "sentry" | "posthog" | "task"; key: string } | null;
  repo: string | null; why?: string | null; repos: { repo: string; profiled: boolean }[]; skill: boolean;
};

const stored = (k: string) => { try { return localStorage.getItem(k) === "1"; } catch { return false; } };
const store = (k: string, v: boolean) => { try { localStorage.setItem(k, v ? "1" : "0"); } catch {} };

export function StartBox({ items, initial = "", context = "", sugs, onClose, onFocus, onStarted }: {
  items: WorkItem[]; initial?: string; context?: string; sugs: { view: SuggestionsView | null; reload: () => void };
  onClose: () => void; onFocus: (id: string) => void; onStarted?: () => void;
}) {
  const [text, setText] = useState(initial);
  const [pick, setPick] = useState(-1);
  const [steps, setSteps] = useState({ assign: true, move: true, agent: true });
  const [pickRepo, setPickRepo] = useState("");
  const list = sugs.view?.suggestions ?? [];
  const picked: Sug | null = !text.trim() && pick >= 0 ? list[pick] ?? null : null;
  const pickedArch = picked?.source === "architecture";
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setSteps({ assign: true, move: true, agent: true }); setPickRepo(""); }, [picked?.key]);
  useEffect(() => {
    if (!picked) return;
    if (pickedArch) { setPickRepo(picked.repo ?? ""); return; }
    void fetch(`/api/start?signal=${encodeURIComponent(picked.key)}`).then((x) => x.json()).then((x) => setPickRepo(x.repo ?? x.repos?.[0]?.repo ?? "")).catch(() => {});
  }, [picked?.key, pickedArch]);
  const pickup = async () => {
    if (!picked || !pickRepo) return;
    setBusy(true);
    const r = await post("/api/suggestions/pickup", { key: picked.key, repo: pickRepo, steps: pickedArch ? {} : steps });
    setBusy(false);
    toast(r.error ? `Couldn't pick up ${picked.key}: ${r.error}` : `Picked up ${pickedArch ? picked.summary : picked.key}${r.dryRun ? " (dry run)" : ""}`);
    if (!r.error) { sugs.reload(); onStarted?.(); onClose(); }
  };
  const move = (d: number) => setPick((i) => {
    const n = Math.max(-1, Math.min(list.length - 1, i + d));
    listRef.current?.querySelector<HTMLElement>(`[data-i="${n}"]`)?.scrollIntoView({ block: "nearest" });
    return n;
  });
  const [s, setS] = useState<Suggestion | null>(null);
  const [repo, setRepo] = useState("");
  const [unattended, setUnattended] = useState(false);
  // Off each time: a video costs a full agent session.
  const [video, setVideo] = useState(false);
  const [done, setDone] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const t = setTimeout(async () => {
      const r: Suggestion = await fetch(`/api/start?signal=${encodeURIComponent(text)}`).then((x) => x.json()).catch(() => null);
      if (!r) return;
      setS(r);
      setRepo((cur) => r.repo ?? cur);
      if (r.signal) setUnattended(stored(`cr-unattended-${r.signal.kind}`));
    }, 200);
    return () => clearTimeout(t);
  }, [text]);
  const sig = s?.signal ?? null;
  const existing = sig ? items.find((i) => i.key === sig.key) : undefined;
  const triage = !text.trim() && !!s?.skill;
  const doneRef = useRef<HTMLInputElement>(null);
  const [needDone, setNeedDone] = useState(false);
  const go = async (another = false) => {
    if (picked) { await pickup(); return; }
    if (triage && repo) {
      setBusy(true);
      const r = await post("/api/start", { triage: true, repo });
      setBusy(false);
      toast(r.error ? `Couldn't start: ${r.error}` : r.dryRun ? `Dry run: would start ${r.label} in ${repo}` : `Started triage in ${repo}`);
      if (!r.error) { onStarted?.(); onClose(); }
      return;
    }
    if (!sig || !repo) return;
    if (existing?.agents.length && !another) { onFocus(existing.id); onClose(); return; }
    if (sig.kind === "task" && !done.trim()) { setNeedDone(true); doneRef.current?.focus(); return; }
    setBusy(true);
    store(`cr-unattended-${sig.kind}`, unattended);
    const r = await post("/api/start", { signal: text, repo, unattended, video, ...(sig.kind === "task" && done.trim() ? { done } : {}),
      ...(context && text.trim() === initial.trim() ? { context } : {}) });
    setBusy(false);
    toast(r.error ? `Couldn't start: ${r.error}` : r.dryRun ? `Dry run: would start ${r.label} in ${repo}` : `Started ${r.label} in ${repo}`);
    if (!r.error) { onStarted?.(); onClose(); }
  };
  return (
    <Sheet title="Start work" onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); void go(); }}>
        <textarea className="field ask" autoFocus rows={4} placeholder={"What to work on, in your words.\nOr paste an issue key or link, an error report or a session replay."}
          value={text} onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void go(); }
            if (!text.trim() && (e.key === "ArrowDown" || e.key === "ArrowUp")) { e.preventDefault(); move(e.key === "ArrowDown" ? 1 : -1); }
            if (e.key === "Escape" && pick >= 0) { e.preventDefault(); e.stopPropagation(); setPick(-1); }
          }} />
        {!text.trim() && sugs.view && (
          <SuggestionList view={sugs.view} reload={sugs.reload} pick={pick} onPick={(i) => setPick((c) => (c === i ? -1 : i))} listRef={listRef} />
        )}
        {picked && (
          <div className="pick-steps">
            {pickedArch ? <p className="st">Starts an agent that runs /grilling on this candidate in <b>{pickRepo}</b>. Nothing goes to the tracker.</p> : <>
              <label><input type="checkbox" checked={steps.assign} onChange={(e) => setSteps({ ...steps, assign: e.target.checked, move: e.target.checked && steps.move })} /> Assign {picked.key} to you in the tracker</label>
              {picked.tracker !== "github" && <label><input type="checkbox" checked={steps.move} disabled={!steps.assign} onChange={(e) => setSteps({ ...steps, move: e.target.checked })} /> Move {picked.key} to In Progress{!steps.assign && " (needs Assign)"}</label>}
              <label><input type="checkbox" checked={steps.agent} onChange={(e) => setSteps({ ...steps, agent: e.target.checked })} /> Start signal-to-pr on {picked.key} in
                <select className="field inline" value={pickRepo} onChange={(e) => setPickRepo(e.target.value)}>
                  {s?.repos.map((r) => <option key={r.repo} value={r.repo}>{r.repo}</option>)}
                </select></label>
              {(steps.assign || steps.move) && <p className="st dim">Everyone watching {picked.key} sees the changes in the tracker.</p>}
            </>}
          </div>
        )}
        <p className="st dim" style={{ margin: "8px 0" }}>
          {picked ? <>⏎ picks up <b>{pickedArch ? picked.summary : picked.key}</b>. Esc or click it again to go back to triage.</>
            : triage ? <>↑↓ to choose a suggestion. Left empty, ⏎ runs signal-to-pr's triage: {repo || "the repo"}'s live errors and slow endpoints as a menu to pick from, in a new agent tab.</>
            : !sig ? "Opens a new herdr tab with Claude in a fresh worktree. ⇧⏎ for a new line."
            : existing?.agents.length ? <><b>{sig.key}</b> already has an agent. ⏎ shows it; or start another.</>
            : sig.kind === "task" ? <>A task: Claude gets it as written, as <b>{sig.key}</b> on the board.{s?.why ? ` ${repo} is ${s.why}.` : ""}</>
            : <><b>{sig.key}</b> · {sig.kind}, runs signal-to-pr{s?.why ? ` · ${repo} is ${s.why}` : ""}</>}
        </p>
        {!picked && <select className="field" value={repo} onChange={(e) => setRepo(e.target.value)}>
          <option value="" disabled>Pick a repo</option>
          {s?.repos.map((r) => <option key={r.repo} value={r.repo}>{r.repo}{r.profiled ? " · profiled" : ""}</option>)}
        </select>}
        {sig?.kind === "task" && (
          <>
            <input ref={doneRef} className="field" style={{ marginTop: 10, ...(needDone ? { borderColor: "var(--warn)" } : {}) }} aria-invalid={needDone} aria-describedby={needDone ? "done-need" : undefined} placeholder="Done when: what you'll check to call it finished" value={done} onChange={(e) => { setDone(e.target.value); setNeedDone(false); }} />
            {needDone && <p id="done-need" role="alert" className="st" style={{ margin: "6px 0 0" }}>Say what done looks like, so the agent can check its work against it.</p>}
          </>
        )}
        {sig && sig.kind !== "task" && (<>
          <label className="st" style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 10 }}>
            <input type="checkbox" checked={unattended} onChange={(e) => setUnattended(e.target.checked)} /> Unattended: run to the end without checkpoints
          </label>
          <label className="st" style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 6 }} title="After the checks, an agent renders a short video of the evidence, saved to Visuals"><input type="checkbox" checked={video} onChange={(e) => setVideo(e.target.checked)} /> Make a verification video</label>
        </>)}
        {sig && sig.kind !== "task" && s && !s.skill && <p className="st dim" style={{ margin: "8px 0 0" }}>signal-to-pr isn't in ~/.claude/skills yet, so the agent gets a plain start-from-this prompt.</p>}
        <div className="row">
          <button type="button" className="btn" onClick={onClose}>Cancel</button>
          {existing?.agents.length ? <button type="button" className="btn" disabled={busy || !repo} onClick={() => void go(true)}>Start another</button> : null}
          {picked
            ? <button className="btn primary" type="submit" disabled={busy || !pickRepo || (!pickedArch && !steps.assign && !steps.move && !steps.agent)}>{busy ? "Picking up…" : "Pick up"} <kbd>⏎</kbd></button>
            : <button className="btn primary" type="submit" disabled={busy || (!sig && !triage) || !repo}>{existing?.agents.length ? "Show it" : busy ? "Starting…" : triage ? "Triage" : "Start"} <kbd>⏎</kbd></button>}
        </div>
      </form>
    </Sheet>
  );
}
