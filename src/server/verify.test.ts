import { expect, test } from "bun:test";
import { sh, carried, fernetKey, findLogEmails, fill, liveState, projectDirOf, resetChecks, roundCommits, runFile, stopCommands, transcriptText, stagesOf, summarize, type Check, type Profile } from "./verify";

const c = (id: string, status: Check["status"]): Check => ({ id, title: id, status });

test("a check counts only with Pat's verdict, and a fail or a rejection counts as failing", () => {
  const checks = [c("a", "pass"), c("b", "pass"), c("d", "fail"), c("e", "not-compared")];
  expect(summarize({ checks, confirms: {} })).toEqual({ total: 4, confirmed: 0, failing: 1, open: 3 });
  const at = "t";
  expect(summarize({ checks, confirms: { a: { verdict: "confirmed", at }, b: { verdict: "rejected", at } } })).toEqual({ total: 4, confirmed: 1, failing: 2, open: 1 });
});
test("a run file can't leave its folder", () => {
  expect(runFile("../x", "a.png")).toBeNull();
  expect(runFile("x", "../../token")).toBeNull();
  expect(runFile("x", "/etc/passwd")).toBeNull();
});
test("fill puts the run's values in the profile", () => expect(fill("sqlite:///{worktree}/d:{port}", { worktree: "/w", port: "1" })).toBe("sqlite:////w/d:1"));

test("the stages say what the run is doing now", () => {
  const now = (r: Parameters<typeof stagesOf>[0], c: Parameters<typeof stagesOf>[1] = [], v = {}, st: string | null = null) => stagesOf(r, c, v, st).find((s) => s.state === "now" || s.state === "failed");
  expect(now({ state: "starting", agent: null, error: null })?.name).toBe("Set up");
  expect(now({ state: "failed", agent: null, error: "x" })).toMatchObject({ name: "Set up", state: "failed" });
  expect(now({ state: "running", agent: "a", error: null }, [], {}, "working")?.name).toBe("Agent testing");
  expect(now({ state: "running", agent: "a", error: null }, [{ id: "x", status: "pending" }], {}, "idle")?.name).toBe("Agent testing");
  expect(now({ state: "running", agent: "a", error: null }, [{ id: "x", status: "pass" }], {}, "idle")?.name).toBe("Your verdicts");
  expect(now({ state: "running", agent: "a", error: null }, [{ id: "x", status: "pass" }], { x: 1 }, "idle")).toBeUndefined();
});

test("a transcript reads as text, with its tools and results", () => {
  const t = transcriptText([
    JSON.stringify({ type: "permission-mode" }),
    JSON.stringify({ type: "user", timestamp: "T1", message: { content: "go" } }),
    JSON.stringify({ type: "assistant", timestamp: "T2", message: { content: [{ type: "text", text: "Reading" }, { type: "tool_use", name: "Bash", input: { command: "ls" } }] } }),
    JSON.stringify({ type: "user", message: { content: [{ type: "tool_result", content: "x".repeat(2000) }] } }),
    "not json",
  ].join("\n"));
  expect(t).toContain("USER:\ngo");
  expect(t).toContain('TOOL Bash:\n{"command":"ls"}');
  expect(t).toContain("(500 more)");
  expect(t).not.toContain("permission-mode");
});
test("a working directory maps to its project folder", () => expect(projectDirOf("/a/b.c/d")).toEndWith("/.claude/projects/-a-b-c-d"));

test("emails in a log are found, grouped and masked", () => {
  const log = ['{"name": "a.b", "message": "sent to pat@example.com"}', '{"name": "a.b", "message": "sent to sam@x.co.uk"}', "plain line kim@y.org", '{"name":"c","message":"no address, 1.2@3"}'].join("\n");
  const f = findLogEmails(log);
  expect(f[0]).toEqual({ logger: "a.b", message: "sent to <email>", count: 2 });
  expect(f[1]).toMatchObject({ logger: "unknown", message: "plain line <email>" });
  expect(f.length).toBe(2);
  expect(JSON.stringify(f)).not.toContain("example.com");
});

test("a run's form key is in Fernet's format", () => {
  const k = fernetKey();
  expect(k).toMatch(/^[A-Za-z0-9_-]{43}=$/);
  expect(Buffer.from(k.replace(/-/g, "+").replace(/_/g, "/"), "base64").length).toBe(32);
});

test("a local run stops with its app; a run on another machine lives until it is stopped", () => {
  const dead = () => false;
  expect(liveState({ state: "running", machine: null, pid: 42 }, dead)).toBe("stopped");
  expect(liveState({ state: "running", machine: "box", pid: null }, dead)).toBe("running");
  expect(liveState({ state: "stopped", machine: "box", pid: null }, dead)).toBe("stopped");
});

test("a round records every repo's commit: the last round's, then the ones named now, then its own", () => {
  expect(roundCommits(null, "pms", "c1")).toEqual({ pms: "c1" });
  const prev = { repo: "bh", commit: "b1", commits: { bh: "b1", dha: "d1", pms: "p1" } };
  expect(roundCommits(prev, "pms", "p2")).toEqual({ bh: "b1", dha: "d1", pms: "p2" });
  expect(roundCommits(prev, "pms", "p2", { dha: "d2" })).toEqual({ bh: "b1", dha: "d2", pms: "p2" });
  expect(roundCommits({ repo: "bh", commit: "b0" }, "pms", "p1")).toEqual({ bh: "b0", pms: "p1" });
});

test("a new round gets the last round's scripts and data, and its checks pending with no evidence", () => {
  expect(carried(["pms.cjs", "reset-env.sh", "data_bh.py", "test-data-core.sql", "conditions.md", "run.json", "results.json", "confirm.json", "server.log", "a.png", "transcript.txt"]))
    .toEqual(["pms.cjs", "reset-env.sh", "data_bh.py", "test-data-core.sql", "conditions.md"]);
  const checks: Check[] = [{ id: "a", title: "A", criterion: "1", status: "fail", note: "x", evidence: ["a.png"] }];
  expect(resetChecks(checks)).toEqual([{ id: "a", title: "A", criterion: "1", status: "pending" }]);
});

test("stopping a round clears each machine its change ran on, once; a local round has none", () => {
  const remote = (machine: string, stop: string[]): Profile => ({ setup: [], start: [], health: "", remote: { machine, url: "u", check: ["true"], stop } });
  const profiles: Record<string, Profile> = { bh: remote("box", ["box.sh"]), dha: remote("box", ["box.sh"]), pms: remote("win", ["win.sh"]) };
  expect(stopCommands({ repo: "pms", machine: "win", commits: { bh: "1", dha: "2", pms: "3" } }, (r) => profiles[r] ?? null)).toEqual([["win.sh"], ["box.sh"]]);
  expect(stopCommands({ repo: "bh", machine: null, commits: { bh: "1" } }, (r) => profiles[r] ?? null)).toEqual([]);
});

test("each setup command adds to the log instead of writing over it", async () => {
  const dir = require("node:fs").mkdtempSync(require("node:path").join(require("node:os").tmpdir(), "vlog-"));
  const log = `${dir}/setup.log`;
  await sh(["echo", "first command"], dir, log);
  await sh(["echo", "second"], dir, log);
  expect(require("node:fs").readFileSync(log, "utf8")).toBe("first command\nsecond\n");
});
