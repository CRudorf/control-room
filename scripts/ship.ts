// `bun run ship`: deploy GitHub's main through the running control room (src/server/deploy.ts), then wait
// for the restarted server to answer with that commit. Works from an agent's sandbox: it only talks to
// localhost. Push to main first; this ships what GitHub has.
import { existsSync, readFileSync } from "node:fs";
import { PORT, TOKEN_PATH } from "../src/server/config";
import { HOSTNAME } from "../src/server/security";

const base = `http://${HOSTNAME}:${PORT}`;
if (!existsSync(TOKEN_PATH)) { console.error(`the control room isn't running on ${HOSTNAME}:${PORT}`); process.exit(1); }
const headers = { cookie: `cr=${readFileSync(TOKEN_PATH, "utf8").trim()}`, "content-type": "application/json" };

const started = await fetch(`${base}/api/deploy`, { method: "POST", headers, body: "{}" })
  .then((r) => (r.status === 404 ? { error: "the running control room is older than `bun run ship`: deploy it once with `bun run deploy`" } : r.json()))
  .catch((e) => ({ error: String(e) }));
if (started.error) { console.error(`not deployed: ${started.error}`); process.exit(1); }
const target: string = started.target;
console.log(`deploying ${target.slice(0, 7)}…`);

// The server goes away while it restarts: keep asking until it answers with the new commit, or the deploy stops without it.
const deadline = Date.now() + 10 * 60_000;
let last = "";
while (Date.now() < deadline) {
  await Bun.sleep(3000);
  const s = await fetch(`${base}/api/deploy`, { headers }).then((r) => r.json()).catch(() => null);
  if (!s) continue; // restarting
  if (s.log && s.log !== last) {
    const fresh = last && s.log.startsWith(last.slice(0, 200)) ? s.log.slice(last.length) : s.log;
    if (fresh.trim()) console.log(fresh.trimEnd());
    last = s.log;
  }
  if (s.installed === target && !s.running) { console.log(`deployed ${target.slice(0, 7)}: the control room is running it`); process.exit(0); }
  if (!s.running && s.installed !== target && s.at) {
    console.error(`not deployed: the deploy stopped and the control room still runs ${String(s.installed).slice(0, 7)}`);
    process.exit(1);
  }
}
console.error("not deployed: no answer from the new server within 10 minutes; see ~/Library/Logs/control-room/server.log");
process.exit(1);
