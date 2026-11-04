// The world: the board as a town after the 2007 game client, for the Old School RS skin. Items that need the
// user are scrolls on the Quest board by the fountain; agents skill at the step they're on, drink in the Inn when idle,
// and wait in the square when they need the user; the buildings are pages. Loaded only when opened, so the
// board never carries Three.js.
import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { WorkItem } from "../../shared/types";
import { AREA_STEP, type Giver, givers as giversOf, type Mode, place, type Townsfolk, townsfolk, VERB } from "./agents";
import { AREAS, BOARD, BONFIRE, BUILDINGS, type Building, CX, CZ, doorOf, findPath, H, heightAt, rnd, signOf, slotAt, type Skill, type Spot, W, WILD_Z, Z0 } from "./map";
import { keeper, outfit, type Bit, buildTown, burst, smoke, sparkle, hintArrow, scroll, MM, minimapImage, mmz, person, type Person, SHIRTS, tool } from "./scene";
import { type Gain, LEVEL_XP, levelOf, readXp, XP_EVENT, XP_SKILLS, type XpEvent } from "./xp";

type Target = { kind: "giver"; g: Giver } | { kind: "agent"; a: Townsfolk & { area: string; mode: Mode } } | { kind: "building"; b: Building } | { kind: "ground"; x: number; z: number };
type Opt = { verb: string; what?: string; tone?: "npc" | "obj" | "player"; run: () => void };
type Line = { t: string; c?: "blue" | "red" | "you" };
type Dialog = { title: string; options: { label: string; run: () => void }[] };
export type WorldProps = {
  items: WorkItem[];
  /** Opens an item on the board. */
  onOpen: (id: string) => void;
  onBuilding: (id: Building["id"]) => void;
  onPrimary: (it: WorkItem) => void;
  onSheet: (kind: "park" | "move" | "ask", it: WorkItem) => void;
  onClose: () => void;
};

const post = (path: string, body: unknown): Promise<{ error?: string; [k: string]: unknown }> =>
  fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((x) => x.json()).catch(() => ({ error: "server unreachable" }));
const DEMO = new URLSearchParams(location.search).has("demo");
type Opts = { names: boolean; hideRoofs: boolean; overlays: boolean };
const OPTS: Opts = { names: true, hideRoofs: true, overlays: true };
const loadOpts = (): Opts => { try { return { ...OPTS, ...JSON.parse(localStorage.getItem("cr-world") ?? "{}") }; } catch { return OPTS; } };

/** A path's end pulled back toward where it came from, to stop beside someone rather than on them. */
function short(path: [number, number][], from: [number, number], by: number): [number, number][] {
  if (!path.length) return path;
  const [px, pz] = path.length > 1 ? path[path.length - 2] : from, [ex, ez] = path[path.length - 1], d = Math.hypot(ex - px, ez - pz);
  if (d <= by) return path.slice(0, -1).length ? path.slice(0, -1) : [[px, pz]];
  return [...path.slice(0, -1), [ex - ((ex - px) / d) * by, ez - ((ez - pz) / d) * by]];
}

