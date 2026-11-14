// The Farmstead: the World for the Farmstead skin, drawn as a top-down pixel farm. The town's layout, paths and work,
// seen from above as a little valley farm: a farmhouse, a shipping barn, a cider house and an almanac house round a
// pond, a creek down the west side, wild woods to the north. Every agent is a farmhand. Each step of the work is a
// farm job: building at the forge (Building), the craft shed (Fixing), fishing in the creek (Reviewing), watering the
// pumpkin patch (Testing), the orchard (Charting), the new coop going up (Improving) and the cookhouse's stoves
// (Grilling); waiting on a review in the meeting house, a cider in the cider house when idle, warming up at the
// bonfire when spent. A self-review and its PR's session argue it out in the wild woods.
// Everything is pixel art drawn in code, ten pixels to a tile, on boxes and upright cut-outs that the World's
// overhead view shows from the south at 45 degrees: a box's top and south face, a cut-out face on.
import * as THREE from "three";
import type { AgentTask } from "../../shared/types";
import { ALTAR, ANVILS, BOARD, BONFIRE, BUILDINGS, type Building, CHAPEL, CX, CZ, doorOf, FENCES, FURNACE, FURNITURE, GRILLS, GROVE, H, heightAt, HV, KITCHEN, LAMPS, PEWS, ROCKS, ROWS, rnd, signOf, SIGNS, SITE, type Skill, type Tile, TILES, TOWER, type Tree, TREES, W, WALL_T, WILD_SIGN, WORKSHOP, Z0 } from "./map";
import { type Act, type Bit, burst, type Keeper, MM, mmz, type Person } from "./scene";
import type { WorldKit } from "./kit";

/** Pixels to a tile. */
const PPU = 10;
const OUT = "#3b2418", EYE = "#2a1a12";
const GRASS = ["#6fa83c", "#5e9533", "#82bb4b"], DIRT = ["#c9a16a", "#b08752", "#dcb985"], SOIL = ["#8a5a35", "#6e4527", "#9c6a42"];
const WATER = ["#3f8cc0", "#2f6f9c", "#5aa6d6"], SAND = "#d9c48a", WILD = ["#3f6a2c", "#2f5222", "#4f7d38"], STONE = ["#9a958a", "#7a756c", "#b8b2a6"];
const WOOD = ["#a8703f", "#7a4a2b", "#c48a55"];
const hex = (n: number) => `#${n.toString(16).padStart(6, "0")}`;
const snap = (v: number) => Math.round(v * PPU) / PPU;

// ---------- drawing ----------
type Ctx = CanvasRenderingContext2D;
type Art = HTMLCanvasElement;
const cv = (w: number, h: number): Art => { const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; };
const ctx = (c: Art) => c.getContext("2d")!;
const px = (x: Ctx, col: string, X: number, Y: number, w = 1, h = 1) => { x.fillStyle = col; x.fillRect(X, Y, w, h); };
const disc = (x: Ctx, cx: number, cy: number, r: number, col: string) => { x.fillStyle = col; for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if (i * i + j * j <= r * r + r * 0.6) x.fillRect(cx + i, cy + j, 1, 1); };
let seed = 1;
const rand = () => rnd(seed++ * 1.37 + 0.11);
const ri = (n: number) => Math.floor(rand() * n);
/** A canvas drawn once by `draw`. */
const art = (w: number, h: number, draw: (x: Ctx) => void): Art => { const c = cv(w, h); draw(ctx(c)); return c; };
/** A dark edge round whatever's drawn, the way pixel sprites are outlined. */
function outline(c: Art, col = OUT) {
  const x = ctx(c), d = x.getImageData(0, 0, c.width, c.height), a = (i: number, j: number) => i >= 0 && j >= 0 && i < c.width && j < c.height && d.data[(j * c.width + i) * 4 + 3] > 128;
  const edge: [number, number][] = [];
  for (let j = 0; j < c.height; j++) for (let i = 0; i < c.width; i++) if (!a(i, j) && (a(i - 1, j) || a(i + 1, j) || a(i, j - 1) || a(i, j + 1))) edge.push([i, j]);
  for (const [i, j] of edge) px(x, col, i, j);
  return c;
}

