// Records the World to a video file to send to someone: this tab, cropped to the World's view where Chrome can
// (Region Capture), until stopped, then downloads it. MP4 where the browser records it, else WebM. Chrome asks which
// tab to share each time; the browser's own "Stop sharing" stops it too.
import { type RefObject, useEffect, useRef, useState } from "react";

const TYPES = ["video/mp4;codecs=avc1", "video/mp4", "video/webm;codecs=vp9", "video/webm"];

export function useRecorder(view: RefObject<HTMLElement | null>) {
  const [since, setSince] = useState<number | null>(null);
  const [, tick] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  // The button's clock.
  useEffect(() => { if (since === null) return; const t = setInterval(() => tick((n) => n + 1), 500); return () => clearInterval(t); }, [since]);
  const stop = () => { const mr = rec.current; rec.current = null; if (mr && mr.state !== "inactive") mr.stop(); };
  // Leaving the World ends a recording, and still saves it.
  useEffect(() => stop, []);

  const start = async () => {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false, preferCurrentTab: true, selfBrowserSurface: "include" } as DisplayMediaStreamOptions);
    const [track] = stream.getVideoTracks();
    const CropTarget = (window as unknown as { CropTarget?: { fromElement: (e: Element) => Promise<unknown> } }).CropTarget;
    if (CropTarget && view.current && "cropTo" in track) {
      try { await (track as unknown as { cropTo: (t: unknown) => Promise<void> }).cropTo(await CropTarget.fromElement(view.current)); } catch { /* the whole tab, then */ }
    }
    const type = TYPES.find((t) => MediaRecorder.isTypeSupported(t));
    const mr = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 8_000_000 } : undefined);
    const chunks: Blob[] = [];
    mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    mr.onstop = () => {
      for (const t of stream.getTracks()) t.stop();
      setSince(null);
      const blob = new Blob(chunks, { type: mr.mimeType }), a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `control-room-world-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-")}.${mr.mimeType.includes("mp4") ? "mp4" : "webm"}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    };
    track.onended = stop;
    mr.start(1000);
    rec.current = mr;
    setSince(Date.now());
  };

  const s = since === null ? 0 : Math.floor((Date.now() - since) / 1000);
  return { recording: since !== null, clock: `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`, start, stop };
}
