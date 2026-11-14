// The town: tiles, ground heights, buildings and what stands in them, and the walking grid with its paths.
// Pure data and maths, so tests and the 3D scene read the same town. One unit is one tile.

// x runs 0 to W; z from Z0, the Wilderness's north edge, to H. North is toward Z0.
export const W = 48, H = 47, Z0 = -18, CX = 24, CZ = 20;
export const ROWS = H - Z0;
/** The ditch at the Wilderness's edge: north of it is the Wilderness. */
export const WILD_Z = 1;
/** Grass, path, square, water, the Wilderness's scorched ground, its ditch. */
export type Tile = "g" | "p" | "s" | "w" | "k" | "d";
export type Building = { id: "next" | "finished" | "sessions" | "docs"; name: string; does: string; x: number; z: number; w: number; d: number; roof: number; door: [number, number] };
export type Rect = { kind: string; x: number; z: number; w: number; d: number };

/** A stable pseudo-random number in [0, 1) for a seed. */
export const rnd = (n: number) => { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); };

export const BUILDINGS: Building[] = [
  { id: "next", name: "Quest hall", does: "Next: what to do, one at a time", x: 12, z: 5, w: 9, d: 6, roof: 0x7a3a26, door: [16, 11] },
  { id: "finished", name: "Bank", does: "Finished: what shipped, day by day", x: 28, z: 5, w: 10, d: 6, roof: 0x34507a, door: [32, 11] },
  { id: "sessions", name: "Inn", does: "Sessions: every agent in herdr", x: 10, z: 27, w: 12, d: 10, roof: 0x6b4a1e, door: [15, 27] },
  { id: "docs", name: "Library", does: "Docs: glossary, ADRs and visuals", x: 28, z: 28, w: 10, d: 6, roof: 0x3d5e2c, door: [32, 28] },
];
export const WALL_H = 2.4, WALL_T = 0.22;
/** The Chapel, at the end of the road: a church with its door to the town, pews either side of the aisle facing the
 *  altar under a stained-glass window, and a bell tower. Those waiting on someone's review pray here. */
export const CHAPEL = { x: 19, z: 40, w: 11, d: 6, door: 24.5, h: 3.2 };
export const TOWER = { x: 19.1, z: 38.2, s: 1.6 };
export const nearChapel = (x: number, z: number) => x >= CHAPEL.x - 1 && x <= CHAPEL.x + CHAPEL.w + 1 && z >= TOWER.z - 1 && z <= CHAPEL.z + CHAPEL.d + 1;
/** The Kitchen, south of the Library: a cookhouse of stone on three sides, open to the north where its path
 *  comes in from the road, three grills under hoods along the back wall and a chimney through the roof. */
export const KITCHEN = { x: 31.5, z: 37, w: 6.5, d: 5, h: 2.6 };
export const nearKitchen = (x: number, z: number) => x >= KITCHEN.x - 1 && x <= KITCHEN.x + KITCHEN.w + 1 && z >= KITCHEN.z - 1 && z <= KITCHEN.z + KITCHEN.d + 1;

