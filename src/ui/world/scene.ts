// The town's 3D models, after the 2007 client: low-poly and flat-shaded, ground colours blended between
// tiles. Everything is built from map.ts, so what's drawn is what people walk round.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { ALTAR, ANVILS, BONFIRE, CHAPEL, GRILLS, PEWS, SITE, WORKSHOP, BUILDINGS, type Building, buildingAt, CX, CZ, doorOf, ROWS, WILD_SIGN, Z0, FENCES, FURNACE, FURNITURE, H, heightAt, HV, LAMPS, ROCKS, rnd, SIGNS, type Skill, type Tile, tileAt, TILES, type Tree, TREES, W, WALL_H, WALL_T } from "./map";

const lambert = (color: number) => new THREE.MeshLambertMaterial({ color, flatShading: true });
export function box(w: number, h: number, d: number, color: number, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), lambert(color)); m.position.set(x, y, z); return m;
}

const TILE_RGB: Record<Tile, [number, number, number]> = { g: [0.24, 0.46, 0.1], p: [0.47, 0.37, 0.24], s: [0.52, 0.5, 0.45], w: [0.36, 0.33, 0.22], k: [0.2, 0.19, 0.12], d: [0.12, 0.09, 0.06] };
function terrain() {
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  for (let z = Z0; z <= H; z++) for (let x = 0; x <= W; x++) {
    pos.push(x, HV[(z - Z0) * (W + 1) + x], z);
    // A corner's colour is its four tiles' average, so ground colours blend the way the client's do.
    const c = [0, 0, 0];
    for (const [dx, dz] of [[0, 0], [-1, 0], [0, -1], [-1, -1]]) { const t = TILE_RGB[tileAt(x + dx, z + dz)]; for (let i = 0; i < 3; i++) c[i] += t[i] / 4; }
    const j = (rnd(x * 131 + z * 17) - 0.5) * 0.07;
    col.push(c[0] + j, c[1] + j * 1.4, c[2] + j);
  }
  for (let z = 0; z < ROWS; z++) for (let x = 0; x < W; x++) { const a = z * (W + 1) + x, b = a + 1, c = a + W + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx); g.computeVertexNormals();
  return new THREE.Mesh(g, new THREE.MeshLambertMaterial({ vertexColors: true }));
}

/** A house: plank floor, stone walls with a doorway, windows, and a gable roof (hidden with Hide roofs). */
function house(b: Building) {
  const g = new THREE.Group(), stone = 0x8a8476, y = WALL_H / 2 + 0.08, d = doorOf(b), back = d.z === b.z ? b.z + b.d : b.z;
  const wall = (m: THREE.Mesh) => { m.userData.wall = true; g.add(m); };
  g.add(box(b.w - WALL_T * 2 + 0.02, 0.06, b.d - WALL_T * 2 + 0.02, 0x6b4a2a, b.x + b.w / 2, 0.11, b.z + b.d / 2));
  wall(box(WALL_T, WALL_H, b.d, stone, b.x + WALL_T / 2, y, b.z + b.d / 2)); wall(box(WALL_T, WALL_H, b.d, stone, b.x + b.w - WALL_T / 2, y, b.z + b.d / 2));
  wall(box(b.w, WALL_H, WALL_T, stone, b.x + b.w / 2, y, back + (back === b.z ? WALL_T / 2 : -WALL_T / 2)));
  const gx0 = d.x - 0.6, gx1 = d.x + 0.6, dz = d.z + (d.z === b.z ? WALL_T / 2 : -WALL_T / 2);
  wall(box(gx0 - b.x, WALL_H, WALL_T, stone, (b.x + gx0) / 2, y, dz)); wall(box(b.x + b.w - gx1, WALL_H, WALL_T, stone, (gx1 + b.x + b.w) / 2, y, dz));
  wall(box(1.2, 0.6, WALL_T, stone, d.x, WALL_H - 0.22, dz));
  const out = d.z === b.z ? -0.13 : 0.13;
  for (const wx of [b.x + 1.6, b.x + b.w - 1.6]) g.add(box(0.8, 0.7, 0.06, 0x1a1a22, wx, 1.5, dz + out));
  const x0 = b.x - 0.3, x1 = b.x + b.w + 0.3, z0 = b.z - 0.45, z1 = b.z + b.d + 0.45, zm = b.z + b.d / 2, e = WALL_H + 0.08, r = e + b.d * 0.42;
  const A = [x0, e, z0], B = [x1, e, z0], C = [x1, r, zm], D = [x0, r, zm], E = [x0, e, z1], F = [x1, e, z1];
  const roof = new THREE.Group();
  const tri = (pts: number[][], color: number) => {
    const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.Float32BufferAttribute(pts.flat(), 3)); geo.computeVertexNormals();
    roof.add(new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color })));
  };
  // Each slope in rows from eave to ridge, alternately shaded: tiles, or thatch on the Inn.
  const thatch = b.id === "sessions", base = new THREE.Color(thatch ? 0xc4a050 : b.roof), rows = thatch ? 7 : 5;
  const lerp = (p: number[], q: number[], t: number) => p.map((v, i) => v + (q[i] - v) * t);
  for (const [e1, e2, r2, r1] of [[A, B, C, D], [F, E, D, C]]) for (let k = 0; k < rows; k++) {
    const a1 = lerp(e1, r1, k / rows), a2 = lerp(e2, r2, k / rows), b1 = lerp(e1, r1, (k + 1) / rows), b2 = lerp(e2, r2, (k + 1) / rows);
    tri([a1, b2, a2, a1, b1, b2], base.clone().multiplyScalar(k % 2 ? 0.86 : 1).getHex());
  }
  if (thatch) tri([lerp(D, A, 0.05), lerp(C, B, 0.05), C, lerp(D, A, 0.05), C, D], 0x8a6a30);
  tri([A, E, D, B, C, F], 0x7a7468);
  const merged = merge(roof, g, true); if (merged) merged.userData.roof = true;
  g.traverse((o) => { o.userData.target = { kind: "building", b }; });
  return g;
}

