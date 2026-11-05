// The Wasteland: the World for the Wasteland skin. The town's layout, paths and work, drawn as a scrap-built outpost
// after the end of the world, under a dust-orange sky: shacks of corrugated sheet round a water tower, a sludge creek
// glowing green, dead trees, wrecked cars in the Badlands. Drawn sharp, in filmic light, with the sun casting shadows,
// sodium lamps and fires lighting their corners, and dust drifting through. Every agent is a scavenger.
// Each step of the work is outpost work: welding (Building), tinkering (Fixing), fishing the creek (Reviewing),
// picking the scrap heaps (Testing), chopping deadwood (Charting), rebuilding (Improving), cooking at the mess
// (Grilling), listening at the relay station (waiting on a review), the saloon (idle) and the burn barrel (spent).
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone as cloneRig } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { AgentTask } from "../../shared/types";
import { ALTAR, ANVILS, BOARD, BONFIRE, BUILDINGS, type Building, buildingAt, CHAPEL, CX, CZ, doorOf, FENCES, FURNACE, FURNITURE, GRILLS, H, heightAt, KITCHEN, LAMPS, nearChapel, nearKitchen, PEWS, ROCKS, ROWS, rnd, SIGNS, SITE, type Skill, type Tile, tileAt, TILES, TOWER, type Tree, TREES, W, WALL_H, WALL_T, WILD_SIGN, WILD_Z, WORKSHOP, Z0 } from "./map";
import { type Bit, box, burst, fountainWater, furniture, hintArrow, house, innBar, type Act, type Keeper, merge, MM, mmz, type Person, river, smoke, terrain } from "./scene";
import type { WorldKit } from "./kit";

const HAZE = 0xb4835a, RUST = 0x8a4a24, RUST_DARK = 0x5a2e16, STEEL = 0x70767a, STEEL_DARK = 0x3a3e42, CONCRETE = 0xb0aa9e;
const OLIVE = 0x5a5e3a, PLY = 0xb89466, TIRE = 0x1e1c1a, BONE = 0xd8cdb0, TOXIC = 0x7cff4a, SODIUM = 0xffa040, NEON = 0xff3b2f;
const HAZARD = 0xe0b020, CHAR = 0x241e1a;

const rgb = (hex: number): [number, number, number] => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
/** The ground: dry dirt, broken asphalt roads, a concrete square, the creek's sludge bed, the Badlands scorched. */
const TILE: Record<Tile, [number, number, number]> = {
  g: [0.62, 0.47, 0.31], p: [0.27, 0.26, 0.25], s: [0.55, 0.53, 0.49], w: [0.24, 0.3, 0.12], k: [0.4, 0.29, 0.2], d: [0.16, 0.12, 0.09],
};

// ---------- textures, drawn once on canvases ----------

/** A texture drawn on a square canvas, repeating, in sRGB. */
function canvasTex(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void) {
  const c = document.createElement("canvas"); c.width = c.height = size;
  draw(c.getContext("2d")!, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
/** Blotches of colour scattered over a texture: rust, dirt, stains. */
function blotches(g: CanvasRenderingContext2D, s: number, n: number, seed: number, colors: string[], r0: number, r1: number, a0 = 0.12, a1 = 0.45) {
  for (let i = 0; i < n; i++) {
    g.globalAlpha = a0 + rnd(seed + i * 1.7) * (a1 - a0); g.fillStyle = colors[i % colors.length];
    g.beginPath(); g.arc(rnd(seed + i * 3.1) * s, rnd(seed + i * 5.3) * s, r0 + rnd(seed + i * 7.9) * (r1 - r0), 0, Math.PI * 2); g.fill();
  }
  g.globalAlpha = 1;
}
/** Cracks: random walks of a dark line. */
function cracks(g: CanvasRenderingContext2D, s: number, n: number, seed: number, color: string, steps = 9) {
  g.strokeStyle = color; g.lineWidth = 1;
  for (let i = 0; i < n; i++) {
    let x = rnd(seed + i * 2.3) * s, y = rnd(seed + i * 4.1) * s;
    g.globalAlpha = 0.5; g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < steps; k++) { x += (rnd(seed + i * 9 + k) - 0.5) * s * 0.12; y += (rnd(seed + i * 11 + k * 3) - 0.5) * s * 0.12; g.lineTo(x, y); }
    g.stroke();
  }
  g.globalAlpha = 1;
}
/** Corrugated sheet's paint, grey so a material's colour tints it: rust breaking through, streaks running down. The
 *  ridges are in the geometry (ridged()). */
const CORRUGATED = canvasTex(128, (g, s) => {
  g.fillStyle = "#b4b4b4"; g.fillRect(0, 0, s, s);
  blotches(g, s, 160, 5, ["#9a9a9a", "#c8c8c8"], 1, 4, 0.2, 0.5);
  blotches(g, s, 26, 3, ["#7a3e1a", "#a0562a", "#5a2a10"], 3, 16, 0.2, 0.6);
  for (let i = 0; i < 14; i++) {
    const x = rnd(i * 6.7) * s, y = rnd(i * 2.9) * s * 0.6, len = 20 + rnd(i * 4.4) * 60, grd = g.createLinearGradient(0, y, 0, y + len);
    grd.addColorStop(0, "rgba(110,50,20,.55)"); grd.addColorStop(1, "rgba(110,50,20,0)"); g.fillStyle = grd; g.fillRect(x, y, 2 + rnd(i) * 3, len);
  }
});
/** Poured concrete: speckled, stained, cracked. */
const CONCRETE_TEX = canvasTex(128, (g, s) => {
  g.fillStyle = "#c8c4ba"; g.fillRect(0, 0, s, s);
  blotches(g, s, 220, 11, ["#9a968c", "#e0dcd2", "#7a766c"], 0.5, 2, 0.2, 0.6);
  blotches(g, s, 10, 17, ["#6a5a48", "#4a463e"], 8, 22, 0.08, 0.2);
  cracks(g, s, 5, 23, "#3a3832");
});
/** Weathered planks: four boards a tile, grain and nails, dark gaps between. */
const PLANKS = canvasTex(128, (g, s) => {
  for (let i = 0; i < 4; i++) {
    const v = 170 + Math.round(rnd(i * 3.3) * 50); g.fillStyle = `rgb(${v},${Math.round(v * 0.86)},${Math.round(v * 0.66)})`; g.fillRect(0, i * 32, s, 32);
    g.strokeStyle = "rgba(70,50,30,.35)"; for (let k = 0; k < 5; k++) { g.beginPath(); const y = i * 32 + 4 + rnd(i * 7 + k) * 24; g.moveTo(0, y); g.bezierCurveTo(40, y + 3, 80, y - 3, s, y + 1); g.stroke(); }
    g.fillStyle = "#2a2018"; g.fillRect(0, i * 32, s, 2);
    g.fillStyle = "#3a3a3a"; for (const x of [8, 116]) g.fillRect(x, i * 32 + 14, 3, 3);
  }
  blotches(g, s, 12, 41, ["#3a2a1a"], 4, 14, 0.06, 0.18);
});
/** Black and yellow hazard stripes. */
const HAZARD_TEX = canvasTex(64, (g, s) => {
  g.fillStyle = "#e0b020"; g.fillRect(0, 0, s, s); g.fillStyle = "#1a1714";
  for (let k = -2; k < 3; k++) { g.beginPath(); g.moveTo(k * 32, 0); g.lineTo(k * 32 + 16, 0); g.lineTo(k * 32 + 16 + s, s); g.lineTo(k * 32 + s, s); g.fill(); }
  blotches(g, s, 10, 51, ["#5a2a10"], 2, 6, 0.2, 0.5);
});
/** Grit over the ground's colours: grey noise the vertex colours multiply, pebbles and cracks. */
const GRIT = canvasTex(256, (g, s) => {
  g.fillStyle = "#d8d8d8"; g.fillRect(0, 0, s, s);
  blotches(g, s, 1400, 61, ["#b0b0b0", "#f0f0f0", "#989898"], 0.5, 1.6, 0.25, 0.7);
  blotches(g, s, 40, 67, ["#8a8a8a", "#bcbcbc"], 8, 26, 0.08, 0.22);
  cracks(g, s, 6, 71, "#8a8a8a", 6);
});
/** Chain-link: wire diamonds on nothing, cut out by alpha. */
const CHAINLINK = (() => {
  const t = canvasTex(32, (g, s) => {
    g.strokeStyle = "#b8bcc0"; g.lineWidth = 2;
    g.beginPath(); g.moveTo(0, s / 2); g.lineTo(s / 2, 0); g.lineTo(s, s / 2); g.lineTo(s / 2, s); g.closePath(); g.stroke();
  });
  return t;
})();

/** Words painted on a board: stencil letters on a ground, for signs. */
function label(text: string, w: number, h: number, bg: string | null, fg: string, glow = false) {
  const c = document.createElement("canvas"); c.width = Math.round(w * 128); c.height = Math.round(h * 128);
  const g = c.getContext("2d")!;
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height); blotches(g, c.width, 18, text.length, ["#2a1a10", "#6a3a1a"], 2, 10, 0.1, 0.3); }
  g.font = `bold ${Math.round(c.height * 0.62)}px Impact, 'Arial Black', sans-serif`; g.textAlign = "center"; g.textBaseline = "middle";
  if (glow) { g.shadowColor = fg; g.shadowBlur = c.height * 0.18; }
  g.fillStyle = fg; g.fillText(text, c.width / 2, c.height * 0.54, c.width * 0.92);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// ---------- materials and pieces ----------

const std = (color: number, rough = 0.85, metal = 0) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
/** A material with a texture, repeated to the size it covers so the pattern keeps its scale. */
function textured(tex: THREE.Texture, color: number, rx: number, ry: number, rough = 0.8, metal = 0) {
  const t = tex.clone(); t.repeat.set(rx, ry); t.offset.set(rnd(rx * 7 + ry), rnd(ry * 3 + rx)); t.needsUpdate = true;
  return new THREE.MeshStandardMaterial({ color, map: t, roughness: rough, metalness: metal });
}
/** A block with its edges rounded off, so light catches them. */
function slab(w: number, h: number, d: number, mat: THREE.Material, x = 0, y = 0, z = 0) {
  const r = Math.min(0.035, Math.min(w, h, d) * 0.25);
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, r), mat); m.position.set(x, y, z); return m;
}
/** A sheet of corrugated metal, `w` across and `h` up, facing +z: real ridges, six to a unit, so the sun rakes them. */
function ridged(w: number, h: number) {
  const g = new THREE.PlaneGeometry(w, h, Math.max(2, Math.round(w * 24)), 1), p = g.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * Math.PI * 12) * 0.03);
  g.computeVertexNormals();
  return g;
}
/** A corrugated sheet for a roof: lying flat, `w` across, `len` along its ridges, tilted after by its rotation.x. */
function roofSheet(w: number, len: number, tint: number) {
  const g = ridged(w, len); g.rotateX(-Math.PI / 2);
  const mat = textured(CORRUGATED, tint, w, len / 2, 0.55, 0.35); mat.side = THREE.DoubleSide;
  return new THREE.Mesh(g, mat);
}
function cyl(rTop: number, rBot: number, h: number, mat: THREE.Material, x = 0, y = 0, z = 0, seg = 14) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), mat); m.position.set(x, y, z); return m;
}
/** A part that gives off light: a sign's tube, a lamp's glass, embers. */
function glowing(m: THREE.Mesh, color: number, k = 1.4) {
  const mat = m.material as THREE.MeshStandardMaterial | THREE.MeshLambertMaterial;
  Object.assign(mat, { emissive: new THREE.Color(color), emissiveIntensity: k }); return m;
}
const glowBox = (w: number, h: number, d: number, color: number, x: number, y: number, z: number, k = 1.4) => glowing(box(w, h, d, color, x, y, z), color, k);
/** Shared paint for merged props: the colour per vertex, in the same light as everything else. */
const PAINT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.06 });
/** A group's meshes merged into one, painted. */
function bake(group: THREE.Object3D, into: THREE.Object3D) {
  const m = merge(group, into); if (m) m.material = PAINT; return m;
}
/** Everything in it casts and catches shadows. */
function shade(o: THREE.Object3D, cast = true) {
  o.traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh) { m.castShadow = cast; m.receiveShadow = true; } });
  return o;
}
/** A flickering light: the mesh's glow and the light wavering together, each frame it's drawn. */
function flicker(m: THREE.Mesh, light: THREE.PointLight | null, base: number, seed: number) {
  const mat = m.material as THREE.MeshStandardMaterial, k0 = mat.emissiveIntensity, l0 = light?.intensity ?? 0;
  m.onBeforeRender = () => {
    const t = performance.now() / 1000, f = 0.82 + Math.sin(t * 13 + seed) * 0.08 + Math.sin(t * 29 + seed * 3) * 0.06 + Math.sin(t * 5.3 + seed) * 0.04;
    mat.emissiveIntensity = k0 * f * base; if (light) light.intensity = l0 * f;
  };
}
function lamp(color: number, intensity: number, dist: number, x: number, y: number, z: number) {
  const l = new THREE.PointLight(color, intensity, dist, 2); l.position.set(x, y, z); return l;
}