export const riverX = (z: number) => 5 + Math.sin(z / 4) * 1.6;
export const TILES: Tile[][] = (() => {
  const m: Tile[][] = Array.from({ length: ROWS }, () => Array<Tile>(W).fill("g"));
  const set = (x: number, z: number, t: Tile) => { m[z - Z0][x] = t; };
  for (let z = Z0; z < H; z++) for (let x = 0; x < W; x++) {
    if (z < WILD_Z) set(x, z, "k");
    if (z === WILD_Z) set(x, z, "d");
    if (Math.abs(x + 0.5 - riverX(z)) < 1.6) set(x, z, "w");
  }
  // The road crosses the river on a causeway, and runs north to the ditch.
  for (let x = 0; x < W; x++) for (const z of [19, 20]) set(x, z, "p");
  for (let z = WILD_Z + 1; z < 40; z++) for (const x of [23, 24]) set(x, z, "p");
  for (const b of BUILDINGS) { const [dx, dz] = b.door, [a, c] = dz < CZ ? [dz, 19] : [20, dz]; for (let z = a; z <= c; z++) { set(dx, z, "p"); set(dx + 1, z, "p"); } }
  for (let z = 14; z <= 25; z++) for (let x = 17; x <= 30; x++) set(x, z, "s");
  // The Kitchen's path: off the road under the Library's south wall, into its open front.
  for (let x = 25; x < KITCHEN.x + KITCHEN.w - 1; x++) for (const z of [35, 36]) set(x, z, "p");
  return m;
})();
export const tileAt = (x: number, z: number): Tile => TILES[Math.max(0, Math.min(ROWS - 1, Math.floor(z) - Z0))][Math.max(0, Math.min(W - 1, Math.floor(x)))];
export const inWild = (z: number) => z < WILD_Z;
export const buildingAt = (x: number, z: number) => BUILDINGS.find((b) => x > b.x && x < b.x + b.w && z > b.z && z < b.z + b.d) ?? null;
const nearBuilding = (x: number, z: number) => BUILDINGS.some((b) => x >= b.x - 0.5 && x <= b.x + b.w + 0.5 && z >= b.z - 0.5 && z <= b.z + b.d + 0.5);

/** Where a house's signpost stands: outside, beside its door. */
export function signOf(b: Building): [number, number] {
  const d = doorOf(b);
  return [d.x - 1.6, d.outside[1] + (d.outside[1] < d.z ? 0.3 : -0.3)];
}

/** The wall a building's door is in, and the points just outside and just inside the doorway. */
export function doorOf(b: Building) {
  const z = Math.abs(b.door[1] - b.z) < Math.abs(b.door[1] - (b.z + b.d)) ? b.z : b.z + b.d, out = z === b.z ? -1 : 1, x = b.door[0] + 1;
  return { x, z, outside: [x, z + out * 0.9] as [number, number], inside: [x, z - out * 0.9] as [number, number] };
}

// Ground heights at the grid corners: rolling hills, flat under the town, rougher in the Wilderness,
// the ditch and the river bed sunk.
const corners = [[0, 0], [-1, 0], [0, -1], [-1, -1]];
export const HV = new Float32Array((W + 1) * (ROWS + 1));
for (let z = Z0; z <= H; z++) for (let x = 0; x <= W; x++) {
  let h = 0.45 + 0.4 * Math.sin(x * 0.27) * Math.cos(z * 0.21) + 0.2 * Math.sin(x * 0.09 + z * 0.13);
  if (z < WILD_Z) h = 0.5 + 0.55 * Math.sin(x * 0.41 + 1) * Math.cos(z * 0.37) + 0.3 * Math.sin(x * 0.13 - z * 0.19);
  if (corners.some(([dx, dz]) => { const t = tileAt(x + dx, z + dz); return t === "p" || t === "s"; }) || nearBuilding(x, z) || nearChapel(x, z) || nearKitchen(x, z)) h = 0.08;
  if (corners.some(([dx, dz]) => tileAt(x + dx, z + dz) === "d")) h = -0.35;
  if (corners.some(([dx, dz]) => tileAt(x + dx, z + dz) === "w")) h = -0.8;
  HV[(z - Z0) * (W + 1) + x] = h;
}
/** The ground's height anywhere, between the corners. Floors inside buildings sit just above it. */
export function heightAt(x: number, z: number) {
  if (buildingAt(x, z)) return 0.14;
  const x0 = Math.max(0, Math.min(W - 1, Math.floor(x))), z0 = Math.max(Z0, Math.min(H - 1, Math.floor(z))), fx = x - x0, fz = z - z0;
  const h = (a: number, b: number) => HV[(b - Z0) * (W + 1) + a];
  return (h(x0, z0) * (1 - fx) + h(x0 + 1, z0) * fx) * (1 - fz) + (h(x0, z0 + 1) * (1 - fx) + h(x0 + 1, z0 + 1) * fx) * fz;
}

