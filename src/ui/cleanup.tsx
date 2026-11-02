// Cleanup: every worktree work left behind, and verification runs that no work item shows.
import { useEffect, useState } from "react";
import { post, toast } from "./actions";

type W = { repo: string; path: string; name: string; branch: string | null; safe: boolean; why: string; lastAt: string };
type Run = { id: string; key: string | null; state: string; startedAt: string; files: string[] };

export function Cleanup({ onClose }: { onClose: () => void }) {
  const [list, setList] = useState<W[] | null>(null);
  const [runs, setRuns] = useState<Run[]>([]);
  const [emails, setEmails] = useState<{ logger: string; message: string; count: number; runs: string[] }[]>([]);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showKept, setShowKept] = useState(false);
  const load = () => {
    void fetch("/api/cleanup").then((x) => x.json()).then((r) => { setList(r.worktrees ?? []); setEmails(r.logEmails ?? []); }).catch(() => setList([]));
    void fetch("/api/verify").then((x) => x.json()).then((r) => setRuns((r.runs ?? []).filter((v: Run) => !v.key))).catch(() => {});
  };
  useEffect(load, []);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", k, true);
    return () => document.removeEventListener("keydown", k, true);
  }, [onClose]);
  const safe = list?.filter((w) => w.safe) ?? [], kept = list?.filter((w) => !w.safe) ?? [];
  const byRepo = (xs: W[]) => [...new Set(xs.map((w) => w.repo))].map((r) => `${xs.filter((w) => w.repo === r).length} in ${r}`).join(", ");
  const remove = async () => {
    setBusy(true);
    const r = await post("/api/cleanup/worktrees", { paths: safe.map((w) => w.path) });
    setBusy(false); setSure(false);
    toast(r.error ? `Cleanup failed: ${r.error}` : `Removed ${r.removed}${r.kept?.length ? `, kept ${r.kept.length}` : ""}`);
    setList(null); load();
  };
  return (
    <div className="cleanup">
      <div className="vv-head"><b className="vt">Cleanup</b><span className="st dim">The control room removes dead verification worktrees and empty chart folders by itself, each hour. Evidence stays.</span>
        <div className="row-acts"><button className="btn" onClick={onClose}>Close <kbd>esc</kbd></button></div></div>
      <div className="vfy-body">
        {!list && <div className="empty">Reading every worktree…</div>}
        {list && <div className="vfy-check">
          <div className="vfy-check-h"><b>{safe.length} worktrees safe to remove</b><span className="st dim">{byRepo(safe)}</span>
            <div className="row-acts" style={{ marginLeft: "auto" }}>{safe.length > 0 && (sure
              ? <><button className="btn sm" onClick={() => setSure(false)}>Cancel</button><button className="btn sm primary" disabled={busy} onClick={remove}>{busy ? "Removing…" : `Remove ${safe.length} worktrees`}</button></>
              : <button className="btn sm" onClick={() => setSure(true)}>Remove all safe</button>)}</div></div>
          <div className="st dim">Safe means no process in it, no uncommitted files, every commit on a remote, and quiet for a day. Each is checked again at removal.</div>
          <div className="cl-list">{safe.map((w) => <div key={w.path}><span>{w.repo}</span> {w.name}</div>)}</div>
        </div>}
        {list && kept.length > 0 && <div className="vfy-check">
          <div className="vfy-check-h"><b>{kept.length} worktrees kept</b><span className="st dim">{byRepo(kept)}</span><button className="btn sm" style={{ marginLeft: "auto" }} onClick={() => setShowKept((x) => !x)}>{showKept ? "Hide" : "Show why"}</button></div>
          {showKept && <div className="cl-list">{kept.map((w) => <div key={w.path}><span>{w.repo}</span> {w.name} <em>{w.why}</em></div>)}</div>}
        </div>}
        {list && <div className="vfy-check"><b>Emails in app logs: {emails.length ? `${emails.length} to clean up` : "none seen"}</b>
          <div className="st dim">Each verification run scans its server log. Addresses are masked here. The fix is in the app's logging.</div>
          {emails.map((e) => <div key={e.logger + e.message} className="st">{e.count}× in {e.runs.length} run{e.runs.length > 1 ? "s" : ""} · {e.logger}: {e.message}</div>)}</div>}
        {runs.length > 0 && <div className="vfy-check"><b>Verification runs with no work item</b>
          {runs.map((r) => <div key={r.id} className="vfy-check-h"><span>{r.id}</span><span className="st dim">{r.state}</span>
            <button className="btn sm" style={{ marginLeft: "auto" }} disabled={r.state === "running" || r.state === "starting"} onClick={async () => { const x = await post("/api/verify/delete", { id: r.id }); toast(x.error ?? "Deleted"); load(); }}>Delete</button></div>)}
        </div>}
      </div>
    </div>
  );
}
