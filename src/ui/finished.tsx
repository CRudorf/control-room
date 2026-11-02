// The Finished page: what finished, day by day. Each row names the work, how it ended and how long it took.
import { useEffect, useMemo, useState } from "react";
import type { FinishedItem } from "../shared/types";
import { dayLabel, duration, groupByDay } from "./finishedview";

const SPANS = [[7, "7 days"], [30, "30 days"], [90, "90 days"]] as const;

export function Finished({ onClose }: { onClose: () => void }) {
  const [days, setDays] = useState(30);
  const [q, setQ] = useState("");
  const [items, setItems] = useState<FinishedItem[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    setItems(null);
    fetch(`/api/finished?days=${days}`).then((x) => x.json()).then((r) => (r.items ? setItems(r.items) : setErr(r.error ?? "couldn't read finished work"))).catch(() => setErr("server unreachable"));
  }, [days]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const shown = useMemo(() => {
    const s = q.trim().toLowerCase();
    return (items ?? []).filter((f) => !s || `${f.key} ${f.title} ${f.repos.join(" ")}`.toLowerCase().includes(s));
  }, [items, q]);
  return (
    <div className="tidy metrics finpage">
      <div className="tidy-head">
        <div>
          <h2>Finished</h2>
          <span className="st dim">{items ? `${shown.length} work item${shown.length === 1 ? "" : "s"} in the last ${days} days` : "Loading…"}</span>
        </div>
        <input className="field finsearch" placeholder="Filter" aria-label="Filter finished work" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="seg">{SPANS.map(([d, l]) => <button key={d} className={days === d ? "on" : ""} onClick={() => setDays(d)}>{l}</button>)}</div>
        <button className="btn" onClick={onClose}>Back <kbd>esc</kbd></button>
      </div>
      <div className="mbody">
        {err && <div className="tidy-err">{err}</div>}
        {!items && !err && <div className="st dim">Reading finished work…</div>}
        {items && !shown.length && <div className="empty">Nothing finished in this span.</div>}
        {groupByDay(shown).map(([day, rows]) => (
          <section key={day} className="finday">
            <h4>{dayLabel(day)} <span className="c">{rows.length}</span></h4>
            {rows.map((f) => {
              const took = duration(f.startedAt, f.at);
              return (
                <article key={f.key} className="fincard">
                  <div className="finhead">
                    {f.url ? <a className="fkey" href={f.url} target="_blank" rel="noreferrer">{f.key}</a> : <b className="fkey">{f.key}</b>}
                    <span className="ft">{f.title}</span>
                  </div>
                  <div className="finmeta">
                    {f.why && <span className="how">{f.why}</span>}
                    {took && <span>took {took}</span>}
                    {!!f.repos.length && <span>{f.repos.join(", ")}</span>}
                    {f.prs.map((p) => <a key={p.ref} href={p.url} target="_blank" rel="noreferrer" className={p.state}>{p.ref.split("/").pop()} {p.state}</a>)}
                  </div>
                </article>
              );
            })}
          </section>
        ))}
      </div>
    </div>
  );
}