// ---------- what stands about: work stations, furniture, trees ----------
export const ANVILS: [number, number][] = [[37.5, 15.2], [40, 15.2], [42.5, 15.2]];
export const FURNACE: [number, number] = [40, 13.3];
export const ROCKS: [number, number][] = [[39.5, 23], [42.2, 22.6], [44.6, 23.6], [41.2, 25.6]];
export const GROVE: [number, number][] = [[42, 33], [45, 35.5], [41.5, 37.2], [45.5, 31.5]];
export const FISH_Z = [7, 11, 25, 30, 34];
/** The Construction site, north of the Smithy: a house half built, its footprint. */
export const SITE = { x: 40.5, z: 4.5, w: 5, d: 4 };
/** The Workshop, west of the square: a workbench, a spinning wheel, a potter's wheel and a loom, where fixes are crafted. */
export const WORKSHOP: { kind: "bench" | "spinning" | "pottery" | "loom"; x: number; z: number }[] = [
  { kind: "bench", x: 9.8, z: 13.6 }, { kind: "spinning", x: 13.2, z: 13.6 }, { kind: "pottery", x: 9.8, z: 16.6 }, { kind: "loom", x: 13.2, z: 16.6 },
];
export const ALTAR: [number, number] = [24.5, 45];
const PRAY_X = [21.1, 22.6, 26.4, 27.9], PRAY_Z = [41.9, 43.5];
export const PEWS: Rect[] = PRAY_Z.flatMap((z) => [{ kind: "pew", x: 20.5, z: z - 0.85, w: 2.7, d: 0.4 }, { kind: "pew", x: 25.8, z: z - 0.85, w: 2.7, d: 0.4 }]);
/** The Kitchen's grills, along its back wall, each cooked at from the front. */
export const GRILLS: [number, number][] = [[32.8, 40.95], [34.75, 40.95], [36.7, 40.95]];
/** The Quest hall's trophies: a gold cup and a statue on plinths where the hall's sides open out. */
export const PLINTHS: [number, number][] = [[13.6, 8.6], [19.4, 8.6]];
/** The Quest board, north of the fountain and facing it: a scroll pinned up for each item that needs the user. */
export const BOARD = { x: 24, z: 15.4, w: 3.4 };
export const BOARD_STAND: [number, number] = [24, 16.7];
const COLS = 4, ROWS_ON_BOARD = 3;
export const BOARD_SLOTS = COLS * ROWS_ON_BOARD;
/** Where scroll `i` hangs, by height above the ground: most pressing top left. */
export const slotAt = (i: number): [number, number, number] => [BOARD.x - 1.2 + (i % COLS) * 0.8, 2.15 - Math.floor(i / COLS) * 0.5, BOARD.z + 0.1];
/** The Bonfire, east of the square: spent sessions burn their logs here before they close. */
export const BONFIRE: [number, number] = [45.2, 17.4];
// Six tables in two rows, the bar along the back wall.
export const INN_TABLES: [number, number][] = [[12.6, 29.7], [16, 29.7], [19.4, 29.7], [12.6, 32.6], [16, 32.6], [19.4, 32.6]];
const BAR_STOOLS = [11.9, 13.2, 14.5, 15.8, 17.1, 18.4, 19.7];

