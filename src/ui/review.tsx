import { useEffect, useState } from "react";
import type { ReviewDrafts, WorkItem } from "../shared/types";
import { Confirm, post, toast } from "./actions";

type Loaded = { drafts: ReviewDrafts | null; head?: string; pushedSince?: boolean; outside?: number[] };
type Event = "COMMENT" | "APPROVE" | "REQUEST_CHANGES";
const EVENTS: [Event, string][] = [["COMMENT", "Comment"], ["APPROVE", "Approve"], ["REQUEST_CHANGES", "Request changes"]];

/** A review agent's drafted comments: pick, edit, post as one review (Action flows). */
export function Curate({ it }: { it: WorkItem }) {
  const p = it.prs[0];
  const [data, setData] = useState<Loaded | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const [bodies, setBodies] = useState<Record<number, string>>({});
  const [editing, setEditing] = useState<number | null>(null);
  const [event, setEvent] = useState<Event>("COMMENT");
  const [sheet, setSheet] = useState(false);

  const load = async (fresh: boolean) => {
    const r = (await fetch(`/api/review?item=${encodeURIComponent(it.id)}`).then((x) => x.json()).catch(() => null)) as Loaded | null;
    if (!r) return;
    setData((old) => {
      // New drafts (a new commit or a rewrite) reset the picks; otherwise keep the user's edits.
      if (fresh || JSON.stringify(old?.drafts?.findings) !== JSON.stringify(r.drafts?.findings)) {
        setPicked(new Set((r.drafts?.findings ?? []).filter((f) => !r.outside?.includes(f.id)).map((f) => f.id)));
        setBodies(Object.fromEntries((r.drafts?.findings ?? []).map((f) => [f.id, f.body])));
      }
      return r;
    });
  };
  useEffect(() => { void load(true); }, [it.id]);
  useEffect(() => { const t = setInterval(() => void load(false), 10_000); return () => clearInterval(t); }, [it.id]);

  const d = data?.drafts;
  const working = it.agents.some((a) => a.status === "working");
  if (!data) return null;
  if (!d) return <p className="st dim">{working ? "The review agent is working; its drafts appear here." : "No drafted comments yet. A review agent starts on its own, a couple at a time, and writes them here with a field guide."}</p>;
  if (d.error) return <div className="tidy-err">{d.error}</div>;
  if (d.posted) return <p>Posted {d.posted.count} comment{d.posted.count === 1 ? "" : "s"} ({d.posted.event.toLowerCase().replace("_", " ")}) · <a href={d.posted.url} target="_blank" rel="noreferrer">view</a></p>;

  const chosen = d.findings.filter((f) => picked.has(f.id));
  const toggle = (id: number) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const recheck = async () => { const r = await post("/api/review/recheck", { item: it.id }); toast(r.error ? `Couldn't: ${r.error}` : r.result); };
  const send = async () => {
    const r = await post("/api/review/post", { item: it.id, event, picked: chosen.map((f) => ({ id: f.id, path: f.path, line: f.line, start_line: f.start_line, body: bodies[f.id] ?? f.body })) });
    toast(r.error ? `Couldn't post: ${r.error}` : `Posted ${chosen.length} comment${chosen.length === 1 ? "" : "s"}`);
    if (!r.error) void load(true);
  };

  return (
    <div className="curate" id="drafts">
      {data.pushedSince && (
        <div className="banner">
          {p.author} pushed since this review (drafts are on {d.sha.slice(0, 7)}). Posted comments attach to that commit.
          <button className="btn sm" onClick={recheck}>Ask agent to re-check</button>
        </div>
      )}
      <div className="curate-head">
        <b>{d.findings.length} drafted · {chosen.length} picked</b>
        <div className="seg">{EVENTS.map(([k, l]) => <button key={k} className={event === k ? "on" : ""} onClick={() => setEvent(k)}>{l}</button>)}</div>
        <button className="btn sm primary" disabled={!chosen.length && event === "COMMENT"} onClick={() => setSheet(true)}>Post <span className="pings">PINGS</span></button>
      </div>
      {d.findings.map((f) => {
        const off = data.outside?.includes(f.id);
        return (
          <div key={f.id} className={`finding ${picked.has(f.id) ? "on" : ""} ${off ? "off" : ""}`}>
            <input type="checkbox" checked={picked.has(f.id)} disabled={off} onChange={() => toggle(f.id)} />
            <div>
              <div className="fh"><span className={`rank ${f.rank}`}>{f.rank}</span> <b>{f.title}</b> <span className="st dim">{f.path}:{f.start_line ? `${f.start_line}-` : ""}{f.line}{off ? " · not in the diff, can't post inline" : ""}</span></div>
              {editing === f.id ? (
                <textarea autoFocus rows={5} value={bodies[f.id] ?? f.body} onChange={(e) => setBodies({ ...bodies, [f.id]: e.target.value })} onBlur={() => setEditing(null)} />
              ) : (
                <p onClick={() => setEditing(f.id)} title="Click to edit">{bodies[f.id] ?? f.body}{bodies[f.id] !== undefined && bodies[f.id] !== f.body && <span className="st dim"> (edited)</span>}</p>
              )}
            </div>
          </div>
        );
      })}
      {sheet && (
        <Confirm title={`Post a review on #${p.number}`} label="Post review" onClose={() => setSheet(false)} go={send}
          who={`Notifies ${p.author}. ${EVENTS.find(([k]) => k === event)![1]} with ${chosen.length} inline comment${chosen.length === 1 ? "" : "s"}, no summary.`}>
          <ul className="sheet-list replies">
            {chosen.map((f) => <li key={f.id}><b>{f.path}:{f.line}</b> · {f.rank}<pre>{bodies[f.id] ?? f.body}</pre></li>)}
          </ul>
        </Confirm>
      )}
    </div>
  );
}
