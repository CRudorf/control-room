import { AnimatePresence, LayoutGroup, motion, MotionConfig } from "motion/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Agent, Cell, HandoffTask, Lane, LoopView, PrRow, Snapshot, Suggested, WorkItem } from "../shared/types";
import { useFeed } from "./feed";
import { act, Confirm, PrActions, RerequestSheet, Threads, toast } from "./actions";
import { ChartButton, useVisuals, VisualStrip } from "./visuals";
import { VerifyStrip } from "./verify";
import { workLines } from "../shared/branches";
import { Cleanup } from "./cleanup";
import { StartAgent } from "./handoff";
import { Curate } from "./review";
import { EffortSheet, DependencySheet, MoveSheet, ParkSheet, Removed, RemoveSheet } from "./lists";
import { StartBox } from "./start";
import { AskSheet, MoveJiraSheet } from "./jira";
import { RunSheet } from "./run";
import { AwsSession } from "./aws";
import { History, Tidy } from "./tidy";
import { Sessions } from "./sessions";
import { LiveConsole } from "./console";
import { Metrics, tok } from "./metrics";
import { handledKey, NextQueue, nudgeId, nudgeKey } from "./next";
import { PickupSheet, useSuggestions } from "./suggestions";
import { Docs, useDocsCount } from "./docs";
import type { Suggestion } from "../shared/types";
import { branchLine } from "../shared/branches";

const LANES: { k: Lane; t: string; hc: string; sc: string }[] = [
  { k: "mine", t: "My turn", hc: "--h-mine", sc: "--s-mine" },
  { k: "waiting", t: "Waiting on others", hc: "--h-wait", sc: "--s-wait" },
  { k: "asked", t: "Asked of me", hc: "--h-ask", sc: "--s-ask" },
  { k: "parked", t: "Parked", hc: "--h-park", sc: "--s-park" },
];
const LANE = Object.fromEntries(LANES.map((l) => [l.k, l])) as Record<Lane, (typeof LANES)[number]>;
const laneVars = (l: Lane) => ({ "--sc": `var(${LANE[l].sc})`, "--hc": `var(${LANE[l].hc})` }) as React.CSSProperties;
const spring = { type: "spring", stiffness: 420, damping: 34, mass: 0.8 } as const;
const short = (repo: string) => repo.split("/").pop()!;
const num = (p: PrRow) => `${short(p.repo)}#${p.number}`;

const M = 60_000, H = 60 * M, D = 24 * H;
function ago(iso: string | null): string {
  if (!iso) return "never";
  const d = Date.now() - Date.parse(iso);
  if (d < H) return Math.max(1, Math.round(d / M)) + "m";
  if (d < D) return Math.round(d / H) + "h";
  if (d < 30 * D) return Math.round(d / D) + "d";
  return Math.round(d / (30 * D)) + "mo";
}