/** Furniture, as the rectangles people walk round. The scene builds each kind's model from these. */
export const FURNITURE: Rect[] = [
  ...INN_TABLES.map(([x, z]) => ({ kind: "table", x: x - 0.65, z: z - 0.55, w: 1.3, d: 1.1 })),
  { kind: "bar", x: 11.4, z: 35.65, w: 9, d: 0.6 },
  // The Kitchen: a worktop by its west wall, a barrel in the north-east corner.
  { kind: "worktop", x: 31.85, z: 37.5, w: 0.6, d: 1.9 },
  ...[[10.8, 36.2], [21.2, 36.2], [21.2, 34.6], [37.2, 37.85]].map(([x, z]) => ({ kind: "barrel", x: x - 0.4, z: z - 0.4, w: 0.8, d: 0.8 })),
  { kind: "counter", x: 29, z: 7.35, w: 8, d: 0.5 },
  { kind: "chest", x: 28.6, z: 5.55, w: 1.2, d: 0.9 },
  // The Library: shelves along the front wall either side of the door and along the back, reading tables, the librarian's desk.
  ...[28.4, 30.3, 33.9, 35.8].map((x) => ({ kind: "shelf", x, z: 28.33, w: 1.8, d: 0.45 })),
  ...[28.4, 35.8].map((x) => ({ kind: "shelfback", x, z: 33.22, w: 1.8, d: 0.45 })),
  ...[[30.2, 30.9], [35.8, 30.9]].map(([x, z]) => ({ kind: "readtable", x: x - 0.65, z: z - 0.55, w: 1.3, d: 1.1 })),
  { kind: "desk", x: 32.2, z: 32.6, w: 1.6, d: 0.55 },
  // The Bank: a vault door in the back wall, gold behind the counter, a rug before it.
  { kind: "vault", x: 34.6, z: 5.22, w: 1.6, d: 0.2 },
  { kind: "gold", x: 31, z: 5.3, w: 1.6, d: 0.45 },
  { kind: "table", x: 15.85, z: 7.05, w: 1.3, d: 1.1 },
  { kind: "noticeboard", x: 15.6, z: 5.26, w: 1.8, d: 0.08 },
  // The Quest hall: trophy cabinets along the back wall either side of the board, the cup and the statue on their plinths.
  ...[12.4, 18.4].map((x) => ({ kind: "trophycase", x, z: 5.24, w: 2.35, d: 0.5 })),
  ...PLINTHS.map(([x, z], i) => ({ kind: i ? "statue" : "cup", x: x - 0.35, z: z - 0.35, w: 0.7, d: 0.7 })),
];

/** Trees about the town: on grass, clear of the roads, the square and the work stations. */
export type Tree = { x: number; z: number; s: number; kind: "oak" | "pine" | "willow" | "dead" };
/** Where fights happen, in the Wilderness: each a pair, a self-review against its PR's own session. */
export const DUELS: [number, number][] = [[16, -8], [21, -8], [26.5, -8], [31.5, -8], [18.5, -12.5], [29, -12.5]];
const duelGround = (x: number, z: number) => x > 13 && x < 34.5 && z > -15 && z < -5.5;
// Fences: round the Mine and the Grove, each with a gap to walk in by. Rails as [x1, z1, x2, z2].
export const FENCES: [number, number, number, number][] = [
  [37.6, 21.4, 46.4, 21.4], [46.4, 21.4, 46.4, 27.4], [46.4, 27.4, 37.6, 27.4], [37.6, 27.4, 37.6, 25.2], [37.6, 23.4, 37.6, 21.4],
  [39.4, 29.8, 47.2, 29.8], [47.2, 29.8, 47.2, 39.2], [39.4, 39.2, 47.2, 39.2], [39.4, 29.8, 39.4, 32.2], [39.4, 34.2, 39.4, 39.2],
];
/** Signposts at the crossroads by the square, and the lamps round it. */
export const SIGNS: [number, number, number][] = [[22.2, 18.2, -0.6], [25.8, 21.8, 2.4], [13.8, 21.3, 0], [33.7, 21.3, Math.PI]];
/** The warning sign where the road meets the ditch. */
export const WILD_SIGN: [number, number] = [22.1, 2.7];
export const LAMPS: [number, number][] = [[16.6, 13.6], [31.4, 13.6], [16.6, 26.4], [31.4, 26.4]];
const fenced = (x: number, z: number) => (x > 37 && x < 47 && z > 21 && z < 28) || (x > 39 && x < 48 && z > 29 && z < 40);

