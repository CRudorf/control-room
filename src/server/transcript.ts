// A session as a conversation, from its transcript: what the user said, what the agent said, and a line per
// tool it ran. The control room draws it in its own skin instead of showing the terminal. A dialog the agent
// is waiting at (a permission prompt, a question) isn't in the transcript, so it's read off the screen.
import type { ChatEntry, Dialog } from "../shared/types";

const text = (c: unknown): string => typeof c === "string" ? c : Array.isArray(c) ? c.filter((b) => b?.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n") : "";
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const base = (p: unknown) => (typeof p === "string" ? p.split("/").filter(Boolean).slice(-2).join("/") : "");

/** One line for a tool call: what it ran, read, changed or asked. */
export function toolLine(name: string, input: any): string {
  const i = input ?? {};
  const first = (s: unknown) => (typeof s === "string" ? s.split("\n")[0] : "");
  const what =
    name === "Bash" ? first(i.description) || first(i.command)
    : ["Read", "Edit", "Write", "NotebookEdit", "MultiEdit"].includes(name) ? base(i.file_path ?? i.notebook_path)
    : name === "Grep" || name === "Glob" ? `${i.pattern ?? ""}${i.path ? ` in ${base(i.path)}` : ""}`
    : name === "Agent" || name === "Task" ? first(i.description)
    : name === "Skill" ? `/${i.skill ?? ""}`
    : name === "WebFetch" || name === "WebSearch" ? first(i.url ?? i.query)
    : name === "AskUserQuestion" ? first(i.questions?.[0]?.question)
    : first(i.description ?? i.prompt ?? i.query ?? "");
  return clip(`${name.replace(/^mcp__[^_]+(__)?/, "").replace(/^mcp__/, "")}${what ? `: ${what}` : ""}`, 140);
}

/** What the user typed, minus the harness's wrappers; null for what isn't the user talking. */
function userText(e: any): string | null {
  if (e.isMeta || e.isCompactSummary) return null;
  const t = text(e.message?.content).replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
  if (!t) return null;
  const cmd = t.match(/<command-name>([^<]*)<\/command-name>[\s\S]*?(?:<command-args>([^<]*)<\/command-args>)?/);
  if (cmd) return `${cmd[1].trim()}${cmd[2]?.trim() ? ` ${cmd[2].trim()}` : ""}`;
  if (t.startsWith("<")) return null;
  return t;
}

/** The conversation in a transcript's lines, oldest first, the last `max` entries. Tool calls in a row group. */
export function entriesOf(jsonl: string, max = 300): ChatEntry[] {
  const out: ChatEntry[] = [];
  for (const l of jsonl.split("\n")) {
    if (!l.trim()) continue;
    let e: any;
    try { e = JSON.parse(l); } catch { continue; }
    const at = e.timestamp ?? null, id = e.uuid ?? `${out.length}`;
    if (e.type === "system" && e.subtype === "away_summary" && typeof e.content === "string") out.push({ id, kind: "recap", text: e.content, at });
    if (e.type === "user") {
      const t = userText(e);
      if (t) out.push({ id, kind: "user", text: t, at });
      // A tool that failed marks its line.
      const c = e.message?.content;
      if (Array.isArray(c)) for (const b of c) if (b?.type === "tool_result" && b.is_error) {
        const last = out.at(-1);
        if (last?.kind === "tools") { const t = last.tools!.find((x) => x.id === b.tool_use_id); if (t) t.failed = true; }
      }
    }
    if (e.type === "assistant") {
      for (const b of Array.isArray(e.message?.content) ? e.message.content : []) {
        if (b?.type === "text" && b.text?.trim()) {
          const last = out.at(-1);
          if (last?.kind === "agent") last.text += `\n\n${b.text.trim()}`;
          else out.push({ id: `${id}:${out.length}`, kind: "agent", text: b.text.trim(), at });
        }
        if (b?.type === "tool_use") {
          const last = out.at(-1), t = { id: b.id ?? "", line: toolLine(b.name ?? "tool", b.input) };
          if (last?.kind === "tools") last.tools!.push(t);
          else out.push({ id: `${id}:${out.length}`, kind: "tools", text: "", at, tools: [t] });
        }
      }
    }
  }
  return out.slice(-max);
}

const BOX = /[│┃╭╮╰╯─━┌┐└┘]/g;
const OPTION = /^\s*(❯|›|>)?\s*(\d{1,2})[.)]\s+(.+?)\s*$/;

/**
 * The dialog on a screen, if the session is at one: the question and its numbered options, and which is
 * picked now. null when the screen has no numbered options near its end.
 */
export function dialogOf(screen: string): Dialog | null {
  const lines = screen.replace(/\r/g, "").split("\n").map((l) => l.replace(BOX, " ").replace(/\s+$/, ""));
  const end = lines.length;
  let last = -1;
  for (let i = end - 1; i >= Math.max(0, end - 40); i--) if (OPTION.test(lines[i])) { last = i; break; }
  if (last < 0) return null;
  // Walk up through options and their indented descriptions to the first option.
  let first = last;
  for (let i = last - 1; i >= Math.max(0, last - 40); i--) {
    if (OPTION.test(lines[i])) { first = i; continue; }
    if (!lines[i].trim()) { if (i > 0 && OPTION.test(lines[i - 1])) continue; break; }
    if (/^\s{3,}\S/.test(lines[i]) && lines.slice(Math.max(0, i - 6), i).some((l) => OPTION.test(l))) continue;
    break;
  }
  const options: Dialog["options"] = [];
  for (let i = first; i <= last; i++) {
    const m = lines[i].match(OPTION);
    if (m) options.push({ n: Number(m[2]), label: m[3], detail: null, current: !!m[1] });
    else if (lines[i].trim() && options.length) { const o = options.at(-1)!; o.detail = o.detail ? `${o.detail} ${lines[i].trim()}` : lines[i].trim(); }
  }
  if (options.length < 2 || options.some((o, k) => o.n !== k + 1)) return null;
  // The question: the text above the options, back to a blank line after some text, or a rule.
  const above: string[] = [];
  for (let i = first - 1; i >= Math.max(0, first - 14); i--) {
    const t = lines[i].trim();
    if (!t) { if (above.length) break; continue; }
    if (/^[-═=]{4,}$/.test(t)) break;
    above.unshift(t);
  }
  const context: string[] = [];
  for (let i = first - above.length - 2; i >= Math.max(0, first - 24) && context.length < 6; i--) {
    const t = lines[i]?.trim();
    if (!t) { if (context.length) break; continue; }
    if (/^[-═=]{4,}$/.test(t)) break;
    context.unshift(t);
  }
  if (!options.some((o) => o.current)) options[0].current = true;
  return { question: above.join(" ") || "The session is waiting on a choice.", context: context.join("\n") || null, options, screen: lines.slice(Math.max(0, first - 16)).join("\n").trim() };
}
