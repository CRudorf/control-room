// Loopback bind, Host/Origin check and a secret cookie from a one-time bootstrap URL (ADR 0003).
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { timingSafeEqual } from "node:crypto";
import { PORT, TOKEN_PATH } from "./config";

export const HOSTNAME = "127.0.0.1";
const HOSTS = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const ORIGINS = new Set([...HOSTS].map((h) => `http://${h}`));
// Cookies don't keep to a port, so each server signs in under its own name: the dev server's sign-in
// can't overwrite the running one's. The plain name still works, for older sign-ins and the CLIs.
const COOKIE = `cr-${PORT}`, LEGACY = "cr";

export function token(): string {
  if (!existsSync(TOKEN_PATH)) {
    const t = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64url");
    writeFileSync(TOKEN_PATH, t + "\n", { mode: 0o600 });
  }
  return readFileSync(TOKEN_PATH, "utf8").trim();
}

const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** The sign-in cookies a request carries: this server's, then the plain one. */
function cookies(req: Request): string[] {
  const out: string[] = [];
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) out.unshift(v.join("=")); else if (k === LEGACY) out.push(v.join("="));
  }
  return out;
}

/** Null when the request may proceed; otherwise the response to send instead. */
export function guard(req: Request, opts: { needCookie: boolean }): Response | null {
  if (!HOSTS.has(req.headers.get("host") ?? "")) return new Response("bad host", { status: 421 });
  const origin = req.headers.get("origin");
  if (origin && !ORIGINS.has(origin)) return new Response("bad origin", { status: 403 });
  if (opts.needCookie) {
    if (!cookies(req).some((c) => same(c, token())))
      return new Response("Not signed in. Run `bun run open` in the control-room checkout.", { status: 401 });
  }
  return null;
}

/** GET /bootstrap?t=<token>: sets the cookie and lands on the app. */
export function bootstrap(req: Request): Response {
  const t = new URL(req.url).searchParams.get("t") ?? "";
  if (!same(t, token())) return new Response("bad token", { status: 403 });
  return new Response(null, {
    status: 303,
    headers: {
      location: "/",
      "set-cookie": `${COOKIE}=${t}; Path=/; HttpOnly; SameSite=Strict; Max-Age=315360000`,
    },
  });
}

export const bootstrapUrl = () => `http://${HOSTNAME}:${PORT}/bootstrap?t=${token()}`;
