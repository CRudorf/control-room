// Suggestions (GLOSSARY: Suggestion): the Start box's list of work to pick up next, with the link
// verdict, and the preview sheet Next mode uses, which lists every step a pickup takes before it runs.
import { useCallback, useEffect, useRef, useState } from "react";
import type { Suggestion, SuggestionsView, SuggestSource } from "../shared/types";
import { Confirm, post, toast } from "./actions";

export const SOURCE: Record<SuggestSource, string> = { a: "Sprint", b: "Next up", c: "Labeled", d: "Backlog", architecture: "Architecture" };

/** The suggestions view, fetched again whenever `stamp` changes (the board's poll time). */
export function useSuggestions(stamp: string | null) {
  const [view, setView] = useState<SuggestionsView | null>(null);
  const reload = useCallback(() => {
    void fetch("/api/suggestions").then((r) => r.json()).then(setView).catch(() => {});
  }, []);
  useEffect(reload, [stamp, reload]);
  return { view, reload };
}

const ago = (iso: string | null) => {
  if (!iso) return "never";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60_000);
  return m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`;
};

/** Before a pickup: exactly the steps it takes, and the repo its agent opens in. */
export function PickupSheet({ s, onClose, onDone }: { s: Suggestion; onClose: () => void; onDone?: () => void }) {
  const arch = s.source === "architecture";
  const [repos, setRepos] = useState<string[]>(arch && s.repo ? [s.repo] : []);
  const [repo, setRepo] = useState(arch ? s.repo ?? "" : "");
  useEffect(() => {
    if (arch) return;
    void fetch(`/api/start?signal=${encodeURIComponent(s.key)}`).then((r) => r.json()).then((x) => {
      setRepos(x.repos.map((c: { repo: string }) => c.repo));
      setRepo((r) => r || x.repo || x.repos[0]?.repo || "");
    }).catch(() => {});
  }, [s.key, arch]);
  return (
    <Confirm title={`Pick up ${arch ? s.summary : s.key}`} label="Pick up" onClose={onClose}
      who={arch ? "Starts an agent that grills you on this candidate. Nothing goes to the tracker." : `Everyone watching ${s.key} sees it assigned to you and moved to In Progress.`}
      go={async () => {
        const r = await post("/api/suggestions/pickup", { key: s.key, repo });
        toast(r.error ? `Couldn't pick up ${s.key}: ${r.error}` : `Picked up ${arch ? s.summary : s.key}${r.dryRun ? " (dry run)" : ""}`);
        if (!r.error) onDone?.();
      }}>
      <ol className="sheet-list">
        {!arch && <li>Assign {s.key} to you in the tracker.</li>}
        {!arch && <li>Move {s.key} to In Progress.</li>}
        <li>{arch ? "Start an agent on /grilling for this candidate" : `Start signal-to-pr on ${s.key}`} in <b>{repo || "…"}</b>.</li>
      </ol>
      {!arch && (
        <label className="sug-repo">Repo <select value={repo} onChange={(e) => setRepo(e.target.value)}>{repos.map((r) => <option key={r}>{r}</option>)}</select></label>
      )}
    </Confirm>
  );
}

const CHUNK = 15;

/** Sets up GitHub Issues as this project's tracker. Only repos that pass the private word check are offered. */
function TrackerSetup({ onDone }: { onDone: () => void }) {
  const [t, setT] = useState<{ options: string[]; error: string | null } | null>(null);
  const [on, setOn] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => { void fetch("/api/tracker").then((x) => x.json()).then(setT).catch(() => {}); }, []);
  const save = async () => {
    setBusy(true);
    const r = await post("/api/tracker", { repos: [...on] });
    setBusy(false);
    toast(r.error ? `Couldn't set it up: ${r.error}` : r.dryRun ? "Dry run: tracker set until restart" : "Tracker set up");
    if (!r.error) onDone();
  };
  if (!t) return <div className="st dim sug-more">Loading…</div>;
  return (
    <div className="pick-steps">
      <p className="st">No tracker yet. Use GitHub Issues from:</p>
      {t.error && <p className="tidy-err">{t.error}</p>}
      {t.options.map((r) => <label key={r}><input type="checkbox" checked={on.has(r)} onChange={(e) => { const n = new Set(on); if (e.target.checked) n.add(r); else n.delete(r); setOn(n); }} /> {r}</label>)}
      {!t.options.length && !t.error && <p className="st dim">No repo in this project can be used.</p>}
      <p className="st dim">Repos that name private work aren't offered.</p>
      <button type="button" className="btn" disabled={busy || !on.size} onClick={() => void save()}>{busy ? "Checking…" : "Use these"}</button>
    </div>
  );
}

