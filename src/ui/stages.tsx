// Where PR time goes: median hours per stage for the user's merged PRs, how fast each reviewer answers,
// and the review requests waiting now. Part of Metrics.
import { useState } from "react";
import type { StageTimes } from "../shared/types";
import { Icon, type Tone } from "./metrics";

/** Hours as "5h" under two days, else "3.5d". */
export const dur = (h: number | null) => (h === null ? "–" : h < 48 ? `${h < 10 ? h.toFixed(1) : Math.round(h)}h` : `${(h / 24).toFixed(1)}d`);
const who = (w: string) => (w.startsWith("team:") ? `${w.slice(5)} (team)` : w);
const short = (ref: string) => ref.split("/").pop()!;

function Stat({ name, tone, h, note }: { name: string; tone: Tone; h: number | null; note: string }) {
  return (
    <div className={`mtile t-${tone} stat`}>
      <div className="ml"><Icon name={tone} />{name}</div>
      <div className="mv">{dur(h)}</div>
      <div className="mt">{note}</div>
    </div>
  );
}

export function Stages({ stages }: { stages: { d30: StageTimes; all: StageTimes } }) {
  const [span, setSpan] = useState<"d30" | "all">("d30");
  const s = stages[span];
  // One line per PR, its unanswered reviewers together.
  const waiting = [...s.waiting.reduce((m, w) => {
    const e = m.get(w.ref) ?? { ...w, who: [] as string[] };
    e.who.push(who(w.who));
    return m.set(w.ref, e);
  }, new Map<string, Omit<StageTimes["waiting"][number], "who"> & { who: string[] }>()).values()];
  return (
    <section className="stages">
      <div className="bay-h" style={{ "--hc": "var(--ink-3)" } as React.CSSProperties}>
        <span className="sw" />Where PR time goes <span className="c">{s.prs} merged</span><span className="rule" />
        <div className="seg">{([["d30", "30 days"], ["all", "Since Jan"]] as const).map(([k, l]) => <button key={k} className={span === k ? "on" : ""} onClick={() => setSpan(k)}>{l}</button>)}</div>
      </div>
      <div className="mtiles stats">
        <Stat name="Coding" tone="commits" h={s.medians.coding} note="first commit to ready" />
        <Stat name="Waiting for a review" tone="clock" h={s.medians.waitFirst} note="ready to a person's first review" />
        <Stat name="In review" tone="human" h={s.medians.inReview} note="first review to approval, when the first wasn't one" />
        <Stat name="Approval to merge" tone="merged" h={s.medians.toMerge} note="approval to merged" />
        <Stat name="Start to merge" tone="opened" h={s.medians.total} note="whole PR, median" />
      </div>
      <div className="donecols two">
        <div>
          <h4>Reviewers, slowest first <span className="c">{s.reviewers.length}</span></h4>
          <table className="mtable">
            <thead><tr><th>Reviewer</th><th className="n">Asked</th><th className="n">Answered</th><th className="n">Median wait</th><th className="n">Open now</th></tr></thead>
            <tbody>{s.reviewers.map((r) => <tr key={r.who}><td><b>{who(r.who)}</b></td><td className="n">{r.asks}</td><td className="n">{r.answered}</td><td className="n">{dur(r.median)}</td><td className="n">{r.open || ""}</td></tr>)}</tbody>
          </table>
        </div>
        <div>
          <h4>Waiting on a reviewer now <span className="c">{waiting.length}</span></h4>
          {!waiting.length && <div className="st dim">Nobody's sitting on a request.</div>}
          <ul className="donelist">
            {waiting.map((w) => (
              <li key={w.ref}><a href={w.url} target="_blank" rel="noreferrer"><span className="r">{short(w.ref)}</span>{w.title}</a>
                <span className={`st ${w.hours > 48 ? "pen" : "dim"}`}>{w.who.join(", ")} · {dur(w.hours)}</span></li>
            ))}
          </ul>
        </div>
      </div>
      <div className="st dim">Medians over PRs merged in the span. Reviews from bots and from you don't count; a team request is answered by anyone's review. Synced with the PR history.</div>
    </section>
  );
}
