// The Office Park: the World for the default skin, drawn cel-shaded. The town's layout, paths and work, drawn as a
// business park on a sunny day: glass-fronted offices round a fountain plaza, a canal, lawns and hedges, a parking
// lot where the Wilderness was. Every agent is an employee. Each step of the work is office work: building at the
// standing desks (Building), the help desk (Fixing), reviewing on the benches by the canal (Reviewing), the server
// racks of the QA lab (Testing), sketching in the garden (Charting), the new wing going up (Improving) and the
// canteen's griddles (Grilling); waiting on a review in the meeting room, on a coffee break in the café (idle),
// clocking out at the time clock (spent). A self-review and its PR's session argue it out in the parking lot.
// Shading comes in hard steps and everything carries an ink outline, like a comic panel.
import * as THREE from "three";
import type { AgentTask } from "../../shared/types";
import { ALTAR, ANVILS, BOARD, BONFIRE, BUILDINGS, type Building, buildingAt, CHAPEL, CX, CZ, doorOf, FENCES, FURNACE, FURNITURE, GRILLS, H, heightAt, KITCHEN, LAMPS, nearChapel, nearKitchen, PEWS, type Rect, ROCKS, ROWS, rnd, SIGNS, SITE, type Skill, type Tile, tileAt, TILES, TOWER, type Tree, TREES, W, WALL_H, WALL_T, WILD_SIGN, WILD_Z, WORKSHOP, Z0 } from "./map";
import { type Bit, box, burst, fountainWater, hintArrow, house, type Keeper, merge, MM, mmz, type Person, river, terrain } from "./scene";
import type { WorldKit } from "./kit";

// The board's own palette: the rack, the panels, ink, and the lanes' pastels with their deeper heads.
const INK = 0x1b1f24, PANEL = 0xf4f6f9, RACK = 0xdbe2ea, SLATE = 0x4b535c, WHITE = 0xffffff;
const MINE = 0xf2dcab, WAIT = 0xb6e0d7, ASK = 0xf6c3b4, DONE = 0xcfe8c2, H_MINE = 0xc99a2e, H_WAIT = 0x2a9a86, H_ASK = 0xd9694c, H_DONE = 0x4f9a43;
const GLASS = 0x9fd0ef, LAWN = 0x68b858, HEDGE = 0x3f9a4a, WOOD = 0xc89a64, ASPHALT = 0x5a5e66;

const rgb = (hex: number): [number, number, number] => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
/** The ground: lawn, pale paving, a plaza of stone, the canal bed, the parking lot's asphalt and its kerb. */
const TILE: Record<Tile, [number, number, number]> = {
  g: rgb(LAWN), p: [0.74, 0.72, 0.68], s: [0.78, 0.76, 0.72], w: [0.36, 0.56, 0.72], k: rgb(ASPHALT), d: [0.72, 0.72, 0.7],
};

// ---------- toon shading and ink ----------