/** A run of corrugated sheets along a wall's line, each a little different: tint, height, a tilt. */
const SHEET_TINTS = [0xe8e4dc, 0xd8a080, 0xb8c0a8, 0xe0c8a0, 0xa8b4b8, 0xc89878];
function sheets(add: (m: THREE.Mesh) => void, x0: number, z0: number, x1: number, z1: number, h: number, seed: number, y0 = 0.08, t = WALL_T) {
  const len = Math.hypot(x1 - x0, z1 - z0); if (len < 0.05) return;
  const n = Math.max(1, Math.round(len / 1.1)), alongX = Math.abs(z1 - z0) < 1e-6;
  for (let i = 0; i < n; i++) {
    const f = (i + 0.5) / n, k = rnd(seed * 3.7 + i * 7.3), w = len / n + 0.05, hh = h - 0.1 + rnd(seed + i * 3.1) * 0.16;
    const mat = textured(CORRUGATED, SHEET_TINTS[Math.floor(k * SHEET_TINTS.length)], w, hh / 2, 0.55, 0.35); mat.side = THREE.DoubleSide;
    const m = new THREE.Mesh(ridged(w, hh), mat); m.position.set(x0 + (x1 - x0) * f + (alongX ? 0 : (k - 0.5) * t), y0 + hh / 2, z0 + (z1 - z0) * f + (alongX ? (k - 0.5) * t : 0));
    m.rotation.y = alongX ? 0 : Math.PI / 2; m.rotation.z = (k - 0.5) * 0.03; add(m);
  }
}
/** A plank board, or several nailed up. */
const plank = (w: number, h: number, d: number, x: number, y: number, z: number, tint = PLY) => slab(w, h, d, textured(PLANKS, tint, Math.max(w, d), h * 2), x, y, z);

// ---------- the shacks ----------

/** The buildings' walls: corrugated sheet on steel corners, a hazard-striped doorframe under a plank lintel, and
 *  boarded-up windows. Every piece is part of the walls, so they fade with them. */
function shackWalls(b: Building, wall: (m: THREE.Mesh) => void) {
  const d = doorOf(b), back = d.z === b.z ? b.z + b.d : b.z, s = b.x * 13 + b.z;
  const front = d.z + (d.z === b.z ? WALL_T / 2 : -WALL_T / 2), rear = back + (back === b.z ? WALL_T / 2 : -WALL_T / 2), out = d.z === b.z ? -1 : 1;
  const xl = b.x + WALL_T / 2, xr = b.x + b.w - WALL_T / 2;
  sheets(wall, xl, b.z, xl, b.z + b.d, WALL_H, s); sheets(wall, xr, b.z, xr, b.z + b.d, WALL_H, s + 1);
  sheets(wall, b.x, rear, b.x + b.w, rear, WALL_H, s + 2);
  sheets(wall, b.x, front, d.x - 0.6, front, WALL_H, s + 3); sheets(wall, d.x + 0.6, front, b.x + b.w, front, WALL_H, s + 4);
  wall(plank(1.5, 0.5, WALL_T + 0.06, d.x, WALL_H - 0.14, front));
  for (const sx of [-0.68, 0.68]) wall(slab(0.14, 2.05, WALL_T + 0.1, textured(HAZARD_TEX, 0xffffff, 0.3, 4), d.x + sx, 1.1, front));
  const steel = std(STEEL_DARK, 0.5, 0.4);
  for (const [cx, cz] of [[b.x, b.z], [b.x + b.w, b.z], [b.x, b.z + b.d], [b.x + b.w, b.z + b.d]]) wall(slab(0.22, WALL_H + 0.25, 0.22, steel.clone(), cx, (WALL_H + 0.25) / 2 + 0.08, cz));
  // A boarded window in each side wall, and in the back but for the saloon: a dark hole, three planks across it.
  const boarded = (x: number, z: number, alongX: boolean) => {
    const hole = slab(alongX ? 0.9 : WALL_T + 0.04, 0.7, alongX ? WALL_T + 0.04 : 0.9, std(0x14110e, 1), x, 1.5, z); wall(hole);
    for (let k = 0; k < 3; k++) {
      const p = plank(alongX ? 1.1 : WALL_T + 0.1, 0.13, alongX ? WALL_T + 0.1 : 1.1, x, 1.3 + k * 0.2, z, 0xa88a60);
      if (alongX) p.rotation.z = (rnd(s + k) - 0.5) * 0.5; else p.rotation.x = (rnd(s + k) - 0.5) * 0.5; wall(p);
    }
  };
  for (const f of b.d < 8 ? [0.5] : [0.3, 0.7]) { boarded(xl, b.z + b.d * f, false); boarded(xr, b.z + b.d * f, false); }
  if (b.id !== "sessions") boarded(b.x + b.w * 0.3, rear, true);
  // A step of pallets at the door.
  wall(plank(1.4, 0.12, 0.7, d.x, 0.1, d.z + out * 0.45, 0x9a7a52));
}

/** What each building is called on its sign, and what stands on its roof. */
const SIGN_TEXT: Record<Building["id"], string> = { next: "DISPATCH", finished: "SALVAGE", sessions: "SALOON", docs: "ARCHIVE" };

/** A shed roof of corrugated sheet, low at the door, high at the back, overhanging; patched; and what's on top. In a
 *  group of its own, so it keeps its textures, hidden with the roofs. */
function shackRoof(b: Building) {
  const g = new THREE.Group(), d = doorOf(b), frontLow = d.z === b.z ? -1 : 1, lo = WALL_H + 0.16, hi = WALL_H + 0.85;
  const depth = b.d + 0.7, rise = hi - lo, len = Math.hypot(depth, rise), ang = Math.atan2(rise, depth) * frontLow, n = Math.ceil((b.w + 0.6) / 1.05);
  for (let i = 0; i < n; i++) {
    const w = (b.w + 0.6) / n + 0.04, k = rnd(b.x * 5 + i * 2.3);
    const m = roofSheet(w, len, SHEET_TINTS[Math.floor(k * SHEET_TINTS.length)]); m.position.set(b.x - 0.3 + (i + 0.5) * ((b.w + 0.6) / n), (lo + hi) / 2 + k * 0.02, b.z + b.d / 2);
    m.rotation.x = ang; m.rotation.z = (k - 0.5) * 0.02; g.add(m);
  }
  // Where it's patched: plywood squares and a tarp.
  const yAt = (z: number) => (lo + hi) / 2 + ((z - (b.z + b.d / 2)) / depth) * rise * -frontLow + 0.06;
  for (let k = 0; k < 2; k++) {
    const px = b.x + 1 + rnd(b.z + k) * (b.w - 2), pz = b.z + 1 + rnd(b.x + k * 5) * (b.d - 2), p = plank(1.1, 0.04, 1.1, px, yAt(pz) + 0.01, pz, 0xa08060);
    p.rotation.x = ang; g.add(p);
  }
  const top = (x: number, z: number) => yAt(z) + 0.02;
  const cx = b.x + b.w / 2, cz = b.z + b.d / 2;
  if (b.id === "sessions") {
    // A water tank on legs, and a stovepipe.
    const tx = b.x + b.w - 2.4, tz = cz + 1.5, ty = top(tx, tz);
    for (const [ox, oz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]]) g.add(slab(0.1, 1.2, 0.1, std(STEEL_DARK, 0.5, 0.4), tx + ox, ty + 0.6, tz + oz));
    g.add(cyl(0.85, 0.85, 1.3, textured(CORRUGATED, 0xc89878, 3, 1, 0.6, 0.25), tx, ty + 1.85, tz, 18), cyl(0.9, 0.9, 0.08, std(RUST_DARK, 0.7, 0.3), tx, ty + 2.54, tz, 18));
    g.add(cyl(0.12, 0.12, 1.4, std(0x2a2826, 0.5, 0.5), b.x + 2, top(b.x + 2, cz) + 0.7, cz, 8));
  }
  if (b.id === "next") {
    // A dish and an aerial, for dispatch.
    const dx = b.x + 1.6, dz = cz + 1, dy = top(dx, dz);
    g.add(slab(0.1, 0.8, 0.1, std(STEEL_DARK, 0.5, 0.4), dx, dy + 0.4, dz));
    const dish = new THREE.Mesh(new THREE.SphereGeometry(0.75, 18, 8, 0, Math.PI * 2, 0, Math.PI / 3.2), std(0xd8d4cc, 0.5, 0.3)); dish.material.side = THREE.DoubleSide;
    dish.position.set(dx, dy + 1.0, dz); dish.rotation.x = -2.2; g.add(dish);
    g.add(slab(0.05, 3.0, 0.05, std(STEEL, 0.5, 0.5), b.x + b.w - 1.2, top(0, cz) + 1.5, cz), glowBox(0.1, 0.1, 0.1, NEON, b.x + b.w - 1.2, top(0, cz) + 3.05, cz, 2));
  }
  if (b.id === "finished") {
    // Sandbags along the front edge and crates of salvage.
    for (let i = 0; i < 7; i++) { const bag = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.5, 3, 8), std(0x9a8a64, 1)); bag.rotation.z = Math.PI / 2; const bx = b.x + 0.8 + i * ((b.w - 1.6) / 6), bz = d.z === b.z ? b.z + 0.4 : b.z + b.d - 0.4; bag.position.set(bx, top(bx, bz) + 0.15, bz); g.add(bag); }
    for (let k = 0; k < 3; k++) { const x = b.x + 2 + k * 0.9, z = cz + 0.8; g.add(plank(0.8, 0.6, 0.6, x, top(x, z) + 0.3 + (k === 1 ? 0.6 : 0), z, 0x7a8050)); }
  }
  if (b.id === "docs") {
    // Solar panels tilted to the sun, and an aerial array.
    for (let k = 0; k < 3; k++) {
      const x = b.x + 1.6 + k * 1.5, z = cz, p = slab(1.3, 0.05, 0.9, new THREE.MeshStandardMaterial({ color: 0x1a2a44, roughness: 0.25, metalness: 0.6 }), x, top(x, z) + 0.45, z);
      p.rotation.x = -0.5; g.add(p, slab(0.06, 0.4, 0.06, std(STEEL_DARK, 0.5, 0.4), x, top(x, z) + 0.2, z));
    }
    for (const ox of [0, 0.5, 1]) g.add(slab(0.04, 1.6 + ox, 0.04, std(STEEL, 0.5, 0.5), b.x + b.w - 1.5 + ox, top(0, cz) + 0.8 + ox / 2, cz - 1));
  }
  g.traverse((o) => { o.userData.target = { kind: "building", b }; });
  g.userData.roof = true;
  return g;
}

/** A sign over each door: a painted board, or the saloon's in red neon with its light on the street. */
function shackSign(b: Building, into: THREE.Object3D) {
  const d = doorOf(b), out = d.z === b.z ? -1 : 1, z = d.z + out * (WALL_T / 2 + 0.06), neon = b.id === "sessions";
  const tex = label(SIGN_TEXT[b.id], 2.6, 0.6, neon ? null : "#2a2620", neon ? "#ff6a50" : "#e8dcc0", neon);
  const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: neon, roughness: 0.7, ...(neon ? { emissive: new THREE.Color(0xffffff), emissiveMap: tex, emissiveIntensity: 2.2 } : {}) });
  const board = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 0.6), mat);
  board.position.set(d.x, WALL_H + 0.05, z); if (out > 0) board.rotation.y = 0; else board.rotation.y = Math.PI;
  board.userData.target = { kind: "building", b }; into.add(board);
  if (neon) {
    const light = lamp(NEON, 10, 7, d.x, WALL_H, z + out * 0.8); into.add(light);
    flicker(board, light, 1, 3);
  }
}

// ---------- the Relay Station (the Chapel) and the Mess (the Kitchen) ----------

/** The Relay Station: a concrete bunker, benches facing a radio console under a lattice mast with a red light. Those
 *  waiting on a review sit here, listening for it. Its roof is a slab, hidden with the others. */
