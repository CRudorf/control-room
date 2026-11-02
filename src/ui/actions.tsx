import { motion } from "motion/react";
import { useEffect, useState, type ReactNode } from "react";
import type { Agent, Feedback, PrRow, WorkItem } from "../shared/types";

const short = (repo: string) => repo.split("/").pop()!;
const num = (p: PrRow) => `${short(p.repo)}#${p.number}`;
const ref = (p: PrRow) => `${p.repo}#${p.number}`;

/** Shows a line at the bottom of the screen (App listens). */
export const toast = (msg: string) => window.dispatchEvent(new CustomEvent("cr-toast", { detail: msg }));

export const post = (path: string, body: object) =>
  fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    .then((x) => x.json()).catch(() => ({ error: "server unreachable" }));

/** Runs a PR action and reports the outcome; the board updates from the refetch that follows. */
export async function act(it: WorkItem, pr: string, action: string, extra: object = {}, trigger = "detail") {
  const r = await post("/api/act", { item: it.id, pr, action, trigger, ...extra });
  toast(r.error ? `Couldn't ${action === "rerequest" ? "re-request" : action}: ${r.error}` : `${pr.split("/").pop()}: ${r.result}`);
  return !r.error;
}

/** The preview sheet for anything a teammate sees or is notified by (Action flows). */
export function Confirm({ title, who, children, go, onClose, label = "Send" }: {
  title: string; who: string; children?: ReactNode; go: () => Promise<unknown>; onClose: () => void; label?: string;
}) {
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [onClose]);
  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div className="sheet wide" initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
        <h3>{title}</h3>
        <div className="who">{who}</div>
        {children}
        <div className="row">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" autoFocus disabled={busy} onClick={async () => { setBusy(true); await go(); setBusy(false); onClose(); }}>
            {busy ? "Sending…" : label} <kbd>⏎</kbd>
          </button>
        </div>
      </motion.div>
    </div>
  );
}

/** Re-request review from whoever's feedback predates the latest push. */
export function RerequestSheet({ it, p, onClose, onDone }: { it: WorkItem; p: PrRow; onClose: () => void; onDone?: () => void }) {
  const who = p.rerequest?.length ? p.rerequest : p.pending_reviewers.filter((x) => !x.startsWith("@"));
  return (
    <Confirm title={`Re-request review on ${num(p)}`} label="Re-request" onClose={onClose}
      who={who.length ? `Notifies ${who.join(", ")}. Marks the PR addressed.` : "Nobody to re-request: no human reviewer has reviewed it."}
      go={() => (who.length ? act(it, ref(p), "rerequest", { reviewers: who }).then((ok) => ok && onDone?.()) : Promise.resolve())} />
  );
}

/** The buttons a PR row offers, one click each except re-request, which goes through its sheet. */
export function PrActions({ it, p }: { it: WorkItem; p: PrRow }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  if (p.role !== "mine") return null;
  const run = async (action: string) => { setBusy(action); await act(it, ref(p), action); setBusy(null); };
  const failing = p.checks === "failure" || p.checks === "error";
  return (
    <div className="pr-acts">
      {failing && <button className="btn sm" disabled={!!busy} onClick={() => run("rerun")}>{busy === "rerun" ? "…" : "Rerun failed"}</button>}
      {p.merge_state === "BEHIND" && <button className="btn sm" disabled={!!busy} onClick={() => run("update")}>{busy === "update" ? "…" : "Update branch"}</button>}
      {(p.state === "re-request" || (p.rerequest?.length ?? 0) > 0) && <button className="btn sm" onClick={() => setSheet(true)}>Re-request <span className="pings">PINGS</span></button>}
      {p.state === "address" && <button className="btn sm" disabled={!!busy} title="The reviewer knows; the ball is theirs (m)" onClick={() => run("mark")}>{busy === "mark" ? "…" : "Mark addressed"}</button>}
      {sheet && <RerequestSheet it={it} p={p} onClose={() => setSheet(false)} />}
    </div>
  );
}

type Draft = { body: string; resolve: boolean };