function furniture(scene: THREE.Object3D) {
  for (const f of FURNITURE) {
    const x = f.x + f.w / 2, z = f.z + f.d / 2, g = new THREE.Group();
    if (f.kind === "table") {
      g.add(box(f.w, 0.08, f.d, 0x7a5430, x, 0.82, z));
      for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) g.add(box(0.1, 0.72, 0.1, 0x5a3a1e, x + ox * (f.w / 2 - 0.15), 0.44, z + oz * (f.d / 2 - 0.15)));
      g.add(box(0.12, 0.2, 0.12, 0xc89a3a, x + 0.25, 0.96, z - 0.1));
    }
    if (f.kind === "bar") g.add(box(f.w, 0.95, f.d, 0x5a3a1e, x, 0.55, z), box(f.w + 0.1, 0.08, f.d + 0.1, 0x7a5430, x, 1.05, z));
    if (f.kind === "barrel") {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.38, 0.9, 8), lambert(0x6b4a26)); m.position.set(x, 0.55, z); g.add(m);
      g.add(box(0.8, 0.06, 0.8, 0x3a3a3a, x, 0.75, z));
    }
    if (f.kind === "counter") g.add(box(f.w, 1, f.d, 0x6a5a48, x, 0.58, z));
    if (f.kind === "chest") g.add(box(f.w, 0.9, f.d, 0x5a5048, x, 0.55, z), box(f.w + 0.04, 0.08, f.d + 0.04, 0xb89a3a, x, 0.9, z));
    if (f.kind === "shelf") {
      g.add(box(f.w, 2, f.d, 0x5a3a1e, x, 1.08, z));
      for (let s = 0; s < 3; s++) g.add(box(f.w - 0.2, 0.36, 0.08, [0x7a2b2b, 0x2b4f8a, 0x2b6a3a][(Math.round(x) + s) % 3], x, 0.5 + s * 0.6, z + 0.2));
    }
    if (f.kind === "noticeboard") g.add(box(f.w, 1.2, f.d, 0xb89a6a, x, 1.5, z));
    scene.add(g);
  }
}

export function tree({ x, z, s, kind }: Tree) {
  const g = new THREE.Group(), y = heightAt(x, z);
  const leaf = (geo: THREE.BufferGeometry, color: number, ox: number, oy: number, oz: number) => { const m = new THREE.Mesh(geo, lambert(color)); m.position.set(x + ox * s, y + oy * s, z + oz * s); g.add(m); return m; };
  if (kind === "dead") {
    // Bare and black: a trunk and a few crooked branches.
    g.add(box(0.26, 1.7 * s, 0.26, 0x2a2420, x, y + 0.85 * s, z));
    for (const [ox, oy, oz, ang] of [[0.3, 1.4, 0, -0.8], [-0.28, 1.15, 0.1, 0.9], [0.05, 1.75, -0.25, 0.5]]) {
      const b = box(0.12, 0.8 * s, 0.12, 0x2a2420, x + ox * s, y + oy * s, z + oz * s); b.rotation.z = ang; g.add(b);
    }
    return g;
  }
  if (kind === "pine") {
    g.add(box(0.22, 0.9 * s, 0.22, 0x4a3420, x, y + 0.45 * s, z));
    for (const [r, h, oy] of [[0.95, 1.1, 1.1], [0.75, 0.95, 1.75], [0.5, 0.8, 2.3]]) leaf(new THREE.ConeGeometry(r * s, h * s, 6), 0x2a5a2a, 0, oy, 0);
  } else if (kind === "willow") {
    g.add(box(0.28, 1.4 * s, 0.28, 0x5a4a30, x, y + 0.7 * s, z));
    leaf(new THREE.IcosahedronGeometry(0.85 * s, 0), 0x6a8a3a, 0, 1.75, 0).scale.set(1.2, 0.7, 1.2);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; leaf(new THREE.BoxGeometry(0.18 * s, 1.1 * s, 0.18 * s), 0x5f7f34, Math.cos(a) * 0.75, 1.15, Math.sin(a) * 0.75); }
  } else {
    g.add(box(0.25, 1.2 * s, 0.25, 0x5a3e22, x, y + 0.6 * s, z));
    for (const [ox, oy, oz, r] of [[0, 1.6, 0, 0.9], [0.4, 1.3, 0.3, 0.6], [-0.4, 1.35, -0.2, 0.65]]) leaf(new THREE.IcosahedronGeometry(r * s, 0), rnd(x * z) > 0.5 ? 0x3c6e24 : 0x345f1e, ox, oy, oz);
  }
  return g;
}