// ---------- materials, boxes and cut-outs ----------
function tex(c: Art, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
type Face = Art | string;
const faces = new Map<Face, THREE.Material>();
const faceMat = (f: Face) => { let m = faces.get(f); if (!m) { m = typeof f === "string" ? new THREE.MeshBasicMaterial({ color: f }) : new THREE.MeshBasicMaterial({ map: tex(f, true), alphaTest: 0.5 }); faces.set(f, m); } return m; };
/** A box standing on `y`, centred on x and z: its top and south face drawn from art at ten pixels a tile, tiled
 *  where the art is smaller than the face; the sides, which the view never shows, plain. */
function block(w: number, h: number, d: number, top: Face, front: Face, x: number, y: number, z: number, side: Face = OUT) {
  const geo = new THREE.BoxGeometry(w, h, d), uv = geo.getAttribute("uv") as THREE.BufferAttribute;
  const fit = (f: number, fw: number, fh: number, c: Face) => { if (typeof c === "string") return; for (let k = f * 4; k < f * 4 + 4; k++) uv.setXY(k, (uv.getX(k) * fw * PPU) / c.width, (uv.getY(k) * fh * PPU) / c.height); };
  fit(2, w, d, top); fit(4, w, h, front);
  const m = new THREE.Mesh(geo, [side, side, top, side, front, side].map(faceMat));
  m.position.set(x, y + h / 2, z);
  return m;
}
const cutouts = new Map<Art, THREE.Material>();
const cutMat = (c: Art) => { let m = cutouts.get(c); if (!m) { m = new THREE.MeshBasicMaterial({ map: tex(c), alphaTest: 0.5, side: THREE.DoubleSide }); cutouts.set(c, m); } return m; };
/** Art stood upright on the ground at x and z, facing the view, on whole pixels. `sink` lowers it into the ground. */
function cutout(c: Art, x: number, z: number, y = heightAt(x, z), sink = 0) {
  const w = c.width / PPU, h = c.height / PPU, geo = new THREE.PlaneGeometry(w, h);
  geo.translate(0, h / 2 - sink, 0);
  const m = new THREE.Mesh(geo, cutMat(c));
  m.position.set(snap(x - w / 2) + w / 2, snap(y), snap(z));
  return m;
}
/** Art tiled along a strip stood upright, like a run of fence. */
function strip(c: Art, len: number, x: number, z: number, y: number) {
  const h = c.height / PPU, geo = new THREE.PlaneGeometry(len, h), uv = geo.getAttribute("uv") as THREE.BufferAttribute;
  for (let k = 0; k < uv.count; k++) uv.setX(k, (uv.getX(k) * len * PPU) / c.width);
  geo.translate(0, h / 2, 0);
  const m = new THREE.Mesh(geo, faceMat(c)); (m.material as THREE.MeshBasicMaterial).side = THREE.DoubleSide;
  m.position.set(x, y, z);
  return m;
}

// ---------- tiles: small art that repeats ----------
const planks = (base: string, line: string, hi: string, w = 10, h = 10) => art(w, h, (x) => { px(x, base, 0, 0, w, h); for (let j = 0; j < h; j += 3) { px(x, line, 0, j + 2, w, 1); px(x, hi, 0, j, w, 1); } px(x, line, (w * 0.6) | 0, 0, 1, 2); px(x, line, (w * 0.2) | 0, 3, 1, 2); px(x, line, (w * 0.8) | 0, 6, 1, 2); });
const bricks = (base: string, line: string, hi: string) => art(10, 10, (x) => { px(x, base, 0, 0, 10, 10); for (let j = 0; j < 10; j += 5) { px(x, line, 0, j + 4, 10, 1); px(x, hi, 0, j, 10, 1); px(x, line, j % 10 ? 5 : 0, j, 1, 4); } });
const logs = (base: string, dark: string, hi: string) => art(10, 10, (x) => { for (let j = 0; j < 10; j += 5) { px(x, base, 0, j, 10, 5); px(x, hi, 0, j + 1, 10, 1); px(x, dark, 0, j + 4, 10, 1); px(x, dark, 7, j + 2, 1, 1); } });
const CAP = art(10, 10, (x) => { px(x, "#5a3a22", 0, 0, 10, 10); px(x, "#7a5232", 0, 0, 10, 1); px(x, "#4a2e1a", 0, 9, 10, 1); });
const FLOOR = planks("#b5844f", "#8f6235", "#c79a62");
const WOODTOP = planks(WOOD[2], WOOD[1], "#d49c66");
const WOODFRONT = planks(WOOD[0], WOOD[1], WOOD[2]);
/** A wall's upper part with a window in it, two and a half tiles wide. */
const windowed = (wall: Art, frame: string) => art(25, 15, (x) => {
  for (let i = 0; i < 25; i += 10) for (let j = 0; j < 15; j += 10) x.drawImage(wall, i, j);
  px(x, OUT, 8, 3, 9, 8); px(x, "#9fd0e8", 9, 4, 7, 6); px(x, "#d6eef8", 10, 5, 2, 1); px(x, frame, 12, 4, 1, 6); px(x, frame, 9, 7, 7, 1);
  px(x, "#6b4226", 7, 11, 11, 2); px(x, "#d8402f", 9, 10, 1, 1); px(x, "#f0c94a", 12, 10, 1, 1); px(x, "#e07a9a", 15, 10, 1, 1);
});
const eave = (a: string, b: string) => art(10, 5, (x) => { px(x, a, 0, 0, 10, 5); px(x, b, 0, 3, 10, 2); for (let i = 0; i < 10; i += 3) px(x, b, i, 0, 1, 3); });
/** A roof from above: shingle rows, the ridge across the middle, the far slope in shadow. */
const roofTop = (w: number, d: number, a: string, b: string, dark: string) => art(w * PPU, d * PPU, (x) => {
  const W2 = Math.round(w * PPU), D2 = Math.round(d * PPU), mid = Math.floor(D2 / 2);
  for (let j = 0; j < D2; j++) { const north = j < mid; px(x, north ? dark : j % 3 === 2 ? b : a, 0, j, W2, 1); if (j % 3 === 0) for (let i = (j / 3) % 2 ? 2 : 0; i < W2; i += 4) px(x, north ? b : dark, i, j, 1, 1); }
  px(x, OUT, 0, mid - 1, W2, 2); px(x, "#ffffff22", 0, mid + 1, W2, 1);
  x.strokeStyle = OUT; x.lineWidth = 1; x.strokeRect(0.5, 0.5, W2 - 1, D2 - 1);
});

// ---------- the ground ----------
const tileOf = (x: number, r: number): Tile => TILES[Math.max(0, Math.min(ROWS - 1, r))][Math.max(0, Math.min(W - 1, x))];
function groundArt() {
  const c = cv(W * PPU, ROWS * PPU), g = ctx(c);
  for (let r = 0; r < ROWS; r++) for (let x = 0; x < W; x++) {
    const t = TILES[r][x], X = x * PPU, Y = r * PPU; seed = r * 977 + x * 13 + 1;
    if (t === "g" || t === "k") {
      const [a, b, l] = t === "g" ? GRASS : WILD;
      px(g, a, X, Y, 10, 10);
      for (let k = 0; k < 7; k++) px(g, rand() < 0.5 ? b : l, X + ri(10), Y + ri(10), 1, rand() < 0.5 ? 1 : 2);
      if (t === "g" && rand() < 0.1) px(g, rand() < 0.5 ? "#f4f0d8" : "#f0c94a", X + 1 + ri(8), Y + 1 + ri(8));
      if (t === "k" && rand() < 0.2) { const fx = X + 2 + ri(6), fy = Y + 2 + ri(6); px(g, l, fx, fy, 1, 3); px(g, l, fx - 1, fy + 1, 3, 1); }
      if (t === "k" && rand() < 0.04) { const fx = X + 2 + ri(6), fy = Y + 3 + ri(5); px(g, "#d8402f", fx, fy, 2, 1); px(g, "#f4f0d8", fx, fy + 1, 1, 1); }
    } else if (t === "p") {
      px(g, DIRT[0], X, Y, 10, 10);
      for (let k = 0; k < 4; k++) px(g, DIRT[1], X + ri(9), Y + ri(10), 2, 1);
      for (let k = 0; k < 3; k++) px(g, DIRT[2], X + ri(10), Y + ri(10));
      // Grass creeping onto the path's edges.
      const tuft = (dx: number, dy: number, hz: boolean) => { for (let k = 0; k < 10; k += 2) if (rand() < 0.6) px(g, GRASS[1], X + (hz ? k : dx), Y + (hz ? dy : k)); };
      if ("gk".includes(tileOf(x, r - 1))) tuft(0, 0, true);
      if ("gk".includes(tileOf(x, r + 1))) tuft(0, 9, true);
      if ("gk".includes(tileOf(x - 1, r))) tuft(0, 0, false);
      if ("gk".includes(tileOf(x + 1, r))) tuft(9, 0, false);
    } else if (t === "s") {
      px(g, "#bba27a", X, Y, 10, 10);
      for (let j = 0; j < 10; j += 5) for (let i = (r % 2) * 2 + (j ? 2 : 0) - 5; i < 10; i += 5) { px(g, "#cdb48a", X + Math.max(0, i), Y + j, Math.min(4, 4 + i), 4); px(g, "#dcc59c", X + Math.max(0, i), Y + j, Math.min(4, 4 + i), 1); }
    } else if (t === "w") {
      px(g, WATER[0], X, Y, 10, 10);
      for (let k = 0; k < 2; k++) px(g, WATER[2], X + ri(7), Y + 1 + ri(8), 3, 1);
      const land = (dx: number, dy: number) => tileOf(x + dx, r + dy) !== "w";
      if (land(0, -1)) { px(g, SAND, X, Y, 10, 2); px(g, WATER[1], X, Y + 2, 10, 1); }
      if (land(0, 1)) px(g, SAND, X, Y + 8, 10, 2);
      if (land(-1, 0)) { px(g, SAND, X, Y, 2, 10); px(g, WATER[1], X + 2, Y, 1, 10); }
      if (land(1, 0)) px(g, SAND, X + 8, Y, 2, 10);
    } else {
      // The ditch at the wild woods' edge: mud and puddles.
      px(g, "#5a4028", X, Y, 10, 10); px(g, "#4a3220", X, Y + 8, 10, 2);
      if (rand() < 0.4) px(g, WATER[1], X + 2 + ri(4), Y + 3 + ri(3), 3, 2);
    }
  }
  const rect = (x0: number, z0: number, x1: number, z1: number, f: (X: number, Y: number) => void) => { for (let Y = Math.round((z0 - Z0) * PPU); Y < Math.round((z1 - Z0) * PPU); Y++) for (let X = Math.round(x0 * PPU); X < Math.round(x1 * PPU); X++) f(X, Y); };
  // Tilled rows: the pumpkin patch and the field by the meeting house, with something growing in the field.
  const till = (x0: number, z0: number, x1: number, z1: number, crop: boolean) => {
    rect(x0, z0, x1, z1, (X, Y) => px(g, Y % 4 === 3 ? SOIL[1] : Y % 4 === 0 ? SOIL[2] : SOIL[0], X, Y));
    if (!crop) return;
    for (let Y = Math.round((z0 - Z0) * PPU) + 2; Y < (z1 - Z0) * PPU - 1; Y += 4) for (let X = Math.round(x0 * PPU) + 2; X < x1 * PPU - 2; X += 4) {
      const col = Math.floor((X / PPU - x0) / ((x1 - x0) / 3));
      if (col === 0) { px(g, "#7cc24e", X, Y); px(g, "#7cc24e", X + 1, Y - 1); }
      else if (col === 1) { px(g, "#4e8f36", X, Y - 1, 1, 3); px(g, "#4e8f36", X - 1, Y, 3, 1); px(g, "#7cc24e", X, Y - 1); }
      else { disc(g, X, Y, 1, "#4e8f36"); px(g, (X + Y) % 8 < 4 ? "#d8402f" : "#e8c66a", X, Y - 1); }
    }
  };
  till(38, 22, 46, 27, false);
  rect(38, 22, 46, 27, (X, Y) => { if ((X * 7 + Y * 3) % 23 === 0) { px(g, "#4e8f36", X, Y, 2, 1); px(g, "#7cc24e", X + 1, Y - 1); } });
  till(9, 39.5, 17.5, 45, true);
  // The forge's yard, the coop's footings and the bonfire's scorch.
  rect(36.4, 12.2, 44, 16.8, (X, Y) => { seed = X * 31 + Y; px(g, rand() < 0.15 ? DIRT[1] : rand() < 0.1 ? STONE[1] : DIRT[0], X, Y); });
  rect(SITE.x - 0.6, SITE.z - 0.6, SITE.x + SITE.w + 0.6, SITE.z + SITE.d + 0.8, (X, Y) => { seed = X * 17 + Y * 3; px(g, rand() < 0.2 ? DIRT[1] : DIRT[0], X, Y); });
  const [bx, bz] = BONFIRE; rect(bx - 1.6, bz - 1.6, bx + 1.6, bz + 1.6, (X, Y) => { const d = Math.hypot(X / PPU - bx, Y / PPU + Z0 - bz); if (d < 0.9) px(g, (X + Y) % 3 ? "#3a2a1e" : "#5a4028", X, Y); else if (d < 1.5 && (X * 3 + Y) % 4 === 0) px(g, "#5a7a2c", X, Y); });
  // The pond, with its stone rim and lily pads.
  const pcx = CX * PPU, pcy = (CZ - Z0) * PPU, R = 1.95 * PPU;
  for (let Y = Math.floor(pcy - R) - 1; Y < pcy + R + 1; Y++) for (let X = Math.floor(pcx - R) - 1; X < pcx + R + 1; X++) {
    const d = Math.hypot(X + 0.5 - pcx, Y + 0.5 - pcy);
    if (d > R) continue;
    if (d > R - 3) px(g, (Math.floor(Math.atan2(Y - pcy, X - pcx) * 4) % 2) ? STONE[0] : STONE[2], X, Y);
    else if (d > R - 4) px(g, OUT, X, Y);
    else px(g, d < 4 ? WATER[2] : (X + Y * 3) % 17 === 0 ? WATER[2] : WATER[0], X, Y);
  }
  for (const [dx, dy] of [[-8, -4], [6, 7], [9, -6]]) { disc(g, pcx + dx, pcy + dy, 2, "#4e8f36"); px(g, WATER[0], pcx + dx + 1, pcy + dy - 1); }
  px(g, "#f4f0d8", pcx + 6, pcy + 6); px(g, "#e07a9a", pcx + 7, pcy + 6);
  return c;
}
function groundMesh(c: Art) {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  for (let z = Z0; z <= H; z++) for (let x = 0; x <= W; x++) { pos.push(x, HV[(z - Z0) * (W + 1) + x], z); uv.push(x / W, 1 - (z - Z0) / ROWS); }
  for (let z = 0; z < ROWS; z++) for (let x = 0; x < W; x++) { const a = z * (W + 1) + x, b = a + 1, c2 = a + W + 1, d = c2 + 1; idx.push(a, c2, b, b, c2, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ map: tex(c) }));
}