/** Three hard steps of light, the cel look. */
const RAMP = (() => { const t = new THREE.DataTexture(new Uint8Array([110, 190, 255]), 3, 1, THREE.RedFormat); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t; })();
const toon = (color: number, extra: Partial<THREE.MeshToonMaterialParameters> = {}) => new THREE.MeshToonMaterial({ color, gradientMap: RAMP, ...extra });
/** Merged props and people: colour per vertex, cel-shaded. */
const PAINT = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: RAMP });
/** The ink line: the shape again, pushed out along its normals and drawn from behind. */
function inkMaterial(width: number) {
  const m = new THREE.MeshBasicMaterial({ color: INK, side: THREE.BackSide });
  m.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>\ntransformed += normal * ${width.toFixed(3)};`); };
  return m;
}
const INK_THIN = inkMaterial(0.018), INK_THICK = inkMaterial(0.03);
/** An outline for a mesh: a twin on its geometry in ink, beside it, never picked or shadowed. */
function inked<T extends THREE.Mesh>(m: T, thick = false): T {
  const o = new THREE.Mesh(m.geometry, thick ? INK_THICK : INK_THIN); o.raycast = () => {}; o.castShadow = false; o.userData.ink = true;
  m.add(o); return m;
}
/** A group's meshes merged into one, cel-shaded and inked. */
function bake(group: THREE.Object3D, into: THREE.Object3D, ink = true) {
  const m = merge(group, into); if (m) { m.material = PAINT; if (ink) inked(m); } return m;
}
function shade(o: THREE.Object3D) {
  o.traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh && !m.userData.ink) { m.castShadow = true; m.receiveShadow = true; } });
  return o;
}
const glowBox = (w: number, h: number, d: number, color: number, x: number, y: number, z: number, k = 0.9) => {
  const m = box(w, h, d, color, x, y, z); Object.assign(m.material, { emissive: new THREE.Color(color), emissiveIntensity: k }); return m;
};
const cyl = (r0: number, r1: number, h: number, color: number, x: number, y: number, z: number, seg = 14) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(r0, r1, h, seg), new THREE.MeshLambertMaterial({ color })); m.position.set(x, y, z); return m; };
const ball = (r: number, color: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => { const m = new THREE.Mesh(new THREE.SphereGeometry(r, 16, 12), new THREE.MeshLambertMaterial({ color })); m.position.set(x, y, z); m.scale.set(sx, sy, sz); return m; };

/** Words on a sign: bold type on a colour, for doors and wayfinding. */
function sign(text: string, w: number, h: number, bg: string, fg: string) {
  const c = document.createElement("canvas"); c.width = Math.round(w * 160); c.height = Math.round(h * 160);
  const g = c.getContext("2d")!; g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
  g.font = `800 ${Math.round(c.height * 0.56)}px Archivo, 'Arial Black', sans-serif`; g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = fg;
  g.fillText(text, c.width / 2, c.height * 0.54, c.width * 0.9);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return new THREE.MeshToonMaterial({ map: t, gradientMap: RAMP });
}

// ---------- the offices ----------

/** Each building's colour, its name over the door, and what's on its roof. */
const LOOK: Record<Building["id"], { band: number; head: number; name: string }> = {
  next: { band: MINE, head: H_MINE, name: "RECEPTION" }, finished: { band: DONE, head: H_DONE, name: "MAILROOM" },
  sessions: { band: ASK, head: H_ASK, name: "CAFÉ" }, docs: { band: WAIT, head: H_WAIT, name: "RECORDS" },
};

/**
 * An office's walls: a white base, tall glass panes between white mullions, and a band of the building's colour along
 * the top. Each run of wall is its own few meshes, so the one between you and the camera fades.
 */
/** A run of office wall along x or z: a white base, glass between white mullions (or a solid panel), a band of colour
 *  along the top. Each piece goes to `wall`, so it fades when it's in the way. */
function glassRun(wall: (m: THREE.Mesh) => void, x0: number, z0: number, x1: number, z1: number, band: number, glass = true) {
  const len = Math.hypot(x1 - x0, z1 - z0); if (len < 0.05) return;
  const alongX = Math.abs(z1 - z0) < 1e-6, mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, sz = (w: number, t: number): [number, number] => (alongX ? [w, t] : [t, w]);
  const piece = (w: number, h: number, t: number, y: number, color: number, opts: Partial<THREE.MeshToonMaterialParameters> = {}, cx = mx, cz = mz) => {
    const [sx, sd] = sz(w, t); const m = new THREE.Mesh(new THREE.BoxGeometry(sx, h, sd), toon(color, opts)); m.position.set(cx, y, cz); wall(m); return m;
  };
  piece(len, 0.5, WALL_T, 0.33, WHITE);
  piece(len + 0.02, 0.32, WALL_T + 0.04, WALL_H - 0.08, band);
  if (glass) {
    piece(len, WALL_H - 0.82, WALL_T * 0.4, 0.58 + (WALL_H - 0.82) / 2, GLASS, { transparent: true, opacity: 0.55 });
    const n = Math.max(1, Math.round(len / 1.2));
    for (let i = 0; i <= n; i++) { const f = i / n; piece(0.08, WALL_H - 0.82, WALL_T + 0.02, 0.58 + (WALL_H - 0.82) / 2, WHITE, {}, x0 + (x1 - x0) * f, z0 + (z1 - z0) * f); }
  } else piece(len, WALL_H - 0.82, WALL_T, 0.58 + (WALL_H - 0.82) / 2, PANEL);
}

function officeWalls(b: Building, wall: (m: THREE.Mesh) => void) {
  const d = doorOf(b), back = d.z === b.z ? b.z + b.d : b.z, look = LOOK[b.id];
  const front = d.z + (d.z === b.z ? WALL_T / 2 : -WALL_T / 2), rear = back + (back === b.z ? WALL_T / 2 : -WALL_T / 2);
  const run = (x0: number, z0: number, x1: number, z1: number, glass = true) => glassRun(wall, x0, z0, x1, z1, look.band, glass);
  run(b.x + WALL_T / 2, b.z, b.x + WALL_T / 2, b.z + b.d); run(b.x + b.w - WALL_T / 2, b.z, b.x + b.w - WALL_T / 2, b.z + b.d);
  run(b.x, rear, b.x + b.w, rear, false);
  run(b.x, front, d.x - 0.6, front); run(d.x + 0.6, front, b.x + b.w, front);
  // Over the door: the lintel in the building's colour, and its name.
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.6, WALL_T + 0.04), toon(look.band)); lintel.position.set(d.x, WALL_H - 0.22, front); wall(lintel);
  const out = d.z === b.z ? -1 : 1, plate = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 0.44), sign(look.name, 2.4, 0.44, "#ffffff", "#1b1f24"));
  plate.position.set(d.x, WALL_H + 0.28, front + out * (WALL_T / 2 + 0.03)); plate.rotation.y = out > 0 ? 0 : Math.PI; wall(plate);
  // An entrance mat and a canopy over the door.
  const mat = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.03, 0.7), toon(SLATE)); mat.position.set(d.x, 0.1, d.z + out * 0.5); wall(mat);
}

/** A flat roof with a parapet in the building's colour, rooftop units, and solar panels on some; hidden with the roofs. */
function officeRoof(b: Building) {
  const g = new THREE.Group(), look = LOOK[b.id], y = WALL_H + 0.08, cx = b.x + b.w / 2, cz = b.z + b.d / 2;
  g.add(box(b.w + 0.2, 0.16, b.d + 0.2, 0xe8ebef, cx, y + 0.08, cz));
  for (const [w, d, x, z] of [[b.w + 0.3, 0.22, cx, b.z - 0.05], [b.w + 0.3, 0.22, cx, b.z + b.d + 0.05], [0.22, b.d + 0.3, b.x - 0.05, cz], [0.22, b.d + 0.3, b.x + b.w + 0.05, cz]]) g.add(box(w, 0.32, d, look.band, x, y + 0.3, z));
  g.add(box(1.2, 0.6, 0.9, 0xc8ccd2, b.x + 1.4, y + 0.46, b.z + 1.3), box(0.7, 0.05, 0.7, SLATE, b.x + 1.4, y + 0.78, b.z + 1.3));
  if (b.id === "docs" || b.id === "next") for (let k = 0; k < 3; k++) { const p = box(1.1, 0.06, 0.8, 0x2f4a7a, b.x + b.w - 1.4 - k * 1.3, y + 0.42, cz); p.rotation.x = -0.4; g.add(p); }
  if (b.id === "sessions") g.add(box(0.5, 0.9, 0.5, 0xb0b6be, b.x + b.w - 1.5, y + 0.6, b.z + b.d - 1.5));
  const out = new THREE.Group(); bake(g, out);
  out.traverse((o) => { o.userData.target = { kind: "building", b }; });
  out.userData.roof = true;
  return out;
}

// ---------- the work rooms: the stations the town has outdoors, indoors ----------

type Side = "n" | "s" | "e" | "w";
/** A room round a station: its footprint, its doors (a side and where along it), its colour, its name over a door. */
type Room = { x: number; z: number; w: number; d: number; doors: { side: Side; at: number; width?: number }[]; band: number; floor: number; name: string; sign: Side };
const ROOMS: Room[] = [
  // The standing desks and the copier, doors to the road south and the path west.
  { x: 35.6, z: 12.0, w: 7.8, d: 6.6, doors: [{ side: "s", at: 40 }, { side: "w", at: 15.6 }], band: WAIT, floor: 0xc8d2de, name: "DEV STUDIO", sign: "s" },
  // The server racks, on the hedge line round them, its door where the hedge had its gap.
  { x: 37.6, z: 21.4, w: 8.8, d: 6.0, doors: [{ side: "w", at: 24.3, width: 1.8 }], band: ASK, floor: 0xd4d8dc, name: "QA LAB", sign: "w" },
  // The help desks, doors to the road south and the path east.
  { x: 8.2, z: 12.2, w: 6.7, d: 6.2, doors: [{ side: "s", at: 11.5 }, { side: "e", at: 15.4 }], band: MINE, floor: 0xe2d6c2, name: "IT HELP DESK", sign: "s" },
];
const inRoom = (x: number, z: number, pad = 0.4) => ROOMS.some((r) => x > r.x - pad && x < r.x + r.w + pad && z > r.z - pad && z < r.z + r.d + pad);

/** A room's walls as runs along each side's inner edge, the doorways left open: [x0, z0, x1, z1, side]. */
function runs(r: Room): [number, number, number, number, Side][] {
  const t = WALL_T / 2, out: [number, number, number, number, Side][] = [];
  const sides: [Side, number, number, number, boolean][] = [["n", r.z + t, r.x, r.x + r.w, true], ["s", r.z + r.d - t, r.x, r.x + r.w, true], ["w", r.x + t, r.z, r.z + r.d, false], ["e", r.x + r.w - t, r.z, r.z + r.d, false]];
  for (const [side, line, a, b, alongX] of sides) {
    const gaps = r.doors.filter((dr) => dr.side === side).map((dr) => [dr.at - (dr.width ?? 1.4) / 2, dr.at + (dr.width ?? 1.4) / 2]).sort((p, q) => p[0] - q[0]);
    let from = a;
    for (const [g0, g1] of [...gaps, [b, b]]) { if (g0 - from > 0.05) out.push(alongX ? [from, line, g0, line, side] : [line, from, line, g0, side]); from = g1; }
  }
  return out;
}
/** The rooms' walls, for the walking grid. */
const ROOM_WALLS: [number, number, number, number][] = ROOMS.flatMap((r) => runs(r).map(([x0, z0, x1, z1]): [number, number, number, number] =>
  z0 === z1 ? [Math.min(x0, x1), z0 - WALL_T / 2, Math.abs(x1 - x0), WALL_T] : [x0 - WALL_T / 2, Math.min(z0, z1), WALL_T, Math.abs(z1 - z0)]));

/** The rooms: floor, glass walls, a lintel over each door and the room's name over one, and a flat roof hidden with
 *  the others. */
function workRooms(scene: THREE.Object3D, roofs: THREE.Object3D[]) {
  const wall = (m: THREE.Mesh) => { m.userData.wall = true; m.castShadow = true; m.receiveShadow = true; scene.add(m); };
  for (const r of ROOMS) {
    // The floor follows the ground under it, just above, so the lawn never shows through and nobody sinks.
    const fg = new THREE.PlaneGeometry(r.w - 0.2, r.d - 0.2, Math.ceil(r.w * 2), Math.ceil(r.d * 2)); fg.rotateX(-Math.PI / 2);
    const fp = fg.attributes.position, cx = r.x + r.w / 2, cz = r.z + r.d / 2;
    for (let i = 0; i < fp.count; i++) fp.setY(i, Math.max(0, heightAt(cx + fp.getX(i), cz + fp.getZ(i))) + 0.05);
    fg.computeVertexNormals();
    const floor = new THREE.Mesh(fg, toon(r.floor)); floor.position.set(cx, 0, cz); floor.receiveShadow = true; scene.add(floor);
    for (const [x0, z0, x1, z1] of runs(r)) glassRun(wall, x0, z0, x1, z1, r.band);
    for (const dr of r.doors) {
      const alongX = dr.side === "n" || dr.side === "s", w = dr.width ?? 1.4;
      const line = dr.side === "n" ? r.z + WALL_T / 2 : dr.side === "s" ? r.z + r.d - WALL_T / 2 : dr.side === "w" ? r.x + WALL_T / 2 : r.x + r.w - WALL_T / 2;
      const [px, pz] = alongX ? [dr.at, line] : [line, dr.at];
      const lintel = new THREE.Mesh(new THREE.BoxGeometry(alongX ? w + 0.1 : WALL_T + 0.04, 0.5, alongX ? WALL_T + 0.04 : w + 0.1), toon(r.band)); lintel.position.set(px, WALL_H - 0.17, pz); wall(lintel);
      if (dr.side !== r.sign) continue;
      const out = { n: [0, -1], s: [0, 1], w: [-1, 0], e: [1, 0] }[dr.side], plate = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.44), sign(r.name, 2.6, 0.44, "#ffffff", "#1b1f24"));
      plate.position.set(px + out[0] * (WALL_T / 2 + 0.03), WALL_H + 0.28, pz + out[1] * (WALL_T / 2 + 0.03)); plate.rotation.y = Math.atan2(out[0], out[1]); wall(plate);
    }
    // Plants in the corners.
    const g = new THREE.Group();
    for (const [cx, cz] of [[r.x + 0.6, r.z + 0.6], [r.x + r.w - 0.6, r.z + 0.6]]) g.add(cyl(0.24, 0.18, 0.4, 0xe8ebef, cx, 0.3, cz, 12), ball(0.32, HEDGE, cx, 0.78, cz, 1, 1.2, 1));
    bake(g, scene);
    const roof = new THREE.Group(), y = WALL_H + 0.08;
    roof.add(box(r.w + 0.2, 0.16, r.d + 0.2, 0xe8ebef, r.x + r.w / 2, y + 0.08, r.z + r.d / 2));
    for (const [w, d, x, z] of [[r.w + 0.3, 0.22, r.x + r.w / 2, r.z - 0.05], [r.w + 0.3, 0.22, r.x + r.w / 2, r.z + r.d + 0.05], [0.22, r.d + 0.3, r.x - 0.05, r.z + r.d / 2], [0.22, r.d + 0.3, r.x + r.w + 0.05, r.z + r.d / 2]]) roof.add(box(w, 0.32, d, r.band, x, y + 0.3, z));
    roof.add(box(1.0, 0.5, 0.8, 0xc8ccd2, r.x + r.w - 1.2, y + 0.42, r.z + 1.2));
    const rr = new THREE.Group(); bake(roof, rr); rr.userData.roof = true; scene.add(rr); roofs.push(rr);
  }
}

// ---------- inside: furniture as an office has it ----------

/** Every piece of the town's furniture, as office furniture, in the same rectangles people walk round. */
function officeFurniture(into: THREE.Object3D) {
  const g = new THREE.Group();
  for (const f of FURNITURE) {
    const x = f.x + f.w / 2, z = f.z + f.d / 2;
    switch (f.kind) {
      case "table": {
        // Café tables, round with a pedestal; the one in Reception a low coffee table with magazines.
        if (z < 20) { g.add(box(f.w, 0.08, f.d, WOOD, x, 0.42, z), box(0.12, 0.34, 0.12, SLATE, x, 0.2, z), box(0.4, 0.03, 0.3, H_ASK, x - 0.2, 0.47, z)); break; }
        g.add(cyl(0.62, 0.62, 0.07, WHITE, x, 0.78, z, 20), cyl(0.06, 0.06, 0.72, SLATE, x, 0.4, z, 8), cyl(0.3, 0.3, 0.04, SLATE, x, 0.06, z, 14));
        g.add(cyl(0.07, 0.06, 0.12, WHITE, x + 0.2, 0.88, z - 0.1, 10), cyl(0.07, 0.06, 0.12, H_ASK, x - 0.25, 0.88, z + 0.15, 10));
        break;
      }
      case "bar": {
        // The café counter: white front, wood top, an espresso machine, a pastry case, cups stacked.
        g.add(box(f.w, 0.95, f.d, WHITE, x, 0.55, z), box(f.w + 0.1, 0.08, f.d + 0.12, WOOD, x, 1.05, z), box(f.w, 0.12, 0.04, ASK, x, 0.8, z - f.d / 2 - 0.01));
        g.add(box(0.7, 0.5, 0.45, 0xb8bec6, x + 2.6, 1.34, z + 0.05), box(0.5, 0.12, 0.3, INK, x + 2.6, 1.4, z - 0.12), box(1.2, 0.35, 0.45, 0xe8f4fb, x - 2.4, 1.27, z + 0.02));
        for (let k = 0; k < 4; k++) g.add(cyl(0.09, 0.08, 0.1, k % 2 ? ASK : WHITE, x + 0.4 + k * 0.25, 1.15, z + 0.1, 10));
        // Menu boards on the back wall.
        for (const ox of [-1.6, 0, 1.6]) g.add(box(1.3, 0.8, 0.05, INK, x + ox, 2.1, 36.7), box(0.9, 0.06, 0.06, MINE, x + ox, 2.3, 36.66), box(0.7, 0.05, 0.06, WAIT, x + ox, 2.1, 36.66), box(0.8, 0.05, 0.06, DONE, x + ox, 1.92, 36.66));
        break;
      }
      case "barrel": g.add(cyl(0.34, 0.26, 0.55, 0xe8ebef, x, 0.36, z, 14), ball(0.42, HEDGE, x, 0.95, z, 1, 1.15, 1)); break;
      case "worktop": g.add(box(f.w, 0.9, f.d, 0xd8dde3, x, 0.53, z), box(f.w + 0.06, 0.06, f.d + 0.06, 0xa8b0b8, x, 1.0, z)); break;
      case "counter": g.add(box(f.w, 1.0, f.d, WHITE, x, 0.58, z), box(f.w + 0.08, 0.07, f.d + 0.1, DONE, x, 1.1, z), box(0.5, 0.35, 0.3, 0xc8a070, x - 2.5, 1.32, z), box(0.4, 0.3, 0.3, 0xd8b080, x + 2.3, 1.3, z)); break;
      case "chest": g.add(box(f.w, 0.8, f.d, 0x5a7a9a, x, 0.48, z), box(f.w - 0.2, 0.05, f.d - 0.2, 0xc8a070, x, 0.9, z)); break;
      case "shelf": case "shelfback": {
        // Bookcases of binders in the lanes' colours.
        const face = f.kind === "shelf" ? 1 : -1;
        g.add(box(f.w, 2.0, f.d, WHITE, x, 1.08, z));
        for (let r = 0; r < 4; r++) for (let c = 0; c < 6; c++) g.add(box(0.2, 0.36, 0.3, [MINE, WAIT, ASK, DONE, H_WAIT, H_ASK][(r * 2 + c) % 6], x - f.w / 2 + 0.25 + c * 0.26, 0.35 + r * 0.48, z + face * 0.08));
        break;
      }
      case "readtable": g.add(box(f.w + 0.3, 0.06, f.d, WHITE, x, 0.78, z), box(0.08, 0.74, 0.08, SLATE, x - 0.6, 0.4, z), box(0.08, 0.74, 0.08, SLATE, x + 0.6, 0.4, z), box(0.4, 0.02, 0.28, 0x8a9098, x, 0.82, z), box(0.4, 0.26, 0.02, 0x2a2e36, x, 0.95, z - 0.14)); break;
      case "desk": g.add(box(f.w, 0.78, f.d, WHITE, x, 0.47, z), box(f.w + 0.06, 0.05, f.d + 0.06, WOOD, x, 0.88, z), box(0.6, 0.38, 0.04, INK, x, 1.12, z - 0.15), box(0.06, 0.16, 0.06, SLATE, x, 0.96, z - 0.15)); break;
      case "vault": for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) g.add(box(0.36, 0.36, 0.18, (r + c) % 3 ? 0xe8ebef : DONE, x - 0.57 + c * 0.38, 0.4 + r * 0.38, z + 0.05)); break;
      case "gold": for (let k = 0; k < 3; k++) g.add(box(0.5, 0.36 + (k % 2) * 0.12, f.d, k % 2 ? 0xc8a070 : 0xd8b080, f.x + 0.3 + k * 0.52, 0.28, z)); break;
      case "noticeboard": g.add(box(f.w, 1.0, 0.06, INK, x, 1.6, z), glowBox(f.w - 0.16, 0.84, 0.02, 0x8fd0ff, x, 1.6, z + 0.04, 0.5)); break;
      case "trophycase": for (let k = 0; k < 4; k++) g.add(box(0.55, 1.3, f.d, 0xc8ccd2, f.x + 0.3 + k * 0.58, 0.73, z), box(0.2, 0.04, 0.02, SLATE, f.x + 0.3 + k * 0.58, 1.1, z + f.d / 2), box(0.2, 0.04, 0.02, SLATE, f.x + 0.3 + k * 0.58, 0.6, z + f.d / 2)); break;
      case "cup": g.add(box(0.7, 0.9, 0.6, 0xe8ebef, x, 0.53, z), box(0.72, 0.1, 0.5, SLATE, x, 1.03, z - 0.04), box(0.3, 0.04, 0.2, WHITE, x, 1.1, z)); break;
      case "statue": g.add(box(0.4, 0.9, 0.4, WHITE, x, 0.53, z), cyl(0.18, 0.16, 0.42, 0x9fd8f5, x, 1.18, z, 14)); break;
    }
  }
  // Office chairs at Reception's coffee table and the café's tables, and sofas in Reception.
  g.add(box(1.4, 0.4, 0.6, H_MINE, 16.5, 0.3, 8.7), box(1.4, 0.4, 0.15, H_MINE, 16.5, 0.6, 9.0));
  bake(g, into);
}

// ---------- the meeting room (the Chapel) and the canteen (the Kitchen) ----------

/** The meeting room: glass on three sides and the door side, a conference table where the altar was with a screen
 *  showing a slide, rows of chairs where the pews were. Those waiting on a review sit here. A pylon with the park's
 *  name stands where the bell tower was. */
function meetingRoom(scene: THREE.Object3D, roofs: THREE.Object3D[]) {
  const { x, z, w, d, door, h } = CHAPEL, t = 0.3;
  const wall = (m: THREE.Mesh) => { m.userData.wall = true; m.castShadow = true; scene.add(m); };
  const pane = (sx: number, sz: number, px: number, pz: number) => {
    const base = new THREE.Mesh(new THREE.BoxGeometry(sx, 0.5, sz), toon(WHITE)); base.position.set(px, 0.25, pz); wall(base);
    const glass = new THREE.Mesh(new THREE.BoxGeometry(sx, h - 0.8, Math.min(sz, sx) === sz ? sz * 0.4 : sz), toon(GLASS, { transparent: true, opacity: 0.5 }));
    glass.position.set(px, 0.5 + (h - 0.8) / 2, pz); wall(glass);
    const top = new THREE.Mesh(new THREE.BoxGeometry(sx + 0.02, 0.3, sz + 0.04), toon(WAIT)); top.position.set(px, h - 0.15, pz); wall(top);
  };
  pane(door - 0.8 - x, t, (x + door - 0.8) / 2, z + t / 2); pane(x + w - door - 0.8, t, (door + 0.8 + x + w) / 2, z + t / 2);
  pane(t, d, x + t / 2, z + d / 2); pane(t, d, x + w - t / 2, z + d / 2); pane(w, t, x + w / 2, z + d - t / 2);
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(1.6, h - 2.3, t), toon(WAIT)); lintel.position.set(door, 2.3 + (h - 2.3) / 2, z + t / 2); wall(lintel);
  const g = new THREE.Group();
  g.add(box(w - 0.6, 0.05, d - 0.6, 0x8a94a8, x + w / 2, 0.1, z + d / 2));
  for (const p of PEWS) for (let k = 0; k < 3; k++) {
    const cx = p.x + 0.45 + k * 0.9, cz = p.z + p.d / 2;
    g.add(box(0.5, 0.08, 0.45, H_WAIT, cx, 0.46, cz), box(0.5, 0.45, 0.07, H_WAIT, cx, 0.72, cz - 0.2), box(0.05, 0.42, 0.05, SLATE, cx, 0.22, cz));
  }
  const [ax, az] = ALTAR;
  g.add(box(1.6, 0.06, 0.8, WOOD, ax, 0.78, az), box(1.4, 0.72, 0.6, WHITE, ax, 0.4, az));
  bake(g, scene);
  // The screen on the back wall, a slide on it.
  const slide = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 1.4), sign("Q3 REVIEW", 2.6, 1.4, "#f4f6f9", "#2a9a86"));
  slide.position.set(ax, 1.9, z + d - t - 0.02); slide.rotation.y = Math.PI; scene.add(slide);
  const roof = new THREE.Group(); roof.add(box(w + 0.3, 0.18, d + 0.3, 0xe8ebef, x + w / 2, h + 0.09, z + d / 2), box(w + 0.4, 0.26, 0.2, WAIT, x + w / 2, h + 0.3, z - 0.05));
  const r = new THREE.Group(); bake(roof, r); r.userData.roof = true; scene.add(r); roofs.push(r);
  // The pylon: a tall white slab with the park's name down it, in its own footprint.
  const { x: tx, z: tz, s } = TOWER, py = new THREE.Group();
  py.add(box(s * 0.8, 6, s * 0.5, WHITE, tx + s / 2, 3, tz + s / 2), box(s * 0.82, 0.4, s * 0.52, H_WAIT, tx + s / 2, 6.1, tz + s / 2));
  bake(py, scene);
  const name = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 0.9), sign("CONTROL ROOM", 4.2, 0.9, "#ffffff", "#1b1f24"));
  name.geometry.rotateZ(Math.PI / 2); name.position.set(tx + s / 2, 3.2, tz + s / 2 - s * 0.25 - 0.01); name.rotation.y = Math.PI; scene.add(name);
}

/** The canteen: three white walls under a striped awning, open to the north, griddles along the back where the grills
 *  are, a menu board. */
function canteen(scene: THREE.Object3D, roofs: THREE.Object3D[]) {
  const { x, z, w, d, h } = KITCHEN, t = 0.3;
  const wall = (m: THREE.Mesh) => { m.userData.wall = true; m.castShadow = true; scene.add(m); };
  for (const [sx, sz, px, pz] of [[t, d, x + t / 2, z + d / 2], [t, d, x + w - t / 2, z + d / 2], [w, t, x + w / 2, z + d - t / 2]]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, h, sz), toon(WHITE)); m.position.set(px, h / 2, pz); wall(m);
    const band = new THREE.Mesh(new THREE.BoxGeometry(sx + 0.02, 0.3, sz + 0.02), toon(MINE)); band.position.set(px, h - 0.15, pz); wall(band);
  }
  const g = new THREE.Group();
  g.add(box(w - 0.4, 0.05, d - 0.4, 0xe8e4dc, x + w / 2, 0.1, z + d / 2));
  for (const [gx, gz] of GRILLS) g.add(box(1.1, 0.9, 0.6, 0xc8ccd2, gx, 0.45, gz), box(1.0, 0.04, 0.5, INK, gx, 0.92, gz), box(1.1, 0.08, 0.1, 0xa8b0b8, gx, 1.0, gz + 0.25));
  bake(g, scene);
  for (const [gx, gz] of GRILLS) { const hot = glowBox(0.9, 0.02, 0.4, 0xff9a40, gx, 0.95, gz, 0.35); scene.add(hot); }
  const menu = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.6), sign("CANTEEN", 2.2, 0.6, "#c99a2e", "#ffffff")); menu.position.set(x + w / 2, h + 0.15, z - 0.4); menu.rotation.y = Math.PI; scene.add(menu);
  // The awning: stripes of white and Mine yellow, sloping out over the open front; hidden with the roofs.
  const roof = new THREE.Group(), n = 9;
  for (let k = 0; k < n; k++) { const s = box((w + 0.4) / n + 0.01, 0.06, d + 1.0, k % 2 ? WHITE : MINE, x - 0.2 + (k + 0.5) * ((w + 0.4) / n), h + 0.2, z + d / 2 - 0.5); s.rotation.x = 0.12; roof.add(s); }
  const r = new THREE.Group(); bake(roof, r); r.userData.roof = true; scene.add(r); roofs.push(r);
}

// ---------- the grounds ----------

/** A tree: round and full where the town has oaks, a tall cone for a pine, reeds by the canal, and in the parking
 *  lot, where the dead trees were, a parked car. */
function tree(t: Tree) {
  const g = new THREE.Group(), { x, z, s, kind } = t, y = heightAt(x, z);
  if (kind === "dead") return car(x, z, rnd(x * z) > 0.5 ? 0 : Math.PI, x + z);
  if (kind === "willow") { for (let k = 0; k < 5; k++) g.add(cyl(0.025, 0.03, (0.7 + rnd(x + k) * 0.5) * s, 0x5a8a3a, x + (rnd(z + k) - 0.5) * 0.5, y + 0.35 * s, z + (rnd(x * k) - 0.5) * 0.5, 5)); g.add(ball(0.08, 0x8a5a3a, x, y + 0.85 * s, z, 1, 2, 1)); return g; }
  g.add(cyl(0.1 * s, 0.14 * s, 1.1 * s, 0x8e5b3a, x, y + 0.55 * s, z, 8));
  if (kind === "pine") { g.add(new THREE.Mesh(new THREE.ConeGeometry(0.8 * s, 2.2 * s, 10), new THREE.MeshLambertMaterial({ color: 0x2f8a4a })).translateX(x).translateY(y + 2.0 * s).translateZ(z)); return g; }
  g.add(ball(0.95 * s, rnd(x) > 0.5 ? 0x4fb05a : 0x5cc06a, x, y + 1.9 * s, z, 1, 0.92, 1), ball(0.6 * s, 0x6cd07a, x + 0.45 * s, y + 2.2 * s, z + 0.2 * s));
  return g;
}

/** A parked car: a rounded body in a cheerful colour, a glass cabin, wheels. */
function car(x: number, z: number, turn: number, seed: number) {
  const g = new THREE.Group(), body = [H_ASK, H_WAIT, 0x5a7ad8, MINE, WHITE, 0xd85a8a][Math.floor(rnd(seed) * 6)];
  g.add(box(1.0, 0.45, 2.0, body, 0, 0.42, 0), box(0.86, 0.36, 1.1, GLASS, 0, 0.82, -0.1), box(0.9, 0.06, 1.15, body, 0, 1.02, -0.1));
  for (const [ox, oz] of [[-0.48, 0.65], [0.48, 0.65], [-0.48, -0.65], [0.48, -0.65]]) { const w = cyl(0.2, 0.2, 0.16, INK, ox, 0.2, oz, 12); w.rotation.z = Math.PI / 2; g.add(w); }
  g.add(box(0.2, 0.08, 0.04, 0xfff4c0, -0.3, 0.5, 1.0), box(0.2, 0.08, 0.04, 0xfff4c0, 0.3, 0.5, 1.0));
  const out = new THREE.Group(); bake(g, out); out.position.set(x, heightAt(x, z), z); out.rotation.y = turn;
  return out;
}

/** Every work station, as office work. */
function stations(scene: THREE.Object3D, still: THREE.Group) {
  // Standing desks where the anvils were: a desk on legs, two monitors, a keyboard.
  for (const [x, z] of ANVILS) {
    const y = heightAt(x, z);
    still.add(box(1.0, 0.05, 0.6, WHITE, x, y + 1.0, z), box(0.06, 0.98, 0.06, SLATE, x - 0.42, y + 0.5, z), box(0.06, 0.98, 0.06, SLATE, x + 0.42, y + 0.5, z));
    still.add(box(0.42, 0.28, 0.03, INK, x - 0.22, y + 1.3, z - 0.18), box(0.42, 0.28, 0.03, INK, x + 0.22, y + 1.3, z - 0.18), box(0.4, 0.02, 0.14, SLATE, x, y + 1.04, z + 0.1));
    scene.add(glowBox(0.38, 0.24, 0.01, 0x8fd0ff, x - 0.22, y + 1.3, z - 0.16, 0.6), glowBox(0.38, 0.24, 0.01, 0xb6e0d7, x + 0.22, y + 1.3, z - 0.16, 0.6));
  }
  // A copier the size of a car where the furnace was, a stack of paper on it.
  const [fx, fz] = FURNACE, fy = heightAt(fx, fz);
  still.add(box(2.0, 1.1, 1.2, 0xe8ebef, fx, fy + 0.55, fz), box(1.8, 0.2, 1.0, SLATE, fx, fy + 1.2, fz), box(0.5, 0.1, 0.4, WHITE, fx + 0.5, fy + 1.35, fz), box(0.3, 0.2, 0.06, 0x8fd0ff, fx - 0.7, fy + 1.0, fz + 0.62));
  // Server racks where the rocks were: tall black cabinets, lights blinking down their fronts.
  ROCKS.forEach(([x, z], k) => {
    const y = heightAt(x, z);
    still.add(box(0.9, 1.9, 0.8, 0x2a2e36, x, y + 0.95, z), box(0.92, 0.08, 0.82, 0x4a505a, x, y + 1.92, z));
    for (let r = 0; r < 6; r++) { const led = glowBox(0.06, 0.04, 0.02, [0x5cff8a, 0x8fd0ff, 0xffcf5a][(r + k) % 3], x - 0.3 + (r % 2) * 0.12, y + 0.4 + r * 0.24, z + 0.41, 1.2); scene.add(led); const m = led.material as THREE.MeshLambertMaterial; led.onBeforeRender = () => { m.emissiveIntensity = rnd(Math.floor(performance.now() / 260) + r * 7 + k * 31) > 0.35 ? 1.4 : 0.1; }; }
  });
  // The help desk: four desks with a laptop and a lamp each.
  for (const w of WORKSHOP) {
    const { x, z } = w, y = heightAt(x, z);
    still.add(box(1.1, 0.06, 0.65, WOOD, x, y + 0.78, z), box(1.0, 0.72, 0.06, WHITE, x, y + 0.4, z - 0.28), box(0.4, 0.02, 0.28, 0x8a9098, x, y + 0.82, z), box(0.4, 0.26, 0.02, 0x2a2e36, x, y + 0.95, z - 0.14));
    still.add(cyl(0.02, 0.02, 0.35, SLATE, x + 0.4, y + 0.98, z - 0.15, 6), cyl(0.1, 0.06, 0.1, H_MINE, x + 0.4, y + 1.17, z - 0.1, 10));
  }
  // The new wing going up: a slab, a frame of steel, cones and a stack of panels.
  const { x: sx, z: sz, w: sw, d: sd } = SITE, sy = heightAt(sx + sw / 2, sz + sd / 2);
  still.add(box(sw, 0.12, sd, 0xc8ccd2, sx + sw / 2, sy + 0.06, sz + sd / 2));
  for (const px of [sx + 0.1, sx + sw / 2, sx + sw - 0.1]) for (const pz of [sz + 0.1, sz + sd - 0.1]) still.add(box(0.12, 2.8, 0.12, 0xe8a030, px, sy + 1.4, pz));
  for (const pz of [sz + 0.1, sz + sd - 0.1]) still.add(box(sw, 0.12, 0.12, 0xe8a030, sx + sw / 2, sy + 2.75, pz));
  for (let k = 0; k < 4; k++) still.add(box(1.0, 0.06, 1.8, k % 2 ? WHITE : WAIT, sx + sw - 1.0, sy + 0.16 + k * 0.07, sz + sd / 2));
  for (const [cx, cz] of [[sx - 0.4, sz + sd + 0.4], [sx + sw + 0.4, sz + sd + 0.4], [sx + sw / 2, sz + sd + 0.6]]) { const cy = heightAt(cx, cz); still.add(new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.5, 10), new THREE.MeshLambertMaterial({ color: 0xff7a2a })).translateX(cx).translateY(cy + 0.25).translateZ(cz)); }
  // The time clock where the bonfire was: a post with a clock face, a rack of cards, a shredder beside it.
  const [bx, bz] = BONFIRE, by = heightAt(bx, bz);
  still.add(box(0.5, 1.5, 0.4, WHITE, bx, by + 0.75, bz), box(0.42, 0.42, 0.06, INK, bx, by + 1.25, bz + 0.22), box(0.4, 0.5, 0.06, MINE, bx, by + 0.7, bz + 0.22));
  still.add(box(0.5, 0.7, 0.4, SLATE, bx + 0.7, by + 0.35, bz), box(0.4, 0.04, 0.06, INK, bx + 0.7, by + 0.72, bz));
  const face = glowBox(0.34, 0.34, 0.02, 0xf4f6f9, bx, by + 1.25, bz + 0.26, 0.4); scene.add(face);
  // The Kanban board: three columns of sticky notes on a white board on two posts.
  const { x, z, w } = BOARD, y = heightAt(x, z);
  for (const px of [x - w / 2 + 0.1, x + w / 2 - 0.1]) still.add(box(0.12, 2.9, 0.12, SLATE, px, y + 1.45, z));
  still.add(box(w - 0.1, 1.8, 0.1, WHITE, x, y + 1.65, z), box(w - 0.1, 0.25, 0.12, INK, x, y + 2.68, z));
  for (const ox of [-w / 6, w / 6]) still.add(box(0.03, 1.6, 0.12, RACK, x + ox, y + 1.62, z));
  const head = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.22), sign("TO DO · DOING · DONE", 1.6, 0.22, "#1b1f24", "#ffffff")); head.position.set(x, y + 2.68, z + 0.07); scene.add(head);
}

/** The fountain plaza: a round pool, a ring of stone, and a sculpture of interlocking rings in the lanes' colours. */
function fountain(scene: THREE.Object3D, still: THREE.Group) {
  still.add(cyl(1.6, 1.75, 0.5, 0xe8ebef, CX, 0.33, CZ, 28));
  scene.add(fountainWater(CX, CZ, 1.33, 28, 0x5aaee0, 0xd8f0ff, 0xd8f0ff, 1));
  still.add(cyl(0.18, 0.24, 1.3, WHITE, CX, 0.9, CZ, 12));
  for (const [k, c] of [MINE, WAIT, ASK].entries()) { const ring = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.08, 10, 28), new THREE.MeshLambertMaterial({ color: c })); ring.position.set(CX, 2.0, CZ); ring.rotation.set(Math.PI / 2 + k * 0.6, k * 1.05, 0); still.add(ring); }
}

/** Hedges along the fences, wayfinding signs, lamp posts, the parking lot's markings and its sign, flowers. */
function grounds(scene: THREE.Object3D, still: THREE.Group) {
  for (const [x1, z1, x2, z2] of FENCES) {
    // The QA lab's walls stand where its hedge would.
    if (inRoom(x1, z1, 0.2) && inRoom(x2, z2, 0.2)) continue;
    const len = Math.hypot(x2 - x1, z2 - z1), m = box(len + 0.4, 0.8, 0.5, HEDGE, (x1 + x2) / 2, (heightAt(x1, z1) + heightAt(x2, z2)) / 2 + 0.4, (z1 + z2) / 2);
    m.rotation.y = Math.atan2(x2 - x1, z2 - z1) + Math.PI / 2; still.add(m);
  }
  for (const [x, z, face] of SIGNS) {
    const g = new THREE.Group(); g.add(box(0.1, 1.8, 0.1, SLATE, 0, 0.9, 0), box(0.9, 0.26, 0.05, H_WAIT, 0.32, 1.5, 0), box(0.8, 0.24, 0.05, H_MINE, -0.28, 1.18, 0.02));
    g.position.set(x, heightAt(x, z), z); g.rotation.y = face; still.add(g);
  }
  for (const [x, z] of LAMPS) {
    const y = heightAt(x, z);
    still.add(cyl(0.05, 0.07, 3.0, SLATE, x, y + 1.5, z, 8));
    scene.add(glowBox(0.3, 0.12, 0.3, 0xfff4d0, x, y + 3.05, z, 0.8));
  }
  // Parking bays: white lines in rows across the lot, and a sign where the road comes in.
  for (const lz of [-14, -10, -6, -2.2]) for (let lx = 2; lx < W - 2; lx += 2.6) {
    if (tileAt(lx, lz) !== "k") continue;
    const y = heightAt(lx, lz); still.add(box(0.08, 0.02, 2.2, WHITE, lx, y + 0.02, lz));
  }
  const [sx, sz] = WILD_SIGN, sy = heightAt(sx, sz);
  still.add(box(0.1, 2.0, 0.1, SLATE, sx, sy + 1.0, sz));
  const p = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), sign("P", 0.9, 0.9, "#2f6ad8", "#ffffff")); p.position.set(sx, sy + 1.75, sz + 0.06); p.material.side = THREE.DoubleSide; scene.add(p);
  // Flower beds and shrubs on the lawns, as instances.
  const spots: [number, number][] = [];
  for (let i = 0; i < 1800 && spots.length < 380; i++) {
    const x = 0.5 + rnd(i * 3.7 + 1) * (W - 1), z = WILD_Z + 1 + rnd(i * 9.1 + 2) * (H - WILD_Z - 2);
    if (tileAt(x, z) !== "g" || buildingAt(x, z) || inRoom(x, z) || nearChapel(x, z) || nearKitchen(x, z) || Math.hypot(x - CX, z - CZ) < 2.5) continue;
    if ([-0.6, 0.6].some((o) => tileAt(x + o, z) !== "g" || tileAt(x, z + o) !== "g")) continue;
    spots.push([x, z]);
  }
  const bloom = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.16, 0), toon(WHITE), spots.length), mtx = new THREE.Matrix4(), c = new THREE.Color();
  spots.forEach(([x, z], i) => {
    const s = 0.6 + rnd(i) * 0.8; mtx.makeScale(s, s * 0.8, s).setPosition(x, heightAt(x, z) + 0.1 * s, z); bloom.setMatrixAt(i, mtx);
    bloom.setColorAt(i, c.setHex(i % 3 ? [0x3f9a4a, 0x4fb05a][i % 2] : [0xff8ab0, 0xffd34a, 0xffffff, 0x9fb8ff][i % 4]));
  });
  bloom.castShadow = bloom.receiveShadow = true; bloom.raycast = () => {}; scene.add(bloom);
}

/** The office park: ground and canal, the four offices, the meeting room, the canteen, the plaza, the grounds, under
 *  a clear sky and a high sun. */
function buildPark() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xa8d8f5);
  scene.fog = new THREE.Fog(0xa8d8f5, 18, 34);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x5a9a50, 0.95));
  const sun = new THREE.DirectionalLight(0xfff2e0, 1.85), mid = new THREE.Vector3(CX, 0, (Z0 + H) / 2);
  sun.position.set(mid.x - 14, 26, mid.z + 10); sun.target.position.copy(mid); scene.add(sun, sun.target);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  Object.assign(sun.shadow.camera, { left: -42, right: 42, top: 42, bottom: -42, near: 1, far: 90 }); sun.shadow.camera.updateProjectionMatrix();
  const ground = terrain(TILE); (ground as THREE.Mesh).material = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: RAMP }); ground.receiveShadow = true; scene.add(ground);
  const canal = river(0x4a9ed8, 0xd8f0ff); canal.receiveShadow = true; scene.add(canal);
  const roofs: THREE.Object3D[] = [];
  for (const b of BUILDINGS) {
    scene.add(house(b, { stone: WHITE, floor: 0xe4dccf, pane: GLASS, lit: 0x000000, roof: () => new THREE.Group(), walls: officeWalls }));
    const r = officeRoof(b); scene.add(r); roofs.push(r);
  }
  const still = new THREE.Group();
  officeFurniture(scene); meetingRoom(scene, roofs); canteen(scene, roofs); workRooms(scene, roofs);
  stations(scene, still); fountain(scene, still); grounds(scene, still);
  for (const t of TREES) { if (inRoom(t.x, t.z)) continue; const g = tree(t); if (t.kind === "dead") scene.add(g); else still.add(g); }
  bake(still, scene);
  shade(scene);
  for (const r of roofs) r.traverse((o) => { if (!o.userData.target) o.userData.target = o.parent?.userData.target; });
  ground.castShadow = false; canal.castShadow = false;
  const walls: THREE.Mesh[] = [];
  scene.traverse((o) => { if (o.userData.wall) walls.push(o as THREE.Mesh); });
  return { scene, ground, roofs, walls };
}

// ---------- the employees ----------

/** Shirts in the board's colours and a few more, one per agent; trousers and skin tones to vary them. */
const SHIRTS = [0x3a7bd5, 0xe8607a, 0x2a9a86, 0xf0a030, 0x7a5ad8, 0x4fb05a, 0xd9694c];
const PANTS = [0x2a3448, 0x4b535c, 0x6a5a48, 0x1f2a3a, 0x3a3a44];
const SKINS = [0xffd7b0, 0xe8b088, 0xc68a5a, 0x8d5a3a, 0xf3c8a0, 0x6e4430];
const HAIR = [0x2d1b10, 0x111111, 0xd35400, 0x8a5a2a, 0xe8c070, 0x6a6a6a];

/** Parts merged into a limb or body, cel-shaded and inked. */
function sculpt(into: THREE.Object3D, parts: THREE.Object3D[]) {
  const g = new THREE.Group(); g.add(...parts); bake(g, into);
  into.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && !m.userData.ink) m.castShadow = true; });
}
const pill = (r: number, len: number, color: number, x: number, y: number, z: number) => { const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 12), new THREE.MeshLambertMaterial({ color })); m.position.set(x, y, z); return m; };
const HEAD_Y = 1.42, HEAD_R = 0.25;

/**
 * An employee, cartoon-proportioned: a big round head with dot eyes and a hairstyle, a tapered shirt with a lanyard
 * and badge, trousers, shoes, hands. `seed` picks skin, hair, style and glasses. Feet at 0, about 1.67 tall.
 */
function employee(shirt: number, _legs = 0x2a3448, seed = 0.5): Person {
  const g = new THREE.Group(), pick = <T,>(xs: T[], k: number) => xs[Math.floor(rnd(seed * 97 + k) * xs.length)];
  const skin = pick(SKINS, 1), hair = pick(HAIR, 2), pants = pick(PANTS, 3), style = Math.floor(rnd(seed * 53) * 4), specs = rnd(seed * 41) > 0.65;
  const limb = (x: number, y: number, len: number, r: number, color: number, end: THREE.Mesh) => {
    const p = new THREE.Group(); p.position.set(x, y, 0);
    sculpt(p, [pill(r, len - 2 * r, color, 0, -len / 2, 0), end]); g.add(p); return p;
  };
  const shoe = () => { const m = ball(0.085, INK, 0, -0.6, 0.04, 1, 0.7, 1.4); return m; };
  const legL = limb(-0.09, 0.66, 0.62, 0.075, pants, shoe()), legR = limb(0.09, 0.66, 0.62, 0.075, pants, shoe());
  const armL = limb(-0.24, 1.1, 0.5, 0.055, shirt, ball(0.06, skin, 0, -0.52, 0)), armR = limb(0.24, 1.1, 0.5, 0.055, shirt, ball(0.06, skin, 0, -0.52, 0));
  const body: THREE.Object3D[] = [];
  const torso = cyl(0.2, 0.16, 0.5, shirt, 0, 0.91, 0, 16); torso.scale.z = 0.72; body.push(torso);
  const hips = ball(0.17, pants, 0, 0.68, 0, 1, 0.55, 0.72); body.push(hips);
  body.push(cyl(0.07, 0.08, 0.1, skin, 0, 1.2, 0, 10));
  // Collar, lanyard and badge.
  body.push(box(0.2, 0.05, 0.16, WHITE, 0, 1.15, 0.02));
  const strap = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.01, 6, 18, Math.PI), new THREE.MeshLambertMaterial({ color: INK })); strap.position.set(0, 1.08, 0.11); strap.rotation.set(Math.PI * 0.62, 0, Math.PI); body.push(strap);
  body.push(box(0.08, 0.1, 0.02, WHITE, 0, 0.98, 0.15), box(0.06, 0.03, 0.025, shirt, 0, 1.01, 0.155));
  // Head: skull, ears, nose, dot eyes with a shine, a small smile.
  body.push(ball(HEAD_R, skin, 0, HEAD_Y, 0), ball(0.05, skin, -HEAD_R, HEAD_Y, 0, 0.5, 1, 0.8), ball(0.05, skin, HEAD_R, HEAD_Y, 0, 0.5, 1, 0.8));
  body.push(ball(0.035, skin, 0, HEAD_Y - 0.03, HEAD_R - 0.01, 1, 0.9, 1));
  for (const sx of [-1, 1]) body.push(ball(0.034, INK, sx * 0.09, HEAD_Y + 0.03, HEAD_R - 0.03, 1, 1.25, 0.6), ball(0.011, WHITE, sx * 0.09 + 0.012, HEAD_Y + 0.05, HEAD_R - 0.005));
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.045, 0.008, 6, 12, Math.PI), new THREE.MeshLambertMaterial({ color: INK })); smile.position.set(0, HEAD_Y - 0.08, HEAD_R - 0.03); smile.rotation.z = Math.PI; body.push(smile);
  if (specs) for (const sx of [-1, 1]) { const rim = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.009, 6, 16), new THREE.MeshLambertMaterial({ color: INK })); rim.position.set(sx * 0.09, HEAD_Y + 0.03, HEAD_R - 0.01); body.push(rim); }
  // Hair: a cap, a bun, a tall swoop, or short and neat.
  const cap = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R * 1.05, 18, 10, 0, Math.PI * 2, 0, Math.PI * (style === 3 ? 0.4 : 0.52)), new THREE.MeshLambertMaterial({ color: hair }));
  cap.position.set(0, HEAD_Y + 0.01, -0.02); cap.rotation.x = -0.3; body.push(cap);
  if (style === 1) body.push(ball(0.11, hair, 0, HEAD_Y + 0.2, -0.16));
  if (style === 2) body.push(ball(0.13, hair, 0.04, HEAD_Y + 0.22, 0.06, 1.3, 0.8, 1.1));
  if (style === 0) body.push(ball(HEAD_R * 1.02, hair, 0, HEAD_Y - 0.02, -0.06, 1, 1, 0.9));
  sculpt(g, body);
  return { g, legL, legR, armL, armR };
}

/** What an employee wears for its task: headphones to build, a tool belt at the help desk, a blazer and shades for a
 *  self-review, a cardigan and reading glasses to review, a lab coat to verify, a visor to sketch, a hard hat and hi-vis
 *  on the new wing, a chef's hat in the canteen. */
function outfit(task: AgentTask): THREE.Object3D {
  const out = new THREE.Group(), p: THREE.Object3D[] = [], hy = HEAD_Y;
  const hardHat = (c: number) => { const hat = new THREE.Mesh(new THREE.SphereGeometry(HEAD_R * 1.12, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshLambertMaterial({ color: c })); hat.position.set(0, hy + 0.04, 0); p.push(hat, cyl(HEAD_R * 1.3, HEAD_R * 1.3, 0.025, c, 0, hy + 0.05, 0.04, 20)); };
  if (task === "build") { const band = new THREE.Mesh(new THREE.TorusGeometry(HEAD_R * 1.05, 0.025, 6, 20, Math.PI), new THREE.MeshLambertMaterial({ color: INK })); band.position.set(0, hy + 0.02, 0); band.rotation.y = Math.PI / 2; p.push(band); for (const sx of [-1, 1]) p.push(cyl(0.08, 0.08, 0.07, H_ASK, sx * HEAD_R * 1.04, hy, 0, 14).rotateZ(Math.PI / 2)); }
  if (task === "fix") p.push(cyl(0.2, 0.2, 0.08, 0x6a4a2a, 0, 0.72, 0, 16), box(0.08, 0.14, 0.06, 0x8a9098, 0.16, 0.66, 0.12));
  if (task === "selfreview") { p.push(cyl(0.22, 0.18, 0.5, INK, 0, 0.91, -0.01, 16)); for (const sx of [-1, 1]) p.push(ball(0.05, INK, sx * 0.09, hy + 0.03, HEAD_R - 0.01, 1.3, 0.8, 0.5)); p.push(box(0.2, 0.02, 0.02, INK, 0, hy + 0.04, HEAD_R)); }
  if (task === "review") { p.push(cyl(0.215, 0.175, 0.5, 0xb88a5a, 0, 0.9, -0.01, 16)); for (const sx of [-1, 1]) { const rim = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.01, 6, 16), new THREE.MeshLambertMaterial({ color: 0x8a5a2a })); rim.position.set(sx * 0.09, hy + 0.0, HEAD_R + 0.005); p.push(rim); } }
  if (task === "verify") { p.push(cyl(0.22, 0.24, 0.85, WHITE, 0, 0.78, 0, 16), box(0.2, 0.26, 0.02, 0xc8a070, 0.12, 0.85, 0.2)); }
  if (task === "chart") { const visor = new THREE.Mesh(new THREE.TorusGeometry(HEAD_R * 1.02, 0.03, 6, 20), new THREE.MeshLambertMaterial({ color: H_WAIT })); visor.position.set(0, hy + 0.1, 0); visor.rotation.x = Math.PI / 2; p.push(visor, box(0.3, 0.02, 0.16, H_WAIT, 0, hy + 0.1, HEAD_R + 0.04)); }
  if (task === "improve") { hardHat(0xffcf3a); p.push(cyl(0.215, 0.175, 0.32, 0xff8a2a, 0, 0.95, 0, 16), cyl(0.217, 0.2, 0.05, 0xe8f0e0, 0, 0.98, 0, 16)); }
  if (task === "grill") { p.push(cyl(0.16, 0.14, 0.26, WHITE, 0, hy + 0.3, 0, 14), ball(0.2, WHITE, 0, hy + 0.45, 0, 1, 0.6, 1), box(0.36, 0.5, 0.03, WHITE, 0, 0.82, 0.15)); }
  sculpt(out, p);
  return out;
}

/** The park's keepers: the barista behind the café counter, the mail clerk at the mailroom's, the records keeper at
 *  their desk. */
function keeper(kind: Keeper): Person {
  const at = (k: string) => FURNITURE.find((f) => f.kind === k)!;
  let p: Person;
  if (kind === "bartender") {
    p = employee(0x2a2e36, 0, 0.37); sculpt(p.g, [box(0.4, 0.6, 0.03, ASK, 0, 0.82, 0.15), cyl(0.2, 0.2, 0.08, H_ASK, 0, HEAD_Y + 0.22, 0, 16)]);
    const bar = at("bar"); p.g.position.set(bar.x + bar.w / 2, 0.08, 36.5); p.g.rotation.y = Math.PI;
  } else if (kind === "teller") {
    p = employee(H_DONE, 0, 0.71); sculpt(p.g, [cyl(0.19, 0.19, 0.06, H_DONE, 0, HEAD_Y + 0.2, 0, 16), box(0.24, 0.02, 0.14, H_DONE, 0, HEAD_Y + 0.18, HEAD_R)]);
    const c = at("counter"); p.g.position.set(c.x + c.w / 2, 0.08, c.z - 0.75);
  } else {
    p = employee(0x7a5ad8, 0, 0.23); sculpt(p.g, [cyl(0.215, 0.175, 0.5, 0x5a3aa8, 0, 0.9, -0.01, 16)]);
    const d = at("desk"); p.g.position.set(d.x + d.w / 2, 0.08, d.z + d.d + 0.35); p.g.rotation.y = Math.PI;
  }
  return p;
}

/** What's in an employee's hand: a laptop, a screwdriver, a marker, a tablet, a stack of printouts, a hammer, a
 *  spatula, a coffee; a rolled-up report and a laser pointer for an argument. */
function tool(kind: Skill | "mug" | "sword" | "staff") {
  const g = new THREE.Group(), p: THREE.Object3D[] = [];
  if (kind === "smithing") p.push(box(0.36, 0.03, 0.26, 0x8a9098, 0, -0.06, 0.1));
  else if (kind === "crafting") p.push(cyl(0.025, 0.025, 0.12, H_ASK, 0, -0.06, 0, 8), cyl(0.008, 0.008, 0.14, 0x9aa0a8, 0, -0.19, 0, 6));
  else if (kind === "woodcutting") p.push(cyl(0.02, 0.02, 0.18, H_WAIT, 0, -0.1, 0, 8));
  else if (kind === "mining") p.push(box(0.2, 0.28, 0.02, INK, 0, -0.12, 0.05), box(0.17, 0.24, 0.025, 0x8fd0ff, 0, -0.12, 0.055));
  else if (kind === "fishing") p.push(box(0.22, 0.3, 0.03, WHITE, 0, -0.12, 0.05), box(0.16, 0.02, 0.035, SLATE, 0, -0.05, 0.05), box(0.12, 0.02, 0.035, SLATE, 0, -0.1, 0.05));
  else if (kind === "construction") p.push(cyl(0.025, 0.025, 0.4, WOOD, 0, -0.2, 0, 8), box(0.16, 0.07, 0.07, SLATE, 0, -0.4, 0));
  else if (kind === "cooking") p.push(cyl(0.015, 0.015, 0.35, INK, 0, -0.17, 0, 6), box(0.1, 0.01, 0.14, 0x9aa0a8, 0, -0.36, 0.03));
  else if (kind === "mug") p.push(cyl(0.06, 0.05, 0.14, WHITE, 0, -0.06, 0.06, 12), cyl(0.06, 0.06, 0.02, H_ASK, 0, -0.02, 0.06, 12));
  else if (kind === "sword") p.push(cyl(0.04, 0.04, 0.55, WHITE, 0, -0.26, 0, 10));
  else { p.push(cyl(0.02, 0.02, 0.2, INK, 0, -0.1, 0, 8)); g.add(glowBox(0.03, 0.03, 0.03, 0xff3040, 0, -0.21, 0, 2)); }
  sculpt(g, p);
  g.position.set(0, -0.52, 0.05);
  return g;
}

/** A sticky note on the Kanban board for an item that needs the user: a square of paper in its lane's colour, a
 *  scribble on it. */
function note(pin: number) {
  const g = new THREE.Group();
  const paper = box(0.42, 0.38, 0.02, pin === 0xd82a1a ? ASK : MINE, 0, 0, 0); g.add(paper);
  for (let k = 0; k < 3; k++) g.add(box(0.26 - k * 0.04, 0.025, 0.025, INK, -0.04, 0.08 - k * 0.08, 0.01));
  const dot = box(0.06, 0.06, 0.03, pin, 0.14, 0.13, 0.02); Object.assign(dot.material, { emissive: new THREE.Color(pin), emissiveIntensity: 0.4 }); g.add(dot);
  return g;
}

/** The park from above, for the minimap. */
function minimap() {
  const c = document.createElement("canvas"); c.width = W * MM; c.height = ROWS * MM;
  const g = c.getContext("2d")!;
  const css: Record<Tile, string> = { g: "#7ccf6a", p: "#dcd6cc", s: "#e6e1d6", w: "#4a9ed8", k: "#5a5e66", d: "#b8b8b4" };
  for (let r = 0; r < ROWS; r++) for (let x = 0; x < W; x++) { g.fillStyle = css[TILES[r][x]]; g.fillRect(x * MM, r * MM, MM, MM); }
  for (const t of TREES) { g.fillStyle = t.kind === "dead" ? "#e8607a" : "#3f9a4a"; g.fillRect(t.x * MM - 2, mmz(t.z) - 2, 4, 4); }
  for (const b of BUILDINGS) { g.fillStyle = "#ffffff"; g.fillRect(b.x * MM, mmz(b.z), b.w * MM, b.d * MM); g.fillStyle = `#${LOOK[b.id].head.toString(16).padStart(6, "0")}`; g.fillRect(b.x * MM, mmz(b.z), b.w * MM, 2); }
  g.fillStyle = "#b6e0d7"; g.fillRect(CHAPEL.x * MM, mmz(CHAPEL.z), CHAPEL.w * MM, CHAPEL.d * MM);
  g.fillStyle = "#f2dcab"; g.fillRect(KITCHEN.x * MM, mmz(KITCHEN.z), KITCHEN.w * MM, KITCHEN.d * MM);
  return c;
}

