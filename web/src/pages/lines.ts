// What each page says on arrival, in Michael's voice (clips keyed by text hash; every literal is in FIXED_UI_LINES in
// engine/dr/voice_lines.py). Inside has no line here: the guided intro and the ear check speak first.
import type { Page } from "./router";

export const PAGE_LINES: Partial<Record<Page, string>> = {
  arrive: "We are outside. Walk from the curb to the door.",
  check: "Check yourself. Point to the destination, then answer three questions.",
  summary: "Here is how it went.",
  about: "How it was built. This page is for judges and companions.",
};