/** Wooden fences: a post every so often, two rails between. */
function fences(scene: THREE.Object3D) {
  for (const [x1, z1, x2, z2] of FENCES) {
    const len = Math.hypot(x2 - x1, z2 - z1), n = Math.max(1, Math.round(len / 1.3)), ang = Math.atan2(x2 - x1, z2 - z1);
    for (let i = 0; i <= n; i++) { const x = x1 + ((x2 - x1) * i) / n, z = z1 + ((z2 - z1) * i) / n; scene.add(box(0.14, 0.9, 0.14, 0x5a3e22, x, heightAt(x, z) + 0.45, z)); }
    for (const yy of [0.35, 0.72]) {
      for (let i = 0; i < n; i++) {
        const ax = x1 + ((x2 - x1) * i) / n, az = z1 + ((z2 - z1) * i) / n, bx = x1 + ((x2 - x1) * (i + 1)) / n, bz = z1 + ((z2 - z1) * (i + 1)) / n;
        const rail = box(0.06, 0.08, Math.hypot(bx - ax, bz - az), 0x6b4a26, (ax + bx) / 2, (heightAt(ax, az) + heightAt(bx, bz)) / 2 + yy, (az + bz) / 2);
        rail.rotation.y = ang; scene.add(rail);
      }
    }
  }
}
function signsAndLamps(scene: THREE.Object3D) {
  for (const [x, z, face] of SIGNS) {
    const y = heightAt(x, z), g = new THREE.Group();
    g.add(box(0.14, 1.7, 0.14, 0x5a3e22, 0, 0.85, 0), box(0.9, 0.24, 0.06, 0x8a6a40, 0.32, 1.45, 0), box(0.8, 0.22, 0.06, 0x8a6a40, -0.28, 1.12, 0.02));
    g.position.set(x, y, z); g.rotation.y = face; scene.add(g);
  }
  for (const [x, z] of LAMPS) {
    const y = heightAt(x, z), glow = box(0.3, 0.32, 0.3, 0xffd070, x, y + 2.05, z);
    Object.assign(glow.material, { emissive: new THREE.Color(0xffb040), emissiveIntensity: 0.8 });
    scene.add(box(0.12, 1.9, 0.12, 0x2a2a2a, x, y + 0.95, z), glow, box(0.42, 0.06, 0.42, 0x2a2a2a, x, y + 2.25, z));
  }
}
/** The Wilderness: a red warning sign at the ditch, dark rocks and old bones about. */
function wilderness(scene: THREE.Object3D) {
  const [sx, sz] = WILD_SIGN, sy = heightAt(sx, sz);
  scene.add(box(0.16, 1.9, 0.16, 0x3a2a1a, sx, sy + 0.95, sz), box(1.3, 0.6, 0.08, 0x7a1010, sx, sy + 1.6, sz), box(1.4, 0.08, 0.1, 0x2a1a10, sx, sy + 1.93, sz));
  for (let i = 0; i < 60; i++) {
    const x = 1 + rnd(i * 6.1 + 11) * (W - 2), z = Z0 + 1 + rnd(i * 8.3 + 4) * (-Z0 - 2);
    if (tileAt(x, z) !== "k") continue;
    const y = heightAt(x, z);
    if (i % 3) { const r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.35 + rnd(i) * 0.3, 0), lambert(0x3a3632)); r.position.set(x, y + 0.2, z); r.scale.y = 0.6; r.rotation.y = rnd(i * 3) * 3; scene.add(r); }
    else { const b = box(0.55, 0.1, 0.12, 0xd8d0b8, x, y + 0.06, z); b.rotation.y = rnd(i * 5) * 3; scene.add(b, box(0.16, 0.14, 0.16, 0xd8d0b8, x + 0.3, y + 0.08, z)); }
  }
}

/** Bushes on the grass, out of everyone's way. */
function greenery(scene: THREE.Object3D) {
  for (let i = 0; i < 260; i++) {
    const x = 0.5 + rnd(i * 3.7 + 1) * (W - 1), z = 0.5 + rnd(i * 9.1 + 2) * (H - 1);
    if (tileAt(x, z) !== "g" || buildingAt(x, z) || [-0.6, 0.6].some((o) => tileAt(x + o, z) !== "g" || tileAt(x, z + o) !== "g" || buildingAt(x + o, z + o))) continue;
    const y = heightAt(x, z);
    // Bushes only: anything smaller is a stray pixel at the client's resolution.
    if (i % 3 === 0) { const b = new THREE.Mesh(new THREE.IcosahedronGeometry(0.32, 0), lambert(0x3f6a26)); b.position.set(x, y + 0.2, z); b.scale.y = 0.7; scene.add(b); }
  }
}

