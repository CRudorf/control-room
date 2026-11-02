// Accomplished: what the user got done today, in the last 24 hours, 7 days or 30 days, top of Metrics.
import { useEffect, useState } from "react";
import type { Accomplished as Data, Shipped, Span } from "../shared/types";
import { Icon, type Tone } from "./metrics";
import { toast } from "./actions";
import { ChartButton, useVisuals, VisualStrip } from "./visuals";
import { AfterMerge, ShippedSheet, STATE, useShippedParam } from "./shipped";

const SPANS: [Span, string][] = [["today", "Today"], ["24h", "24 hours"], ["7d", "7 days"], ["30d", "30 days"]];
const short = (ref: string) => ref.split("/").pop()!;
const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`;

function Stat({ name, tone, v }: { name: string; tone: Tone; v: string | number }) {
  return (
    <div className={`mtile t-${tone} stat`}>
      <div className="ml"><Icon name={tone} />{name}</div>
      <div className="mv">{v}</div>
    </div>
  );
}

type Pr = Data["merged"][number];

/** PRs under their work item, work items in first-seen order. */
function ByItem({ prs, watch, onOpen, merged }: { prs: Pr[]; watch?: Map<string, Shipped>; onOpen?: (ref: string) => void; merged?: boolean }) {
  const visuals = useVisuals(null).list ?? [];
  const groups = new Map<string, Pr[]>();
  for (const p of prs) groups.set(p.feature, [...(groups.get(p.feature) ?? []), p]);
  return (
    <ul className="donelist">
      {[...groups].map(([key, ps]) => (
        <li key={key}>
          <b className="dk">{key}</b>
          {merged && <VisualStrip list={visuals.filter((v) => v.key?.toUpperCase() === key.toUpperCase())} />}
          {ps.map((p) => {
            const w = watch?.get(p.ref);
            return (
              <span key={p.ref} className="prline">
                {w && <button className={`dotbtn`} onClick={() => onOpen?.(p.ref)} title={`${STATE[w.state][0]}: ${STATE[w.state][1]}. Open the after-merge watch.`}><i className={`dot ${w.state}`} /></button>}
                <a href={p.url} target="_blank" rel="noreferrer"><span className="r">{short(p.ref)}</span>{p.title}</a>
                {merged && <ChartButton item={`done-${p.feature}`} pr={p.ref} keyName={p.feature} merged />}
              </span>
            );
          })}
        </li>
      ))}
    </ul>
  );
}

/** Plain text for pasting, one line per PR. */
function asText(d: Data, label: string) {
  const prs = (title: string, list: Pr[]) => (list.length ? [`${title} (${list.length})`, ...list.map((p) => `  ${short(p.ref)} ${p.title}`)] : []);
  return [
    `Accomplished, ${label.toLowerCase()}`,
    ...prs("Merged", d.merged), ...prs("Opened", d.opened),
    ...(d.reviewed.length ? [`Reviewed (${d.reviewed.length})`, ...d.reviewed.map((r) => `  ${short(r.ref)} ${r.title}, ${r.author}: ${r.verdict}`)] : []),
    ...(d.jira.length ? [`Issues (${d.jira.length})`, ...d.jira.map((j) => `  ${j}`)] : []),
    `${d.commits} commits across ${d.repos.join(", ") || "no repos"}`,
  ].join("\n");
}

export function Accomplished() {
  const [data, setData] = useState<{ spans: Data[]; syncedAt: string | null; reviewsError: string | null; shipped: Shipped[] } | null>(null);
  const [opened, setOpened] = useShippedParam();
  const [err, setErr] = useState<string | null>(null);
  const [span, setSpan] = useState<Span>("today");
  const load = () => fetch("/api/done").then((x) => x.json()).then((r) => (r.error ? setErr(r.error) : setData(r))).catch(() => setErr("server unreachable"));
  useEffect(() => { void load(); }, []);
  // The watch's results without the rest of Accomplished: after a verdict, or while an agent verifies.
  const reloadShipped = () => fetch("/api/shipped").then((x) => x.json()).then((r) => r.shipped && setData((d) => (d ? { ...d, shipped: r.shipped } : d))).catch(() => {});
  useEffect(() => { if (!opened) return; const t = setInterval(reloadShipped, 10_000); return () => clearInterval(t); }, [opened]);
  const d = data?.spans.find((s) => s.span === span);
  const watch = new Map((data?.shipped ?? []).map((w) => [w.ref, w]));
  const label = SPANS.find(([s]) => s === span)![1];
  const copy = async () => {
    if (!d) return;
    await navigator.clipboard.writeText(asText(d, span === "today" ? "today" : `the last ${label}`)).then(() => toast("Copied"), () => toast("Couldn't copy"));
  };
  return (
    <section className="done">
      {opened && watch.get(opened) && <ShippedSheet key={opened} w={watch.get(opened)!} onClose={() => { setOpened(null); history.replaceState(null, "", location.pathname); }} onChanged={() => void reloadShipped()} />}
      <div className="bay-h" style={{ "--hc": "var(--ink-3)" } as React.CSSProperties}>
        <span className="sw" />Accomplished<span className="rule" />
        <div className="seg">{SPANS.map(([s, l]) => <button key={s} className={span === s ? "on" : ""} onClick={() => setSpan(s)}>{l}</button>)}</div>
        <button className="btn" disabled={!d} onClick={copy}>Copy as text</button>
      </div>
      {err && <div className="tidy-err">{err}</div>}
      {!d && !err && <div className="st dim">Bringing GitHub up to date…</div>}
      {d && (
        <>
          <div className="mtiles stats">
            <Stat name="Merged" tone="merged" v={d.merged.length} />
            <Stat name="Opened" tone="opened" v={d.opened.length} />
            <Stat name="Reviews given" tone="human" v={d.reviewed.length} />
            <Stat name="Commits" tone="commits" v={d.commits} />
            <Stat name="Work items" tone="items" v={d.features.length} />
            <Stat name="Repos" tone="repos" v={d.repos.length} />
            {d.usage && <Stat name="API cost, est." tone="usd" v={`$${Math.round(d.usage.usd)}`} />}
            {d.usage && <Stat name="Electricity, est." tone="bolt" v={`${d.usage.kwh.toFixed(1)} kWh`} />}
          </div>
          <div className="donecols">
            <div>
              <h4>Merged <span className="c">{d.merged.length}</span></h4>
              {d.merged.length ? <><AfterMerge prs={d.merged} watch={watch} onOpen={setOpened} /><ByItem prs={d.merged} watch={watch} onOpen={setOpened} merged /></> : <div className="st dim">Nothing merged {span === "today" ? "today" : "in this span"}.</div>}
              {d.closed.length > 0 && <><h4>Closed unmerged <span className="c">{d.closed.length}</span></h4><ByItem prs={d.closed} /></>}
            </div>
            <div>
              <h4>Opened <span className="c">{d.opened.length}</span></h4>
              {d.opened.length ? <ByItem prs={d.opened} /> : <div className="st dim">Nothing opened.</div>}
            </div>
            <div>
              <h4>Reviewed for others <span className="c">{d.reviewed.length}</span></h4>
              {data?.reviewsError && <div className="st pen">Couldn't read reviews: {data.reviewsError}</div>}
              <ul className="donelist">
                {d.reviewed.map((r) => (
                  <li key={r.ref}><a href={r.url} target="_blank" rel="noreferrer"><span className="r">{short(r.ref)}</span>{r.title}</a>
                    <span className={`st ${r.verdict === "approved" ? "ok" : r.verdict === "changes requested" ? "pen" : "dim"}`}>{r.author} · {r.verdict}{r.comments ? ` · ${r.comments} comment${r.comments === 1 ? "" : "s"}` : ""}</span></li>
                ))}
              </ul>
              {d.jira.length > 0 && <><h4>Issues <span className="c">{d.jira.length}</span></h4><ul className="donelist">{d.jira.map((j, i) => <li key={i}>{j}</li>)}</ul></>}
              <div className="st dim doneloop">
                Through the control room: {n(d.reviewsPosted, "review")} posted{d.commentsPosted ? ` with ${n(d.commentsPosted, "inline comment")}` : ""}, {n(d.replies, "reply", "replies")} sent, {n(d.resolved, "thread")} resolved, {n(d.rerequests, "re-request")}, {n(d.loopRounds, "review loop round")}.
                {d.repos.length > 0 && ` Repos: ${d.repos.join(", ")}.`}
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  );
}
