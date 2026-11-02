import { expect, test } from "bun:test";
import { fernetKey, findLogEmails, fill, projectDirOf, runFile, transcriptText, stagesOf, summarize, type Check } from "./verify";

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
