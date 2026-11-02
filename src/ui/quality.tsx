// Quality: whether the work holds up and how much of it ran without the user. Over the last four weeks:
// merged PRs that stayed clean after the merge, CI failures before it, how often agents needed him and
// how often the review loop finished alone; then week by week. Part of Metrics.
import { useEffect, useState } from "react";
import type { Quality as Week, Shipped } from "../shared/types";
import { post, toast } from "./actions";
import { weekOf } from "../shared/week";
import { Icon, type Tone } from "./metrics";
import { ShippedList } from "./shipped";

type Pick = { title: string; weeks: string[]; keep: (w: Shipped) => boolean };
const ruled = (w: Shipped) => !!w.verdict;
const flagged = (w: Shipped) => w.state === "broke" || w.state === "look" || w.state === "changed";
const isState = (s: Shipped["state"]) => (w: Shipped) => w.state === s;

const pct = (n: number, of: number) => (of ? `${Math.round((100 * n) / of)}%` : "–");

function Stat({ name, tone, v, note, onOpen }: { name: string; tone: Tone; v: string; note: string; onOpen?: () => void }) {
  const body = <><div className="ml"><Icon name={tone} />{name}</div><div className="mv">{v}</div><div className="mt">{note}</div>{onOpen && <div className="drill">See the PRs ›</div>}</>;
  return onOpen
    ? <button className={`mtile t-${tone} stat drillable`} onClick={onOpen} title="See these PRs and drill into each">{body}</button>
    : <div className={`mtile t-${tone} stat`}>{body}</div>;
}

/** A count in the weekly table that opens the PRs behind it. */
function N({ n, label, onOpen }: { n: number; label?: string; onOpen: () => void }) {
  return <td className="n">{n ? <button className="ncell" onClick={onOpen} title="See these PRs">{label ?? n}</button> : label ?? n}</td>;
}