// ---------- buildings ----------
type Style = { wall: Art; band: Art; roof: [string, string, string]; eave: Art };
const style = (wall: Art, frame: string, roof: [string, string, string]): Style => ({ wall, band: windowed(wall, frame), roof, eave: eave(roof[2], OUT) });
const STYLES: Record<Building["id"], Style> = {
  next: style(planks(WOOD[2], WOOD[0], "#d49c66"), "#f4f0d8", ["#b8433a", "#9a3830", "#7e2c26"]),
  finished: style(planks("#a8402f", "#8e3326", "#bf5440"), "#efe6d2", ["#6b5040", "#5a4234", "#463228"]),
  sessions: style(logs("#9a6a3a", "#6b4226", "#b5844f"), "#e8c66a", ["#4f7a3a", "#426a30", "#335226"]),
  docs: style(bricks(STONE[0], STONE[1], STONE[2]), "#3f5f9e", ["#4a6a8a", "#3e5a78", "#304860"]),
};
const LOW = 0.9, TOPS = 2.4;
/** Walls round a footprint, low enough to see over with the roof off, a gap where the door is; and the roof itself,
 *  the walls' upper part and the roof over them, which the roofs option hides. */
function shell(scene: THREE.Object3D, roofs: THREE.Object3D[], r: { x: number; z: number; w: number; d: number }, s: Style, door: { x: number; north: boolean } | null, open: "north" | null, target?: unknown) {
  const T = WALL_T, cx = r.x + r.w / 2, cz = r.z + r.d / 2, y0 = 0.14, put = (into: THREE.Object3D, m: THREE.Mesh) => { if (target) m.userData.target = target; into.add(m); return m; };
  put(scene, block(r.w, y0, r.d, FLOOR, FLOOR, cx, 0, cz));
  put(scene, block(T, LOW, r.d, CAP, s.wall, r.x + T / 2, y0, cz));
  put(scene, block(T, LOW, r.d, CAP, s.wall, r.x + r.w - T / 2, y0, cz));
  const run = (z: number, gap: number | null) => {
    if (gap === null) { put(scene, block(r.w, LOW, T, CAP, s.wall, cx, y0, z)); return; }
    const a = gap - 0.6 - r.x, b = r.x + r.w - gap - 0.6;
    if (a > 0.05) put(scene, block(a, LOW, T, CAP, s.wall, r.x + a / 2, y0, z));
    if (b > 0.05) put(scene, block(b, LOW, T, CAP, s.wall, r.x + r.w - b / 2, y0, z));
  };
  if (open !== "north") run(r.z + T / 2, door?.north ? door.x : null);
  run(r.z + r.d - T / 2, door && !door.north ? door.x : null);
  const roof = new THREE.Group(), up = y0 + LOW, band = TOPS - up;
  put(roof, block(r.w, band, T, CAP, s.band, cx, up, r.z + r.d - T / 2));
  put(roof, block(r.w, band, T, CAP, s.wall, cx, up, r.z + T / 2));
  put(roof, block(T, band, r.d, CAP, s.wall, r.x + T / 2, up, cz));
  put(roof, block(T, band, r.d, CAP, s.wall, r.x + r.w - T / 2, up, cz));
  put(roof, block(r.w + 0.6, 0.5, r.d + 0.6, roofTop(r.w + 0.6, r.d + 0.6, ...s.roof), s.eave, cx, TOPS, cz));
  scene.add(roof); roofs.push(roof);
  return roof;
}
function buildings(scene: THREE.Object3D, roofs: THREE.Object3D[]) {
  for (const b of BUILDINGS) {
    const d = doorOf(b), roof = shell(scene, roofs, b, STYLES[b.id], { x: d.x, north: d.z === b.z }, null, { kind: "building", b });
    // A door mat outside the door; the farmhouse's chimney.
    scene.add(cutout(MAT, d.outside[0], d.z === b.z ? b.z - 0.1 : b.z + b.d + 0.45, 0.09));
    if (b.id === "next") { const ch = block(0.8, 1.0, 0.8, art(8, 8, (x) => { px(x, STONE[1], 0, 0, 8, 8); px(x, OUT, 2, 2, 4, 4); }), bricks(STONE[0], STONE[1], STONE[2]), b.x + b.w - 2, TOPS + 0.3, b.z + 1.6); ch.userData.target = { kind: "building", b }; roof.add(ch); }
  }
}
const MAT = art(14, 3, (x) => { px(x, "#a8402f", 0, 0, 14, 3); px(x, "#e8c66a", 1, 1, 12, 1); });