function relay(scene: THREE.Object3D, roofs: THREE.Object3D[]) {
  const { x, z, w, d, door, h } = CHAPEL, t = 0.3, wallMat = () => textured(CONCRETE_TEX, CONCRETE, 2, 1.4, 0.95);
  const wall = (m: THREE.Mesh) => { m.userData.wall = true; scene.add(m); };
  wall(slab(door - 0.8 - x, h, t, wallMat(), (x + door - 0.8) / 2, h / 2, z + t / 2));
  wall(slab(x + w - door - 0.8, h, t, wallMat(), (door + 0.8 + x + w) / 2, h / 2, z + t / 2));
  wall(slab(1.6, h - 2.3, t, wallMat(), door, 2.3 + (h - 2.3) / 2, z + t / 2));
  wall(slab(t, h, d, wallMat(), x + t / 2, h / 2, z + d / 2)); wall(slab(t, h, d, wallMat(), x + w - t / 2, h / 2, z + d / 2));
  wall(slab(w, h, t, wallMat(), x + w / 2, h / 2, z + d - t / 2));
  // Slit windows lit from inside, and a blast door's frame in hazard stripes.
  for (const sx of [x + 2, x + w - 2]) wall(glowing(slab(1.2, 0.18, t + 0.04, std(0x2a5a2a), sx, h - 0.6, z + t / 2), TOXIC, 0.5));
  for (const sx of [door - 0.85, door + 0.85]) wall(slab(0.16, 2.3, t + 0.1, textured(HAZARD_TEX, 0xffffff, 0.3, 4), sx, 1.15, z + t / 2));
  scene.add(slab(w - 0.6, 0.06, d - 0.6, textured(CONCRETE_TEX, 0x8a867c, 5, 3, 1), x + w / 2, 0.11, z + d / 2));
  const roof = new THREE.Group();
  roof.add(slab(w + 0.4, 0.3, d + 0.4, textured(CONCRETE_TEX, 0xa09a8e, 5, 3, 0.95), x + w / 2, h + 0.15, z + d / 2));
  for (let k = 0; k < 6; k++) roof.add(cyl(0.18, 0.2, 0.3, std(RUST, 0.7, 0.3), x + 1 + k * 1.8, h + 0.45, z + d - 0.8, 8));
  roof.userData.roof = true; scene.add(roof); roofs.push(roof);
  // Benches where the pews were.
  for (const p of PEWS) {
    scene.add(plank(p.w, 0.08, p.d, p.x + p.w / 2, 0.48, p.z + p.d / 2, 0x9a7a52));
    for (const ox of [0.2, p.w - 0.2]) scene.add(slab(0.08, 0.44, p.d - 0.06, std(STEEL_DARK, 0.6, 0.3), p.x + ox, 0.24, p.z + p.d / 2));
  }
  // The console where the altar was: a desk, three screens glowing green, a speaker, a microphone.
  const [ax, az] = ALTAR;
  scene.add(slab(1.6, 0.85, 0.8, std(OLIVE, 0.7, 0.2), ax, 0.43, az), slab(1.7, 0.06, 0.9, std(STEEL_DARK, 0.5, 0.4), ax, 0.88, az));
  const screen = label("~/\\/\\~", 1.2, 0.6, "#062006", "#5aff5a", true);
  for (const [k, ox] of [-0.52, 0, 0.52].entries()) {
    scene.add(slab(0.46, 0.42, 0.36, std(0x3a3a34, 0.6, 0.2), ax + ox, 1.13 + (k === 1 ? 0.06 : 0), az + 0.12));
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(0.38, 0.3), new THREE.MeshStandardMaterial({ color: 0x0a1a0a, emissive: 0xffffff, emissiveMap: screen, emissiveIntensity: 1.6 }));
    glass.position.set(ax + ox, 1.13 + (k === 1 ? 0.06 : 0), az - 0.065); glass.rotation.y = Math.PI; scene.add(glass);
    if (k === 1) flicker(glass, null, 1, 9);
  }
  scene.add(slab(0.5, 0.7, 0.4, std(0x2a2826, 0.8), ax + 1.2, 0.35, az + 0.1), cyl(0.15, 0.15, 0.04, std(0x111111, 0.9), ax + 1.2, 0.5, az - 0.11, 12).rotateX(Math.PI / 2));
  scene.add(lamp(TOXIC, 4, 5, ax, 1.6, az - 1));
  // The mast: four legs tapering up, braced, a dish, the light blinking at the top.
  const { x: tx, z: tz, s } = TOWER, mx = tx + s / 2, mz = tz + s / 2, top = 10;
  const mast = new THREE.Group(), legMat = std(0xb04a30, 0.55, 0.4);
  const strut = (ax0: number, ay: number, az0: number, bx: number, by: number, bz: number, r: number) => {
    const a = new THREE.Vector3(ax0, ay, az0), b = new THREE.Vector3(bx, by, bz), len = a.distanceTo(b), m = cyl(r, r, len, legMat, 0, 0, 0, 6);
    m.position.copy(a).add(b).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()); mast.add(m);
  };
  const half = (y: number) => (s / 2) * (1 - (y / top) * 0.8);
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [cx, cz] of corners) strut(mx + cx * half(0), 0, mz + cz * half(0), mx + cx * half(top), top, mz + cz * half(top), 0.06);
  for (let y = 0; y < top - 0.5; y += 1.25) for (let k = 0; k < 4; k++) {
    const [ax1, az1] = corners[k], [bx1, bz1] = corners[(k + 1) % 4];
    strut(mx + ax1 * half(y), y, mz + az1 * half(y), mx + bx1 * half(y + 1.25), y + 1.25, mz + bz1 * half(y + 1.25), 0.025);
    strut(mx + ax1 * half(y + 1.25), y + 1.25, mz + az1 * half(y + 1.25), mx + bx1 * half(y + 1.25), y + 1.25, mz + bz1 * half(y + 1.25), 0.025);
  }
  const beacon = glowBox(0.2, 0.2, 0.2, NEON, mx, top + 0.1, mz, 3);
  const bmat = beacon.material as THREE.MeshLambertMaterial;
  beacon.onBeforeRender = () => { bmat.emissiveIntensity = Math.sin(performance.now() / 420) > 0.2 ? 3 : 0.15; };
  const dish = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 6, 0, Math.PI * 2, 0, Math.PI / 3.2), std(0xd8d4cc, 0.5, 0.3)); dish.material.side = THREE.DoubleSide;
  dish.position.set(mx + 0.4, 6.5, mz); dish.rotation.z = -1.6; mast.add(dish, beacon);
  scene.add(mast);
}

/** The Mess: sheet walls west, east and back, open to the north, a shed roof with a stovepipe, and barrel grills where
 *  the town has its grills, coals glowing. */
function mess(scene: THREE.Object3D, roofs: THREE.Object3D[]) {
  const { x, z, w, d, h } = KITCHEN, t = 0.3, wall = (m: THREE.Mesh) => { m.userData.wall = true; scene.add(m); };
  sheets(wall, x + t / 2, z, x + t / 2, z + d, h, 71, 0.08, t); sheets(wall, x + w - t / 2, z, x + w - t / 2, z + d, h, 72, 0.08, t);
  sheets(wall, x, z + d - t / 2, x + w, z + d - t / 2, h, 73, 0.08, t);
  for (const px of [x + 0.15, x + w - 0.15]) scene.add(slab(0.16, h + 0.3, 0.16, std(STEEL_DARK, 0.5, 0.4), px, (h + 0.3) / 2, z));
  scene.add(slab(w - 0.4, 0.06, d - 0.4, textured(CONCRETE_TEX, 0x8a867c, 3, 3, 1), x + w / 2, 0.11, z + d / 2));
  const roof = new THREE.Group(), depth = d + 0.6, rise = 0.6, len = Math.hypot(depth, rise), n = Math.ceil((w + 0.6) / 1.05);
  for (let i = 0; i < n; i++) {
    const sw = (w + 0.6) / n + 0.04, k = rnd(x + i * 2.7), m = roofSheet(sw, len, SHEET_TINTS[Math.floor(k * SHEET_TINTS.length)]); m.position.set(x - 0.3 + (i + 0.5) * ((w + 0.6) / n), h + 0.45, z + d / 2);
    m.rotation.x = -Math.atan2(rise, depth); roof.add(m);
  }
  roof.add(cyl(0.16, 0.16, 1.6, std(0x2a2826, 0.5, 0.5), x + w / 2, h + 1.1, z + d - 0.7, 10));
  roof.userData.roof = true; scene.add(roof); roofs.push(roof);
  // The sign over the open front.
  const tex = label("MESS", 1.8, 0.5, "#3a2a1a", "#f0d8a0"), sign = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.5), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }));
  sign.position.set(x + w / 2, h + 0.1, z - 0.02); sign.rotation.y = Math.PI; scene.add(sign);
  for (const [gx, gz] of GRILLS) {
    // An oil drum cut lengthways on legs, a grate over glowing coals, a pot on one.
    // Half a cylinder turned on its side, open to the sky.
    const g = new THREE.Group(), legs = std(STEEL_DARK, 0.5, 0.4);
    const drum = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 1.1, 16, 1, true, 0, Math.PI), textured(CORRUGATED, 0x6a7a6a, 2, 1, 0.6, 0.3));
    drum.material.side = THREE.DoubleSide; drum.rotation.z = -Math.PI / 2; g.add(drum);
    for (const ox of [-0.4, 0.4]) for (const oz of [-0.25, 0.25]) g.add(slab(0.05, 0.8, 0.05, legs, ox, -0.4, oz));
    const coals = glowBox(0.95, 0.06, 0.6, 0xff6a20, 0, -0.18, 0, 1.6); g.add(coals);
    for (let k = 0; k < 6; k++) g.add(slab(0.02, 0.02, 0.62, std(0x222222, 0.6, 0.5), -0.4 + k * 0.16, 0.01, 0));
    g.position.set(gx, 0.82, gz); scene.add(g); flicker(coals, null, 1, gx);
  }
  scene.add(lamp(0xff7a30, 6, 6, x + w / 2, 1.4, GRILLS[0][1] - 0.4));
}

// ---------- the square, the stations, the outskirts ----------

/** The water tower over the square's cistern: a concrete ring of murky water, four braced legs, a tank of riveted
 *  sheet with a conical cap, a ladder, a pipe down to the cistern. The tank fades like a wall when it's in the way. */
function waterTower(scene: THREE.Object3D) {
  const ring = cyl(1.6, 1.75, 0.5, textured(CONCRETE_TEX, CONCRETE, 3, 0.4, 0.95), CX, 0.33, CZ, 24); scene.add(ring);
  scene.add(cyl(1.35, 1.35, 0.52, std(0x2c3a14, 0.3), CX, 0.35, CZ, 24));
  scene.add(fountainWater(CX, CZ, 1.33, 24, 0x3a5a14, 0x8ac040, 0x9ac060, 2.5));
  const legH = 6, legMat = std(STEEL_DARK, 0.55, 0.45), tank = new THREE.Group();
  for (const [ox, oz] of [[-1.1, -1.1], [1.1, -1.1], [1.1, 1.1], [-1.1, 1.1]]) scene.add(slab(0.16, legH, 0.16, legMat, CX + ox, legH / 2, CZ + oz));
  for (const y of [2.2, 4.4]) for (const [ox, oz, w, d] of [[0, -1.1, 2.2, 0.06], [0, 1.1, 2.2, 0.06], [-1.1, 0, 0.06, 2.2], [1.1, 0, 0.06, 2.2]]) scene.add(slab(w, 0.08, d, legMat, CX + ox, y, CZ + oz));
  const body = cyl(1.55, 1.55, 2.0, textured(CORRUGATED, 0xb08868, 5, 1, 0.6, 0.3), CX, legH + 1.05, CZ, 28); body.userData.wall = true; tank.add(body);
  const cap = new THREE.Mesh(new THREE.ConeGeometry(1.7, 0.9, 28), std(RUST, 0.6, 0.35)); cap.position.set(CX, legH + 2.5, CZ); cap.userData.wall = true; tank.add(cap);
  const band = cyl(1.58, 1.58, 0.3, std(0x2e5a52, 0.7, 0.2), CX, legH + 1.4, CZ, 28); band.userData.wall = true; tank.add(band);
  scene.add(tank, slab(1.6, 0.08, 1.6, legMat, CX, legH, CZ));
  // The ladder up the south leg, and the pipe down to the spout.
  for (const ox of [-0.18, 0.18]) scene.add(slab(0.04, legH, 0.04, legMat, CX + 1.1 + ox, legH / 2, CZ + 1.28));
  for (let y = 0.4; y < legH; y += 0.35) scene.add(slab(0.4, 0.03, 0.03, legMat, CX + 1.1, y, CZ + 1.28));
  scene.add(cyl(0.11, 0.11, legH - 1.3, std(RUST_DARK, 0.6, 0.4), CX, 1.3 + (legH - 1.3) / 2, CZ, 10), cyl(0.18, 0.12, 0.3, std(RUST_DARK, 0.6, 0.4), CX, 1.45, CZ, 10));
}

/** A weld bench at each anvil: a steel table, a vise, a plate being joined, a torch's blue-white spark flickering. */
function weldBench(scene: THREE.Object3D, x: number, z: number, k: number) {
  const g = new THREE.Group(), y = heightAt(x, z);
  g.add(box(0.96, 0.08, 0.42, 0x4a4e52, x, y + 0.85, z));
  for (const [ox, oz] of [[-0.42, -0.16], [0.42, -0.16], [-0.42, 0.16], [0.42, 0.16]]) g.add(box(0.06, 0.82, 0.06, 0x2e3236, x + ox, y + 0.42, z + oz));
  g.add(box(0.2, 0.16, 0.14, 0x3a5a7a, x - 0.32, y + 0.97, z), box(0.5, 0.03, 0.3, 0x8a8e92, x + 0.1, y + 0.905, z));
  g.add(box(0.8, 0.04, 0.3, 0x2e3236, x, y + 0.25, z), box(0.3, 0.12, 0.2, 0x8a2a20, x + 0.2, y + 0.33, z));
  bake(g, scene);
  const spark = glowBox(0.07, 0.07, 0.07, 0xc8e0ff, x + 0.12, y + 0.94, z + 0.05, 4); scene.add(spark);
  const m = spark.material as THREE.MeshLambertMaterial;
  spark.onBeforeRender = () => { const t = performance.now() / 1000; m.emissiveIntensity = rnd(Math.floor(t * 18) + k * 31) > 0.45 ? 5 : 0.2; };
}

/** A heap of scrap: sheets, drums, pipes, a tyre, piled up, each piece its own angle. */
function scrapHeap(scene: THREE.Object3D, x: number, z: number) {
  const g = new THREE.Group(), y = heightAt(x, z), tints = [RUST, STEEL, OLIVE, 0x8a6a4a, RUST_DARK, 0x6a6e5a];
  for (let i = 0; i < 16; i++) {
    const a = rnd(x * 3 + i), b = rnd(z * 5 + i * 1.3), c = rnd(x + z + i * 2.1), px = x + (a - 0.5) * 0.9, pz = z + (b - 0.5) * 0.8, py = y + 0.12 + (1 - Math.hypot(a - 0.5, b - 0.5) * 1.6) * 0.8 * c;
    const kind = i % 4, color = tints[i % tints.length];
    const m = kind === 0 ? new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.5, 10), std(color, 0.7, 0.3)) : kind === 1 ? new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.9, 6), std(STEEL, 0.5, 0.5)) : kind === 2 ? new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.08, 6, 12), std(TIRE, 0.95)) : new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.4), std(color, 0.7, 0.25));
    m.position.set(px, Math.max(y + 0.1, py), pz); m.rotation.set(a * 3, b * 3, c * 3); g.add(m);
  }
  scene.add(g);
}

