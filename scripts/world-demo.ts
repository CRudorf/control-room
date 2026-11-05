// Builds the World demo (src/ui/world/demo-page.tsx) into one self-contained HTML file to show people: the script,
// the board's base styles, the World's, and the skin's, all inline. Usage: bun scripts/world-demo.ts <skin> <out.html>
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [skin = "osrs", out = "world-demo.html"] = process.argv.slice(2);
const ui = join(import.meta.dir, "..", "src", "ui");
const built = await Bun.build({ entrypoints: [join(ui, "world", "demo-page.tsx")], target: "browser", minify: true, splitting: false, define: { "process.env.NODE_ENV": '"production"' } });
if (!built.success) { for (const l of built.logs) console.error(l); process.exit(1); }
const js = (await Promise.all(built.outputs.filter((o) => o.kind === "entry-point" || o.path.endsWith(".js")).map((o) => o.text()))).join("\n");
const bundledCss = (await Promise.all(built.outputs.filter((o) => o.path.endsWith(".css")).map((o) => o.text()))).join("\n");
const css = [readFileSync(join(ui, "styles.css"), "utf8"), readFileSync(join(ui, "world", "world.css"), "utf8"), skin === "osrs" || skin === "wasteland" ? readFileSync(join(ui, "skins", `${skin}.css`), "utf8") : "", bundledCss].join("\n");
const fonts = "https://fonts.googleapis.com/css2?family=Archivo:wght@400;600;700;800&family=Archivo+Narrow:wght@500;600;700&family=Pixelify+Sans&family=VT323&family=Share+Tech+Mono&display=swap";
// Page content only: a host such as a claude.ai artifact wraps it in its own document, and browsers open it as is.
// The skin is set on the root before the styles apply; the page is one screen, inside the host's safe-area padding.
const html = `<title>Control Room World</title>
<meta name="claude:viewport-fit-sides" content="cover">
<script>document.documentElement.setAttribute("data-skin", ${JSON.stringify(skin)});</script>
<link rel="stylesheet" href="${fonts}">
<style>${css}
:root { color-scheme: dark; }
html, body { height:100%; overflow:hidden; }
body { margin:0; background:#1b1d1a; padding-left:max(0px, env(safe-area-inset-left, 0px)); padding-right:max(0px, env(safe-area-inset-right, 0px)); }
#root { height:100%; display:grid; grid-template-rows:minmax(0,1fr); }
/* Recording needs screen capture, which a shared page can't have. */
.world-opts button[title^="Record"] { display:none; }
@media (max-width: 640px) { .world { grid-template-columns:minmax(0,1fr); } .world-side { display:none; } }
</style>
<div id="root"></div>
<script>${js.replace(/<\/script/gi, "<\\/script")}</script>
`;
writeFileSync(out, html);
console.log(`${out}: ${(html.length / 1024).toFixed(0)} KB`);