// ---------- furniture and fittings ----------
const SHELF = art(10, 18, (x) => { px(x, WOOD[1], 0, 0, 10, 18); for (const y of [1, 7, 13]) { px(x, WOOD[0], 0, y + 4, 10, 1); for (let i = 1; i < 9; i += 2) px(x, ["#d8402f", "#3f5f9e", "#5aa055", "#e8c66a", "#9a6fc0"][(i + y) % 5], i, y, 1 + ((i + y) % 2), 4); } });
const JARS = art(10, 16, (x) => { px(x, WOOD[1], 0, 0, 10, 16); for (const y of [1, 8]) { px(x, WOOD[0], 0, y + 5, 10, 1); for (let i = 1; i < 9; i += 3) { px(x, ["#e08a2b", "#d8402f", "#9a6fc0"][(i + y) % 3], i, y + 1, 2, 4); px(x, "#efe6d2", i, y, 2, 1); } } });
const CRATES = art(10, 10, (x) => { px(x, WOOD[0], 0, 0, 10, 10); px(x, WOOD[1], 0, 0, 10, 1); px(x, WOOD[1], 0, 9, 10, 1); for (let i = 1; i < 9; i += 2) for (let j = 2; j < 8; j += 2) px(x, (i + j) % 4 ? "#d8402f" : "#f0c94a", i, j, 2, 2); });
const CHEST = art(12, 6, (x) => { px(x, WOOD[0], 0, 0, 12, 6); px(x, "#7a756c", 0, 0, 12, 1); px(x, "#7a756c", 0, 3, 12, 1); px(x, "#e8c66a", 5, 2, 2, 2); });
const STRONGBOX = art(16, 20, (x) => { px(x, "#55595f", 0, 0, 16, 20); px(x, "#6a6f76", 1, 1, 14, 18); x.strokeStyle = "#3a3e44"; x.strokeRect(3.5, 3.5, 9, 13); disc(x, 8, 10, 2, "#c8a040"); });
const CORK = art(18, 12, (x) => { px(x, WOOD[1], 0, 0, 18, 12); px(x, "#c89a64", 1, 1, 16, 10); for (const [a, b] of [[2, 2], [7, 3], [12, 2], [4, 7], [10, 7]]) { px(x, "#f4f0d8", a, b, 4, 3); px(x, "#d8402f", a + 1, b, 1, 1); } });
const COUNTER = planks(WOOD[0], WOOD[1], WOOD[2]);
const BARREL = outline(art(8, 9, (x) => { px(x, "#9a6a3a", 1, 1, 6, 7); px(x, "#b5844f", 2, 1, 2, 7); px(x, "#55595f", 1, 2, 6, 1); px(x, "#55595f", 1, 6, 6, 1); px(x, "#7a4a2b", 1, 1, 6, 1); }));
const RIBBON = outline(art(7, 10, (x) => { disc(x, 3, 3, 2, "#3f5f9e"); px(x, "#e8c66a", 3, 3); px(x, "#3f5f9e", 2, 5, 1, 4); px(x, "#3f5f9e", 4, 5, 1, 4); px(x, "#6b4226", 0, 9, 7, 1); }));
const SCARECROW = outline(art(12, 20, (x) => { px(x, "#6b4226", 5, 6, 2, 14); px(x, "#6b4226", 1, 8, 10, 2); px(x, "#5aa055", 3, 7, 6, 6); px(x, "#e8c66a", 0, 8, 2, 2); px(x, "#e8c66a", 10, 8, 2, 2); disc(x, 6, 4, 2, "#e8d8a0"); px(x, EYE, 5, 4); px(x, EYE, 7, 4); px(x, "#a8652e", 2, 1, 8, 1); px(x, "#a8652e", 4, 0, 4, 1); }));
function furniture(scene: THREE.Object3D) {
  for (const f of FURNITURE) {
    const x = f.x + f.w / 2, z = f.z + f.d / 2, y = heightAt(x, z);
    if (f.kind === "barrel") { scene.add(cutout(BARREL, x, z + 0.3, y)); continue; }
    if (f.kind === "cup") { scene.add(cutout(RIBBON, x, z + 0.3, y)); continue; }
    if (f.kind === "statue") { scene.add(cutout(SCARECROW, x, z + 0.3, y)); continue; }
    const look: Record<string, [number, Face, Face, number?]> = {
      table: [0.7, WOODTOP, WOODFRONT], readtable: [0.7, WOODTOP, WOODFRONT], desk: [0.8, WOODTOP, WOODFRONT], worktop: [0.9, WOODTOP, WOODFRONT],
      bar: [1.0, WOODTOP, COUNTER], counter: [1.0, WOODTOP, COUNTER], chest: [0.6, WOODTOP, CHEST], gold: [0.5, CRATES, WOODFRONT],
      shelf: [1.8, CAP, SHELF], shelfback: [1.8, CAP, SHELF], trophycase: [1.6, CAP, JARS], vault: [2.0, CAP, STRONGBOX], noticeboard: [1.2, CAP, CORK, 0.6],
    };
    const [h, top, front, lift] = look[f.kind] ?? [0.7, WOODTOP, WOODFRONT];
    scene.add(block(f.w, h, f.d, top, front, x, y + (lift ?? 0), z));
  }
}

// ---------- the meeting house and the cookhouse ----------
const WHITEWASH = planks("#e8e0cc", "#c8bea8", "#f4eee0");
const meetingStyle = style(WHITEWASH, "#4f7a3a", ["#3f6a8a", "#355a78", "#2a4860"]);
const cookStyle = style(bricks("#b5844f", "#8f6235", "#c79a62"), "#e8c66a", ["#8a5a35", "#6e4527", "#5a3a22"]);
function meetingHouse(scene: THREE.Object3D, roofs: THREE.Object3D[]) {
  const roof = shell(scene, roofs, CHAPEL, meetingStyle, { x: CHAPEL.door, north: true }, null);
  // The bell tower: its base in the room's corner, its top with the roof.
  scene.add(block(TOWER.s, 1.2, TOWER.s, CAP, WHITEWASH, TOWER.x + TOWER.s / 2, 0.14, TOWER.z + TOWER.s / 2));
  roof.add(block(TOWER.s, 2.8, TOWER.s, CAP, art(16, 28, (x) => { x.drawImage(WHITEWASH, 0, 0); x.drawImage(WHITEWASH, 0, 10); x.drawImage(WHITEWASH, 0, 20); px(x, OUT, 4, 4, 8, 9); px(x, "#e8c66a", 6, 7, 4, 5); px(x, "#a8652e", 7, 12, 2, 1); }), TOWER.x + TOWER.s / 2, 1.34, TOWER.z + TOWER.s / 2));
  roof.add(block(TOWER.s + 0.4, 0.6, TOWER.s + 0.4, roofTop(TOWER.s + 0.4, TOWER.s + 0.4, ...meetingStyle.roof), meetingStyle.eave, TOWER.x + TOWER.s / 2, 4.14, TOWER.z + TOWER.s / 2));
  for (const p of PEWS) scene.add(block(p.w, 0.45, p.d, WOODTOP, WOODFRONT, p.x + p.w / 2, 0.14, p.z + p.d / 2));
  const lectern = art(16, 9, (x) => { px(x, "#a8402f", 0, 0, 16, 9); px(x, "#e8c66a", 0, 7, 16, 1); px(x, "#e8c66a", 7, 1, 2, 5); });
  scene.add(block(1.6, 0.9, 0.8, art(16, 8, (x) => { px(x, "#f4eee0", 0, 0, 16, 8); px(x, "#e8c66a", 3, 3, 1, 2); px(x, "#e8c66a", 12, 3, 1, 2); }), lectern, ALTAR[0], 0.14, ALTAR[1]));
}
const STOVE_TOP = art(12, 7, (x) => { px(x, "#2a2a2e", 0, 0, 12, 7); disc(x, 3, 3, 2, "#55595f"); disc(x, 8, 3, 2, "#55595f"); px(x, "#ff8a20", 3, 3); px(x, "#ff8a20", 8, 3); });
const STOVE_FRONT = art(12, 9, (x) => { px(x, "#3a3a40", 0, 0, 12, 9); px(x, "#2a2a2e", 2, 2, 8, 5); px(x, "#ff8a20", 3, 5, 6, 1); px(x, "#c8ccd4", 4, 1, 4, 1); });
function cookhouse(scene: THREE.Object3D, roofs: THREE.Object3D[]) {
  shell(scene, roofs, KITCHEN, cookStyle, null, "north");
  for (const [x, z] of GRILLS) scene.add(block(1.2, 0.9, 0.7, STOVE_TOP, STOVE_FRONT, x, 0.14, z));
}

