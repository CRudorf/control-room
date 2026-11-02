import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import type { Agent, HandoffTask, WorkItem } from "../shared/types";

const free = (a: Agent) => a.status !== "working" && a.status !== "blocked";
const names = (a: Agent, pr: string | null) => !!pr && new RegExp(`\\b${pr.split("/").pop()!.replace(/[.-]/g, "\\$&")}\\b`).test(a.label);

/**
 * Where a task goes by default: the session already on its PR keeps its context; else another free
 * session on the item, cleared first; else a new tab.
 */
function whereFor(it: WorkItem, t: HandoffTask): { pane: string | null; fresh: boolean } {
  const own = it.agents.find((a) => free(a) && names(a, t.pr));
  if (own) return { pane: own.pane, fresh: false };
  const any = it.agents.find(free);
  return any ? { pane: any.pane, fresh: true } : { pane: null, fresh: false };
}

/** Start a Claude agent on a work item: pick the task and where it runs, edit its prompt, ⌘⏎. */
export function StartAgent({ it, kind, pr, onClose, onStarted }: {
  it: WorkItem; kind?: HandoffTask["kind"]; pr?: string; onClose: () => void; onStarted: (msg: string) => void;
}) {
  const [tasks, setTasks] = useState<HandoffTask[] | null>(null);
  const [repos, setRepos] = useState<string[]>([]);
  const [repo, setRepo] = useState("");
  const [pick, setPick] = useState(0);
  const [prompt, setPrompt] = useState("");
  const [original, setOriginal] = useState("");
  const [busy, setBusy] = useState(false);
  const [where, setWhere] = useState<{ pane: string | null; fresh: boolean }>({ pane: null, fresh: false });
  const [err, setErr] = useState<string | null>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    void fetch(`/api/handoff?item=${encodeURIComponent(it.id)}`).then((x) => x.json()).then((r) => {
      if (r.error) return setErr(r.error);
      const exact = r.tasks.findIndex((t: HandoffTask) => t.kind === kind && (!pr || t.pr === pr));
      const i = Math.max(0, exact >= 0 ? exact : r.tasks.findIndex((t: HandoffTask) => t.kind === kind));
      setTasks(r.tasks);
      setRepos(r.repos);
      setRepo(r.repos[0] ?? "");
      choose(r.tasks, i);
    });
  }, [it.id, kind, pr]);

  const choose = (ts: HandoffTask[], i: number) => {
    setPick(i);
    if (ts[i].pr) setRepo(ts[i].pr!.split("#")[0].split("/").pop()!);
    setPrompt(ts[i].prompt);
    setOriginal(ts[i].prompt);
    setWhere(whereFor(it, ts[i]));
    setTimeout(() => { box.current?.focus(); box.current?.setSelectionRange(box.current.value.length, box.current.value.length); }, 0);
  };

  const start = async () => {
    if (!tasks || !repo || !prompt.trim() || busy) return;
    setBusy(true);
    setErr(null);
    const t = tasks[pick];
    const r = await fetch("/api/handoff", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ item: it.id, repo, pr: t.pr, kind: t.kind, prompt, edited: prompt !== original, reuse: where.pane ? where : null, newSession: !where.pane }),
    }).then((x) => x.json()).catch(() => ({ error: "server unreachable" }));
    setBusy(false);
    if (r.error) return setErr(r.error);
    const how = r.reused ? `${r.fresh ? "cleared and restarted" : "continued"} ${r.name}` : `started ${r.name} in a new ${repo} tab`;
    onStarted(r.dryRun ? `Dry run: would have ${how}` : how[0].toUpperCase() + how.slice(1));
    onClose();
  };

  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && onClose()}
      onKeyDown={(e) => {
        if (e.key === "Escape") { e.stopPropagation(); onClose(); }
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void start(); }
      }}>
      <motion.div className="sheet wide" initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
        <h3>Start an agent on {it.key}</h3>
        {!tasks ? <div className="st dim">{err ?? "Loading…"}</div> : (
          <>
            <div className="chips">
              {tasks.map((t, i) => (
                <button key={t.label} className={`chip ${i === pick ? "on" : ""}`} onClick={() => choose(tasks, i)}>{t.label}</button>
              ))}
            </div>
            {it.agents.length > 0 && (
              <div className="where">
                <span className="st dim">Run it in</span>
                {it.agents.map((a) => (
                  <button key={a.pane} className={`chip ${where.pane === a.pane ? "on" : ""}`} disabled={!free(a)}
                    title={free(a) ? `${a.workspaceLabel} / ${a.label}${a.branch ? ` · ${a.branch}` : ""}` : `It's ${a.status === "working" ? "working" : "waiting on a dialog"}`}
                    onClick={() => setWhere({ pane: a.pane, fresh: !names(a, tasks[pick].pr) })}>
                    <i className={`dot ${a.status}`} />{a.label}
                  </button>
                ))}
                <button className={`chip ${where.pane === null ? "on" : ""}`} onClick={() => setWhere({ pane: null, fresh: false })}>New tab</button>
                {where.pane && (
                  <div className="seg">
                    <button className={!where.fresh ? "on" : ""} onClick={() => setWhere({ ...where, fresh: false })} title="It keeps everything it already knows">Keep context</button>
                    <button className={where.fresh ? "on" : ""} onClick={() => setWhere({ ...where, fresh: true })} title="/clear first: same tab and worktree, empty context">Clear context</button>
                  </div>
                )}
              </div>
            )}
            <div className="meta" style={{ margin: "10px 0 6px" }}>
              {where.pane ? (
                <>{where.fresh ? "Clears that session with /clear, then sends this" : "Sends this to that session, which keeps its context"}: same tab, same worktree. Nothing is pushed or posted unless the prompt says so.</>
              ) : (
                <>New tab in the {repos.length > 1 ? (
                  <select value={repo} onChange={(e) => setRepo(e.target.value)}>{repos.map((r) => <option key={r}>{r}</option>)}</select>
                ) : <b>{repo || "?"}</b>} workspace, Claude in a fresh worktree. Nothing is pushed or posted unless the prompt says so.</>
              )}
            </div>
            <textarea ref={box} className="prompt" value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={12}
              placeholder="What should the agent do?" />
            {err && <div className="tidy-err">{err}</div>}
            <div className="row">
              <button className="btn" onClick={onClose}>Cancel</button>
              <button className="btn primary" disabled={busy || !repo || !prompt.trim()} onClick={start}>{busy ? "Starting…" : where.pane ? "Send" : "Start agent"} <kbd>⌘⏎</kbd></button>
            </div>
          </>
        )}
      </motion.div>
    </div>
  );
}
