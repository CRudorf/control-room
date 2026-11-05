import { CLAUDE_DIR } from "./repos";
import { dirInProject } from "./repos";
// Tidy: every herdr tab, how stale it is, and closing the ones the user picks.
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { processTree, treeMb } from "./health";
import { homedir } from "node:os";
import { join } from "node:path";
import type { TidyTab, WorkItem } from "../shared/types";
import { DEV } from "./config";
import { db } from "./db";
import { note } from "./runner";
import { request } from "./herdr";

const SHELLS = new Set(["zsh", "bash", "fish", "sh", "-zsh", "-bash"]);
const DAY = 24 * 3600_000;
const projects = join(CLAUDE_DIR, "projects");

// When a Claude session last did real work: its transcript's last user or assistant entry.
// The file's mtime won't do; idle sessions keep appending system entries (away summaries).
const transcriptCache = new Map<string, string | null>();
const activeCache = new Map<string, { mtime: number; at: string | null }>();
export function lastActive(session: string | null): string | null {
  if (!session) return null;
  let path = transcriptCache.get(session);
  if (path === undefined) {
    path = [...new Bun.Glob(`*/${session}.jsonl`).scanSync({ cwd: projects, absolute: true })][0] ?? null;
    transcriptCache.set(session, path);
  }
  if (!path) return null;
  try {
    const st = statSync(path);
    const hit = activeCache.get(path);
    if (hit && hit.mtime === st.mtimeMs) return hit.at;
    const fd = openSync(path, "r");
    const len = Math.min(st.size, 512 * 1024);
    const buf = Buffer.alloc(len);
    readSync(fd, buf, 0, len, st.size - len);
    closeSync(fd);
    let at: string | null = null;
    for (const line of buf.toString("utf8").split("\n").reverse()) {
      if (!line.startsWith("{")) continue;
      try {
        const e = JSON.parse(line);
        if ((e.type === "user" || e.type === "assistant") && !e.isMeta && e.timestamp) { at = e.timestamp; break; }
      } catch {}
    }
    activeCache.set(path, { mtime: st.mtimeMs, at });
    return at;
  } catch { return null; }
}

export async function listTabs(items: WorkItem[]): Promise<TidyTab[]> {
  const { snapshot: s } = await request("session.snapshot");
  const tree = await processTree();
  const workspaces = new Map<string, any>(s.workspaces.map((w: any) => [w.workspace_id, w]));
  const owner = new Map<string, WorkItem>();
  for (const it of items) for (const a of it.agents) owner.set(a.pane, it);

  const tabs: TidyTab[] = [];
  for (const t of s.tabs) {
    // A tab goes on this project's list only when a pane of it works in this project.
    if (!s.panes.some((p: any) => p.tab_id === t.tab_id && dirInProject(p.foreground_cwd || p.cwd || ""))) continue;
    const panes: TidyTab["panes"] = [];
    for (const p of s.panes.filter((p: any) => p.tab_id === t.tab_id)) {
      const info = await request("pane.process_info", { pane_id: p.pane_id }).catch(() => null);
      const mb = info?.process_info?.shell_pid ? treeMb(info.process_info.shell_pid, tree) : 0;
      if (p.agent === "claude") {
        const it = owner.get(p.pane_id);
        panes.push({ mb,
          pane: p.pane_id, kind: "claude", status: p.agent_status, title: p.terminal_title_stripped ?? "",
          cwd: p.foreground_cwd || p.cwd, session: p.agent_session?.value ?? null, lastActive: lastActive(p.agent_session?.value ?? null),
          item: it ? { id: it.id, key: it.key, openPrs: it.prs.length } : null,
        });
      } else {
        const procs = info?.process_info?.foreground_processes ?? [];
        const idle = procs.length > 0 && procs.every((x: any) => SHELLS.has(x.name) || SHELLS.has(x.argv0));
        panes.push({ mb,
          pane: p.pane_id, kind: idle ? "shell" : "other", status: idle ? "idle" : "running",
          title: idle ? "shell" : procs.map((x: any) => x.cmdline).join(" ") || p.terminal_title_stripped || "running",
          cwd: p.foreground_cwd || p.cwd, session: null, lastActive: null, item: null,
        });
      }
    }
    const times = panes.map((p) => p.lastActive).filter(Boolean) as string[];
    const last = times.sort().at(-1) ?? null;
    const quiet = panes.every((p) => p.kind === "shell" || (p.kind === "claude" && (p.status === "idle" || p.status === "done")));
    const attached = panes.some((p) => p.item && p.item.openPrs > 0);
    const stale = !last || Date.now() - Date.parse(last) > DAY;
    tabs.push({
      tab: t.tab_id, label: t.label, workspace: workspaces.get(t.workspace_id)?.label ?? t.workspace_id,
      focused: !!t.focused, panes, lastActive: last, mb: panes.reduce((a, p) => a + p.mb, 0),
      // Suggested for closing: nothing running, no open PR depends on it, quiet for a day.
      suggest: quiet && !attached && stale && !t.focused && panes.some((p) => p.kind === "claude"),
    });
  }
  return tabs.sort((a, b) => (a.lastActive ?? "").localeCompare(b.lastActive ?? ""));
}


