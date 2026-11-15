// The key card: shown on the first arrival inside, spoken once, any key dismisses it, "?" brings it back.
// Keys while it is up are swallowed in the capture phase (never reach the stage or the Matterport iframe), except
// F6 (region cycling) and Tab (focus the card buttons), which pass; Escape dismisses and passes nothing on.
export const KEYCARD_KEY = "sv.keycard.seen";
export const KEYCARD_LINE = "Up walks. Left and Right turn. Enter asks where your goal is. Q tells you what is around you. P pauses. The question mark brings this back.";
const ITEMS: [string, string, string][] = [
  ["Up", "walk", "ArrowUp"], ["Left", "turn left", "ArrowLeft"], ["Right", "turn right", "ArrowRight"],
  ["Enter", "where is my goal", "Enter"], ["Q", "what is around me", "q"], ["P", "pause", "p"], ["?", "help", "?"],
];

export const cardSeen = (): boolean => { try { return localStorage.getItem(KEYCARD_KEY) === "1"; } catch { return false; } };
const markSeen = (): void => { try { localStorage.setItem(KEYCARD_KEY, "1"); } catch { /* private mode */ } };
export const cardWanted = (params: URLSearchParams): boolean => params.get("card") === "1" || !cardSeen();

export type KeyCard = { show(speak?: boolean): void; hide(): void; readonly open: boolean };

export function mountKeyCard(doc: Document, stage: HTMLElement, say: (t: string) => void, onDismiss?: () => void): KeyCard {
  const el = doc.createElement("div");
  el.id = "keycard"; el.className = "keycard"; el.hidden = true;
  el.setAttribute("role", "group"); el.setAttribute("aria-label", "Keys. Press any key to close.");
  const row = doc.createElement("div"); row.className = "keycard__row";
  for (const [k, what, send] of ITEMS) {
    const b = doc.createElement("button"); b.type = "button"; b.className = "keycard__key";
    const kb = doc.createElement("kbd"); kb.textContent = k;
    b.append(kb, doc.createTextNode(` ${what}`));
    b.addEventListener("click", () => {
      hide();
      if (send !== "?") stage.dispatchEvent(new KeyboardEvent("keydown", { key: send, bubbles: true, cancelable: true }));
      stage.focus();
    });
    row.append(b);
  }
  const hint = doc.createElement("p"); hint.className = "keycard__hint"; hint.textContent = "Press any key to close.";
  el.append(row, hint);
  stage.parentElement!.append(el);
  let open = false;
  const swallow = (e: KeyboardEvent) => {
    if (!open || e.key === "F6" || e.key === "Tab" || e.key === "Shift" || e.ctrlKey || e.metaKey || e.altKey) return;
    if ((e.target as HTMLElement | null)?.closest?.(".keycard__key") && (e.key === "Enter" || e.key === " ")) return;   // a focused button presses itself
    e.preventDefault(); e.stopImmediatePropagation();
    hide();
  };
  doc.addEventListener("keydown", swallow, true);
  // "?" at any time on the inside page brings it back.
  doc.addEventListener("keydown", e => {
    if (e.key !== "?" || open || doc.body.dataset.page !== "inside") return;
    if ((e.target as HTMLElement | null)?.closest?.("input, textarea, select")) return;
    e.preventDefault(); show(true);
  });
  function show(speak = true): void { if (open) return; open = true; el.hidden = false; if (speak) say(KEYCARD_LINE); }
  function hide(): void { if (!open) return; open = false; el.hidden = true; markSeen(); onDismiss?.(); }
  return { show, hide, get open() { return open; } };
}
