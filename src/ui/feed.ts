import { useCallback, useEffect, useState } from "react";
import type { Snapshot } from "../shared/types";

export type FeedStatus = "connecting" | "live" | "refreshing" | "offline" | "signed-out";

/** The board, live over Server-Sent Events. */
export function useFeed() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [status, setStatus] = useState<FeedStatus>("connecting");

  useEffect(() => {
    let es: EventSource | null = null;
    let build: string | null = null;
    let closed = false;
    const connect = () => {
      es = new EventSource("/api/events");
      es.addEventListener("snapshot", (e) => {
        const s = JSON.parse((e as MessageEvent).data) as Snapshot;
        // A deploy restarted the server: this page's code may be stale, so load the new one.
        if (build && s.build !== build) return location.reload();
        build = s.build;
        setSnap(s);
        setStatus((x) => (x === "refreshing" ? x : "live"));
      });
      es.onerror = async () => {
        es?.close();
        if (closed) return;
        // EventSource hides the status code; ask once to tell signed-out from down.
        const r = await fetch("/api/snapshot").catch(() => null);
        setStatus(r?.status === 401 ? "signed-out" : "offline");
        if (r?.status !== 401) setTimeout(connect, 3000);
      };
    };
    connect();
    return () => { closed = true; es?.close(); };
  }, []);

  const refresh = useCallback(async () => {
    setStatus("refreshing");
    await fetch("/api/refresh", { method: "POST" }).catch(() => null);
    setStatus("live");
  }, []);

  return { snap, status, refresh };
}
