// Jira on the board: a work item's issue status, the move its PRs call for, and the Slack review ask.
import { useState } from "react";
import type { Suggested, WorkItem } from "../shared/types";
import { Confirm, post, toast } from "./actions";
import { Sheet } from "./lists";

const short = (repo: string) => repo.split("/").pop()!;

/** Moving an issue is visible to the team, so it goes through a preview sheet. */
export function MoveJiraSheet({ item, s, onClose }: { item: string | null; s: Suggested; onClose: () => void }) {
  return (
    <Confirm title={`Move ${s.key} to ${s.to}`} label="Move" onClose={onClose}
      who={`${s.key} is ${s.from} in the tracker; ${s.why}. Everyone watching the issue sees the change.`}
      go={async () => {
        const r = await post("/api/jira/transition", { item, key: s.key, to: s.to });
        toast(r.error ? `Couldn't move ${s.key}: ${r.error}` : `${s.key} moved to ${s.to}`);
      }} />
  );
}

/** The Slack review ask, in the user's voice: a short clause for what it's for, the link, and room for his context. */
export function askText(it: WorkItem): string {
  const prs = it.prs.filter((p) => p.role === "mine" && !p.draft);
  const repos = [...new Set(prs.map((p) => short(p.repo)))];
  const what = it.title.replace(/\.$/, "").toLowerCase();
  const opener = prs.length === 1
    ? `I've got a ${repos[0]} PR up and would appreciate a review related to ${what}: ${prs[0].url}`
    : `I've got ${prs.length === 2 ? "a couple" : "a few"}${repos.length === 1 ? ` ${repos[0]}` : ""} PRs up and would appreciate a review related to ${what}:\n${prs.map((p) => p.url).join("\n")}`;
  return `${opener}\n\ncontext: \n\nif there's already a standard way to do this, or you'd do it differently, very happy to change the approach and follow that instead.`;
}

export function AskSheet({ it, onClose }: { it: WorkItem; onClose: () => void }) {
  const [text, setText] = useState(() => askText(it));
  const copy = async () => {
    const r = await post("/api/ask", { item: it.id, text });
    toast(r.error ? `Couldn't copy: ${r.error}` : "Review ask copied; paste it in Slack");
    if (!r.error) onClose();
  };
  return (
    <Sheet title={`Ask for a review of ${it.key}`} onClose={onClose}>
      <textarea className="field ask" autoFocus value={text} rows={Math.min(16, 8 + it.prs.length)} onChange={(e) => setText(e.target.value)}
        onFocus={(e) => { const i = text.indexOf("context: ") + 9; e.currentTarget.setSelectionRange(i, i); }}
        onKeyDown={(e) => { if (e.key === "Enter" && e.metaKey) { e.preventDefault(); void copy(); } }} />
      <p className="st dim" style={{ margin: "8px 0 0" }}>Fill in context: why the change is needed, in plain words. Nothing is sent; it goes to your clipboard.</p>
      <div className="row"><button className="btn" onClick={onClose}>Cancel</button><button className="btn primary" onClick={() => void copy()}>Copy for Slack <kbd>⌘⏎</kbd></button></div>
    </Sheet>
  );
}
