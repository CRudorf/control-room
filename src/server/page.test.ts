import { describe, expect, test } from "bun:test";
import { pageRoutes } from "./page";

describe("pageRoutes, built", () => {
  test("every file the page loads is served, and Three.js waits for the world", async () => {
    const routes = await pageRoutes(false) as Record<string, Response>;
    const html = await routes["/"].clone().text();
    const refs = [...html.matchAll(/(?:src|href)="(\/[^"]+)"/g)].map((m) => m[1]).filter((r) => !r.startsWith("//"));
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) expect(routes[r]).toBeDefined();
    const entry = refs.find((r) => r.endsWith(".js"))!;
    expect(await routes[entry].clone().text()).not.toContain("WebGLRenderer");
    const chunks = await Promise.all(Object.entries(routes).filter(([k]) => k.endsWith(".js")).map(([, r]) => r.clone().text()));
    expect(chunks.some((c) => c.includes("WebGLRenderer"))).toBe(true);
    expect(await routes["/item/*"].clone().text()).toBe(html);
  }, 30000);
});
