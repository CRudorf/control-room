// A run's video, scene by scene, in the spec's order. Copy to the video project as scenes.mjs, next to lib.mjs,
// set RUN, and replace every caption and data read with the run's own. Then: node scenes.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { esc, headline, logs, pair, results, scrub, shot, scene, steps, surface, table, text, write } from "./lib.mjs";

// fileURLToPath, not URL.pathname: the visual store is under "Application Support", and a URL path keeps the space as %20.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const RUN = path.join(HERE, "../run");
const read = (p) => fs.readFileSync(path.join(RUN, p), "utf8");
const checks = JSON.parse(read("results.json")).checks;

const scenes = [
  // 1. The problem: from the ticket.
  headline("problem", 10, "One headline from the ticket", "One short sentence on what changes for the user."),
  // 2. Each surface: prep-media.sh makes assets/video/<name>.mp4 from video/<item>.webm.
  surface("surface-a", 10, "item-a", "Surface name · role", "What the footage shows.<br><br><span class='mut'>The text the page shows, quoted.</span>"),
  // 3. The request: a request from logs/api-*.jsonl beside the real server log line.
  logs("request", 12, "What drives it", [
    { top: 140, text: scrub(read("logs/api-item-a.jsonl").split("\n")[0]) },
  ]),
  // 4. How it works: up to four steps, server to script.
  steps("how", 10, "How it works", [["Step", "What happens."], ["Step", "What happens."]]),
  // 5. Edge cases.
  pair("edges", 10, "Edge cases", { src: "item-b", cap: "Outcome B." }, { src: "item-c", cap: "Outcome C." }),
  // 6. Decision logic: cells read from the run's DB dump, not typed.
  table("decision", 12, "What each case got", ["Case", "Input", "Result (from the DB)"], [["001", "input", esc("read from logs/db-after.txt")]]),
  // 7. Window widths.
  scene("widths", 8, `
${text("h", "top:60px;font-size:44px;", "Window widths")}
${shot("item-a-375", { x: 192, y: 140, w: 250, h: 600 })}
${shot("item-a-768", { x: 470, y: 140, w: 512, h: 600 })}
${shot("item-a-1024", { x: 1010, y: 140, w: 683, h: 600 })}
${text("cap", "left:192px;top:770px;width:1536px;", "375, 768 and 1024px shown; 1280px and raised text size are in the run folder.")}`),
  // 8. Results, generated from results.json.
  ...results(checks, ["Surface A", "Surface B"], (c) => [c.surface]),
];

write(HERE, scenes, [
  "KEY · repo #PR at <short commit> · other PRs and the API image commit",
  "Where it ran, the test data, the limits of the proof · agent results, your verdict pending",
]);