export const OFFICE: WorldKit = {
  buildTown: buildPark, person: employee, outfit, keeper, tool, scroll: note, hintArrow, minimapImage: minimap, shirts: SHIRTS,
  buildings: {
    next: { name: "Reception", does: "Next: what to do, one at a time" },
    finished: { name: "Mailroom", does: "Finished: what shipped, day by day, sent out" },
    sessions: { name: "Café", does: "Sessions: every agent in herdr, on a break or not" },
    docs: { name: "Records Room", does: "Docs: glossary, ADRs and visuals" },
  },
  areas: {
    Smithy: "Dev Studio", Mine: "QA Lab", Grove: "Garden", "Riverbank north": "Canal north", "Riverbank south": "Canal south", Inn: "Café",
    Wilderness: "Parking Lot", "Construction site": "New Wing", Kitchen: "Canteen", Workshop: "IT Help Desk", Chapel: "Meeting Room", Bonfire: "Time Clock",
  },
  verbs: { smithing: "Building at a standing desk in the dev studio", crafting: "Fixing at the IT help desk", fishing: "Reviewing by the canal", mining: "Testing in the QA lab", woodcutting: "Sketching in the garden", construction: "Working on the new wing", cooking: "Grilling in the canteen" },
  welcome: [{ t: "Welcome to the office park." }, { t: "Everyone you see is an agent at work. What needs you is a sticky note on the Kanban board north of the fountain: yellow notes are your turn, red are asked of you, most pressing top left.", c: "blue" }],
  ground: "Freshly mown lawn.",
  board: "Kanban board", pray: "in the meeting room, waiting on a review from", burn: "clocking out: done,", drink: "on a coffee break in the café",
  rest: { held: "mug" },
  fight: {
    hit: (scene: THREE.Scene, bits: Bit[], x: number, y: number, z: number) => burst(scene, bits, x, y, z, WHITE, 6, 0.8),
    attack: "Arguing the review", defend: "Reviewer",
    holding: "the reviewer, holding the self-review's findings until its PR's session takes them", fighting: "arguing with its self-review over the findings",
    defeat: (w, l) => `${w} has won the argument with ${l}! The review's findings are back with ${w}.`,
  },
  panel: { quests: "Inbox", stats: "Skills", options: "Settings", list: "Your inbox", statsTitle: "Performance review", total: "Total level", xp: "Points",
    how: "Points come from the board: CI passing, approvals and answered threads, agents finishing their work, and work shipping." },
  walls: ROOM_WALLS,
  render: { sharp: true, shadows: true, exposure: 0.88 },
};