function stored<T>(k: string, fallback: T): T {
  try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
function store(k: string, v: unknown) {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch {}
}

type Theme = "system" | "light" | "dark";
type SheetKind = "park" | "remove" | "dependency" | "move" | "ask" | "effort";
type Group = { key: string; title: string; lane?: Lane; collapsed?: boolean; items: (WorkItem & { _group?: string; _also?: string[] })[] };

type Page = "work" | "sessions" | "metrics" | "docs" | "tidy" | "history" | "removed" | "cleanup";
/** The pages in the nav strip. */
const NAV: { p: Page; label: string; k: string; title: string }[] = [
  { p: "work", label: "Work", k: "esc", title: "Your work items" },
  { p: "sessions", label: "Sessions", k: "c", title: "Every Claude session in herdr, work item or not" },
  { p: "metrics", label: "Metrics", k: "i", title: "Output and friction, week by week" },
  { p: "docs", label: "Docs", k: "d", title: "Glossary, ADRs, statecharts and visuals" },
];
/** The pages in the menu: used less often. */
const MORE: { p: Page; label: string; k: string; title: string }[] = [
  { p: "tidy", label: "Tidy", k: "t", title: "Close idle herdr tabs" },
  { p: "cleanup", label: "Cleanup", k: "u", title: "Worktrees and runs that work left behind" },
  { p: "history", label: "History", k: "h", title: "Everything the control room did" },
  { p: "removed", label: "Removed", k: "e", title: "The editable remove list" },
];
const PAGE_KEYS: Record<string, Page> = { c: "sessions", i: "metrics", d: "docs", t: "tidy", h: "history", e: "removed", u: "cleanup" };

export function App() {
  const { snap, status, refresh } = useFeed();
  const items = snap?.items ?? [];
  const [sel, setSel] = useState<string | null>(() => location.pathname.match(/^\/item\/(.+)/)?.[1] ?? null);
  const [laneFilter, setLaneFilter] = useState<Set<Lane>>(new Set());
  const [groupBy, setGroupBy] = useState<"lane" | "repo" | "effort">(() => stored("cr-group", "lane"));
  const [q, setQ] = useState("");
  const [focus, setFocus] = useState(false);
  // A detail pane taking the whole work area; null is the default view.
  const [wide, setWide] = useState<Wide | null>(null);
  // One page at a time. A notification about a shipped PR opens Metrics, where Accomplished shows its watch.
  const [page, setPage] = useState<Page>(() => new URLSearchParams(location.search).has("shipped") ? "metrics" : "work");
  const [menu, setMenu] = useState(false);
  const go = (p: Page) => { setPage((cur) => (cur === p ? "work" : p)); setMenu(false); };
  const open = (p: Page) => { setPage(p); setMenu(false); };
  const tidy = page === "tidy", ses = page === "sessions", hist = page === "history", rem = page === "removed", doc = page === "docs", met = page === "metrics";
  const back = () => setPage("work");
  const docsDue = useDocsCount();
  const [parkOpen, setParkOpen] = useState(false);
  const [sheet, setSheet] = useState<{ kind: SheetKind; it: WorkItem } | null>(null);
  const [finOpen, setFinOpen] = useState(false);
  // The Start box, with what to prefill and what to run once it started something.
  const [startBox, setStartBox] = useState<{ text: string; context?: string; done?: () => void } | null>(null);
  const [jiraMove, setJiraMove] = useState<{ item: string | null; s: Suggested } | null>(null);
  const [picking, setPicking] = useState<Suggestion | null>(null);
  const [reviewing, setReviewing] = useState<{ it: WorkItem; done?: () => void } | null>(null);
  const [help, setHelp] = useState(false);
  // `done` runs once the action really happened; Next mode uses it to move on.
  const [starting, setStarting] = useState<{ it: WorkItem; kind?: HandoffTask["kind"]; pr?: string; done?: () => void } | null>(null);
  const [rerequesting, setRerequesting] = useState<{ it: WorkItem; p: PrRow; done?: () => void } | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  useEffect(() => { if (toast) { const t = setTimeout(() => setToast(null), 6000); return () => clearTimeout(t); } }, [toast]);
  useEffect(() => {
    const on = (e: Event) => setToast((e as CustomEvent<string>).detail);
    window.addEventListener("cr-toast", on);
    return () => window.removeEventListener("cr-toast", on);
  }, []);
  const primary = useCallback((it: WorkItem, done?: () => void) => {
    const pa = it.primary;
    const p = it.prs.find((x) => `${x.repo}#${x.number}` === pa.pr);
    if (pa.handoff) setStarting({ it, kind: pa.handoff, pr: pa.pr, done });
    else if (pa.start) setStartBox({ text: pa.start, context: pa.startContext, done });
    else if (pa.run) setReviewing({ it, done });
    else if (pa.act === "rerequest" && p) setRerequesting({ it, p, done });
    // Curating is done when the review is posted and the drafts leave the queue on their own.
    else if (pa.act === "curate") document.getElementById("drafts")?.scrollIntoView({ behavior: "smooth", block: "start" });
    else if (pa.act === "replies") document.getElementById("threads")?.scrollIntoView({ behavior: "smooth", block: "start" });
    else if (pa.act && pa.pr) void act(it, pa.pr, pa.act, {}, "primary").then((ok) => ok && done?.());
    else { runPrimary(it); done?.(); }
  }, []);
  const [theme, setTheme] = useState<Theme>(() => stored("cr-theme", "system"));
  const [seen, setSeen] = useState<Record<string, string> | null>(() => stored("cr-seen", null));
  const qRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (theme === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
    store("cr-theme", theme);
  }, [theme]);
  useEffect(() => store("cr-group", groupBy), [groupBy]);

  // First run: everything already on the board counts as seen.
  useEffect(() => {
    if (snap && seen === null) setSeen(Object.fromEntries(snap.items.map((i) => [i.id, i.updated])));
  }, [snap, seen]);
  useEffect(() => { if (seen) store("cr-seen", seen); }, [seen]);

  const select = useCallback((id: string) => {
    setSel(id);
    history.replaceState(null, "", `/item/${id}`);
  }, []);
  const selected = items.find((i) => i.id === sel) ?? null;
  useEffect(() => {
    if (selected && seen && seen[selected.id] !== selected.updated) setSeen({ ...seen, [selected.id]: selected.updated });
  }, [selected, seen]);
  useEffect(() => { if (!selected && items.length && !sel) setSel(items[0].id); }, [items, selected, sel]);

  // Next mode: the current card, held while it's on screen even if it leaves the queue; done and
  // skipped items stay out until their next action changes.
  const sugs = useSuggestions(snap?.polledAt ?? null);
  // Next mode's last step: the top suggestion the link check left free (or hasn't judged yet).
  const topFree = sugs.view?.suggestions.find((x) => x.verdict === "free" || x.verdict === null) ?? null;
  const [nextMode, setNextMode] = useState(false);
  const [handled, setHandled] = useState<Set<string>>(new Set());
  const [cur, setCur] = useState<string | null>(null);
  const queue = useMemo(() => items.filter((i) => i.next && !handled.has(handledKey(i))).sort((a, b) => a.next!.rank - b.next!.rank), [items, handled]);
  // Stale-wait nudges come after every work item: they're the only step about someone else's turn.
  const nudges = useMemo(() => (snap?.nudges ?? []).filter((n) => !handled.has(nudgeKey(n))), [snap, handled]);
  const nextIds = useMemo(() => [...queue.map((i) => i.id), ...nudges.map(nudgeId)], [queue, nudges]);
  const curItem = nextMode ? items.find((i) => i.id === cur) ?? null : null;
  const curNudge = nextMode ? nudges.find((n) => nudgeId(n) === cur) ?? null : null;
  useEffect(() => { if (nextMode && !curItem && !curNudge && nextIds.length) setCur(nextIds[0]); }, [nextMode, curItem, curNudge, nextIds]);
  const shown = curItem?.id ?? curNudge?.prs[0].item;
  useEffect(() => { if (shown && shown !== sel) select(shown); }, [shown]);
  // Every move in Next goes to the friction log the Metrics view and weekly loop read.
  const advance = useCallback((key: string, kind: "next-done" | "next-skip", item: string | null, step: string | null) => {
    void post("/api/event", { item, kind, step });
    setHandled((h) => new Set(h).add(key));
    setCur(null);
  }, []);
  const opened = useRef(false);
  useEffect(() => {
    if (nextMode || opened.current) void post("/api/event", { kind: nextMode ? "next-open" : "next-close" });
    opened.current ||= nextMode;
  }, [nextMode]);
  const doneItem = useCallback((it: WorkItem) => advance(handledKey(it), "next-done", it.id, it.next?.step ?? null), [advance]);
  const skip = useCallback(() => {
    if (curItem) advance(handledKey(curItem), "next-skip", curItem.id, curItem.next?.step ?? null);
    else if (curNudge) advance(nudgeKey(curNudge), "next-skip", curNudge.prs[0].item, "nudge");
  }, [advance, curItem, curNudge]);
  const doPrimary = useCallback((it: WorkItem) => primary(it, nextMode ? () => doneItem(it) : undefined), [primary, nextMode, doneItem]);
  const sendNudge = useCallback(async (n: NonNullable<typeof curNudge>, text: string) => {
    const r = await post("/api/nudge", { reviewer: n.reviewer, text });
    if (r.error) return setToast(`Couldn't copy: ${r.error}`);
    setToast(`Nudge for ${n.reviewer} copied; paste it in Slack`);
    advance(nudgeKey(n), "next-done", n.prs[0].item, "nudge");
  }, [advance]);
  const nudgeText = () => (document.getElementById("nudge-text") as HTMLTextAreaElement | null)?.value ?? curNudge?.text ?? "";
  // When CI broke for every PR in a repo and the fix is on the base, the same update is due on all of
  // them: Next offers them as one batch, behind one confirmation.
  const batch = useMemo(() => {
    const upd = (i: WorkItem) => i.primary.act === "update" && i.prs.some((p) => `${p.repo}#${p.number}` === i.primary.pr && (p.checks === "failure" || p.checks === "error"));
    const repo = (i: WorkItem) => i.primary.pr?.split("#")[0];
    return curItem && upd(curItem) ? queue.filter((i) => upd(i) && repo(i) === repo(curItem)) : [];
  }, [curItem, queue]);
  const [batchOpen, setBatchOpen] = useState<WorkItem[] | null>(null);

  const visible = useMemo(() => items.filter((it) => (!laneFilter.size || laneFilter.has(it.lane)) &&
    (!q || [it.key, it.title, it.why, ...it.repos, ...it.prs.map((p) => `#${p.number}`)].join(" ").toLowerCase().includes(q.toLowerCase()))),
  [items, laneFilter, q]);

  const groups: Group[] = useMemo(() => {
    if (groupBy === "lane")
      return LANES.filter((l) => (!laneFilter.size ? true : laneFilter.has(l.k)))
        .map((l) => ({ key: l.k, title: l.t, lane: l.k, items: visible.filter((i) => i.lane === l.k) }))
        // Parked sits collapsed under the lanes unless asked for.
        .filter((g) => g.key !== "parked" || g.items.length || laneFilter.has("parked"))
        .map((g) => (g.key === "parked" && !parkOpen && !laneFilter.has("parked") ? { ...g, collapsed: true } : g));
    if (groupBy === "effort") {
      const by = new Map<string, Group["items"]>();
      for (const it of visible) by.set(it.effort ?? "", [...(by.get(it.effort ?? "") ?? []), it]);
      // Named efforts, biggest first; work in no effort last.
      return [...by.entries()].sort(([a, x], [b, y]) => Number(!a) - Number(!b) || y.length - x.length || a.localeCompare(b))
        .map(([e, xs]) => ({ key: `effort:${e}`, title: e || "No effort", items: xs }));
    }
    const m = new Map<string, Group["items"]>();
    for (const it of visible) for (const r of it.repos) {
      if (!m.has(r)) m.set(r, []);
      m.get(r)!.push({ ...it, _group: r, _also: it.repos.filter((x) => x !== r) });
    }
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).map(([r, xs]) => ({ key: r, title: r, items: xs }));
  }, [visible, groupBy, laneFilter]);
  const order = useMemo(() => [...new Set(groups.flatMap((g) => g.items.map((i) => i.id)))], [groups]);

  const counts = useMemo(() => Object.fromEntries(LANES.map((l) => [l.k, items.filter((i) => i.lane === l.k).length])) as Record<Lane, number>, [items]);
  useEffect(() => { document.title = counts.mine ? `(${counts.mine}) Control room` : "Control room"; }, [counts.mine]);

  const toggleLane = (k: Lane, add: boolean) => setLaneFilter((f) => {
    if (add) { const n = new Set(f); n.has(k) ? n.delete(k) : n.add(k); return n; }
    return f.size === 1 && f.has(k) ? new Set() : new Set([k]);
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (starting || rerequesting || sheet || startBox || jiraMove || batchOpen || reviewing || picking) return;
      if ((e.target as HTMLElement).closest("input, textarea, select, [data-keys]")) { if (e.key === "Escape" && !(e.target as HTMLElement).closest("[data-keys]")) (e.target as HTMLElement).blur(); return; }
      if (e.key === "?") { setHelp((x) => !x); e.preventDefault(); return; }
      if (help) { if (e.key === "Escape") setHelp(false); return; }
      if (e.key === "S" || (e.key === "s" && !nextMode)) { setStartBox({ text: "" }); e.preventDefault(); return; }
      // Docs: d again closes it; its own handler takes esc.
      if (doc) { if (e.key === "d") { back(); e.preventDefault(); } return; }
      if (e.key === "n" && !tidy && !hist && !rem && !met && !ses && page !== "cleanup") { setNextMode((x) => !x); setCur(null); e.preventDefault(); return; }
      if (nextMode && !tidy && !hist && !rem && !met && !ses && page !== "cleanup") {
        const qi = cur ? nextIds.indexOf(cur) : -1;
        const k = e.key;
        let took = true;
        if (k === "Enter" && curItem?.next) doPrimary(curItem);
        else if (k === "Enter" && curNudge) void sendNudge(curNudge, nudgeText());
        else if (k === "Enter" && !curItem && !curNudge && topFree) setPicking(topFree);
        else if (k === "s" && (curItem || curNudge)) skip();
        else if (k === "a" && batch.length > 1) setBatchOpen(batch);
        else if (k === "j" && nextIds.length) setCur(nextIds[Math.min(nextIds.length - 1, qi + 1)]);
        else if (k === "k" && nextIds.length) setCur(nextIds[Math.max(0, qi - 1)]);
        else if (k === "Escape") setNextMode(false);
        else took = false;
        if (took) { e.preventDefault(); return; }
      }
      // Tidy, History, Removed and Metrics: their keys switch between them or back to the board; they handle esc.
      if (tidy || hist || rem || met || ses || page === "cleanup") {
        const p = PAGE_KEYS[e.key];
        if (p) go(p);
        return;
      }
      const i = sel ? order.indexOf(sel) : -1;
      const k = e.key;
      if (k === "j" && order.length) select(order[Math.min(order.length - 1, i + 1)]);
      else if (k === "k" && order.length) select(order[Math.max(0, i - 1)]);
      else if (k === "Enter" && selected) doPrimary(selected);
      else if (k === "a" && selected) setStarting({ it: selected });
      else if (k === "m" && selected) {
        const ps = selected.prs.filter((p) => p.state === "address");
        if (!ps.length) setToast("Nothing to mark addressed");
        for (const p of ps) void act(selected, `${p.repo}#${p.number}`, "mark", {}, "key m");
      }
      else if (k === "w" && selected?.keyKind === "review") document.getElementById("hold-note")?.focus();
      else if (k === "f") setFocus((x) => !x);
      else if (k === "g") setGroupBy((g) => (g === "lane" ? "repo" : g === "repo" ? "effort" : "lane"));
      else if (k === "y" && selected) setSheet({ kind: "effort", it: selected });
      else if (k === "/") qRef.current?.focus();
      else if (k >= "1" && k <= "4") toggleLane(LANES[+k - 1].k, false);
      else if (k === "p" && selected) {
        if (selected.park && !selected.park.woke) void post("/api/park", { item: selected.id, note: null }).then(() => setToast(`Unparked ${selected.key}`));
        else setSheet({ kind: "park", it: selected });
      }
      else if (k === "x" && selected) setSheet({ kind: "remove", it: selected });
      else if (k === "b" && selected) setSheet({ kind: "dependency", it: selected });
      else if (k === "l" && selected) setSheet({ kind: "move", it: selected });
      else if (k === "o" && selected?.keyKind === "review") takeOver(selected, selected.prs[0], true);
      else if (k === "e") open("removed");
      else if (k === "0") setLaneFilter(new Set());
      else if (k === "r") refresh();
      else if (k === "t") open("tidy");
      else if (k === "u") open("cleanup");
      else if (k === "h") open("history");
      else if (k === "i") open("metrics");
      else if (k === "c") open("sessions");
      else if (k === "d") open("docs");
      else if (k === "Escape" && wide) setWide(null);
      else if (k === "z") setWide((w) => (w ? null : selected?.agents.length ? "agent" : "prs"));
      else if (k === "Escape") { setFocus(false); setLaneFilter(new Set()); setQ(""); }
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [order, sel, selected, select, refresh, tidy, hist, rem, met, ses, doc, wide, help, starting, rerequesting, sheet, startBox, jiraMove, batchOpen, batch, reviewing, doPrimary, nextMode, cur, curItem, curNudge, nextIds, skip, sendNudge]);

  return (
    <MotionConfig reducedMotion="user">
      <div className="app">
        <header className="top">
          <div className="brand-col"><div className="brand"><Brand />Control room{snap?.project ? <span className="brand-project">{snap.project}</span> : null}</div><button className="iconbtn newwork" onClick={() => setStartBox({ text: "" })} title="Start new work: a task in your words, or a Jira, Sentry or PostHog link (s)">+ New work <kbd>s</kbd></button></div>
          <div className={`board ${laneFilter.size ? "filtering" : ""}`}>
            {LANES.map((l) => (
              <button key={l.k} className={`ctr ${laneFilter.has(l.k) ? "on" : ""}`} style={{ "--hc": `var(${l.hc})` } as React.CSSProperties}
                onClick={(e) => toggleLane(l.k, e.shiftKey)} title={`Filter to ${l.t} (shift-click to combine)`}>
                <span className="hold" /><span className="body"><Count n={counts[l.k]} /><span className="l">{l.t}</span><kbd>{LANES.indexOf(l) + 1}</kbd></span>
              </button>
            ))}
          </div>
          <div className="tools">
            <FeedStatus snap={snap} status={status} refresh={refresh} />
            <AwsSession />
            <MemoryWarning snap={snap} onTidy={() => open("tidy")} />
            <label className="search"><SearchIcon /><input ref={qRef} placeholder="Filter work" value={q} onChange={(e) => setQ(e.target.value)} /><kbd>/</kbd></label>
            {page === "work" && <div className="seg" title="Group by (g)">
              <button className={groupBy === "lane" ? "on" : ""} onClick={() => setGroupBy("lane")}>Lane</button>
              <button className={groupBy === "repo" ? "on" : ""} onClick={() => setGroupBy("repo")}>Repo</button>
              <button className={groupBy === "effort" ? "on" : ""} onClick={() => setGroupBy("effort")}>Effort</button>
              <kbd className="seg-k">g</kbd>
            </div>}
            <button className={`iconbtn ${nextMode ? "on" : ""}`} onClick={() => { back(); setNextMode((x) => !x); setCur(null); }}
              title="Next: what to do, one at a time, in order (n)">Next {nextIds.length} <kbd>n</kbd></button>
            <nav className="pages" aria-label="Pages">
              {NAV.map((n) => (
                <button key={n.p} className={page === n.p ? "on" : ""} aria-current={page === n.p ? "page" : undefined} onClick={() => open(n.p)} title={`${n.title} (${n.k})`}>
                  {n.label}{n.p === "docs" && docsDue ? <span className="docs-due">{docsDue}</span> : null}
                </button>
              ))}
            </nav>
            <div className="menu-wrap">
              <button className={`iconbtn ${menu || MORE.some((m) => m.p === page) ? "on" : ""}`} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((x) => !x)} title="More pages and settings">⋯</button>
              {menu && <>
                <div className="menu-scrim" onClick={() => setMenu(false)} />
                <div className="menu" role="menu" onKeyDown={(e) => e.key === "Escape" && setMenu(false)}>
                  {MORE.map((m) => (
                    <button key={m.p} role="menuitem" className={page === m.p ? "on" : ""} onClick={() => open(m.p)}><span>{m.label}<small>{m.title}</small></span><kbd>{m.k}</kbd></button>
                  ))}
                  <hr />
                  <button role="menuitem" className={focus ? "on" : ""} onClick={() => { setFocus((x) => !x); setMenu(false); }}><span>Focus mode</span><kbd>f</kbd></button>
                  <button role="menuitem" onClick={() => setTheme((t) => ({ system: "light", light: "dark", dark: "system" } as const)[t])}><span>Theme: {theme}</span><ThemeIcon /></button>
                  <button role="menuitem" onClick={() => { setHelp(true); setMenu(false); }}><span>Keyboard shortcuts</span><kbd>?</kbd></button>
                </div>
              </>}
            </div>
          </div>
        </header>
        {status === "signed-out" ? (
          <div className="notice"><p>This browser isn't signed in to the control room.</p><p>Run <code>bun run open</code> in the control-room checkout.</p></div>
        ) : doc ? (
          <Docs onClose={back} />
        ) : page === "cleanup" ? (
          <Cleanup onClose={back} />
        ) : tidy ? (
          <Tidy onClose={back} />
        ) : hist ? (
          <History onClose={back} />
        ) : rem ? (
          <Removed onClose={back} />
        ) : met ? (
          <Metrics onClose={back} />
        ) : ses ? (
          <Sessions onClose={back} onItem={(id) => { back(); select(id); }} onFocus={(pane) => void focusAgent(pane).then(setToast)} />
        ) : !snap ? (
          <div className="notice"><p>Loading…</p></div>
        ) : (
          <main className={`rackview ${(focus || wide) && !nextMode ? "focus" : ""}`}>
            <LayoutGroup>
              {nextMode ? (
                <NextQueue cur={curItem} nudge={curNudge} queue={queue} nudges={nudges} waiting={counts.waiting} onPrimary={doPrimary}
                  batch={batch.length > 1 ? batch : []} onBatch={() => setBatchOpen(batch)}
                  onNudge={(n) => void sendNudge(n, nudgeText())}
                  onSkip={skip} onPick={setCur} suggestion={curItem || curNudge ? null : topFree} onPickup={setPicking} />
              ) : focus ? (
                <div className="minirack">
                  {groups.map((g) => (
                    <div key={g.key} style={{ display: "contents" }}>
                      {g.items.map((i) => (
                        <motion.div layout key={`${g.key}-${i.id}`} className={`mini ${i.id === sel ? "sel" : ""}`} style={laneVars(i.lane)}
                          animate={{ x: i.lane === "mine" && i.urgency >= 3 ? 6 : 0 }} title={`${i.key}: ${i.title}`} onClick={() => select(i.id)}>
                          <span className="hold" />
                        </motion.div>
                      ))}
                      <div className="minigap" />
                    </div>
                  ))}
                </div>
              ) : (
                <div className="rack">
                  <ColsHead />
                  {groups.map((g) => (
                    <section key={g.key}>
                      <div className={`bay-h ${g.collapsed !== undefined ? "toggle" : ""}`} style={{ "--hc": g.lane ? `var(${LANE[g.lane].hc})` : "var(--ink-3)" } as React.CSSProperties}
                        onClick={() => g.key === "parked" && !laneFilter.has("parked") && setParkOpen((x) => !x)}>
                        <span className="sw" />{g.title} <span className="c">{g.items.length}</span>
                        {g.key === "parked" && !laneFilter.has("parked") && <span className="c">{g.collapsed ? "▸ show" : "▾ hide"}</span>}<span className="rule" />
                      </div>
                      <AnimatePresence initial={false}>
                        {!g.collapsed && g.items.map((it) => (
                          <Strip key={`${groupBy === "repo" ? g.key + "-" : ""}${it.id}`} it={it} sel={it.id === sel}
                            unseen={!!seen && seen[it.id] !== it.updated && it.id !== sel} onClick={() => select(it.id)} />
                        ))}
                      </AnimatePresence>
                      {!g.items.length && <div className="empty">Nothing here.</div>}
                    </section>
                  ))}
                  {!groups.length && <div className="empty">No work matches that filter.</div>}
                  {groupBy === "lane" && !laneFilter.size && !q && !!snap.finished?.length && (
                    <section>
                      <div className="bay-h toggle" style={{ "--hc": "var(--ok)" } as React.CSSProperties} onClick={() => setFinOpen((x) => !x)}>
                        <span className="sw" />Finished today <span className="c">{snap.finished.length}</span><span className="c">{finOpen ? "▾ hide" : "▸ show"}</span><span className="rule" />
                      </div>
                      {finOpen && snap.finished.map((f) => (
                        <div key={f.key} className="finished">
                          <b>{f.key}</b><span className="t">{f.title}</span>
                          <span className="prs">{f.prs.map((p) => <a key={p.ref} href={p.url} target="_blank" rel="noreferrer" className={p.state}>{p.ref.split("/").pop()} {p.state}</a>)}</span>
                          {f.suggest && <button className="btn" onClick={() => setJiraMove({ item: null, s: f.suggest! })}>Move to {f.suggest.to}</button>}
                        </div>
                      ))}
                    </section>
                  )}
                </div>
              )}
            </LayoutGroup>
            <Detail flow={snap?.flow} it={selected} wide={wide} onWide={setWide} onJira={(it, s) => setJiraMove({ item: it.id, s })} onPrimary={doPrimary} onStart={(it) => setStarting({ it })} onSheet={(kind, it) => setSheet({ kind, it })}
              onUnpark={(it) => void post("/api/park", { item: it.id, note: null }).then(() => setToast(`Unparked ${it.key}`))} />
          </main>
        )}
        {help && <Shortcuts onClose={() => setHelp(false)} />}
        {starting && <StartAgent it={starting.it} kind={starting.kind} pr={starting.pr} onClose={() => setStarting(null)}
          onStarted={(m) => { setToast(m); starting.done?.(); }} />}
        {rerequesting && <RerequestSheet it={rerequesting.it} p={rerequesting.p} onClose={() => setRerequesting(null)} onDone={rerequesting.done} />}
        {sheet?.kind === "park" && <ParkSheet it={sheet.it} onClose={() => setSheet(null)} />}
        {sheet?.kind === "remove" && <RemoveSheet it={sheet.it} onClose={() => setSheet(null)} />}
        {startBox && <StartBox items={items} initial={startBox.text} context={startBox.context} sugs={sugs} onClose={() => setStartBox(null)} onStarted={startBox.done}
          onFocus={(id) => { setNextMode(false); select(id); }} />}
        {sheet?.kind === "ask" && <AskSheet it={sheet.it} onClose={() => setSheet(null)} />}
        {reviewing && <RunSheet it={reviewing.it} onClose={() => setReviewing(null)} onDone={reviewing.done} />}
        {batchOpen && (
          <Confirm title={`Update ${batchOpen.length} PRs from ${batchOpen[0].primary.label.split(" from ").pop()}`} label="Update all" onClose={() => setBatchOpen(null)}
            who="Merges the base into each PR's branch, one after another. Their CI runs again; reviewers see a new commit."
            go={async () => { for (const it of batchOpen) if (await act(it, it.primary.pr!, "update", {}, "next-batch")) doneItem(it); }}>
            <ul className="sheet-list">{batchOpen.map((it) => <li key={it.id}><b>{it.primary.pr!.split("/").pop()}</b> {it.title}</li>)}</ul>
          </Confirm>
        )}
        {picking && <PickupSheet s={picking} onClose={() => setPicking(null)} onDone={sugs.reload} />}
        {jiraMove && <MoveJiraSheet item={jiraMove.item} s={jiraMove.s} onClose={() => setJiraMove(null)} />}
        {sheet?.kind === "dependency" && <DependencySheet it={sheet.it} items={items} onClose={() => setSheet(null)} />}
        {sheet?.kind === "effort" && <EffortSheet it={sheet.it} items={items} onClose={() => setSheet(null)} />}
        {sheet?.kind === "move" && <MoveSheet it={sheet.it} items={items} onClose={() => setSheet(null)} />}
        {toast && <motion.div className="toast" initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>{toast}</motion.div>}
      </div>
    </MotionConfig>
  );
}

