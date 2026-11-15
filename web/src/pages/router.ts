// One page at a time, chosen by the URL hash (#/home, #/arrive, #/inside, #/check, #/summary, #/about).
// Pure DOM: `show()` marks the body with data-page and un-hides the page's sections; the CSS does the rest.
export const PAGES = ["home", "arrive", "inside", "check", "summary", "about"] as const;
export type Page = typeof PAGES[number];

/** Section ids that belong to each page. Arrive and inside share the full screen stage. */
export const SECTIONS: Record<Page, string[]> = {
  home: ["home"], arrive: ["rehearsal"], inside: ["rehearsal"], check: ["check"], summary: ["result"], about: ["about"],
};
const ALL_SECTIONS = ["home", "rehearsal", "check", "result", "about"];
/** Pages with the caption line and the pause / help buttons. */
export const WITH_CAPTION: Page[] = ["arrive", "inside", "check"];
export const WITH_CONTROLS: Page[] = ["arrive", "inside"];

export const isPage = (s: string | null | undefined): s is Page => !!s && (PAGES as readonly string[]).includes(s);

export function pageFromHash(hash: string): Page | null {
  const m = /^#\/([a-z]+)/.exec(hash);
  return m && isPage(m[1]) ? m[1] : null;
}

export function show(doc: Document, page: Page): void {
  doc.body.dataset.page = page;
  for (const id of ALL_SECTIONS) {
    const el = doc.getElementById(id);
    if (el) el.hidden = !SECTIONS[page].includes(id);
  }
  const cap = doc.getElementById("capline"); if (cap) cap.hidden = !WITH_CAPTION.includes(page);
  const ctl = doc.getElementById("controls"); if (ctl) ctl.hidden = !WITH_CONTROLS.includes(page);
}

export type Router = { go(p: Page, replace?: boolean): void; readonly page: Page; destroy(): void };

/** Hash router. `guard` may redirect (for instance to home before Start). `onPage` runs after each change. */
export function createRouter(win: Window, doc: Document, guard: (p: Page) => Page, onPage: (p: Page, prev: Page | null) => void): Router {
  let cur: Page | null = null;
  const apply = (want: Page | null) => {
    const p = guard(want ?? "home");
    if (p !== want) { win.history.replaceState(null, "", `#/${p}`); }
    if (p === cur) return;
    const prev = cur;
    cur = p;
    show(doc, p);
    onPage(p, prev);
  };
  const onHash = () => apply(pageFromHash(win.location.hash));
  win.addEventListener("hashchange", onHash);
  apply(pageFromHash(win.location.hash));
  return {
    get page() { return cur ?? "home"; },
    go(p, replace = false) {
      if (replace) win.history.replaceState(null, "", `#/${p}`);
      else if (pageFromHash(win.location.hash) !== p) { win.location.hash = `#/${p}`; return; }
      apply(p);
    },
    destroy() { win.removeEventListener("hashchange", onHash); },
  };
}