export function Quality({ weeks }: { weeks: Week[] }) {
  const last = weeks.slice(-4);
  const sum = (f: (w: Week) => number) => last.reduce((a, w) => a + f(w), 0);
  const settled = sum((w) => w.shipped.clean + w.shipped.changed + w.shipped.look + w.shipped.broke);
  const ruled_ = sum((w) => w.confirmed + w.dismissed);
  const agents = sum((w) => w.agents), touches = sum((w) => w.touches);
  const rounds = sum((w) => w.loopRounds), stops = sum((w) => w.loopStops);
  const [shipped, setShipped] = useState<Shipped[]>([]);
  const [pick, setPick] = useState<Pick | null>(null);
  const reload = () => fetch("/api/shipped").then((x) => x.json()).then((r) => r.shipped && setShipped(r.shipped)).catch(() => {});
  const [replays, setReplays] = useState<{ replays: { ref: string; at: string; caught: boolean | null; candidates: { path: string; title: string }[]; lesson: string | null }[]; waiting: number } | null>(null);
  const reloadReplays = () => fetch("/api/replays").then((x) => x.json()).then((r) => r.replays && setReplays(r)).catch(() => {});
  useEffect(() => { void reload(); void reloadReplays(); }, []);
  const replay = async (again: boolean) => {
    const r = await post("/api/replays", { again });
    toast(r.error ? `Couldn't start: ${r.error}` : r.started.length ? `Replaying ${r.started.length} confirmed break${r.started.length > 1 ? "s" : ""}; the catch rate updates when they finish` : "Nothing to replay");
    void reloadReplays();
  };
  const caughtN = replays?.replays.filter((r) => r.caught === true).length ?? 0;
  const gradedN = replays?.replays.filter((r) => r.caught !== null).length ?? 0;
  const toGrade = replays?.replays.filter((r) => r.caught === null) ?? [];
  const gradeIt = async (ref: string, at: string, same: boolean) => {
    const r = await post("/api/replays/grade", { ref, at, same });
    if (r.error) toast(`Couldn't save: ${r.error}`);
    void reloadReplays();
  };
  const lastWeeks = last.map((w) => w.week);
  const open = (title: string, weeks: string[], keep: Pick["keep"]) => setPick({ title, weeks, keep });
  const picked = pick ? shipped.filter((w) => pick.weeks.includes(weekOf(w.merged)) && pick.keep(w)).sort((a, b) => b.merged.localeCompare(a.merged)) : [];
  return (
    <section className="quality">
      {pick && <ShippedList title={pick.title} ws={picked} onClose={() => setPick(null)} onChanged={() => void reload()} />}
      <div className="bay-h" style={{ "--hc": "var(--ink-3)" } as React.CSSProperties}><span className="sw" />Quality <span className="c">last 4 weeks</span><span className="rule" /></div>
      <div className="mtiles stats">
        <Stat name="Shipped clean" tone="done" v={pct(sum((w) => w.shipped.clean), settled)} note={`${settled} past their week; ${sum((w) => w.shipped.watching)} still watched`} onOpen={() => open("Merged in the last 4 weeks", lastWeeks, () => true)} />
        <Stat name="Broke after merge" tone="closed" v={String(sum((w) => w.shipped.broke))} note={`${sum((w) => w.confirmed)} confirmed by you · ${sum((w) => w.shipped.look)} need a look · ${sum((w) => w.shipped.changed)} changed after`} onOpen={() => open("Broke, need a look, or changed after: last 4 weeks", lastWeeks, flagged)} />
        <Stat name="Watch accuracy" tone="nudge" v={pct(sum((w) => w.confirmed), ruled_)} note={ruled_ ? `of ${ruled_} findings you ruled on, real` : "rule on findings to measure it"} onOpen={() => open(ruled_ ? "Findings you ruled on: last 4 weeks" : "Findings to rule on: last 4 weeks", lastWeeks, ruled_ ? ruled : flagged)} />
        <Stat name="Self-review catch rate" tone="skip" v={pct(caughtN, gradedN)} note={replays?.replays.length ? `of ${gradedN} graded breaks, the same bug found${toGrade.length ? `; ${toGrade.length} to grade` : ""}` : "replay confirmed breaks to measure it"} />
        <Stat name="CI failed before merge" tone="rounds" v={pct(sum((w) => w.ciFailedPrs), sum((w) => w.merged))} note="merged PRs with a red commit" />
        <Stat name="Agents needing you" tone="sessions" v={agents ? (touches / agents).toFixed(1) : "–"} note={`touches per agent, ${agents} started`} />
        <Stat name="Loop finished alone" tone="bot" v={pct(rounds, rounds + stops)} note={`${rounds} rounds, ${stops} handed back`} />
        <Stat name="Self-reviews" tone="human" v={String(sum((w) => w.selfReviews))} note="your PRs reviewed before your reviewers" />
      </div>
      {replays && (replays.waiting > 0 || replays.replays.length > 0) && (
        <div className="row-acts" style={{ margin: "8px 0" }}>
          {replays.waiting > 0 && <button className="btn" onClick={() => void replay(false)} title="A review agent self-reviews each confirmed break as it merged, with only the lessons from before it">Replay {replays.waiting} confirmed break{replays.waiting > 1 ? "s" : ""}</button>}
          {replays.replays.length > 0 && <button className="btn" onClick={() => void replay(true)} title="Run them again, after a change to how self-review works">Replay all again</button>}
          <span className="st dim">self-review on the PR as it merged, without its own lesson</span>
        </div>
      )}
      {toGrade.map((r) => (
        <div key={r.ref} className="st" style={{ margin: "8px 0" }}>
          <b>{r.ref}</b>{r.lesson ? <> broke: {r.lesson}</> : " broke"}. The replay flagged:
          <ul style={{ margin: "4px 0" }}>{r.candidates.map((c, i) => <li key={i}>{c.path}: {c.title}</li>)}</ul>
          <div className="row-acts">
            <button className="btn" onClick={() => void gradeIt(r.ref, r.at, true)}>Same bug</button>
            <button className="btn" onClick={() => void gradeIt(r.ref, r.at, false)}>Something else</button>
          </div>
        </div>
      ))}
      <table className="mtable">
        <thead><tr><th>Week</th><th className="n">Merged</th><th className="n">CI failed</th><th className="n">Clean</th><th className="n">Changed</th><th className="n">Look</th><th className="n">Broke</th><th className="n">Confirmed</th><th className="n">Agents</th><th className="n">Touches</th><th className="n">Loop rounds</th><th className="n">Handed back</th></tr></thead>
        <tbody>
          {[...weeks].reverse().slice(0, 8).map((w) => (
            <tr key={w.week}>
              <td><b>{w.week}</b></td><td className="n">{w.merged}</td><td className="n">{w.ciFailedPrs}</td>
              <N n={w.shipped.clean} onOpen={() => open(`Clean: week of ${w.week}`, [w.week], isState("clean"))} />
              <N n={w.shipped.changed} onOpen={() => open(`Changed after: week of ${w.week}`, [w.week], isState("changed"))} />
              <N n={w.shipped.look} onOpen={() => open(`Need a look: week of ${w.week}`, [w.week], isState("look"))} />
              <N n={w.shipped.broke} onOpen={() => open(`Broke: week of ${w.week}`, [w.week], isState("broke"))} />
              <N n={w.confirmed + w.dismissed} label={`${w.confirmed}/${w.confirmed + w.dismissed}`} onOpen={() => open(`Ruled on: week of ${w.week}`, [w.week], ruled)} />
              <td className="n">{w.agents}</td><td className="n">{w.touches}</td><td className="n">{w.loopRounds}</td><td className="n">{w.loopStops}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
