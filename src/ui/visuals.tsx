// Visuals: a grid of chart cards, a full-screen viewer with pan and zoom, a strip of thumbnails for a
// work item, and the sheet that adds a "Flow change" section to a PR body.
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { VisualDetail, VisualMeta } from "../shared/types";
import { Confirm, post, toast } from "./actions";
import { Markdown } from "./docs";

const fileUrl = (id: string, f: string) => `/api/visuals/file?id=${encodeURIComponent(id)}&f=${encodeURIComponent(f)}`;
const thumbOf = (m: VisualMeta) => m.files.find((f) => f === "after.svg") ?? m.files.find((f) => f === "chart.svg") ?? m.files.find((f) => f.endsWith(".svg")) ?? null;
const prUrl = (pr: string) => { const [repo, n] = pr.split("#"); return `https://github.com/${repo}/pull/${n}`; };
const videoOf = (m: VisualMeta) => m.files.find((f) => /\.(mp4|webm)$/.test(f)) ?? null;
const KIND: Record<VisualMeta["kind"], string> = { video: "Video", flow: "Flow", chart: "Chart", architecture: "Architecture", change: "Change" };

/** The visuals list from the server. `key` keeps one work item's visuals. */
export function useVisuals(key?: string | null) {
  const [list, setList] = useState<VisualMeta[] | null>(null);
  const load = () => void fetch(`/api/visuals${key ? `?key=${encodeURIComponent(key)}` : ""}`).then((x) => x.json()).then((r) => setList(r.visuals ?? [])).catch(() => setList([]));
  useEffect(load, [key]);
  // A chart that just finished shows without a reload.
  useEffect(() => { window.addEventListener("visuals-changed", load); return () => window.removeEventListener("visuals-changed", load); }, [key]);
  return { list, reload: load };
}

function Mark({ hold }: { hold: boolean | null }) {
  return <span className={`vmark ${hold === null ? "none" : hold ? "ok" : "bad"}`} title={hold === null ? "No rules checked" : hold ? "All rules hold" : "A rule breaks"}>{hold === null ? "·" : hold ? "✓" : "✗"}</span>;
}

function Thumb({ m }: { m: VisualMeta }) {
  const t = thumbOf(m);
  return <div className="vthumb">{videoOf(m) ? <video src={`${fileUrl(m.id, videoOf(m)!)}#t=1`} preload="metadata" muted /> : t ? <img src={fileUrl(m.id, t)} alt="" loading="lazy" /> : <span className="st dim">{m.reason ?? "No chart"}</span>}</div>;
}

export function VisualCard({ m, onOpen }: { m: VisualMeta; onOpen: () => void }) {
  return (
    <button className="vcard" onClick={onOpen} title={m.title}>
      <Thumb m={m} />
      <div className="vcap"><Mark hold={m.rulesHold} /><span className="vt">{m.title}</span>{m.inPrAt && <span className="vinpr sm">In PR</span>}</div>
      <div className="vsub"><span>{KIND[m.kind]}</span>{m.key && <span>{m.key}</span>}{m.pr && <span>{m.pr.split("/").pop()}</span>}</div>
    </button>
  );
}

type Filter = "flows" | "items" | "changes";
const FILTERS: [Filter, string][] = [["flows", "Flows"], ["items", "Work items"], ["changes", "Changes"]];

