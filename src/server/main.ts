import index from "../ui/index.html";
import { note as recordNote } from "./runner";
import { join } from "node:path";
import { DEV, PORT, ROOT } from "./config";
import { adopt, copyAsk, moveJira, nudge, publish, setEffort, refetch, refresh, remove, removed, restore, setDependency, setHold, setMove, setPark, snapshot, start, subscribe } from "./feed";
import type { Move } from "../shared/types";
import { markAddressed, postReplies, rerequest, rerunCi, resolveThreads, updateBranch, type Reply } from "./actions";
import { closeAgent, dismissAgent, focusAgent, herdrReady, readAgent, sendKeys, sendToAgent, typeInto, type Typed } from "./herdr";
import { db } from "./db";
import { sessions } from "./sessions";
import { qualityRecords, setVerdict, shipped, startShipped, verifyPrompt } from "./shipped";
import { bounces } from "./product";
import { allLessons, lessonsFor, markStick, removeLesson, stickPrompt } from "./lessons";
import { findItem, formatItem } from "./itemview";
import { replays, runReplays, waitingReplays } from "./replay";
import { recordEvent } from "./events";
import { historySyncedAt, METRICS_FROM, prFacts, startHistory, syncHistory } from "./history";
import { features, friction, quality, stageTimes, weekly, type Event } from "./metrics";
import { loopState, runLoop, startLoop } from "./loop";
import { closedTabs, closeTabs, history, listTabs } from "./tidy";
import { startAgent, tasksFor, type StartRequest } from "./handoff";
import { startFromSignal, startTriage, suggest } from "./start";
import { dismissRun, postComment, runFiles, runs } from "./runs";
import { setCoeffs, usage } from "./usage";
import { machine } from "./health";
import { awsSession, refreshMfa } from "./aws";
import { guardrails } from "./guardrails";
import { openArtifact } from "./artifacts";
import { diffLines, postReview, readDrafts, type Picked } from "./review";
import { deleteRun, listWorktrees, removeWorktrees, startCleanup } from "./cleanup";
import { confirmPassing, getRun, listRuns, runFile, setConfirm, startRun, stopRun, tail, trackedLogEmails, filesSince, verifyPrompt as verifyRunPrompt } from "./verify";
import { bootstrap, guard, HOSTNAME, token } from "./security";
import { sendHeld, setLoop } from "./reviewloop";
import { accomplished } from "./done";
import { guidePage, linkGuide, promoteGuide } from "./guides";
import type { HeldReply } from "../shared/types";
import { archAgentPrompt, dismissSuggestion, judgeSuggestions, pickupSuggestion, type PickupSteps, runArchitecture, startSuggestions, suggestionsView } from "./suggestions";
import { docsView, reviewDoc } from "./docs";
import { addFlowChange, chartChange, chartRun, flowChangePreview, getVisual, listVisuals, visualFile } from "./visuals";

const archStart = (repo: string, prompt: string) => startAgent({ item: `arch-${repo}`, repo, pr: null, kind: "custom", prompt, edited: false, bare: true });

token(); // created on first start, 0600

const pub = (name: string, type: string) => () =>
  new Response(Bun.file(join(ROOT, "src/ui/public", name)), { headers: { "content-type": type } });

// The page and its bundle are public code; everything under /api needs the cookie.
const api = (handler: (req: Request) => Response | Promise<Response>) => (req: Request) =>
  guard(req, { needCookie: true }) ?? handler(req);

const enc = new TextEncoder();

function events(req: Request): Response {
  let stop = () => {};
  const stream = new ReadableStream({
    start(ctl) {
      const send = (event: string, data: unknown) => ctl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      send("snapshot", snapshot());
      const off = subscribe((s) => send("snapshot", s));
      const ping = setInterval(() => ctl.enqueue(enc.encode(": ping\n\n")), 20_000);
      stop = () => { off(); clearInterval(ping); };
      req.signal.addEventListener("abort", () => { stop(); try { ctl.close(); } catch {} });
    },
    cancel() { stop(); },
  });
  return new Response(stream, { headers: { "content-type": "text/event-stream", "cache-control": "no-store" } });
}

