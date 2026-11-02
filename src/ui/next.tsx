// Next mode: one work item at a time, in the server's Next queue order. ⏎ does it and moves on.
import { AnimatePresence, motion } from "motion/react";
import type { NextStep, Nudge, Suggestion, WorkItem } from "../shared/types";
import { SOURCE } from "./suggestions";

export const STEP: Record<NextStep, { t: string; why: string }> = {
  answer: { t: "Answer", why: "an agent is stuck until you reply" },
  start: { t: "Start", why: "agents work while you do the rest" },
  quick: { t: "Quick", why: "takes seconds" },
  check: { t: "Check", why: "an agent finished" },
  look: { t: "Look", why: "nothing faster is waiting" },
  pickup: { t: "Pick up", why: "the board is clear; this is free to start" },
};

/** A done or skipped item stays out of the queue until its next action changes. */
export const handledKey = (it: WorkItem) => `${it.id}|${it.primary.label}`;
/** A copied or skipped nudge stays out until the PRs it covers change. */
export const nudgeKey = (n: Nudge) => `nudge|${n.reviewer}|${n.prs.map((p) => p.ref).join()}`;
export const nudgeId = (n: Nudge) => `nudge:${n.reviewer}`;

const days = (iso: string) => Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 86_400_000));
const short = (ref: string) => ref.split("/").pop()!;

export function NextQueue({ cur, nudge, queue, nudges, waiting, batch, onPrimary, onBatch, onNudge, onSkip, onPick, suggestion, onPickup }: {
  /** The top free suggestion, offered when nothing else is queued. */
  suggestion: Suggestion | null; onPickup: (s: Suggestion) => void;
  cur: WorkItem | null; nudge: Nudge | null; queue: WorkItem[]; nudges: Nudge[]; waiting: number;
  /** Other queued items due the same update as `cur`, with it: offered as one batch. */
  batch: WorkItem[]; onBatch: () => void;
  onPrimary: (it: WorkItem) => void; onNudge: (n: Nudge) => void; onSkip: () => void; onPick: (id: string) => void;
}) {
  const rest = queue.filter((it) => it.id !== cur?.id);
  const restNudges = nudges.filter((n) => n.reviewer !== nudge?.reviewer);
  const total = queue.length + nudges.length;
  return (
    <div className="nextq">
      <AnimatePresence mode="popLayout" initial={false}>
        {cur ? (
          <motion.div key={cur.id} className="nextcard" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -24 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}>
            {cur.next ? (
              <div className="step"><b>{STEP[cur.next.step].t}</b> · {STEP[cur.next.step].why}<span className="pos">{queue.indexOf(cur) + 1} of {total}</span></div>
            ) : (
              <div className="step off"><b>Off your plate</b> · it moved on since you started</div>
            )}
            <div className="key">{cur.key}</div>
            <h2>{cur.title}</h2>
            <div className="why">{cur.why}</div>
            <div className="row">
              {cur.next && <button className="btn primary" onClick={() => onPrimary(cur)}>{cur.primary.label} <kbd>⏎</kbd></button>}
              {batch.length > 1 && <button className="btn" onClick={onBatch}>Update all {batch.length} in {cur.primary.pr!.split("/").pop()!.split("#")[0]} <kbd>a</kbd></button>}
              <button className="btn" onClick={onSkip}>{cur.next ? "Skip" : "Next"} <kbd>s</kbd></button>
            </div>
          </motion.div>
        ) : nudge ? (
          <motion.div key={nudgeId(nudge)} className="nextcard" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -24 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}>
            <div className="step"><b>Nudge</b> · waiting on them {days(nudge.prs[0].since)} days<span className="pos">{queue.length + nudges.indexOf(nudge) + 1} of {total}</span></div>
            <div className="key">{nudge.reviewer}</div>
            <ul className="nudge-prs">
              {nudge.prs.map((p) => <li key={p.ref}><a href={p.url} target="_blank" rel="noreferrer"><b>{short(p.ref)}</b></a> {p.title} <span className="dim">· {days(p.since)}d</span></li>)}
            </ul>
            <textarea id="nudge-text" key={nudgeKey(nudge)} defaultValue={nudge.text} rows={Math.min(6, nudge.prs.length + 2)} />
            <div className="row">
              <button className="btn primary" onClick={() => onNudge(nudge)}>Copy for Slack <kbd>⏎</kbd></button>
              <button className="btn" onClick={onSkip}>Skip <kbd>s</kbd></button>
            </div>
          </motion.div>
        ) : suggestion ? (
          <motion.div key={`sug-${suggestion.key}`} className="nextcard" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, x: -24 }}
            transition={{ type: "spring", stiffness: 420, damping: 34 }}>
            <div className="step"><b>{STEP.pickup.t}</b> · {STEP.pickup.why}</div>
            <div className="key">{suggestion.source === "architecture" ? suggestion.repo : suggestion.key} <span className="dim">· {SOURCE[suggestion.source]}</span></div>
            <h2>{suggestion.summary}</h2>
            {suggestion.reason && <div className="why">{suggestion.reason}</div>}
            <div className="row">
              <button className="btn primary" onClick={() => onPickup(suggestion)}>Pick up <kbd>⏎</kbd></button>
            </div>
          </motion.div>
        ) : (
          <motion.div key="clear" className="nextcard clear" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
            <h2>Nothing's your move.</h2>
            <div className="why">{waiting ? `${waiting} waiting on others.` : "The board is clear."} Skipped items come back when their next action changes.</div>
          </motion.div>
        )}
      </AnimatePresence>
      {rest.length + restNudges.length > 0 && (
        <>
          <div className="bay-h">Then <span className="c">{rest.length + restNudges.length}</span><span className="rule" /></div>
          {rest.map((it) => (
            <button key={it.id} className="nextrow" onClick={() => onPick(it.id)}>
              <span className="st">{STEP[it.next!.step].t}</span><b>{it.key}</b><span className="lbl">{it.primary.label}</span>
            </button>
          ))}
          {restNudges.map((n) => (
            <button key={nudgeId(n)} className="nextrow" onClick={() => onPick(nudgeId(n))}>
              <span className="st">Nudge</span><b>{n.reviewer}</b><span className="lbl">{n.prs.length} PR{n.prs.length > 1 ? "s" : ""} waiting {days(n.prs[0].since)} days</span>
            </button>
          ))}
        </>
      )}
    </div>
  );
}