export const TREES: Tree[] = (() => {
  const out: Tree[] = [];
  const stations = [...ANVILS, FURNACE, ...ROCKS, ...GROVE, ...GRILLS, BONFIRE, ...WORKSHOP.map((w) => [w.x, w.z] as [number, number])];
  for (let i = 0; i < 400 && out.length < 46; i++) {
    const x = 1 + rnd(i * 7.1) * (W - 2), z = WILD_Z + 2 + rnd(i * 3.3 + 9) * (H - WILD_Z - 3);
    if (tileAt(x, z) !== "g" || nearBuilding(x, z) || [-2, 2].some((o) => tileAt(x + o, z) !== "g" || tileAt(x, z + o) !== "g")) continue;
    if (Math.hypot(x - CX, z - CZ) < 11 || stations.some(([sx, sz]) => Math.hypot(x - sx, z - sz) < 3) || fenced(x, z)) continue;
    if (x > SITE.x - 2.5 && x < SITE.x + SITE.w + 2.5 && z > SITE.z - 2.5 && z < SITE.z + SITE.d + 2.5) continue;
    if (x > CHAPEL.x - 2 && x < CHAPEL.x + CHAPEL.w + 2 && z > CHAPEL.z - 2) continue;
    if (nearKitchen(x, z)) continue;
    // Willows by the river, pines among the oaks.
    const kind = x - riverX(z) < 5 ? "willow" : rnd(i * 5.3) > 0.62 ? "pine" : "oak";
    out.push({ x, z, s: 0.8 + rnd(i) * 0.5, kind });
  }
  // Dead trees in the Wilderness, clear of where the fights are.
  const dead: Tree[] = [];
  for (let i = 0; i < 300 && dead.length < 22; i++) {
    const x = 1 + rnd(i * 4.7 + 3) * (W - 2), z = Z0 + 1 + rnd(i * 2.9 + 5) * (WILD_Z - Z0 - 3);
    if (tileAt(x, z) !== "k" || [-1.5, 1.5].some((o) => tileAt(x + o, z) !== "k") || duelGround(x, z)) continue;
    dead.push({ x, z, s: 0.8 + rnd(i + 7) * 0.5, kind: "dead" });
  }
  return [...out, ...dead, ...GROVE.map(([x, z]) => ({ x, z, s: 1.15, kind: "oak" as const }))];
})();