/** The Docs page's Visuals tab: filters, a key box, the grid of cards and the viewer. */
export function VisualGrid() {
  const { list } = useVisuals();
  const [on, setOn] = useState<Set<Filter>>(new Set(["flows", "items", "changes"]));
  const [key, setKey] = useState("");
  const [open, setOpen] = useState<number | null>(null);
  const shown = (list ?? []).filter((m) => (m.kind === "flow" ? on.has("flows") : m.kind === "change" ? on.has("changes") : on.has("items")))
    .filter((m) => !key.trim() || (m.key ?? "").toLowerCase().includes(key.trim().toLowerCase()));
  const flip = (f: Filter) => setOn((s) => { const n = new Set(s); n.has(f) ? n.delete(f) : n.add(f); return n; });
  return (
    <div className="vgrid-wrap">
      <div className="vfilters">
        <div className="seg">{FILTERS.map(([f, t]) => <button key={f} className={on.has(f) ? "on" : ""} onClick={() => flip(f)}>{t}</button>)}</div>
        <input className="vkey" placeholder="Filter by key" value={key} onChange={(e) => setKey(e.target.value)} />
        <span className="st dim">{list ? `${shown.length} of ${list.length}` : "Loading…"}</span>
      </div>
      <div className="vgrid">{shown.map((m, i) => <VisualCard key={m.id} m={m} onOpen={() => setOpen(i)} />)}</div>
      {list && !shown.length && <div className="empty">No visuals match.</div>}
      {open !== null && shown[open] && <Viewer list={shown} at={open} onMove={setOpen} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** A work item's visuals as small thumbnails. A click opens the viewer. */
export function VisualStrip({ list }: { list: VisualMeta[] }) {
  const [open, setOpen] = useState<number | null>(null);
  if (!list.length) return null;
  return (
    <div className="vstrip">
      <span className="k">Visuals</span>
      {list.map((m, i) => (
        <button key={m.id} className="vmini" onClick={() => setOpen(i)} title={m.title}>
          {videoOf(m) ? <video src={`${fileUrl(m.id, videoOf(m)!)}#t=1`} preload="metadata" muted /> : thumbOf(m) ? <img src={fileUrl(m.id, thumbOf(m)!)} alt="" loading="lazy" /> : <span className="st dim">{m.title}</span>}
          <Mark hold={m.rulesHold} />
          {m.inPrAt && <span className="vinpr sm">In PR</span>}
        </button>
      ))}
      {open !== null && list[open] && <Viewer list={list} at={open} onMove={setOpen} onClose={() => setOpen(null)} />}
    </div>
  );
}

/** Pan and zoom: wheel or pinch to zoom, drag to pan, and buttons for + - and fit. */
function PanZoom({ src }: { src: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [t, setT] = useState({ x: 0, y: 0, s: 1 });
  const drag = useRef<{ x: number; y: number } | null>(null);
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<number | null>(null);
  const fit = () => setT({ x: 0, y: 0, s: 1 });
  useEffect(fit, [src]);
  const zoomAt = (f: number, cx: number, cy: number) => setT((o) => {
    const s = Math.min(12, Math.max(0.2, o.s * f));
    const k = s / o.s;
    return { s, x: cx - (cx - o.x) * k, y: cy - (cy - o.y) * k };
  });
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.002)), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);
  const center = () => { const r = box.current!.getBoundingClientRect(); return [r.width / 2, r.height / 2] as const; };
  return (
    <div className="vpz" ref={box}
      onPointerDown={(e) => { (e.target as HTMLElement).setPointerCapture(e.pointerId); pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY }); drag.current = { x: e.clientX, y: e.clientY }; }}
      onPointerMove={(e) => {
        if (!pts.current.has(e.pointerId)) return;
        pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pts.current.size === 2) {
          const [a, b] = [...pts.current.values()];
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (pinch.current) { const r = box.current!.getBoundingClientRect(); zoomAt(d / pinch.current, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top); }
          pinch.current = d;
          return;
        }
        if (!drag.current) return;
        const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y;
        drag.current = { x: e.clientX, y: e.clientY };
        setT((o) => ({ ...o, x: o.x + dx, y: o.y + dy }));
      }}
      onPointerUp={(e) => { pts.current.delete(e.pointerId); pinch.current = null; drag.current = pts.current.size ? drag.current : null; }}
      onPointerCancel={(e) => { pts.current.delete(e.pointerId); pinch.current = null; drag.current = null; }}>
      <img src={src} alt="" draggable={false} style={{ transform: `translate(${t.x}px, ${t.y}px) scale(${t.s})` }} />
      <div className="vzoom">
        <button className="btn sm" onClick={() => zoomAt(1.25, ...center())} title="Zoom in">+</button>
        <button className="btn sm" onClick={() => zoomAt(0.8, ...center())} title="Zoom out">−</button>
        <button className="btn sm" onClick={fit}>Fit</button>
      </div>
    </div>
  );
}