/** Takes over someone else's PR, so it's triaged as the user's, or hands it back. */
function takeOver(it: WorkItem, p: PrRow, take: boolean) {
  const ref = `${p.repo}#${p.number}`;
  void post("/api/adopt", { ref, note: take ? "" : null, item: it.id })
    .then((r) => toast(r.error ? `Couldn't ${take ? "take over" : "hand back"} #${p.number}: ${r.error}` : take ? `#${p.number} is yours now` : `Handed #${p.number} back to ${p.author}`));
}

const KEYS: [string, string][] = [
  ["n", "Next: what to do, one at a time, in order"], ["s", "start new work (in Next: skip)"],
  ["j / k", "next / previous work item"], ["⏎", "primary action on the selected item"],
  ["1 2 3 4", "filter to My turn, Waiting on others, Asked of me, Parked"], ["0", "show all lanes"],
  ["p", "park the selected item (again to unpark)"], ["x", "remove the selected item's PRs"], ["b", "dependency a PR on another PR or a step"], ["l", "move a PR into another item, or out"], ["o", "take over someone else's PR (review requests)"], ["e", "Removed: the remove list"],
  ["/", "filter by text"], ["g", "group by lane, repo or effort"], ["y", "put the selected item in an effort"], ["f", "focus mode"], ["z", "expand a pane to the whole work area (again, or esc, for the default view)"],
  ["a", "start an agent on the selected item"], ["m", "mark the selected item's feedback addressed"], ["w", "wait on the author (review requests)"], ["⌘⏎", "start it, from the agent sheet"],
  ["t", "Tidy herdr tabs"], ["h", "History"], ["i", "Metrics"], ["c", "Sessions: every Claude session"], ["d", "Docs: glossary, ADRs and statecharts"], ["r", "refresh from GitHub now"],
  ["?", "this list"], ["esc", "back / clear filters"],
];

