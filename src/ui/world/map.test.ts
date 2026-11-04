import { describe, expect, test } from "bun:test";
import { ASKING, BOARD_STAND, BURNING, PRAYING, BUILDINGS, buildingAt, doorOf, DUELS, findPath, heightAt, inWild, riverX, SEATS, SPOTS, tileAt, walkable } from "./map";

/** Every point along a path, sampled finely, from a start. */
const along = (fx: number, fz: number, path: [number, number][]) => {
  const pts: [number, number][] = [];
  let [ax, az] = [fx, fz];
  for (const [bx, bz] of path) { for (let k = 0; k <= 20; k++) pts.push([ax + ((bx - ax) * k) / 20, az + ((bz - az) * k) / 20]); [ax, az] = [bx, bz]; }
  return pts;
};
const inn = BUILDINGS.find((b) => b.id === "sessions")!;

describe("findPath", () => {
  test("into a building only through its door", () => {
    const seat = SEATS[0], path = findPath(24, 22, seat.x, seat.z), d = doorOf(inn);
    expect(path.length).toBeGreaterThan(1);
    // Where the path crosses the door wall's line, it's in the doorway.
    const pts = along(24, 22, path);
    for (let k = 1; k < pts.length; k++) {
      const [ax, az] = pts[k - 1], [bx, bz] = pts[k];
      if ((az - d.z) * (bz - d.z) < 0) expect(Math.abs((ax + bx) / 2 - d.x)).toBeLessThan(0.7);
    }
    expect(path.at(-1)).toEqual([seat.x, seat.z]);
  });
  test("never through walls or water", () => {
    const path = findPath(30, 3, 3 + riverX(30) + 2.1, 30);
    // The last leg reaches a goal inside something from beside it; everything before is on open ground.
    for (const [x, z] of along(30, 3, path.slice(0, -1))) expect(walkable(x, z)).toBe(true);
  });
  test("across the river by the causeway", () => {
    const path = findPath(riverX(10) - 3, 10, riverX(10) + 3, 10);
    expect(path.length).toBeGreaterThan(1);
    const pts = along(riverX(10) - 3, 10, path.slice(0, -1));
    expect(pts.some(([, z]) => z > 18.5 && z < 21)).toBe(true);
    for (const [x, z] of pts) expect(tileAt(x, z)).not.toBe("w");
  });
  test("a straight line when nothing's in the way", () => {
    expect(findPath(22, 27, 26, 27)).toEqual([[26, 27]]);
  });
});

describe("the town", () => {
  test("every work spot, seat and waiting place can be reached from the square", () => {
    for (const s of [...Object.values(SPOTS).flat(), ...SEATS, ...PRAYING, ...BURNING, { x: BOARD_STAND[0], z: BOARD_STAND[1] }, ...ASKING.map(([x, z]) => ({ x, z })), ...DUELS.flatMap(([x, z]) => [{ x: x - 0.75, z }, { x: x + 0.75, z }])]) expect(findPath(24, 23, s.x, s.z).length).toBeGreaterThan(0);
  });
  test("the Wilderness lies north, past a ditch you can cross", () => {
    expect([tileAt(30, -8), tileAt(30, 1), tileAt(30, 3)]).toEqual(["k", "d", "g"]);
    expect([inWild(-8), inWild(3)]).toEqual([true, false]);
    const path = findPath(24, 23, 24, -10);
    expect(path.at(-1)).toEqual([24, -10]);
    expect(along(24, 23, path).some(([, z]) => z > 0.9 && z < 2.1)).toBe(true);
  });
  test("floors are flat inside buildings", () => {
    expect(buildingAt(16, 31)?.id).toBe("sessions");
    expect(heightAt(16, 31)).toBe(heightAt(13, 29));
  });
});
