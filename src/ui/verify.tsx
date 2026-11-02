// Local verification on a work item: the runs of its commits, the checks with their evidence, the user's
// verdicts, and every log. The agent reports. Only a verdict here makes a check count as passed.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { WorkItem } from "../shared/types";
import { post, toast } from "./actions";
import { LiveConsole } from "./console";

type Check = { id: string; title: string; source?: string; criterion?: string; surface?: string; status: string; note?: string; evidence?: string[] };
type Run = { id: string; key: string | null; pr: string | null; repo: string; commit: string; state: string; step: string | null; error: string | null; url: string | null; agent: string | null; startedAt: string;
  login: { user: string; password: string } | null; logins?: { label: string; user: string; password: string }[]; checks: Check[]; confirms: Record<string, { verdict: string; note?: string }>; files: string[]; logEmails?: { logger: string; message: string; count: number }[]; session: { pane: string; status: string } | null; stages: { name: string; state: string }[]; filesSince?: number | null };

const fileUrl = (id: string, f: string) => `/api/verify/file?id=${encodeURIComponent(id)}&f=${encodeURIComponent(f)}`;
const isImg = (f: string) => /\.(png|jpe?g|gif)$/i.test(f), isVideo = (f: string) => /\.(webm|mp4)$/i.test(f);