// ---------- the stations ----------
const ANVIL = outline(art(10, 9, (x) => { px(x, "#6b4226", 2, 5, 6, 4); px(x, "#4e2f1a", 2, 8, 6, 1); px(x, "#55595f", 0, 1, 9, 2); px(x, "#6a6f76", 0, 1, 9, 1); px(x, "#55595f", 3, 3, 4, 2); px(x, "#55595f", 9, 1, 1, 1); }));
const PUMPKIN = outline(art(13, 10, (x) => { disc(x, 6, 6, 3, "#e08a2b"); disc(x, 3, 6, 2, "#c96f1a"); disc(x, 9, 6, 2, "#c96f1a"); px(x, "#f0a94a", 5, 4, 2, 1); px(x, "#4e8f36", 6, 1, 1, 3); px(x, "#5aa055", 7, 1, 3, 2); }));
const SPINNER = outline(art(10, 11, (x) => { x.strokeStyle = WOOD[1]; x.beginPath(); x.arc(6, 4.5, 3.5, 0, Math.PI * 2); x.stroke(); px(x, WOOD[0], 6, 4); px(x, WOOD[0], 1, 6, 1, 5); px(x, WOOD[0], 8, 6, 1, 5); px(x, WOOD[0], 1, 9, 8, 1); px(x, "#efe6d2", 0, 4, 2, 2); }));
const POTTER = outline(art(9, 8, (x) => { px(x, WOOD[0], 1, 5, 7, 3); px(x, "#55595f", 0, 4, 9, 1); px(x, "#c96f4a", 2, 1, 5, 3); px(x, "#a8573a", 3, 0, 3, 1); }));
const LOOM = outline(art(12, 13, (x) => { px(x, WOOD[0], 0, 0, 1, 13); px(x, WOOD[0], 11, 0, 1, 13); px(x, WOOD[0], 0, 0, 12, 1); px(x, WOOD[0], 0, 9, 12, 1); for (let i = 2; i < 11; i += 2) px(x, "#efe6d2", i, 1, 1, 8); px(x, "#3f5f9e", 1, 5, 10, 3); }));
const BENCH_TOP = art(11, 7, (x) => { x.drawImage(WOODTOP, 0, 0); px(x, "#55595f", 2, 2, 3, 1); px(x, "#6b4226", 6, 3, 4, 1); px(x, "#c8ccd4", 8, 1, 1, 2); });
const FORGE_TOP = art(22, 13, (x) => { px(x, STONE[1], 0, 0, 22, 13); for (let i = 0; i < 22; i += 4) px(x, STONE[2], i, (i * 3) % 13, 3, 1); px(x, OUT, 6, 3, 10, 7); px(x, "#ff8a20", 7, 4, 8, 5); px(x, "#ffd040", 9, 5, 4, 3); });
const FORGE_FRONT = art(22, 14, (x) => { x.drawImage(bricks(STONE[0], STONE[1], STONE[2]), 0, 0); x.drawImage(bricks(STONE[0], STONE[1], STONE[2]), 10, 0); x.drawImage(bricks(STONE[0], STONE[1], STONE[2]), 20, 0); x.drawImage(bricks(STONE[0], STONE[1], STONE[2]), 0, 10); x.drawImage(bricks(STONE[0], STONE[1], STONE[2]), 10, 10); x.drawImage(bricks(STONE[0], STONE[1], STONE[2]), 20, 10); px(x, OUT, 7, 6, 8, 6); px(x, "#ff8a20", 8, 8, 6, 4); px(x, "#ffd040", 9, 10, 4, 2); });
/** Two frames side by side, swapped while the World runs: the bonfire's flames. */
const FIRE = outline(art(24, 15, (x) => {
  for (const o of [0, 12]) {
    px(x, "#6b4226", o + 1, 12, 10, 2); px(x, "#4e2f1a", o + 2, 11, 8, 1);
    const k = o ? 1 : 0;
    disc(x, o + 6, 8 - k, 3, "#ff8a20"); px(x, "#ff8a20", o + 4 + k, 2, 2, 4); px(x, "#ff8a20", o + 7 - k, 1 + k, 2, 4);
    px(x, "#ffd040", o + 5, 6, 3, 4); px(x, "#fff2a0", o + 6, 8, 1, 2);
  }
}));
const DUCK = outline(art(7, 5, (x) => { px(x, "#f4f0d8", 0, 2, 6, 3); px(x, "#f4f0d8", 4, 0, 3, 3); px(x, EYE, 5, 1); px(x, "#e08a2b", 7, 1, 1, 1); px(x, "#d8d0b8", 1, 3, 3, 1); }));
const PLANK_PILE = outline(art(14, 5, (x) => { for (let j = 0; j < 3; j++) { px(x, WOOD[2], j, 1 + j, 13 - j, 1); px(x, WOOD[1], j, 2 + j, 13 - j, 1); } }));
const POST = art(2, 18, (x) => { px(x, WOOD[0], 0, 0, 2, 18); px(x, WOOD[1], 1, 0, 1, 18); });
const anims: ((t: number) => void)[] = [];
function stations(scene: THREE.Object3D) {
  for (const [x, z] of ANVILS) scene.add(cutout(ANVIL, x, z + 0.2));
  scene.add(block(2.2, 1.4, 1.3, FORGE_TOP, FORGE_FRONT, FURNACE[0], heightAt(...FURNACE), FURNACE[1]));
  for (const [x, z] of ROCKS) scene.add(cutout(PUMPKIN, x, z + 0.45));
  // The new coop: its floor down, two walls up, posts at the corners, planks waiting.
  const sy = heightAt(SITE.x + SITE.w / 2, SITE.z + SITE.d / 2);
  scene.add(block(SITE.w, 0.2, SITE.d, FLOOR, WOODFRONT, SITE.x + SITE.w / 2, sy, SITE.z + SITE.d / 2));
  scene.add(block(SITE.w, 1.3, 0.2, CAP, WOODFRONT, SITE.x + SITE.w / 2, sy + 0.2, SITE.z + 0.1));
  scene.add(block(0.2, 0.8, SITE.d * 0.6, CAP, WOODFRONT, SITE.x + 0.1, sy + 0.2, SITE.z + SITE.d * 0.3));
  for (const [x, z] of [[SITE.x + 0.1, SITE.z + SITE.d - 0.1], [SITE.x + SITE.w - 0.1, SITE.z + SITE.d - 0.1]]) scene.add(cutout(POST, x, z, sy + 0.2));
  scene.add(cutout(PLANK_PILE, SITE.x + SITE.w + 1.2, SITE.z + SITE.d - 0.6));
  for (const w of WORKSHOP) {
    if (w.kind === "bench") scene.add(block(1.1, 0.8, 0.7, BENCH_TOP, WOODFRONT, w.x, heightAt(w.x, w.z), w.z));
    else scene.add(cutout(w.kind === "spinning" ? SPINNER : w.kind === "pottery" ? POTTER : LOOM, w.x, w.z + 0.3));
  }
  // The bonfire: two frames of flame, swapped.
  const map = tex(FIRE), geo = new THREE.PlaneGeometry(FIRE.width / 2 / PPU, FIRE.height / PPU); geo.translate(0, FIRE.height / PPU / 2, 0); map.repeat.set(0.5, 1);
  const fire = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide }));
  fire.position.set(snap(BONFIRE[0]), snap(heightAt(...BONFIRE)), snap(BONFIRE[1] + 0.4));
  anims.push((t) => { map.offset.x = Math.floor(t * 6) % 2 ? 0.5 : 0; });
  scene.add(fire);
  // The notice board, on posts under a little roof; the pond's duck.
  const by = heightAt(BOARD.x, BOARD.z);
  scene.add(block(BOARD.w, 1.8, 0.25, CAP, art(34, 18, (x) => { px(x, WOOD[1], 0, 0, 34, 18); px(x, "#c89a64", 1, 1, 32, 16); for (let j = 3; j < 17; j += 4) px(x, "#b5844f", 1, j, 32, 1); }), BOARD.x, by + 0.75, BOARD.z - 0.08));
  scene.add(block(BOARD.w + 0.5, 0.25, 0.6, roofTop(BOARD.w + 0.5, 0.6, "#b8433a", "#9a3830", "#7e2c26"), eave("#7e2c26", OUT), BOARD.x, by + 2.55, BOARD.z - 0.08));
  for (const dx of [-1.4, 1.4]) scene.add(cutout(art(2, 8, (x) => { px(x, WOOD[1], 0, 0, 2, 8); }), BOARD.x + dx, BOARD.z + 0.06, by));
  const duck = cutout(DUCK, CX, CZ); scene.add(duck);
  anims.push((t) => { const a = t * 0.25; duck.position.set(snap(CX + Math.cos(a) * 1.0), snap(heightAt(CX, CZ) - 0.05), snap(CZ + Math.sin(a) * 0.7)); duck.scale.x = Math.sin(a) > 0 ? -1 : 1; });
}