/** Closes tabs, recording each one's sessions so they can be resumed with `claude --resume`. */
export async function closeTabs(ids: string[], tabs: TidyTab[]) {
  const results: { tab: string; ok: boolean; error?: string }[] = [];
  for (const id of ids) {
    const t = tabs.find((x) => x.tab === id);
    try {
      if (!DEV) await request("tab.close", { tab_id: id }); // dev only records (ADR 0005)
      results.push({ tab: id, ok: true });
    } catch (e) {
      results.push({ tab: id, ok: false, error: (e as Error).message });
    }
    const resume = t?.panes.filter((p) => p.session).map((p) => `cd '${p.cwd}' && claude --resume ${p.session}`) ?? [];
    note({ item: t?.panes.find((p) => p.item)?.item?.id ?? null, trigger: "tidy" }, "close-tab", `${t?.workspace} / ${t?.label}`,
      results.at(-1)!.ok ? (DEV ? "dry run" : "closed") : `failed: ${results.at(-1)!.error}`, { detail: { tab: t, resume } });
  }
  return results;
}

/** Recently closed tabs and how to bring their sessions back. */
export function closedTabs(limit = 50) {
  return db.query<{ at: string; sent: string; result: string; detail: string }, [number]>(
    "SELECT at, sent, result, detail FROM action_records WHERE action IN ('close-tab', 'close-pane') ORDER BY id DESC LIMIT ?").all(limit)
    .map((r) => ({ at: r.at, label: r.sent, result: r.result, resume: (JSON.parse(r.detail).resume ?? []) as string[] }));
}

/** Everything the control room has recorded, newest first. */
/**
 * A page of the action record, newest first: `limit` records older than id `before`, of one action or all.
 * With every action there is and how many of each, so a filter reaches the whole record, not just this page.
 */
export function history({ before = null, action = null, limit = 200 }: { before?: number | null; action?: string | null; limit?: number } = {}) {
  const rows = db.query<{ id: number; at: string; work_item: string | null; action: string; trigger: string | null; sent: string | null; result: string | null; detail: string | null; dry_run: number }, [number, string | null, number]>(
    "SELECT id, at, work_item, action, trigger, sent, result, detail, dry_run FROM action_records WHERE id < ?1 AND (?2 IS NULL OR action = ?2) ORDER BY id DESC LIMIT ?3")
    .all(before ?? Number.MAX_SAFE_INTEGER, action, limit);
  const kinds = db.query<{ action: string; n: number }, []>("SELECT action, count(*) AS n FROM action_records GROUP BY action ORDER BY n DESC").all();
  return {
    entries: rows.map((r) => ({
      id: r.id, at: r.at, item: r.work_item, action: r.action, trigger: r.trigger, label: r.sent, result: r.result, dryRun: !!r.dry_run,
      resume: (r.detail ? (JSON.parse(r.detail).resume ?? []) : []) as string[],
    })),
    kinds,
    total: kinds.reduce((n, k) => n + k.n, 0),
  };
}
