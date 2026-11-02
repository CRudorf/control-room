// An agent's terminal, live: click it and what the user types goes straight to the session, keystroke by
// keystroke, as in herdr. Below it, a box for a longer message.
import { useEffect, useRef, useState, type ReactNode } from "react";
import { post } from "./actions";

type Status = "blocked" | "done" | "finished" | "working" | "idle" | "unknown";

type Op = { text: string } | { key: string };
const ARROWS: Record<string, string> = { ArrowUp: "up", ArrowDown: "down", ArrowLeft: "left", ArrowRight: "right" };

/** A keystroke as what to write to the pane; null leaves it to the browser (⌘C, ⌘V and the like). */
export function opOf(e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }): Op[] | null {
  if (e.metaKey) return null;
  if (e.ctrlKey) return /^[a-z]$/i.test(e.key) ? [{ key: `ctrl+${e.key.toLowerCase()}` }] : null;
  if (e.key === "Enter") return e.shiftKey ? [{ text: "\\" }, { key: "enter" }] : [{ key: "enter" }]; // Claude's backslash-Enter is a new line
  if (e.key === "Backspace") return [{ key: "backspace" }];
  if (e.key === "Escape") return [{ key: "esc" }];
  if (e.key === "Tab") return [{ key: e.shiftKey ? "shift+tab" : "tab" }];
  if (ARROWS[e.key]) return [{ key: ARROWS[e.key] }];
  if (e.key.length === 1 && !e.altKey) return [{ text: e.key }];
  return null;
}

/** Runs of text joined, so a burst of typing goes as one write. */
export function merge(ops: Op[]): Op[] {
  const out: Op[] = [];
  for (const o of ops) {
    const last = out.at(-1);
    if ("text" in o && last && "text" in last) last.text += o.text;
    else out.push({ ...o });
  }
  return out;
}


export function LiveConsole({ pane, status, name, item, extra }: { pane: string; status: Status; name: string; item: string | null; extra?: (send: (t: string) => void) => ReactNode }) {
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [typing, setTyping] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  const queue = useRef<Op[]>([]);
  const sending = useRef(false);

  useEffect(() => {
    let live = true;
    setText(null);
    pinned.current = true;
    const read = async () => {
      const r = await fetch(`/api/agent/read?pane=${encodeURIComponent(pane)}`).then((x) => x.json()).catch(() => ({ error: "server unreachable" }));
      if (!live) return;
      setErr(r.error ?? null);
      if (r.text !== undefined) setText(r.text.replace(/\s+$/, ""));
    };
    void read();
    const t = setInterval(read, status === "working" ? 1500 : 3000);
    // Right after a send or a keypress, so its effect shows at once.
    const kick = () => void read();
    window.addEventListener(`cr-read-${pane}`, kick);
    return () => { live = false; clearInterval(t); window.removeEventListener(`cr-read-${pane}`, kick); };
  }, [pane, status]);
  useEffect(() => { if (ref.current && pinned.current) ref.current.scrollTop = ref.current.scrollHeight; }, [text]);
  useEffect(() => { if (!note) return; const t = setTimeout(() => setNote(null), 5000); return () => clearTimeout(t); }, [note]);

  const after = () => { setTimeout(() => window.dispatchEvent(new Event(`cr-read-${pane}`)), 400); };
  const send = async (t: string) => {
    if (!t.trim() || busy) return;
    setBusy(true);
    const r = await post("/api/agent/send", { pane, text: t.trim(), item });
    setBusy(false);
    if (r.error) return setNote(`Couldn't send: ${/blocked/.test(r.error) ? "it's at a dialog; answer it in the terminals" : r.error}`);
    setDraft("");
    setNote(`Sent to ${name}`);
    after();
  };
  // Keystrokes go in order, one write at a time; what's typed while one is out goes in the next.
  const pump = async () => {
    if (sending.current || !queue.current.length) return;
    sending.current = true;
    const ops = merge(queue.current.splice(0));
    const r = await post("/api/agent/type", { pane, ops, item });
    sending.current = false;
    if (r.error) { queue.current = []; setNote(`Couldn't type: ${r.error}`); }
    window.dispatchEvent(new Event(`cr-read-${pane}`));
    if (queue.current.length) void pump();
    else after();
  };
  const type = (e: React.KeyboardEvent) => {
    if (e.nativeEvent.isComposing) return;
    const ops = opOf(e);
    if (!ops) return;
    e.preventDefault();
    e.stopPropagation();
    pinned.current = true;
    queue.current.push(...ops);
    void pump();
  };

  const dialog = status === "blocked";
  return (
    <div className="live">
      <div className={`console typeable ${typing ? "typing" : ""}`} ref={ref} tabIndex={0} data-keys="session"
        onFocus={() => setTyping(true)} onBlur={() => setTyping(false)} onKeyDown={type}
        onPaste={(e) => { const t = e.clipboardData.getData("text"); if (t) { e.preventDefault(); queue.current.push({ text: t }); void pump(); } }}
        onScroll={(e) => { const el = e.currentTarget; pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40; }}>
        {err ? `Can't read this session: ${err}` : text ?? "Reading…"}
      </div>
      <span className="st dim typehint">{typing ? "Typing into the session: every key goes to it, esc included. Click outside to stop." : "Click the terminal to type into the session."}</span>
      <form className="reply" onSubmit={(e) => { e.preventDefault(); void send(draft); }}>
        <textarea rows={Math.min(6, Math.max(1, draft.split("\n").length))} value={draft} onChange={(e) => setDraft(e.target.value)}
          placeholder={dialog ? "Click the terminal to answer the dialog" : `Message ${name}… ⏎ sends, ⇧⏎ new line`}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(draft); } }} />
        <button className="btn primary" type="submit" disabled={!draft.trim() || busy}>Send</button>
        {extra?.((t) => void send(t))}
      </form>
      {note && <span className={`st ${note.startsWith("Couldn't") ? "pen" : "dim"}`}>{note}</span>}
    </div>
  );
}
