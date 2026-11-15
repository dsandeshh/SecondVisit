// Connects to the Showcase SDK, with the 20 s fallback.
export const SDK_TIMEOUT_MS = 20000;
export const FALLBACK_LINE = "Photo view needs internet; showing the scan.";

export function withTimeout<T>(p: Promise<T>, ms: number, reason: string): Promise<T> {
  return new Promise<T>((res, rej) => {
    const t = setTimeout(() => rej(new Error(reason)), ms);
    p.then(v => { clearTimeout(t); res(v); }, e => { clearTimeout(t); rej(e); });
  });
}

/** Connect to the Showcase iframe with the official package (bootstrap 3.x), then wait for the app to be PLAYING.
 *  Camera and Sweep calls before PLAYING are ignored by the SDK, so nothing touches the camera until this resolves. */
export async function connectSdk(iframe: HTMLIFrameElement, key: string, space: string): Promise<any> {
  const { setupSdk } = await import("@matterport/sdk");
  const sdk: any = await setupSdk(key, { iframe, space });
  await waitPlaying(sdk);
  return sdk;
}

export async function waitPlaying(sdk: any): Promise<void> {
  await sdk.App.state.waitUntil((s: { phase: string }) => s.phase === sdk.App.Phase.PLAYING);
}
