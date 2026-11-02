// `bun run item <key or PR ref>`: one work item from the running control room, as plain text.
// Signs in with the token file the browser's bootstrap URL carries (ADR 0003).
import { existsSync, readFileSync } from "node:fs";
import { PORT, TOKEN_PATH } from "./config";
import { HOSTNAME } from "./security";

const q = process.argv.slice(2).join(" ").trim();
if (!q) {
  console.error("usage: bun run item <work item key, PR ref or PR URL>");
  process.exit(2);
}
const down = `the control room isn't running on ${HOSTNAME}:${PORT}`;
if (!existsSync(TOKEN_PATH)) { console.error(down); process.exit(1); }

let res: Response;
try {
  res = await fetch(`http://${HOSTNAME}:${PORT}/api/item?q=${encodeURIComponent(q)}`, {
    headers: { cookie: `cr=${readFileSync(TOKEN_PATH, "utf8").trim()}` },
  });
} catch {
  console.error(down);
  process.exit(1);
}
const text = await res.text();
if (!res.ok) { console.error(text); process.exit(1); }
console.log(text);