/** Dead trees: bare and grey where the town has oaks, a stripped conifer for a pine, glowing reeds by the creek where
 *  willows grow, black stumps in the Badlands. */
const BARK = std(0x4a4038, 0.95), CHARRED = std(CHAR, 1), REED = std(0x5a6a2a, 0.9);
function deadTree({ x, z, s, kind }: Tree) {
  const g = new THREE.Group(), y = heightAt(x, z);
  const limb = (x0: number, y0: number, z0: number, len: number, r: number, tilt: number, turn: number, mat: THREE.Material) => {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.45, r, len, 6), mat), dir = new THREE.Vector3(Math.sin(tilt) * Math.cos(turn), Math.cos(tilt), Math.sin(tilt) * Math.sin(turn));
    m.position.set(x0, y0, z0).addScaledVector(dir, len / 2); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir); g.add(m);
    return new THREE.Vector3(x0, y0, z0).addScaledVector(dir, len);
  };
  if (kind === "willow") {
    for (let i = 0; i < 7; i++) {
      const a = rnd(x * 3 + i) * Math.PI * 2, r = rnd(z + i) * 0.35, tip = limb(x + Math.cos(a) * r, y, z + Math.sin(a) * r, (0.9 + rnd(i + x) * 0.7) * s, 0.03, (rnd(i * 2 + z) - 0.5) * 0.4, a, REED);
      if (i % 2 === 0) g.add(glowing(new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), std(0x9aff5a, 0.5)), TOXIC, 1.6).translateX(tip.x).translateY(tip.y).translateZ(tip.z));
    }
    return g;
  }
  if (kind === "dead") {
    const top = limb(x, y, z, (0.6 + rnd(x) * 1.6) * s, 0.2 * s, (rnd(z) - 0.5) * 0.3, rnd(x * z), CHARRED);
    if (rnd(x + z) > 0.5) limb(top.x, top.y - 0.2, top.z, 0.6 * s, 0.07, 1.0, rnd(z) * 6, CHARRED);
    return g;
  }
  if (kind === "pine") {
    const top = limb(x, y, z, 3.0 * s, 0.14 * s, (rnd(x) - 0.5) * 0.12, 0, BARK);
    for (let k = 0; k < 7; k++) limb(x + (top.x - x) * (k / 8), y + (top.y - y) * (0.3 + k * 0.09), z + (top.z - z) * (k / 8), (0.6 - k * 0.06) * s, 0.03, 1.7, rnd(x * 3 + k) * Math.PI * 2, BARK);
    return g;
  }
  const trunk = limb(x, y, z, 1.6 * s, 0.2 * s, (rnd(x) - 0.5) * 0.25, rnd(z) * 6, BARK);
  for (let k = 0; k < 4; k++) {
    const t = limb(trunk.x, trunk.y - k * 0.15, trunk.z, (0.8 + rnd(x + k) * 0.6) * s, 0.08 * s, 0.6 + rnd(z + k) * 0.5, (k / 4) * Math.PI * 2 + rnd(x), BARK);
    limb(t.x, t.y, t.z, 0.5 * s, 0.035 * s, 0.4 + rnd(k * 9 + z) * 0.6, (k / 4) * Math.PI * 2 + 1, BARK);
  }
  return g;
}

/** A wrecked car: a rusted body, the cabin caved, wheels gone or flat, glass long gone. */
function wreck(x: number, z: number, turn: number, seed: number) {
  const g = new THREE.Group(), body = [RUST, 0x6a5a48, 0x5a6a6a, 0x8a5a3a][Math.floor(rnd(seed) * 4)];
  g.add(slab(2.1, 0.45, 0.95, textured(CORRUGATED, body, 1, 0.3, 0.7, 0.25), 0, 0.42, 0));
  g.add(slab(1.0, 0.36, 0.86, std(body, 0.75, 0.2), -0.1, 0.82, 0), slab(0.04, 0.32, 0.8, std(0x0a0a0a, 0.4), 0.42, 0.8, 0));
  g.add(slab(0.5, 0.2, 0.9, std(0x2a2826, 0.7, 0.4), 0.85, 0.36, 0));
  for (const [ox, oz] of [[-0.7, 0.48], [0.7, 0.48], [-0.7, -0.48], [0.7, -0.48]]) if (rnd(seed + ox * oz * 7) > 0.3) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.16, 12), std(TIRE, 0.95)); w.rotation.x = Math.PI / 2; w.position.set(ox, 0.2, oz); g.add(w);
  }
  g.position.set(x, heightAt(x, z) - 0.1, z); g.rotation.set((rnd(seed * 3) - 0.5) * 0.15, turn, (rnd(seed * 7) - 0.5) * 0.12);
  return g;
}

/** A drum, rusted or painted, now and then one leaking something that glows. */
function drum(x: number, z: number, seed: number) {
  const g = new THREE.Group(), y = heightAt(x, z), tox = rnd(seed) > 0.75;
  g.add(cyl(0.3, 0.3, 0.86, textured(CORRUGATED, tox ? 0xd0b030 : [RUST, 0x4a6a8a, OLIVE][Math.floor(rnd(seed * 3) * 3)], 1.5, 0.6, 0.6, 0.3), x, y + 0.43, z, 14));
  if (tox) { const pool = new THREE.Mesh(new THREE.CircleGeometry(0.5, 14), std(0x5ac02a, 0.3)); glowing(pool, TOXIC, 0.9); pool.rotation.x = -Math.PI / 2; pool.position.set(x + 0.4, y + 0.03, z + 0.2); g.add(pool); }
  return g;
}

/** Dry grass in tufts and stones over the open ground, drawn as instances: hundreds for the price of two. */
function scrub(scene: THREE.Object3D) {
  const spots: [number, number][] = [];
  for (let i = 0; i < 2600 && spots.length < 900; i++) {
    const x = 0.5 + rnd(i * 3.7 + 1) * (W - 1), z = Z0 + 1 + rnd(i * 9.1 + 2) * (H - Z0 - 2), t = tileAt(x, z);
    if ((t !== "g" && t !== "k") || buildingAt(x, z) || nearChapel(x, z) || nearKitchen(x, z) || Math.hypot(x - CX, z - CZ) < 2.4) continue;
    if ([-0.5, 0.5].some((o) => tileAt(x + o, z) === "p" || tileAt(x, z + o) === "p" || tileAt(x + o, z) === "w")) continue;
    spots.push([x, z]);
  }
  const tuft = new THREE.InstancedMesh(new THREE.ConeGeometry(0.1, 0.42, 4), new THREE.MeshStandardMaterial({ roughness: 1 }), spots.length);
  const stone = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(0.16, 0), new THREE.MeshStandardMaterial({ roughness: 0.95 }), spots.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), c = new THREE.Color();
  spots.forEach(([x, z], i) => {
    const s = 0.6 + rnd(i * 1.3) * 0.9, y = heightAt(x, z);
    e.set((rnd(i * 2.1) - 0.5) * 0.5, rnd(i) * 6, (rnd(i * 3.1) - 0.5) * 0.5); q.setFromEuler(e);
    m.compose(new THREE.Vector3(x, y + 0.18 * s, z), q, new THREE.Vector3(s, s, s)); tuft.setMatrixAt(i, m);
    tuft.setColorAt(i, c.setHSL(0.1 + rnd(i * 5) * 0.04, 0.35 + rnd(i * 7) * 0.2, 0.36 + rnd(i * 11) * 0.16));
    m.compose(new THREE.Vector3(x + 0.6 * (rnd(i * 13) - 0.5), y + 0.05, z + 0.6 * (rnd(i * 17) - 0.5)), q, new THREE.Vector3(s, s * 0.6, s)); stone.setMatrixAt(i, m);
    stone.setColorAt(i, c.setHSL(0.07, 0.12, 0.3 + rnd(i * 19) * 0.2));
  });
  for (const im of [tuft, stone]) { im.castShadow = true; im.receiveShadow = true; im.raycast = () => {}; scene.add(im); }
}

/** Dust drifting through the light: specks that wander slowly round where you are. */
function dust(scene: THREE.Object3D) {
  const n = 700, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { pos[i * 3] = rnd(i * 1.1) * W; pos[i * 3 + 1] = 0.3 + rnd(i * 2.3) * 6; pos[i * 3 + 2] = Z0 + rnd(i * 3.7) * (H - Z0); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const pts = new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xf0d0a0, size: 0.07, transparent: true, opacity: 0.55, depthWrite: false }));
  pts.raycast = () => {};
  pts.onBeforeRender = () => { const t = performance.now() / 1000; pts.position.set(Math.sin(t * 0.07) * 3, Math.sin(t * 0.3) * 0.2, Math.cos(t * 0.05) * 2); };
  scene.add(pts);
}

/** Every work station, as outpost work. */
function stations(scene: THREE.Object3D, still: THREE.Object3D) {
  ANVILS.forEach(([x, z], k) => weldBench(scene, x, z, k));
  // The smelter: a drum on its side over a firebox of bricks, its mouth glowing, a stack up from it.
  const [fx, fz] = FURNACE, fy = heightAt(fx, fz);
  for (let i = 0; i < 6; i++) still.add(box(0.5, 0.3, 0.4, 0x7a3a2a, fx - 0.75 + (i % 3) * 0.75, fy + 0.15 + Math.floor(i / 3) * 0.3, fz + (i % 2 ? 0.25 : -0.25)));
  const smelter = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 1.9, 18), textured(CORRUGATED, 0x5a4a40, 3, 1.5, 0.6, 0.3)); smelter.rotation.z = Math.PI / 2; smelter.position.set(fx, fy + 1.15, fz); scene.add(smelter);
  const mouth = glowing(new THREE.Mesh(new THREE.CircleGeometry(0.5, 18), std(0xff7a20)), 0xff6a10, 2.2); mouth.position.set(fx + 0.96, fy + 1.15, fz); mouth.rotation.y = Math.PI / 2; scene.add(mouth);
  scene.add(cyl(0.16, 0.16, 2.6, std(0x2a2826, 0.5, 0.5), fx - 0.5, fy + 2.9, fz, 10));
  const forge = lamp(0xff7020, 9, 7, fx + 1.4, fy + 1.2, fz); scene.add(forge); flicker(mouth, forge, 1, 5);
  ROCKS.forEach(([x, z]) => scrapHeap(scene, x, z));
  // The tinker benches: planks on trestles, each with its own job on it.
  for (const w of WORKSHOP) {
    const { x, z } = w, y = heightAt(x, z);
    scene.add(plank(1.1, 0.07, 0.6, x, y + 0.8, z, 0xb08a5a));
    for (const ox of [-0.42, 0.42]) still.add(box(0.06, 0.78, 0.5, 0x3a3e42, x + ox, y + 0.39, z));
    if (w.kind === "bench") still.add(box(0.4, 0.18, 0.2, 0xa82a1a, x - 0.2, y + 0.92, z), box(0.3, 0.04, 0.05, 0x8a8e92, x + 0.25, y + 0.85, z));
    if (w.kind === "spinning") { const spool = cyl(0.2, 0.2, 0.3, std(0xb87333, 0.4, 0.7), x, y + 1.0, z, 16); spool.rotation.z = Math.PI / 2; scene.add(spool); }
    if (w.kind === "pottery") { still.add(box(0.3, 0.2, 0.25, 0x3a5a3a, x, y + 0.94, z)); const wheel = cyl(0.18, 0.18, 0.04, std(0x9a9a9a, 0.4, 0.6), x + 0.18, y + 1.0, z, 16); wheel.rotation.x = Math.PI / 2; scene.add(wheel); }
    if (w.kind === "loom") { still.add(box(0.5, 0.3, 0.3, 0x5a4a3a, x, y + 0.99, z), box(0.02, 0.4, 0.02, 0x8a8e92, x + 0.2, y + 1.34, z)); scene.add(glowBox(0.08, 0.12, 0.08, 0xffa040, x - 0.1, y + 1.18, z, 1.5)); }
  }
  // Rebuilding: a slab, scaffolding of pipe, half the sheets up, a stack waiting.
  const { x: sx, z: sz, w: sw, d: sd } = SITE, sy = heightAt(sx + sw / 2, sz + sd / 2);
  scene.add(slab(sw, 0.12, sd, textured(CONCRETE_TEX, 0x9a958a, 3, 2, 1), sx + sw / 2, sy + 0.06, sz + sd / 2));
  const pipe = std(0x8a8e92, 0.45, 0.6);
  for (const px of [sx + 0.1, sx + sw / 2, sx + sw - 0.1]) for (const pz of [sz + 0.1, sz + sd - 0.1]) scene.add(slab(0.06, 2.8, 0.06, pipe, px, sy + 1.4, pz));
  for (const py of [1.2, 2.5]) for (const pz of [sz + 0.1, sz + sd - 0.1]) scene.add(slab(sw, 0.05, 0.05, pipe, sx + sw / 2, sy + py, pz));
  for (const py of [1.2, 2.5]) scene.add(plank(sw - 0.3, 0.05, 0.5, sx + sw / 2, sy + py + 0.05, sz + 0.4, 0xa88a5a));
  sheets((m) => scene.add(m), sx + 0.1, sz + 0.1, sx + sw * 0.55, sz + 0.1, 2.2, 91, sy + 0.12, 0.1);
  for (let k = 0; k < 5; k++) scene.add(slab(1.0, 0.04, 2.0, textured(CORRUGATED, SHEET_TINTS[k % SHEET_TINTS.length], 1, 1, 0.6, 0.25), sx + sw - 1, sy + 0.16 + k * 0.05, sz + sd / 2).rotateY(k * 0.05));
  // The burn barrel: a drum, holes punched, fire licking out of it.
  const [bx, bz] = BONFIRE, by = heightAt(bx, bz);
  scene.add(cyl(0.38, 0.38, 0.95, textured(CORRUGATED, 0x6a3a22, 2, 0.7, 0.7, 0.3), bx, by + 0.48, bz, 16));
  const fire = new THREE.Group(), flames: THREE.Mesh[] = [];
  for (let k = 0; k < 5; k++) {
    const f = glowing(new THREE.Mesh(new THREE.ConeGeometry(0.14 + rnd(k) * 0.08, 0.5 + rnd(k * 3) * 0.3, 6), new THREE.MeshStandardMaterial({ color: 0xffa040, transparent: true, opacity: 0.85 })), k % 2 ? 0xff5010 : 0xffa020, 2.4);
    f.position.set(bx + Math.cos(k * 1.3) * 0.18, by + 1.1, bz + Math.sin(k * 1.3) * 0.18); fire.add(f); flames.push(f);
  }
  const barrel = lamp(0xff6a20, 10, 8, bx, by + 1.6, bz); scene.add(fire, barrel);
  flicker(flames[0], barrel, 1, 11);
  flames.forEach((f, k) => { const prev = f.onBeforeRender; f.onBeforeRender = (...a) => { prev.apply(f, a); const t = performance.now() / 1000; f.scale.y = 0.8 + Math.sin(t * 9 + k * 2) * 0.25; f.rotation.y = t * (1 + k * 0.3); }; });
  // The Bounty board: plywood on two pipes under a lean-to of sheet, its name painted across the top.
  const { x, z, w } = BOARD, y = heightAt(x, z);
  for (const px of [x - w / 2 + 0.1, x + w / 2 - 0.1]) scene.add(cyl(0.07, 0.07, 3.0, pipe, px, y + 1.5, z, 8));
  scene.add(plank(w - 0.1, 1.7, 0.1, x, y + 1.65, z, 0xc8a878));
  const head = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 0.36), new THREE.MeshStandardMaterial({ map: label("BOUNTIES", 1.8, 0.36, "#2a2620", "#e8c050"), roughness: 0.8 }));
  head.position.set(x, y + 2.68, z + 0.07); scene.add(head);
  const awning = slab(w + 0.5, 0.05, 0.9, textured(CORRUGATED, 0xc89878, w, 0.5, 0.6, 0.25), x, y + 3.05, z + 0.25); awning.rotation.x = 0.25; scene.add(awning);
}

