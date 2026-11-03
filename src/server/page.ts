// The page. In development Bun serves index.html itself, with hot reload. Otherwise it's built once at
// start with code splitting, so code only one page needs (the world's Three.js) loads when that page opens.
import { join } from "node:path";
import index from "../ui/index.html";
import { DEV, ROOT } from "./config";

export async function pageRoutes(dev = DEV): Promise<Record<string, Response | typeof index>> {
  if (dev) return { "/": index, "/item/*": index };
  const out = await Bun.build({ entrypoints: [join(ROOT, "src/ui/index.html")], target: "browser", splitting: true, minify: true, publicPath: "/" });
  if (!out.success) throw new AggregateError(out.logs, "couldn't build the page");
  const routes: Record<string, Response> = {};
  let html: Response | null = null;
  for (const o of out.outputs) {
    const name = o.path.replace(/^\.?\//, ""), body = await o.arrayBuffer();
    if (name.endsWith(".html")) html = new Response(body, { headers: { "content-type": "text/html;charset=utf-8", "cache-control": "no-store" } });
    // Chunk names carry their content's hash, so a browser keeps them.
    else routes[`/${name}`] = new Response(body, { headers: { "content-type": o.type, "cache-control": "public, max-age=31536000, immutable" } });
  }
  if (!html) throw new Error("the page build made no HTML");
  return { ...routes, "/": html, "/item/*": html };
}