// ---------- the walking grid: half-tile cells, and paths through it ----------
export const CELL = 0.5;
const GW = W / CELL, GH = ROWS / CELL;
const overlaps = (cx: number, cz: number, x: number, z: number, w: number, d: number) => cx < x + w && cx + CELL > x && cz < z + d && cz + CELL > z;
export const BLOCKED: Uint8Array = (() => {
  const g = new Uint8Array(GW * GH);
  const rects: [number, number, number, number][] = [];
  for (const b of BUILDINGS) {
    const d = doorOf(b), back = d.z === b.z ? b.z + b.d - WALL_T : b.z, front = d.z === b.z ? b.z : b.z + b.d - WALL_T;
    rects.push([b.x, b.z, WALL_T, b.d], [b.x + b.w - WALL_T, b.z, WALL_T, b.d], [b.x, back, b.w, WALL_T]);
    rects.push([b.x, front, d.x - 0.6 - b.x, WALL_T], [d.x + 0.6, front, b.x + b.w - d.x - 0.6, WALL_T]);
  }
  for (const f of FURNITURE) rects.push([f.x, f.z, f.w, f.d]);
  for (const [x, z] of ANVILS) rects.push([x - 0.48, z - 0.21, 0.96, 0.42]);
  rects.push([FURNACE[0] - 1.1, FURNACE[1] - 0.65, 2.2, 1.3]);
  for (const [x, z] of ROCKS) rects.push([x - 0.55, z - 0.5, 1.1, 1]);
  rects.push([SITE.x, SITE.z, SITE.w, SITE.d]);
  for (const [x, z] of GRILLS) rects.push([x - 0.6, z - 0.35, 1.2, 0.7]);
  rects.push([BONFIRE[0] - 0.5, BONFIRE[1] - 0.5, 1, 1], [BOARD.x - BOARD.w / 2, BOARD.z - 0.2, BOARD.w, 0.4]);
  for (const w of WORKSHOP) rects.push([w.x - 0.55, w.z - 0.35, 1.1, 0.7]);
  for (const p of PEWS) rects.push([p.x, p.z, p.w, p.d]);
  {
    // The Kitchen's walls: west, east and back; the north side is open.
    const { x, z, w, d } = KITCHEN, t = 0.3;
    rects.push([x, z, t, d], [x + w - t, z, t, d], [x, z + d - t, w, t]);
  }
  {
    // The Chapel's walls, with the door in the north one, and its tower.
    const { x, z, w, d, door } = CHAPEL, t = 0.3;
    rects.push([ALTAR[0] - 0.8, ALTAR[1] - 0.4, 1.6, 0.8], [x, z, door - 0.8 - x, t], [door + 0.8, z, x + w - door - 0.8, t]);
    rects.push([x, z, t, d], [x + w - t, z, t, d], [x, z + d - t, w, t], [TOWER.x, TOWER.z, TOWER.s, TOWER.s]);
  }
  for (const t of TREES) rects.push([t.x - 0.2, t.z - 0.2, 0.4, 0.4]);
  for (const [x1, z1, x2, z2] of FENCES) rects.push([Math.min(x1, x2) - 0.06, Math.min(z1, z2) - 0.06, Math.abs(x2 - x1) + 0.12, Math.abs(z2 - z1) + 0.12]);
  for (const [x, z] of [...SIGNS, ...LAMPS, WILD_SIGN, ...BUILDINGS.map(signOf)]) rects.push([x - 0.12, z - 0.12, 0.24, 0.24]);
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    const cx = i * CELL, cz = Z0 + j * CELL, mx = cx + CELL / 2, mz = cz + CELL / 2;
    if (tileAt(mx, mz) === "w" || Math.hypot(mx - CX, mz - CZ) < 1.95 || rects.some(([x, z, w, d]) => overlaps(cx, cz, x, z, w, d))) g[j * GW + i] = 1;
  }
  return g;
})();
const BASE = BLOCKED.slice();
/** Walls a world kit builds that the town doesn't have, as [x, z, w, d]: the grid becomes the town's plus these.
 *  Called with none, it's the town's again. */
export function extraWalls(rects: [number, number, number, number][]) {
  BLOCKED.set(BASE);
  if (!rects.length) return;
  for (let j = 0; j < GH; j++) for (let i = 0; i < GW; i++) {
    const cx = i * CELL, cz = Z0 + j * CELL;
    if (rects.some(([x, z, w, d]) => overlaps(cx, cz, x, z, w, d))) BLOCKED[j * GW + i] = 1;
  }
}
const cellOf = (x: number, z: number): [number, number] => [Math.max(0, Math.min(GW - 1, Math.floor(x / CELL))), Math.max(0, Math.min(GH - 1, Math.floor((z - Z0) / CELL)))];
const free = (i: number, j: number) => i >= 0 && j >= 0 && i < GW && j < GH && !BLOCKED[j * GW + i];
export const walkable = (x: number, z: number) => { const [i, j] = cellOf(x, z); return free(i, j); };

