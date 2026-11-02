// After the merge: what the week's watch found on the user's merged PRs, a sheet to drill into each one's
// evidence, and his verdict on it (or an agent's, once he accepts it). Part of Accomplished.
import { useEffect, useState } from "react";
import type { Accomplished, Shipped } from "../shared/types";
import { post, toast } from "./actions";
import { Sheet } from "./lists";

type Pr = Accomplished["merged"][number];
const short = (ref: string) => ref.split("/").pop()!;
const day = (iso: string) => new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" });

export const STATE: Record<Shipped["state"], [string, string]> = {
  clean: ["Clean", "A week with nothing rewriting its lines, no revert, no unexplained CI failure or new error report"],
  watching: ["Watching", "Inside its first week; nothing found so far"],
  changed: ["Changed after", "Later commits rewrote lines it added, without saying they fix something"],
  look: ["Needs a look", "CI failed after the merge (not obviously infrastructure) or new error reports: evidence, not proof"],
  broke: ["Broke", "Reverted, a fix commit rewrote lines it added, or you confirmed it"],
};

/** Counts over the merged PRs, and the ones worth opening. */
export function AfterMerge({ prs, watch, onOpen }: { prs: Pr[]; watch: Map<string, Shipped>; onOpen: (ref: string) => void }) {
  const ws = prs.map((p) => watch.get(p.ref)).filter(Boolean) as Shipped[];
  if (!ws.length) return null;
  const count = (s: Shipped["state"]) => ws.filter((w) => w.state === s).length;
  const open = ws.filter((w) => w.state !== "clean" && w.state !== "watching" || w.verdict || (w.found !== "clean" && w.found !== "watching"));
  const unruled = ws.filter((w) => (w.found === "broke" || w.found === "look") && !w.verdict).length;
  return (
    <div className="aftermerge">
      <div className="st">After merge: <b className="ok">{count("clean")} clean</b> · {count("watching")} watching · <b className="warn">{count("changed")} changed</b> · <b className="warn">{count("look")} need a look</b> · <b className="pen">{count("broke")} broke</b>
        {unruled > 0 && <span className="dim"> · {unruled} not yet verified</span>}
        {!ws.some((w) => w.sentry !== null) && <span className="dim" title="Add auth_token to ~/.claude/sentry-config.yaml"> · Error reports not connected</span>}</div>
      {open.map((w) => (
        <button key={w.ref} className="amw" onClick={() => onOpen(w.ref)} title="See the evidence and give your verdict">
          <span className="amt"><i className={`dot ${w.state}`} /><span className="r">{short(w.ref)}</span>{w.title}</span>
          <span className="ev">{summary(w)}{w.verdict ? ` · you: ${w.verdict.verdict === "caused" ? "caused by it" : "not this PR"}` : w.agent ? ` · agent: ${w.agent.verdict}` : ""}</span>
        </button>
      ))}
    </div>
  );
}

function summary(w: Shipped): string {
  const fixes = w.rework.filter((r) => r.fix).length;
  return [
    w.reverts.length && "reverted",
    fixes && `${fixes} fix commit${fixes > 1 ? "s" : ""} rewrote its lines`,
    w.rework.length - fixes && `${w.rework.length - fixes} later commit${w.rework.length - fixes > 1 ? "s" : ""} rewrote its lines`,
    w.ciFailures.length && `${w.ciFailures.length} check${w.ciFailures.length > 1 ? "s" : ""} failed after the merge${w.ciFailures.every((f) => f.suspect) ? ", likely not the code" : ""}`,
    w.sentry?.length && `${w.sentry.length} new error report${w.sentry.length > 1 ? "s" : ""}`,
  ].filter(Boolean).join(" · ") || STATE[w.state][1];
}

