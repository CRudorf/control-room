import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { issueKey, keyOfUrl, refusal, repoOfKey, toIssue, toSuggestion, type GhIssue } from "./tracker";
import { trackerKey } from "./keys";

const i = (over: Partial<GhIssue> = {}): GhIssue => ({ number: 12, title: "T", url: "u", updatedAt: "2030-01-01T00:00:00Z", labels: [{ name: "bug" }], assignees: [], ...over });
const LIST = ["me/control-room"];

describe("github tracker", () => {
  test("a key has the shape of any tracker key and finds its repo", () => {
    const k = issueKey("me/control-room", 12);
    expect(k).toBe("CONTROLROOM-12");
    expect(trackerKey(`fix/${k}-x`)).toBe(k);
    expect(repoOfKey("controlroom-12", LIST)).toEqual({ repo: "me/control-room", number: 12 });
    expect(repoOfKey("ABC-12", LIST)).toBeNull();
    expect(keyOfUrl("https://github.com/me/control-room/issues/12", LIST)).toBe(k);
    expect(keyOfUrl("https://github.com/other/control-room/issues/12", LIST)).toBeNull();
  });
  test("an assigned issue goes on the board; any open one is a suggestion", () => {
    expect(toIssue("me/x", i(), "me").mine).toBe(false);
    const a = i({ assignees: [{ login: "ME" }] });
    expect(toIssue("me/x", a, "me")).toMatchObject({ mine: true, category: "indeterminate", transitions: [] });
    expect(toSuggestion("me/x", a, "me", 0)).toMatchObject({ source: "a", assignee: "me", tracker: "github", labels: ["bug"] });
    expect(toSuggestion("me/x", i(), "me", 1).source).toBe("c");
  });
  test("setup refuses private names, other projects and a missing word list", () => {
    const yes = () => true;
    expect(refusal("me/x", ["secretco"], yes)).toBeNull();
    expect(refusal("SecretCo/x", ["secretco"], yes)).toContain("private");
    expect(refusal("me/x", ["secretco"], () => false)).toContain("isn't in this project");
    expect(refusal("me/x", null, yes)).toContain("no private word list");
    expect(refusal("nonsense", [], yes)).toContain("owner/name");
  });
});

describe("issue-guard.py", () => {
  const HOOK = resolve(import.meta.dir, "../../scripts/issue-guard.py");
  function config(list = "secretco\n") {
    const d = mkdtempSync(join(tmpdir(), "guard-"));
    if (list) writeFileSync(join(d, "public-blocklist.txt"), list);
    writeFileSync(join(d, "projects.json"), JSON.stringify({ public: { project: "personal" }, owners: { Mine: "personal", WorkOrg: "work" }, repos: { "work-repo": "work" }, projects: { personal: {}, work: {} } }));
    return d;
  }
  function run(command: string, dir = config(), cwd = tmpdir(), tool_name = "Bash", tool_input: object = { command }) {
    const r = Bun.spawnSync(["python3", HOOK], { stdin: Buffer.from(JSON.stringify({ tool_name, tool_input, cwd })), env: { ...process.env, CR_CONFIG_DIR: dir } });
    return { code: r.exitCode, err: r.stderr.toString() };
  }
  test("clean issue writes and other commands pass", () => {
    expect(run('gh issue create -R me/x --title "ok" --body "fine"').code).toBe(0);
    expect(run("echo secretco").code).toBe(0);
    expect(run("gh issue list -R secretco/x").code).toBe(0);
  });
  test("a private word in the text, the target or another project's name blocks, and the word isn't repeated", () => {
    const r = run('gh issue create -R me/x --title "for SecretCo" --body "b"');
    expect(r.code).toBe(2);
    expect(r.err).not.toContain("SecretCo");
    expect(run('gh issue comment 1 -R me/x --body "see workorg"').code).toBe(2);
    expect(run('gh issue edit 1 -R me/x --title "in work-repo"').code).toBe(2);
    expect(run("gh api repos/secretco/x/issues -f title=a").code).toBe(2);
  });
  test("a body file is read, and an unreadable one blocks", () => {
    const d = mkdtempSync(join(tmpdir(), "body-"));
    writeFileSync(join(d, "b.md"), "about SECRETCO"); writeFileSync(join(d, "ok.md"), "fine");
    expect(run("gh issue create -R me/x -t a --body-file b.md", config(), d).code).toBe(2);
    expect(run("gh issue create -R me/x -t a --body-file ok.md", config(), d).code).toBe(0);
    expect(run("gh issue create -R me/x -t a --body-file nope.md", config(), d).code).toBe(2);
  });
  test("with no -R the clone's origin counts", () => {
    const d = mkdtempSync(join(tmpdir(), "clone-"));
    Bun.spawnSync(["git", "init", "-q"], { cwd: d });
    Bun.spawnSync(["git", "remote", "add", "origin", "https://github.com/WorkOrg/x.git"], { cwd: d });
    expect(run('gh issue create --title a --body b', config(), d).code).toBe(2);
    expect(run('gh issue create -R me/x --title a --body b', config(), d).code).toBe(0);
  });
  test("no word list blocks every issue write; issue tools from MCP are scanned", () => {
    expect(run('gh issue create -R me/x --title a', config("")).code).toBe(2);
    expect(run("", config(), tmpdir(), "mcp__github__create_issue", { title: "SecretCo" }).code).toBe(2);
    expect(run("", config(), tmpdir(), "mcp__github__create_issue", { title: "ok" }).code).toBe(0);
    expect(run("", config(), tmpdir(), "mcp__other__search", { q: "SecretCo" }).code).toBe(0);
  });
});