/** Chain-link round the scrap heaps and the deadwood: pipe posts, a top rail, wire between, barbed strands over. */
function chainFences(scene: THREE.Object3D) {
  const post = std(0x8a8e92, 0.45, 0.6);
  for (const [x1, z1, x2, z2] of FENCES) {
    const len = Math.hypot(x2 - x1, z2 - z1), n = Math.max(1, Math.round(len / 2.2)), ang = Math.atan2(x2 - x1, z2 - z1);
    for (let i = 0; i <= n; i++) { const px = x1 + ((x2 - x1) * i) / n, pz = z1 + ((z2 - z1) * i) / n; scene.add(cyl(0.05, 0.05, 1.5, post, px, heightAt(px, pz) + 0.75, pz, 8)); }
    const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2, y = (heightAt(x1, z1) + heightAt(x2, z2)) / 2;
    const t = CHAINLINK.clone(); t.repeat.set(len / 0.25, 1.4 / 0.25); t.needsUpdate = true;
    const wire = new THREE.Mesh(new THREE.PlaneGeometry(len, 1.4), new THREE.MeshStandardMaterial({ map: t, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.6 }));
    wire.position.set(mx, y + 0.75, mz); wire.rotation.y = ang + Math.PI / 2; wire.raycast = () => {}; scene.add(wire);
    const rail = slab(0.04, 0.04, len, post, mx, y + 1.45, mz); rail.rotation.y = ang; scene.add(rail);
    const barb = slab(0.015, 0.015, len, std(0x5a5a5a, 0.5, 0.6), mx, y + 1.6, mz); barb.rotation.y = ang; scene.add(barb);
  }
}

/** Arrow boards at the crossroads, sodium lamps round the square, and the Badlands' warning. */
function signsAndLamps(scene: THREE.Object3D, still: THREE.Object3D) {
  for (const [x, z, face] of SIGNS) {
    const g = new THREE.Group();
    g.add(box(0.12, 1.8, 0.12, 0x5a5048, 0, 0.9, 0), box(0.9, 0.22, 0.05, 0xa88a5a, 0.32, 1.5, 0), box(0.8, 0.2, 0.05, 0x8a7a5a, -0.28, 1.18, 0.02), box(0.7, 0.2, 0.05, 0xb05a3a, 0.2, 0.88, -0.02));
    g.position.set(x, heightAt(x, z), z); g.rotation.y = face; still.add(g);
  }
  for (const [x, z] of LAMPS) {
    const y = heightAt(x, z), toward = Math.sign(CX - x);
    scene.add(cyl(0.06, 0.09, 3.4, std(0x3a3e42, 0.5, 0.5), x, y + 1.7, z, 8), slab(0.9, 0.06, 0.08, std(0x3a3e42, 0.5, 0.5), x + toward * 0.4, y + 3.35, z));
    const head = glowing(slab(0.36, 0.1, 0.22, std(0xffd090)), SODIUM, 2.6); head.position.set(x + toward * 0.8, y + 3.28, z); scene.add(head);
    const l = lamp(SODIUM, 14, 11, x + toward * 0.8, y + 3.0, z); scene.add(l);
    flicker(head, l, 1, x * z);
  }
  const [sx, sz] = WILD_SIGN, sy = heightAt(sx, sz);
  still.add(box(0.12, 2.0, 0.12, 0x3a3e42, sx - 0.5, sy + 1.0, sz), box(0.12, 2.0, 0.12, 0x3a3e42, sx + 0.5, sy + 1.0, sz));
  const warn = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.7), new THREE.MeshStandardMaterial({ map: label("KEEP OUT", 1.5, 0.7, "#e0b020", "#1a1714"), roughness: 0.7, side: THREE.DoubleSide }));
  warn.position.set(sx, sy + 1.65, sz); scene.add(warn);
}

/** The Badlands and the outskirts: wrecked cars, drums, jersey barriers, bones. */
function outskirts(scene: THREE.Object3D) {
  const duel = (x: number, z: number) => x > 12 && x < 35.5 && z > -16 && z < -4.5;
  let cars = 0, drums = 0;
  for (let i = 0; i < 400 && (cars < 9 || drums < 16); i++) {
    const x = 2 + rnd(i * 5.9 + 3) * (W - 4), z = Z0 + 2 + rnd(i * 7.3 + 1) * (H - Z0 - 4), t = tileAt(x, z);
    if (t !== "k" && t !== "g") continue;
    if (duel(x, z) || buildingAt(x, z) || nearChapel(x, z) || nearKitchen(x, z) || Math.hypot(x - CX, z - CZ) < 9) continue;
    if ([-1.4, 1.4].some((o) => tileAt(x + o, z) !== t || tileAt(x, z + o) !== t)) continue;
    if ([...ANVILS, FURNACE, ...ROCKS, BONFIRE, ...GRILLS, ...WORKSHOP.map((w) => [w.x, w.z] as [number, number]), ...TREES.map((tr) => [tr.x, tr.z] as [number, number])].some(([px, pz]) => Math.hypot(x - px, z - pz) < 2.6)) continue;
    if (x > SITE.x - 2 && x < SITE.x + SITE.w + 2 && z > SITE.z - 2 && z < SITE.z + SITE.d + 2) continue;
    if (cars < 9 && (t === "k" || i % 3 === 0)) { scene.add(wreck(x, z, rnd(i) * 6, i)); cars++; }
    else if (drums < 16) { scene.add(drum(x, z, i)); drums++; }
  }
  // Barriers where the road leaves for the Badlands, and bones about.
  for (const ox of [-2.6, 2.6]) {
    const bx = WILD_SIGN[0] + 1.9 + ox, bz = WILD_Z + 0.2, g = new THREE.Group();
    g.add(slab(1.6, 0.3, 0.6, textured(CONCRETE_TEX, CONCRETE, 1, 0.3, 0.95), 0, 0.15, 0), slab(1.6, 0.5, 0.25, textured(CONCRETE_TEX, CONCRETE, 1, 0.3, 0.95), 0, 0.55, 0));
    g.position.set(bx, heightAt(bx, bz), bz); g.rotation.y = ox * 0.05; scene.add(g);
  }
  const bones = new THREE.Group();
  for (let i = 0; i < 40; i++) {
    const x = 1 + rnd(i * 6.1 + 11) * (W - 2), z = Z0 + 1 + rnd(i * 8.3 + 4) * (-Z0 - 2);
    if (tileAt(x, z) !== "k" || duel(x, z)) continue;
    const y = heightAt(x, z), b = box(0.5, 0.07, 0.09, BONE, x, y + 0.05, z); b.rotation.y = rnd(i * 5) * 3; bones.add(b, box(0.14, 0.12, 0.14, BONE, x + 0.28, y + 0.07, z));
  }
  bake(bones, scene);
}

/** Furniture the outpost draws its own way: lockers for trophy cases, a generator and a robot on the plinths, a blast
 *  door for the vault, crates of salvage for the gold. */
const OWN = new Set(["trophycase", "cup", "statue", "vault", "gold"]);
function ownFurniture(scene: THREE.Object3D) {
  for (const f of FURNITURE) {
    if (!OWN.has(f.kind)) continue;
    const x = f.x + f.w / 2, z = f.z + f.d / 2, g = new THREE.Group();
    if (f.kind === "trophycase") for (let k = 0; k < 4; k++) {
      const lx = f.x + 0.3 + k * 0.58, tint = [0x5a6a6a, 0x6a5a48, 0x4a5a4a, 0x5a6a6a][k];
      g.add(slab(0.55, 1.9, f.d, std(tint, 0.55, 0.35), lx, 1.03, z));
      for (let v = 0; v < 3; v++) g.add(slab(0.3, 0.025, 0.01, std(0x1a1a1a), lx, 1.7 - v * 0.06, z + f.d / 2 + 0.005));
      g.add(slab(0.04, 0.12, 0.03, std(0xb8b8b0, 0.3, 0.8), lx + 0.18, 1.1, z + f.d / 2 + 0.02));
    }
    if (f.kind === "cup") {
      // A generator: a yellow block on skids, the engine's drum, a dial glowing green.
      g.add(slab(0.7, 0.08, 0.7, std(STEEL_DARK, 0.5, 0.4), x, 0.12, z), slab(0.6, 0.5, 0.55, std(0xc89a2a, 0.6, 0.2), x, 0.42, z));
      const eng = cyl(0.18, 0.18, 0.5, std(0x2a2826, 0.5, 0.5), x, 0.8, z, 12); eng.rotation.z = Math.PI / 2; g.add(eng, glowBox(0.1, 0.1, 0.02, TOXIC, x, 0.5, z + 0.28, 1.6));
    }
    if (f.kind === "statue") {
      // A robot, long switched off: a boxy body on treads, a domed head, an aerial, its eyes still faintly lit.
      g.add(slab(0.6, 0.16, 0.5, std(0x2a2826, 0.8), x, 0.1, z), slab(0.46, 0.6, 0.36, std(0x8a9a9a, 0.4, 0.6), x, 0.5, z));
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), std(0x9aaaaa, 0.35, 0.65)); head.position.set(x, 0.82, z); g.add(head);
      for (const ox of [-0.08, 0.08]) g.add(glowBox(0.06, 0.04, 0.02, 0xff5a3a, x + ox, 0.9, z + 0.18, 1.2));
      for (const ox of [-0.3, 0.3]) g.add(slab(0.08, 0.4, 0.08, std(0x6a7a7a, 0.4, 0.6), x + ox, 0.55, z + 0.05));
      g.add(slab(0.02, 0.3, 0.02, std(STEEL, 0.4, 0.6), x, 1.15, z), glowBox(0.05, 0.05, 0.05, NEON, x, 1.31, z, 0.8));
    }
    if (f.kind === "vault") {
      // A blast door: a thick steel slab, hazard stripes round it, a wheel.
      g.add(slab(1.8, 2.1, 0.12, textured(HAZARD_TEX, 0xffffff, 2, 2.2, 0.6), x, 1.13, z + 0.02), slab(1.45, 1.8, 0.16, std(0x6a6e70, 0.45, 0.6), x, 1.1, z + 0.06));
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.03, 6, 16), std(0x8a2a1a, 0.5, 0.4)); wheel.position.set(x, 1.1, z + 0.18); g.add(wheel);
    }
    if (f.kind === "gold") for (let k = 0; k < 3; k++) g.add(plank(0.5, 0.42 - (k % 2) * 0.1, f.d, f.x + 0.3 + k * 0.52, 0.3, z, 0x7a8050));
    scene.add(g);
  }
}

