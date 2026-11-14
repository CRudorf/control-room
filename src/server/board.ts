// `bun run board`: the board as text in a terminal pane, redrawn whenever the installed control room
// writes it (panemeta.ts). Lines are cut to the pane's width; ctrl+c ends it.
import { existsSync, readFileSync, watch } from "node:fs";
import { basename, dirname } from "node:path";
import { BOARD_PATH } from "./panemeta";

const DIM = "\x1b[2m", BOLD = "\x1b[1m", OFF = "\x1b[0m";

export function render(text: string, cols: number): string {
  const cut = (s: string) => (s.length > cols ? s.slice(0, Math.max(cols - 1, 0)) + "…" : s);
  return text.trimEnd().split("\n").map((l) => {
    const s = cut(l);
    if (/^[A-Z][A-Z ]+ \d+$/.test(l)) return BOLD + s + OFF;
    if (l.startsWith("     ") || l.startsWith("control room")) return DIM + s + OFF;
    return s;
  }).join("\n");
}

function draw() {
  const text = existsSync(BOARD_PATH) ? readFileSync(BOARD_PATH, "utf8") : "the installed control room hasn't written the board yet\n";
  process.stdout.write("\x1b[H\x1b[2J" + render(text, process.stdout.columns || 80) + "\n");
}

if (import.meta.main) {
  draw();
  watch(dirname(BOARD_PATH), (_, f) => { if (f === basename(BOARD_PATH)) draw(); });
  process.stdout.on("resize", draw);
}
