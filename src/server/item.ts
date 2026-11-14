// `bun run item <key or PR ref>`: one work item from the running control room, as plain text.
// Signs in with the token file the browser's bootstrap URL carries (ADR 0003).
import { existsSync, readFileSync } from "node:fs";
import { PORT, TOKEN_PATH } from "./config";
import { HOSTNAME } from "./security";

// `--note "<decision>"` records a decision on the item instead of printing it.
// `--recipe "<steps>"` saves how to run the item's repo locally.
// `--focused` instead of a key: the item of the agent last focused in herdr. `--open` opens the item in the browser.
const all = process.argv.slice(2);
const focused = all.includes("--focused"), open = all.includes("--open");
const args = all.filter((a) => a !== "--focused" && a !== "--open");
const flag = args.findIndex((a) => a === "--note" || a === "--recipe");
const what = flag >= 0 ? args[flag] : null;
const note = flag >= 0 ? args.slice(flag + 1).join(" ").trim() : null;
const q = (flag >= 0 ? args.slice(0, flag) : args).join(" ").trim();
if (!q && !focused) {
  console.error("usage: bun run item <work item key, PR ref or PR URL | --focused> [--open | --note \"<decision>\" | --recipe \"<how to run its repo>\"]");
  process.exit(2);
}
const down = `the control room isn't running on ${HOSTNAME}:${PORT}`;
if (!existsSync(TOKEN_PATH)) { console.error(down); process.exit(1); }

let res: Response;
try {
  const cookie = `cr=${readFileSync(TOKEN_PATH, "utf8").trim()}`;
  res = note !== null
    ? await fetch(`http://${HOSTNAME}:${PORT}/api/${what === "--recipe" ? "recipe" : "notes"}`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ q, text: note, by: process.env.CLAUDE_SESSION_NAME ?? "agent", cwd: process.cwd() }) })
    : await fetch(`http://${HOSTNAME}:${PORT}/api/item?${focused ? "focused=1" : `q=${encodeURIComponent(q)}`}${open ? "&id=1" : ""}`, { headers: { cookie } });
} catch {
  console.error(down);
  process.exit(1);
}
const text = await res.text();
if (!res.ok) { console.error(text); process.exit(1); }
if (open) await Bun.spawn(["open", "-a", "Google Chrome", `http://${HOSTNAME}:${PORT}/item/${encodeURIComponent(text)}`]).exited;
else console.log(text);