/** The Construction site: a house half built. Ragged stone walls, a timber frame, scaffolding, a ladder, stacks. */
function site(scene: THREE.Object3D) {
  const { x, z, w, d } = SITE, y = 0.08, stone = 0x8a8476;
  scene.add(box(w, 0.2, d, 0x7a746a, x + w / 2, y + 0.1, z + d / 2));
  // The back wall stepped down from full height, the sides lower, the front just begun.
  for (let i = 0; i < 10; i++) { const h = i < 4 ? 2.4 : Math.max(0.4, 2.4 - (i - 3) * 0.35); scene.add(box(0.5, h, 0.24, stone, x + 0.25 + i * 0.5, y + 0.2 + h / 2, z + 0.12)); }
  for (let i = 0; i < 8; i++) { const h = Math.max(0.3, 1.6 - i * 0.18); scene.add(box(0.24, h, 0.5, stone, x + 0.12, y + 0.2 + h / 2, z + 0.25 + i * 0.5)); }
  scene.add(box(0.24, 0.5, d, stone, x + w - 0.12, y + 0.45, z + d / 2), box(1.5, 0.35, 0.24, stone, x + 0.75, y + 0.37, z + d - 0.12));
  // Timber frame: corner posts, a beam, two roof trusses over the finished end.
  for (const [px, pz] of [[x + 0.1, z + 0.1], [x + w - 0.1, z + 0.1], [x + 0.1, z + d - 0.1], [x + w - 0.1, z + d - 0.1]]) scene.add(box(0.16, 3, 0.16, 0x7a5430, px, y + 1.5, pz));
  scene.add(box(w, 0.16, 0.16, 0x7a5430, x + w / 2, y + 3, z + 0.1));
  for (const tx of [x + 0.5, x + 1.7]) {
    const a = box(0.12, 1.6, 0.12, 0x7a5430, tx, y + 3.55, z + d * 0.25); a.rotation.x = 0.9; scene.add(a);
    const b = box(0.12, 1.6, 0.12, 0x7a5430, tx, y + 3.55, z + d * 0.75 - 0.6); b.rotation.x = -0.9; scene.add(b);
  }
  // Scaffolding by the right wall, a ladder against the back, timber and stone waiting.
  for (const pz of [z + 0.6, z + d - 0.6]) scene.add(box(0.1, 2.2, 0.1, 0x6b4a26, x + w + 0.45, y + 1.1, pz));
  scene.add(box(0.5, 0.06, d - 0.8, 0x9a7a4a, x + w + 0.45, y + 1.3, z + d / 2));
  const ladder = new THREE.Group();
  ladder.add(box(0.06, 2.4, 0.06, 0x6b4a26, -0.22, 1.2, 0), box(0.06, 2.4, 0.06, 0x6b4a26, 0.22, 1.2, 0));
  for (let r = 0; r < 6; r++) ladder.add(box(0.44, 0.05, 0.05, 0x6b4a26, 0, 0.3 + r * 0.38, 0));
  ladder.position.set(x + 3.2, y, z - 0.45); ladder.rotation.x = -0.25; scene.add(ladder);
  for (let r = 0; r < 4; r++) scene.add(box(1.6, 0.1, 0.32, 0xb89a6a, x - 1.2, y + 0.06 + r * 0.11, z + d + 1.2 + (r % 2) * 0.05));
  for (let r = 0; r < 5; r++) scene.add(box(0.36, 0.26, 0.3, 0x8a8476, x + w + 1 + (r % 3) * 0.38, y + 0.13 + Math.floor(r / 3) * 0.26, z + d + 1));
}

/** The Cookout: grills on legs, coals glowing, something on each. */
function grills(scene: THREE.Object3D) {
  for (const [gx, gz] of GRILLS) {
    const y = heightAt(gx, gz);
    for (const [ox, oz] of [[-0.48, -0.24], [0.48, -0.24], [-0.48, 0.24], [0.48, 0.24]]) scene.add(box(0.07, 0.6, 0.07, 0x2a2a2a, gx + ox, y + 0.3, gz + oz));
    scene.add(box(1.1, 0.32, 0.6, 0x2e2e30, gx, y + 0.72, gz));
    const coals = box(1.0, 0.06, 0.5, 0xff6a1a, gx, y + 0.86, gz); Object.assign(coals.material, { emissive: new THREE.Color(0xff4a10), emissiveIntensity: 0.9 }); scene.add(coals);
    for (let k = 0; k < 5; k++) scene.add(box(0.03, 0.03, 0.56, 0x1a1a1a, gx - 0.44 + k * 0.22, y + 0.93, gz));
    scene.add(box(0.26, 0.06, 0.18, 0x7a3a1a, gx - 0.2, y + 0.97, gz - 0.05), box(0.22, 0.06, 0.16, 0x8a4a22, gx + 0.22, y + 0.97, gz + 0.08));
  }
}

