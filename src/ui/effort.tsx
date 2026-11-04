// How much work an item needs from the user to ship, in points, and for a review request, how thoroughly its complexity says
// to check it: each treatment it calls for, done or not, with a button to start the ones that aren't.
import { useEffect, useState } from "react";
import { SIZE_LABEL, TIER_LABEL, TREATMENT_LABEL, type Effort, type Treatment } from "../shared/effort";
import type { PrRow, VisualMeta, WorkItem } from "../shared/types";
import { post, toast } from "./actions";

const effortText = (e: Effort) => `${SIZE_LABEL[e.size]}, ${e.points} point${e.points === 1 ? "" : "s"}: ${e.reasons.join("; ")}`;

/** The strip's chip: the item's size and points, and a review's tier when it's past light. */
export function EffortChip({ it }: { it: WorkItem }) {
  if (!it.effort) return null;
  const c = it.prs.find((p) => p.role === "requested" && p.complexity)?.complexity;
  return (
    <span className={`effort ${c ? `tier-${c.tier}` : ""}`} title={`${effortText(it.effort)}${c ? `\n${TIER_LABEL[c.tier]}: ${c.reasons.join(", ") || "small change"}` : ""}`}>
      {it.effort.size} · {it.effort.points} pt{it.effort.points === 1 ? "" : "s"}{c && c.tier !== "light" ? ` · ${c.tier}` : ""}
    </span>
  );
}

type Done = Record<Treatment, "done" | "running" | null>;

function useDone(it: WorkItem, p: PrRow, visuals: VisualMeta[]): [Done, () => void] {
  const ref = `${p.repo}#${p.number}`;
  const [runs, setRuns] = useState<{ state: string }[]>([]);
  const load = () => void fetch(`/api/verify?key=${encodeURIComponent(it.key)}&head=${p.head}&base=${encodeURIComponent(p.base)}`).then((x) => x.json()).then((r) => setRuns(r.runs ?? [])).catch(() => {});
  useEffect(load, [it.key, p.head]);
  const guide = it.guide?.find((g) => g.ref === ref);
  const reviewing = it.agents.some((a) => a.status === "working" && /^review /.test(a.label));
  return [{
    guide: guide && !guide.stale ? "done" : reviewing ? "running" : null,
    verify: runs.some((r) => r.state === "running" || r.state === "starting") ? "running" : runs.length ? "done" : null,
    chart: visuals.some((v) => v.pr === ref && v.kind === "change") ? "done" : null,
    video: visuals.some((v) => v.pr === ref && v.kind === "video") ? "done" : null,
  }, load];
}

function Plan({ it, p, visuals }: { it: WorkItem; p: PrRow; visuals: VisualMeta[] }) {
  const c = p.complexity!;
  const [done, reload] = useDone(it, p, visuals);
  const [busy, setBusy] = useState<Treatment | null>(null);
  const ref = `${p.repo}#${p.number}`;
  const start = async (t: Treatment) => {
    setBusy(t);
    const r = t === "verify" ? await post("/api/verify/start", { repo: p.repo, ref: p.head, key: it.key, pr: ref, item: it.id, agent: true })
      : t === "chart" ? await post("/api/visuals/chart", { item: it.id, pr: ref, key: it.key, merged: false })
      : await post("/api/visuals/video", { item: it.id, pr: ref, key: it.key });
    setBusy(null);
    toast(r.error ? `Couldn't start the ${TREATMENT_LABEL[t].toLowerCase()}: ${r.error}` : r.dryRun ? `Dev: recorded, nothing started` : `${TREATMENT_LABEL[t]} started on #${p.number}`);
    reload();
  };
  const missing = c.treatments.filter((t) => !done[t]);
  return (
    <div className={`plan tier-${c.tier}`}>
      <span className="st">{TIER_LABEL[c.tier].toUpperCase()}</span>
      <span className="txt">
        #{p.number}: {c.reasons.join(", ") || "a small change"}{c.runtime ? `; ${c.runtime}, so run it` : ""}.
        {c.treatments.length > 0 && <> {missing.length ? "Still to do:" : "Everything it calls for is done."}</>}
      </span>
      {c.treatments.length > 0 && (
        <span className="treat">
          {c.treatments.map((t) => done[t]
            ? <span key={t} className={`chip ${done[t]}`}>{done[t] === "done" ? "✓" : "…"} {TREATMENT_LABEL[t]}</span>
            : t === "guide" ? <span key={t} className="chip todo" title="Starts on its own when the review agent is free">{TREATMENT_LABEL[t]}: queued</span>
            : <button key={t} className="btn sm on-strip" disabled={!!busy} onClick={() => void start(t)}>{busy === t ? "Starting…" : TREATMENT_LABEL[t]}</button>)}
        </span>
      )}
    </div>
  );
}

/** The item's effort line, and a plan per review request. */
export function EffortLines({ it, visuals }: { it: WorkItem; visuals: VisualMeta[] }) {
  const reviews = it.prs.filter((p) => p.role === "requested" && p.complexity);
  if (!it.effort && !reviews.length) return null;
  return (
    <div className="loops">
      {it.effort && <div className="loopline effortline"><span className="st">EFFORT</span><span className="txt">{effortText(it.effort)}.</span><span /></div>}
      {reviews.map((p) => <Plan key={p.number} it={it} p={p} visuals={visuals} />)}
    </div>
  );
}