/** The full-screen viewer: the chart with pan and zoom, the report beside it, arrows to move, Esc to close. */
export function Viewer({ list, at, onMove, onClose }: { list: VisualMeta[]; at: number; onMove: (i: number) => void; onClose: () => void }) {
  const m = list[at];
  const [d, setD] = useState<VisualDetail | null>(null);
  const [side, setSide] = useState<"before" | "after">("after");
  const [sheet, setSheet] = useState(false);
  // Set when this viewer adds the chart, before the list reloads with the mark.
  const [addedId, setAddedId] = useState<string | null>(null);
  const inPr = !!m.inPrAt || addedId === m.id;
  useEffect(() => { setD(null); void fetch(`/api/visuals/one?id=${encodeURIComponent(m.id)}`).then((x) => x.json()).then((r) => !r.error && setD(r)); }, [m.id]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (sheet || (e.target as HTMLElement).closest?.("input, textarea")) return;
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
      else if (e.key === "ArrowRight" && at < list.length - 1) { e.stopPropagation(); onMove(at + 1); }
      else if (e.key === "ArrowLeft" && at > 0) { e.stopPropagation(); onMove(at - 1); }
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [at, list.length, onClose, onMove, sheet]);
  const pair = m.files.includes("before.svg") && m.files.includes("after.svg");
  const svg = pair ? `${side}.svg` : thumbOf(m);
  const text = d ? (d.text["diff.md"] ?? d.text["report.md"] ?? "") + (pair && d.text[`${side}-report.md`] ? `\n\n${d.text[`${side}-report.md`]}` : "") : "";
  // On the page itself: inside a work item's strip, it would take the strip's colors and clipping.
  return createPortal(
    <div className="vviewer" role="dialog" aria-label={m.title}>
      <div className="vv-head">
        <Mark hold={m.rulesHold} /><b className="vt">{m.title}</b>
        <span className="st dim">{KIND[m.kind]}{m.key ? ` · ${m.key}` : ""}{m.pr ? ` · ${m.pr}` : ""} · {at + 1} of {list.length}</span>
        <div className="row-acts">
          {pair && <div className="seg"><button className={side === "before" ? "on" : ""} onClick={() => setSide("before")}>Before</button><button className={side === "after" ? "on" : ""} onClick={() => setSide("after")}>After</button></div>}
          {pair && m.pr && inPr && <a className="vinpr" href={prUrl(m.pr)} target="_blank" rel="noreferrer" title={m.inPrAt ? `Added ${new Date(m.inPrAt).toLocaleString()}` : "Added just now"}>✓ In PR body</a>}
          {pair && m.pr && <button className="btn" onClick={() => setSheet(true)}>{inPr ? "Update PR body" : "Add to PR body"}</button>}
          <button className="btn" disabled={at === 0} onClick={() => onMove(at - 1)} title="Previous (left arrow)">←</button>
          <button className="btn" disabled={at >= list.length - 1} onClick={() => onMove(at + 1)} title="Next (right arrow)">→</button>
          <button className="btn" onClick={onClose}>Close <kbd>esc</kbd></button>
        </div>
      </div>
      <div className="vv-body">
        <div className="vv-chart">{videoOf(m) ? <video className="vv-video" key={m.id} src={fileUrl(m.id, videoOf(m)!)} controls autoPlay muted /> : svg ? <PanZoom src={fileUrl(m.id, svg)} /> : <div className="empty">{m.reason ?? "No chart."}</div>}</div>
        <div className="vv-report">{d ? <Markdown text={text || m.reason || "No report."} /> : <span className="st dim">Loading…</span>}</div>
      </div>
      {sheet && m.pr && <FlowChangeSheet id={m.id} pr={m.pr} onClose={() => setSheet(false)} onAdded={() => { setAddedId(m.id); window.dispatchEvent(new Event("visuals-changed")); }} />}
    </div>,
    document.body,
  );
}

