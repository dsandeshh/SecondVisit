// Loads the Showcase SDK script and connects, with the 8 s fallback (item 6).
export const SDK_TIMEOUT_MS = 8000;
export const FALLBACK_LINE = "Photo view needs internet; showing the scan.";
const SDK_SRC = "https://static.matterport.com/showcase-sdk/latest.js";

export function withTimeout<T>(p: Promise<T>, ms: number, reason: string): Promise<T> {
  return new Promise<T>((res, rej) => {
    const t = setTimeout(() => rej(new Error(reason)), ms);
    p.then(v => { clearTimeout(t); res(v); }, e => { clearTimeout(t); rej(e); });
  });
}

export function loadSdkScript(): Promise<void> {
  const w = window as any;
  if (w.MP_SDK) return Promise.resolve();
  return new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = SDK_SRC; s.async = true;
    s.onload = () => (w.MP_SDK ? res() : rej(new Error("sdk script loaded without MP_SDK")));
    s.onerror = () => rej(new Error("sdk script failed to load"));
    document.head.append(s);
  });
}
