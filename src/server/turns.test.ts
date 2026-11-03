import { describe, expect, test } from "bun:test";
import { lastTurn, withTitles } from "./turns";

const line = (o: object) => JSON.stringify(o);
const user = (content: unknown) => line({ type: "user", message: { role: "user", content } });
const said = (t: string, at = "2030-01-01T00:00:00Z") => line({ type: "assistant", timestamp: at, message: { content: [{ type: "text", text: t }] } });
const tool = () => line({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: {} }] } });
const result = () => user([{ type: "tool_result", content: "ok" }]);

describe("withTitles", () => {
  const prs = [{ repo: "acme/widgets", number: 7, title: "ABC-1: cache the cart" }, { repo: "acme/gadgets", number: 7, title: "a gadget" }, { repo: "acme/widgets", number: 12, title: "x".repeat(80) }];
  test("a PR number gets its title, once, without the ticket key", () => {
    expect(withTitles("pushed widgets#7, then widgets#7 again", prs)).toBe("pushed widgets#7 (cache the cart), then widgets#7 again");
  });
  test("a bare number only when it's one PR's; long titles cut", () => {
    expect(withTitles("see #7", prs)).toBe("see #7");
    expect(withTitles("see #12", prs)).toBe(`see #12 (${"x".repeat(59)}…)`);
    expect(withTitles("see #99", prs)).toBe("see #99");
  });
});

describe("lastTurn", () => {
  test("everything the agent wrote since the user's last message, and the newest recap", () => {
    const t = [
      user("first ask"), said("old answer"),
      line({ type: "system", subtype: "away_summary", content: "Fixed the cart.", timestamp: "2030-01-01T00:00:01Z" }),
      user("now push it"), said("Pushing."), tool(), result(), said("Pushed to main.", "2030-01-01T00:00:09Z"),
    ].join("\n");
    expect(lastTurn(t)).toEqual({ recap: "Fixed the cart.", recapAt: "2030-01-01T00:00:01Z", turn: "Pushing.\n\nPushed to main.", at: "2030-01-01T00:00:09Z" });
  });
  test("tool results and command wrappers don't start a new turn", () => {
    const t = [user("go"), said("one"), result(), user("<command-name>/clear</command-name>"), said("two")].join("\n");
    expect(lastTurn(t).turn).toBe("one\n\ntwo");
  });
  test("a long turn keeps its end", () => {
    expect(lastTurn(said("x".repeat(50) + "END"), 10).turn).toBe("…xxxxxxxEND");
  });
  test("nothing said yet, or a broken line, is no turn", () => {
    expect(lastTurn([user("hi"), "{not json"].join("\n"))).toEqual({ recap: null, recapAt: null, turn: null, at: null });
  });
});
