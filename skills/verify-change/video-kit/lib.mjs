// Building blocks for a verification video (video-spec.md). A run's scenes.mjs imports these, pushes scenes,
// and calls write(). Everything a scene shows comes from the run folder; only captions are typed.
import fs from "node:fs";
import path from "node:path";

export const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Strips emails and run ids from log text (spec rule 3). Add the run's own secrets to `extra`. */
export const scrub = (s, extra = []) => [[/[\w.+-]+@[\w-]+\.[\w.]+/g, "[email]"], [/run_id": "[^"]+"/g, 'run_id": "…"'], ...extra]
  .reduce((t, [re, to]) => t.replace(re, to), String(s));

export const CSS = `
  #root { position: absolute; inset: 0; background: #0e1116; color: #e6edf3; font-family: Inter, sans-serif; }
  .h { position: absolute; left: 192px; top: 96px; width: 1536px; font-size: 52px; font-weight: 700; letter-spacing: -0.01em; }
  .sub { position: absolute; left: 192px; top: 172px; width: 1536px; font-size: 30px; color: #9da7b3; line-height: 1.35; }
  .cap { font-size: 30px; line-height: 1.4; color: #e6edf3; }
  .mut { color: #9da7b3; }
  .mono { font-family: "JetBrains Mono", monospace; font-size: 28px; line-height: 1.45; color: #c9d1d9; white-space: pre-wrap; word-break: break-word; }
  .frame { position: absolute; border: 2px solid #30363d; border-radius: 10px; overflow: hidden; background: #fff; }
  .frame video, .frame img { width: 100%; height: 100%; object-fit: contain; display: block; background: #f8f3ec; }
  .pass { color: #3fb950; font-weight: 700; } .fail { color: #f85149; font-weight: 700; }
  .not-tested, .not-compared, .pending { color: #e3b341; font-weight: 700; }
  table { border-collapse: collapse; } td, th { text-align: left; vertical-align: top; }
`;

let n = 0;
const uid = (p) => `${p}${++n}`;

/**
 * One scene as a sub-composition. Every <img src=".." alt=""> in `body` becomes a clip as long as the scene
 * (an image without data-duration is a 3 s clip). Text with class "in" fades in, staggered.
 */
export function scene(id, dur, body, anims = "") {
  body = body.replace(/<img src="([^"]+)" alt="">/g, (_, src) => `<img id="${uid("i")}" class="clip" src="${src}" alt="" data-start="0" data-duration="${dur}" data-track-index="2">`);
  return {
    id, dur,
    html: `<template>
  <style>${CSS}</style>
  <div id="root" data-composition-id="${id}" data-width="1920" data-height="1080">
${body}
  </div>
  <script>
    const tl = gsap.timeline({ paused: true });
    tl.fromTo("#${id} .in", { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.5, stagger: 0.12, ease: "power2.out" }, 0.1);
    ${anims}
    window.__timelines["${id}"] = tl;
  </script>
</template>
`,
  };
}

/**
 * A recording from assets/video/<src>.mp4, made by prep-media.sh already trimmed, slowed and held to `dur`.
 * Do the trimming there: data-media-start and data-playback-rate did not render reliably on webm footage.
 */
export function footage(src, { x, y, w, h, dur }) {
  return `    <div class="frame" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px">
      <video id="${uid("v")}" class="clip" src="assets/video/${src}.mp4" muted playsinline data-start="0" data-duration="${dur}" data-track-index="1"></video>
    </div>`;
}

/** Text that holds still on purpose (data-hold tells `hyperframes check` the stillness is deliberate). */
export const text = (cls, style, html) => `    <div class="in ${cls}" data-hold style="position:absolute;${style}">${html}</div>`;

/** A screenshot from assets/shots/<name>.png in a frame. */
export const shot = (name, { x, y, w, h }) => `    <div class="in frame" style="left:${x}px;top:${y}px;width:${w}px;height:${h}px;"><img src="assets/shots/${name}.png" alt=""></div>`;

// ---- scene shapes from the spec ------------------------------------------------------------------
export const headline = (id, dur, head, sub, note = "") => scene(id, dur, `
${text("h", "top:330px;font-size:64px;", esc(head))}
${text("sub", "top:520px;font-size:34px;", esc(sub))}
${note ? text("cap mut", "left:192px;top:720px;width:1536px;", esc(note)) : ""}`);

/** Footage left, caption right (captionHtml may hold <br> and spans). */
export const surface = (id, dur, src, title, captionHtml) => scene(id, dur, `
${text("h", "top:60px;font-size:44px;", esc(title))}
${footage(src, { x: 192, y: 140, w: 1100, h: 773, dur })}
${text("cap", "left:1330px;top:150px;width:400px;", captionHtml)}`);

/** Two recordings side by side, each with a caption. */
export const pair = (id, dur, title, a, b) => scene(id, dur, `
${text("h", "top:60px;font-size:44px;", esc(title))}
${footage(a.src, { x: 192, y: 140, w: 750, h: 527, dur })}
${footage(b.src, { x: 978, y: 140, w: 750, h: 527, dur })}
${text("cap", "left:192px;top:690px;width:750px;", a.cap)}
${text("cap", "left:978px;top:690px;width:750px;", b.cap)}`);

