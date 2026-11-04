import { describe, expect, test } from "bun:test";
import { complexityOf, effortOf, prPoints } from "./effort";
import type { PrRow } from "./types";

const size = (paths: [string, number][], commits = 1) => ({ add: paths.reduce((n, [, l]) => n + l, 0), del: 0, files: paths.length, commits, paths });
const many = (n: number, lines: number, dir = "src/a") => Array.from({ length: n }, (_, i) => [`${dir}/f${i}.ts`, lines] as [string, number]);

describe("complexityOf", () => {
  test("size bands: under 50 lines is light, 200-399 standard", () => {
    expect(complexityOf(size([["src/a/x.ts", 40]])).tier).toBe("light");
    expect(complexityOf(size([["src/a/x.ts", 250]]))).toMatchObject({ tier: "standard", score: 2 });
  });
  test("lockfiles and generated files don't count", () => {
    expect(complexityOf(size([["src/a/x.ts", 20], ["package-lock.json", 4000], ["src/__generated__/api.ts", 900]])).tier).toBe("light");
  });
  test("files, areas and commits add up to deep", () => {
    const c = complexityOf(size([...many(6, 30, "src/a"), ...many(4, 30, "src/b"), ...many(2, 30, "lib/c")], 7));
    expect(c.reasons).toEqual(["360 lines", "12 files", "3 areas", "7 commits"]);
    expect(c).toMatchObject({ tier: "deep", score: 5 });
  });
  test("one sensitive category is named but scores nothing; two score 2", () => {
    expect(complexityOf(size([["src/auth/login.ts", 60]]))).toMatchObject({ score: 1, reasons: ["60 lines", "touches auth"] });
    expect(complexityOf(size([["src/auth/login.ts", 60], ["src/billing/charge.ts", 60]])).score).toBe(3);
  });
  test("a migration or infra change is at least deep", () => {
    expect(complexityOf(size([["db/migrations/001_add.sql", 10]])).tier).toBe("deep");
    expect(complexityOf(size([["infra/main.tf", 10]])).tier).toBe("deep");
  });
  test("tests or docs only stay light", () => {
    expect(complexityOf(size([...many(12, 80, "tests")])).tier).toBe("light");
    expect(complexityOf(size([["docs/guide.md", 900]])).tier).toBe("light");
  });
  test("a file a past PR broke scores 2", () => {
    expect(complexityOf(size([["src/a/x.ts", 60]]), ["src/a/x.ts"])).toMatchObject({ score: 3, tier: "standard" });
  });
  test("treatments by tier, and a browser test for anything that needs running", () => {
    expect(complexityOf(size([["src/a/x.ts", 250]])).treatments).toEqual(["guide"]);
    expect(complexityOf(size([["src/a/X.tsx", 20]]))).toMatchObject({ tier: "light", treatments: ["verify"], runtime: "changes UI" });
    expect(complexityOf(size([["src/a/x.ts", 1200], ...many(11, 10, "src/b"), ["lib/c/d.ts", 1]], 9)).treatments).toEqual(["guide", "verify", "chart", "video"]);
  });
});

describe("effort", () => {
  const pr = (o: Partial<PrRow>): PrRow => ({ repo: "o/r", number: 1, role: "requested", checks: "SUCCESS", merge_state: "CLEAN", review_decision: null, draft: false, ...o } as PrRow);
  const scored = (lines: number, o: Partial<PrRow> = {}) => { const s = size([["src/a/x.ts", lines]]); return pr({ size: s, complexity: complexityOf(s), ...o }); };
  test("a review is worth its complexity points, at least 1", () => {
    expect(prPoints(scored(250))).toEqual({ points: 2, reasons: ["standard review of #1: 2 pts"] });
    expect(prPoints(scored(20)).points).toBe(1);
  });
  test("a re-review after a push is half, rounded up", () => {
    expect(prPoints(scored(450, { prior: "commented", pushed_since: true })).points).toBe(2);
  });
  test("the user's own PR is worth what's left on it", () => {
    const p = pr({ role: "mine", checks: "FAILURE", merge_state: "DIRTY", feedback: [{ kind: "thread", outdated: false }, { kind: "thread", outdated: true }] as never });
    expect(prPoints(p)).toEqual({ points: 3, reasons: ["1 thread to answer on #1: 1 pt", "CI failing on #1: 1 pt", "conflicts on #1: 1 pt"] });
  });
  test("points sum to a size on the tiers' cut-offs; no size without a PR", () => {
    expect(effortOf({ prs: [pr({ role: "mine", state: "merge" })] })).toMatchObject({ points: 1, size: "S" });
    expect(effortOf({ prs: [scored(250), scored(60)] })).toMatchObject({ points: 3, size: "M" });
    expect(effortOf({ prs: [scored(1500)] })?.size).toBe("L");
    expect(effortOf({ prs: [scored(1500), scored(450)] })?.size).toBe("XL");
    expect(effortOf({ prs: [] })).toBeNull();
  });
});
