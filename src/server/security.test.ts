import { describe, expect, test } from "bun:test";
import { PORT } from "./config";
import { bootstrap, guard, token } from "./security";

const req = (cookie: string) => new Request(`http://127.0.0.1:${PORT}/api/snapshot`, { headers: { host: `127.0.0.1:${PORT}`, cookie } });
const ok = (cookie: string) => guard(req(cookie), { needCookie: true }) === null;

describe("sign-in cookies", () => {
  test("bootstrap signs in under this server's own name", () => {
    const r = bootstrap(new Request(`http://127.0.0.1:${PORT}/bootstrap?t=${token()}`));
    expect(r.headers.get("set-cookie")).toStartWith(`cr-${PORT}=${token()};`);
  });
  test("this server's cookie, or the plain one, signs in; another server's doesn't", () => {
    expect(ok(`cr-${PORT}=${token()}`)).toBe(true);
    expect(ok(`cr=${token()}`)).toBe(true);
    expect(ok(`cr-1=${token()}`)).toBe(false);
    expect(ok(`cr-${PORT}=nope`)).toBe(false);
  });
  test("another server's sign-in in the plain cookie doesn't hide this server's", () => {
    expect(ok(`cr=someone-elses; cr-${PORT}=${token()}`)).toBe(true);
  });
});