function Shortcuts({ onClose }: { onClose: () => void }) {
  return (
    <div className="scrim" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <motion.div className="sheet" initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
        <h3>Keyboard</h3>
        <table className="keys"><tbody>{KEYS.map(([k, d]) => <tr key={k}><td><kbd>{k}</kbd></td><td>{d}</td></tr>)}</tbody></table>
      </motion.div>
    </div>
  );
}

function Count({ n }: { n: number }) {
  // Keyed on the number, so a change rolls the new figure in.
  return <span className="n"><motion.span key={n} initial={{ y: "-60%", opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={spring}>{n}</motion.span></span>;
}

function FeedStatus({ snap, status, refresh }: { snap: Snapshot | null; status: string; refresh: () => void }) {
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick((x) => x + 1), 30_000); return () => clearInterval(t); }, []);
  const herdrDown = snap && !snap.herdr.up;
  const bad = status === "offline" || !!snap?.error || !!herdrDown;
  const label = status === "offline" ? "server unreachable" : snap?.error ? "feed error" : herdrDown ? "herdr unreachable"
    : status === "refreshing" ? "refreshing" : `polled ${ago(snap?.polledAt ?? null)} ago`;
  return (
    <button className={`feedstat ${bad ? "bad" : status === "refreshing" ? "busy" : ""}`} style={{ border: 0, background: "none" }}
      onClick={refresh} title={`${snap?.error ?? ""}${herdrDown ? `herdr: ${snap?.herdr.error ?? "down"}` : ""}\nLast full reconcile ${ago(snap?.reconciledAt ?? null)} ago. Click or press r to refresh now.${snap?.dev ? "\nDev server." : ""}`.trim()}>
      <i />{snap?.dev ? "dev · " : ""}{label}<kbd>r</kbd>
    </button>
  );
}

