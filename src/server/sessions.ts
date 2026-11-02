// Sessions: every Claude session herdr is running, with or without a work item. A session with
// none belongs to its repo, so the one improving the control room shows as control-room.
import type { Session, WorkItem } from "../shared/types";
import { db } from "./db";
import { herdrState } from "./herdr";
import { lastActive } from "./tidy";
import { usd, type Turn } from "./tokens";
import { isFinished } from "./workitems";

const turnsOf = db.query<Turn, [string]>("SELECT * FROM usage_turns WHERE session = ?");

function spend(session: string | null) {
  if (!session) return null;
  const turns = turnsOf.all(session);
  if (!turns.length) return null;
  return {
    tokens: turns.reduce((a, t) => a + t.input + t.output + t.read + t.write5m + t.write1h, 0),
    usd: turns.reduce((a, t) => a + usd(t), 0),
    since: turns.reduce((a, t) => (t.at < a ? t.at : a), turns[0].at),
  };
}

export function sessions(items: WorkItem[]): Session[] {
  const owner = new Map<string, WorkItem>();
  for (const it of items) for (const a of it.agents) owner.set(a.pane, it);
  return herdrState().agents.map((a) => {
    const it = owner.get(a.pane);
    return {
      pane: a.pane, workspace: a.workspaceLabel, label: a.label, title: a.title,
      status: a.status === "blocked" ? "blocked" : isFinished(a) ? "finished" : a.status === "working" ? "working" : "idle",
      repo: a.repo, branch: a.branch, cwd: a.cwd, session: a.session,
      item: it ? { id: it.id, key: it.key, title: it.title } : null,
      lastActive: lastActive(a.session), spend: spend(a.session),
    };
  });
}
