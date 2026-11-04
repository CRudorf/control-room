// What an agent last said, from its session transcript: its recap (Claude Code's away summary) and the
// text of its last turn, everything it wrote since the user's last message. The World shows these when
// the user talks to an agent.
import { closeSync, openSync, readSync, statSync } from "node:fs";
import type { Agent, ChatEntry } from "../shared/types";
import { transcriptPath } from "./tasks";
import { entriesOf } from "./transcript";

export type Turn = { recap: string | null; recapAt: string | null; turn: string | null; at: string | null };

const text = (c: unknown): string => typeof c === "string" ? c : Array.isArray(c) ? c.filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n") : "";

/** The recap and last turn in a transcript's lines. The turn is cut to its last `max` characters. */
export function lastTurn(jsonl: string, max = 2400): Turn {
  let recap: string | null = null, recapAt: string | null = null, at: string | null = null;
  const said: string[] = [];
  for (const l of jsonl.split("\n")) {
    if (!l.trim()) continue;
    let e: any;
    try { e = JSON.parse(l); } catch { continue; }
    if (e.type === "system" && e.subtype === "away_summary" && typeof e.content === "string") { recap = e.content; recapAt = e.timestamp ?? null; }
    // A message the user typed starts a new turn; tool results don't.
    if (e.type === "user" && !e.isMeta && text(e.message?.content).trim() && !String(text(e.message?.content)).startsWith("<")) said.length = 0;
    if (e.type === "assistant") { const t = text(e.message?.content).trim(); if (t) { said.push(t); at = e.timestamp ?? at; } }
  }
  const all = said.join("\n\n");
  return { recap, recapAt, turn: all ? (all.length > max ? `…${all.slice(-max)}` : all) : null, at: all ? at : null };
}

/** The session as a conversation (transcript.ts), from the end of its transcript. */
export function agentChat(a: Pick<Agent, "session" | "cwd">): ChatEntry[] {
  const path = transcriptPath(a);
  if (!path) return [];
  try { return entriesOf(tail(path, 1536 * 1024)); } catch { return []; }
}

/** The end of a file: enough for the last few turns without reading a long session whole. */
function tail(path: string, bytes = 512 * 1024): string {
  const size = statSync(path).size, from = Math.max(0, size - bytes), buf = Buffer.alloc(size - from);
  const fd = openSync(path, "r");
  try { readSync(fd, buf, 0, buf.length, from); } finally { closeSync(fd); }
  const s = buf.toString("utf8");
  return from ? s.slice(s.indexOf("\n") + 1) : s;
}

export type Pr = { repo: string; number: number; title: string };
/**
 * A PR number in what an agent said, followed by its title, so "fixed #1584" says what #1584 is. Each PR once;
 * a bare number only when one PR on the board has it, `repo#n` when the repo matches.
 */
export function withTitles(text: string, prs: Pr[]): string {
  const done = new Set<string>();
  return text.replace(/(\b[\w.-]+)?#(\d{1,6})\b(?! \()/g, (m, repo: string | undefined, n: string) => {
    const hits = prs.filter((p) => p.number === Number(n) && (!repo || p.repo.split("/").pop() === repo));
    if (hits.length !== 1) return m;
    const p = hits[0], key = `${p.repo}#${p.number}`;
    if (done.has(key)) return m;
    done.add(key);
    const title = p.title.replace(/^\[?[A-Z][A-Z0-9]+-\d+\]?:?\s*/, "");
    return `${m} (${title.length > 60 ? `${title.slice(0, 59)}…` : title})`;
  });
}

export function agentTurn(a: Pick<Agent, "session" | "cwd">): Turn {
  const path = transcriptPath(a);
  if (!path) return { recap: null, recapAt: null, turn: null, at: null };
  try { return lastTurn(tail(path)); } catch { return { recap: null, recapAt: null, turn: null, at: null }; }
}