/** The Workshop: a workbench with leather and tools, a spinning wheel, a potter's wheel with a pot, a loom. */
function workshop(scene: THREE.Object3D) {
  const wood = 0x7a5430, dark = 0x5a3a1e;
  for (const w of WORKSHOP) {
    const { x, z } = w, y = heightAt(x, z);
    if (w.kind === "bench") {
      scene.add(box(1.1, 0.08, 0.6, wood, x, y + 0.8, z));
      for (const [ox, oz] of [[-0.45, -0.22], [0.45, -0.22], [-0.45, 0.22], [0.45, 0.22]]) scene.add(box(0.08, 0.76, 0.08, dark, x + ox, y + 0.4, z + oz));
      scene.add(box(0.4, 0.03, 0.3, 0x8a5a2a, x - 0.2, y + 0.86, z), box(0.05, 0.05, 0.26, 0x9aa0a8, x + 0.3, y + 0.86, z + 0.05), box(0.14, 0.1, 0.14, 0xc8a050, x + 0.32, y + 0.89, z - 0.15));
    }
    if (w.kind === "spinning") {
      scene.add(box(0.9, 0.12, 0.3, dark, x, y + 0.3, z), box(0.08, 0.6, 0.08, dark, x - 0.3, y + 0.6, z), box(0.08, 0.6, 0.08, dark, x + 0.3, y + 0.6, z));
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.42, 0.06, 10), lambert(wood)); wheel.rotation.x = Math.PI / 2; wheel.position.set(x - 0.05, y + 0.85, z); scene.add(wheel);
      scene.add(box(0.12, 0.3, 0.12, 0xe8e0c8, x + 0.38, y + 0.95, z));
    }
    if (w.kind === "pottery") {
      scene.add(box(0.7, 0.5, 0.5, dark, x, y + 0.25, z));
      const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.05, 10), lambert(0x6a6a6a)); plate.position.set(x, y + 0.54, z); scene.add(plate);
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.26, 8), lambert(0xa8603a)); pot.position.set(x, y + 0.7, z); scene.add(pot);
    }
    if (w.kind === "loom") {
      scene.add(box(0.08, 1.4, 0.08, dark, x - 0.45, y + 0.7, z), box(0.08, 1.4, 0.08, dark, x + 0.45, y + 0.7, z), box(1.0, 0.08, 0.08, dark, x, y + 1.4, z), box(1.0, 0.08, 0.08, dark, x, y + 0.5, z));
      scene.add(box(0.82, 0.8, 0.02, 0x8a2a3a, x, y + 0.95, z));
    }
  }
}

/** The Chapel: a stone floor, a back wall with a coloured window, the altar with its candles, pews in rows. */
function chapel(scene: THREE.Object3D) {
  const { x, z, w, d } = CHAPEL, stone = 0x8a8476;
  scene.add(box(w, 0.1, d, 0x9a948a, x + w / 2, 0.13, z + d / 2));
  scene.add(box(w, 3.2, 0.3, stone, x + w / 2, 1.6, z - 0.05), box(0.3, 2.2, d * 0.5, stone, x + 0.15, 1.1, z + d * 0.25), box(0.3, 2.2, d * 0.5, stone, x + w - 0.15, 1.1, z + d * 0.25));
  const glass = box(1.4, 1.6, 0.06, 0x3a6ad8, ALTAR[0], 2.1, z + 0.12); Object.assign(glass.material, { emissive: new THREE.Color(0x2a4ab0), emissiveIntensity: 0.6 });
  const glass2 = box(0.5, 0.5, 0.07, 0xd83a3a, ALTAR[0], 2.4, z + 0.13); Object.assign(glass2.material, { emissive: new THREE.Color(0xa02020), emissiveIntensity: 0.6 });
  scene.add(glass, glass2);
  const [ax, az] = ALTAR;
  scene.add(box(1.6, 0.9, 0.8, 0xb8b0a0, ax, 0.6, az), box(1.7, 0.05, 0.85, 0xf2ecd8, ax, 1.07, az), box(0.12, 0.05, 0.9, 0xc8a040, ax, 1.08, az));
  for (const cx of [ax - 0.6, ax + 0.6]) {
    scene.add(box(0.08, 0.28, 0.08, 0xf2ecd8, cx, 1.24, az - 0.2));
    const flame = box(0.06, 0.1, 0.06, 0xffd060, cx, 1.43, az - 0.2); Object.assign(flame.material, { emissive: new THREE.Color(0xffb020), emissiveIntensity: 1 }); scene.add(flame);
  }
  for (const p of PEWS) {
    const px = p.x + p.w / 2, pz = p.z + p.d / 2;
    scene.add(box(p.w, 0.08, p.d, 0x6b4a26, px, 0.55, pz), box(p.w, 0.5, 0.08, 0x6b4a26, px, 0.8, pz + p.d / 2), box(0.1, 0.5, p.d, 0x5a3a1e, p.x + 0.1, 0.3, pz), box(0.1, 0.5, p.d, 0x5a3a1e, p.x + p.w - 0.1, 0.3, pz));
  }
}