const ART_LABEL = { handoff: "handoff", run: "run", media: "demo" } as const;

/** Files named for the work item outside git; a click opens one on the Mac. */
function Artifacts({ list }: { list: NonNullable<WorkItem["artifacts"]> }) {
  const [all, setAll] = useState(false);
  const shown = all ? list : list.slice(0, 4);
  const open = (path: string) => void post("/api/open", { path }).then((r) => r.error && toast(`Couldn't open: ${r.error}`));
  return (
    <div className="arts">
      {shown.map((a) => (
        <button key={a.path} className="art" onClick={() => open(a.path)} title={a.path.replace(/^\/Users\/[^/]+/, "~")}>
          <span className="k">{ART_LABEL[a.kind]}</span>{a.name}
        </button>
      ))}
      {list.length > 4 && <button className="art more" onClick={() => setAll((x) => !x)}>{all ? "fewer" : `+${list.length - 4} more`}</button>}
    </div>
  );
}

/** Shows only when macOS is short of memory: the cue to close heavy tabs in Tidy before dev stacks get killed. */
function MemoryWarning({ snap, onTidy }: { snap: Snapshot | null; onTidy: () => void }) {
  if (!snap?.machine?.low) return null;
  return <button className="memwarn" onClick={onTidy} title="Open Tidy, heaviest tabs first">Memory low: {snap.machine.freePct}% free <kbd>t</kbd></button>;
}

function ColsHead() {
  return (
    <div className="cols-h"><span /><span>ITEM</span><span>WHAT · WHY</span>
      <div className="cells"><span className="cell">FB</span><span className="cell">CI</span><span className="cell">REVIEW</span><span className="cell">MERGE</span><span className="cell">AGENT</span><span className="cell stale">STALE</span></div>
    </div>
  );
}

const Spinner = () => <i className="spin" aria-label="running" />;
const CellView = ({ c }: { c: Cell }) => <span className={`cell ${c.tone} ${c.text === "✓" || c.text === "✗" ? "glyph" : ""}`} title={c.proof}>{c.text === "RUN" ? <Spinner /> : c.text}</span>;

function Strip({ it, sel, unseen, onClick }: { it: Group["items"][number]; sel: boolean; unseen: boolean; onClick: () => void }) {
  const ps = it._group ? it.prs.filter((p) => short(p.repo) === it._group) : it.prs;
  const ids = !it.prs.length ? (it.branches?.length ? branchLine(it.branches) : `no PR yet · ${it.agents[0]?.workspaceLabel ?? ""}`)
    : it._group ? ps.map((p) => `#${p.number}`).join(", ") : ps.slice(0, 2).map(num).join(", ") + (ps.length > 2 ? ` +${ps.length - 2}` : "");
  const cocked = it.lane === "mine" && it.urgency >= 3;
  return (
    <motion.div layout layoutId={it._group ? undefined : `strip-${it.id}`} data-item={it.id} className={`strip ${sel ? "sel" : ""}`} style={laneVars(it.lane)}
      initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0, x: cocked ? 18 : 0 }} exit={{ opacity: 0, scale: 0.97 }}
      transition={spring} onClick={onClick} role="button">
      {unseen && <i className="tick" title="changed since you last looked" />}
      <div className="hold" />
      <div className="id"><b>{it.key}</b><span className="prs">{ids}</span>{it._also?.length ? <div className="also">also in {it._also.join(", ")}</div> : null}</div>
      <div className="what"><b>{it.title}</b><span className={it.lane === "mine" ? "need" : ""}>{it.why}</span></div>
      <div className="cells">
        <CellView c={it.cells.fb} /><CellView c={it.cells.ci} /><CellView c={it.cells.rv} /><CellView c={it.cells.mg} /><CellView c={it.cells.ag} />
        {it.prs.length ? <span className="cell stale" title={`last push or human comment: ${new Date(it.updated).toLocaleString()}`}>{ago(it.updated)}</span> : <span className="cell stale dim">—</span>}
      </div>
    </motion.div>
  );
}

// Review bots post markdown and HTML; the pane shows the words.
const plain = (md: string) => md.replace(/<!--[\s\S]*?-->/g, "").replace(/<[^>]+>/g, "").replace(/\*\*|__|`/g, "")
  .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/\n{3,}/g, "\n\n").trim();

const KIND: Record<WorkItem["keyKind"], string> = { jira: "issue", sentry: "error report", branch: "branch", review: "review request", agent: "agent" };

/** ⏎ on a work item. */
export function runPrimary(it: WorkItem) {
  if (it.primary.agent) void focusAgent(it.primary.agent);
  else if (it.primary.url) window.open(it.primary.url, "_blank");
}

/** Shows the agent in herdr; resolves to what to tell the user. */
async function focusAgent(pane: string): Promise<string> {
  const r = await fetch("/api/agent/focus", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pane }) })
    .then((x) => x.json()).catch(() => ({ error: "server unreachable" }));
  return r.error ? `Couldn't open: ${r.error}` : r.app ? `Opened in ${r.app}` : "Focused in herdr; no terminal window found to raise";
}

