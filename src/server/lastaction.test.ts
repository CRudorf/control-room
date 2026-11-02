import { describe, expect, test } from "bun:test";
import type { WorkItem } from "../shared/types";
import { lastAction } from "./lastaction";

const pr = (over: object = {}) => ({ repo: "acme/widgets", number: 7, last_activity: "2030-01-02T00:00:00Z", last_push: "2030-01-01T00:00:00Z", feedback: [], ...over });
const it = (over: object = {}) => ({ prs: [pr()], agents: [], ...over }) as unknown as Pick<WorkItem, "prs" | "agents">;

describe("last action", () => {
  test("the newest of pushes, comments and feedback, bots included", () => {
    expect(lastAction(it())).toEqual({ at: "2030-01-02T00:00:00Z", what: "comment or review on widgets#7" });
    expect(lastAction(it({ prs: [pr({ last_activity: "2030-01-01T00:00:00Z" })] }))?.what).toBe("push to widgets#7");
    expect(lastAction(it({ prs: [pr({ feedback: [{ who: "review-bot", at: "2030-01-03T00:00:00Z" }] })] }))?.what).toBe("review-bot on widgets#7");
  });
  test("an agent: working is now, otherwise when it changed; unknown times don't count", () => {
    expect(lastAction(it({ agents: [{ name: "cr-a", status: "working", since: null }] }))).toMatchObject({ what: "cr-a is working", now: true });
    expect(lastAction(it({ agents: [{ name: "cr-a", status: "done", since: "2030-01-04T00:00:00Z" }] }))?.what).toBe("cr-a finished");
    expect(lastAction(it({ agents: [{ name: "cr-a", status: "idle", since: null }] }))?.what).toBe("comment or review on widgets#7");
  });
  test("the user's own control room action counts; nothing timed is null", () => {
    expect(lastAction(it(), { at: "2030-01-05T00:00:00Z", action: "start-agent" })?.what).toBe("you: start agent (control room)");
    expect(lastAction({ prs: [], agents: [] } as unknown as Pick<WorkItem, "prs" | "agents">)).toBeNull();
  });
});