const server = Bun.serve({
  hostname: HOSTNAME,
  port: PORT,
  idleTimeout: 60,
  development: DEV ? { hmr: true, console: true } : false,
  routes: {
    "/": index,
    "/item/*": index,
    "/manifest.webmanifest": pub("manifest.webmanifest", "application/manifest+json"),
    "/icon.svg": pub("icon.svg", "image/svg+xml"),
    "/sw.js": pub("sw.js", "text/javascript"),
    "/bootstrap": (req) => guard(req, { needCookie: false }) ?? bootstrap(req),
    "/api/snapshot": api(() => Response.json(snapshot())),
    "/api/events": api(events),
    "/api/item": api((req) => {
      const q = new URL(req.url).searchParams.get("q") ?? "";
      const it = findItem(snapshot().items, q);
      if (!it) return new Response(`no work item on the board matches ${q}`, { status: 404 });
      return new Response(formatItem(it, it.repos.flatMap((r) => lessonsFor(r))));
    }),
    "/api/refresh": { POST: api(async () => { await refresh(); return Response.json({ ok: true }); }) },
    "/api/agent/read": api(async (req) => {
      const pane = new URL(req.url).searchParams.get("pane") ?? "";
      try { return Response.json({ text: await readAgent(pane) }); }
      catch (e) { return Response.json({ error: (e as Error).message }, { status: 502 }); }
    }),
    "/api/tidy": api(async () => {
      await herdrReady();
      try { return Response.json({
        tabs: await listTabs(snapshot().items), closed: closedTabs(), machine: await machine(),
        guardrails: await guardrails(snapshot().items.flatMap((i) => i.prs.filter((p) => p.role === "mine").map((p) => p.repo))),
      }); }
      catch (e) { return Response.json({ error: (e as Error).message }, { status: 502 }); }
    }),
    "/api/tidy/close": { POST: api(async (req) => {
      const { tabs } = (await req.json()) as { tabs: string[] };
      await herdrReady();
      const all = await listTabs(snapshot().items);
      return Response.json({ results: await closeTabs(tabs.filter((t) => all.some((x) => x.tab === t)), all) });
    }) },
    "/api/docs": api(() => Response.json(docsView())),
    "/api/visuals": api((req) => { const u = new URL(req.url).searchParams; return Response.json({ visuals: listVisuals({ key: u.get("key"), kind: u.get("kind") }) }); }),
    "/api/visuals/one": api((req) => { const v = getVisual(new URL(req.url).searchParams.get("id") ?? ""); return v ? Response.json(v) : Response.json({ error: "no such visual" }, { status: 404 }); }),
    "/api/visuals/file": api((req) => {
      const u = new URL(req.url).searchParams;
      const p = visualFile(u.get("id") ?? "", u.get("f") ?? "");
      if (!p) return new Response("not found", { status: 404 });
      const type = p.endsWith(".svg") ? "image/svg+xml" : p.endsWith(".mp4") ? "video/mp4" : p.endsWith(".webm") ? "video/webm" : "text/plain; charset=utf-8";
      return new Response(Bun.file(p), { headers: { "content-type": type, "content-security-policy": "script-src 'none'", "cache-control": "no-store" } });
    }),
    "/api/verify": api(async (req) => {
      const u = new URL(req.url).searchParams, head = u.get("head"), base = u.get("base") ?? "main";
      const runs = listRuns(u.get("key"));
      return Response.json({ runs: await Promise.all(runs.map(async (r) => ({ ...r, filesSince: head ? await filesSince(r.repo, r.commit, head, base) : null }))) });
    }),
    "/api/verify/one": api((req) => { const v = getRun(new URL(req.url).searchParams.get("id") ?? ""); return v ? Response.json(v) : Response.json({ error: "no such run" }, { status: 404 }); }),
    "/api/verify/file": api((req) => {
      const u = new URL(req.url).searchParams;
      const p = runFile(u.get("id") ?? "", u.get("f") ?? "");
      if (!p) return new Response("not found", { status: 404 });
      const media = /\.(png|jpe?g|gif|webm|mp4)$/i.test(p);
      return new Response(Bun.file(p), { headers: { ...(media ? {} : { "content-type": "text/plain; charset=utf-8" }), "content-security-policy": "script-src 'none'", "x-content-type-options": "nosniff", "cache-control": "no-store" } });
    }),
    "/api/verify/tail": api((req) => { const u = new URL(req.url).searchParams; const t = tail(u.get("id") ?? "", u.get("f") ?? ""); return t === null ? Response.json({ text: "" }) : Response.json({ text: t }); }),
    "/api/verify/start": { POST: api(async (req) => {
      const b = (await req.json()) as { repo: string; ref: string; key?: string | null; pr?: string | null; item?: string | null; agent?: boolean; cwd?: string | null };
      const { startAgent } = await import("./handoff");
      try {
        return Response.json(await startRun({ repo: String(b.repo), ref: String(b.ref), key: b.key ?? null, pr: b.pr ?? null, item: b.item ?? null, cwd: b.cwd ?? null,
          ...(b.agent ? { agentPrompt: verifyRunPrompt, start: (_id: string, prompt: string) => startAgent({ item: b.item ?? String(b.key), repo: String(b.repo), pr: b.pr ?? null, kind: "custom", edited: false, bare: true, verb: "verify", prompt }) } : {}) }));
      } catch (e) { return Response.json({ error: (e as Error).message }, { status: 502 }); }
    }) },
    "/api/verify/stop": { POST: api(async (req) => {
      const b = (await req.json()) as { id: string; item?: string | null };
      try { await stopRun({ item: b.item ?? null, trigger: "detail" }, String(b.id)); return Response.json({ ok: true }); }
      catch (e) { return Response.json({ error: (e as Error).message }, { status: 502 }); }
    }) },
    "/api/cleanup": api(async () => Response.json({ worktrees: await listWorktrees(), logEmails: trackedLogEmails() })),
    "/api/cleanup/worktrees": { POST: api(async (req) => {
      const b = (await req.json()) as { paths: string[] };
      try { return Response.json(await removeWorktrees({ item: null, trigger: "cleanup" }, b.paths)); }
      catch (e) { return Response.json({ error: (e as Error).message }, { status: 502 }); }
    }) },
    "/api/verify/delete": { POST: api(async (req) => {
      const b = (await req.json()) as { id: string };
      try { deleteRun({ item: null, trigger: "cleanup" }, String(b.id)); return Response.json({ ok: true }); }
      catch (e) { return Response.json({ error: (e as Error).message }, { status: 409 }); }
    }) },
    "/api/verify/confirm-passing": { POST: api(async (req) => {
      const b = (await req.json()) as { id: string; item?: string | null };
      return Response.json({ confirmed: confirmPassing({ item: b.item ?? null, trigger: "detail" }, String(b.id)) });
    }) },
    "/api/verify/confirm": { POST: api(async (req) => {
      const b = (await req.json()) as { id: string; check: string; verdict: "confirmed" | "rejected" | null; note?: string; item?: string | null };
      setConfirm({ item: b.item ?? null, trigger: "detail" }, String(b.id), String(b.check), b.verdict, b.note ?? "");
      return Response.json({ ok: true });
    }) },
    "/api/visuals/charting": api((req) => Response.json({ run: chartRun(new URL(req.url).searchParams.get("pr") ?? "") })),
    "/api/visuals/chart": { POST: api(async (req) => {
      const b = (await req.json()) as { item: string; pr: string; key: string | null; merged?: boolean };
      try { return Response.json(await chartChange({ item: String(b.item), pr: String(b.pr), key: b.key ?? null, merged: !!b.merged })); }
      catch (e) { return Response.json({ error: (e as Error).message }, { status: 502 }); }
    }) },
    "/api/visuals/flow-change": { POST: api(async (req) => {
      const b = (await req.json()) as { id: string; pr: string; item?: string; send?: boolean };
      try {
        if (!b.send) return Response.json(await flowChangePreview(String(b.id), String(b.pr)));
        return Response.json({ result: await addFlowChange({ item: b.item ?? null, trigger: "detail" }, String(b.id), String(b.pr)) });
      } catch (e) { return Response.json({ error: (e as Error).message }, { status: 502 }); }
    }) },
    "/api/docs/review": { POST: api(async (req) => {
      const { id, verdict, comment } = (await req.json()) as { id: string; verdict: "reviewed" | "needs-change"; comment?: string };
      try { reviewDoc(String(id), verdict, String(comment ?? "")); return Response.json({ ok: true }); }
      catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
    }) },
    "/api/shipped": api(() => Response.json({ shipped: shipped(), lessons: allLessons(), bounces: bounces() })),
    "/api/replays": {
      GET: api(() => Response.json({ replays: replays(), waiting: waitingReplays() })),
      POST: api(async (req) => {
        const { again } = (await req.json().catch(() => ({}))) as { again?: boolean };
        try { return Response.json(await runReplays(!!again)); }
        catch (e) { return Response.json({ error: (e as Error).message }, { status: 502 }); }
      }),
    },
    "/api/shipped/verdict": { POST: api(async (req) => {
      const b = (await req.json()) as { ref: string; verdict: "caused" | "not" | null; why: string; by?: "you" | "agent"; lesson?: string | null };
      try { setVerdict(b.ref, { verdict: b.verdict, why: b.why ?? "", by: b.by ?? "you", lesson: b.lesson ?? null }); return Response.json({ ok: true }); }
      catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
    }) },
    "/api/shipped/verify": { POST: api(async (req) => {
      const { ref } = (await req.json()) as { ref: string };
      const w = shipped().find((x) => x.ref === ref);
      if (!w) return Response.json({ error: "that PR isn't watched" }, { status: 404 });
      try { return Response.json(await startAgent({ item: `verify-${w.feature}`, repo: w.repo ?? ref.split("#")[0], pr: null, kind: "custom", prompt: verifyPrompt(w), edited: false, bare: true })); }
      catch (e) { return Response.json({ error: (e as Error).message }, { status: 502 }); }
    }) },
    "/api/lessons/stick": { POST: api(async (req) => {
      const { ref } = (await req.json()) as { ref: string };
      const l = allLessons().find((x) => x.ref === ref);
      const w = shipped().find((x) => x.ref === ref);
      if (!l || !w) return Response.json({ error: "no lesson for that PR" }, { status: 404 });
      try {
        const r = await startAgent({ item: `lesson-${w.feature}`, repo: l.repo, pr: null, kind: "custom", prompt: stickPrompt(l, w.url), edited: false, bare: true });
        if (!("dryRun" in r)) markStick(ref, r.name);
        return Response.json(r);
      } catch (e) { return Response.json({ error: (e as Error).message }, { status: 502 }); }
    }) },
    "/api/lessons/remove": { POST: api(async (req) => {
      const { ref } = (await req.json()) as { ref: string };
      removeLesson(ref);
      return Response.json({ ok: true });
    }) },
    "/api/sessions": api(async () => {
      await herdrReady();
      return Response.json({ sessions: sessions(snapshot().items) });
    }),
    "/api/aws": api(async () => Response.json(await awsSession())),
    "/api/aws/mfa": { POST: api(async (req) => {
      const { code } = (await req.json()) as { code: string };
      try { return Response.json(await refreshMfa(String(code ?? ""))); }
      catch (e) { return Response.json({ error: (e as Error).message }, { status: 502 }); }
    }) },
    "/api/history": api(() => Response.json({ entries: history() })),
    "/api/park": { POST: api(async (req) => {
      const { item, note, until } = (await req.json()) as { item: string; note: string | null; until: string | null };
      setPark(item, note, until ?? null);
      return Response.json({ ok: true });
    }) },
    "/api/start": {
      GET: api((req) => Response.json(suggest(new URL(req.url).searchParams.get("signal") ?? ""))),
      POST: api(async (req) => {
        const { signal, repo, unattended, triage, done, context, video } = (await req.json()) as { signal: string; repo: string; unattended: boolean; video?: boolean; triage?: boolean; done?: string; context?: string };
        try { return Response.json(await (triage ? startTriage(repo) : startFromSignal(signal, repo, !!unattended, done ?? "", context ?? "", !!video))); }
        catch (e) { return Response.json({ error: (e as Error).message }, { status: 502 }); }
      }),
    },
    "/api/suggestions": api(() => Response.json(suggestionsView())),
    "/api/suggestions/judge": { POST: api(async () => Response.json(await judgeSuggestions("suggestions view"))) },
    "/api/suggestions/architecture": { POST: api(async () => Response.json(await runArchitecture("suggestions view", archStart))) },
    "/api/suggestions/dismiss": { POST: api(async (req) => {
      const { key, reason } = (await req.json()) as { key: string; reason?: string };
      try { dismissSuggestion(String(key), reason ?? ""); return Response.json({ ok: true }); }
      catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
    }) },
    "/api/suggestions/pickup": { POST: api(async (req) => {
      const { key, repo, steps } = (await req.json()) as { key: string; repo: string; steps?: PickupSteps };
      try {
        return Response.json(await pickupSuggestion(String(key), String(repo), {
          start: (k, r) => startFromSignal(k, r, false), refresh: () => void refresh(),
          agent: (s) => startAgent({ item: s.key, repo: s.repo!, pr: null, kind: "custom", prompt: archAgentPrompt(s), edited: false }),
        }, steps ?? {}));
      } catch (e) { return Response.json({ error: (e as Error).message }, { status: 502 }); }
    }) },
    "/api/jira/transition": { POST: api(async (req) => {
      const { item, key, to } = (await req.json()) as { item: string | null; key: string; to: string };
      try { await moveJira(item ?? null, key, to); return Response.json({ ok: true }); }
      catch (e) { return Response.json({ error: (e as Error).message }, { status: 502 }); }
    }) },
    "/api/ask": { POST: api(async (req) => {
      const { item, text } = (await req.json()) as { item: string; text: string };
      try { await copyAsk(item, text); return Response.json({ ok: true }); }
      catch (e) { return Response.json({ error: (e as Error).message }, { status: 500 }); }
    }) },
    "/api/adopt": { POST: api(async (req) => {
      const { ref, note, item } = (await req.json()) as { ref: string; note: string | null; item: string | null };
      try { await adopt(ref, note, item ?? null); return Response.json({ ok: true }); }
      catch (e) { return Response.json({ error: (e as Error).message }, { status: 502 }); }
    }) },
    "/api/usage": {
      GET: api(() => Response.json(usage())),
      POST: api(async (req) => { setCoeffs(((await req.json()) as { coeffs: object }).coeffs ?? {}); return Response.json(usage()); }),
    },
    "/api/run": {
      GET: api((req) => {
        const run = runs().get(new URL(req.url).searchParams.get("key") ?? "");
        return run ? Response.json({ run, ...runFiles(run) }) : Response.json({ error: "no such run" }, { status: 404 });
      }),
      POST: api(async (req) => {
        const b = (await req.json()) as { key: string; item: string | null; dismiss?: boolean; file?: string; jira?: string };
        const run = runs().get(b.key);
        if (!run) return Response.json({ error: "no such run" }, { status: 404 });
        try {
          if (b.dismiss) { dismissRun(b.key, b.item); publish(); return Response.json({ ok: true }); }
          return Response.json({ result: await postComment(run, b.file ?? "", b.jira ?? "", b.item) });
        } catch (e) { return Response.json({ error: (e as Error).message }, { status: 502 }); }
      }),
    },
    "/guide/*": { GET: api((req) => guidePage(decodeURIComponent(new URL(req.url).pathname.slice("/guide/".length)))) },
    "/api/guide/link": { POST: api(async (req) => {
      const { item, ref } = (await req.json()) as { item: string; ref: string };
      const p = snapshot().items.find((x) => x.id === item)?.prs.find((x) => `${x.repo}#${x.number}` === ref && x.role === "mine");
      if (!p) return Response.json({ error: "not one of your PRs on that work item" }, { status: 404 });
      try { const r = await linkGuide(p); publish(); return Response.json(r); }
      catch (e) { return Response.json({ error: (e as Error).message }, { status: 502 }); }
    }) },
    "/api/guide/promote": { POST: api(async (req) => {
      const { item, ref } = (await req.json()) as { item: string; ref: string };
      const it = snapshot().items.find((x) => x.id === item);
      const p = it?.prs.find((x) => `${x.repo}#${x.number}` === ref);
      if (!it || !p) return Response.json({ error: "no such PR on that work item" }, { status: 404 });
      try { return Response.json(await promoteGuide(it.id, p)); }
      catch (e) { return Response.json({ error: (e as Error).message }, { status: 502 }); }
    }) },
    "/api/open": { POST: api(async (req) => {
      const { path } = (await req.json()) as { path: string };
      try { await openArtifact(path); return Response.json({ ok: true }); }
      catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
    }) },
    "/api/effort": { POST: api(async (req) => {
      const { key, effort } = (await req.json()) as { key: string; effort: string | null };
      setEffort(key, effort?.trim() || null);
      return Response.json({ ok: true });
    }) },
    "/api/dependency": { POST: api(async (req) => {
      const { ref, on, step, item } = (await req.json()) as { ref: string; on: string | null; step: string | null; item: string | null };
      setDependency(ref, on || null, step?.trim() || null, item ?? null);
      return Response.json({ ok: true });
    }) },
    "/api/move": { POST: api(async (req) => {
      const { ref, into, reset } = (await req.json()) as { ref: string; into: Move; reset?: boolean };
      setMove(ref, into ?? null, !!reset);
      return Response.json({ ok: true });
    }) },
    "/api/remove": { POST: api(async (req) => {
      const { item, keys, why } = (await req.json()) as { item: string; keys: string[]; why: string };
      try { await remove(item, keys, why ?? ""); return Response.json({ ok: true }); }
      catch (e) { return Response.json({ error: (e as Error).message }, { status: 502 }); }
    }) },
    "/api/removed": {
      GET: api(async () => {
        try { return Response.json({ entries: await removed(), file: "~/.claude/prs-exclude.txt" }); }
        catch (e) { return Response.json({ error: (e as Error).message }, { status: 502 }); }
      }),
      POST: api(async (req) => {
        const { key, why } = (await req.json()) as { key: string; why?: string };
        try {
          if (why !== undefined) await remove("", [key], why); // edit the reason: exclude again
          else await restore(key);
          return Response.json({ ok: true });
        } catch (e) { return Response.json({ error: (e as Error).message }, { status: 502 }); }
      }),
    },
    "/api/metrics": {
      GET: api(() => {
        const prs = prFacts();
        const events = db.query<Event, []>("SELECT at, item, kind, lane, step, detail FROM item_events ORDER BY at").all();
        return Response.json({
          from: METRICS_FROM, syncedAt: historySyncedAt(),
          weeks: weekly(prs, METRICS_FROM), features: features(prs, METRICS_FROM), friction: friction(events, METRICS_FROM),
          stages: { d30: stageTimes(prs, new Date(Date.now() - 30 * 86_400_000).toISOString()), all: stageTimes(prs, METRICS_FROM) },
          quality: quality(prs, qualityRecords(METRICS_FROM), shipped(), METRICS_FROM),
        });
      }),
      POST: api(async () => { await syncHistory(); return Response.json({ syncedAt: historySyncedAt() }); }),
    },
    "/api/loop": {
      GET: api(() => Response.json(loopState())),
      POST: api(async () => {
        try { return Response.json(await runLoop("metrics view")); }
        catch (e) { return Response.json({ error: (e as Error).message }, { status: 502 }); }
      }),
    },
    "/api/done": api(async () => {
      try { return Response.json(await accomplished()); }
      catch (e) { return Response.json({ error: (e as Error).message }, { status: 502 }); }
    }),
    "/api/cycle": { POST: api(async (req) => {
      const b = (await req.json()) as { item: string; ref: string; what: "run" | "off" | "on" | "send"; replies?: HeldReply[] };
      const p = snapshot().items.find((i) => i.id === b.item)?.prs.find((x) => `${x.repo}#${x.number}` === b.ref);
      try {
        if (b.what === "send") {
          if (!p) throw new Error(`${b.ref} isn't on the board`);
          const result = await sendHeld(b.item, p, b.replies ?? []);
          void refetch(b.ref);
          return Response.json({ result });
        }
        setLoop(b.ref, b.what, p, b.item ?? null);
        publish();
        return Response.json({ result: b.what === "run" ? "loop running" : `loop ${b.what}` });
      } catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
    }) },
    "/api/event": { POST: api(async (req) => {
      const { item, kind, step } = await req.json();
      try { recordEvent(item ?? null, kind, step ?? null); return Response.json({ ok: true }); }
      catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
    }) },
    "/api/nudge": { POST: api(async (req) => {
      const { reviewer, text } = await req.json();
      try { await nudge(reviewer, text); return Response.json({ ok: true }); }
      catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
    }) },
    "/api/act": { POST: api(async (req) => {
      const b = (await req.json()) as { item: string; pr: string; action: string; trigger?: string; reviewers?: string[]; replies?: Reply[]; threads?: { thread_id: string; who: string }[] };
      const p = snapshot().items.find((i) => i.id === b.item)?.prs.find((x) => `${x.repo}#${x.number}` === b.pr);
      if (!p) return Response.json({ error: `${b.pr} isn't on the board` }, { status: 404 });
      const ctx = { item: b.item, trigger: b.trigger ?? "detail" };
      try {
        const result =
          b.action === "rerun" ? await rerunCi(ctx, p)
          : b.action === "update" ? await updateBranch(ctx, p)
          : b.action === "mark" ? await markAddressed(ctx, p, "marked in the control room")
          : b.action === "rerequest" ? await rerequest(ctx, p, b.reviewers?.length ? b.reviewers : p.rerequest ?? [])
          : b.action === "reply" ? (await postReplies(ctx, p, b.replies ?? [])).join("; ")
          : b.action === "resolve" ? await resolveThreads(ctx, p, b.threads ?? [])
          : null;
        if (result === null) return Response.json({ error: `unknown action ${b.action}` }, { status: 400 });
        void refetch(b.pr);
        return Response.json({ result });
      } catch (e) {
        void refetch(b.pr);
        return Response.json({ error: (e as Error).message }, { status: 502 });
      }
    }) },
    "/api/review": {
      GET: api(async (req) => {
        const it = snapshot().items.find((i) => i.id === new URL(req.url).searchParams.get("item"));
        const p = it?.prs.find((x) => x.role === "requested");
        if (!it || !p) return Response.json({ error: "not a review request" }, { status: 404 });
        const drafts = readDrafts(`${p.repo}#${p.number}`);
        if (!drafts) return Response.json({ drafts: null });
        // Findings off the diff can't be posted inline; flag them rather than fail the whole review.
        let outside: number[] = [];
        try {
          const lines = await diffLines(p, drafts.sha || p.head);
          outside = drafts.findings.filter((f) => !lines.get(f.path)?.has(f.line)).map((f) => f.id);
        } catch {}
        return Response.json({ drafts, head: p.head, pushedSince: !!drafts.sha && drafts.sha !== p.head, outside });
      }),
    },
    "/api/review/post": { POST: api(async (req) => {
      const { item, picked, event } = (await req.json()) as { item: string; picked: Picked[]; event: "COMMENT" | "APPROVE" | "REQUEST_CHANGES" };
      const it = snapshot().items.find((i) => i.id === item);
      const p = it?.prs.find((x) => x.role === "requested");
      const drafts = p && readDrafts(`${p.repo}#${p.number}`);
      if (!p || !drafts) return Response.json({ error: "no drafts for this review request" }, { status: 404 });
      try {
        const url = await postReview(item, p, drafts, picked, event);
        void refetch(`${p.repo}#${p.number}`);
        return Response.json({ result: url });
      } catch (e) { return Response.json({ error: (e as Error).message }, { status: 502 }); }
    }) },
    "/api/review/recheck": { POST: api(async (req) => {
      const { item } = await req.json();
      const it = snapshot().items.find((i) => i.id === item);
      const p = it?.prs.find((x) => x.role === "requested");
      const a = it?.agents.find((x) => x.status !== "working") ?? it?.agents[0];
      if (!p || !a) return Response.json({ error: "no review agent on this item" }, { status: 404 });
      try {
        await sendToAgent(a.pane, `The author pushed since your review; the PR head is now ${p.head}. Pull it, re-check each finding against the new code, drop the ones that are fixed, and rewrite the drafts file pinned to the new commit.`, item);
        return Response.json({ result: `asked ${a.name ?? a.label} to re-check` });
      } catch (e) { return Response.json({ error: (e as Error).message }, { status: 502 }); }
    }) },
    "/api/agent/send": { POST: api(async (req) => {
      const { pane, text, item } = await req.json();
      try { await sendToAgent(pane, text, item ?? null); return Response.json({ ok: true }); }
      catch (e) { return Response.json({ error: (e as Error).message }, { status: 502 }); }
    }) },
    "/api/agent/type": { POST: api(async (req) => {
      const { pane, ops, item } = (await req.json()) as { pane: string; ops: Typed[]; item: string | null };
      try { await typeInto(pane, ops, item ?? null); return Response.json({ ok: true }); }
      catch (e) { return Response.json({ error: (e as Error).message }, { status: 502 }); }
    }) },
    "/api/agent/keys": { POST: api(async (req) => {
      const { pane, keys, item } = (await req.json()) as { pane: string; keys: string[]; item: string | null };
      try { await sendKeys(pane, keys, item ?? null); return Response.json({ ok: true }); }
      catch (e) { return Response.json({ error: (e as Error).message }, { status: 502 }); }
    }) },
    "/api/hold": { POST: api(async (req) => {
      const { item, note } = (await req.json()) as { item: string; note: string | null };
      const it = snapshot().items.find((i) => i.id === item);
      const p = it?.prs[0];
      if (!it || it.keyKind !== "review" || !p) return Response.json({ error: "only review requests can wait on their author" }, { status: 400 });
      const ref = `${p.repo}#${p.number}`;
      try { setHold(ref, note); } catch (e) { return Response.json({ error: (e as Error).message }, { status: 400 }); }
      // The agents' "finished" was the reason it needed the user; waiting on the author answers it.
      if (note !== null) for (const a of it.agents) if (a.status === "done" || a.finishedSeq !== null) dismissAgent(a.pane, it.id);
      recordNote({ item: it.id, trigger: "detail" }, note === null ? "stop-waiting" : "wait-on-author", ref, note ?? "");
      return Response.json({ ok: true });
    }) },
    "/api/handoff": {
      GET: api((req) => {
        const it = snapshot().items.find((i) => i.id === new URL(req.url).searchParams.get("item"));
        if (!it) return Response.json({ error: "no such work item" }, { status: 404 });
        const repos = [...new Set([...it.prs.map((p) => p.repo.split("/").pop()!), ...it.agents.flatMap((a) => (a.repo ? [a.repo] : []))])];
        return Response.json({ tasks: tasksFor(it), repos });
      }),
      POST: api(async (req) => {
        try { return Response.json(await startAgent((await req.json()) as StartRequest)); }
        catch (e) { return Response.json({ error: (e as Error).message }, { status: 502 }); }
      }),
    },
    "/api/agent/dismiss": { POST: api(async (req) => {
      const { pane, item, viewed } = await req.json();
      dismissAgent(pane, item ?? null, viewed ? "seen (viewed in the control room)" : "seen");
      return Response.json({ ok: true });
    }) },
    "/api/agent/close": { POST: api(async (req) => {
      const { pane, item } = await req.json();
      try { return Response.json(await closeAgent(pane, item ?? null)); }
      catch (e) { return Response.json({ error: (e as Error).message }, { status: 502 }); }
    }) },
    "/api/agent/focus": { POST: api(async (req) => {
      const { pane } = await req.json();
      try { return Response.json(await focusAgent(pane)); }
      catch (e) { return Response.json({ error: (e as Error).message }, { status: 502 }); }
    }) },
  },
  fetch(req) {
    return guard(req, { needCookie: false }) ?? new Response("not found", { status: 404 });
  },
});

console.log(`control room on http://${server.hostname}:${server.port}${DEV ? " (dev)" : ""}`);
start();
startHistory();
startShipped();
startLoop();
startSuggestions(() => snapshot().items, publish, archStart);
if (!DEV) startCleanup();