/** The Bonfire: a ring of stones round a stack of logs and a fire. */
function bonfire(scene: THREE.Object3D) {
  const [bx, bz] = BONFIRE, y = heightAt(bx, bz);
  for (let i = 0; i < 9; i++) { const t = (i / 9) * Math.PI * 2; scene.add(box(0.2, 0.14, 0.2, 0x7a7a74, bx + Math.sin(t) * 0.45, y + 0.07, bz + Math.cos(t) * 0.45)); }
  for (const r of [0, Math.PI / 2]) { const log = box(0.7, 0.13, 0.13, 0x5a3a1e, bx, y + 0.13, bz); log.rotation.y = r; scene.add(log); }
  for (const [s, h, c, e] of [[0.36, 0.42, 0xff7a1a, 0xff4a10], [0.2, 0.62, 0xffc040, 0xffa020]] as const) {
    const f = box(s, h, s, c, bx, y + 0.2 + h / 2, bz); f.rotation.y = 0.6; Object.assign(f.material, { emissive: new THREE.Color(e), emissiveIntensity: 1 }); scene.add(f);
  }
}

function stations(scene: THREE.Object3D) {
  site(scene); grills(scene); workshop(scene); chapel(scene); bonfire(scene);
  for (const [x, z] of ANVILS) {
    const y = heightAt(x, z);
    scene.add(box(0.5, 0.45, 0.4, 0x5a3e22, x, y + 0.22, z), box(0.95, 0.22, 0.42, 0x3a3a40, x, y + 0.56, z), box(0.3, 0.14, 0.3, 0x3a3a40, x + 0.55, y + 0.6, z));
  }
  const [fx, fz] = FURNACE, fy = heightAt(fx, fz);
  scene.add(box(2.2, 1.6, 1.3, 0x6a6258, fx, fy + 0.8, fz), box(0.8, 0.5, 0.1, 0xff7a1a, fx, fy + 0.55, fz + 0.68), box(0.5, 1.2, 0.5, 0x5a544a, fx + 0.7, fy + 2.2, fz - 0.1));
  for (const [x, z] of ROCKS) {
    const y = heightAt(x, z), r = new THREE.Mesh(new THREE.DodecahedronGeometry(0.62, 0), lambert(0x6e6a62));
    r.position.set(x, y + 0.35, z); r.scale.set(1.1, 0.75, 1); r.rotation.y = rnd(x) * 3; scene.add(r);
    for (let i = 0; i < 3; i++) scene.add(box(0.14, 0.14, 0.14, 0xb05a2a, x + (rnd(x + i) - 0.5) * 0.7, y + 0.55 + rnd(z + i) * 0.15, z + (rnd(z * i) - 0.5) * 0.6));
  }
}

const PAINTED = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
const PAINTED_BOTH = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true, side: THREE.DoubleSide });
/** A group's meshes as one, coloured per vertex: one draw call instead of many. Glowing parts stay apart. */
function merge(group: THREE.Object3D, into: THREE.Object3D, both = false): THREE.Mesh | null {
  group.updateMatrixWorld(true);
  const parts: THREE.BufferGeometry[] = [];
  group.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = m.material as THREE.MeshLambertMaterial;
    if (mat.emissive && mat.emissive.getHex() !== 0) { const c = m.clone(); m.matrixWorld.decompose(c.position, c.quaternion, c.scale); into.add(c); return; }
    const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrixWorld);
    if (!g.attributes.normal) g.computeVertexNormals();
    for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal") g.deleteAttribute(k);
    const col = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < col.length; i += 3) { col[i] = mat.color.r; col[i + 1] = mat.color.g; col[i + 2] = mat.color.b; }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    parts.push(g);
  });
  if (!parts.length) return null;
  const out = new THREE.Mesh(mergeGeometries(parts), both ? PAINTED_BOTH : PAINTED);
  into.add(out); return out;
}

/** The whole town: ground, water, houses, furniture, the fountain, trees, work stations, light and fog. */
export function buildTown() {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x000000, 18, 34);
  scene.add(new THREE.AmbientLight(0xffffff, 0.95));
  const sun = new THREE.DirectionalLight(0xffffff, 1.25); sun.position.set(-12, 20, 8); scene.add(sun);
  const ground = terrain(); scene.add(ground);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(W, ROWS), new THREE.MeshLambertMaterial({ color: 0x2f5fa8, transparent: true, opacity: 0.85 }));
  water.rotation.x = -Math.PI / 2; water.position.set(W / 2, -0.4, (Z0 + H) / 2); scene.add(water);
  for (const b of BUILDINGS) scene.add(house(b));
  const still = new THREE.Group();
  furniture(still);
  stations(still);
  const basin = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.75, 0.5, 10), lambert(0x77736a)); basin.position.set(CX, 0.33, CZ); still.add(basin);
  const pool = new THREE.Mesh(new THREE.CylinderGeometry(1.35, 1.35, 0.52, 10), lambert(0x3f7fd0)); pool.position.set(CX, 0.35, CZ); still.add(pool);
  const spout = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 1.4, 6), lambert(0x77736a)); spout.position.set(CX, 0.9, CZ); still.add(spout);
  for (const t of TREES) still.add(tree(t));
  fences(still); signsAndLamps(still); greenery(still); wilderness(still);
  merge(still, scene);
  const roofs: THREE.Object3D[] = [], walls: THREE.Mesh[] = [];
  scene.traverse((o) => { if (o.userData.roof) roofs.push(o); if (o.userData.wall) walls.push(o as THREE.Mesh); });
  return { scene, ground, roofs, walls };
}