/** Open feedback with a reply box per thread; replies queue and go out together through one sheet. */
export function Threads({ it, plain, ago }: { it: WorkItem; plain: (s: string) => string; ago: (s: string) => string }) {
  const threads = it.prs.flatMap((p) => (p.feedback ?? []).map((f) => ({ f, p })));
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [open, setOpen] = useState<string | null>(null);
  const [sheet, setSheet] = useState(false);
  const key = (f: Feedback) => f.url;
  // Replies a loop agent drafted start out queued, for the user to edit and send.
  const held = (it.loop ?? []).flatMap((lv) => lv.replies ?? []);
  const heldKey = held.map((r) => r.thread_id).join();
  const fromHeld = () => Object.fromEntries(threads.flatMap(({ f }) => {
    const r = held.find((h) => h.thread_id === f.thread_id);
    return r ? [[key(f), { body: r.body, resolve: r.resolve }]] : [];
  }));
  useEffect(() => { setDrafts(fromHeld()); setOpen(null); }, [it.id, heldKey]);
  const queued = threads.filter(({ f }) => drafts[key(f)]?.body.trim());
  const send = async () => {
    for (const p of [...new Set(queued.map((q) => q.p))]) {
      const replies = queued.filter((q) => q.p === p).map(({ f }) => ({ reply_to: f.reply_to, thread_id: f.thread_id, body: drafts[key(f)].body.trim(), resolve: drafts[key(f)].resolve, who: f.who }));
      const lv = it.loop?.find((x) => x.ref === ref(p) && x.replies?.length);
      if (lv) {
        // The loop's drafts: send, then ask their reviewers again.
        const r = await post("/api/cycle", { item: it.id, ref: ref(p), what: "send", replies });
        toast(r.error ? `Couldn't send: ${r.error}` : `${num(p)}: ${r.result}`);
        if (!r.error) setDrafts({});
      } else if (await act(it, ref(p), "reply", { replies })) setDrafts({});
    }
  };
  const [resolving, setResolving] = useState<Set<string>>(new Set());
  const resolve = async (list: { f: Feedback; p: PrRow }[]) => {
    setResolving(new Set(list.map(({ f }) => key(f))));
    for (const p of [...new Set(list.map((x) => x.p))])
      await act(it, ref(p), "resolve", { threads: list.filter((x) => x.p === p).map(({ f }) => ({ thread_id: f.thread_id, who: f.who })) });
    setResolving(new Set());
  };
  const again = [...new Set((it.loop ?? []).filter((lv) => lv.replies?.length && queued.some((q) => ref(q.p) === lv.ref)).flatMap((lv) => lv.rerequest ?? []))];
  const botThreads = threads.filter(({ f }) => f.bot && f.kind === "thread" && f.thread_id);
  if (!threads.length) return <div className="empty">Nothing unanswered.</div>;
  return (
    <>
      {botThreads.length > 1 && (
        <div className="row-acts" style={{ marginBottom: 8 }}>
          <button className="btn sm" disabled={resolving.size > 0} onClick={() => resolve(botThreads)}>Resolve all {botThreads.length} bot threads</button>
        </div>
      )}
      {queued.length > 0 && (
        <div className="queue">
          <span>{queued.length} repl{queued.length === 1 ? "y" : "ies"} queued{held.length ? ", drafted by the loop's agent" : ""}</span>
          <button className="btn sm primary" onClick={() => setSheet(true)}>Send <span className="pings">PINGS</span></button>
        </div>
      )}
      {threads.map(({ f, p }) => {
        const d = drafts[key(f)];
        return (
          <div key={key(f)} className={`thread ${f.bot ? "bot" : ""}`}>
            <span className="who">{f.who}</span>{" "}
            <span className="where"><a href={f.url} target="_blank" rel="noreferrer">{num(p)}{f.where ? ` · ${f.where}` : ` · ${f.kind}`}</a> · {ago(f.at)}{f.outdated ? " · outdated" : ""}</span>
            <p>{plain(f.body) || "(no text)"}</p>
            {f.kind === "thread" && f.reply_to && (open === key(f) || d ? (
              <div className="draft">
                <textarea value={d?.body ?? ""} rows={3} autoFocus placeholder={`Reply to ${f.who}…`}
                  onChange={(e) => setDrafts({ ...drafts, [key(f)]: { body: e.target.value, resolve: d?.resolve ?? true } })} />
                <label className="st dim"><input type="checkbox" checked={d?.resolve ?? true}
                  onChange={(e) => setDrafts({ ...drafts, [key(f)]: { body: d?.body ?? "", resolve: e.target.checked } })} /> resolve on send</label>
              </div>
            ) : (
              <div className="row-acts">
                <button className="btn sm" onClick={() => setOpen(key(f))}>Reply</button>
                {f.thread_id && <button className="btn sm" disabled={resolving.has(key(f))} title="Resolve without replying; notifies nobody" onClick={() => resolve([{ f, p }])}>{resolving.has(key(f)) ? "Resolving…" : "Resolve"}</button>}
              </div>
            ))}
          </div>
        );
      })}
      {sheet && (
        <Confirm title={`Send ${queued.length} repl${queued.length === 1 ? "y" : "ies"}`} onClose={() => setSheet(false)} go={send}
          who={`Notifies ${[...new Set(queued.map((q) => q.f.who))].join(", ")}. ${again.length ? `Asks ${again.join(", ")} to review again.` : "Marks the PR addressed."}`}>
          <ul className="sheet-list replies">
            {queued.map(({ f, p }) => (
              <li key={key(f)}><b>{f.who}</b> on {num(p)}{f.where ? ` · ${f.where}` : ""}{drafts[key(f)].resolve ? " · resolves" : ""}<pre>{drafts[key(f)].body.trim()}</pre></li>
            ))}
          </ul>
        </Confirm>
      )}
    </>
  );
}

