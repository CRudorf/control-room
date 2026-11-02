// Reviewing an unattended signal-to-pr run: the files it left, a Jira comment it drafted (posted
// through a preview sheet), and dismissing it once done.
import { useEffect, useState } from "react";
import type { WorkItem } from "../shared/types";
import { Confirm, post, toast } from "./actions";
import { Sheet } from "./lists";

type File = { name: string; at: string; text: string };
const JIRA = /^[A-Z][A-Z0-9]+-\d+$/;

export function RunSheet({ it, onClose, onDone }: { it: WorkItem; onClose: () => void; onDone?: () => void }) {
  const key = it.primary.run ?? it.key;
  const [r, setR] = useState<{ dir: string | null; files: File[] } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [posting, setPosting] = useState<File | null>(null);
  useEffect(() => {
    void fetch(`/api/run?key=${encodeURIComponent(key)}`).then((x) => x.json()).then((d) => {
      if (d.error) return toast(d.error);
      setR(d);
      setOpen(d.files.find((f: File) => /rca|skipped/.test(f.name))?.name ?? d.files[0]?.name ?? null);
    });
  }, [key]);
  // The ticket: the work item's own key, or the one the run created and wrote down.
  const ticket = JIRA.test(it.key) ? it.key : r?.files.find((f) => f.name.startsWith("ticket-key"))?.text.trim().match(/[A-Z][A-Z0-9]+-\d+/)?.[0] ?? null;
  const dismiss = async () => {
    const d = await post("/api/run", { key, item: it.id, dismiss: true });
    toast(d.error ?? `Run ${key} reviewed`);
    if (!d.error) { onDone?.(); onClose(); }
  };
  if (posting && ticket) return (
    <Confirm title={`Post ${posting.name} to ${ticket}`} label="Post" onClose={() => setPosting(null)}
      who={`Adds a comment on ${ticket}. Everyone watching the issue is notified.`}
      go={async () => { const d = await post("/api/run", { key, item: it.id, file: posting.name, jira: ticket }); toast(d.error ? `Couldn't post: ${d.error}` : `Posted to ${ticket}`); }}>
      <pre className="runfile">{posting.text}</pre>
    </Confirm>
  );
  return (
    <Sheet title={`Run ${key}`} onClose={onClose}>
      {!r ? <p className="st dim">Loading…</p> : !r.dir ? <p>No run folder in ~/work-loop for {key} yet.</p> : (
        <>
          <p className="st dim" style={{ marginTop: 0 }}>{r.dir.replace(/^\/Users\/[^/]+/, "~")}</p>
          <ul className="runfiles">
            {r.files.map((f) => (
              <li key={f.name}>
                <div className="runhead">
                  <button className="linkish" onClick={() => setOpen(open === f.name ? null : f.name)}>{open === f.name ? "▾" : "▸"} {f.name}</button>
                  {/^jira-comment/.test(f.name) && ticket && <button className="btn sm" onClick={() => setPosting(f)}>Post to {ticket}</button>}
                </div>
                {open === f.name && <pre className="runfile">{f.text}</pre>}
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="row"><button className="btn" onClick={onClose}>Later</button><button className="btn primary" onClick={() => void dismiss()}>Done reviewing</button></div>
    </Sheet>
  );
}