/** One row of the Start box's list. A click chooses it; ✕ dismisses it, with an optional reason. */
function Row({ s, i, on, onPick, onDismissed }: { s: Suggestion; i: number; on: boolean; onPick: () => void; onDismissed: () => void }) {
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const dismiss = async () => {
    const r = await post("/api/suggestions/dismiss", { key: s.key, reason });
    toast(r.error ? `Couldn't dismiss: ${r.error}` : `Dismissed ${s.key}`);
    if (!r.error) onDismissed();
  };
  return (
    <div className={`sug ${on ? "on" : ""}`} data-i={i} onClick={onPick} role="option" aria-selected={on}>
      <div className="sug-main">
        <b>{s.source === "architecture" ? s.repo : s.key}</b>
        <span className={`sug-src s-${s.source}`}>{SOURCE[s.source]}</span>
        {s.assignee === "me" && <span className="sug-src">yours</span>}
        <span className="t">{s.summary}</span>
        {s.url && <a className="sug-open" href={s.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} title="Open the issue">↗</a>}
        {!asking && <button type="button" className="sug-x" title="Dismiss" onClick={(e) => { e.stopPropagation(); setAsking(true); }}>✕</button>}
      </div>
      {s.verdict && <div className={`sug-verdict v-${s.verdict}`}><b>{s.verdict}{s.of ? ` ${s.of}` : ""}</b> {s.reason}</div>}
      {asking && (
        <div className="sug-act" onClick={(e) => e.stopPropagation()}>
          <input className="field" autoFocus placeholder="Why (optional)" value={reason} onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void dismiss(); } if (e.key === "Escape") { e.stopPropagation(); setAsking(false); } }} />
          <button type="button" className="btn" onClick={() => void dismiss()}>Dismiss</button>
          <button type="button" className="btn" onClick={() => setAsking(false)}>Cancel</button>
        </div>
      )}
    </div>
  );
}

/** The Start box's list of every Suggestion, in rank order. It renders more rows as you scroll to its end. */
export function SuggestionList({ view, reload, pick, onPick, listRef }: {
  view: SuggestionsView; reload: () => void; pick: number; onPick: (i: number) => void; listRef: React.RefObject<HTMLDivElement>;
}) {
  const [shown, setShown] = useState(CHUNK);
  const [judging, setJudging] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const total = view.suggestions.length;
  useEffect(() => { if (pick >= shown) setShown(pick + CHUNK); }, [pick, shown]);
  useEffect(() => {
    const el = end.current;
    if (!el || shown >= total) return;
    const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) setShown((n) => n + CHUNK); }, { root: listRef.current, rootMargin: "120px" });
    io.observe(el);
    return () => io.disconnect();
  }, [shown, total, listRef]);
  const judge = async () => {
    setJudging(true);
    const r = await post("/api/suggestions/judge", {});
    setJudging(false);
    toast(r.error ? `Couldn't judge links: ${r.error}` : `Judged ${r.judged ?? 0} suggestions`);
    reload();
  };
  return (
    <div className="sug-box">
      <div className="sug-bar">
        <span className="st"><b>Suggested</b> {total}</span>
        <span className="st dim">links judged {ago(view.judgedAt)}</span>
        <button type="button" className="btn" disabled={judging} onClick={() => void judge()}>{judging ? "Judging…" : "Judge links"}</button>
        {view.error && <span className="tidy-err">{view.error}</span>}
      </div>
      <div className="sug-list" ref={listRef} role="listbox">
        {view.suggestions.slice(0, shown).map((s, i) => <Row key={s.key} s={s} i={i} on={i === pick} onPick={() => onPick(i)} onDismissed={reload} />)}
        {shown < total && <div ref={end} className="st dim sug-more">Loading more…</div>}
        {!total && view.tracker && <div className="empty">Nothing to suggest.</div>}
        {!total && !view.tracker && <TrackerSetup onDone={reload} />}
      </div>
    </div>
  );
}