/** The free cell nearest a point, searching outward ring by ring. */
function nearestFree(x: number, z: number): [number, number] | null {
  const [ci, cj] = cellOf(x, z);
  for (let r = 0; r < 12; r++) {
    let best: [number, number] | null = null, bd = Infinity;
    for (let j = cj - r; j <= cj + r; j++) for (let i = ci - r; i <= ci + r; i++) {
      if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r || !free(i, j)) continue;
      const d = Math.hypot((i + 0.5) * CELL - x, Z0 + (j + 0.5) * CELL - z);
      if (d < bd) { bd = d; best = [i, j]; }
    }
    if (best) return best;
  }
  return null;
}
/** Whether a straight walk between two points stays on free cells. */
function clear(ax: number, az: number, bx: number, bz: number) {
  const n = Math.ceil(Math.hypot(bx - ax, bz - az) / (CELL / 3));
  for (let k = 1; k < n; k++) if (!walkable(ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n)) return false;
  return true;
}

/**
 * The way from one point to another round walls, water and furniture: A* over the half-tile grid, eight
 * ways with no corner cutting, then straightened where a straight walk is clear. A goal inside something
 * (a seat at a table, a spot at an anvil) is reached from the nearest free cell. Empty: no way there.
 */
export function findPath(fx: number, fz: number, tx: number, tz: number): [number, number][] {
  const s = walkable(fx, fz) ? cellOf(fx, fz) : nearestFree(fx, fz), g = walkable(tx, tz) ? cellOf(tx, tz) : nearestFree(tx, tz);
  if (!s || !g) return [];
  const idx = (i: number, j: number) => j * GW + i, start = idx(...s), goal = idx(...g);
  const gs = new Float32Array(GW * GH).fill(Infinity), from = new Int32Array(GW * GH).fill(-1), shut = new Uint8Array(GW * GH);
  const h = (k: number) => { const dx = Math.abs((k % GW) - g[0]), dz = Math.abs(Math.floor(k / GW) - g[1]); return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz); };
  // A binary heap of [f, cell].
  const heap: [number, number][] = [];
  const push = (f: number, k: number) => { heap.push([f, k]); let c = heap.length - 1; while (c > 0) { const p = (c - 1) >> 1; if (heap[p][0] <= heap[c][0]) break; [heap[p], heap[c]] = [heap[c], heap[p]]; c = p; } };
  const pop = () => { const top = heap[0], end = heap.pop()!; if (heap.length) { heap[0] = end; let c = 0; for (;;) { const l = c * 2 + 1, r = l + 1; let m = c; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === c) break; [heap[m], heap[c]] = [heap[c], heap[m]]; c = m; } } return top[1]; };
  gs[start] = 0; push(h(start), start);
  while (heap.length) {
    const k = pop();
    if (k === goal) break;
    if (shut[k]) continue;
    shut[k] = 1;
    const i = k % GW, j = Math.floor(k / GW);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const ni = i + di, nj = j + dj;
      if (!free(ni, nj) || (di && dj && (!free(i + di, j) || !free(i, j + dj)))) continue;
      const n = idx(ni, nj), cost = gs[k] + (di && dj ? Math.SQRT2 : 1);
      if (cost < gs[n]) { gs[n] = cost; from[n] = k; push(cost + h(n), n); }
    }
  }
  if (start !== goal && from[goal] < 0) return [];
  const cells: [number, number][] = [];
  for (let k = goal; k !== -1 && k !== start; k = from[k]) cells.push([((k % GW) + 0.5) * CELL, Z0 + (Math.floor(k / GW) + 0.5) * CELL]);
  cells.reverse();
  // Straighten: from each point, jump to the farthest one in plain sight.
  const out: [number, number][] = [];
  let at: [number, number] = [fx, fz];
  for (let k = 0; k < cells.length;) {
    let far = k;
    for (let m = cells.length - 1; m > k; m--) if (clear(at[0], at[1], cells[m][0], cells[m][1])) { far = m; break; }
    out.push(cells[far]); at = cells[far]; k = far + 1;
  }
  // The goal itself, skipping last hops it can be seen past.
  while (out.length) { const [px, pz] = out.length > 1 ? out[out.length - 2] : [fx, fz]; if (!clear(px, pz, tx, tz)) break; out.pop(); }
  out.push([tx, tz]);
  return out;
}

