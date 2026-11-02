import { afterEach, describe, expect, test } from "bun:test";
import type { PrRow } from "../shared/types";
import { db } from "./db";
import { note, read, setAdapter, write, type Adapter, type Spawned } from "./runner";
import { markAddressed } from "./actions";
import { writeFileSync } from "node:fs";
import { guideFile, metaFile } from "./review";
import { linkGuide } from "./guides";

type Row = { action: string; trigger: string; work_item: string | null; sent: string; result: string; dry_run: number; drafted: string | null };
const last = () => db.query<Row, []>("SELECT * FROM action_records ORDER BY id DESC LIMIT 1").get()!;

/** A fake adapter: records each command and answers from `reply`. */
function fake(reply: (cmd: string[]) => Spawned | "hang" = () => ({ out: "", err: "", code: 0 })) {
  const calls: string[][] = [];
  const adapter: Adapter = (cmd, o) => {
    calls.push(cmd);
    const r = reply(cmd);
    if (r === "hang") return new Promise((_, reject) => o.signal.addEventListener("abort", () => reject(new Error("killed"))));
    return Promise.resolve(r);
  };
  return { calls, adapter };
}

afterEach(() => setAdapter(null));

describe("read", () => {
  test("returns stdout", async () => {
    const f = fake(() => ({ out: "hello\n", err: "", code: 0 }));
    setAdapter(f.adapter, false);
    expect(await read(["gh", "api", "user"])).toBe("hello\n");
    expect(f.calls).toEqual([["gh", "api", "user"]]);
  });

  test("throws with the last 3 stderr lines, or the exit code", async () => {
    setAdapter(fake(() => ({ out: "", err: "a\nb\nc\nd\n", code: 1 })).adapter, false);
    await expect(read(["gh"])).rejects.toThrow("b c d");
    setAdapter(fake(() => ({ out: "", err: "", code: 2 })).adapter, false);
    await expect(read(["gh"])).rejects.toThrow("gh exited 2");
  });

  test("kills the command and throws on timeout", async () => {
    setAdapter(fake(() => "hang").adapter, false);
    await expect(read(["gh"], { timeoutMs: 20 })).rejects.toThrow("gh timed out after 20 ms");
  });
});

describe("write", () => {
  const ctx = { item: "item-1", trigger: "test" };

  test("outside dev runs the command and records done or the returned string", async () => {
    const f = fake();
    setAdapter(f.adapter, false);
    expect(await write(ctx, "t-array", "s1", ["gh", "x"])).toBe("done");
    expect(last()).toMatchObject({ action: "t-array", trigger: "test", work_item: "item-1", sent: "s1", result: "done", dry_run: 0 });
    expect(await write(ctx, "t-fn", "s2", async () => "merged base", { drafted: "d" })).toBe("merged base");
    expect(last()).toMatchObject({ action: "t-fn", result: "merged base", drafted: "d" });
    expect(f.calls).toEqual([["gh", "x"]]);
  });

  test("records failed: <msg> and rethrows", async () => {
    setAdapter(fake(() => ({ out: "", err: "boom", code: 1 })).adapter, false);
    await expect(write(ctx, "t-fail", "s", ["gh"])).rejects.toThrow("boom");
    await Bun.sleep(0);
    expect(last()).toMatchObject({ action: "t-fail", result: "failed: boom" });
  });

  test("in dev records a dry run and runs nothing, unless liveInDev", async () => {
    const f = fake();
    setAdapter(f.adapter, true);
    expect(await write(ctx, "t-dev", "s", ["gh", "edit"])).toBe("dry run");
    expect(last()).toMatchObject({ action: "t-dev", result: "dry run", dry_run: 1 });
    expect(f.calls).toEqual([]);
    expect(await write(ctx, "t-live", "s", ["aws"], { liveInDev: true })).toBe("done");
    expect(f.calls).toEqual([["aws"]]);
  });
});

test("note records without a command", () => {
  const f = fake();
  setAdapter(f.adapter, false);
  note({ item: null, trigger: "detail" }, "park", "item-2", "parked");
  expect(last()).toMatchObject({ action: "park", trigger: "detail", sent: "item-2", result: "parked", dry_run: 0 });
  expect(f.calls).toEqual([]);
});

describe("callers write through the runner", () => {
  const pr = { repo: "acme/widgets", number: 7 } as PrRow;

  test("actions: the addressed mark", async () => {
    const f = fake();
    setAdapter(f.adapter, false);
    expect(await markAddressed({ item: "i", trigger: "detail" }, pr, "seen")).toBe("marked");
    expect(f.calls[0].slice(2)).toEqual(["mark", "acme/widgets#7", "addressed", "seen"]);
    expect(last()).toMatchObject({ action: "mark-addressed", sent: "acme/widgets#7", result: "marked" });
  });

  test("guides: the PR body edit", async () => {
    writeFileSync(guideFile("acme/widgets#7"), "<html></html>");
    writeFileSync(metaFile("acme/widgets#7"), JSON.stringify({ sha: "h", at: "2030-01-01T00:00:00Z", url: "https://claude.ai/artifact/x" }));
    const f = fake((cmd) => ({ out: cmd[2] === "view" ? "the body\n" : "", err: "", code: 0 }));
    setAdapter(f.adapter, false);
    expect(await linkGuide(pr)).toEqual({ linked: "https://claude.ai/artifact/x" });
    expect(f.calls.map((c) => c.slice(0, 3))).toEqual([["gh", "pr", "view"], ["gh", "pr", "edit"]]);
    expect(f.calls[1].at(-1)).toBe("the body\n\nField guide: https://claude.ai/artifact/x");
    expect(last()).toMatchObject({ action: "link-guide", sent: "acme/widgets#7", result: "linked" });
  });
});

test("a command sees the environment this project set after startup", async () => {
  setAdapter(null, false);
  process.env.CR_ENV_PROOF = "project-value";
  expect((await read(["sh", "-c", "echo $CR_ENV_PROOF"])).trim()).toBe("project-value");
  delete process.env.CR_ENV_PROOF;
});