type Wide = "prs" | "feedback" | "agent";
const WIDE_TITLE: Record<Wide, string> = { prs: "Pull requests", feedback: "Open feedback", agent: "Agent" };

/** The expand control on a pane's header. */
const Expand = ({ on, onClick }: { on: boolean; onClick: () => void }) => (
  <button className="expand" onClick={onClick} title={on ? "Back to the default view (esc)" : "Expand to the whole work area (z)"}>{on ? "⤡" : "⤢"}</button>
);

function Detail({ flow, it, wide, onWide, onPrimary, onStart, onSheet, onUnpark, onJira }: {
  flow?: { stages?: string[]; copySuffix?: string };
  wide: Wide | null; onWide: (w: Wide | null) => void;
  onJira: (it: WorkItem, s: Suggested) => void;
  it: WorkItem | null; onPrimary: (it: WorkItem) => void; onStart: (it: WorkItem) => void;
  onSheet: (kind: SheetKind, it: WorkItem) => void; onUnpark: (it: WorkItem) => void;
}) {
  // Looking at a work item counts as looking at its finished agents: after 3 seconds with the
  // window focused, they're marked seen and the item drops to whatever lane its PRs put it in.
  const finished = it?.agents.filter((a) => a.status === "done" || a.finishedSeq !== null) ?? [];
  const finishedKey = finished.map((a) => `${a.pane}@${a.seq}`).join();
  useEffect(() => {
    if (!it || !finishedKey) return;
    let looked = 0;
    const t = setInterval(() => {
      looked = document.hasFocus() && document.visibilityState === "visible" ? looked + 1 : 0;
      if (looked < 3) return;
      clearInterval(t);
      for (const a of finished) void post("/api/agent/dismiss", { pane: a.pane, item: it.id, viewed: true });
    }, 1000);
    return () => clearInterval(t);
  }, [it?.id, finishedKey]);
  const visuals = useVisuals(it?.key ?? null).list ?? [];
  if (!it) return <div className="detail"><div className="empty">Nothing selected.</div></div>;
  const threads = it.prs.flatMap((p) => (p.feedback ?? []).map((f) => ({ ...f, p })));
  // Which panes this item has: an agent with no PR shows only the agent.
  const has: Wide[] = it.agents.length && !it.prs.length ? ["agent"] : ["prs", "feedback", ...(it.agents.length ? ["agent" as const] : [])];
  const cur = wide && (has.includes(wide) ? wide : has[0]);
  const toggle = (w: Wide) => onWide(cur === w ? null : w);
  const prs = (
    <div className="pane">
      <h3><span>Pull requests</span><span className="st dim">{it.prs.length} <Expand on={cur === "prs"} onClick={() => toggle("prs")} /></span></h3>
      <div className="in"><PrTable it={it} /></div>
    </div>
  );
  const feedback = (
    <div className="pane" id="threads">
      <h3><span>{it.keyKind === "review" ? "Review" : "Open feedback"}</span><span className="st dim">{it.keyKind === "review" ? "" : threads.length} <Expand on={cur === "feedback"} onClick={() => toggle("feedback")} /></span></h3>
      <div className="in">
        {it.keyKind === "review" ? <ReviewInfo it={it} /> : <Threads it={it} plain={plain} ago={ago} />}
      </div>
    </div>
  );
  const agent = it.agents.length ? <AgentPane agents={it.agents} item={it} expand={<Expand on={cur === "agent"} onClick={() => toggle("agent")} />} /> : null;
  if (cur) {
    const count: Record<Wide, string> = { prs: String(it.prs.length), feedback: it.keyKind === "review" ? "" : String(threads.length), agent: it.agents.length > 1 ? String(it.agents.length) : "" };
    return (
      <div className="detail wide">
        <div className="wide-head" style={laneVars(it.lane)}>
          <span className="hold" /><b>{it.key}</b><span className="t">{it.title}</span>
          <span className={`why ${it.lane === "mine" ? "mine" : ""}`}>{it.why}</span>
          <button className="btn primary" onClick={() => onPrimary(it)}>{it.primary.label} <kbd>⏎</kbd></button>
        </div>
        <div className="panetabs">
          {has.map((w) => (
            <button key={w} className={`ptab ${w === cur ? "on" : ""}`} onClick={() => onWide(w)}>
              {it.keyKind === "review" && w === "feedback" ? "Review" : WIDE_TITLE[w]}{count[w] && <span className="c">{count[w]}</span>}
              {w === "agent" && <i className={`dot ${it.agents[0].status}`} />}
            </button>
          ))}
          <button className="btn back" onClick={() => onWide(null)}>Back to default view <kbd>esc</kbd></button>
        </div>
        <div className="panes one">{cur === "prs" ? prs : cur === "feedback" ? feedback : agent}</div>
      </div>
    );
  }
  return (
    <div className="detail">
      <motion.div className="lifted" style={laneVars(it.lane)} key={it.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={spring}>
        <div className="hold" />
        <div className="id">
          <b>{it.key}</b>
          <div className="idmeta"><span className="kind">{KIND[it.keyKind]}</span>{it.prs.length > 0 && <span>stale {ago(it.updated)}</span>}</div>
          {it.repos.length > 0 && <div className="repos">{it.repos.map((r) => <span key={r}>{r}</span>)}</div>}
          {it.usage && (
            <dl className="use" title={`${it.usage.sessions} session${it.usage.sessions === 1 ? "" : "s"} · input ${tok(it.usage.input)}, output ${tok(it.usage.output)}, cache ${tok(it.usage.cache)} · estimates from the Metrics assumptions`}>
              <div><dt>Tokens</dt><dd>{tok(it.usage.weighted)}</dd></div>
              <div><dt>At API prices</dt><dd>${Math.round(it.usage.usd)}</dd></div>
              <div><dt>Energy</dt><dd>{it.usage.kwh.toFixed(1)} kWh</dd></div>
              <div><dt>Water</dt><dd>{it.usage.liters.toFixed(1)} L</dd></div>
            </dl>
          )}
          {it.prs.filter((p) => p.taken_over).map((p) => <span key={p.number} className="note">#{p.number} taken over from {p.taken_over!.from}</span>)}
        </div>
        <div><h1>{it.title}</h1><div className="why">{it.lane === "mine" ? <b>{it.why}</b> : it.why}</div>
          {it.stopChecks?.map((c) => <div key={c.branch} className={`st ${c.ok ? "dim" : ""}`} title={c.commands.map((x) => `${x.command}: exit ${x.exit}`).join("\n")}>Stop checks {c.ok ? "passed" : "failed"} on {c.branch} at {c.sha.slice(0, 8)}: {c.commands.filter((x) => c.ok || x.exit !== 0).map((x) => `${x.command} (exit ${x.exit})`).join(", ")}</div>)}
          {it.loop && <LoopLines it={it} />}
          {it.guide && <GuideLines it={it} />}
          {it.artifacts && <Artifacts list={it.artifacts} />}
          {(() => { const lines = workLines([...it.agents.map((a) => a.branch), ...(it.branches ?? []).map((b) => b.name), ...it.prs.map((p) => p.branch)], flow);
            return lines.length > 1 ? <div className="loops"><div className="loopline held branches"><span className="st">BRANCHES</span><span className="txt">Work is on {lines.length} branches:<br />{lines.join(", ")}</span><span /></div></div> : null; })()}
          <VisualStrip list={visuals} />
          <VerifyStrip it={it} />
          {it.jira && (
            <div className="jira">
              <a href={it.jira.url} target="_blank" rel="noreferrer">{it.key} · {it.jira.status}</a>
              {it.jira.suggest && <button className="btn on-strip" onClick={() => onJira(it, it.jira!.suggest!)}>Move to {it.jira.suggest.to}</button>}
            </div>
          )}
        </div>
        <div className="acts">
          <button className="btn primary" onClick={() => onPrimary(it)}>{it.primary.label} <kbd>⏎</kbd></button>
          {!it.primary.handoff && <button className="btn on-strip" onClick={() => onStart(it)}>Start agent <kbd>a</kbd></button>}
          <div className="acts-row">
            {it.park && !it.park.woke
              ? <button className="btn on-strip" onClick={() => onUnpark(it)}>Unpark <kbd>p</kbd></button>
              : <button className="btn on-strip" onClick={() => onSheet("park", it)}>Park <kbd>p</kbd></button>}
            <button className="btn on-strip" onClick={() => onSheet("remove", it)}>Remove <kbd>x</kbd></button>
            <button className="btn on-strip" onClick={() => onSheet("dependency", it)}>{it.dependencies?.some((g) => !g.opened) ? "Blocked" : "Dependency"} <kbd>b</kbd></button>
            <button className="btn on-strip" onClick={() => onSheet("move", it)}>Move <kbd>l</kbd></button>
            <button className="btn on-strip" onClick={() => onSheet("effort", it)}>{it.effort ? `Effort: ${it.effort}` : "Effort"} <kbd>y</kbd></button>
            {it.prs.some((p) => p.role === "mine" && !p.draft) && <button className="btn on-strip" onClick={() => onSheet("ask", it)}>Ask in Slack</button>}
            {it.keyKind === "review" && <button className="btn on-strip" onClick={() => takeOver(it, it.prs[0], true)} title="You're working on it now: treat it as your PR">Take over <kbd>o</kbd></button>}
            {it.prs.filter((p) => p.taken_over).map((p) => <button key={p.number} className="btn on-strip" onClick={() => takeOver(it, p, false)}>Hand back #{p.number}</button>)}
          </div>
        </div>
      </motion.div>
      {!it.agents.length ? (
        <div className="panes">{prs}{feedback}</div>
      ) : !it.prs.length ? (
        <div className="panes one">{agent}</div>
      ) : (
        <div className="panes"><div className="stack">{prs}{feedback}</div>{agent}</div>
      )}
    </div>
  );
}

const LOOP_TONE: Record<LoopView["state"], string> = { watching: "dim", running: "warn", held: "pen", stopped: "pen", off: "dim" };

/** The review loop on each PR: what it's doing, and the user's say over it. */
function LoopLines({ it }: { it: WorkItem }) {
  const [busy, setBusy] = useState<string | null>(null);
  const go = async (lv: LoopView, what: "run" | "off" | "on") => {
    setBusy(lv.ref + what);
    const r = await post("/api/cycle", { item: it.id, ref: lv.ref, what });
    setBusy(null);
    if (r.error) window.dispatchEvent(new CustomEvent("cr-toast", { detail: `Couldn't: ${r.error}` }));
  };
  return (
    <div className="loops">
      {it.loop!.map((lv) => (
        <div key={lv.ref} className={`loopline ${lv.state}`}>
          <span className={`st ${LOOP_TONE[lv.state]}`}>LOOP</span>
          <span className="txt" title={lv.why}><b>#{lv.ref.split("#")[1]}</b>{lv.why}</span>
          <span className="lb">
          {lv.state === "stopped" && <button className="btn sm on-strip" disabled={!!busy} title={lv.risk ? "You've looked: let the loop work it, risky files and all" : "Start over: clears the stop and the round count"} onClick={() => go(lv, "run")}>{lv.risk ? "Let it run" : "Resume"}</button>}
          {lv.state === "watching" && <button className="btn sm on-strip" disabled={!!busy} title="Work the feedback and CI that were there before the loop started watching" onClick={() => go(lv, "run")}>Run</button>}
          {lv.state === "off"
            ? <button className="btn sm on-strip" disabled={!!busy} onClick={() => go(lv, "on")}>On</button>
            : <button className="btn sm on-strip" disabled={!!busy} onClick={() => go(lv, "off")}>Off</button>}
          </span>
          {lv.checks && <span className="checks" title="Checks the last round's agent ran on its final code">{lv.checks.map((c, i) => <code key={i} className={c.exit === 0 ? "pass" : "fail"}>{c.cmd} <b>exit {c.exit}</b></code>)}</span>}
        </div>
      ))}
    </div>
  );
}

/** Field guides to the PRs the user was asked to review: read one, or promote it to a claude.ai artifact to share. */
function GuideLines({ it }: { it: WorkItem }) {
  const [busy, setBusy] = useState(false);
  const promote = async (ref: string) => {
    setBusy(true);
    const r = await post("/api/guide/promote", { item: it.id, ref });
    setBusy(false);
    window.dispatchEvent(new CustomEvent("cr-toast", { detail: r.error ? `Couldn't: ${r.error}` : "Publishing in a new agent tab; the link shows here when it's done" }));
  };
  const link = async (ref: string) => {
    setBusy(true);
    const r = await post("/api/guide/link", { item: it.id, ref });
    setBusy(false);
    window.dispatchEvent(new CustomEvent("cr-toast", { detail: r.error ? `Couldn't: ${r.error}` : "Linked the field guide in the PR body" }));
  };
  return (
    <div className="loops">
      {it.guide!.map((g) => (
        <div key={g.ref} className="loopline">
          <span className={`st ${g.stale ? "dim" : "ok"}`}>{g.mine ? "SELF-REVIEW" : "GUIDE"}</span>
          <span className="txt" title={g.stale ? "This review is of an older commit. A new one is coming." : undefined}><b>#{g.ref.split("#")[1]}</b>{g.stale ? `${g.sha.slice(0, 7)}, older commit; new one coming` : `${ago(g.at)} ago · ${g.sha.slice(0, 7)}`}</span>
          <span className="lb">
            <a className="btn sm on-strip" href={g.path} target="_blank" rel="noreferrer">Read</a>
            {g.url
              ? <a className="btn sm on-strip" href={g.url} target="_blank" rel="noreferrer" title="Its claude.ai artifact">Shared ↗</a>
              : <button className="btn sm on-strip" disabled={busy} title="Publish it as a private claude.ai artifact you can share" onClick={() => promote(g.ref)}>Promote</button>}
            {g.mine && g.url && (g.linked
              ? <span className="st ok" title="Its shared link is in the PR body">In PR</span>
              : <button className="btn sm on-strip" disabled={busy} title={`Adds "Field guide: ${g.url}" to the end of the PR body, so reviewers start from it`} onClick={() => link(g.ref)}>Link in PR</button>)}
          </span>
        </div>
      ))}
    </div>
  );
}

const STATUS_TEXT: Record<Agent["status"], [string, string]> = {
  blocked: ["WAITING ON YOU", "pen"], done: ["FINISHED", "ok"], working: ["WORKING", "warn"], idle: ["IDLE", "dim"], unknown: ["UNKNOWN", "dim"],
};

const post = (path: string, body: object) =>
  fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    .then((x) => x.json()).catch(() => ({ error: "server unreachable" }));

function AgentPane({ agents, item, expand }: { agents: Agent[]; item: WorkItem; expand?: React.ReactNode }) {
  const [closing, setClosing] = useState(false);
  const [pane, setPane] = useState(agents[0].pane);
  const a = agents.find((x) => x.pane === pane) ?? agents[0];
  const [note, setNote] = useState<string | null>(null);
  const [st, tone] = STATUS_TEXT[a.status];
  return (
    <div className="pane">
      <h3><span>Agent · {a.name ?? a.label}</span><span className={`st ${tone}`}>{st} {expand}</span></h3>
      <div className="in agent">
        {agents.length > 1 && (
          <div className="chips">{agents.map((x) => (
            <button key={x.pane} className={`chip ${x.pane === a.pane ? "on" : ""}`} onClick={() => setPane(x.pane)}>
              <i className={`dot ${x.status}`} />{x.name ?? x.label}
            </button>
          ))}</div>
        )}
        <div className="meta">{a.workspaceLabel} · {a.label}{a.branch ? ` · ${a.branch}` : ""}</div>
        <LiveConsole pane={a.pane} status={a.status} name={a.name ?? a.label} item={item.id} extra={(send) =>
          (a.status === "done" || a.status === "idle" || a.finishedSeq !== null) && (
            <button className="btn" type="button" title="Go ahead with what you drafted: push and post" onClick={() => send("Approved. Go ahead: push and post as drafted.")}>Approve</button>
          )} />
        <div className="row-acts">
          <button className="btn" disabled={!!note && note.startsWith("Opening")} title="Shows it in herdr; a finished agent counts as seen"
            onClick={async () => { setNote("Opening…"); setNote(await focusAgent(a.pane)); setTimeout(() => setNote(null), 4000); }}>Open in herdr</button>
          {(a.status === "done" || a.finishedSeq !== null) && (
            <button className="btn" title="Off the board until it works again; herdr is left alone"
              onClick={async () => { const r = await post("/api/agent/dismiss", { pane: a.pane, item: item.id }); setNote(r.error ? `Couldn't: ${r.error}` : "Marked seen"); }}>Mark seen</button>
          )}
          <button className="btn" onClick={() => setClosing(true)} disabled={a.status === "working"} title={a.status === "working" ? "It's working; wait for it to stop" : "End this session; resumable from History"}>Close session</button>
          <span className={`st ${note?.startsWith("Couldn't") ? "pen" : "dim"}`}>{note ?? ""}</span>
        </div>
      </div>
      {closing && (
        <div className="scrim" onClick={(e) => e.target === e.currentTarget && setClosing(false)}>
          <motion.div className="sheet" initial={{ y: 14, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
            <h3>Close {a.name ?? a.label}?</h3>
            <div className="who">
              Ends this Claude session{a.status === "blocked" ? ", which is waiting on you" : ""}. Resumable later from History.
              <br />{item.prs.length ? `${item.key} still has ${item.prs.length} open PR${item.prs.length > 1 ? "s" : ""}.` : `${item.key} has no open PR.`}
            </div>
            <ul className="sheet-list"><li>{a.workspaceLabel} / {a.label}</li><li>{a.cwd}</li></ul>
            <div className="row">
              <button className="btn" onClick={() => setClosing(false)}>Cancel</button>
              <button className="btn primary" autoFocus onClick={async () => {
                const r = await post("/api/agent/close", { pane: a.pane, item: item.id });
                setClosing(false);
                setNote(r.error ? `Couldn't close: ${r.error}` : `Closed its ${r.closed}`);
              }}>Close session <kbd>⏎</kbd></button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}

/** Unresolved threads on someone else's PR: what's already been raised, and replies waiting on the user. */
function OpenThreads({ p }: { p: PrRow }) {
  const ts = p.threads ?? [];
  const waiting = ts.filter((t) => t.yours).length;
  return (
    <div className="openthreads">
      <h4>Open threads <span className="st dim">{ts.length}{waiting ? ` · ${waiting} waiting on you` : ""}</span></h4>
      {!ts.length && <div className="empty">None open.</div>}
      {ts.map((t) => (
        <div key={t.url} className={`thread ${t.bot ? "bot" : ""}`}>
          <span className="who">{t.who}</span>{" "}
          <span className="where"><a href={t.url} target="_blank" rel="noreferrer">{t.where}</a> · {ago(t.at)}{t.count > 1 ? ` · ${t.count} comments, last ${t.last}` : ""}{t.outdated ? " · outdated" : ""}</span>
          {t.yours && <span className="st pen"> · waiting on you</span>}
          <p>{clip(plain(t.body)) || "(no text)"}</p>
        </div>
      ))}
    </div>
  );
}
const clip = (s: string, n = 400) => (s.length > n ? s.slice(0, n).trimEnd() + "…" : s);

function ReviewInfo({ it }: { it: WorkItem }) {
  const p = it.prs[0];
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const hold = (n: string | null) => post("/api/hold", { item: it.id, note: n }).then((r) => setErr(r.error ?? null));
  const since = it.hold && new Date(it.hold.setAt).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <div>
      <p style={{ marginTop: 0 }}><b>{p.author}</b> asked {p.direct ? "you directly" : "your team"}{p.rereview ? ", and has pushed since your last review" : ""}.</p>
      {p.prior && <p>Your last review: {p.prior.replace("_", " ")}{p.pushed_since ? "; they've pushed since." : "."}</p>}
      <OpenThreads p={p} />
      <Curate it={it} />
      {it.hold && !it.hold.woke ? (
        <div className="hold-box">
          <p style={{ margin: 0 }}>Waiting on <b>{p.author}</b> since {since}{it.hold.note ? `: ${it.hold.note}` : ""}.</p>
          <p className="st dim" style={{ margin: "4px 0 8px" }}>Comes back to Asked of me when they push, comment, reply or mention you.</p>
          <button className="btn" onClick={() => hold(null)}>Stop waiting</button>
        </div>
      ) : (
        <div className="hold-box">
          {it.hold?.woke && <p style={{ margin: "0 0 8px" }}><b>{it.hold.woke}</b> since you started waiting{it.hold.note ? ` (${it.hold.note})` : ""}.</p>}
          <form className="reply" onSubmit={(e) => { e.preventDefault(); void hold(note.trim()); setNote(""); }}>
            <input id="hold-note" placeholder={`Why you're waiting on ${p.author} (optional)`} value={note} onChange={(e) => setNote(e.target.value)} />
            <button className="btn" type="submit">Wait on author <kbd>w</kbd></button>
          </form>
        </div>
      )}
      {err && <div className="tidy-err">{err}</div>}
    </div>
  );
}

function PrTable({ it }: { it: WorkItem }) {
  const asked = it.keyKind === "review";
  return (
    <table className="prs">
      <thead><tr><th>PULL REQUEST</th>{!asked && <th>FEEDBACK</th>}<th>CI</th><th>REVIEW</th>{!asked && <th>MERGEABLE</th>}</tr></thead>
      <tbody>
        {it.prs.map((p) => {
          const fb = p.feedback?.length ?? 0;
          const ci = p.checks === "success" ? <span className="st ok glyph" title="passing">✓</span>
            : p.checks === "failure" || p.checks === "error" ? <span className="st pen glyph" title="failing">✗</span>
            : p.checks === "pending" ? <span className="st warn" title="running"><Spinner /></span>
            : <span className="st dim">{p.checks}</span>;
          const rv = asked ? <span className="st pen">you</span> : p.review_decision === "APPROVED" ? <span className="st ok">approved</span>
            : p.review_decision === "CHANGES_REQUESTED" ? <span className="st pen">changes requested</span>
            : <span className={`st ${p.pending_reviewers.length ? "" : "pen"}`}>{p.pending_reviewers.join(", ") || "none requested"}</span>;
          const mg = p.merge_state === "DIRTY" ? "pen" : p.can_merge.startsWith("yes") ? "ok" : p.merge_state === "BEHIND" ? "warn" : "dim";
          return (
            <tr key={p.url}>
              <td className="r"><a href={p.url} target="_blank" rel="noreferrer">{num(p)}</a>{p.draft && <span className="st dim"> draft</span>}{p.stack && <span className={`st ${p.stack.behind ? "warn" : "dim"}`} title={p.stack.behind ? `#${p.stack.number} has commits this PR doesn't; the review loop merges them in` : `Includes #${p.stack.number}'s commits; its own diff shrinks once #${p.stack.number} merges`}> on #{p.stack.number}{p.stack.behind ? ", behind it" : ""}</span>}<span className="t">{p.title}</span><PrActions it={it} p={p} /><div className="pr-acts"><ChartButton item={it.id} pr={`${p.repo}#${p.number}`} keyName={it.key} merged={false} /></div></td>
              {!asked && <td>{fb ? <span className="st pen">{fb} open</span> : <span className="st dim">{p.mark ? p.mark.state : "none"}</span>}</td>}
              <td>{ci}</td><td>{rv}</td>
              {!asked && <td><span className={`st ${mg}`}>{p.can_merge}</span></td>}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

const Brand = () => (
  <svg viewBox="0 0 22 22"><rect x="2" y="4" width="18" height="4" rx="1" fill="var(--h-mine)" /><rect x="5" y="9.5" width="15" height="4" rx="1" fill="var(--h-wait)" /><rect x="2" y="15" width="18" height="4" rx="1" fill="var(--h-ask)" /></svg>
);
const ThemeIcon = () => <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="8" cy="8" r="5.5" /><path d="M8 2.5v11" /><path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" /></svg>;
const SearchIcon = () => <svg viewBox="0 0 16 16" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6"><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5 14 14" /></svg>;