export type Person = { g: THREE.Group; legL: THREE.Object3D; legR: THREE.Object3D; armL: THREE.Object3D; armR: THREE.Object3D };
export const SHIRTS = [0x8a2b2b, 0x2b4f8a, 0x6a2b8a, 0x2b8a5a, 0x8a6a2b, 0x2b7a8a, 0x7a7a2b];
const SKINS = [0xd9a77a, 0xc08a5a, 0xe8c09a, 0x8a5a3a, 0xb07a50];
const HAIR = [0x3a2a1a, 0x1a1a1a, 0x8a5a2a, 0xc8a050, 0x6a2a1a, 0x9a9a9a];
/** A person, blocky like the client's: `seed` picks skin, hair and the rest, so each looks their own. */
export function person(shirt: number, legs = 0x3a3a5a, seed = 0.5): Person {
  const g = new THREE.Group(), pick = <T,>(xs: T[], k: number) => xs[Math.floor(rnd(seed * 97 + k) * xs.length)];
  const skin = pick(SKINS, 1), hair = pick(HAIR, 2), long = rnd(seed * 31) > 0.7;
  const limb = (w: number, h: number, color: number, x: number, y: number, end: THREE.Mesh) => {
    const p = new THREE.Group(), parts = new THREE.Group(); p.position.set(x, y, 0);
    parts.add(box(w, h, w, color, 0, -h / 2, 0), end); merge(parts, p);
    g.add(p); return p;
  };
  const boot = () => box(0.22, 0.12, 0.31, 0x2a1a10, 0, -0.57, 0.04), hand = () => box(0.13, 0.12, 0.13, skin, 0, -0.6, 0);
  const legL = limb(0.19, 0.62, legs, -0.12, 0.62, boot()), legR = limb(0.19, 0.62, legs, 0.12, 0.62, boot());
  const armL = limb(0.15, 0.55, shirt, -0.33, 1.16, hand()), armR = limb(0.15, 0.55, shirt, 0.33, 1.16, hand());
  const body = new THREE.Group();
  body.add(box(0.5, 0.56, 0.27, shirt, 0, 0.9, 0), box(0.52, 0.07, 0.29, 0x3a2a14, 0, 0.66, 0), box(0.3, 0.32, 0.3, skin, 0, 1.36, 0));
  body.add(box(0.32, 0.1, 0.32, hair, 0, 1.54, 0), box(0.32, long ? 0.34 : 0.16, 0.06, hair, 0, long ? 1.36 : 1.45, -0.15));
  body.add(box(0.05, 0.05, 0.02, 0x1a1a1a, -0.07, 1.39, 0.15), box(0.05, 0.05, 0.02, 0x1a1a1a, 0.07, 1.39, 0.15));
  merge(body, g);
  return { g, legL, legR, armL, armR };
}

/** What's in an agent's hand: a skill's tool, or a mug of ale. */
export function tool(kind: Skill | "mug" | "sword" | "staff") {
  if (kind === "construction") { const g = new THREE.Group(); g.position.set(0, -0.52, 0.05); g.add(box(0.06, 0.5, 0.06, 0x8a6a3a, 0, -0.22, 0), box(0.2, 0.1, 0.1, 0x55595f, 0, -0.48, 0)); return g; }
  if (kind === "crafting") { const g = new THREE.Group(); g.position.set(0, -0.52, 0.05); g.add(box(0.05, 0.22, 0.05, 0x5a3a1e, 0, -0.08, 0), box(0.03, 0.18, 0.03, 0x9aa0a8, 0, -0.27, 0)); return g; }
  if (kind === "cooking") { const g = new THREE.Group(); g.position.set(0, -0.52, 0.05); g.add(box(0.05, 0.5, 0.05, 0x3a2a1a, 0, -0.22, 0), box(0.18, 0.03, 0.22, 0xc8ccd4, 0, -0.5, 0.06)); return g; }
  const g = new THREE.Group(); g.position.set(0, -0.52, 0.05);
  const wood = 0x6b4a26, steel = 0x9aa0a8;
  if (kind === "sword") { g.add(box(0.06, 0.18, 0.06, 0x5a3a1e, 0, -0.06, 0), box(0.26, 0.05, 0.08, 0xb89a3a, 0, -0.16, 0), box(0.05, 0.8, 0.12, 0xc8ccd4, 0, -0.58, 0)); return g; }
  if (kind === "staff") {
    g.add(box(0.06, 1.5, 0.06, 0x6b4a26, 0, -0.5, 0));
    const orb = box(0.18, 0.18, 0.18, 0x40a0ff, 0, -1.3, 0); Object.assign(orb.material, { emissive: new THREE.Color(0x2060ff), emissiveIntensity: 0.9 }); g.add(orb);
    return g;
  }
  if (kind === "mug") { g.add(box(0.16, 0.2, 0.16, 0xc89a3a, 0, -0.08, 0.06), box(0.15, 0.04, 0.15, 0xf2ecd8, 0, 0.03, 0.06)); return g; }
  if (kind === "fishing") { g.add(box(0.05, 1.9, 0.05, wood, 0, -0.9, 0)); return g; }
  g.add(box(0.07, 0.6, 0.07, wood, 0, -0.28, 0));
  if (kind === "smithing") g.add(box(0.26, 0.14, 0.14, 0x55595f, 0, -0.58, 0));
  if (kind === "mining") g.add(box(0.62, 0.08, 0.08, steel, 0, -0.56, 0));
  if (kind === "woodcutting") g.add(box(0.06, 0.24, 0.26, steel, 0, -0.52, 0.12));
  return g;
}

