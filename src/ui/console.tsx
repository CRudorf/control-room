// An agent's session as a conversation, drawn from its transcript in the board's own skin: what the user said,
// what the agent said, a line per run of tools. A dialog the agent waits at (a permission prompt, a question)
// shows as a card whose buttons answer it. Below, a box for a message.
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { ChatEntry, Dialog } from "../shared/types";
import { post } from "./actions";
import { Markdown } from "./docs";

type Status = "blocked" | "done" | "finished" | "working" | "idle" | "unknown";

/** The keys that move a dialog's pick from `from` to option `to` and choose it. */
export function keysFor(d: Pick<Dialog, "options">, to: number): string[] {
  const from = Math.max(0, d.options.findIndex((o) => o.current)), at = d.options.findIndex((o) => o.n === to);
  if (at < 0) return [];
  return [...Array(Math.abs(at - from)).fill(at > from ? "down" : "up"), "enter"];
}

/** Sent and not in the transcript yet: shown at once, until the transcript has it. */
type Pending = { text: string; at: number };

function Tools({ e, open: start }: { e: ChatEntry; open: boolean }) {
  const [open, setOpen] = useState(start);
  const ts = e.tools ?? [], failed = ts.filter((t) => t.failed).length;
  return (
    <div className={`chat-tools ${open ? "open" : ""}`}>
      <button type="button" className="chat-tools-h" onClick={() => setOpen(!open)}>
        <span className="tw">{open ? "▾" : "▸"}</span> {ts.length === 1 ? ts[0].line : `${ts.length} steps · ${ts.at(-1)!.line}`}{failed ? <span className="st pen"> · {failed} failed</span> : null}
      </button>
      {open && ts.length > 1 && <ul>{ts.map((t) => <li key={t.id} className={t.failed ? "failed" : ""}>{t.line}</li>)}</ul>}
    </div>
  );
}

function DialogCard({ d, busy, onKeys, onType }: { d: Dialog; busy: boolean; onKeys: (k: string[]) => void; onType: (t: string) => void }) {
  const [answer, setAnswer] = useState("");
  return (
    <div className="chat-dialog">
      <div className="chat-dialog-q">{d.question}</div>
      {d.context && <pre className="chat-dialog-ctx">{d.context}</pre>}
      {d.options.length ? (
        <div className="chat-dialog-opts">
          {d.options.map((o) => (
            <button key={o.n} type="button" className={`btn ${o.current ? "primary" : ""}`} disabled={busy} title={o.detail ?? undefined} onClick={() => onKeys(keysFor(d, o.n))}>
              <kbd>{o.n}</kbd> {o.label}{o.detail && <span className="st dim"> · {o.detail}</span>}
            </button>
          ))}
        </div>
      ) : <pre className="chat-dialog-ctx">{d.screen || "Nothing on screen."}</pre>}
      <form className="reply" onSubmit={(e) => { e.preventDefault(); if (answer.trim()) { onType(answer); setAnswer(""); } }}>
        <input value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Or type an answer into the dialog" />
        <button className="btn" type="submit" disabled={busy || !answer.trim()}>Type</button>
        <button className="btn" type="button" disabled={busy} onClick={() => onKeys(["enter"])}>Enter</button>
        <button className="btn" type="button" disabled={busy} onClick={() => onKeys(["esc"])}>Esc</button>
      </form>
    </div>
  );
}

