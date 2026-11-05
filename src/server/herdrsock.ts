// One request to a herdr socket on its own connection: this Mac's, or another machine's through its tunnel (machines.ts).
import { connect } from "node:net";

export function requestAt<T = any>(socket: string, method: string, params: object = {}, timeoutMs = 10_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const sock = connect(socket);
    let buf = "";
    const done = (fn: () => void) => { clearTimeout(timer); sock.destroy(); fn(); };
    const timer = setTimeout(() => done(() => reject(new Error(`herdr ${method}: timed out`))), timeoutMs);
    sock.on("error", (e) => done(() => reject(e)));
    sock.on("connect", () => sock.write(JSON.stringify({ id: method, method, params }) + "\n"));
    sock.on("data", (d) => {
      buf += d.toString();
      const nl = buf.indexOf("\n");
      if (nl < 0) return;
      const msg = JSON.parse(buf.slice(0, nl));
      done(() => (msg.error ? reject(new Error(`herdr ${method}: ${msg.error.message ?? msg.error.code}`)) : resolve(msg.result)));
    });
  });
}