/** The outpost: the town's layout, its ground, creek, shacks, stations and outskirts, under a hazy sky, lit by a low
 *  sun that casts shadows and lamps and fires that don't. */
function buildOutpost() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(HAZE);
  scene.fog = new THREE.Fog(HAZE, 18, 34);
  scene.add(new THREE.HemisphereLight(0xffdcb0, 0x4a3524, 0.85));
  const sun = new THREE.DirectionalLight(0xffc488, 2.6), mid = new THREE.Vector3(CX, 0, (Z0 + H) / 2);
  sun.position.set(mid.x - 20, 22, mid.z + 12); sun.target.position.copy(mid); scene.add(sun, sun.target);
  sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  Object.assign(sun.shadow.camera, { left: -42, right: 42, top: 42, bottom: -42, near: 1, far: 90 }); sun.shadow.camera.updateProjectionMatrix();
  // The ground: the tiles' colours under grit, mapped across the map so the pattern holds its size.
  const ground = terrain(TILE), geo = ground.geometry, p = geo.attributes.position, uv = new Float32Array(p.count * 2);
  for (let i = 0; i < p.count; i++) { uv[i * 2] = p.getX(i) / 3; uv[i * 2 + 1] = p.getZ(i) / 3; }
  geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  (ground as THREE.Mesh).material = new THREE.MeshStandardMaterial({ vertexColors: true, map: GRIT, roughness: 1 }); ground.receiveShadow = true; scene.add(ground);
  // The creek: sludge that glows.
  const creek = river(0x141c06, 0x4a8a1a); Object.assign(creek.material, { emissive: new THREE.Color(0x3aa010), emissiveIntensity: 0.18 }); scene.add(creek);
  for (const b of BUILDINGS) { scene.add(house(b, { stone: STEEL, floor: 0x5a5048, pane: 0x14110e, lit: 0x000000, roof: () => new THREE.Group(), walls: shackWalls })); shackSign(b, scene); }
  const roofs: THREE.Object3D[] = [];
  for (const b of BUILDINGS) { const r = shackRoof(b); scene.add(r); roofs.push(r); }
  const still = new THREE.Group();
  furniture(still, (f) => OWN.has(f.kind)); innBar(still); ownFurniture(scene);
  relay(scene, roofs); mess(scene, roofs);
  stations(scene, still); waterTower(scene);
  for (const t of TREES) scene.add(deadTree(t));
  chainFences(scene); signsAndLamps(scene, still); outskirts(scene); scrub(scene); dust(scene);
  bake(still, scene);
  shade(scene);
  // Glass, signs, water, wire and dust catch shadow but don't cast it.
  scene.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && ((m.material as THREE.Material).transparent || m.geometry.type === "PlaneGeometry" || m.geometry.type === "CircleGeometry")) m.castShadow = false; });
  ground.castShadow = false; creek.castShadow = false;
  const walls: THREE.Mesh[] = [];
  scene.traverse((o) => { if (o.userData.wall) walls.push(o as THREE.Mesh); });
  return { scene, ground, roofs, walls };
}

// ---------- the scavengers ----------

/** Dusters, jackets and canvas in worn colours, one per agent. */
const COATS = [0x7a4a2a, 0x4e5a3a, 0x6a6a5e, 0x8a6a42, 0x3e4a55, 0x6b3a32, 0x5a5040];
const SKINS = [0xe0b48c, 0xc8936a, 0xeec7a4, 0x8d5b3c, 0xb27d55, 0x6e4430];
const SCARVES = [0xa83a2a, 0xc8a040, 0x3a6a8a, 0x5a7a3a, 0x8a3a6a, 0xd8d0c0];
const HAIR = [0x2a1a10, 0x1a1a1a, 0x7a4a2a, 0xa88040, 0x8a8a8a, 0x4a2a1a];

/** Smooth paint for people, matte and shiny: a figure's parts merge into a mesh or two of each, coloured per vertex. */
const SKIN_PAINT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.78, metalness: 0.02 });
const SHINE_PAINT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.55 });
/** A body part in a colour, for merging: positioned in its figure's own frame. */
const fig = (geo: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0) => {
  const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color })); m.position.set(x, y, z); return m;
};
const ball = (r: number, color: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => { const m = fig(new THREE.SphereGeometry(r, 20, 14), color, x, y, z); m.scale.set(sx, sy, sz); return m; };
const pill = (r: number, len: number, color: number, x: number, y: number, z: number) => fig(new THREE.CapsuleGeometry(r, Math.max(0.001, len), 6, 14), color, x, y, z);
const tube = (r0: number, r1: number, h: number, color: number, x: number, y: number, z: number, seg = 18) => fig(new THREE.CylinderGeometry(r0, r1, h, seg), color, x, y, z);
const ring = (r: number, t: number, color: number, x: number, y: number, z: number) => { const m = fig(new THREE.TorusGeometry(r, t, 8, 28), color, x, y, z); m.rotation.x = Math.PI / 2; return m; };
const cap = (r: number, theta: number, color: number, x: number, y: number, z: number) => { const m = fig(new THREE.SphereGeometry(r, 22, 12, 0, Math.PI * 2, 0, theta), color, x, y, z); return m; };
/** A turned shape, `pts` as [radius, height] from the bottom, flattened front to back like a body. */
const turned = (pts: [number, number][], color: number, y: number, depth = 0.7) => { const m = fig(new THREE.LatheGeometry(pts.map(([r, h]) => new THREE.Vector2(r, h)), 24), color, 0, y, 0); m.scale.z = depth; return m; };
/** A band of cloth round the body's front, `from` to `to` up, `arc` radians wide: an apron, a vest's front. */
const wrap = (r0: number, r1: number, from: number, to: number, arc: number, color: number, front = true) => {
  const m = fig(new THREE.CylinderGeometry(r1, r0, to - from, 20, 1, true, (front ? 0 : Math.PI) - arc / 2, arc), color, 0, (from + to) / 2, 0); m.scale.z = 0.74; return m;
};

/** Parts merged into `into`: the matte ones as one mesh, the shiny ones as another, glowing ones kept as they are. */
function sculpt(into: THREE.Object3D, matte: THREE.Object3D[], shiny: THREE.Object3D[] = []) {
  for (const [parts, paint] of [[matte, SKIN_PAINT], [shiny, SHINE_PAINT]] as const) {
    if (!parts.length) continue;
    const g = new THREE.Group(); g.add(...parts);
    const m = merge(g, into); if (m) { m.material = paint; m.castShadow = true; m.receiveShadow = true; }
  }
  into.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
}

/** A limb: a pivot at the hip or shoulder, the upper part, a joint that bends as the limb swings, the lower part and
 *  what's on the end. Returns the pivot, which is what the World swings. */
function limb(into: THREE.Object3D, x: number, y: number, upper: THREE.Object3D[], lower: THREE.Object3D[], len: number, bend: (swing: number) => number) {
  const pivot = new THREE.Group(), joint = new THREE.Group(); pivot.position.set(x, y, 0); joint.position.y = -len;
  sculpt(pivot, upper); sculpt(joint, lower); pivot.add(joint); into.add(pivot);
  // The knee or elbow follows the swing, set each frame the limb is drawn.
  const first = pivot.children.find((c) => (c as THREE.Mesh).isMesh);
  if (first) first.onBeforeRender = () => { joint.rotation.x = bend(pivot.rotation.x); };
  return pivot;
}

/** What a scavenger has on their head, by number: a wide hat, a hood, goggles, a gas mask, a beanie, or just hair
 *  (for a keeper, whose own hat goes on top). */
type Headgear = 0 | 1 | 2 | 3 | 4 | 5;
const HEAD_Y = 1.41;

/**
 * A scavenger: rounded and in proportion, a face with eyes and a nose, knees and elbows that bend as they walk, boots,
 * gloves, a coat with tails over a belt of pouches, a strap across the chest, a scarf, and by `seed` a hat, hood,
 * goggles, gas mask or beanie and maybe a pack. Feet at 0, the top of the head about 1.55, as the town's people are.
 */
function scavenger(coat: number, legs = 0x3a3428, seed = 0.5, head?: Headgear): Person {
  const g = new THREE.Group(), pick = <T,>(xs: T[], k: number) => xs[Math.floor(rnd(seed * 97 + k) * xs.length)];
  const skin = pick(SKINS, 1), hair = pick(HAIR, 2), scarf = pick(SCARVES, 3), gear = head ?? (Math.floor(rnd(seed * 53) * 5) as Headgear), pack = rnd(seed * 71) > 0.5;
  const dark = new THREE.Color(coat).multiplyScalar(0.62).getHex(), glove = 0x3a2a1c, boot = 0x2e2016, hy = HEAD_Y;
  // Legs: thigh, knee, shin, a boot with a cuff and a sole. The knee bends as the leg swings back.
  const leg = (x: number) => limb(g, x, 0.76, [pill(0.07, 0.24, legs, 0, -0.18, 0), ball(0.062, legs, 0, -0.36, 0)],
    [pill(0.056, 0.24, legs, 0, -0.16, 0), tube(0.064, 0.06, 0.1, boot, 0, -0.29, 0.005), pill(0.055, 0.12, boot, 0, -0.36, 0.04).rotateX(Math.PI / 2), fig(new RoundedBoxGeometry(0.12, 0.025, 0.25, 2, 0.01), 0x14100c, 0, -0.405, 0.045)],
    0.36, (s) => 0.04 + Math.max(0, s) * 1.1);
  // Arms: sleeve, elbow, forearm, a turned-back cuff and a gloved hand. The elbow keeps a little bend.
  const arm = (x: number) => limb(g, x, 1.18, [ball(0.07, coat, 0, 0, 0), pill(0.052, 0.18, coat, 0, -0.13, 0)],
    [pill(0.046, 0.17, coat, 0, -0.11, 0), tube(0.054, 0.052, 0.05, dark, 0, -0.2, 0), ball(0.045, glove, 0, -0.27, 0.005, 0.85, 1.25, 0.7)],
    0.26, (s) => -(0.15 + Math.max(0, -s) * 0.45));
  const legL = leg(-0.085), legR = leg(0.085), armL = arm(-0.215), armR = arm(0.215);
  // The body: hips, a chest turned from a profile, coat tails, a zip, belt and pouches, strap, scarf, neck.
  const body: THREE.Object3D[] = [
    ball(0.14, legs, 0, 0.78, 0, 1.06, 0.62, 0.8),
    turned([[0.001, 0], [0.135, 0.0], [0.145, 0.08], [0.158, 0.22], [0.172, 0.33], [0.168, 0.39], [0.125, 0.44], [0.06, 0.465], [0.001, 0.47]], coat, 0.76, 0.68),
    turned([[0.158, 0.2], [0.17, 0.08], [0.205, -0.14], [0.225, -0.3]], coat, 0.76, 0.74),
    pill(0.008, 0.36, dark, 0, 1.0, 0.118),
    ring(0.15, 0.02, 0x2a1e14, 0, 0.86, 0),
    fig(new RoundedBoxGeometry(0.06, 0.05, 0.02, 2, 0.008), 0xb8a060, 0, 0.86, 0.113),
    fig(new RoundedBoxGeometry(0.08, 0.09, 0.05, 2, 0.015), 0x5a4a32, -0.12, 0.84, 0.08), fig(new RoundedBoxGeometry(0.08, 0.09, 0.05, 2, 0.015), 0x5a4a32, 0.12, 0.84, 0.08),
    tube(0.052, 0.058, 0.1, skin, 0, 1.25, 0),
    ring(0.07, 0.034, scarf, 0, 1.235, 0.005),
  ];
  // The belt is a ring turned flat, so its depth is its local y.
  body[4].scale.y = 0.74;
  const strap = pill(0.014, 0.5, 0x3a2a1a, 0, 1.0, 0.11); strap.rotation.z = 0.68; body.push(strap);
  // The head: skull, ears, a nose, eyes with whites, brows, a mouth.
  body.push(ball(0.118, skin, 0, hy, 0, 0.94, 1.08, 1.0), ball(0.028, skin, -0.112, hy, 0, 0.5, 1, 0.8), ball(0.028, skin, 0.112, hy, 0, 0.5, 1, 0.8));
  body.push(ball(0.022, skin, 0, hy - 0.012, 0.117, 0.9, 1.15, 1.1));
  const mouth = pill(0.006, 0.028, 0x6a3a2a, 0, hy - 0.058, 0.106); mouth.rotation.z = Math.PI / 2; body.push(mouth);
  const masked = gear === 3;
  if (!masked) for (const sx of [-1, 1]) {
    body.push(ball(0.019, 0xf2ece0, sx * 0.043, hy + 0.018, 0.098), ball(0.011, 0x1e1a16, sx * 0.043, hy + 0.018, 0.113));
    const brow = pill(0.008, 0.03, hair, sx * 0.045, hy + 0.05, 0.106); brow.rotation.z = Math.PI / 2 + sx * 0.15; body.push(brow);
  }
  const shiny: THREE.Object3D[] = [];
  const hairCap = cap(0.126, Math.PI * 0.5, hair, 0, hy + 0.005, -0.008); hairCap.rotation.x = -0.25;
  if (gear === 0) { body.push(hairCap, tube(0.23, 0.23, 0.014, 0x4a3420, 0, hy + 0.085, 0, 28), tube(0.1, 0.115, 0.13, 0x4a3420, 0, hy + 0.15, 0, 24), tube(0.117, 0.117, 0.03, 0x2a1a10, 0, hy + 0.105, 0, 24)); }
  if (gear === 1) { const hood = cap(0.15, Math.PI * 0.62, coat, 0, hy + 0.01, -0.02); hood.rotation.x = -0.55; (hood.material as THREE.Material).side = THREE.DoubleSide; body.push(hood); }
  if (gear === 2 || gear === 3) {
    if (gear === 2) body.push(hairCap);
    const strapRing = ring(0.124, 0.012, 0x2a2a2a, 0, hy + 0.035, 0); body.push(strapRing);
    for (const sx of [-1, 1]) { const lens = tube(0.032, 0.032, 0.035, 0x2a3a3a, sx * 0.046, hy + 0.035, 0.112, 16); lens.rotation.x = Math.PI / 2; shiny.push(lens); body.push(ring(0.034, 0.008, 0x8a6a2a, sx * 0.046, hy + 0.035, 0.127).rotateX(Math.PI / 2)); }
  }
  if (gear === 3) { body.push(ball(0.075, 0x2a2a26, 0, hy - 0.045, 0.085, 1, 0.82, 0.9)); const filter = tube(0.038, 0.038, 0.06, 0x5a5a4a, 0, hy - 0.07, 0.16); filter.rotation.x = Math.PI / 2; body.push(filter); }
  if (gear === 5) body.push(hairCap);
  if (gear === 4) body.push(cap(0.13, Math.PI * 0.45, scarf, 0, hy + 0.005, 0), ring(0.12, 0.022, scarf, 0, hy + 0.05, 0));
  if (pack) { body.push(fig(new RoundedBoxGeometry(0.26, 0.32, 0.13, 3, 0.04), 0x5a5236, 0, 1.0, -0.16), fig(new RoundedBoxGeometry(0.2, 0.12, 0.04, 2, 0.015), 0x4a4428, 0, 0.92, -0.235)); const roll = tube(0.05, 0.05, 0.3, 0x6a3a2a, 0, 1.2, -0.15); roll.rotation.z = Math.PI / 2; body.push(roll); }
  sculpt(g, body, shiny);
  return { g, legL, legR, armL, armR };
}

/** What a scavenger wears for its task: a welding mask and leather apron at the bench, scrap plate and a helmet for a
 *  self-review, a hazmat hood with a lamp to verify. Merged onto the body, so it moves with them. */
function outfit(task: AgentTask): THREE.Object3D {
  const out = new THREE.Group(), matte: THREE.Object3D[] = [], shiny: THREE.Object3D[] = [], hy = HEAD_Y;
  const hardHat = (c: number) => { matte.push(cap(0.142, Math.PI / 2, c, 0, hy + 0.03, 0), tube(0.165, 0.165, 0.012, c, 0, hy + 0.035, 0.015, 28), tube(0.02, 0.02, 0.24, new THREE.Color(c).multiplyScalar(0.8).getHex(), 0, hy + 0.15, 0).rotateX(Math.PI / 2)); };
  const lit = (m: THREE.Mesh, c: number, k = 2) => { m.material = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: k }); return m; };
  if (task === "build") {
    matte.push(wrap(0.185, 0.215, 0.5, 1.12, 1.6, 0x5a3a1e));
    const mask = fig(new RoundedBoxGeometry(0.22, 0.2, 0.07, 3, 0.03), 0x2a2a2a, 0, hy + 0.12, 0.08); mask.rotation.x = -1.1; matte.push(mask);
    const visor = fig(new RoundedBoxGeometry(0.14, 0.05, 0.02, 2, 0.008), 0x2a5a2a, 0, hy + 0.15, 0.115); visor.rotation.x = -1.1; shiny.push(visor);
  }
  if (task === "fix") { hardHat(0xe07a20); matte.push(ring(0.158, 0.03, 0x6a4a2a, 0, 0.82, 0)); shiny.push(tube(0.012, 0.012, 0.16, 0x9aa0a8, 0.14, 0.74, 0.1)); }
  if (task === "selfreview") {
    matte.push(wrap(0.2, 0.19, 0.86, 1.18, 2.4, 0x6a6e70), wrap(0.2, 0.19, 0.86, 1.18, 2.0, 0x5a5e60, false));
    for (const sx of [-1, 1]) matte.push(cap(0.1, Math.PI / 2, 0x8a4a2a, sx * 0.21, 1.2, 0));
    matte.push(cap(0.15, Math.PI * 0.58, 0x5a5e60, 0, hy + 0.01, -0.005));
    out.add(lit(fig(new RoundedBoxGeometry(0.18, 0.03, 0.03, 2, 0.01), 0x7ac8ff), 0x7ac8ff, 2).translateY(hy + 0.02).translateZ(0.125));
  }
  if (task === "review") { matte.push(tube(0.25, 0.25, 0.014, 0x2a1e14, 0, hy + 0.085, 0, 28), tube(0.1, 0.115, 0.14, 0x2a1e14, 0, hy + 0.16, 0, 24), tube(0.117, 0.117, 0.03, 0x8a2a2a, 0, hy + 0.105, 0, 24)); matte.push(turned([[0.2, 0.12], [0.22, -0.2], [0.25, -0.5]], 0x4a3a2a, 0.76, 0.76)); }
  if (task === "verify") {
    matte.push(ball(0.16, 0xd8b830, 0, hy + 0.01, -0.01, 1, 1.05, 1), wrap(0.2, 0.2, 0.6, 1.18, 6.28, 0xd8b830));
    shiny.push(ball(0.1, 0x2a3a3a, 0, hy, 0.07, 1.1, 0.75, 0.85));
    out.add(lit(fig(new THREE.CylinderGeometry(0.03, 0.03, 0.03, 14), 0, 0, hy + 0.17, 0.11), 0xfff0a0, 3).rotateX(Math.PI / 2));
  }
  if (task === "chart") {
    matte.push(fig(new RoundedBoxGeometry(0.28, 0.36, 0.16, 3, 0.04), 0x4a5a3a, 0, 1.0, -0.18), tube(0.008, 0.008, 0.8, 0x2a2a2a, 0.1, 1.55, -0.2));
    out.add(lit(fig(new THREE.SphereGeometry(0.025, 12, 8), 0, 0.1, 1.96, -0.2), 0xff3020, 2.5));
  }
  if (task === "improve") { hardHat(0xe8c020); matte.push(wrap(0.185, 0.2, 0.86, 1.15, 6.28, 0xff7a1a)); shiny.push(wrap(0.188, 0.196, 0.95, 1.0, 6.28, 0xe8eee0)); }
  if (task === "grill") { matte.push(wrap(0.185, 0.215, 0.5, 1.12, 1.6, 0xd8d0c0), cap(0.13, Math.PI * 0.42, 0xa83a2a, 0, hy + 0.01, 0)); }
  sculpt(out, matte, shiny);
  return out;
}