export function LiveConsole({ pane, status, name, item, extra }: { pane: string; status: Status; name: string; item: string | null; extra?: (send: (t: string) => void) => ReactNode }) {
  const [entries, setEntries] = useState<ChatEntry[] | null>(null);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  const [now, setNow] = useState<Status>(status);
  const [err, setErr] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);

  // Only a new pane starts over. A change of status (it starts working when you send) keeps what's shown, so
  // the conversation doesn't empty and jump to the top; it only changes how often it's read.
  useEffect(() => { setEntries(null); setDialog(null); setPending([]); pinned.current = true; }, [pane]);
  useEffect(() => {
    let live = true;
    const read = async () => {
      const r = await fetch(`/api/agent/chat?pane=${encodeURIComponent(pane)}`).then((x) => x.json()).catch(() => ({ error: "server unreachable" }));
      if (!live) return;
      setErr(r.error ?? null);
      if (r.entries) {
        setEntries(r.entries); setDialog(r.dialog ?? null); setNow(r.status ?? status);
        // What the transcript now has is no longer pending; nor is anything a minute old.
        const said = new Set((r.entries as ChatEntry[]).filter((e) => e.kind === "user").slice(-10).map((e) => e.text.trim()));
        setPending((p) => p.filter((x) => !said.has(x.text.trim()) && Date.now() - x.at < 60_000));
      }
    };
    void read();
    const t = setInterval(read, status === "working" || status === "blocked" ? 1200 : 3000);
    const kick = () => void read();
    window.addEventListener(`cr-read-${pane}`, kick);
    return () => { live = false; clearInterval(t); window.removeEventListener(`cr-read-${pane}`, kick); };
  }, [pane, status]);
  useLayoutEffect(() => { if (ref.current && pinned.current) ref.current.scrollTop = ref.current.scrollHeight; }, [entries, pending, dialog, now]);
  useEffect(() => { if (!note) return; const t = setTimeout(() => setNote(null), 5000); return () => clearTimeout(t); }, [note]);

  const after = () => { pinned.current = true; for (const ms of [300, 900, 2000]) setTimeout(() => window.dispatchEvent(new Event(`cr-read-${pane}`)), ms); };
  const send = async (t: string) => {
    if (!t.trim() || busy) return;
    setBusy(true);
    setPending((p) => [...p, { text: t.trim(), at: Date.now() }]);
    setDraft("");
    const r = await post("/api/agent/send", { pane, text: t.trim(), item });
    setBusy(false);
    if (r.error) {
      setPending((p) => p.filter((x) => x.text !== t.trim()));
      setDraft(t);
      return setNote(`Couldn't send: ${/blocked/.test(r.error) ? "it's at a dialog; answer it above" : r.error}`);
    }
    after();
  };
  const keys = async (k: string[]) => {
    if (!k.length) return;
    setBusy(true);
    const r = await post("/api/agent/keys", { pane, keys: k, item });
    setBusy(false);
    if (r.error) setNote(`Couldn't answer: ${r.error}`);
    after();
  };
  const typeAnswer = async (t: string) => {
    setBusy(true);
    const r = await post("/api/agent/type", { pane, ops: [{ text: t }, { key: "enter" }], item });
    setBusy(false);
    if (r.error) setNote(`Couldn't type: ${r.error}`);
    after();
  };

  const list = entries ?? [];
  const lastTools = list.findLastIndex((e) => e.kind === "tools");
  // A name only where the speaker changes: tool runs between an agent's messages don't count.
  const spoke = list.map((e, i) => { for (let j = i - 1; j >= 0; j--) if (list[j].kind === "user" || list[j].kind === "agent") return list[j].kind !== e.kind; return true; });
  return (
    <div className="live">
      <div className="chat" ref={ref} onScroll={(e) => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
        {err ? <div className="st pen">Can't read this session: {err}</div> : !entries ? <div className="st dim">Reading…</div> : !list.length && !pending.length ? <div className="st dim">Nothing said yet.</div> : null}
        {list.map((e, i) => (
          e.kind === "user" ? <div key={e.id} className="chat-msg you">{spoke[i] && <span className="chat-who">You</span>}<div className="chat-body">{e.text}</div></div>
          : e.kind === "agent" ? <div key={e.id} className="chat-msg agent">{spoke[i] && <span className="chat-who">{name}</span>}<div className="chat-body"><Markdown text={e.text} /></div></div>
          : e.kind === "recap" ? <div key={e.id} className="chat-recap"><b>Recap:</b> {e.text}</div>
          : <Tools key={e.id} e={e} open={i === lastTools && now === "working"} />
        ))}
        {pending.map((p) => <div key={p.at} className="chat-msg you pending"><span className="chat-who">You · sending</span><div className="chat-body">{p.text}</div></div>)}
        {now === "working" && !dialog && <div className="chat-working st dim">{name} is working…</div>}
        {dialog && <DialogCard d={dialog} busy={busy} onKeys={(k) => void keys(k)} onType={(t) => void typeAnswer(t)} />}
      </div>
      <form className="reply" onSubmit={(e) => { e.preventDefault(); void send(draft); }}>
        <textarea rows={Math.min(6, Math.max(1, draft.split("\n").length))} value={draft} onChange={(e) => setDraft(e.target.value)}
          placeholder={dialog ? "Answer the dialog above first" : `Message ${name}… ⏎ sends, ⇧⏎ new line`}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(draft); } }} />
        <button className="btn primary" type="submit" disabled={!draft.trim() || busy}>Send</button>
        {extra?.((t) => void send(t))}
      </form>
      {note && <span className={`st ${note.startsWith("Couldn't") ? "pen" : "dim"}`}>{note}</span>}
    </div>
  );
}