// ---------- fences, signs, lamps, trees ----------
const FENCE = art(10, 9, (x) => { px(x, WOOD[1], 0, 0, 2, 9); px(x, WOOD[0], 0, 0, 1, 9); px(x, WOOD[2], 0, 2, 10, 1); px(x, WOOD[1], 0, 3, 10, 1); px(x, WOOD[2], 0, 6, 10, 1); px(x, WOOD[1], 0, 7, 10, 1); });
const RAIL = art(10, 2, (x) => { px(x, WOOD[2], 0, 0, 10, 1); px(x, WOOD[1], 0, 1, 10, 1); });
const FENCEPOST = outline(art(2, 9, (x) => { px(x, WOOD[0], 0, 0, 2, 9); px(x, WOOD[2], 0, 0, 1, 9); }));
const SIGNPOST = outline(art(11, 14, (x) => { px(x, WOOD[1], 4, 4, 2, 10); px(x, WOOD[2], 0, 0, 10, 5); px(x, WOOD[0], 0, 4, 10, 1); px(x, WOOD[1], 2, 2, 6, 1); px(x, WOOD[2], 10, 1, 1, 3); }));
const WARNING = outline(art(10, 14, (x) => { px(x, WOOD[1], 4, 5, 2, 9); px(x, "#d8402f", 0, 0, 10, 6); px(x, "#f4f0d8", 4, 1, 2, 2); px(x, "#f4f0d8", 4, 4, 2, 1); }));
const LANTERN = outline(art(5, 17, (x) => { px(x, "#3a3a40", 2, 4, 1, 13); px(x, "#3a3a40", 0, 0, 5, 1); px(x, "#ffd040", 1, 1, 3, 3); px(x, "#fff2a0", 2, 2, 1, 1); px(x, "#3a3a40", 1, 16, 3, 1); }));
function fences(scene: THREE.Object3D) {
  for (const [x1, z1, x2, z2] of FENCES) {
    const y = Math.max(heightAt(x1, z1), heightAt(x2, z2));
    if (Math.abs(z1 - z2) < 0.01) scene.add(strip(FENCE, Math.abs(x2 - x1), (x1 + x2) / 2, z1, y));
    else {
      const len = Math.abs(z2 - z1), z0 = Math.min(z1, z2);
      scene.add(block(0.12, 0.08, len, RAIL, OUT, x1, y + 0.55, z0 + len / 2));
      for (let k = 0; k <= len + 0.01; k += 1) scene.add(cutout(FENCEPOST, x1, z0 + Math.min(k, len), y));
    }
  }
  for (const [x, z] of [...SIGNS, ...BUILDINGS.map(signOf)]) scene.add(cutout(SIGNPOST, x, z));
  scene.add(cutout(WARNING, WILD_SIGN[0], WILD_SIGN[1]));
  for (const [x, z] of LAMPS) scene.add(cutout(LANTERN, x, z));
}
const treeArt = new Map<string, Art>();
function treeOf(t: Tree): Art {
  const fruit = GROVE.some(([x, z]) => Math.hypot(x - t.x, z - t.z) < 0.1), key = `${t.kind}${fruit ? "f" : ""}${Math.round(t.s * 5)}`;
  let c = treeArt.get(key);
  if (c) return c;
  seed = key.length * 31 + Math.round(t.s * 50);
  if (t.kind === "pine") {
    const h = Math.round(22 * t.s), w = Math.round(14 * t.s) + 3;
    c = art(w, h + 5, (x) => {
      px(x, "#6b4226", w / 2 - 1, h, 3, 5);
      for (let k = 0; k < 3; k++) { const top = Math.round((k * h) / 4), bot = Math.round(h * (0.45 + k * 0.27)); for (let j = top; j < bot; j++) { const half = Math.round(((j - top) / (bot - top)) * (w / 2 - 1)) + 1; px(x, "#2f6128", Math.floor(w / 2) - half, j, half * 2, 1); px(x, "#3f7a34", Math.floor(w / 2) - half + 1, j, half - 1, 1); } }
    });
  } else if (t.kind === "dead") {
    const h = Math.round(24 * t.s), w = Math.round(18 * t.s);
    c = art(w, h, (x) => {
      px(x, "#4e2f1a", w / 2 - 1, h * 0.35, 3, h * 0.65);
      for (let k = 0; k < 6; k++) { const y = Math.round(h * (0.2 + rand() * 0.4)), dir = k % 2 ? 1 : -1; for (let s = 0; s < w * 0.35; s++) px(x, "#4e2f1a", Math.round(w / 2 + dir * s), Math.round(y - s * 0.6)); }
      for (let k = 0; k < 7; k++) disc(x, 2 + ri(w - 4), 2 + ri(Math.round(h * 0.4)), 2, rand() < 0.5 ? "#2f4a2a" : "#3a5a32");
    });
  } else {
    const R = Math.round((t.kind === "willow" ? 10 : 9) * t.s), trunk = Math.round(6 * t.s);
    c = art(R * 2 + 3, R * 2 + trunk + 2, (x) => {
      px(x, "#6b4226", R - 1, R * 2 - 2, 4, trunk + 3); px(x, "#4e2f1a", R - 1, R * 2 - 2, 1, trunk + 3);
      disc(x, R + 1, R, R, "#2f6128"); disc(x, R, R - 1, R - 1, "#3f7a34"); disc(x, R - 1, R - 2, Math.round(R * 0.6), "#57983f"); disc(x, R - 2, R - 4, Math.round(R * 0.3), "#79b84f");
      for (let k = 0; k < R * 1.5; k++) px(x, "#2f6128", 2 + ri(R * 2 - 2), 2 + ri(R * 2 - 2));
      if (t.kind === "willow") for (let i = 2; i < R * 2; i += 3) px(x, "#79b84f", i, R + 2 + ri(4), 1, R - 3);
      if (fruit) for (let k = 0; k < 9; k++) { const a = 2 + ri(R * 2 - 4), b = 2 + ri(R * 2 - 4); if (Math.hypot(a - R, b - R) < R - 1) px(x, "#d8402f", a, b, 2, 2); }
    });
  }
  outline(c);
  treeArt.set(key, c);
  return c;
}

// ---------- the farm ----------
function buildFarm() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color("#2f5222");
  // The World's sparks and smoke are lit; everything else is drawn in its own colours.
  scene.add(new THREE.AmbientLight(0xffffff, 2.2));
  const ground = groundMesh(groundArt()); scene.add(ground);
  const roofs: THREE.Object3D[] = [];
  buildings(scene, roofs); furniture(scene); meetingHouse(scene, roofs); cookhouse(scene, roofs);
  stations(scene); fences(scene);
  for (const t of TREES) scene.add(cutout(treeOf(t), t.x, t.z + 0.15, heightAt(t.x, t.z), 0.2));
  const start = performance.now();
  scene.onBeforeRender = () => { const t = (performance.now() - start) / 1000; for (const a of anims) a(t); };
  return { scene, ground, roofs, walls: [] as THREE.Mesh[] };
}

// ---------- the farmhands ----------
const SHIRTS = [0xd9a03f, 0x4f8fd0, 0x5aa055, 0xd8402f, 0xe07a9a, 0x9a6fc0, 0x3fb0a0];
const PANTS = ["#3f5f9e", "#4a5a7a", "#6b5a40", "#5a4a3a", "#3a4a6a"];
const SKINS = ["#f2c39b", "#e0a878", "#c68a5a", "#8d5a3a", "#f6d0aa", "#a8704a"];
const HAIR = ["#5a3a22", "#2a1a12", "#c96f1a", "#e8c66a", "#8a5a2a", "#9a9a9a", "#3a2418"];
type Pal = { skin: string; hair: string; shirt: string; pants: string; boots: string };
type Dir = "D" | "U" | "S";
type Pose = "stand" | "walk1" | "walk2" | "up" | "work" | "sit";
const FW = 12, FH = 18;
/** Frames on one strip: facing down (stand, two steps, arms up, at work, sitting), facing away, facing side. */
const ORDER: [Dir, Pose][] = [["D", "stand"], ["D", "walk1"], ["D", "walk2"], ["D", "up"], ["D", "work"], ["D", "sit"],
  ["U", "stand"], ["U", "walk1"], ["U", "walk2"], ["U", "up"], ["U", "work"], ["S", "stand"], ["S", "walk1"], ["S", "walk2"], ["S", "up"], ["S", "work"]];
const frameOf = (d: Dir, p: Pose) => Math.max(0, ORDER.findIndex(([a, b]) => a === d && b === p));
function drawFrame(x: Ctx, ox: number, dir: Dir, pose: Pose, p: Pal) {
  const f = (a: number, b: number, w: number, h: number, c: string) => { if (h > 0 && w > 0) px(x, c, ox + a, b, w, h); };
  const oy = pose === "sit" ? 3 : 0, by = 8 + oy, ly = 12 + oy, sw = pose === "walk1" ? 1 : pose === "walk2" ? -1 : 0;
  // Head.
  if (dir === "D") { f(4, 1 + oy, 4, 1, p.hair); f(3, 2 + oy, 6, 1, p.hair); f(2, 3 + oy, 8, 1, p.hair); f(3, 4 + oy, 6, 3, p.skin); f(2, 4 + oy, 1, 2, p.hair); f(9, 4 + oy, 1, 2, p.hair); f(4, 5 + oy, 1, 1, EYE); f(7, 5 + oy, 1, 1, EYE); f(4, 7 + oy, 4, 1, p.skin); }
  else if (dir === "U") { f(4, 1 + oy, 4, 1, p.hair); f(3, 2 + oy, 6, 1, p.hair); f(2, 3 + oy, 8, 4, p.hair); f(3, 7 + oy, 6, 1, p.hair); }
  else { f(4, 1 + oy, 4, 1, p.hair); f(3, 2 + oy, 6, 2, p.hair); f(3, 4 + oy, 2, 3, p.hair); f(5, 4 + oy, 4, 3, p.skin); f(9, 5 + oy, 1, 1, p.skin); f(7, 5 + oy, 1, 1, EYE); f(5, 7 + oy, 3, 1, p.skin); }
  // Body and arms.
  if (dir === "S") f(4, by, 4, 4, p.shirt); else f(3, by, 6, 4, p.shirt);
  if (pose === "up") { if (dir === "S") { f(6, by - 3, 2, 3, p.shirt); f(6, by - 4, 2, 1, p.skin); } else { f(1, by - 3, 2, 3, p.shirt); f(9, by - 3, 2, 3, p.shirt); f(1, by - 4, 2, 1, p.skin); f(9, by - 4, 2, 1, p.skin); } }
  else if (pose === "work") { if (dir === "S") { f(7, by + 1, 3, 1, p.shirt); f(10, by + 1, 1, 1, p.skin); } else if (dir === "D") { f(2, by, 1, 2, p.shirt); f(9, by, 1, 2, p.shirt); f(3, by + 2, 2, 1, p.skin); f(7, by + 2, 2, 1, p.skin); } else { f(2, by, 1, 3, p.shirt); f(9, by, 1, 3, p.shirt); } }
  else if (dir === "S") { f(5 + sw, by, 2, 3, p.shirt); f(5 + sw, by + 3, 2, 1, p.skin); }
  else { f(2, by + Math.max(0, sw), 1, 3, p.shirt); f(9, by + Math.max(0, -sw), 1, 3, p.shirt); f(2, by + 3 + Math.max(0, sw), 1, 1, p.skin); f(9, by + 3 + Math.max(0, -sw), 1, 1, p.skin); }
  // Legs and boots.
  if (pose === "sit") { f(3, ly, 6, 1, p.pants); f(3, ly + 1, 2, 1, p.boots); f(7, ly + 1, 2, 1, p.boots); }
  else if (dir === "S") {
    if (!sw) { f(4, ly, 4, 3, p.pants); f(4, ly + 3, 5, 1, p.boots); }
    else { const a = sw > 0 ? 6 : 3, b = sw > 0 ? 3 : 6; f(4, ly, 4, 1, p.pants); f(a, ly + 1, 2, 2, p.pants); f(a, ly + 3, 3, 1, p.boots); f(b, ly + 1, 2, 1, p.pants); f(b, ly + 2, 2, 1, p.boots); }
  } else {
    const l = pose === "walk1" ? 1 : 0, r = pose === "walk2" ? 1 : 0;
    f(3, ly, 6, 1, p.pants); f(3, ly + 1, 2, 2 - l, p.pants); f(3, ly + 3 - l, 2, 1, p.boots); f(7, ly + 1, 2, 2 - r, p.pants); f(7, ly + 3 - r, 2, 1, p.boots);
  }
}
function strip16(p: Pal): Art {
  const c = cv(FW * ORDER.length, FH);
  ORDER.forEach(([d, pose], i) => { const one = cv(FW, FH); drawFrame(ctx(one), 0, d, pose, p); outline(one); ctx(c).drawImage(one, i * FW, 0); });
  return c;
}
const PERSON_GEO = (() => { const g = new THREE.PlaneGeometry(FW / PPU, FH / PPU); g.translate(0, FH / PPU / 2 - 0.2, 0); return g; })();