/** The outpost's keepers: the saloon's barkeep, the depot's quartermaster, the archivist. Each behind their counter,
 *  facing the room, where the town keeps its own. */
function keeper(kind: Keeper): Person {
  const at = (k: string) => FURNITURE.find((f) => f.kind === k)!, matte: THREE.Object3D[] = [], hy = HEAD_Y;
  let p: Person;
  if (kind === "bartender") {
    // A waistcoat over a white shirt, a bowler.
    p = scavenger(0xd8d0c0, 0x2a2a2a, 0.37, 5);
    matte.push(wrap(0.18, 0.175, 0.82, 1.16, 6.28, 0x3a2a1a), cap(0.12, Math.PI / 2, 0x1a1a1a, 0, hy + 0.05, 0), tube(0.17, 0.17, 0.012, 0x1a1a1a, 0, hy + 0.06, 0, 28));
    const bar = at("bar"); p.g.position.set(bar.x + bar.w / 2, 0.08, 36.5); p.g.rotation.y = Math.PI;
  } else if (kind === "teller") {
    // A flak vest and a cap, for the one who counts the salvage.
    p = scavenger(0x4e5a3a, 0x2a2a2a, 0.71, 5);
    matte.push(wrap(0.195, 0.19, 0.8, 1.17, 6.28, 0x5a5e40), cap(0.128, Math.PI / 2, 0x4e5a3a, 0, hy + 0.04, 0), fig(new RoundedBoxGeometry(0.2, 0.012, 0.12, 2, 0.005), 0x4e5a3a, 0, hy + 0.045, 0.14));
    const c = at("counter"); p.g.position.set(c.x + c.w / 2, 0.08, c.z - 0.75);
  } else {
    // A long coat gone grey and round spectacles.
    p = scavenger(0xb8b8a8, 0x4a4a4a, 0.23, 5);
    matte.push(turned([[0.2, 0.12], [0.23, -0.2], [0.26, -0.55]], 0xb8b8a8, 0.76, 0.76));
    for (const sx of [-1, 1]) matte.push(ring(0.025, 0.005, 0x1a1a1a, sx * 0.043, hy + 0.018, 0.122).rotateX(Math.PI / 2));
    const d = at("desk"); p.g.position.set(d.x + d.w / 2, 0.08, d.z + d.d + 0.35); p.g.rotation.y = Math.PI;
  }
  sculpt(p.g, matte);
  return p;
}

/** What's in a scavenger's hand: a skill's tool, a tin cup, a lead pipe and a stun prod for a fight. Hangs from the
 *  shoulder's pivot to the hand. */
function tool(kind: Skill | "mug" | "sword" | "staff") {
  const g = new THREE.Group(), matte: THREE.Object3D[] = [], shiny: THREE.Object3D[] = [], steel = 0x9aa0a8, wood = 0x6b4a26;
  const rod = (r: number, len: number, c: number, y: number, into = matte) => into.push(tube(r, r, len, c, 0, y, 0, 12));
  const lit = (m: THREE.Mesh, c: number, k = 2.5) => { m.material = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: k }); g.add(m); };
  if (kind === "smithing") { rod(0.025, 0.22, 0x2a1e14, -0.08); rod(0.014, 0.22, 0xb87333, -0.28, shiny); lit(fig(new THREE.SphereGeometry(0.025, 10, 8), 0, 0, -0.41, 0.02), 0xa0c8ff); }
  else if (kind === "crafting") { rod(0.015, 0.3, steel, -0.14, shiny); shiny.push(ring(0.04, 0.012, steel, 0, -0.32, 0).rotateZ(Math.PI / 2)); }
  else if (kind === "woodcutting") { rod(0.022, 0.6, wood, -0.28); shiny.push(fig(new RoundedBoxGeometry(0.03, 0.16, 0.22, 2, 0.01), steel, 0, -0.52, 0.09)); }
  else if (kind === "mining") { rod(0.018, 0.75, 0x5a2a20, -0.34, shiny); shiny.push(tube(0.018, 0.012, 0.16, 0x5a2a20, 0, -0.72, 0.06).rotateX(1.2)); }
  else if (kind === "fishing") { rod(0.014, 1.9, 0x6a6a5a, -0.9); matte.push(tube(0.035, 0.035, 0.04, 0x2a2a2a, 0, -0.12, 0.03).rotateZ(Math.PI / 2)); }
  else if (kind === "construction") { rod(0.022, 0.62, wood, -0.28); shiny.push(fig(new RoundedBoxGeometry(0.22, 0.11, 0.11, 2, 0.02), 0x4a4e52, 0, -0.6, 0)); }
  else if (kind === "cooking") { rod(0.008, 0.6, steel, -0.26, shiny); matte.push(ball(0.05, 0x8a3a2a, 0, -0.4, 0, 1, 0.8, 1), ball(0.045, 0x6a2a1a, 0, -0.5, 0, 1, 0.8, 1)); }
  else if (kind === "mug") { shiny.push(tube(0.065, 0.06, 0.15, 0x9aa0a4, 0, -0.08, 0.06)); matte.push(tube(0.06, 0.06, 0.01, 0x6a4a2a, 0, 0.0, 0.06)); }
  else if (kind === "sword") { rod(0.03, 0.8, 0x6a6e70, -0.38, shiny); shiny.push(ball(0.045, 0x4a4e52, 0, -0.8, 0)); }
  else { rod(0.02, 1.2, 0x2a2a2a, -0.45); lit(fig(new THREE.SphereGeometry(0.06, 14, 10), 0, 0, -1.08, 0), 0x30e0d0); }
  sculpt(g, matte, shiny);
  g.position.set(0, -0.52, 0.05);
  return g;
}

/** A bounty on the board: a sheet of paper nailed up, lines on it, a tag in its lane's colour. */
function notice(pin: number) {
  const g = new THREE.Group();
  g.add(box(0.5, 0.42, 0.02, 0xe0d4b0, 0, 0, 0), box(0.06, 0.06, 0.04, 0x4a4a4a, 0, 0.17, 0.02));
  for (let k = 0; k < 3; k++) g.add(box(0.32, 0.02, 0.025, 0x4a3a2a, -0.03, 0.06 - k * 0.08, 0.01));
  const tag = box(0.12, 0.1, 0.03, pin, 0.17, -0.15, 0.02); Object.assign(tag.material, { emissive: new THREE.Color(pin), emissiveIntensity: 0.6 }); g.add(tag);
  return g;
}

