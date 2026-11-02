// Layout check: runs a dev server from this checkout, opens the board in headless Chrome at two
// widths, walks the views (board, a work item, an expanded pane, Sessions, Tidy, Metrics) and fails
// when something overlaps, the page scrolls sideways, or a pane is squeezed shut. bin/deploy.sh runs
// it before installing; `bun scripts/layout-check.ts` runs it alone. Screenshots of failures land in
// $TMPDIR/control-room-layout.
import { mkdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const PORT = 4791;
const CDP = 9334;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const OUT = join(process.env.TMPDIR ?? "/tmp", "control-room-layout");
const WIDTHS: [number, number][] = [[1500, 950], [1280, 800], [700, 900]];
// At this width only the Docs Visuals grid and viewer are checked.
const NARROW = 700;

/** Runs in the page: what's wrong with the layout as it stands. */
const CHECK = `(() => {
  const problems = [];
  const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 2 && r.height > 2 && s.visibility !== "hidden" && s.display !== "none" && +s.opacity !== 0; };
  const name = (e) => (e.className && typeof e.className === "string" ? "." + e.className.trim().split(/\\s+/).slice(0, 2).join(".") : e.tagName.toLowerCase()) + (e.textContent ? " '" + e.textContent.trim().slice(0, 24) + "'" : "");
  if (document.documentElement.scrollWidth > innerWidth + 1) problems.push("the page scrolls sideways: " + document.documentElement.scrollWidth + "px wide in " + innerWidth);
  for (const p of document.querySelectorAll(".pane")) if (vis(p) && p.getBoundingClientRect().height < 60) problems.push("pane squeezed to " + Math.round(p.getBoundingClientRect().height) + "px: " + name(p.querySelector("h3") ?? p));
  // Controls cut off: outside something that clips them, with no scrolling that reaches them.
  const reachable = (c) => {
    const r = c.getBoundingClientRect();
    for (let a = c.parentElement; a; a = a.parentElement) {
      const st = getComputedStyle(a);
      const clips = /hidden|clip|auto|scroll/.test(st.overflowY);
      if (!clips) continue;
      const ar = a.getBoundingClientRect();
      if (r.top >= ar.top - 2 && r.bottom <= ar.bottom + 2) continue;
      return /auto|scroll/.test(st.overflowY) && a.scrollHeight > a.clientHeight + 1;
    }
    return r.bottom <= innerHeight + 2 || document.documentElement.scrollHeight > innerHeight + 1;
  };
  for (const p of document.querySelectorAll(".pane, .lifted, .wide-head, .sess-row")) {
    if (!vis(p)) continue;
    for (const c of p.querySelectorAll("button, input, textarea, select")) if (vis(c) && !reachable(c)) problems.push("cut off in " + name(p.querySelector("h3") ?? p).slice(0, 40) + ": " + name(c));
  }
  // Where things overlap: blocks that sit side by side or stacked inside one container.
  const BLOCKS = "button, a.btn, .console, .keybar, .reply, .meta, .typehint, input, textarea, select, table, .chip, h1, h3, .txt, .why";
  for (const box of document.querySelectorAll(".pane, .lifted, .sess-row, .tidy-head, .wide-head, .panetabs, header.top, .sheet, .vfilters, .vcard, .vv-head, .vzoom")) {
    if (!vis(box)) continue;
    const els = [...box.querySelectorAll(BLOCKS)].filter(vis).filter((e) => !e.closest(".console") || e.classList.contains("console"));
    const rs = els.map((e) => e.getBoundingClientRect());
    for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) {
      if (els[i].contains(els[j]) || els[j].contains(els[i])) continue;
      const a = rs[i], b = rs[j];
      const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      // Clipped by a scroll container: only what shows counts.
      if (w > 3 && h > 3) {
        const clip = (e, r) => { let c = e.parentElement; while (c && c !== box.parentElement) { const s = getComputedStyle(c); if (/auto|scroll|hidden/.test(s.overflowY + s.overflowX)) { const cr = c.getBoundingClientRect(); if (r.bottom <= cr.top || r.top >= cr.bottom) return true; } c = c.parentElement; } return false; };
        if (!clip(els[i], a) && !clip(els[j], b)) problems.push("overlap in " + name(box).slice(0, 40) + ": " + name(els[i]) + " and " + name(els[j]));
      }
    }
  }
  return [...new Set(problems)].slice(0, 12);
})()`;

async function cdp(width: number, height: number) {
  const profile = join(OUT, `profile-${width}`);
  const proc = Bun.spawn([CHROME, "--headless=new", `--remote-debugging-port=${CDP}`, `--window-size=${width},${height}`, `--user-data-dir=${profile}`, "about:blank"], { stdout: "ignore", stderr: "ignore" });
  for (let i = 0; i < 60; i++) { try { await fetch(`http://127.0.0.1:${CDP}/json/version`); break; } catch { await Bun.sleep(250); } }
  const tabs = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json();
  const ws = new WebSocket(tabs.find((t: any) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const pending = new Map<number, (v: any) => void>();
  ws.onmessage = (m) => { const d = JSON.parse(String(m.data)); if (d.id && pending.has(d.id)) { pending.get(d.id)!(d.result); pending.delete(d.id); } };
  const send = (method: string, params: any = {}) => new Promise<any>((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  const evaluate = async (expression: string) => (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.value;
  const key = async (k: string) => { for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: k, text: type === "keyDown" && k.length === 1 ? k : undefined }); };
  const shot = async (file: string) => Bun.write(file, Buffer.from((await send("Page.captureScreenshot", { format: "png" })).data, "base64"));
  await send("Page.enable");
  return { send, evaluate, key, shot, close: () => { ws.close(); proc.kill(); } };
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const server = Bun.spawn(["bun", "src/server/main.ts"], { cwd: ROOT, env: { ...process.env, CR_DEV: "1", CR_PORT: String(PORT) }, stdout: "ignore", stderr: "ignore" });
  const failures: string[] = [];
  try {
    for (let i = 0; i < 80; i++) { try { await fetch(`http://127.0.0.1:${PORT}/`); break; } catch { await Bun.sleep(250); } }
    const boot = Bun.spawnSync(["bun", "-e", 'import {bootstrapUrl} from "./src/server/security"; console.log(bootstrapUrl())'], { cwd: ROOT, env: { ...process.env, CR_DEV: "1", CR_PORT: String(PORT) } });
    const url = boot.stdout.toString().trim();
    if (!url.startsWith("http")) throw new Error(`no bootstrap url: ${boot.stderr.toString().trim()}`);
    for (const [w, h] of WIDTHS) {
      const b = await cdp(w, h);
      try {
        await b.send("Page.navigate", { url });
        await Bun.sleep(3500);
        const look = async (view: string) => {
          await Bun.sleep(1200);
          const ps: string[] = (await b.evaluate(CHECK)) ?? [];
          if (process.env.LAYOUT_DEBUG) { await b.shot(join(OUT, `debug-${w}-${view.replace(/\W+/g, "-")}.png`)); console.log(w, view, ps); }
          if (ps.length) {
            const file = join(OUT, `${w}-${view.replace(/\W+/g, "-")}.png`);
            await b.shot(file);
            failures.push(...ps.map((p) => `${w}px ${view}: ${p}`), `  screenshot: ${file}`);
          }
        };
        const visuals = async () => {
          await b.key("d");
          await Bun.sleep(1500);
          await b.evaluate(`[...document.querySelectorAll(".docs .seg button")].find((x) => x.textContent.startsWith("Visuals"))?.click()`);
          await look("Docs Visuals");
          const opened = await b.evaluate(`(() => { const c = document.querySelector(".vcard"); c?.click(); return !!c; })()`);
          if (opened) {
            await look("Visual viewer");
            if (!(await b.evaluate(`!!document.querySelector(".vviewer .vpz img, .vviewer .empty")`))) failures.push(`${w}px Visual viewer: no chart shows`);
            await b.key("Escape");
            await Bun.sleep(300);
          }
          await b.key("Escape");
          await Bun.sleep(300);
        };
        if (w === NARROW) { await visuals(); continue; }
        await look("board");
        // The first few work items: the detail pane is where most of the layout lives.
        // The items that stress the layout: the most PRs, the most agents, a review request.
        const ids: string[] = (await b.evaluate(`fetch("/api/snapshot").then((r) => r.json()).then((s) => {
          const by = (f) => [...s.items].sort((a, b) => f(b) - f(a))[0]?.id;
          return [...new Set([by((i) => i.prs.length), by((i) => i.agents.length), s.items.find((i) => i.keyKind === "review")?.id].filter(Boolean))]
            .filter((id) => document.querySelector('[data-item="' + id + '"]'));
        })`)) ?? [];
        for (const id of ids) {
          await b.evaluate(`document.querySelector('[data-item="${id}"]').click()`);
          await look(`item ${id}`);
        }
        if (ids.length) { await b.key("z"); await look("expanded pane"); await b.key("Escape"); }
        for (const [k, view] of [["c", "Sessions"], ["t", "Tidy"], ["i", "Metrics"], ["d", "Docs"]] as const) {
          await b.key(k);
          await Bun.sleep(1500);
          await look(view);
          await b.key("Escape");
          await Bun.sleep(300);
        }
        await visuals();
      } finally {
        b.close();
      }
    }
  } finally {
    server.kill();
  }
  if (failures.length) {
    console.error(`layout check failed:\n${failures.map((f) => `  ${f}`).join("\n")}`);
    process.exit(1);
  }
  console.log("layout check passed");
}

await main();
