// Metrics: what the user shipped week by week, and how smoothly work moved through the control room.
import { useEffect, useState } from "react";
import type { Friction, LoopState, Metrics as Data, Usage, Week } from "../shared/types";
import { Accomplished } from "./done";
import { Stages } from "./stages";
import { Quality } from "./quality";

const SPAN = 16; // weeks in each sparkline
const TYPICAL = 8; // full weeks the "typical" figure is the median of

const H = 3600_000, D = 24 * H;
function ago(iso: string | null) {
  if (!iso) return "never";
  const d = Date.now() - Date.parse(iso);
  return d < H ? `${Math.max(1, Math.round(d / 60_000))}m` : d < D ? `${Math.round(d / H)}h` : `${Math.round(d / D)}d`;
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const fmt = (n: number | null, digits = 0) => (n === null ? "—" : n.toFixed(digits).replace(/\.0+$/, ""));
/** Tokens as 940k or 12.3M. */
export const tok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${Math.round(n / 1e3)}k`);

/** Monday of this week and the SPAN - 1 before it, as YYYY-MM-DD, oldest first. */
function lastWeeks(): string[] {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const out: string[] = [];
  for (let i = 0; i < SPAN; i++, d.setDate(d.getDate() - 7))
    out.unshift(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
  return out;
}
const label = (week: string) => new Date(`${week}T00:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });

type Series = { week: string; v: number | null }[];

// Each measure's own colour (--tc, set per tone in styles.css) and a line icon, 24×24, stroked.
const ICONS = {
  opened: "M6 3v12M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM18 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM18 15V8a2 2 0 0 0-2-2h-5M13 3l-3 3 3 3",
  merged: "M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 9v6M18 18a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 9a9 9 0 0 0 9 6",
  closed: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM15 9l-6 6M9 9l6 6",
  human: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2zM8 9h8M8 13h5",
  bot: "M12 8V4H8M5 8h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1ZM2 14h2M20 14h2M15 13v2M9 13v2",
  size: "M3 21h18M6 21V11M11 21V5M16 21v-7M21 21V9",
  rounds: "M21 12a9 9 0 0 1-15 6.7L3 16M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M3 21v-5h5",
  commits: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3 12h6M15 12h6",
  repos: "M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20",
  items: "M12 2 2 7l10 5 10-5-10-5ZM2 17l10 5 10-5M2 12l10 5 10-5",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 7v5l3 2",
  done: "M20 6 9 17l-5-5",
  skip: "M5 4l10 8-10 8V4ZM19 5v14",
  nudge: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0",
  tokens: "M12 3 4 7.5v9L12 21l8-4.5v-9L12 3ZM12 12l8-4.5M12 12v9M12 12 4 7.5",
  output: "M4 7V4h16v3M9 20h6M12 4v16",
  bolt: "M13 2 3 14h9l-1 8 10-12h-9l1-8Z",
  drop: "M12 2.7s-6.5 7.4-6.5 12A6.5 6.5 0 0 0 18.5 14.7c0-4.6-6.5-12-6.5-12Z",
  sessions: "M4 17l6-6-6-6M12 19h8",
  usd: "M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6",
} as const;
export type Tone = keyof typeof ICONS;

export function Icon({ name }: { name: Tone }) {
  return <svg className="mi" viewBox="0 0 24 24" aria-hidden="true"><path d={ICONS[name]} /></svg>;
}