/** The outpost from above, for the minimap. */
function minimap() {
  const c = document.createElement("canvas"); c.width = W * MM; c.height = ROWS * MM;
  const g = c.getContext("2d")!;
  const css: Record<Tile, string> = { g: "#9a7650", p: "#46423e", s: "#8c877e", w: "#4a7a1a", k: "#5a4230", d: "#241c14" };
  for (let r = 0; r < ROWS; r++) for (let x = 0; x < W; x++) { g.fillStyle = css[TILES[r][x]]; g.fillRect(x * MM, r * MM, MM, MM); }
  for (const t of TREES) { g.fillStyle = t.kind === "willow" ? "#7cff4a" : "#2a2420"; g.fillRect(t.x * MM - 2, mmz(t.z) - 2, 4, 4); }
  for (const b of BUILDINGS) { g.fillStyle = "#8a7a6a"; g.fillRect(b.x * MM, mmz(b.z), b.w * MM, b.d * MM); g.fillStyle = "#c8b8a0"; g.fillRect(b.x * MM, mmz(b.z), b.w * MM, 1); }
  g.fillStyle = "#6a6a62"; g.fillRect(CHAPEL.x * MM, mmz(CHAPEL.z), CHAPEL.w * MM, CHAPEL.d * MM);
  g.fillStyle = "#b8b0a0"; g.beginPath(); g.arc(CX * MM, mmz(CZ), 1.6 * MM, 0, Math.PI * 2); g.fill();
  return c;
}

// ---------- rigged scavengers: real models with animation clips ----------

/** The models, from KayKit's Adventurers pack (CC0, src/ui/public/models/LICENSE.txt): the hooded rogue, the rogue
 *  and the barbarian, who pass for scavengers once their weapons are put away. */
const RIG_FILES = ["Rogue_Hooded", "Rogue", "Barbarian"];
/** The pack's weapons and kit, hidden: the outpost's own tools go in their hands. */
const PACK_GEAR = /knife|crossbow|throwable|sword|axe|shield|staff|wand|spellbook|mug|arrow|quiver|smokebomb|dagger/i;
/** How tall a scavenger stands, as the town's people do, so names and bars sit where they always have. */
const STANDING = 1.62;
type Rig = { model: THREE.Object3D; clips: Map<string, THREE.AnimationClip>; scale: number };

/** Loads the models and their clips. Throws if any is missing, as in the World demo, which has none. */
async function loadRigs(): Promise<Rig[]> {
  const loader = new GLTFLoader();
  return Promise.all(RIG_FILES.map(async (name) => {
    // From the root: the page may be at /item/<key>.
    const gltf = await loader.loadAsync(`/models/${name}.glb`);
    gltf.scene.traverse((o) => {
      if (PACK_GEAR.test(o.name)) o.visible = false;
      const m = o as THREE.Mesh; if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; }
    });
    const size = new THREE.Box3().setFromObject(gltf.scene).getSize(new THREE.Vector3());
    return { model: gltf.scene, clips: new Map(gltf.animations.map((a) => [a.name, a])), scale: STANDING / size.y };
  }));
}

/** Which clip plays for what a scavenger is doing, how fast, and whether it plays once and holds. */
const CLIPS: Record<Act, { clip: string; speed?: number; once?: boolean }> = {
  idle: { clip: "Idle" }, walk: { clip: "Walking_A", speed: 1.15 }, run: { clip: "Running_A" }, cheer: { clip: "Cheer" }, die: { clip: "Death_A", once: true },
  sit: { clip: "Sit_Chair_Idle" }, kneel: { clip: "Sit_Floor_Idle" }, wave: { clip: "Interact", speed: 0.8 }, attack: { clip: "1H_Melee_Attack_Chop", speed: 0.6 }, block: { clip: "Blocking" },
  serve: { clip: "Interact", speed: 0.6 }, count: { clip: "Use_Item", speed: 0.7 }, read: { clip: "Idle", speed: 0.6 },
  smithing: { clip: "1H_Melee_Attack_Chop", speed: 0.8 }, construction: { clip: "1H_Melee_Attack_Chop", speed: 1.1 }, mining: { clip: "2H_Melee_Attack_Chop", speed: 0.75 },
  woodcutting: { clip: "2H_Melee_Attack_Slice", speed: 0.8 }, crafting: { clip: "Use_Item", speed: 0.8 }, cooking: { clip: "Interact", speed: 0.7 }, fishing: { clip: "2H_Ranged_Aiming", speed: 0.5 },
};

/**
 * A scavenger from a model: its own copy of the rig, its coat's colour worked into the model's paint so no two look
 * the same, and an animation mixer that cross-fades to the clip for whatever it's doing. Its `hand` holds tools at
 * the World's scale; its `head` is a spot on the crown for hats.
 */
function rigged(rig: Rig, coat: number, seed: number): Person {
  const model = cloneRig(rig.model), tint = new THREE.Color(coat);
  model.scale.setScalar(rig.scale);
  model.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = (m.material as THREE.MeshStandardMaterial).clone(); mat.color.lerp(tint, 0.32).multiplyScalar(1.15); m.material = mat;
  });
  const g = new THREE.Group(); g.add(model); g.updateMatrixWorld(true);
  // A grip and a crown at the World's own scale, on the hand and head bones.
  const unscaled = (bone: THREE.Object3D | undefined) => {
    const at = new THREE.Object3D(); if (!bone) { g.add(at); return at; }
    bone.add(at); at.scale.divideScalar(bone.getWorldScale(new THREE.Vector3()).x); return at;
  };
  const hand = unscaled(model.getObjectByName("handslot.r")), head = unscaled(model.getObjectByName("head"));
  head.position.y = 0.42 / (model.getObjectByName("head")?.getWorldScale(new THREE.Vector3()).x ?? 1);
  const mixer = new THREE.AnimationMixer(model), stand = () => new THREE.Object3D();
  let playing: THREE.AnimationAction | null = null, now = "";
  const act = (what: Act, dt: number) => {
    const c = CLIPS[what], clip = rig.clips.get(c.clip) ?? rig.clips.get("Idle");
    if (clip && c.clip !== now) {
      const next = mixer.clipAction(clip).reset();
      next.setLoop(c.once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity); next.clampWhenFinished = !!c.once; next.timeScale = c.speed ?? 1;
      // Each starts its loop somewhere of its own, so a crowd doesn't move in step.
      if (!c.once) next.time = rnd(seed * 31) * clip.duration;
      if (playing) next.crossFadeFrom(playing, 0.3, false);
      next.play(); playing = next; now = c.clip;
    }
    mixer.update(dt);
  };
  return { g, legL: stand(), legR: stand(), armL: stand(), armR: stand(), act, hand, head };
}

/** A tool for a model's hand: the outpost's own, moved so its grip is in the palm. */
function riggedTool(kind: Skill | "mug" | "sword" | "staff") {
  const t = tool(kind), g = new THREE.Group(); t.position.set(0, 0.08, 0); g.add(t); g.rotation.x = Math.PI;
  return g;
}

/** What a model wears for its task, on its crown: a hard hat, a welding mask pushed up, a wide hat, a hazmat hood, a
 *  radio aerial, a chef's bandana. Sized for the models' big heads. */
function riggedOutfit(task: AgentTask): THREE.Object3D {
  const out = new THREE.Group(), matte: THREE.Object3D[] = [], shiny: THREE.Object3D[] = [], s = 2.3;
  const hardHat = (c: number) => matte.push(cap(0.142 * s, Math.PI / 2, c, 0, -0.06, 0), tube(0.168 * s, 0.168 * s, 0.014 * s, c, 0, -0.055, 0.03, 28));
  const lit = (m: THREE.Mesh, c: number, k = 2) => { m.material = new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: k }); out.add(m); };
  if (task === "build") { const mask = fig(new RoundedBoxGeometry(0.5, 0.42, 0.14, 3, 0.05), 0x2a2a2a, 0, 0.02, 0.1); mask.rotation.x = -1.2; matte.push(mask); shiny.push(fig(new RoundedBoxGeometry(0.3, 0.1, 0.04, 2, 0.015), 0x2a5a2a, 0, 0.08, 0.2).rotateX(-1.2)); }
  if (task === "fix") hardHat(0xe07a20);
  if (task === "improve") hardHat(0xe8c020);
  if (task === "selfreview") { matte.push(cap(0.15 * s, Math.PI * 0.55, 0x5a5e60, 0, -0.1, 0)); lit(fig(new RoundedBoxGeometry(0.4, 0.06, 0.06, 2, 0.02), 0, 0, -0.22, 0.32), 0x7ac8ff); }
  if (task === "review") matte.push(tube(0.26 * s, 0.26 * s, 0.03, 0x2a1e14, 0, -0.04, 0, 28), tube(0.11 * s, 0.12 * s, 0.26, 0x2a1e14, 0, 0.08, 0, 24), tube(0.122 * s, 0.122 * s, 0.06, 0x8a2a2a, 0, 0.0, 0, 24));
  if (task === "verify") { matte.push(cap(0.17 * s, Math.PI * 0.62, 0xd8b830, 0, -0.12, 0)); lit(fig(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 14), 0, 0, -0.02, 0.33).rotateX(Math.PI / 2), 0xfff0a0, 3); }
  if (task === "chart") { matte.push(tube(0.012, 0.012, 0.9, 0x2a2a2a, 0.18, 0.4, -0.1)); lit(fig(new THREE.SphereGeometry(0.035, 12, 8), 0, 0.18, 0.86, -0.1), 0xff3020, 2.5); }
  if (task === "grill") matte.push(cap(0.135 * s, Math.PI * 0.42, 0xa83a2a, 0, -0.08, 0));
  sculpt(out, matte, shiny);
  return out;
}

/** Where each keeper stands and which way they face, behind their counter. */
function keeperSpot(kind: Keeper): [number, number, number] {
  const at = (k: string) => FURNITURE.find((f) => f.kind === k)!;
  if (kind === "bartender") { const bar = at("bar"); return [bar.x + bar.w / 2, 36.5, Math.PI]; }
  if (kind === "teller") { const c = at("counter"); return [c.x + c.w / 2, c.z - 0.75, 0]; }
  const d = at("desk"); return [d.x + d.w / 2, d.z + d.d + 0.35, Math.PI];
}

export const WASTELAND: WorldKit = {
  buildTown: buildOutpost, person: scavenger, outfit, keeper, tool, scroll: notice, hintArrow, minimapImage: minimap, shirts: COATS,
  buildings: {
    next: { name: "Dispatch", does: "Next: what to do, one at a time" },
    finished: { name: "Salvage Depot", does: "Finished: what shipped, day by day" },
    sessions: { name: "Saloon", does: "Sessions: every agent in herdr" },
    docs: { name: "Archive", does: "Docs: glossary, ADRs and visuals" },
  },
  areas: {
    Smithy: "Weld Shop", Mine: "Scrap Heaps", Grove: "Deadwood", "Riverbank north": "Sludge Creek north", "Riverbank south": "Sludge Creek south", Inn: "Saloon",
    Wilderness: "Badlands", "Construction site": "Rebuild", Kitchen: "Mess", Workshop: "Tinker Benches", Chapel: "Relay Station", Bonfire: "Burn Barrel",
  },
  verbs: { smithing: "Welding at a bench", crafting: "Tinkering at a bench", fishing: "Fishing the sludge creek", mining: "Picking the scrap heaps", woodcutting: "Chopping deadwood", construction: "Rebuilding", cooking: "Cooking at the mess" },
  welcome: [{ t: "Welcome to the outpost." }, { t: "Everyone you see is an agent. What needs you is nailed to the Bounty board north of the water tower: yellow tags are your turn, red are asked of you, most pressing top left.", c: "blue" }],
  ground: "Cracked dirt. Nothing's grown here in years.",
  board: "Bounty board", pray: "listening at the relay for a review from", burn: "warming up at the burn barrel: done,", drink: "taking a load off at the saloon",
  rest: { held: "mug" },
  fight: {
    hit: (scene, bits, x, y, z) => { burst(scene, bits, x, y, z, 0xffb030, 8, 0.9, true); smoke(scene, bits, x, y + 0.1, z); },
    attack: "Fighting the review", defend: "Inspector",
    holding: "the inspector, holding the self-review's findings until its PR's session takes them", fighting: "squaring off with its self-review for the findings",
    defeat: (w, l) => `${w} has run ${l} out of the outpost! The review's findings are back with ${w}.`,
  },
  panel: { quests: "Bounties", stats: "Skills", options: "Config", list: "Open bounties", statsTitle: "Survival skills", total: "Total level", xp: "Scrap",
    how: "Scrap comes from the board: CI passing, approvals and answered threads, agents finishing their work, and work shipping." },
  render: { sharp: true, shadows: true, exposure: 0.85, environment: 0.2, ao: true, bloom: 0.45 },
};

/** The kit with its people as rigged, animated models, once they've loaded; the built people if they can't be. */
export async function loadWasteland(): Promise<WorldKit> {
  let rigs: Rig[];
  try { rigs = await loadRigs(); } catch (e) { console.warn("World: character models didn't load, using built ones:", e); return WASTELAND; }
  const pick = (seed: number) => rigs[Math.floor(rnd(seed * 13 + 1) * rigs.length)];
  return {
    ...WASTELAND,
    person: (coat, _legs, seed = 0.5) => rigged(pick(seed), coat, seed),
    keeper: (kind) => {
      const [x, z, face] = keeperSpot(kind), k = ["bartender", "teller", "librarian"].indexOf(kind);
      const p = rigged(rigs[[1, 2, 0][k]], [0xd8d0c0, 0x4e5a3a, 0xb8b8a8][k], 0.3 + k * 0.2);
      p.g.position.set(x, 0.08, z); p.g.rotation.y = face; return p;
    },
    outfit: riggedOutfit, tool: riggedTool,
  };
}