export default function World({ items, onOpen, onBuilding, onPrimary, onSheet, onClose }: WorldProps) {
  const view = useRef<HTMLDivElement>(null);
  const mm = useRef<HTMLCanvasElement>(null);
  const chatIn = useRef<HTMLInputElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const api = useRef<{ pick: (cx: number, cy: number) => Target | null; walk: (x: number, z: number, then?: () => void, stopShort?: number) => boolean; north: () => void; where: (pane: string) => [number, number] | null } | null>(null);
  const [hover, setHover] = useState<Target | null>(null);
  const hoverRef = useRef<string | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; opts: Opt[] } | null>(null);
  const [marks, setMarks] = useState<{ id: number; x: number; y: number; red: boolean }[]>([]);
  const [chat, setChat] = useState<Line[]>([{ t: "Welcome to the control room." }, { t: "Everyone you see is an agent. What needs you is pinned on the Quest board north of the fountain: yellow pins are your turn, red are asked of you, most pressing top left.", c: "blue" }]);
  const say = (t: string, c?: Line["c"]) => setChat((x) => [...x.slice(-30), { t, c }]);
  const [dialog, setDialog] = useState<Dialog | null>(null);
  // The chat box keeps its newest line in view.
  useEffect(() => { const el = log.current; if (el) el.scrollTop = el.scrollHeight; }, [chat, dialog]);
  const [talkTo, setTalkTo] = useState<Townsfolk | null>(null);
  // Talking to an agent: its recap and last turn in the chat box, kept fresh while it's open.
  type Said = { recap: string | null; recapAt: string | null; turn: string | null; at: string | null };
  const [said, setSaid] = useState<Said | null>(null);
  const loadSaid = (pane: string) => void fetch(`/api/agent/turn?pane=${encodeURIComponent(pane)}`).then((r) => r.json()).then((t) => setSaid(t.error ? { recap: null, recapAt: null, turn: null, at: null } : t)).catch(() => {});
  useEffect(() => {
    if (!talkTo) return;
    setSaid(null); loadSaid(talkTo.pane);
    const t = setInterval(() => loadSaid(talkTo.pane), 5000);
    return () => clearInterval(t);
  }, [talkTo?.pane]);
  useEffect(() => { const el = log.current; if (el) el.scrollTop = el.scrollHeight; }, [said]);
  const [draft, setDraft] = useState("");
  const [tab, setTab] = useState<"quests" | "stats" | "options">("quests");
  const [xp, setXp] = useState(readXp);
  const [drops, setDrops] = useState<(Gain & { id: number })[]>([]);
  const fireworks = useRef(0);
  const [noGl, setNoGl] = useState(false);
  const [opts, setOpts] = useState<Opts>(loadOpts);
  const optsRef = useRef(opts); optsRef.current = opts;
  const flip = (k: keyof Opts) => setOpts((o) => { const n = { ...o, [k]: !o[k] }; try { localStorage.setItem("cr-world", JSON.stringify(n)); } catch {} return n; });
  // The demo reshuffles every 20s; re-render now and then to pick that up.
  const [, setTick] = useState(0);
  useEffect(() => { if (!DEMO) return; const t = setInterval(() => setTick((n) => n + 1), 5000); return () => clearInterval(t); }, []);
  const givers = giversOf(items), byId = new Map(items.map((i) => [i.id, i]));
  const giversRef = useRef(givers); giversRef.current = givers;
  const folk = townsfolk(items, DEMO ? Math.floor(Date.now() / 20000) : null);
  const folkRef = useRef(folk); folkRef.current = folk;
  const asking = folk.filter((a) => a.status === "blocked");

  // XP from the board: drops float up, a level-up or a ship sets off fireworks.
  useEffect(() => {
    const on = (e: Event) => {
      const { gains: gs, ups } = (e as CustomEvent<XpEvent>).detail;
      setXp(readXp());
      const stamp = Date.now();
      const ds = gs.map((g, i) => ({ ...g, id: stamp + i }));
      setDrops((d) => [...d, ...ds]);
      setTimeout(() => setDrops((d) => d.filter((x) => !ds.includes(x))), 1800);
      for (const g of gs) if (g.shipped) { say(`You shipped ${g.why.replace(/^shipped /, "")}! Well done.`, "blue"); fireworks.current += 6; }
      for (const u of ups) { say(`Congratulations, you just advanced a ${u.skill} level.`, "blue"); say(`Your ${u.skill} level is now ${u.level}.`, "blue"); fireworks.current += 8; }
    };
    window.addEventListener(XP_EVENT, on);
    if (!DEMO) return () => window.removeEventListener(XP_EVENT, on);
    const fake: Gain[] = [{ skill: "Testing", xp: 25, why: "CI passed on widgets#7" }, { skill: "Reviewing", xp: 40, why: "widgets#7 approved" }, { skill: "Building", xp: 30, why: "an agent finished" }, { skill: "Shipping", xp: 100, why: "shipped DEMO-1", shipped: true }];
    let n = 0;
    const t = setInterval(() => window.dispatchEvent(new CustomEvent<XpEvent>(XP_EVENT, { detail: { gains: [fake[n % fake.length]], ups: n++ % 5 === 4 ? [{ skill: "Building", level: 7 }] : [] } })), 9000);
    return () => { window.removeEventListener(XP_EVENT, on); clearInterval(t); };
  }, []);

  // A line in the chat box when an agent's status changes.
  const was = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    const now = new Map(folk.map((a) => [a.pane, a.status]));
    if (was.current) for (const a of folk) {
      const before = was.current.get(a.pane);
      if (before === a.status) continue;
      if (a.status === "blocked") say(`${a.label} needs your help with ${a.itemKey}.`, "red");
      else if (a.status === "working") say(`${a.label} gets to work on ${a.itemKey}: ${a.detail}.`);
      else if (a.status === "done" && before) say(`${a.label} has finished on ${a.itemKey}.`, "blue");
    }
    was.current = now;
  }, [folk.map((a) => a.pane + a.status).join()]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      if (menu) setMenu(null); else if (dialog) setDialog(null); else if (document.activeElement === chatIn.current && draft) setDraft(""); else if (talkTo) setTalkTo(null); else onClose();
    };
    document.addEventListener("keydown", k, true);
    return () => document.removeEventListener("keydown", k, true);
  }, [onClose, menu, dialog, draft, talkTo]);

  useEffect(() => {
    const host = view.current!;
    let renderer: THREE.WebGLRenderer;
    try { renderer = new THREE.WebGLRenderer({ antialias: false }); } catch { setNoGl(true); return; }
    renderer.setClearColor(0x000000);
    host.prepend(renderer.domElement);
    const { scene, ground, roofs, walls } = buildTown();
    const MAP = minimapImage();
    const bits: Bit[] = [];

    // You: walk a path, at running pace.
    const me = person(0xb8b8b8, 0x4a3a2a);
    const pos = { x: CX + 0.5, z: CZ + 3.2, path: [] as [number, number][], then: null as null | (() => void), face: 0 };
    scene.add(me.g);
    // The Inn's bartender, wiping the bar.
    // And the Bank's teller, counting coin, and the Library's librarian, reading.
    const keepers = (["bartender", "teller", "librarian"] as const).map((k) => {
      const p = keeper(k), b = BUILDINGS.find((x) => x.id === ({ bartender: "sessions", teller: "finished", librarian: "docs" } as const)[k])!;
      p.g.traverse((o) => { o.userData.target = { kind: "building", b }; });
      scene.add(p.g);
      return { k, p };
    });

    // The Quest board: a scroll per item that needs you, and an arrow over it, red when something's asked of you.
    const scrolls = new Map<string, { g: THREE.Group; lane: string }>();
    const boardY = heightAt(BOARD.x, BOARD.z);
    let arrow: THREE.Group | null = null, arrowLane = "";
    const syncNpcs = () => {
      const pinned = giversRef.current.filter((g) => g.slot !== null);
      const want = new Set(pinned.map((g) => g.id));
      for (const [id, s] of scrolls) if (!want.has(id)) { scene.remove(s.g); scrolls.delete(id); }
      for (const gv of pinned) {
        let s = scrolls.get(gv.id);
        if (s && s.lane !== gv.lane) { scene.remove(s.g); s = undefined; }
        if (!s) { s = { g: scroll(gv.lane === "mine" ? 0xe8c020 : 0xd82a1a), lane: gv.lane }; scene.add(s.g); scrolls.set(gv.id, s); }
        const [sx, sy, sz] = slotAt(gv.slot!);
        s.g.position.set(sx, boardY + sy, sz); s.g.rotation.z = (rnd(gv.id.length * 7 + gv.id.charCodeAt(0)) - 0.5) * 0.12;
        s.g.traverse((o) => { o.userData.target = { kind: "giver", g: gv }; });
      }
      const lane = !giversRef.current.length ? "" : giversRef.current.some((g) => g.lane === "asked") ? "asked" : "mine";
      if (lane !== arrowLane) {
        if (arrow) scene.remove(arrow);
        arrow = lane ? hintArrow(lane === "asked" ? 0xff2a1a : 0xffff00) : null;
        if (arrow) scene.add(arrow);
        arrowLane = lane;
      }
      const more = giversRef.current.length - pinned.length;
      tag("board", "task", [{ t: `Quest board · ${giversRef.current.length ? `${giversRef.current.length} need you` : "nothing needs you"}${more > 0 ? `, ${more} more in the Quest List` : ""}` }], BOARD.x, boardY, BOARD.z + 0.5);
    };

    // Text over the world (names, overhead chat, task plates, area signs) is HTML at screen resolution, placed each frame.
    const layer = document.createElement("div"); layer.className = "world-labels"; host.appendChild(layer);
    const tags = new Map<string, { el: HTMLDivElement; at: THREE.Vector3; kind: string }>();
    const tag = (key: string, kind: string, lines: { t: string; c?: string }[], x: number, y: number, z: number) => {
      let t = tags.get(key);
      if (!t) { const el = document.createElement("div"); layer.appendChild(el); t = { el, at: new THREE.Vector3(), kind: "" }; tags.set(key, t); }
      if (t.kind !== kind) { t.el.className = `wl ${kind.split(" ").map((k) => `wl-${k}`).join(" ")}`; t.kind = kind; }
      const sig = JSON.stringify(lines);
      if (t.el.dataset.sig !== sig) { t.el.dataset.sig = sig; t.el.replaceChildren(...lines.map((l) => { const d = document.createElement("div"); d.textContent = l.t; if (l.c) d.className = l.c; return d; })); }
      t.at.set(x, y, z); return t;
    };
    const untag = (key: string) => { tags.get(key)?.el.remove(); tags.delete(key); };

    // Agents: each walks to where its status puts it, round things and through doors, then does that there.
    type Fig = { p: Person; held: THREE.Group | null; heldKind: string | null; skill: Skill | null; mode: Mode; spot: Spot; x: number; z: number; path: [number, number][]; seed: number; hit: number;
      label: string; foe: string | null; role: "attack" | "defend" | null; hp: number; dying: number | null; cheer: number; task: string | null; dress: THREE.Object3D | null };
    const figs = new Map<string, Fig>();
    const areasNow = new Set<string>();
    const bars = new Map<string, { el: HTMLDivElement; at: THREE.Vector3 }>();
    const bar = (pane: string, hp: number, x: number, y: number, z: number) => {
      let b = bars.get(pane);
      if (!b) { const el = document.createElement("div"); el.className = "wl hpbar"; el.appendChild(document.createElement("i")); layer.appendChild(el); b = { el, at: new THREE.Vector3() }; bars.set(pane, b); }
      (b.el.firstChild as HTMLElement).style.width = `${Math.round(hp * 100)}%`; b.at.set(x, y, z);
    };
    const dropBar = (pane: string) => { bars.get(pane)?.el.remove(); bars.delete(pane); };
    const splats: { el: HTMLDivElement; at: THREE.Vector3; until: number }[] = [];
    const splat = (x: number, y: number, z: number, dmg: number) => {
      const el = document.createElement("div"); el.className = `wl splat ${dmg ? "hit" : "miss"}`; el.textContent = String(dmg); layer.appendChild(el);
      splats.push({ el, at: new THREE.Vector3(x + (Math.random() - 0.5) * 0.3, y, z), until: performance.now() + 1000 });
    };
    const syncAgents = () => {
      const placed = place(folkRef.current), want = new Set(placed.map((x) => x.a.pane));
      for (const [k, f] of figs) {
        if (want.has(k) || f.dying !== null) continue;
        for (const t of ["name", "chat", "task"]) untag(`${t}:${k}`);
        // A self-review gone mid-fight: its findings were taken. It loses: it falls, and fades in the frame loop.
        if (f.mode === "fight") {
          const w = f.foe ? figs.get(f.foe) : null;
          f.dying = performance.now(); f.hp = 0; f.path = [];
          if (w) w.cheer = performance.now();
          say(`${w?.label ?? "Its PR's session"} has defeated ${f.label}! The review's findings are back with ${w?.label ?? "it"}.`, "blue");
          continue;
        }
        scene.remove(f.p.g); dropBar(k); figs.delete(k);
      }
      for (const { a, skill, mode, s, foe, role } of placed) {
        let f = figs.get(a.pane);
        if (!f) {
          const seed = rnd([...a.pane].reduce((n, c) => n * 31 + c.charCodeAt(0), 7) % 9973);
          f = { p: person(SHIRTS[Math.floor(seed * SHIRTS.length)], 0x2a2a3a, seed), held: null, heldKind: null, skill, mode, spot: s, x: s.x, z: s.z, path: [], seed, hit: 0, label: a.label, foe: null, role: null, hp: 1, dying: null, cheer: 0, task: null, dress: null };
          scene.add(f.p.g); figs.set(a.pane, f);
        }
        // Dressed for its task.
        if (a.task !== f.task) { if (f.dress) f.p.g.remove(f.dress); f.dress = outfit(a.task); f.p.g.add(f.dress); f.task = a.task; }
        if (Math.hypot(f.spot.x - s.x, f.spot.z - s.z) > 0.05) { const p = findPath(f.x, f.z, s.x, s.z); f.path = p.length ? p : [[s.x, s.z]]; }
        if (mode !== "fight" || f.mode !== "fight") f.hp = 1;
        f.spot = s; f.skill = skill; f.mode = mode; f.label = a.label; f.foe = foe ?? null; f.role = role ?? null;
        // A sword for the implementer, a staff for the self-review; tools at work, a mug at the Inn.
        const kind = mode === "fight" ? (role === "attack" ? "sword" : "staff") : skill ?? (mode === "drink" ? "mug" : null);
        if (kind !== f.heldKind) { if (f.held) f.p.armR.remove(f.held); f.held = kind ? tool(kind as Skill | "mug" | "sword" | "staff") : null; if (f.held) f.p.armR.add(f.held); f.heldKind = kind; }
        const t = { kind: "agent" as const, a: { ...a, area: s.area, mode } };
        f.p.g.traverse((o) => { o.userData.target = t; });
        tag(`name:${a.pane}`, "name", [{ t: a.label }], f.x, 0, f.z);
        // A resting agent's plate shows only on hover: the Inn's sign already says they're resting.
        const open = hoverRef.current === a.pane, doing = mode === "drink" ? "Resting" : mode === "ask" ? "Waiting on you" : mode === "fight" ? (role === "attack" ? "Fighting the review" : "Self-review") : mode === "pray" ? "Waiting on review" : mode === "burn" ? "Spent" : a.step;
        if (mode === "drink" && !open) untag(`task:${a.pane}`);
        else tag(`task:${a.pane}`, open ? "task open" : "task", [{ t: `${a.itemKey} · ${doing}`, c: "h" },
          ...(open ? [{ t: a.itemTitle }, ...(mode === "skill" ? [{ t: `Now: ${a.detail}` }] : mode === "pray" ? [{ t: `Waiting on ${a.awaiting}` }] : mode === "burn" ? [{ t: `Done: ${a.spent}` }] : []), { t: `Agent: ${a.label}${a.branch ? ` on ${a.branch}` : ""}`, c: "dim" }] : [])], f.x, 0, f.z);
        if (mode === "ask") tag(`chat:${a.pane}`, "chat", [{ t: "I need your help!" }], f.x, 0, f.z); else untag(`chat:${a.pane}`);
      }
      // Area signs: each area in use names the step of the work done there.
      const count = new Map<string, number>();
      for (const { s, mode } of placed) if (mode !== "ask") count.set(s.area, (count.get(s.area) ?? 0) + 1);
      for (const area of areasNow) if (!count.has(area)) { untag(`area:${area}`); areasNow.delete(area); }
      for (const [area, n] of count) {
        const [x, z] = AREAS[area] ?? [CX, CZ];
        tag(`area:${area}`, "area", [{ t: area.replace(/ (north|south)$/, ""), c: "h" }, { t: `${AREA_STEP[area] ?? ""} · ${n}` }], x, Math.max(heightAt(x, z), 0) + 3.6, z);
        areasNow.add(area);
      }
    };

    // Camera: yaw and pitch round you, turned with the arrow keys or middle-drag, zoomed with the wheel.
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 200);
    const cam = { yaw: 0.6, pitch: 0.82, dist: 17 };
    const keys = new Set<string>();
    const kd = (e: KeyboardEvent) => { if (e.key.startsWith("Arrow") && document.activeElement !== chatIn.current) { keys.add(e.key); e.preventDefault(); } };
    const ku = (e: KeyboardEvent) => keys.delete(e.key);
    window.addEventListener("keydown", kd); window.addEventListener("keyup", ku);
    const wheel = (e: WheelEvent) => { e.preventDefault(); cam.dist = Math.max(8, Math.min(28, cam.dist + e.deltaY * 0.02)); };
    host.addEventListener("wheel", wheel, { passive: false });
    let drag: { x: number; y: number } | null = null;
    const pd = (e: PointerEvent) => { if (e.button === 1) { drag = { x: e.clientX, y: e.clientY }; e.preventDefault(); } };
    const pm = (e: PointerEvent) => { if (!drag) return; cam.yaw -= (e.clientX - drag.x) * 0.008; cam.pitch = Math.max(0.45, Math.min(1.35, cam.pitch + (e.clientY - drag.y) * 0.006)); drag = { x: e.clientX, y: e.clientY }; };
    const pu = () => { drag = null; };
    host.addEventListener("pointerdown", pd); window.addEventListener("pointermove", pm); window.addEventListener("pointerup", pu);
    // Rendered small and scaled up, for the client's chunky pixels.
    const size = () => {
      const w = host.clientWidth, h = host.clientHeight, s = Math.min(1, 760 / Math.max(1, w));
      renderer.setPixelRatio(1); renderer.setSize(Math.max(1, Math.round(w * s)), Math.max(1, Math.round(h * s)), false);
      camera.aspect = w / Math.max(1, h); camera.updateProjectionMatrix();
    };
    const ro = new ResizeObserver(size); ro.observe(host); size();
    const ray = new THREE.Raycaster();
    api.current = {
      pick: (cx, cy) => {
        const r = host.getBoundingClientRect();
        ray.setFromCamera(new THREE.Vector2(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), camera);
        for (const h of ray.intersectObjects(scene.children, true)) {
          if (!h.object.visible || (h.object as THREE.Mesh).material && ((h.object as THREE.Mesh).material as THREE.Material).opacity < 0.5) continue;
          const t = h.object.userData.target as Target | undefined;
          if (t) return t;
          if (h.object === ground) return { kind: "ground", x: h.point.x, z: h.point.z };
        }
        return null;
      },
      walk: (x, z, then, stopShort = 0) => {
        const p = findPath(pos.x, pos.z, Math.max(0.5, Math.min(W - 0.5, x)), Math.max(Z0 + 0.5, Math.min(H - 0.5, z)));
        if (!p.length) return false;
        pos.path = stopShort ? short(p, [pos.x, pos.z], stopShort) : p; pos.then = then ?? null;
        return true;
      },
      north: () => { cam.yaw = 0; },
      where: (pane) => { const f = figs.get(pane); return f ? [f.x, f.z] : null; },
    };

    let raf = 0, last = performance.now(), lastFw = 0;
    const mmc = mm.current!.getContext("2d")!;
    const faded = new Set<THREE.Mesh>();
    const v = new THREE.Vector3();
    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000); last = now;
      if (keys.has("ArrowLeft")) cam.yaw -= dt * 1.8;
      if (keys.has("ArrowRight")) cam.yaw += dt * 1.8;
      if (keys.has("ArrowUp")) cam.pitch = Math.min(1.35, cam.pitch + dt * 1.2);
      if (keys.has("ArrowDown")) cam.pitch = Math.max(0.45, cam.pitch - dt * 1.2);
      syncNpcs(); syncAgents();
      const ts = now / 1000, opt = optsRef.current;
      for (const r of roofs) r.visible = !opt.hideRoofs;

      for (const [pane, f] of figs) {
        const { armR, armL, legL, legR } = f.p, [ax, az] = f.spot.at, ay = heightAt(ax, az);
        if (f.dying !== null) {
          // Defeated: falls back, lies a moment, sinks away.
          const t = (now - f.dying) / 1000, gy = heightAt(f.x, f.z);
          f.p.g.rotation.x = -Math.min(1, t / 0.5) * (Math.PI / 2);
          f.p.g.position.set(f.x, gy + 0.15 - Math.max(0, t - 1.6) * 0.6, f.z);
          bar(pane, 0, f.x, gy + 1.0, f.z);
          if (t > 2.6) { scene.remove(f.p.g); dropBar(pane); figs.delete(pane); }
          continue;
        }
        armR.rotation.set(0, 0, 0); armL.rotation.set(0, 0, 0); legL.rotation.x = 0; legR.rotation.x = 0;
        const cheering = now - f.cheer < 1800;
        if (cheering) {
          // Won: both arms up before walking off.
          armR.rotation.x = -2.9 + Math.sin(ts * 10) * 0.2; armL.rotation.x = -2.9 - Math.sin(ts * 10) * 0.2;
        } else if (f.path.length) {
          // On the way: walk, swinging arms and legs, tools in hand.
          const [tx, tz] = f.path[0], dx = tx - f.x, dz = tz - f.z, d = Math.hypot(dx, dz), step = dt * 2.6;
          if (d <= step) { f.x = tx; f.z = tz; f.path.shift(); } else { f.x += (dx / d) * step; f.z += (dz / d) * step; f.p.g.rotation.y = Math.atan2(dx, dz); }
          const sw = Math.sin(ts * 11 + f.seed * 6) * 0.65;
          legL.rotation.x = sw; legR.rotation.x = -sw; armL.rotation.x = -sw * 0.7; armR.rotation.x = sw * 0.7;
        } else {
          f.p.g.rotation.y = f.spot.face;
          if (f.mode === "drink") {
            // The mug held at the table; every few seconds, a long pull.
            const c = (ts * 0.22 + f.seed) % 1, lift = c < 0.18 ? Math.sin((c / 0.18) * Math.PI) : 0;
            armR.rotation.x = -0.55 - lift * 2.1; armL.rotation.x = Math.sin(ts * 1.1 + f.seed * 9) * 0.05;
          } else if (f.mode === "fight") {
            // Trade blows every 2.4s, the self-review half a beat behind: wind up, strike, then a hitsplat on the other.
            const period = 2.4, off = f.role === "attack" ? 0 : 1.2, ph = ((ts + off) % period) / period, n = Math.floor((ts + off) / period);
            const sw = ph < 0.18 ? ph / 0.18 : ph < 0.3 ? 1 - (ph - 0.18) / 0.12 : 0;
            if (f.role === "attack") { armR.rotation.x = -0.7 - sw * 1.9; armL.rotation.x = -0.4; } else { armR.rotation.x = -0.6 - sw * 1.4; armL.rotation.x = -0.3 - sw; }
            const foe = f.foe ? figs.get(f.foe) : null;
            if (n !== f.hit && ph > 0.3 && foe && foe.dying === null && !foe.path.length && !f.path.length) {
              f.hit = n;
              const miss = Math.random() < 0.28, dmg = miss ? 0 : 1 + Math.floor(Math.random() * 14), floor = foe.role === "defend" ? 0.12 : 0.35;
              // Neither falls on hits alone: the fight ends when the findings are taken.
              foe.hp = foe.hp - dmg / 60 <= floor ? foe.hp + 0.2 : foe.hp - dmg / 60;
              splat(foe.x, heightAt(foe.x, foe.z) + 1.0, foe.z, dmg);
              if (f.role === "defend") burst(scene, bits, foe.x, heightAt(foe.x, foe.z) + 1.1, foe.z, 0x40a0ff, 6, 0.8, true);
            }
          } else if (f.mode === "burn") {
            // Kneeling at the fire, now and then feeding it a log: flames leap, smoke rises.
            const ph = (ts * 0.5 + f.seed) % 1, [bx, bz] = BONFIRE, by = heightAt(bx, bz);
            legL.rotation.x = -1.5; legR.rotation.x = -0.2;
            armR.rotation.x = ph < 0.25 ? -1.2 - ph * 2 : -0.6; armL.rotation.x = -0.6;
            if (Math.random() < dt * 0.8) smoke(scene, bits, bx, by + 0.9, bz);
            if (Math.floor(ts * 0.5 + f.seed) !== f.hit) { f.hit = Math.floor(ts * 0.5 + f.seed); burst(scene, bits, bx, by + 0.6, bz, 0xff8a20, 6, 0.6, true); }
          } else if (f.mode === "pray") {
            // Kneeling, hands together and raised; now and then a mote of light rises.
            legL.rotation.x = -1.5; legR.rotation.x = -1.5;
            armR.rotation.x = -2.3; armL.rotation.x = -2.3; armR.rotation.z = -0.35; armL.rotation.z = 0.35;
            if (Math.random() < dt * 1.2) sparkle(scene, bits, f.x, heightAt(f.x, f.z) + 1.4, f.z);
          } else if (f.mode === "ask") {
            armR.rotation.x = -2.6 + Math.sin(ts * 6 + f.seed) * 0.35; armR.rotation.z = 0.2;
          } else if (f.skill) {
            const rate = f.skill === "woodcutting" ? 1.3 : 1.05, ph = (ts * rate + f.seed) % 1, n = Math.floor(ts * rate + f.seed);
            const swing = ph < 0.72 ? ph / 0.72 : 1 - (ph - 0.72) / 0.28; // raise slowly, strike fast
            if (f.skill === "smithing") { armR.rotation.x = -0.8 - swing * 1.5; armL.rotation.x = -0.7; }
            if (f.skill === "mining") { armR.rotation.x = -0.5 - swing * 2.3; armL.rotation.x = -0.5 - swing * 2.3; }
            if (f.skill === "woodcutting") { armR.rotation.x = -1.35; armL.rotation.x = -1.35; armR.rotation.z = 0.9 - swing * 1.5; armL.rotation.z = 0.9 - swing * 1.5; }
            if (f.skill === "fishing") { armR.rotation.x = -1.05 + Math.sin(ts * 2 + f.seed * 5) * 0.06; armL.rotation.x = -0.9; }
            // Building: hammer swung at the wall; cooking: the spatula held over the grill, flipping now and then.
            // Crafting: both hands at the work, small quick movements.
            if (f.skill === "crafting") { armR.rotation.x = -1.15 + Math.sin(ts * 7 + f.seed * 4) * 0.18; armL.rotation.x = -1.05 + Math.cos(ts * 6 + f.seed * 3) * 0.14; }
            if (f.skill === "construction") { armR.rotation.x = -1.3 - swing * 1.1; armL.rotation.x = -1.0; }
            if (f.skill === "cooking") { const flip = ph > 0.8 ? Math.sin(((ph - 0.8) / 0.2) * Math.PI) : 0; armR.rotation.x = -1.0 - flip * 0.9; armL.rotation.x = -0.5; }
            if (f.skill !== "fishing" && n !== f.hit && ph > 0.97) {
              f.hit = n;
              if (f.skill === "smithing") burst(scene, bits, ax + 0.1, ay + 0.75, az, 0xffb030, 6);
              if (f.skill === "mining") burst(scene, bits, ax, ay + 0.6, az + 0.4, 0x8a857a, 4);
              if (f.skill === "woodcutting") burst(scene, bits, ax - 0.25, ay + 0.8, az, 0x9a7444, 4);
            }
            if (f.skill === "fishing" && Math.random() < dt * 0.9) burst(scene, bits, ax, -0.35, az, 0xcfe4ff, 3);
            if (f.skill === "construction" && n !== f.hit && ph > 0.97) { f.hit = n; burst(scene, bits, ax, ay + 1.0, az, 0xb89a6a, 4); }
            if (f.skill === "cooking") { if (Math.random() < dt * 3) smoke(scene, bits, ax, ay + 1.05, az); if (n !== f.hit && ph > 0.97) { f.hit = n; burst(scene, bits, ax, ay + 1.0, az, 0xff8a20, 4, 0.6, true); } }
          }
        }
        const fy = heightAt(f.x, f.z);
        f.p.g.position.set(f.x, fy - (f.mode === "pray" && !f.path.length ? 0.3 : 0), f.z); f.p.g.rotation.x = 0;
        // A fighter's health bar sits over its head, its name and plates above that.
        const fighting = f.mode === "fight", base = fy + (fighting ? 1.9 : 1.72), lift = opt.names ? 0.32 : 0, task = opt.overlays ? 0.42 : 0;
        if (fighting) bar(pane, f.hp, f.x, fy + 1.72, f.z); else if (bars.has(pane)) dropBar(pane);
        tags.get(`name:${pane}`)?.at.set(f.x, base, f.z);
        tags.get(`task:${pane}`)?.at.set(f.x, base + lift, f.z);
        tags.get(`chat:${pane}`)?.at.set(f.x, base + lift + task, f.z);
      }
      if (fireworks.current > 0 && now - lastFw > 220) {
        lastFw = now; fireworks.current--;
        const c = [0xff3030, 0xffff40, 0x40ff40, 0x40a0ff, 0xff60ff][fireworks.current % 5];
        burst(scene, bits, pos.x + (Math.random() - 0.5) * 2.4, heightAt(pos.x, pos.z) + 2.6, pos.z + (Math.random() - 0.5) * 2.4, c, 18, 1.7, true);
      }
      for (let i = bits.length - 1; i >= 0; i--) {
        const b = bits[i]; b.life -= dt; if (!b.rise) b.v.y -= dt * 7; b.m.position.addScaledVector(b.v, dt);
        if (b.life <= 0) { scene.remove(b.m); bits.splice(i, 1); }
      }

      // You, along your path.
      const moving = pos.path.length > 0;
      if (moving) {
        const [tx, tz] = pos.path[0], dx = tx - pos.x, dz = tz - pos.z, d = Math.hypot(dx, dz), step = dt * 4.2;
        if (d > 0.001) pos.face = Math.atan2(dx, dz);
        if (d <= step) { pos.x = tx; pos.z = tz; pos.path.shift(); if (!pos.path.length) { const t = pos.then; pos.then = null; t?.(); } }
        else { pos.x += (dx / d) * step; pos.z += (dz / d) * step; }
      }
      me.g.position.set(pos.x, heightAt(pos.x, pos.z), pos.z); me.g.rotation.y = pos.face;
      const sw = moving ? Math.sin(now / 90) * 0.7 : 0;
      me.legL.rotation.x = sw; me.legR.rotation.x = -sw; me.armL.rotation.x = -sw * 0.8; me.armR.rotation.x = sw * 0.8;
      for (const { k, p } of keepers) {
        if (k === "bartender") { p.armR.rotation.x = -1.1; p.armR.rotation.z = Math.sin(now / 380) * 0.4; p.armL.rotation.x = -0.3; }
        if (k === "teller") { p.armR.rotation.x = -0.9 - Math.max(0, Math.sin(now / 260)) * 0.3; p.armL.rotation.x = -0.9; }
        if (k === "librarian") { p.armR.rotation.x = -1.0; p.armL.rotation.x = -1.0; p.g.rotation.y = Math.PI + Math.sin(now / 2400) * 0.15; }
      }
      // Each house's signpost names it; hovering the house or its sign says what it's for.
      for (const b of BUILDINGS) {
        const [sx, sz] = signOf(b), open = hoverRef.current === `building:${b.id}`;
        tag(`sign:${b.id}`, open ? "task open" : "task", [{ t: b.name, c: "h" }, ...(open ? [{ t: b.does }] : [])], sx, heightAt(sx, sz) + 2.1, sz);
      }
      if (arrow) { arrow.position.set(BOARD.x, boardY + 3.6 + Math.sin(now / 260) * 0.12, BOARD.z); arrow.rotation.y = now / 600; }
      // The hovered scroll shows its key and why it needs you.
      const hg = hoverRef.current?.startsWith("giver:") ? giversRef.current.find((g) => `giver:${g.id}` === hoverRef.current && g.slot !== null) : null;
      if (hg) { const [sx, sy, sz] = slotAt(hg.slot!); tag("scroll", "task open", [{ t: hg.key, c: "h" }, { t: hg.why }], sx, sy - 0.6, sz); } else untag("scroll");

      const head = new THREE.Vector3(pos.x, heightAt(pos.x, pos.z) + 0.9, pos.z);
      camera.position.set(head.x + Math.sin(cam.yaw) * Math.cos(cam.pitch) * cam.dist, head.y + Math.sin(cam.pitch) * cam.dist, head.z + Math.cos(cam.yaw) * Math.cos(cam.pitch) * cam.dist);
      camera.lookAt(head);
      (scene.fog as THREE.Fog).near = cam.dist * 1.05; (scene.fog as THREE.Fog).far = cam.dist * 2.1;
      // Walls between the camera and you fade, so you're never lost behind a building.
      ray.set(camera.position, head.clone().sub(camera.position).normalize()); ray.far = camera.position.distanceTo(head) - 0.3;
      const hit = new Set(ray.intersectObjects(walls, false).map((h) => h.object as THREE.Mesh));
      ray.far = Infinity;
      for (const m of faded) if (!hit.has(m)) { Object.assign(m.material, { transparent: false, opacity: 1 }); faded.delete(m); }
      for (const m of hit) if (!faded.has(m)) { Object.assign(m.material, { transparent: true, opacity: 0.25 }); faded.add(m); }
      renderer.render(scene, camera);

      const vw = host.clientWidth, vh = host.clientHeight;
      for (const [, t] of tags) {
        const on = t.kind === "name" ? opt.names : t.kind === "area" || t.kind.startsWith("task") ? opt.overlays : true;
        v.copy(t.at).project(camera);
        if (!on || v.z > 1 || camera.position.distanceTo(t.at) > cam.dist * 1.9) { t.el.style.display = "none"; continue; }
        t.el.style.display = ""; t.el.style.transform = `translate(${((v.x + 1) / 2) * vw}px, ${((1 - v.y) / 2) * vh}px) translate(-50%, -100%)`;
      }
      const place2d = (el: HTMLElement, at: THREE.Vector3) => {
        v.copy(at).project(camera);
        if (v.z > 1) { el.style.display = "none"; return; }
        el.style.display = ""; el.style.transform = `translate(${((v.x + 1) / 2) * vw}px, ${((1 - v.y) / 2) * vh}px) translate(-50%, -50%)`;
      };
      for (const [, b] of bars) place2d(b.el, b.at);
      for (let i = splats.length - 1; i >= 0; i--) { if (now > splats[i].until) { splats[i].el.remove(); splats.splice(i, 1); } else place2d(splats[i].el, splats[i].at); }

      // The minimap, turned so up is where the camera looks.
      const S = 152, sc = 1.6;
      mmc.setTransform(1, 0, 0, 1, 0, 0); mmc.fillStyle = "#000"; mmc.fillRect(0, 0, S, S);
      mmc.save(); mmc.beginPath(); mmc.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2); mmc.clip();
      mmc.translate(S / 2, S / 2); mmc.rotate(cam.yaw); mmc.scale(sc, sc); mmc.translate(-pos.x * MM, -mmz(pos.z));
      mmc.imageSmoothingEnabled = false; mmc.drawImage(MAP, 0, 0);
      const dot = (x: number, z: number, c: string) => { mmc.fillStyle = "#000"; mmc.fillRect(x * MM - 1.5, mmz(z) - 1.5, 4, 4); mmc.fillStyle = c; mmc.fillRect(x * MM - 2, mmz(z) - 2, 3.5, 3.5); };
      if (arrowLane) dot(BOARD.x, BOARD.z, arrowLane === "mine" ? "#ffff00" : "#ff0000");
      for (const [, f] of figs) dot(f.x, f.z, "#ffffff");
      const flag = pos.path.at(-1);
      if (flag) { mmc.fillStyle = "#ff0000"; mmc.fillRect(flag[0] * MM - 1, mmz(flag[1]) - 6, 2, 6); }
      mmc.restore();
      mmc.fillStyle = "#fff"; mmc.fillRect(S / 2 - 1.5, S / 2 - 1.5, 3, 3);
      const lvl = host.querySelector<HTMLElement>(".world-wild");
      if (lvl) { const n = pos.z < WILD_Z ? Math.ceil((WILD_Z - pos.z) / 1.5) : 0; lvl.style.display = n ? "" : "none"; lvl.dataset.level = String(n); lvl.lastElementChild!.textContent = `Level: ${n}`; }
      const nd = host.parentElement?.querySelector<HTMLElement>(".world-compass i"); if (nd) nd.style.transform = `rotate(${(cam.yaw * 180) / Math.PI}deg)`;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf); ro.disconnect();
      window.removeEventListener("keydown", kd); window.removeEventListener("keyup", ku);
      host.removeEventListener("wheel", wheel); host.removeEventListener("pointerdown", pd); window.removeEventListener("pointermove", pm); window.removeEventListener("pointerup", pu);
      renderer.dispose(); renderer.domElement.remove(); layer.remove(); api.current = null;
    };
  }, []);

  // ---------- doing things ----------
  const mark = (e: React.MouseEvent, red: boolean) => {
    const r = view.current!.getBoundingClientRect(), id = Date.now() + Math.random();
    setMarks((m) => [...m, { id, x: e.clientX - r.left, y: e.clientY - r.top, red }]);
    setTimeout(() => setMarks((m) => m.filter((k) => k.id !== id)), 420);
  };
  const go = (x: number, z: number, then?: () => void, stopShort = 0) => { if (!api.current?.walk(x, z, then, stopShort)) say("I can't reach that!"); };
  const itemOf = (id: string) => byId.get(id);
  const talkGiver = (g: Giver) => go(g.x, g.z, () => { say(`You read the scroll for ${g.key}.`); onOpen(g.id); }, 0.9);
  const enter = (b: Building) => { const d = doorOf(b); go(d.inside[0], d.inside[1], () => { say(`You enter the ${b.name}.`); onBuilding(b.id); }); };
  const greet = (a: Townsfolk) => {
    const at = api.current?.where(a.pane); if (!at) return;
    go(at[0], at[1], () => { setTalkTo(a); chatIn.current?.focus(); }, 0.9);
  };
  const message = (a: Townsfolk) => { setTalkTo(a); chatIn.current?.focus(); };
  const ask = (title: string, yes: string, run: () => void) => setDialog({ title, options: [{ label: yes, run }, { label: "No.", run: () => {} }] });
  // The demo makes statuses up but the agents are real, so it changes nothing about them.
  const agentAct = async (a: Townsfolk, what: string, call: () => Promise<{ error?: string; [k: string]: unknown }>, done: (r: { [k: string]: unknown }) => string) => {
    if (DEMO) { say(`Not in the demo: it would ${what}.`, "red"); return; }
    const r = await call(); say(r.error ? `Couldn't ${what}: ${r.error}` : done(r), r.error ? "red" : undefined);
  };
  const send = async (a: Townsfolk, text: string) => {
    if (DEMO) { say(`Not in the demo: it would message ${a.label}.`, "red"); return; }
    const r = await post("/api/agent/send", { pane: a.pane, text, item: a.item });
    say(r.error ? `Couldn't message ${a.label}: ${r.error}` : `To ${a.label}: ${text}`, r.error ? "red" : "you");
    if (!r.error) setTimeout(() => loadSaid(a.pane), 2500);
  };
  const examine = (t: Target) => say(t.kind === "giver" ? `${t.g.key}: ${t.g.why}`
    : t.kind === "agent" ? `${t.a.label}: ${t.a.mode === "fight" ? (t.a.kind === "selfreview" ? "holding the self-review's findings until its PR's session takes them" : "fighting its self-review for the findings") : t.a.mode === "pray" ? `praying for a review from ${t.a.awaiting}` : t.a.mode === "burn" ? `burning its logs: done, ${t.a.spent}` : t.a.mode === "ask" ? "waiting on you" : t.a.mode === "drink" ? "enjoying an ale at the Inn" : `${VERB[t.a.skill].toLowerCase()}, ${t.a.detail}`}, for ${t.a.itemKey}.`
    : t.kind === "building" ? `${t.b.name}. ${t.b.does}.` : "Grass. It could do with a trim.");
  const act = (t: Target) => { if (t.kind === "giver") talkGiver(t.g); else if (t.kind === "agent") greet(t.a); else if (t.kind === "building") enter(t.b); else go(t.x, t.z); };

  /** The right-click menu for whatever's under the cursor: the real actions, as the board offers them. */
  const options = (t: Target, ground: Target | null): Opt[] => {
    const out: Opt[] = [];
    if (t.kind === "giver") {
      const it = itemOf(t.g.id), w = { what: t.g.key, tone: "obj" as const };
      out.push({ verb: "Read", ...w, run: () => talkGiver(t.g) });
      if (it?.primary.label) out.push({ verb: it.primary.label, ...w, run: () => onPrimary(it) });
      if (it) out.push({ verb: "Park", ...w, run: () => onSheet("park", it) }, { verb: "Move", ...w, run: () => onSheet("move", it) });
      if (it?.prs.some((p) => p.role === "mine" && !p.draft)) out.push({ verb: "Ask-in-Slack", ...w, run: () => onSheet("ask", it) });
      out.push({ verb: "Examine", ...w, run: () => examine(t) });
    }
    if (t.kind === "agent") {
      const a = t.a, w = { what: a.label, tone: "player" as const }, finished = a.status === "done" || a.status === "idle";
      out.push({ verb: "Talk-to", ...w, run: () => greet(a) }, { verb: "Message", ...w, run: () => message(a) });
      if (finished) out.push({ verb: "Approve", ...w, run: () => ask(`Tell ${a.label} to go ahead: push and post as drafted?`, "Yes, go ahead.", () => void send(a, "Approved. Go ahead: push and post as drafted.")) });
      out.push({ verb: "View-task", ...w, run: () => onOpen(a.item) });
      out.push({ verb: "Open-in-herdr", ...w, run: () => void agentAct(a, "open it", () => post("/api/agent/focus", { pane: a.pane }), (r) => (r.app ? `Opened ${a.label} in ${r.app}.` : `Focused ${a.label} in herdr.`)) });
      if (a.status === "done") out.push({ verb: "Mark-seen", ...w, run: () => void agentAct(a, "mark it seen", () => post("/api/agent/dismiss", { pane: a.pane, item: a.item }), () => `${a.label} is marked seen.`) });
      if (a.status !== "working") out.push({ verb: "Close-session", ...w, run: () => ask(`Close ${a.label}'s session? It can be resumed from History.`, "Yes, close it.", () => void agentAct(a, "close it", () => post("/api/agent/close", { pane: a.pane, item: a.item }), (r) => `Closed ${a.label}'s ${r.closed ?? "session"}.`)) });
      out.push({ verb: "Examine", ...w, run: () => examine(t) });
    }
    if (t.kind === "building") out.push({ verb: "Enter", what: t.b.name, tone: "obj", run: () => enter(t.b) }, { verb: "Examine", what: t.b.name, tone: "obj", run: () => examine(t) });
    out.push({ verb: "Walk here", run: () => { if (ground?.kind === "ground") go(ground.x, ground.z); else if (ground) act(ground); } }, { verb: "Cancel", run: () => {} });
    return out;
  };
  const first = (t: Target | null): Opt => !t || t.kind === "ground" ? { verb: "Walk here", run: () => {} }
    : t.kind === "giver" ? { verb: "Read", what: t.g.key, tone: "obj", run: () => {} }
    : t.kind === "agent" ? { verb: "Talk-to", what: t.a.label, tone: "player", run: () => {} }
    : { verb: "Enter", what: t.b.name, tone: "obj", run: () => {} };
  const hv = first(hover), more = hover && hover.kind !== "ground" ? options(hover, null).length - 1 : 0;
  hoverRef.current = hover?.kind === "agent" ? hover.a.pane : hover?.kind === "giver" ? `giver:${hover.g.id}` : hover?.kind === "building" ? `building:${hover.b.id}` : null;
  const totalXp = XP_SKILLS.reduce((n, k) => n + xp[k], 0), totalLevel = XP_SKILLS.reduce((n, k) => n + levelOf(xp[k]), 0);

  return (
    <div className="world">
      <div className="world-view" ref={view}
        onMouseMove={(e) => setHover(api.current?.pick(e.clientX, e.clientY) ?? null)}
        onMouseLeave={() => setHover(null)}
        onClick={(e) => { setMenu(null); const t = api.current?.pick(e.clientX, e.clientY); if (!t) return; mark(e, t.kind !== "ground"); act(t); }}
        onContextMenu={(e) => {
          e.preventDefault();
          const t = api.current?.pick(e.clientX, e.clientY); if (!t) return;
          const r = view.current!.getBoundingClientRect();
          setMenu({ x: e.clientX - r.left, y: e.clientY - r.top, opts: options(t, t) });
        }}>
        {noGl && <div className="world-nogl">This browser can't draw the world: WebGL is off or unavailable.</div>}
        <div className="world-hover">{hv.verb}{hv.what && <> <span className={hv.tone}>{hv.what}</span></>}{more > 0 && <span className="more"> / {more} more options</span>}</div>
        <div className="world-wild" style={{ display: "none" }}><i /><span>Level: 0</span></div>
        <div className="world-xpbox" title={`Total level ${totalLevel}`}>XP: {totalXp.toLocaleString()}</div>
        <div className="world-drops">{drops.map((d) => <div key={d.id} className={`drop s-${d.skill.toLowerCase()}`}>+{d.xp} <span>{d.skill}</span></div>)}</div>
        {marks.map((m) => <i key={m.id} className={`world-x ${m.red ? "red" : ""}`} style={{ left: m.x, top: m.y }} />)}
        {menu && (
          <div className="world-menu" style={{ left: menu.x, top: menu.y }} onMouseLeave={() => setMenu(null)} onClick={(e) => e.stopPropagation()} onMouseMove={(e) => e.stopPropagation()}>
            <div className="world-menu-h">Choose Option</div>
            {menu.opts.map((o) => <button key={o.verb + (o.what ?? "")} onClick={() => { setMenu(null); o.run(); }}>{o.verb}{o.what && <> <span className={o.tone}>{o.what}</span></>}</button>)}
          </div>
        )}
      </div>
      <aside className="world-side">
        <div className="world-mm">
          <canvas ref={mm} width={152} height={152} />
          <button className="world-compass" title="Face north" onClick={() => api.current?.north()}><i /></button>
        </div>
        <div className="world-tabs">
          <button className={tab === "quests" ? "on" : ""} onClick={() => setTab("quests")}>Quests</button>
          <button className={tab === "stats" ? "on" : ""} onClick={() => setTab("stats")}>Stats</button>
          <button className={tab === "options" ? "on" : ""} onClick={() => setTab("options")}>Options</button>
        </div>
        <div className="world-panel">
          {tab === "quests" && <>
            <h4>Quest List</h4>
            {givers.length + asking.length === 0 && <div className="none">Nothing needs you.</div>}
            {givers.map((g) => <button key={g.id} className={g.lane} title={g.why} onClick={() => talkGiver(g)}>{g.key}</button>)}
            {asking.map((a) => <button key={a.pane} className="asked" title={`${a.label} is waiting on you, for ${a.itemKey}`} onClick={() => greet(a)}>{a.label}</button>)}
          </>}
          {tab === "stats" && <>
            <div className="world-stats">
              {XP_SKILLS.map((k) => {
                const l = levelOf(xp[k]), next = l < 99 ? LEVEL_XP[l + 1] - xp[k] : 0;
                return <div key={k} className={`stat s-${k.toLowerCase()}`} title={`${k} XP: ${xp[k].toLocaleString()}${l < 99 ? `\nNext level at: ${LEVEL_XP[l + 1].toLocaleString()}\nRemaining XP: ${next.toLocaleString()}` : ""}`}>
                  <i /><span className="n">{k}</span><span className="lv">{l}<small>/{l}</small></span>
                </div>;
              })}
            </div>
            <div className="world-total">Total level: {totalLevel}</div>
            <div className="world-how">XP comes from the board: CI passing, approvals and answered threads, agents finishing, and work shipping.</div>
          </>}
          {tab === "options" && <div className="world-opts">
            <button className={opts.names ? "on" : ""} onClick={() => flip("names")}>Display names: {opts.names ? "on" : "off"}</button>
            <button className={opts.hideRoofs ? "on" : ""} onClick={() => flip("hideRoofs")}>Roofs: {opts.hideRoofs ? "hidden" : "shown"}</button>
            <button className={opts.overlays ? "on" : ""} onClick={() => flip("overlays")}>Task overlays: {opts.overlays ? "on" : "off"}</button>
          </div>}
        </div>
        <button className="world-close" onClick={onClose}>Close <kbd>esc</kbd></button>
      </aside>
      <div className="world-chat">
        {dialog ? (
          <div className="world-dialog">
            <div className="q">{dialog.title}</div>
            <div className="h">Select an Option</div>
            {dialog.options.map((o) => <button key={o.label} onClick={() => { setDialog(null); o.run(); }}>{o.label}</button>)}
          </div>
        ) : <>
          {talkTo ? (
            <div className="world-convo" ref={log}>
              <div className="who"><b>{talkTo.label}</b><button onClick={() => setTalkTo(null)} title="Stop talking (esc)">×</button></div>
              <div className="ctx">
                <div><span className="lbl">Working on</span>{talkTo.itemKey}{talkTo.itemTitle && talkTo.itemTitle !== talkTo.itemKey ? `: ${talkTo.itemTitle}` : ""}</div>
                {talkTo.pr && <div><span className="lbl">PR</span>{talkTo.pr.ref}: {talkTo.pr.title}</div>}
                <div><span className="lbl">Now</span>{talkTo.status === "blocked" ? "waiting on you" : talkTo.awaiting ? `waiting on a review from ${talkTo.awaiting}` : talkTo.status === "working" ? talkTo.detail : `${talkTo.status}, last ${talkTo.detail}`}</div>
              </div>
              {!said && <div className="dim">Listening…</div>}
              {said?.recap && <div className="recap"><span className="lbl">Recap</span>{said.recap}</div>}
              {said && <div className="turn"><span className="lbl">Last turn{said.at ? ` · ${new Date(said.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : ""}</span>{said.turn ?? "It hasn't said anything yet."}</div>}
            </div>
          ) : <div className="world-log" ref={log}>{chat.map((l, i) => <div key={i} className={l.c ?? ""}>{l.t}</div>)}</div>}
          <form className="world-say" onSubmit={(e) => { e.preventDefault(); const t = draft.trim(); if (!t) return; if (!talkTo) { say("Talk to an agent first, then type to message it.", "red"); return; } void send(talkTo, t); setDraft(""); }}>
            <span className="to">{talkTo ? `To ${talkTo.label}:` : "Talk to an agent to message it:"}</span>
            <input ref={chatIn} value={draft} onChange={(e) => setDraft(e.target.value)} disabled={!talkTo} aria-label="Message the agent" />
            <span className="caret">*</span>
          </form>
        </>}
      </div>
    </div>
  );
}