/** One measure: this week, the typical week, and a bar per week; the current week is drawn in full ink. */
function Tile({ name, tone, series, unit = "", pre = "", digits = 0, note }: { name: string; tone: Tone; series: Series; unit?: string; pre?: string; digits?: number; note?: string }) {
  const now = series.at(-1)!.v;
  const typical = median(series.slice(-TYPICAL - 1, -1).map((s) => s.v).filter((v): v is number => v !== null));
  const max = Math.max(1, ...series.map((s) => s.v ?? 0));
  const w = 8, gap = 2, h = 34;
  return (
    <div className={`mtile t-${tone}`}>
      <div className="ml"><Icon name={tone} />{name}</div>
      <div className="mv">{now !== null && pre}{fmt(now, digits)}{unit && now !== null ? <span className="mu">{unit}</span> : null}</div>
      <div className="mt">typical {typical !== null && pre}{fmt(typical, digits)}{unit && typical !== null ? unit : ""}{note ? ` · ${note}` : ""}</div>
      <svg className="spark" viewBox={`0 0 ${series.length * (w + gap) - gap} ${h}`} preserveAspectRatio="none" role="img"
        aria-label={`${name} by week: ${series.map((s) => `${label(s.week)} ${fmt(s.v, digits)}`).join(", ")}`}>
        {series.map((s, i) => {
          const bh = s.v ? Math.max(2, (s.v / max) * h) : 0;
          return (
            <g key={s.week}>
              <rect x={i * (w + gap)} y={0} width={w} height={h} fill="transparent"><title>{`Week of ${label(s.week)}: ${fmt(s.v, digits)}${unit}`}</title></rect>
              {bh > 0 && <rect className={i === series.length - 1 ? "cur" : ""} x={i * (w + gap)} y={h - bh} width={w} height={bh} rx={2} pointerEvents="none" />}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

export function Metrics({ onClose }: { onClose: () => void }) {
  const [m, setM] = useState<Data | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [loop, setLoop] = useState<LoopState | null>(null);
  const [looping, setLooping] = useState(false);
  const [pulse, setPulse] = useState<number | null>(null);
  const [u, setU] = useState<Usage | null>(null);
  const [co, setCo] = useState<{ whPerMTok: string; litersPerKwh: string } | null>(null);
  const load = async () => {
    const [r, l, us] = await Promise.all([
      fetch("/api/metrics").then((x) => x.json()).catch(() => ({ error: "server unreachable" })),
      fetch("/api/loop").then((x) => x.json()).catch(() => null),
      fetch("/api/usage").then((x) => x.json()).catch(() => null),
    ]);
    if (r.error) setErr(r.error); else { setErr(null); setM(r); }
    if (l && !l.error) setLoop(l);
    if (us && !us.error) { setU(us); setCo({ whPerMTok: String(us.coeffs.whPerMTok), litersPerKwh: String(us.coeffs.litersPerKwh) }); }
  };
  const saveCoeffs = async () => {
    if (!co) return;
    const r = await fetch("/api/usage", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ coeffs: { whPerMTok: Number(co.whPerMTok), litersPerKwh: Number(co.litersPerKwh) } }) }).then((x) => x.json()).catch(() => null);
    if (r && !r.error) setU(r);
  };
  const runLoop = async () => {
    setLooping(true);
    const r = await fetch("/api/loop", { method: "POST" }).then((x) => x.json()).catch(() => ({ error: "server unreachable" }));
    setLooping(false);
    if (r.error) setErr(`Loop didn't start: ${r.error}`);
    await load();
  };
  useEffect(() => { void load(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  const sync = async () => {
    setSyncing(true);
    await fetch("/api/metrics", { method: "POST" }).catch(() => null);
    await load();
    setSyncing(false);
  };

  const weeks = lastWeeks();
  const byWeek = new Map((m?.weeks ?? []).map((w) => [w.week, w]));
  const fByWeek = new Map((m?.friction ?? []).map((f) => [f.week, f]));
  const out = (f: (w: Week) => number | null): Series => weeks.map((week) => ({ week, v: byWeek.has(week) ? f(byWeek.get(week)!) : 0 }));
  const uByWeek = new Map((u?.weeks ?? []).map((w) => [w.week, w]));
  // Claude Code deletes transcripts after 30 days by default, so weeks before the first one are unknown, not zero.
  const firstUsage = u?.weeks[0]?.week;
  const us = (f: (x: Usage["weeks"][number]) => number): Series =>
    weeks.map((week) => ({ week, v: uByWeek.has(week) ? f(uByWeek.get(week)!) : firstUsage && week > firstUsage ? 0 : null }));
  const fr = (f: (x: Friction) => number | null): Series => weeks.map((week) => ({ week, v: fByWeek.has(week) ? f(fByWeek.get(week)!) : null }));
  const ytd = (k: "opened" | "merged" | "commits") => (m?.weeks ?? []).reduce((a, w) => a + w[k], 0);
  const frictionStart = m?.friction[0]?.week;

  return (
    <div className="tidy metrics">
      <div className="tidy-head">
        <div>
          <h2>Metrics</h2>
          <span className="st dim">{m ? `since ${label(m.from)} · ${ytd("opened")} PRs opened, ${ytd("merged")} merged, ${ytd("commits")} commits · GitHub synced ${ago(m.syncedAt)} ago` : "Loading…"}</span>
        </div>
        <div className="row-acts">
          <button className="btn" disabled={syncing} onClick={sync}>{syncing ? "Syncing…" : "Sync GitHub"}</button>
          <button className="btn" onClick={onClose}>Done <kbd>esc</kbd></button>
        </div>
      </div>
      {err && <div className="tidy-err">{err}</div>}
      {m && (
        <div className="mbody">
          <Accomplished />
          {m.stages && <Stages stages={m.stages} />}
          {m.quality && <Quality weeks={m.quality} />}
          <section>
            <div className="bay-h" style={{ "--hc": "var(--ink-3)" } as React.CSSProperties}><span className="sw" />Output this week<span className="rule" /></div>
            <div className="mtiles">
              <Tile name="PRs opened" tone="opened" series={out((w) => w.opened)} />
              <Tile name="PRs merged" tone="merged" series={out((w) => w.merged)} />
              <Tile name="PRs closed unmerged" tone="closed" series={out((w) => w.closed)} />
              <Tile name="Human feedback" tone="human" series={out((w) => w.humanFeedback)} note="threads, change requests, comments" />
              <Tile name="Bot feedback" tone="bot" series={out((w) => w.feedback - w.humanFeedback)} note="review threads" />
              <Tile name="Review rounds" tone="rounds" series={out((w) => median(w.rounds))} digits={1} note="median per merged PR" />
              <Tile name="PR size" tone="size" series={out((w) => median(w.sizes))} note="median lines changed per merged PR" />
              <Tile name="Commits" tone="commits" series={out((w) => w.commits)} />
              <Tile name="Repos" tone="repos" series={out((w) => w.repos.length)} />
              <Tile name="Work items" tone="items" series={out((w) => w.features.length)} />
            </div>
          </section>
          <section>
            <div className="bay-h" style={{ "--hc": "var(--ink-3)" } as React.CSSProperties}><span className="sw" />Friction this week<span className="rule" /></div>
            <div className="mtiles">
              <Tile name="Time on My turn" tone="clock" series={fr((f) => median(f.myTurnHours))} unit="h" digits={1} note="median before it moved on" />
              <Tile name="Done in Next" tone="done" series={fr((f) => f.nextDone)} />
              <Tile name="Skipped in Next" tone="skip" series={fr((f) => f.nextSkipped)} />
              <Tile name="Nudges sent" tone="nudge" series={fr((f) => f.nudges)} />
            </div>
            <div className="st dim">{frictionStart ? `Recorded since the week of ${label(frictionStart)}.` : "Friction is recorded from now on; the first numbers show up as work moves."}</div>
          </section>
          {u && (
            <section>
              <div className="bay-h" style={{ "--hc": "var(--ink-3)" } as React.CSSProperties}><span className="sw" />AI usage this week<span className="rule" /></div>
              <div className="mtiles">
                <Tile name="API cost, est." tone="usd" series={us((w) => w.usd)} pre="$" digits={0} note={`at API list prices, ${u.pricesAsOf}`} />
                <Tile name="Tokens, price-weighted" tone="tokens" series={us((w) => w.weighted / 1e6)} unit="M" digits={1} note="cache reads count a tenth, output 5×" />
                <Tile name="Output tokens" tone="output" series={us((w) => w.output / 1e6)} unit="M" digits={2} />
                <Tile name="Electricity, est." tone="bolt" series={us((w) => w.kwh)} unit=" kWh" digits={1} />
                <Tile name="Water, est." tone="drop" series={us((w) => w.liters)} unit=" L" digits={1} />
                <Tile name="Sessions" tone="sessions" series={us((w) => w.sessions)} note="in a repo" />
              </div>
              <table className="mtable">
                <thead><tr><th>Work item</th><th>Repos</th><th className="n">Sessions</th><th className="n">Output</th><th className="n">Weighted</th><th className="n">API $</th><th className="n">kWh</th><th className="n">Water L</th><th>Active</th></tr></thead>
                <tbody>
                  {u.items.slice(0, 30).map((i) => (
                    <tr key={i.key}><td><b>{i.key}</b></td><td>{i.repos.join(", ")}</td><td className="n">{i.sessions}</td><td className="n">{tok(i.output)}</td>
                      <td className="n">{tok(i.weighted)}</td><td className="n">${fmt(i.usd, 0)}</td><td className="n">{fmt(i.kwh, 2)}</td><td className="n">{fmt(i.liters, 1)}</td>
                      <td>{label(i.first.slice(0, 10))} – {label(i.last.slice(0, 10))}</td></tr>
                  ))}
                </tbody>
              </table>
              {co && (
                <form className="coeffs" onSubmit={(e) => { e.preventDefault(); void saveCoeffs(); }}>
                  <span className="st dim">Estimates, not measurements: no provider publishes energy per token. Tokens are weighted by price relative to an input token
                    ({Object.entries(u.weights).map(([k, v]) => `${k} ${v}`).join(", ")}). API cost uses each model's list price ({u.pricesAsOf}); you pay a subscription, so it's what the same work would cost through the API. Read from Claude Code transcripts, scanned {ago(u.scannedAt)} ago.</span>
                  <label>Wh per million weighted tokens <input className="field" inputMode="decimal" value={co.whPerMTok} onChange={(e) => setCo({ ...co, whPerMTok: e.target.value })} /></label>
                  <label>Liters of water per kWh <input className="field" inputMode="decimal" value={co.litersPerKwh} onChange={(e) => setCo({ ...co, litersPerKwh: e.target.value })} /></label>
                  <button className="btn" type="submit">Recalculate</button>
                </form>
              )}
            </section>
          )}
          <section>
            <div className="bay-h" style={{ "--hc": "var(--ink-3)" } as React.CSSProperties}><span className="sw" />Weekly loop<span className="rule" /></div>
            <div className="loopbox">
              <div className="loophead">
                <span className="st dim">{loop?.last
                  ? loop.last.error ? `Last run failed ${ago(loop.last.at)} ago: ${loop.last.error}` : `Last run ${ago(loop.last.at)} ago as ${loop.last.agent}; it reports, files loop issues and opens a draft PR`
                  : "Runs once a week, the first weekday morning between 9 and noon: reports, files up to 3 loop issues, opens a draft PR for the top one."}</span>
                <button className="btn" disabled={looping} onClick={runLoop}>{looping ? "Starting…" : "Run it now"}</button>
              </div>
              <div className="row-acts" style={{ margin: "8px 0", alignItems: "center" }}>
                <span className="st dim">How smooth did this week feel? It goes in the brief.</span>
                {[1, 2, 3, 4, 5].map((n) => <button key={n} className={`btn ${(pulse ?? loop?.pulse) === n ? "on" : ""}`} onClick={async () => {
                  const r = await fetch("/api/loop/pulse", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ score: n }) }).then((x) => x.json()).catch(() => ({ error: "server unreachable" }));
                  if (!r.error) setPulse(n);
                }}>{n}</button>)}
              </div>
              {loop?.report ? <pre className="loopreport">{loop.report.text}</pre> : <div className="st dim">No report yet.</div>}
            </div>
          </section>
          <section>
            <div className="bay-h" style={{ "--hc": "var(--ink-3)" } as React.CSSProperties}><span className="sw" />Work items, most recent first <span className="c">{m.features.length}</span><span className="rule" /></div>
            <table className="mtable">
              <thead><tr><th>Work item</th><th>Repos</th><th className="n">PRs</th><th className="n">Merged</th><th className="n">Commits</th><th>Active</th></tr></thead>
              <tbody>
                {m.features.slice(0, 40).map((f) => (
                  <tr key={f.key}><td><b>{f.key}</b></td><td>{f.repos.join(", ")}</td><td className="n">{f.prs}</td><td className="n">{f.merged}</td><td className="n">{f.commits}</td>
                    <td>{label(f.first.slice(0, 10))} – {label(f.last.slice(0, 10))}</td></tr>
                ))}
              </tbody>
            </table>
          </section>
          <section>
            <div className="bay-h" style={{ "--hc": "var(--ink-3)" } as React.CSSProperties}><span className="sw" />Every week<span className="rule" /></div>
            <table className="mtable">
              <thead><tr><th>Week of</th><th className="n">Opened</th><th className="n">Merged</th><th className="n">Closed</th><th className="n">Human fb</th><th className="n">Bot fb</th><th className="n">Rounds</th><th className="n">Size</th><th className="n">Commits</th><th>Repos</th></tr></thead>
              <tbody>
                {[...m.weeks].reverse().map((w) => (
                  <tr key={w.week}><td>{label(w.week)}</td><td className="n">{w.opened}</td><td className="n">{w.merged}</td><td className="n">{w.closed}</td><td className="n">{w.humanFeedback}</td>
                    <td className="n">{w.feedback - w.humanFeedback}</td><td className="n">{fmt(median(w.rounds), 1)}</td><td className="n">{fmt(median(w.sizes))}{w.sizes.length ? ` (max ${Math.max(...w.sizes)})` : ""}</td><td className="n">{w.commits}</td><td>{w.repos.join(", ")}</td></tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}
    </div>
  );
}
