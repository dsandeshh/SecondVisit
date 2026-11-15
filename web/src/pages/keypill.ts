// The one minimal key hint on #/inside: a single row pill at the bottom. It fades out after 5 s without a key press and
// comes back at once on any key (and with "?", which also opens the key card). Colours: --c-ink-2 on --c-surface-2,
// 4.66:1 light and 5.42:1 dark (keypill.test.ts computes both from tokens.css).
export const KEYPILL_TEXT = "Up walk · Left/Right turn · Tab target · Space repeat · ? help";
export const KEYPILL_IDLE_MS = 5000;

export function mountKeyPill(doc: Document, idleMs = KEYPILL_IDLE_MS): { el: HTMLElement; wake(): void; destroy(): void } {
  const el = doc.getElementById("keypill") ?? doc.createElement("p");
  if (!el.id) { el.id = "keypill"; el.className = "keypill"; doc.body.append(el); }
  el.textContent = KEYPILL_TEXT;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const wake = () => {
    el.classList.remove("is-idle");
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => el.classList.add("is-idle"), idleMs);
  };
  const onKey = () => wake();
  doc.addEventListener("keydown", onKey, true);   // capture: the key card swallows keys, the pill still wakes
  wake();
  return { el, wake, destroy: () => { doc.removeEventListener("keydown", onKey, true); if (timer) clearTimeout(timer); } };
}
