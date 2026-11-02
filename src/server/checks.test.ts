import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { checkLine, checksFor, readCheck, reposWithoutChecks, checkHookPrompt } from "./checks";

const HOOK = resolve(import.meta.dir, "../../scripts/stop-check.sh");
const git = (cwd: string, ...a: string[]) => Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd });
function repo(checks: string) {
  const d = mkdtempSync(join(tmpdir(), "stopcheck-"));
  git(d, "init", "-q", "-b", "feat/x");
  mkdirSync(join(d, ".claude"));
  writeFileSync(join(d, ".claude", "stop-checks"), checks);
  git(d, "add", "."); git(d, "commit", "-qm", "c");
  return d;
}
function run(cwd: string, dir: string, input = "{}") {
  const r = Bun.spawnSync(["bash", HOOK], { cwd, stdin: Buffer.from(input), env: { ...process.env, CR_CHECKS_DIR: dir } });
  return { code: r.exitCode, err: r.stderr.toString() };
}
const folder = () => mkdtempSync(join(tmpdir(), "checks-"));

describe("stop-check.sh", () => {
  test("a pass exits 0 and records the commands", () => {
    const d = repo("true\n# a comment\n"), dir = folder();
    writeFileSync(join(d, "new.txt"), "x");
    expect(run(d, dir).code).toBe(0);
    const name = readdirSync(dir)[0];
    const r = JSON.parse(readFileSync(join(dir, name), "utf8"));
    expect(r.ok).toBe(true);
    expect(r.branch).toBe("feat/x");
    expect(r.commands).toEqual([{ command: "true", exit: 0 }]);
  });
  test("a failure exits 2 and tells the agent why", () => {
    const d = repo('echo "boom \\"quoted\\""; exit 3\n'), dir = folder();
    writeFileSync(join(d, "new.txt"), "x");
    const r = run(d, dir);
    expect(r.code).toBe(2);
    expect(r.err).toContain("boom");
    const rec = JSON.parse(readFileSync(join(dir, readdirSync(dir)[0]), "utf8"));
    expect(rec.ok).toBe(false);
    expect(rec.commands[0].exit).toBe(3);
  });
  test("a second stop lets the agent go, and the record stays red", () => {
    const d = repo("false\n"), dir = folder();
    writeFileSync(join(d, "new.txt"), "x");
    expect(run(d, dir, '{"stop_hook_active": true}').code).toBe(0);
    expect(JSON.parse(readFileSync(join(dir, readdirSync(dir)[0]), "utf8")).ok).toBe(false);
  });
  test("without the control room's folder it still checks and writes nothing", () => {
    const d = repo("false\n"), dir = join(folder(), "none");
    writeFileSync(join(d, "new.txt"), "x");
    expect(run(d, dir).code).toBe(2);
    expect(existsSync(dir)).toBe(false);
  });
  test("the item reads what the hook wrote, by branch", () => {
    const d = repo("true\n"), dir = folder();
    writeFileSync(join(d, "new.txt"), "x");
    run(d, dir);
    const short = readdirSync(dir)[0].split("__")[0];
    const c = readCheck(`acme/${short}`, "feat/x", dir)!;
    expect(c.ok).toBe(true);
    expect(checkLine(c)).toContain("passed");
    expect(checksFor([{ repo: `acme/${short}`, branch: "feat/x" }, { repo: short, branch: "feat/x" }], dir)).toHaveLength(1);
  });
});

test("only repos checked out here can be a gap", () => {
  expect(reposWithoutChecks(["a/x", "a/y", "a/z", "a/x"], (r) => r === "a/y", (r) => r !== "a/z")).toEqual(["a/x"]);
});
test("the prompt adds the hook in a draft PR and proves both exits", () => {
  const p = checkHookPrompt("acme/widgets");
  expect(p).toContain("stop-check.sh");
  expect(p).toContain("exit 2");
  expect(p).toContain("Never merge");
});
