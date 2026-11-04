import { describe, expect, test } from "bun:test";
import { codeSpans, linkify, targetOf } from "./guidelinks";

describe("targetOf", () => {
  test("a file, with or without its lines", () => {
    expect(targetOf("WidgetHandler.kt:116-121")).toEqual({ kind: "file", path: "WidgetHandler.kt", from: 116, to: 121 });
    expect(targetOf("useWidgets.ts:334")).toEqual({ kind: "file", path: "useWidgets.ts", from: 334, to: null });
    expect(targetOf("api/.../WidgetHandler.kt:116")).toEqual({ kind: "file", path: "WidgetHandler.kt", from: 116, to: null });
    expect(targetOf("src/pages/Widgets/widgetRules.ts")).toEqual({ kind: "file", path: "src/pages/Widgets/widgetRules.ts", from: null, to: null });
  });
  test("a single name, with or without a call", () => {
    expect(targetOf("classifyWidgetError")).toEqual({ kind: "name", name: "classifyWidgetError" });
    expect(targetOf("widgetStep()")).toEqual({ kind: "name", name: "widgetStep" });
  });
  test("anything else isn't looked up", () => {
    expect(targetOf("widgetExists is false")).toBeNull();
    expect(targetOf("409")).toBeNull();
    expect(targetOf("1.2.3")).toBeNull();
    expect(targetOf("id")).toBeNull();
  });
});

describe("linkify", () => {
  const page = `<p>See <code>widgetStep</code> and <a href="x"><code>kept</code></a>.</p><script>const c = "<code>no</code>";</script><code>a &amp;&amp; b</code>`;
  test("finds code spans outside links and scripts", () => {
    expect(codeSpans(page)).toEqual(["widgetStep", "a && b"]);
  });
  test("wraps only the spans it has a link for", () => {
    const out = linkify(page, (c) => (c === "widgetStep" ? "https://github.com/o/r/blob/s/a.ts#L3" : null));
    expect(out).toContain(`<a class="cr-code" href="https://github.com/o/r/blob/s/a.ts#L3" target="_blank" rel="noreferrer"><code>widgetStep</code></a>`);
    expect(out).toContain(`<a href="x"><code>kept</code></a>`);
    expect(out).toContain(`"<code>no</code>"`);
  });
});