/** One line on the detail: the latest round and its result. Each round is inside it. */
export function VerifyStrip({ it }: { it: WorkItem }) {
  const pr = it.prs.find((p) => p.role === "mine") ?? it.prs[0];
  const [runs, setRuns] = useState<Run[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = () => void fetch(`/api/verify?key=${encodeURIComponent(it.key)}${pr ? `&head=${pr.head}&base=${encodeURIComponent(pr.base)}` : ""}`).then((x) => x.json()).then((r) => setRuns(r.runs ?? [])).catch(() => {});
  useEffect(load, [it.key, pr?.head]);
  const live = runs.some((r) => r.state === "starting" || (r.state === "running" && r.session?.status === "working"));
  useEffect(() => { if (!live) return; const t = setInterval(load, 5000); return () => clearInterval(t); }, [it.key, live, pr?.head]);
  const start = async () => {
    if (!pr) return;
    setBusy(true);
    const r = await post("/api/verify/start", { repo: pr.repo, ref: pr.head, key: it.key, pr: `${pr.repo}#${pr.number}`, item: it.id, agent: true });
    setBusy(false);
    toast(r.error ? `Couldn't start the round: ${r.error}` : r.dryRun ? `Dev: recorded, nothing started (${r.id})` : r.already ? "That commit already has a live round" : `Testing ${String(pr.head).slice(0, 7)}`);
    load();
  };
  if (!pr && !runs.length) return null;
  const latest = runs[0];
  const stale = latest && pr && latest.filesSince !== 0;
  return (
    <div className="loops"><div className="loopline">
      <span className="st">VERIFY</span>
      <span className="txt" title={latest ? `${runs.length} round${runs.length > 1 ? "s" : ""}. Latest: ${latest.commit.slice(0, 7)}` : "Not tested in a browser yet"}>
        {latest ? <>{label(latest)}{stale ? ` · ${latest.filesSince === null ? "PR has newer commits" : `PR changed ${latest.filesSince} file${latest.filesSince === 1 ? "" : "s"} since`}` : ""}{runs.length > 1 ? ` · ${runs.length} rounds` : ""}</> : "Not tested yet"}
      </span>
      <span className="lb">
        {latest && <button className="btn sm on-strip" onClick={() => setOpen(true)}>Open</button>}
        {pr && (!latest || stale) && <button className="btn sm on-strip" disabled={busy || live} onClick={start}>{busy ? "Starting…" : latest ? "Test again" : "Test"}</button>}
      </span>
    </div>
    {open && <RunView runs={runs} item={it.id} onClose={() => { setOpen(false); load(); }} />}
    </div>
  );
}

function label(r: Run) {
  if (r.state === "failed") return "Setup failed";
  if (r.state === "starting") return `Starting: ${r.step ?? ""}`;
  if (!r.checks.length) return r.session?.status === "working" ? "Agent testing" : "No checks";
  const ok = r.checks.filter((c) => r.confirms[c.id]?.verdict === "confirmed").length;
  const bad = r.checks.filter((c) => r.confirms[c.id]?.verdict === "rejected" || (c.status === "fail" && r.confirms[c.id]?.verdict !== "confirmed")).length;
  return `${ok}/${r.checks.length} confirmed${bad ? `, ${bad} failing` : ""}`;
}

/** Fails and rejections first, then what still needs a verdict, then confirmed. */
const rank = (c: Check, r: Run) => { const v = r.confirms[c.id]?.verdict; return v === "rejected" || (c.status === "fail" && v !== "confirmed") ? 0 : !v ? 1 : 2; };

/** The ticket's acceptance criteria come first, in their order, then the other checks. Inside each, fails first. */
export function orderChecks(checks: Check[], r: Run): Check[] {
  const crit = (c: Check) => c.criterion ?? "\uffff";
  return [...checks].sort((a, b) => crit(a).localeCompare(crit(b), undefined, { numeric: true }) || rank(a, r) - rank(b, r));
}

type Slide = { check: Check; file: string };

/** Every image of a round, in the order of its checks: fails first. */
export function slidesOf(checks: Check[]): Slide[] {
  const seen = new Set<string>();
  return checks.flatMap((c) => (c.evidence ?? []).filter((f) => isImg(f)).map((file) => ({ check: c, file }))).filter((s) => { const k = `${s.check.id}/${s.file}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** What a slide says about its check, with the verdict buttons. */
function SlideCaption({ s, at, total, verdict, onVerdict }: { s: Slide; at: number; total: number; verdict?: string; onVerdict: (c: Check, v: "confirmed" | "rejected" | null) => void }) {
  return <div className="deck-cap">
    <div className="vfy-check-h">
      <span className="st dim">{at + 1} of {total}</span><span className={`vfy-status ${s.check.status}`}>{s.check.status.replace("-", " ")}</span><b>{s.check.title}</b>{s.check.surface && <span className="st dim">{s.check.surface}</span>}
      <div className="row-acts" style={{ marginLeft: "auto" }}>
        <button className={`btn sm ${verdict === "confirmed" ? "primary" : ""}`} onClick={() => onVerdict(s.check, verdict === "confirmed" ? null : "confirmed")}>{verdict === "confirmed" ? "✓ Confirmed" : "Confirm"}</button>
        <button className={`btn sm ${verdict === "rejected" ? "primary" : ""}`} onClick={() => onVerdict(s.check, verdict === "rejected" ? null : "rejected")}>{verdict === "rejected" ? "✗ Rejected" : "Reject"}</button>
      </div>
    </div>
    {s.check.note && <div className="deck-note">{s.check.note}</div>}
  </div>;
}

/** A log of the run, following its end. */
function LogTail({ id, files }: { id: string; files: string[] }) {
  const logs = files.filter((f) => f.endsWith(".log"));
  const [f, setF] = useState("server.log");
  const [text, setText] = useState("");
  const box = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const go = () => void fetch(`/api/verify/tail?id=${encodeURIComponent(id)}&f=${encodeURIComponent(f)}`).then((x) => x.json()).then((r) => setText(r.text ?? "")).catch(() => {});
    go(); const t = setInterval(go, 3000); return () => clearInterval(t);
  }, [id, f]);
  useEffect(() => { const b = box.current; if (b) b.scrollTop = b.scrollHeight; }, [text]);
  return <div className="vfy-log">
    <div className="seg">{logs.map((n) => <button key={n} className={n === f ? "on" : ""} onClick={() => setF(n)}>{n}</button>)}</div>
    <pre ref={box}>{text || "Nothing yet."}</pre>
  </div>;
}

/** Every round of a work item in one view, newest first. */
function RunView({ runs, item, onClose }: { runs: Run[]; item: string; onClose: () => void }) {
  const [id, setId] = useState(runs[0].id);
  const stale = (x: Run) => x.filesSince != null && x.filesSince > 0;
  const [r, setR] = useState<Run | null>(null);
  const load = () => void fetch(`/api/verify/one?id=${encodeURIComponent(id)}`).then((x) => x.json()).then((v) => !v.error && setR(v));
  useEffect(() => { load(); const t = setInterval(load, 2000); return () => clearInterval(t); }, [id]);
  const [at, setAt] = useState(0);
  const [big, setBig] = useState(false);
  useEffect(() => { setAt(0); setBig(false); }, [id]);
  const sorted = r ? orderChecks(r.checks, r) : [];
  // The order holds still while the deck is open: a verdict must not move the slide under the user's eye.
  const order = useRef<{ id: string; ids: string[] }>({ id: "", ids: [] });
  if (r && (order.current.id !== id || order.current.ids.length !== sorted.length)) order.current = { id, ids: sorted.map((c) => c.id) };
  const slides = slidesOf(order.current.ids.flatMap((k) => r?.checks.filter((c) => c.id === k) ?? []));
  const slide = slides[Math.min(at, Math.max(0, slides.length - 1))];
  const move = (d: number) => setAt((i) => Math.max(0, Math.min(slides.length - 1, i + d)));
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest?.("input, textarea, select, [data-keys]")) return;
      if (e.key === "ArrowRight") { e.preventDefault(); move(1); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); move(-1); }
      else if (e.key === "Escape") { e.stopPropagation(); if (big) setBig(false); else onClose(); }
    };
    document.addEventListener("keydown", k, true);
    return () => document.removeEventListener("keydown", k, true);
  }, [big, slides.length, onClose]);
  const noPicture = r ? r.checks.filter((c) => !(c.evidence ?? []).some((f) => isImg(f))) : [];
  const confirmAll = async () => { const x = await post("/api/verify/confirm-passing", { id, item }); toast(`Confirmed ${x.confirmed} passing`); load(); };
  const canConfirm = !!r && r.checks.some((c) => c.status === "pass" && !r.confirms[c.id]);
  const verdict = async (c: Check, v: "confirmed" | "rejected" | null) => { await post("/api/verify/confirm", { id, check: c.id, verdict: v, item }); load(); };
  const used = new Set(r?.checks.flatMap((c) => c.evidence ?? []) ?? []);
  return createPortal(
    <div className="vfy-run" role="dialog" aria-label="Verification run">
      <div className="vv-head">
        <b className="vt">{r ? `${r.key ?? r.repo} verification` : "Loading…"}</b>
        <div className="seg">{runs.map((x, i) => <button key={x.id} className={x.id === id ? "on" : ""} title={`${x.commit.slice(0, 7)} · ${new Date(x.startedAt).toLocaleString()} · ${label(x)}`} onClick={() => setId(x.id)}>Round {runs.length - i}</button>)}</div>
        {r && <span className="st dim">{r.commit.slice(0, 7)} · {r.state}{r.step ? ` · ${r.step}` : ""}{stale(runs.find((x) => x.id === id)!) ? " · the PR changed since this round" : ""}{r.agent ? ` · ${r.agent}` : ""}</span>}
        <div className="row-acts">
          {r?.files.includes("transcript.txt") && <a className="btn" href={fileUrl(id, "transcript.txt")} target="_blank" rel="noreferrer">Transcript</a>}
          {r?.url && r.state === "running" && <a className="btn" href={r.url} target="_blank" rel="noreferrer">Open app</a>}
          {r?.state === "running" && <button className="btn" onClick={async () => { await post("/api/verify/stop", { id, item }); load(); }}>Stop</button>}
          <button className="btn" onClick={onClose}>Close <kbd>esc</kbd></button>
        </div>
      </div>
      {r && <div className="vfy-stages">{r.stages.map((s) => <span key={s.name} className={`vfy-stage ${s.state}`}>{s.state === "done" ? "✓ " : s.state === "failed" ? "✗ " : ""}{s.name}{s.state === "now" && s.name === "Set up" && r.step ? `: ${r.step}` : ""}</span>)}
        {r.checks.length > 0 && <span className="st dim">{r.checks.filter((c) => c.status !== "pending" && c.status !== "testing").length} of {r.checks.length} checks reported</span>}</div>}
      {r && <div className="vfy-split">
      {(r.session || r.state === "starting") && <div className="vfy-live">
        {r.session ? <LiveConsole pane={r.session.pane} status={r.session.status as never} name={r.agent ?? "agent"} item={item} /> : <div className="empty">The agent starts when the app is up.</div>}
        <LogTail id={id} files={r.files} />
      </div>}
      <div className="vfy-body">
        {r.error && <div className="vfy-check"><b>Setup failed:</b> {r.error}</div>}
        {r.state === "running" && (r.logins?.length ? r.logins.map((l) => <div key={l.user} className="st">{l.label}: {l.user} / {l.password} (seeded test account)</div>) : r.login && <div className="st">Login: {r.login.user} / {r.login.password} (seeded test account)</div>)}
        {r.logEmails && r.logEmails.length > 0 && <div className="vfy-check"><b>This run's server log holds email addresses</b><span className="st dim">The app should not log them. Tracked under Cleanup.</span>{r.logEmails.map((e) => <div key={e.logger + e.message} className="st">{e.count}× {e.logger}: {e.message}</div>)}</div>}
        {slide && <div className="deck">
          <div className="deck-stage">
            <button className="btn deck-nav" disabled={at <= 0} onClick={() => move(-1)} aria-label="Previous">←</button>
            <button className="deck-img" onClick={() => setBig(true)} title="Open large"><img src={fileUrl(id, slide.file)} alt={slide.check.title} /></button>
            <button className="btn deck-nav" disabled={at >= slides.length - 1} onClick={() => move(1)} aria-label="Next">→</button>
          </div>
          <SlideCaption s={slide} at={at} total={slides.length} verdict={r.confirms[slide.check.id]?.verdict} onVerdict={verdict} />
          <div className="vfy-check-h deck-foot">
            {noPicture.length > 0 && <span className="st dim" title={noPicture.map((c) => c.title).join("\n")}>{noPicture.length} check{noPicture.length > 1 ? "s have" : " has"} no picture: see below</span>}
            {canConfirm && <button className="btn primary" style={{ marginLeft: "auto" }} title="Confirms each check the agent passed. Fails and untested items stay for you." onClick={confirmAll}>Confirm all passing</button>}
          </div>
        </div>}
        {!slide && canConfirm && <div><button className="btn" onClick={confirmAll}>Confirm all passing</button></div>}
        {sorted.map((c) => {
          const v = r.confirms[c.id]?.verdict;
          return <div className="vfy-check" key={c.id}>
            <div className="vfy-check-h">
              <span className={`vfy-status ${c.status}`}>{c.status.replace("-", " ")}</span><b>{c.title}</b>{c.source && <span className="st dim">{c.source}</span>}
              <div className="row-acts" style={{ marginLeft: "auto" }}>
                <button className={`btn sm ${v === "confirmed" ? "primary" : ""}`} onClick={() => verdict(c, v === "confirmed" ? null : "confirmed")}>{v === "confirmed" ? "✓ Confirmed" : "Confirm"}</button>
                <button className={`btn sm ${v === "rejected" ? "primary" : ""}`} onClick={() => verdict(c, v === "rejected" ? null : "rejected")}>{v === "rejected" ? "✗ Rejected" : "Reject"}</button>
              </div>
            </div>
            {c.note && <div>{c.note}</div>}
            <div className="vfy-shots">{(c.evidence ?? []).map((f) => isImg(f) ? <button key={f} className="deck-thumb" onClick={() => { setAt(Math.max(0, slides.findIndex((s) => s.check.id === c.id && s.file === f))); setBig(true); }}><img src={fileUrl(id, f)} alt={f} loading="lazy" /></button> : isVideo(f) ? <video key={f} src={fileUrl(id, f)} controls width={480} /> : <a key={f} href={fileUrl(id, f)} target="_blank" rel="noreferrer">{f}</a>)}</div>
          </div>;
        })}
        {!r.checks.length && r.state !== "failed" && <div className="empty">No checks reported yet.</div>}
        <div className="vfy-check"><b>Everything in this run</b><div className="vfy-files">{r.files.filter((f) => !used.has(f)).map((f) => <a key={f} className="btn sm" href={fileUrl(id, f)} target="_blank" rel="noreferrer">{f}</a>)}</div></div>
      </div></div>}
      {big && r && slide && <div className="deck-modal" role="dialog" aria-label="Evidence" onClick={(e) => { if (e.target === e.currentTarget) setBig(false); }}>
        <div className="deck-modal-top"><SlideCaption s={slide} at={at} total={slides.length} verdict={r.confirms[slide.check.id]?.verdict} onVerdict={verdict} /><button className="btn" onClick={() => setBig(false)}>Close <kbd>esc</kbd></button></div>
        <div className="deck-modal-img">
          <button className="btn deck-nav" disabled={at <= 0} onClick={() => move(-1)} aria-label="Previous">←</button>
          <img src={fileUrl(id, slide.file)} alt={slide.check.title} />
          <button className="btn deck-nav" disabled={at >= slides.length - 1} onClick={() => move(1)} aria-label="Next">→</button>
        </div>
      </div>}
    </div>,
    document.body,
  );
}