/** Up to four numbered steps: [[title, detail], ...]. */
export const steps = (id, dur, title, list) => scene(id, dur, `
${text("h", "", esc(title))}
${list.map(([t, d], i) => text("cap", `left:192px;top:${210 + i * 180}px;width:1536px;`, `<span style="font-weight:700;color:#58a6ff">${i + 1}. ${esc(t)}</span><br>${esc(d)}`)).join("\n")}`);

/** Monospace blocks: [{ text, top, color }]. For log lines and requests, already scrubbed. */
export const logs = (id, dur, title, blocks) => scene(id, dur, `
${text("h", "top:60px;font-size:44px;", esc(title))}
${blocks.map((b) => text("mono", `left:192px;top:${b.top}px;width:1536px;${b.color ? `color:${b.color};` : ""}`, esc(b.text))).join("\n")}`);

/** A table: header row, then rows of HTML cells (escape the cells yourself). */
export const table = (id, dur, title, head, rowsHtml, note = "") => scene(id, dur, `
${text("h", "top:60px;font-size:44px;", esc(title))}
    <table class="in" data-hold style="position:absolute;left:192px;top:140px;width:1536px;font-size:28px;line-height:1.3">
      <tr class="mut">${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr>
${rowsHtml.map((cells) => `      <tr>${cells.map((c) => `<td style="padding:7px 16px 7px 0">${c}</td>`).join("")}</tr>`).join("\n")}
    </table>
${note ? text("cap mut", "left:192px;top:880px;width:1536px;font-size:28px;", esc(note)) : ""}`);

/**
 * The results scenes, generated from results.json (spec rules 4, 6, 7): one row per item, one column per surface,
 * every status shown. `surfacesOf(item)` maps an item's `surface` text to the column names it fills.
 */
export function results(checks, surfaces, surfacesOf = (c) => [c.surface], { perPage = 9, dur = 10 } = {}) {
  const pages = [];
  for (let i = 0; i < checks.length; i += perPage) pages.push(checks.slice(i, i + perPage));
  return pages.map((page, i) => scene(`results${i + 1}`, dur, `
${text("h", "top:56px;font-size:44px;", `Agent results, verdict pending (${i + 1}/${pages.length})`)}
    <table class="in" data-hold style="position:absolute;left:192px;top:130px;width:1536px;font-size:28px;line-height:1.25">
      <tr class="mut"><th style="width:200px">AC</th><th>Item</th>${surfaces.map((s) => `<th style="width:120px;text-align:center">${esc(s)}</th>`).join("")}</tr>
${page.map((c) => `      <tr><td style="padding:8px 0">${esc(c.criterion ?? "")}</td><td style="padding:8px 16px 8px 0">${esc(c.title)}</td>${surfaces.map((s) => `<td style="text-align:center" class="${c.status}">${surfacesOf(c).includes(s) ? c.status : ""}</td>`).join("")}</tr>`).join("\n")}
    </table>`));
}

/** Writes compositions/*.html, the persistent strip (spec: PR, ticket, commit, conditions) and index.html. */
export function write(dir, scenes, strip) {
  const total = scenes.reduce((a, s) => a + s.dur, 0);
  fs.mkdirSync(path.join(dir, "compositions"), { recursive: true });
  for (const s of scenes) fs.writeFileSync(path.join(dir, "compositions", `${s.id}.html`), s.html);
  fs.writeFileSync(path.join(dir, "compositions", "strip.html"), `<template>
  <style>
    #root { position: absolute; inset: 0; pointer-events: none; }
    #strip { position: absolute; left: 96px; top: 958px; width: 1728px; font-family: Inter, sans-serif; font-size: 28px; line-height: 1.3; color: #9da7b3; border-top: 2px solid #30363d; padding-top: 8px; }
  </style>
  <div id="root" data-composition-id="strip" data-width="1920" data-height="1080" data-no-timeline>
    <div id="strip">${strip.map(esc).join("<br>")}</div>
  </div>
</template>
`);
  let t = 0;
  const hosts = scenes.map((s) => {
    const h = `      <div id="${s.id}" data-composition-id="${s.id}" data-composition-src="compositions/${s.id}.html" data-start="${t}" data-duration="${s.dur}" data-track-index="1" data-track-kind="graphics" data-width="1920" data-height="1080"></div>`;
    t += s.dur;
    return h;
  });
  fs.writeFileSync(path.join(dir, "index.html"), `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body { margin: 0; width: 1920px; height: 1080px; overflow: hidden; background: #0e1116; }
      #root { width: 100%; height: 100%; }
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${total}" data-width="1920" data-height="1080">
${hosts.join("\n")}
      <div id="strip" data-composition-id="strip" data-composition-src="compositions/strip.html" data-start="0" data-duration="${total}" data-track-index="2" data-track-kind="graphics" data-width="1920" data-height="1080" style="z-index:10"></div>
    </div>
    <script>
      const tl = gsap.timeline({ paused: true });
      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`);
  console.log(`wrote ${scenes.length} scenes + strip, ${total}s`);
}
