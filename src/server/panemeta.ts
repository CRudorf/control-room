// What the board knows, shown inside herdr: each agent's pane carries its work item and whose turn
// it is as display tokens ($item, $ball, $next in herdr's sidebar rows), and two files give the
// tab bar a status line and a home pane the board as text (`bun run board`).
import { writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import type { Lane, WorkItem } from "../shared/types";
import { STATE_DIR } from "./config";
import { requestFor } from "./herdr";

export const STATUS_PATH = join(STATE_DIR, "herdr-status.txt");
export const BOARD_PATH = join(STATE_DIR, "board.txt");

const BALL: Record<Lane, string> = { mine: "my turn", waiting: "waiting", asked: "review", parked: "parked" };
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

export type PaneTokens = { item: string | null; ball: string; next: string | null };

/** Each agent pane's tokens, from the work item it belongs to. An agent that is its own work item has no item token: its tab label already names it. */
export function paneTokens(items: WorkItem[]): Map<string, PaneTokens> {
  const out = new Map<string, PaneTokens>();
  for (const it of items) for (const a of it.agents) {
    out.set(a.pane, { item: it.keyKind === "agent" ? null : clip(it.key, 24), ball: BALL[it.lane], next: it.next ? `next ${it.next.rank}` : null });
  }
  return out;
}

/** One line for herdr's tab bar: how many work items are in each of the three lanes. */
export function statusLine(items: WorkItem[]): string {
  const n = (l: Lane) => items.filter((it) => it.lane === l).length;
  return `my turn ${n("mine")} · waiting on others ${n("waiting")} · asked of me ${n("asked")}`;
}

/** The board as plain text, lane by lane in board order, for a narrow pane. */
export function boardText(items: WorkItem[], at: Date): string {
  const lanes: [Lane, string][] = [["mine", "MY TURN"], ["asked", "ASKED OF ME"], ["waiting", "WAITING ON OTHERS"], ["parked", "PARKED"]];
  const lines = [`control room · as of ${at.toTimeString().slice(0, 5)}`];
  for (const [lane, head] of lanes) {
    const its = items.filter((it) => it.lane === lane);
    if (!its.length) continue;
    lines.push("", `${head} ${its.length}`);
    for (const it of lane === "parked" ? its.slice(0, 5) : its) {
      const mark = it.next ? String(it.next.rank).padStart(2) : " ·";
      const agents = it.agents.length ? ` [${it.agents.map((a) => a.status[0]).join("")}]` : "";
      lines.push(`${mark} ${it.key}${agents}  ${it.title}`, `     ${it.why}`);
    }
    if (lane === "parked" && its.length > 5) lines.push(`   +${its.length - 5} more`);
  }
  return lines.join("\n") + "\n";
}

const SOURCE = "control-room";
// What each pane was last told, and when, so a publish only writes what changed; every pane is
// told again before its tokens' time to live runs out.
const told = new Map<string, { key: string; at: number }>();
const TTL = 15 * 60_000, AGAIN = 5 * 60_000;
let seq = Date.now();

export async function reportPanes(items: WorkItem[]) {
  const now = Date.now(), want = paneTokens(items);
  for (const [pane, t] of want) {
    const key = JSON.stringify(t), was = told.get(pane);
    if (was && was.key === key && now - was.at < AGAIN) continue;
    told.set(pane, { key, at: now });
    await requestFor(pane, "pane.report_metadata", (id) => ({ pane_id: id, source: SOURCE, seq: ++seq, ttl_ms: TTL, tokens: t }))
      .catch(() => told.delete(pane));
  }
  for (const pane of [...told.keys()]) if (!want.has(pane)) told.delete(pane);
}

const atomic = (path: string, text: string) => { writeFileSync(path + ".tmp", text); renameSync(path + ".tmp", path); };

export function writeHerdrFiles(items: WorkItem[]) {
  try {
    atomic(STATUS_PATH, statusLine(items) + "\n");
    atomic(BOARD_PATH, boardText(items, new Date()));
  } catch { /* a full disk shouldn't stop the board */ }
}