/** The arrow over a quest giver's head. */
export function hintArrow(color: number) {
  const g = new THREE.Group(), mat = new THREE.MeshLambertMaterial({ color, emissive: color, emissiveIntensity: 0.35, flatShading: true });
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.42, 4), mat); head.rotation.x = Math.PI; g.add(head);
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.32, 0.14), mat); shaft.position.y = 0.36; g.add(shaft);
  return g;
}

/** Bits that fly and fall: sparks, chips, splashes, fireworks. */
export type Bit = { m: THREE.Mesh; v: THREE.Vector3; life: number; rise?: boolean };
/** A mote of light that rises from someone praying. */
export function sparkle(scene: THREE.Scene, bits: Bit[], x: number, y: number, z: number) {
  const m = box(0.08, 0.08, 0.08, 0xa8d8ff, x + (Math.random() - 0.5) * 0.6, y, z + (Math.random() - 0.5) * 0.6);
  Object.assign(m.material, { emissive: new THREE.Color(0x6ab0ff), emissiveIntensity: 1, transparent: true, opacity: 0.85 });
  scene.add(m); bits.push({ m, v: new THREE.Vector3(0, 0.9 + Math.random() * 0.5, 0), life: 1.4, rise: true });
}
/** A puff of smoke that drifts up and away. */
export function smoke(scene: THREE.Scene, bits: Bit[], x: number, y: number, z: number) {
  const m = box(0.18, 0.18, 0.18, 0x8a8a8a, x + (Math.random() - 0.5) * 0.5, y, z + (Math.random() - 0.5) * 0.3);
  Object.assign(m.material, { transparent: true, opacity: 0.55 });
  scene.add(m); bits.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.7 + Math.random() * 0.4, (Math.random() - 0.5) * 0.3), life: 1.6, rise: true });
}
export function burst(scene: THREE.Scene, bits: Bit[], x: number, y: number, z: number, color: number, n: number, speed = 1, glow = false) {
  for (let i = 0; i < n; i++) {
    const m = box(0.07, 0.07, 0.07, color, x, y, z);
    if (glow || color === 0xffb030) Object.assign(m.material, { emissive: new THREE.Color(color), emissiveIntensity: 0.9 });
    scene.add(m);
    bits.push({ m, v: new THREE.Vector3((Math.random() - 0.5) * 2.4 * speed, (1.6 + Math.random() * 1.6) * speed, (Math.random() - 0.5) * 2.4 * speed), life: 0.45 + Math.random() * 0.2 * speed });
  }
}

/** The town from above, for the minimap: four pixels a tile. */
export const MM = 4;
/** A z on the minimap image. */
export const mmz = (z: number) => (z - Z0) * MM;
export function minimapImage() {
  const c = document.createElement("canvas"); c.width = W * MM; c.height = ROWS * MM;
  const g = c.getContext("2d")!;
  const css: Record<Tile, string> = { g: "#4a7a2c", p: "#7a6040", s: "#8a8478", w: "#2f5fa8", k: "#3a3624", d: "#1e1810" };
  for (let r = 0; r < ROWS; r++) for (let x = 0; x < W; x++) { g.fillStyle = css[TILES[r][x]]; g.fillRect(x * MM, r * MM, MM, MM); }
  for (const t of TREES) { g.fillStyle = t.kind === "dead" ? "#1a1612" : "#2f5a1e"; g.fillRect(t.x * MM - 2, mmz(t.z) - 2, 4, 4); }
  for (const b of BUILDINGS) { g.fillStyle = "#c8c0b0"; g.fillRect(b.x * MM, mmz(b.z), b.w * MM, b.d * MM); g.fillStyle = "#fff"; g.fillRect(b.x * MM, mmz(b.z), b.w * MM, 1); g.fillRect(b.x * MM, mmz(b.z), 1, b.d * MM); }
  return c;
}