/** A farmhand: a pixel sprite that faces the way it walks, steps as it goes and swings its tool at work. */
function farmhand(shirt: number, _legs = 0x3f5f9e, seed01 = 0.5, pal?: Partial<Pal>): Person {
  const pick = <T,>(xs: T[], k: number) => xs[Math.floor(rnd(seed01 * 97 + k) * xs.length)];
  const p: Pal = { skin: pick(SKINS, 1), hair: pick(HAIR, 2), shirt: hex(shirt), pants: pick(PANTS, 3), boots: "#5a3a22", ...pal };
  const g = new THREE.Group(), turn = new THREE.Group(), body = new THREE.Group(); g.add(turn); turn.add(body);
  const map = tex(strip16(p)); map.repeat.set(1 / ORDER.length, 1);
  const sprite = new THREE.Mesh(PERSON_GEO, new THREE.MeshBasicMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide })); body.add(sprite);
  const dummy = () => { const o = new THREE.Object3D(); turn.add(o); return o; };
  const hand = new THREE.Object3D(); body.add(hand);
  const head = new THREE.Object3D(); head.position.set(0, 1.3, 0.02); body.add(head);
  let t = seed01 * 10, dying = 0;
  const act = (what: Act, dt: number) => {
    t += dt;
    // Always face the view: undo the World's turn, and show the turn as which way the sprite looks.
    const r = g.rotation.y, c = Math.cos(r), s = Math.sin(r), dir: Dir = c > 0.6 ? "D" : c < -0.6 ? "U" : "S";
    turn.rotation.y = -r; body.scale.x = dir === "S" && s < 0 ? -1 : 1;
    dying = what === "die" ? Math.min(1, dying + dt * 2) : 0;
    body.rotation.x = -dying * (Math.PI / 2);
    const work = (rate: number) => (t * rate) % 1;
    let pose: Pose = "stand", swing = 0.35, lift = 0;
    if (what === "walk" || what === "run") pose = Math.floor(t * (what === "run" ? 10 : 7)) % 2 ? "walk1" : "walk2";
    else if (what === "sit" || what === "kneel") pose = dir === "D" ? "sit" : "stand";
    else if (what === "wave") pose = Math.floor(t * 3) % 2 ? "up" : "stand";
    else if (what === "cheer") { pose = "up"; lift = Math.abs(Math.sin(t * 9)) * 0.15; }
    else if (what === "attack" || what === "block") { const ph = work(1 / 2.4); pose = ph < 0.3 ? "work" : "stand"; swing = 0.9 - Math.min(1, ph / 0.3) * 1.8; }
    else if (what === "serve" || what === "count" || what === "read") pose = Math.floor(t * 0.8) % 2 ? "work" : "stand";
    else if (what === "fishing") { pose = "work"; swing = -0.9 + Math.sin(t * 2) * 0.05; }
    else if (what !== "idle" && what !== "die") {
      // At a skill: raise slowly, strike fast.
      const ph = work(1.1), up = ph < 0.72 ? ph / 0.72 : 1 - (ph - 0.72) / 0.28;
      pose = up > 0.5 ? "up" : "work"; swing = 1.2 - up * 2.2;
    }
    if (dir !== "D" && pose === "sit") pose = "stand";
    if (dir === "U" && (what === "sit" || what === "kneel")) sprite.position.y = -0.3; else sprite.position.y = lift;
    (map.offset as THREE.Vector2).x = frameOf(dir, pose === "sit" && dir !== "D" ? "stand" : pose) / ORDER.length;
    head.position.y = 1.3 - (pose === "sit" ? 0.3 : 0) + lift + (dir === "U" && (what === "sit" || what === "kneel") ? -0.3 : 0);
    hand.position.set(dir === "D" ? -0.4 : dir === "U" ? 0.4 : 0.3, 0.75 + lift, dir === "U" ? -0.03 : 0.03);
    hand.rotation.z = dir === "D" ? -swing : swing;
  };
  return { g, armL: dummy(), armR: dummy(), legL: dummy(), legR: dummy(), hand, head, act };
}

/** What a farmhand wears for its task: a straw hat to review, a hard hat to improve, a helm for a self-review. */
const HATS: Record<AgentTask, { art: Art; y: number }> = {
  review: { y: 0, art: outline(art(12, 5, (x) => { px(x, "#e8c66a", 0, 3, 12, 2); px(x, "#e8c66a", 3, 0, 6, 3); px(x, "#a8652e", 3, 2, 6, 1); px(x, "#f0d890", 4, 0, 4, 1); })) },
  build: { y: 0, art: outline(art(9, 3, (x) => { px(x, "#d8402f", 0, 0, 8, 3); px(x, "#f4f0d8", 2, 1, 1, 1); px(x, "#f4f0d8", 5, 1, 1, 1); px(x, "#d8402f", 8, 1, 1, 2); })) },
  fix: { y: 0, art: outline(art(11, 4, (x) => { px(x, "#3f8a4a", 1, 0, 8, 3); px(x, "#2f6a3a", 0, 3, 11, 1); px(x, "#f4f0d8", 4, 1, 2, 1); })) },
  verify: { y: 0, art: outline(art(10, 5, (x) => { px(x, "#8a5a35", 1, 0, 8, 4); px(x, "#6b4226", 0, 4, 10, 1); px(x, "#ffd040", 4, 1, 2, 2); })) },
  chart: { y: 0, art: outline(art(9, 6, (x) => { px(x, "#4f7a3a", 0, 2, 9, 4); px(x, "#4f7a3a", 1, 1, 7, 1); px(x, "#f4f0d8", 3, 0, 3, 2); px(x, "#3a5a2a", 0, 5, 9, 1); })) },
  improve: { y: 0, art: outline(art(11, 4, (x) => { px(x, "#f0c94a", 1, 0, 9, 3); px(x, "#d9a03f", 0, 3, 11, 1); px(x, "#fff2a0", 3, 0, 2, 1); })) },
  grill: { y: 0, art: outline(art(9, 7, (x) => { px(x, "#ffffff", 1, 4, 7, 3); disc(x, 4, 2, 2, "#ffffff"); px(x, "#e0e0e0", 1, 6, 7, 1); })) },
  selfreview: { y: -0.45, art: outline(art(10, 9, (x) => { px(x, "#8a9098", 0, 0, 10, 9); px(x, "#a8aeb6", 1, 1, 8, 2); px(x, "#2a2a2e", 1, 4, 8, 1); px(x, "#c8a040", 4, 0, 2, 2); })) },
};
function outfit(task: AgentTask): THREE.Object3D {
  const h = HATS[task], c = h.art, g = new THREE.Group(), geo = new THREE.PlaneGeometry(c.width / PPU, c.height / PPU);
  geo.translate(0, c.height / PPU / 2 + h.y, 0.01);
  g.add(new THREE.Mesh(geo, cutMat(c)));
  return g;
}

