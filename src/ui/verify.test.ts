import { expect, test } from "bun:test";
import { orderChecks, slidesOf } from "./verify";

test("slides are the images of each check in order, with no video and no repeat in a check", () => {
  const c = (id: string, evidence: string[]) => ({ id, title: id, status: "pass", evidence });
  expect(slidesOf([c("a", ["1.png", "v.webm", "1.png"]), c("b", []), c("d", ["1.png", "log.txt", "2.jpg"])]).map((s) => `${s.check.id}/${s.file}`)).toEqual(["a/1.png", "d/1.png", "d/2.jpg"]);
});

test("acceptance criteria come first, in order, and fails lead inside a group", () => {
  const c = (id: string, criterion?: string, status = "pass") => ({ id, title: id, status, criterion });
  const r = { confirms: {} } as never;
  expect(orderChecks([c("x"), c("y", undefined, "fail"), c("ac10", "AC10"), c("ac2", "AC2"), c("ac2f", "AC2", "fail")], r).map((k) => k.id)).toEqual(["ac2f", "ac2", "ac10", "y", "x"]);
});