// ---------- where things happen ----------
export type Spot = { x: number; z: number; face: number; at: [number, number]; area: string };
const toward = (sx: number, sz: number, ax: number, az: number) => Math.atan2(ax - sx, az - sz);
const spot = (ax: number, az: number, ox: number, oz: number, area: string): Spot => ({ x: ax + ox, z: az + oz, face: toward(ax + ox, az + oz, ax, az), at: [ax, az], area });
export type Skill = "smithing" | "crafting" | "woodcutting" | "fishing" | "mining" | "construction" | "cooking";
/** Where each skill is done: stand there, face that way, the thing worked is `at`. */
export const SPOTS: Record<Skill, Spot[]> = {
  smithing: ANVILS.map(([x, z]) => spot(x, z, 0, 0.95, "Smithy")),
  mining: ROCKS.map(([x, z]) => spot(x, z, 0, 1.0, "Mine")),
  woodcutting: GROVE.map(([x, z]) => spot(x, z, -1.05, 0, "Grove")),
  construction: [spot(42, SITE.z + SITE.d, 0, 0.8, "Construction site"), spot(44.2, SITE.z + SITE.d, 0, 0.8, "Construction site"),
    spot(SITE.x + SITE.w, 6.5, 0.8, 0, "Construction site"), spot(SITE.x, 6.2, -0.8, 0, "Construction site")],
  crafting: WORKSHOP.map((w) => spot(w.x, w.z, 0, 0.9, "Workshop")),
  cooking: GRILLS.map(([x, z]) => spot(x, z, 0, -0.95, "Kitchen")),
  fishing: FISH_Z.map((z) => ({ x: riverX(z) + 2.1, z, face: -Math.PI / 2, at: [riverX(z) + 0.6, z] as [number, number], area: z < CZ ? "Riverbank north" : "Riverbank south" })),
};
/** Seats in the Inn: round the two tables, then along the bar. */
export const SEATS: Spot[] = [
  ...INN_TABLES.flatMap(([x, z]) => [spot(x, z, -0.95, 0, "Inn"), spot(x, z, 0.95, 0, "Inn"), spot(x, z, 0, 0.85, "Inn"), spot(x, z, 0, -0.85, "Inn")]),
  ...BAR_STOOLS.map((x) => ({ x, z: 34.95, face: 0, at: [x, 35.95] as [number, number], area: "Inn" })),
];
/** Where those waiting on a review kneel: in rows before the altar, facing it. */
export const PRAYING: Spot[] = PRAY_Z.flatMap((z) => PRAY_X.map((x) => ({ x, z, face: Math.atan2(ALTAR[0] - x, ALTAR[1] - z), at: ALTAR, area: "Chapel" })));
/** Round the Bonfire, facing it: where spent sessions train Firemaking. */
export const BURNING: Spot[] = Array.from({ length: 8 }, (_, i) => {
  const t = (i / 8) * Math.PI * 2, x = BONFIRE[0] + Math.sin(t) * 1.3, z = BONFIRE[1] + Math.cos(t) * 1.3;
  return { x, z, face: Math.atan2(BONFIRE[0] - x, BONFIRE[1] - z), at: BONFIRE, area: "Bonfire" };
});
/** Where an agent that needs the user waits: the square's south edge, facing the fountain. */
export const ASKING: [number, number][] = [[17.6, 24.6], [19.2, 25], [21.4, 24.7], [22.6, 25.2]];
/** Where each area's sign floats. */
export const AREAS: Record<string, [number, number]> = { Smithy: [40, 15.6], Mine: [42, 24], Grove: [43.6, 34.4], "Riverbank north": [riverX(9) + 2.4, 9], "Riverbank south": [riverX(30) + 2.4, 30], Inn: [16, 31.2], Wilderness: [23.75, -10.2], "Construction site": [43, 6.5], Kitchen: [34.75, 38.4], Workshop: [11.5, 15.1], Chapel: [24.5, 42.7], Bonfire: [45.2, 15.6] };