/** One merged PR's evidence, and the verdict. */
export function ShippedSheet({ w, onClose, onChanged }: { w: Shipped; onClose: () => void; onChanged: () => void }) {
  const [why, setWhy] = useState(w.verdict?.why ?? "");
  const [lesson, setLesson] = useState(w.agent?.prevention ?? "");
  const [busy, setBusy] = useState(false);
  const rule = async (verdict: "caused" | "not" | null, by: "you" | "agent" = "you") => {
    setBusy(true);
    const r = await post("/api/shipped/verdict", { ref: w.ref, verdict, why: why || (by === "agent" ? w.agent?.why ?? "" : ""), by, lesson: verdict === "caused" ? lesson : null });
    setBusy(false);
    toast(r.error ? `Couldn't: ${r.error}` : verdict === null ? "Verdict cleared" : verdict === "caused" ? `Marked as caused by ${short(w.ref)}${lesson.trim() ? "; its lesson goes into self-reviews" : ""}` : `Marked as not ${short(w.ref)}`);
    if (!r.error) onChanged();
  };
  const stick = async () => {
    setBusy(true);
    const r = await post("/api/lessons/stick", { ref: w.ref });
    setBusy(false);
    toast(r.error ? `Couldn't start: ${r.error}` : r.dryRun ? `Dry run: would start ${r.name}` : `Making it stick in ${r.name}; it opens a draft PR in the repo`);
    if (!r.error) onChanged();
  };
  const verify = async () => {
    setBusy(true);
    const r = await post("/api/shipped/verify", { ref: w.ref });
    setBusy(false);
    toast(r.error ? `Couldn't start: ${r.error}` : r.dryRun ? `Dry run: would start ${r.name}` : `Verifying in ${r.name}; its verdict shows here when it's done`);
  };
  return (
    <Sheet title={`After merge: ${short(w.ref)}`} onClose={onClose}>
      <div className="shipsheet">
        <div className="sh-head">
          <a href={w.url} target="_blank" rel="noreferrer"><b>{w.title}</b></a>
          <span className="st dim">merged {day(w.merged)}{w.mergeSha && <> as <a href={`https://github.com/${w.repo}/commit/${w.mergeSha}`} target="_blank" rel="noreferrer">{w.mergeSha.slice(0, 7)}</a></>} · watched to {day(w.until)} · checked {day(w.checkedAt)}</span>
          <span className={`st state-${w.state}`}><i className={`dot ${w.state}`} />{STATE[w.state][0]}{w.found && w.found !== w.state && <span className="dim"> (the watch said {STATE[w.found][0].toLowerCase()})</span>}</span>
        </div>

        {w.reverts.length > 0 && <Section title="Reverted">{w.reverts.map((r) => <Commit key={r.sha} r={r} />)}</Section>}

        {w.rework.length > 0 && (
          <Section title="Later commits that rewrote lines it added" note="Each line here is one this PR added that the later commit changed or removed.">
            {w.rework.map((r) => (
              <div key={r.sha} className="ev-block">
                <Commit r={r} />
                <div className="st dim">{r.file} · {r.count} of its line{r.count === 1 ? "" : "s"} {r.fix ? <b className="pen">· says it fixes something</b> : "· no fix wording"}</div>
                {r.lines?.length ? <pre className="ev-lines">{r.lines.join("\n")}</pre> : null}
              </div>
            ))}
          </Section>
        )}

        {w.ciFailures.length > 0 && (
          <Section title="Checks that passed before the merge and failed on it" note="Evidence, not proof: the job may fail for reasons outside the code.">
            {w.ciFailures.map((f) => (
              <div key={f.name} className="ev-block">
                <a href={f.url} target="_blank" rel="noreferrer"><b>{f.name}</b> ↗</a>
                <div className="st dim">
                  {f.next === "passed" ? "passed again on the next commit" : f.next === "failed" ? "still failing on the next commit" : "next commit: no result yet"}
                  {f.suspect && <b className="warn"> · {f.suspect}</b>}
                </div>
                {f.errors.length ? <pre className="ev-lines">{f.errors.join("\n")}</pre> : <div className="st dim">No error lines in the log; open the job.</div>}
              </div>
            ))}
          </Section>
        )}

        {w.sentry && w.sentry.length > 0 && (
          <Section title="New error reports through its files">{w.sentry.map((s) => <div key={s.sha}><a href={s.url} target="_blank" rel="noreferrer">{s.sha}: {s.text}</a> <span className="st dim">{s.file} · first seen {day(s.at)}</span></div>)}</Section>
        )}

        <Section title="Verdict">
          {w.agent ? (
            <div className="ev-block agentv">
              <div><b>Agent: {w.agent.verdict === "caused" ? "caused by this PR" : w.agent.verdict === "not" ? "not this PR" : "unsure"}</b> <span className="st dim">{w.agent.confidence} confidence</span></div>
              <div>{w.agent.why}</div>
              {w.agent.findings?.map((x, i) => <div key={i} className="st dim">· {x.finding}: {x.caused === true ? "caused" : x.caused === false ? "not caused" : "unclear"}. {x.why}</div>)}
              {w.agent.rootCause && <div className="st">Root cause: {w.agent.rootCause}</div>}
              {w.agent.prevention && <div className="st">Would have caught it: {w.agent.prevention}</div>}
            </div>
          ) : (
            <div className="row-acts"><button className="btn" disabled={busy} onClick={verify} title="An agent reads the job logs, the PR diff and the later commits, decides, and writes its verdict here">Verify with an agent</button>
              <span className="st dim">reads the logs and diffs, runs code if it settles it, changes nothing</span></div>
          )}
          {w.verdict ? (
            <div className="ev-block">
              <b>{w.verdict.by === "agent" ? "You accepted the agent's verdict" : "Your verdict"}: {w.verdict.verdict === "caused" ? "caused by this PR" : "not this PR"}</b>
              {w.verdict.why && <div className="st dim">{w.verdict.why}</div>}
              {w.lesson && <div className="st">Lesson: {w.lesson.text}{w.lesson.files.length ? <span className="dim"> · {w.lesson.files.join(", ")}</span> : null}</div>}
              {w.lesson && (w.lesson.stick
                ? <div className="st dim">Making it stick: {w.lesson.stick.agent} started {day(w.lesson.stick.at)}</div>
                : <div className="row-acts"><button className="btn" disabled={busy} onClick={stick} title="An agent turns the lesson into a test, lint rule, hook or rules file in the repo, and opens a draft PR">Make it stick</button>
                  <span className="st dim">so the next change can't repeat it, not just self-review</span></div>)}
              <div className="row-acts"><button className="btn" disabled={busy} onClick={() => rule(null)}>Clear verdict</button></div>
            </div>
          ) : (
            <>
              <input className="field" placeholder="Why (optional): what you saw" value={why} onChange={(e) => setWhy(e.target.value)} />
              <input className="field" placeholder="If it was this PR: what would have caught it before merge? Self-reviews of this repo will check for it." value={lesson} onChange={(e) => setLesson(e.target.value)} />
              <div className="row-acts">
                {w.agent && w.agent.verdict !== "unsure" && <button className="btn primary" disabled={busy} onClick={() => rule(w.agent!.verdict as "caused" | "not", "agent")}>Accept the agent's verdict</button>}
                <button className="btn" disabled={busy} onClick={() => rule("caused")}>Caused by this PR</button>
                <button className="btn" disabled={busy} onClick={() => rule("not")}>Not this PR</button>
                {w.agent && <button className="btn" disabled={busy} onClick={verify}>Verify again</button>}
              </div>
            </>
          )}
        </Section>
      </div>
    </Sheet>
  );
}

const Section = ({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) => (
  <section className="sh-sec"><h4>{title}</h4>{note && <div className="st dim">{note}</div>}{children}</section>
);

const Commit = ({ r }: { r: Shipped["rework"][number] }) => (
  <div><a href={r.url} target="_blank" rel="noreferrer"><b>{r.sha.slice(0, 7)}</b> {r.text} ↗</a> <span className="st dim">{r.author ? `${r.author} · ` : ""}{day(r.at)}</span></div>
);

/** The sheet for a ref, if the page was opened from a notification about it (?shipped=owner/repo#n). */
export function useShippedParam(): [string | null, (r: string | null) => void] {
  const [ref, setRef] = useState<string | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(location.search).get("shipped");
    if (q) setRef(q);
  }, []);
  return [ref, setRef];
}

/** A set of merged PRs from Metrics (a tile or a week's count): pick one to see its evidence. */
export function ShippedList({ title, ws, onClose, onChanged }: { title: string; ws: Shipped[]; onClose: () => void; onChanged: () => void }) {
  const [opened, setOpened] = useState<string | null>(null);
  const w = opened ? ws.find((x) => x.ref === opened) : null;
  if (w) return <ShippedSheet key={w.ref} w={w} onClose={() => setOpened(null)} onChanged={onChanged} />;
  return (
    <Sheet title={title} onClose={onClose}>
      <div className="aftermerge shipsheet">
        {ws.length ? ws.map((x) => (
          <button key={x.ref} className="amw" onClick={() => setOpened(x.ref)} title="See the evidence and give your verdict">
            <span className="amt"><i className={`dot ${x.state}`} /><span className="r">{short(x.ref)}</span>{x.title}</span>
            <span className="ev">merged {day(x.merged)} · {STATE[x.state][0]} · {summary(x)}{x.verdict ? ` · you: ${x.verdict.verdict === "caused" ? "caused by it" : "not this PR"}` : x.agent ? ` · agent: ${x.agent.verdict}` : ""}</span>
          </button>
        )) : <div className="st dim">None.</div>}
      </div>
    </Sheet>
  );
}