/** The preview sheet for the PR body section: shows the section, and writes it only on Send. */
export function FlowChangeSheet({ id, pr, item, onClose, onAdded }: { id: string; pr: string; item?: string; onClose: () => void; onAdded?: () => void }) {
  const [pv, setPv] = useState<{ section: string; replaces: boolean; error?: string } | null>(null);
  useEffect(() => { void post("/api/visuals/flow-change", { id, pr }).then(setPv); }, [id, pr]);
  return (
    <Confirm title={`Flow change section on ${pr.split("/").pop()}`} label="Update PR body" onClose={onClose}
      who={pv?.error ? `Couldn't read the PR: ${pv.error}` : pv ? `Edits the PR body that reviewers see. ${pv.replaces ? "Replaces the section that is there." : "Appends the section."} The other text stays.` : "Reading the PR body…"}
      go={async () => {
        if (!pv || pv.error) return;
        const r = await post("/api/visuals/flow-change", { id, pr, item, send: true });
        toast(r.error ? `Couldn't update the PR body: ${r.error}` : `${pr.split("/").pop()}: ${r.result}`);
        if (!r.error && r.result !== "dry run") onAdded?.();
      }}>
      {pv && !pv.error && <pre className="vpreview">{pv.section}</pre>}
    </Confirm>
  );
}

type ChartRun = { state: "charting" | "stalled"; id: string; agent: string; pane: string | null; at: string };

/** "Chart this change": a background agent charts the PR's flow before and after. The button shows that chart's progress until the result arrives. */
export function ChartButton({ item, pr, keyName, merged }: { item: string; pr: string; keyName: string | null; merged: boolean }) {
  const [busy, setBusy] = useState(false);
  const [run, setRun] = useState<ChartRun | null>(null);
  const was = useRef<ChartRun | null>(null);
  const check = () => void fetch(`/api/visuals/charting?pr=${encodeURIComponent(pr)}`).then((x) => x.json()).then((r) => {
    const next: ChartRun | null = r.run ?? null;
    if (was.current && !next) { toast(`Chart of ${pr.split("/").pop()} is ready`); window.dispatchEvent(new Event("visuals-changed")); }
    was.current = next;
    setRun(next);
  }).catch(() => {});
  useEffect(check, [pr]);
  useEffect(() => { if (!run) return; const t = setInterval(check, 5000); return () => clearInterval(t); }, [pr, !!run]);
  const show = run?.pane ? <button className="btn sm" onClick={() => void post("/api/agent/focus", { pane: run.pane })}>Show agent</button> : null;
  const start = async () => {
    setBusy(true);
    const r = await post("/api/visuals/chart", { item, pr, key: keyName, merged });
    setBusy(false);
    toast(r.error ? `Couldn't start the chart: ${r.error}` : r.dryRun ? `Dev: recorded, no agent started (${r.id})` : `Charting ${pr.split("/").pop()}: ${r.name}`);
    check();
  };
  if (run?.state === "charting") return <><span className="chart-run" title={`${run.agent} is charting this PR`}><span className="chart-dot" />Charting…</span>{show}</>;
  return <>
    {run?.state === "stalled" && <span className="st warn" title={`${run.agent} stopped before it saved a chart`}>Chart didn't finish</span>}
    <button className="btn sm" disabled={busy} title="Start a background agent that charts this PR's flow before and after" onClick={start}>{busy ? "Starting…" : run ? "Chart again" : "Chart this change"}</button>
    {show}
  </>;
}