/** What's in a farmhand's hand, held from the bottom: a hammer at the forge, a watering can in the patch, a rod at the
 *  creek, a mug of cider. */
const TOOLS: Record<string, Art> = {
  smithing: outline(art(5, 10, (x) => { px(x, WOOD[1], 2, 3, 1, 7); px(x, "#55595f", 0, 0, 5, 3); })),
  crafting: outline(art(4, 8, (x) => { px(x, WOOD[1], 1, 3, 2, 5); px(x, "#9a6a3a", 0, 0, 4, 3); })),
  woodcutting: outline(art(6, 11, (x) => { px(x, WOOD[1], 2, 2, 1, 9); px(x, "#c8ccd4", 3, 0, 3, 4); px(x, "#9aa0a8", 3, 3, 3, 1); })),
  mining: outline(art(8, 6, (x) => { px(x, "#4f8fd0", 1, 1, 5, 5); px(x, "#4f8fd0", 6, 2, 2, 1); px(x, "#3f6f9c", 0, 1, 1, 2); px(x, "#6aa6e0", 2, 2, 2, 1); })),
  fishing: outline(art(3, 20, (x) => { px(x, WOOD[1], 1, 0, 1, 20); px(x, "#efe6d2", 2, 0, 1, 1); })),
  construction: outline(art(5, 9, (x) => { px(x, WOOD[2], 2, 2, 1, 7); px(x, "#55595f", 0, 0, 5, 2); })),
  cooking: outline(art(6, 9, (x) => { px(x, "#2a2a2e", 2, 4, 1, 5); px(x, "#3a3a40", 0, 0, 6, 4); })),
  mug: outline(art(5, 5, (x) => { px(x, "#c98b4a", 0, 1, 4, 4); px(x, "#f4f0d8", 0, 0, 4, 1); px(x, "#c98b4a", 4, 2, 1, 2); })),
  sword: outline(art(3, 12, (x) => { px(x, "#c8ccd4", 1, 0, 1, 9); px(x, "#c8a040", 0, 9, 3, 1); px(x, WOOD[1], 1, 10, 1, 2); })),
  staff: outline(art(4, 16, (x) => { px(x, WOOD[1], 1, 3, 2, 13); disc(x, 2, 1, 1, "#40a0ff"); })),
};
function tool(kind: Skill | "mug" | "sword" | "staff") {
  const c = TOOLS[kind] ?? TOOLS.smithing, g = new THREE.Group(), geo = new THREE.PlaneGeometry(c.width / PPU, c.height / PPU);
  geo.translate(0, c.height / PPU / 2 - 0.15, 0);
  g.add(new THREE.Mesh(geo, cutMat(c)));
  return g;
}

/** The cider house's barkeep, the shipping barn's clerk, the almanac house's keeper: each behind their counter. */
function keeper(kind: Keeper) {
  const at = (k: string) => FURNITURE.find((f) => f.kind === k)!;
  const p = farmhand(kind === "bartender" ? 0xf4f0d8 : kind === "teller" ? 0x5aa055 : 0x9a6fc0, 0, kind === "bartender" ? 0.37 : kind === "teller" ? 0.71 : 0.23);
  if (kind === "bartender") { const b = at("bar"); p.g.position.set(b.x + b.w / 2, 0.14, 36.5); p.g.rotation.y = Math.PI; }
  else if (kind === "teller") { const c = at("counter"); p.g.position.set(c.x + c.w / 2, 0.14, c.z - 0.75); }
  else { const d = at("desk"); p.g.position.set(d.x + d.w / 2, 0.14, d.z + d.d + 0.35); p.g.rotation.y = Math.PI; }
  p.head?.add(outfit(kind === "bartender" ? "grill" : kind === "teller" ? "fix" : "chart"));
  return p;
}

/** A note pinned to the notice board, its pin in its lane's colour. */
function note(pin: number) {
  const c = outline(art(6, 6, (x) => { px(x, "#f4f0d8", 0, 1, 6, 5); px(x, "#c8bea8", 1, 3, 4, 1); px(x, "#c8bea8", 1, 4, 3, 1); px(x, hex(pin), 2, 0, 2, 2); }));
  const g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.6), cutMat(c))); return g;
}
/** The arrow over the notice board, a flat cut-out that spins like a coin. */
function hintArrow(color: number) {
  const c = outline(art(9, 10, (x) => { px(x, hex(color), 3, 0, 3, 5); px(x, hex(color), 0, 5, 9, 1); px(x, hex(color), 1, 6, 7, 1); px(x, hex(color), 2, 7, 5, 1); px(x, hex(color), 3, 8, 3, 1); px(x, hex(color), 4, 9, 1, 1); }));
  const g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.PlaneGeometry(0.9, 1.0), cutMat(c))); return g;
}
/** The farm from above, for the minimap. */
function minimap() {
  const c = cv(W * MM, ROWS * MM), g = ctx(c);
  g.drawImage(groundArt(), 0, 0, c.width, c.height);
  for (const t of TREES) { g.fillStyle = t.kind === "dead" ? "#2f4a2a" : "#2f6128"; g.fillRect(t.x * MM - 2, mmz(t.z) - 2, 4, 4); }
  for (const b of BUILDINGS) { g.fillStyle = STYLES[b.id].roof[0]; g.fillRect(b.x * MM, mmz(b.z), b.w * MM, b.d * MM); }
  g.fillStyle = meetingStyle.roof[0]; g.fillRect(CHAPEL.x * MM, mmz(CHAPEL.z), CHAPEL.w * MM, CHAPEL.d * MM);
  g.fillStyle = cookStyle.roof[0]; g.fillRect(KITCHEN.x * MM, mmz(KITCHEN.z), KITCHEN.w * MM, KITCHEN.d * MM);
  return c;
}

export const FARM: WorldKit = {
  buildTown: buildFarm, person: farmhand, outfit, keeper, tool, scroll: note, hintArrow, minimapImage: minimap, shirts: SHIRTS,
  buildings: {
    next: { name: "Farmhouse", does: "Next: what to do, one at a time" },
    finished: { name: "Shipping Barn", does: "Finished: what shipped, day by day" },
    sessions: { name: "Cider House", does: "Sessions: every agent in herdr, at work or having a cider" },
    docs: { name: "Almanac House", does: "Docs: glossary, ADRs and visuals" },
  },
  areas: {
    Smithy: "Forge", Mine: "Pumpkin Patch", Grove: "Orchard", "Riverbank north": "Creek north", "Riverbank south": "Creek south", Inn: "Cider House",
    Wilderness: "Wild Woods", "Construction site": "New Coop", Kitchen: "Cookhouse", Workshop: "Craft Shed", Chapel: "Meeting House", Bonfire: "Bonfire",
  },
  verbs: { smithing: "Building at the forge", crafting: "Fixing in the craft shed", fishing: "Reviewing down by the creek", mining: "Testing in the pumpkin patch", woodcutting: "Charting in the orchard", construction: "Working on the new coop", cooking: "Grilling in the cookhouse" },
  welcome: [{ t: "Welcome to the farm." }, { t: "Everyone you see is an agent at work. What needs you is pinned to the notice board north of the pond: yellow pins are your turn, red are asked of you, most pressing top left.", c: "blue" }],
  ground: "Soft grass, freshly cut.",
  board: "Notice board", pray: "in the meeting house, waiting on a review from", burn: "warming up at the bonfire: done,", drink: "having a cider at the Cider House",
  rest: { held: "mug" },
  fight: {
    hit: (scene: THREE.Scene, bits: Bit[], x: number, y: number, z: number) => burst(scene, bits, x, y, z, 0xe8c66a, 6, 0.8),
    attack: "Arguing the review", defend: "Self-review",
    holding: "holding the self-review's findings until its PR's session takes them", fighting: "arguing with its self-review over the findings",
    defeat: (w, l) => `${w} has won the argument with ${l}! The review's findings are back with ${w}.`,
  },
  panel: { quests: "Chores", stats: "Skills", options: "Options", list: "Chore list", statsTitle: "Farm skills", total: "Total level", xp: "XP",
    how: "XP comes from the board: CI passing, approvals and answered threads, agents finishing, and work shipping." },
  render: { view: "overhead", ppu: PPU },
};
