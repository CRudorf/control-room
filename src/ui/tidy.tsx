import { post } from "./actions";
import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import type { TidyTab } from "../shared/types";

type Closed = { at: string; label: string; result: string; resume: string[] };

const H = 3600_000, D = 24 * H;
function ago(iso: string | null) {
  if (!iso) return "unknown";
  const d = Date.now() - Date.parse(iso);
  return d < H ? `${Math.max(1, Math.round(d / 60_000))}m` : d < D ? `${Math.round(d / H)}h` : `${Math.round(d / D)}d`;
}

const HEAVY_MB = 2048;
const gb = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`);

/** Every herdr tab, stalest first, with the ones safe to close pre-selected. */
export function Tidy({ onClose }: { onClose: () => void }) {
  const [tabs, setTabs] = useState<TidyTab[] | null>(null);
  const [closed, setClosed] = useState<Closed[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [machine, setMachine] = useState<{ totalGb: number; freePct: number | null; low: boolean } | null>(null);
  const [heaviest, setHeaviest] = useState(false);
  const [guardrails, setGuardrails] = useState<string[]>([]);
  const [noChecks, setNoChecks] = useState<string[]>([]);
  const [addedCheck, setAddedCheck] = useState<Set<string>>(new Set());

  const load = async () => {
    const r = await fetch("/api/tidy").then((x) => x.json()).catch(() => ({ error: "server unreachable" }));
    if (r.error) return setErr(r.error);
    setTabs(r.tabs);
    setClosed(r.closed);
    setMachine(r.machine ?? null);
    setGuardrails(r.guardrails ?? []);
    setNoChecks(r.noChecks ?? []);
    setPicked(new Set(r.tabs.filter((t: TidyTab) => t.suggest).map((t: TidyTab) => t.tab)));
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); confirming ? setConfirming(false) : onClose(); } };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [confirming, onClose]);

  const byWorkspace = useMemo(() => {
    // Heaviest first is one list across workspaces: the point is what to close to free memory.
    if (heaviest) return [["Heaviest first", [...(tabs ?? [])].sort((a, b) => b.mb - a.mb)]] as [string, TidyTab[]][];
    const m = new Map<string, TidyTab[]>();
    for (const t of tabs ?? []) m.set(t.workspace, [...(m.get(t.workspace) ?? []), t]);
    return [...m.entries()];
  }, [tabs, heaviest]);
  const totalMb = (tabs ?? []).reduce((a, t) => a + t.mb, 0);
  const chosen = (tabs ?? []).filter((t) => picked.has(t.tab));
  const sessions = chosen.flatMap((t) => t.panes.filter((p) => p.kind === "claude")).length;
  const running = chosen.filter((t) => t.panes.some((p) => p.kind === "other" || p.status === "working" || p.status === "blocked"));

  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const close = async () => {
    setBusy(true);
    const r = await fetch("/api/tidy/close", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tabs: [...picked] }) })
      .then((x) => x.json()).catch(() => ({ error: "server unreachable" }));
    setBusy(false);
    setConfirming(false);
    const failed = r.results?.filter((x: any) => !x.ok) ?? [];
    setErr(r.error ?? (failed.length ? `${failed.length} tab(s) didn't close: ${failed[0].error}` : null));
    await load();
  };

  return (
    <div className="tidy">
      <div className="tidy-head">
        <div>
          <h2>Tidy herdr</h2>
          <span className="st dim">{tabs ? `${tabs.length} tabs · ${heaviest ? "heaviest" : "stalest"} first · suggested: nothing running, no open PR, quiet for a day` : "Loading…"}</span>
          {machine && <div className={`st memline ${machine.low ? "low" : ""}`}>Memory: {machine.freePct ?? "?"}% free of {machine.totalGb} GB · herdr tabs use {gb(totalMb)}</div>}
          {guardrails.length > 0 && (
            <details className="st guardline">
              <summary>Guardrails: {guardrails.length} gap{guardrails.length === 1 ? "" : "s"} in Claude Code settings or branch protection</summary>
              <ul>{guardrails.map((g) => <li key={g}>{g}</li>)}</ul>
            </details>
          )}
          {noChecks.length > 0 && (
            <details className="st guardline">
              <summary>Stop checks: {noChecks.length} repo{noChecks.length === 1 ? "" : "s"} let agents finish without running checks</summary>
              <ul>{noChecks.map((r) => <li key={r}>{r} <button className="btn" disabled={addedCheck.has(r)} title="An agent adds a Stop hook that runs the repo's typecheck and fast tests, and opens a draft PR" onClick={async () => {
                const x = await post("/api/checks/add", { repo: r });
                if (x.error) return setErr(x.error);
                setAddedCheck((s) => new Set(s).add(r));
              }}>{addedCheck.has(r) ? "Started" : "Add it"}</button></li>)}</ul>
            </details>
          )}
        </div>
        <div className="row-acts">
          <button className={`btn ${heaviest ? "on" : ""}`} onClick={() => setHeaviest((x) => !x)}>{heaviest ? "Stalest first" : "Heaviest first"}</button>
          <button className="btn" onClick={() => setPicked(new Set((tabs ?? []).filter((t) => t.suggest).map((t) => t.tab)))}>Select suggested</button>
          <button className="btn" onClick={() => setPicked(new Set())}>Clear</button>
          <button className="btn primary" disabled={!picked.size} onClick={() => setConfirming(true)}>Close {picked.size} tab{picked.size === 1 ? "" : "s"}</button>
          <button className="btn" onClick={onClose}>Done <kbd>esc</kbd></button>
        </div>
      </div>
      {err && <div className="tidy-err">{err}</div>}
      <div className="tidy-body">
        <div className="tidy-list">
          {byWorkspace.map(([ws, ts]) => (
            <section key={ws}>
              <div className="bay-h" style={{ "--hc": "var(--ink-3)" } as React.CSSProperties}><span className="sw" />{ws} <span className="c">{ts.length}</span><span className="rule" /></div>
              {ts.map((t) => (
                <label key={t.tab} className={`tidy-row ${picked.has(t.tab) ? "on" : ""}`}>
                  <input type="checkbox" checked={picked.has(t.tab)} onChange={() => toggle(t.tab)} />
                  <div className="tl"><b>{t.label}</b>{t.focused && <span className="st dim"> · on screen</span>}</div>
                  <div className="tp">
                    {t.panes.map((p) => (
                      <span key={p.pane} className={`chip ${p.kind}`} title={`${p.cwd}${p.session ? `\nsession ${p.session}` : ""}`}>
                        <i className={`dot ${p.kind === "other" ? "working" : p.status}`} />
                        {p.kind === "claude" ? (p.title || "claude") : p.title}
                        {p.item && <em> · {p.item.key}{p.item.openPrs ? ` (${p.item.openPrs} open PR${p.item.openPrs > 1 ? "s" : ""})` : ""}</em>}
                        {p.mb >= 100 && <em> · {gb(p.mb)}</em>}
                      </span>
                    ))}
                  </div>
                  <div className="ta"><span className={`mem ${t.mb >= HEAVY_MB ? "heavy" : ""}`}>{gb(t.mb)}</span> · {ago(t.lastActive)}</div>
                </label>
              ))}
            </section>
          ))}
        </div>
        <aside className="pane tidy-closed">
          <h3><span>Recently closed</span><span className="st dim">{closed.length}</span></h3>
          <div className="in">
            {closed.length ? closed.map((c, i) => (
              <div key={i} className="thread">
                <span className="who">{c.label}</span> <span className="where">{ago(c.at)} ago · {c.result}</span>
                {c.resume.map((cmd) => (
                  <div key={cmd} className="resume">
                    <code>{cmd}</code>
                    <button className="btn" onClick={() => navigator.clipboard.writeText(cmd)}>Copy</button>
                  </div>
                ))}
              </div>
            )) : <div className="empty">Closed tabs land here with the command to resume each session.</div>}
          </div>
        </aside>
      </div>
      {confirming && (
        <div className="scrim" onClick={(e) => e.target === e.currentTarget && setConfirming(false)}>
          <motion.div className="sheet" initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
            <h3>Close {chosen.length} herdr tab{chosen.length === 1 ? "" : "s"}?</h3>
            <div className="who">
              Ends {sessions} Claude session{sessions === 1 ? "" : "s"}. Each can be resumed later from Recently closed.
              {running.length > 0 && <><br /><b>{running.length} still running something:</b> {running.map((t) => t.label).join(", ")}</>}
            </div>
            <ul className="sheet-list">{chosen.map((t) => <li key={t.tab}>{t.workspace} / {t.label}</li>)}</ul>
            <div className="row">
              <button className="btn" onClick={() => setConfirming(false)}>Cancel</button>
              <button className="btn primary" autoFocus disabled={busy} onClick={close}>{busy ? "Closing…" : "Close tabs"} <kbd>⏎</kbd></button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

type Entry = { at: string; item: string | null; action: string; trigger: string | null; label: string | null; result: string | null; dryRun: boolean; resume: string[] };

const ACTION: Record<string, string> = { "start-agent": "Started agent", notify: "Notified", "close-tab": "Closed tab", "close-pane": "Closed session", "mark-seen": "Marked seen", "verify-start": "Verify started", "verify-up": "Verify app up", "verify-failed": "Verify failed", "verify-stop": "Verify stopped", "verify-confirm": "Verify verdict", "verify-delete": "Verify deleted", "cleanup-worktrees": "Removed worktrees", "cleanup-reap": "Auto cleanup" };

/** What the control room has done, newest first (the action record). */
export function History({ onClose }: { onClose: () => void }) {
  const [entries, setEntries] = useState<Entry[] | null>(null);
  const [kind, setKind] = useState<string>("all");
  useEffect(() => { void fetch("/api/history").then((x) => x.json()).then((r) => setEntries(r.entries ?? [])); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  const kinds = [...new Set((entries ?? []).map((e) => e.action))];
  const shown = (entries ?? []).filter((e) => kind === "all" || e.action === kind);
  return (
    <div className="tidy">
      <div className="tidy-head">
        <div><h2>History</h2><span className="st dim">{entries ? `${entries.length} recorded` : "Loading…"} · every write and notification the control room makes</span></div>
        <div className="row-acts">
          <div className="seg">
            {["all", ...kinds].map((k) => <button key={k} className={kind === k ? "on" : ""} onClick={() => setKind(k)}>{k === "all" ? "All" : ACTION[k] ?? k}</button>)}
          </div>
          <button className="btn" onClick={onClose}>Done <kbd>esc</kbd></button>
        </div>
      </div>
      <div className="tidy-list">
        {shown.map((e, i) => (
          <div key={i} className="hist-row">
            <span className="ta">{new Date(e.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
            <span className="st">{ACTION[e.action] ?? e.action}{e.dryRun ? " (dry run)" : ""}</span>
            <div className="hl">
              <b>{e.label}</b> <span className="st dim">{e.result}</span>
              {e.resume.map((cmd) => (
                <div key={cmd} className="resume"><code>{cmd}</code><button className="btn" onClick={() => navigator.clipboard.writeText(cmd)}>Copy</button></div>
              ))}
            </div>
          </div>
        ))}
        {entries && !shown.length && <div className="empty">Nothing recorded yet.</div>}
      </div>
    </div>
  );
}
