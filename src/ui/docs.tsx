// The Docs page: the glossary, the ADRs and the statecharts, with a review toggle on each term and ADR.
import { Fragment, useEffect, useState, type ReactNode } from "react";
import type { DocReview, DocsView, DocVerdict } from "../shared/types";
import { post, toast } from "./actions";
import { VisualGrid } from "./visuals";

const CHANGED = "cr-docs";

/** How many terms and ADRs need review: never reviewed, or changed since the review. */
export function useDocsCount(): number {
  const [n, setN] = useState(0);
  useEffect(() => {
    const load = () => void fetch("/api/docs").then((x) => x.json()).then((d: DocsView) =>
      setN([...(d.terms ?? []), ...(d.adrs ?? [])].filter((x) => x.review.needsReview).length)).catch(() => {});
    load();
    window.addEventListener(CHANGED, load);
    return () => window.removeEventListener(CHANGED, load);
  }, []);
  return n;
}

// A small markdown renderer that builds React elements. It never sets raw HTML.
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\[[^\]]+\]\([^)\s]+\))|(\*[^*\s][^*]*\*)|(_[^_\s][^_]*_)/g;
  let last = 0, m: RegExpExecArray | null, k = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    if (m[1]) out.push(<code key={k++}>{t.slice(1, -1)}</code>);
    else if (m[2]) out.push(<b key={k++}>{inline(t.slice(2, -2))}</b>);
    else if (m[3]) {
      const [, label, href] = t.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/)!;
      out.push(/^https?:\/\//.test(href) ? <a key={k++} href={href} target="_blank" rel="noreferrer">{label}</a> : <Fragment key={k++}>{label}</Fragment>);
    } else out.push(<em key={k++}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split("\n");
  let i = 0, k = 0;
  while (i < lines.length) {
    const line = lines[i];
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (!line.trim()) { i++; continue; }
    if (h) { const H = `h${Math.min(6, h[1].length + 2)}` as "h3"; blocks.push(<H key={k++}>{inline(h[2])}</H>); i++; continue; }
    if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
      const ordered = /^\s*\d+\.\s+/.test(line);
      const items: string[] = [];
      while (i < lines.length && (/^\s*[-*]\s+/.test(lines[i]) || /^\s*\d+\.\s+/.test(lines[i]))) { items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, "")); i++; }
      const L = ordered ? "ol" : "ul";
      blocks.push(<L key={k++} start={ordered ? Number(line.match(/\d+/)![0]) : undefined}>{items.map((t, j) => <li key={j}>{inline(t)}</li>)}</L>);
      continue;
    }
    if (line.startsWith("```")) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) code.push(lines[i++]);
      i++;
      blocks.push(<pre key={k++}><code>{code.join("\n")}</code></pre>);
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,4}\s|\s*[-*]\s|\s*\d+\.\s|```)/.test(lines[i])) para.push(lines[i++]);
    blocks.push(<p key={k++}>{inline(para.join(" "))}</p>);
  }
  return <div className="md">{blocks}</div>;
}

function ReviewBox({ id, review, onSaved }: { id: string; review: DocReview; onSaved: () => void }) {
  const [comment, setComment] = useState(review.comment);
  const [busy, setBusy] = useState(false);
  useEffect(() => setComment(review.comment), [review.comment]);
  const save = async (verdict: DocVerdict) => {
    setBusy(true);
    const r = await post("/api/docs/review", { id, verdict, comment });
    setBusy(false);
    if (r.error) toast(r.error); else { onSaved(); window.dispatchEvent(new Event(CHANGED)); }
  };
  const state = review.needsReview ? (review.stale ? "Changed: needs review" : "Needs review") : review.verdict === "reviewed" ? "Reviewed" : "Needs change";
  return (
    <div className="doc-review">
      <span className={`doc-state ${review.needsReview ? "due" : review.verdict ?? ""}`}>{state}</span>
      <div className="seg">
        <button className={!review.needsReview && review.verdict === "reviewed" ? "on" : ""} disabled={busy} onClick={() => void save("reviewed")}>Reviewed</button>
        <button className={!review.needsReview && review.verdict === "needs-change" ? "on" : ""} disabled={busy} onClick={() => void save("needs-change")}>Needs change</button>
      </div>
      <textarea placeholder="Comment" value={comment} rows={2} onChange={(e) => setComment(e.target.value)}
        onBlur={() => { if (review.verdict && comment !== review.comment) void save(review.verdict); }} />
    </div>
  );
}

type Tab = "glossary" | "adrs" | "visuals";

export function Docs({ onClose }: { onClose: () => void }) {
  const [d, setD] = useState<DocsView | null>(null);
  const [tab, setTab] = useState<Tab>("glossary");
  const load = () => void fetch("/api/docs").then((x) => x.json()).then(setD);
  useEffect(load, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape" && !(e.target as HTMLElement).closest("textarea") && !document.querySelector(".vviewer, .scrim")) { e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  const due = (xs: { review: DocReview }[] | undefined) => (xs ?? []).filter((x) => x.review.needsReview).length;
  const tabs: [Tab, string, number][] = [["glossary", "Glossary", due(d?.terms)], ["adrs", "ADRs", due(d?.adrs)], ["visuals", "Visuals", 0]];
  return (
    <div className="tidy docs">
      <div className="tidy-head">
        <div><h2>Docs</h2><span className="st dim">{d ? `${due(d.terms) + due(d.adrs)} to review` : "Loading…"} · the glossary, decisions and statecharts in this repo</span></div>
        <div className="row-acts">
          <div className="seg">
            {tabs.map(([k, t, n]) => <button key={k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{t}{n ? ` ${n}` : ""}</button>)}
          </div>
          <button className="btn" onClick={onClose}>Done <kbd>esc</kbd></button>
        </div>
      </div>
      <div className="tidy-list docs-list">
        {tab === "glossary" && d?.terms.map((t) => (
          <section key={t.id} className="doc-card">
            <h3>{t.term}</h3>
            <Markdown text={t.text} />
            <ReviewBox id={t.id} review={t.review} onSaved={load} />
          </section>
        ))}
        {tab === "adrs" && d?.adrs.map((a) => (
          <section key={a.id} className="doc-card">
            <div className="doc-file">{a.file}</div>
            <Markdown text={a.text} />
            <ReviewBox id={a.id} review={a.review} onSaved={load} />
          </section>
        ))}
        {tab === "visuals" && <VisualGrid />}
      </div>
    </div>
  );
}
