# SecondVisit: UI design (v2, apple minimal, system font)

Owner of the look: whoever builds `web/`. Tokens live in `web_tokens.css` at the kit root; copy it to
`web/src/styles/tokens.css` and import it first in every entry file. Everything here is plain CSS,
plain DOM and canvas 2D. There are no dependencies for the look: no web fonts, no icon set.

Read with: `CLAUDE.md` rules 6 to 8, `docs/DESIGN.md` section 5, `docs/plan.md` Tasks 8, 9, 10, 12, 17,
19, 20, and section 4 of `review/agent3_experience.md`.

---

## 1. Direction: Apple minimal, system font

SecondVisit should feel like a well made system app: white, one blue, the device's own typeface, a big
bold title and one line under it, and a lot of space. A blind or low vision visitor gets a screen that
says one thing and offers one action. Nothing is decoration. We keep the clinical record's discipline:
numbers that line up, every fact with its source written next to it, tables instead of dashboards, and
nothing on screen that a blind user cannot get some other way. The real Matterport floor plan is the
only picture. There are no cards, no shadows, no icons, no gradients, no emoji and no illustration.

**The one bold thing:** the title. Every screen opens with one big, bold title (`--fs-title-visitor`,
weight 700) and one line under it in `--c-ink-2`. Everything else is quiet white and ink.

**The one system idea: line style says how sure we are.** Borrowed from architectural drawings, where
existing work is solid and proposed work is dashed:

| Certainty | Line or fill | Used on |
|---|---|---|
| Measured from sponsor data (`MP`, `VX`, `CS`, `CALC`) | solid outline | chips, walls, current route |
| Labelled by AI (`AI`) | dotted outline | chips, AI landmark rings on the plan |
| Assumed | dashed outline | "assumed" tag, assumed entrance pin |
| Proposed (layout advisor) | dashed line | proposed desk, proposed route |
| Simulated | diagonal hatch | "simulated" tag, simulated numbers, lost heatmap legend |
| Confirmed by a person (`HAND`) | solid outline, yellow fill | chip, entrance and drop off pins |

Judges who ask "is that real?" can answer it by looking.

**One accent, and yellow means a person.** The only hue in the interface chrome is `--c-accent`
(actions, links, the focus ring). `--c-mark` (#FFC629) is used for exactly three things: the traveller,
"you are here", and the `HAND` chip fill. It is never text on white (1.5:1), never focus, never
decoration.

### 1.1 Palette (light default; dark follows the system setting)

All ratios are WCAG 2 relative luminance, computed for these exact hex values.

| Name | Token | Light | Job | Contrast (light) |
|---|---|---|---|---|
| Page, surface | `--c-paper`, `--c-surface` | #FFFFFF | page, inputs, tables, plan canvas | |
| Quiet fill | `--c-surface-2` | #F5F5F7 | selected row, pressed secondary | |
| Ink | `--c-ink` | #1D1D1F | text, walls | 16.83:1 on white, 15.46:1 on quiet fill |
| Ink 2 | `--c-ink-2` | #6E6E73 | secondary text | 5.07:1 on white, 4.66:1 on quiet fill (AA) |
| Accent | `--c-accent` | #0066CC | actions, links, focus | 5.57:1 on white, 5.11:1 on quiet fill; white on it 5.57:1 |
| Accent strong | `--c-accent-strong` | #004C99 | hover, pressed | white on it 8.42:1 |
| Rule | `--c-rule` | #86868B | control borders | 3.62:1 on white, 3.33:1 on quiet fill (non text 3:1) |
| Rule soft | `--c-rule-soft` | #D2D2D7 | decorative hairline | 1.51:1; never the only boundary of a control |
| Good, bad, caution | `--c-good`, `--c-bad`, `--c-caution` | #1B6B3A, #B3261E, #8C5300 | words "Correct", "Not this one", low confidence AI chips | 6.54, 6.54, 6.26:1 on white |
| Mark | `--c-mark`, `--c-on-mark` | #FFC629, #0F1C2A | traveller, you are here, HAND chip | ink on it 10.95:1 |

Dark: page #000000, surface #1C1C1E, quiet fill #2C2C2E, ink #F5F5F7 (15.63:1 on surface), ink 2 #A1A1A6
(6.61:1 on surface, 5.42:1 on quiet fill), accent #2997FF (6.96:1 on page, 5.64:1 on surface, 4.62:1 on
quiet fill), text on accent #000000 (6.96:1; white on #2997FF fails), rule #8E8E93 (5.22:1 on surface),
rule soft #38383A. Apple's own #0071E3 was rejected: 4.31:1 on #F5F5F7 fails AA. The full table of
computed ratios is next to each value in the tokens file and enforced by `web/src/ui/tokens.test.ts`.

Data colours (validated with the dataviz validator, all pairs, protan and deutan simulated; unchanged by
this direction): route #2160A8, glass #008A7E, obstacle #C45A00, before/run 1 graphite #434E5A. Lost
heatmap: one hue, four bins #E9A04F, #CF7426, #A0500F, #642A06 (lightness monotone, single hue within 20
degrees).

Why this palette: one accent and neutral greys is the calm system look and keeps the data colours
unambiguous on the plan. RNIB says never set yellow text on white or pale backgrounds, so yellow is only
ever a fill or a ring with an ink edge. The heatmap is amber to brown, not red, so it never sits in a
red/green pair, and the route it is compared against is blue (the pair that survives every common colour
vision deficiency). Cividis (Nuñez et al. 2018) was considered for the heatmap, but on a white plan its
high end is yellow, the least visible step, and its blue low end collides with the route.

### 1.2 Type

* **The system font**, one stack for everything, titles at weight 700:
  `-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, "Segoe UI", Roboto, sans-serif`.
  Why: it is native (SF Pro on Apple devices, Segoe UI on Windows, Roboto on Android), so there is
  nothing to download and the demo works offline; it follows the user's system settings, including
  Dynamic Type friendly sizing in `rem` and bold text preferences; and it is the face the visitor's
  screen reader and magnifier already render best.
* **Never download or self host SF Pro.** Its licence forbids embedding it on websites. No web fonts at
  all: no `@font-face`, no font packages, no CDN link. The stack only names fonts already on the device.
* **Mono** (`ui-monospace, "SF Mono", Menlo, Consolas, monospace`) only for tool calls in the agent trace
  and the operator panel, where the text really is code.
* Weights: body 400, medium 500, bold 600, titles and the Step label 700 (`--fw-body`, `--fw-medium`,
  `--fw-bold`, `--fw-heavy`).
* `font-variant-numeric: tabular-nums` stays on `html`, so numbers line up everywhere.
* No italics (APH large print guidance: italics are hard to read). Emphasis is weight.
* No all caps labels anywhere. Mixed case keeps word shapes, which matter for low vision.

### 1.3 Anti slop rules

**Do**

* Open every screen with the big title and one line under it in `--c-ink-2`; the title is the real place
  name from CoStar or Matterport where the screen is about a place.
* One primary action per screen. Generous whitespace (`--sp-section` between blocks).
* Show the real floor plan image under the data. It is the only image besides the Vexcel arrival photo.
* Put a source chip or a "simulated" / "assumed" tag next to every number a judge might question.
* Left align everything. Content column starts at the same x as the title.
* Carry every state change in words and line style, never in colour or an icon alone: "Correct", "Not
  this one", "running", "done", "failed"; solid, dotted, dashed, hatch.
* Use real sequences for numbering only: rehearsal steps, quiz options (keys 1 to 4), pocket summary
  instructions, advisor rounds, portfolio rank.
* Radius shows hierarchy: `--r-primary` 14px on primary buttons only, `--r-control` 6px on inputs and
  secondary buttons, `--r-chip` 2px on chips, panels square (`--r-none`).
* One moment of motion: the tap ring on the observer. Everything else changes state without animating.

**Don't**

* Gradients, gradient text, glows, neon, glassmorphism, `backdrop-filter: blur`. One exception, and only
  through the `.glass-bar` and `.glass-panel` classes: the judge screens in 1.4.
* Icons of any kind (no check, cross, dot, eye, sparkle or cane clip art), emoji, stock photos of blind
  people. Plan canvas symbols (traveller disc, tap rings, landmark rings) are map marks, not icons, and
  stay.
* Cards and shadows: no boxed cards, no soft grey shadow. The only `box-shadow` is the pressed state of
  a button (3.1).
* A centred hero, a big number with a gradient accent, "AI powered" badges.
* Fake dashboards: no sparkline, KPI tile or chart whose numbers are not in `package.json`,
  `portfolio.json` or a RunLog.
* All caps eyebrow labels, `A · B · C` meta strings, "Word — fragment" labels, `→` on buttons,
  monospace for small labels.
* Skeleton shimmer, confetti, page load fades, hover lift on rows.
* Placeholder text as the only label. Disabled buttons with no reason given.
* Copy that says "experience blindness", "revolutionary", "seamless", "empower", "Oops".

### 1.4 Layout, and where glass is allowed

**Visitor screens (`index.html`: Home, mode choice, build list, rehearsal, Check yourself, Pocket
summary, and the phone layout): no transparency and no blur, ever.** No `backdrop-filter`, no
translucent overlays, no alpha on any surface that carries text. Low vision users lose text over a
moving or blurred backdrop, and screen magnifiers make it worse. The clean feel comes from four things:

| Lever | Rule | Tokens |
|---|---|---|
| One big bold title | Each screen opens with its title at the visitor size, weight 700, tight leading, slight negative tracking, and one line under it in `--c-ink-2`. Section headings use `--fw-heavy`. | `--fs-title-visitor` (40 to 56px), `--fw-title-visitor`, `--lh-title-visitor`, `--tracking-title-visitor` |
| Fewer elements | A screen shows only what its one job needs. Required parts stay (transcript region, rehearsal steps nav, chips the facts need); anything else moves to a later screen or behind a disclosure. No decorative rules, boxes, shadows or icons. | |
| One primary action per screen | Exactly one `.btn--primary` per screen: Home "Start", build list "Start rehearsal", Check yourself "Next question", Pocket summary "Start run 2" ("Copy driver message" is secondary there). The mode choice is two equal secondary buttons, so neither is primary. The rehearsal stage has no primary button; on the phone, Step is the action. | `.btn--primary`, `--r-primary` |
| Generous whitespace | At least `--sp-section` between blocks, content column left aligned at the title's edge, line length capped at `--measure`. Space separates groups; lines and boxes do not. | `--sp-section` (48 to 80px), `--measure` |

**Judge screens (`observer.html`, `venue.html`): a light frosted top bar and trace panel**, through the
classes `.glass-bar` and `.glass-panel` in the tokens file. Never on the plan canvas, the caption strip,
tables, dials, chips or any other panel.

* Light theme tint is white; dark tint is #1C1C1E (the dark surface). Bar text is ink: there is no blue
  bar any more.
* The tint is opaque enough that ink and ink 2 stay at 4.5:1 or better over **any** backdrop, computed
  for the worst case (black under the white tint, white under the dark tint). Light: alpha **0.96**
  (smallest passing alpha is 0.947; ink 2 is 4.64:1 over black, ink 15.41:1). Dark: alpha **0.89**
  (smallest passing is 0.874; ink 2 is 4.76:1 over white, ink 11.25:1). The alpha is a floor, not a
  style choice.
* The default is solid. Glass only turns on inside `@supports (backdrop-filter)`; it turns off again
  (solid `--c-surface` bar and panel, no blur) under `prefers-reduced-transparency: reduce`,
  `prefers-contrast: more` and `forced-colors: active`.
* Blur 16px, no saturation boost (saturation would change the backdrop's luminance and break the
  contrast arithmetic above). A 1px `--c-rule-soft` hairline marks the edge.
* The observer pins the light theme.

### 1.5 Accessibility floor (restated; these win over any taste)

* Body 22px on laptop (`--fs-body` 20 to 22), nothing in the app under 18px.
* Buttons 48px minimum, 64px for primary and rehearsal controls, 8px gaps.
* Visible focus ring on everything focusable: `outline: 3px solid var(--c-accent); outline-offset: 2px`
  (one ring; accent against white 5.57:1, against dark page 6.96:1, both above the 3:1 needed).
* WCAG AA minimum: 4.5:1 for text, 3:1 for non text. Large or bold text may use 3:1 only where a comment
  in the tokens file says so; today no text relies on it.
* Nothing by colour alone: words and line style carry every state.
* Rule 7 behaviour (Start gate, app voice versus screen reader, transcript live regions) is unchanged.

---

## 2. Tokens

The file `web_tokens.css` is the source of truth (153 custom properties).
Summary of what is in it and why:

| Group | Tokens | Notes |
|---|---|---|
| Families | `--font-sans`, `--font-mono` | system font stack (SF Pro on Apple, Segoe UI, Roboto); system mono for tool calls |
| Weights | `--fw-body` 400, `--fw-medium` 500, `--fw-bold` 600, `--fw-heavy` 700 | static system weights; titles 700 |
| App type | `--fs-small` 18, `--fs-body` 20 to 22, `--fs-lead` 22 to 26, `--fs-h3` 24, `--fs-h2` 26 to 34, `--fs-h1` 32 to 48, `--fs-display` 36 to 64, `--fs-step` 48 to 80, `--fs-caption` 24 to 36 (px) | fluid only between 360 and 720 CSS px, fixed above: a laptop at 200% zoom still gets exactly 2x (WCAG 1.4.4) |
| Projector type | `--fs-proj-min` 3vh, `--fs-proj-body` 3.6vh, `--fs-proj-h` 4.4vh, `--fs-proj-caption` 5.2vh, `--fs-proj-number` 10vh | `max(rem, vh)` so zoom still raises the floor |
| Rhythm | `--lh-body` 1.5, `--lh-tight` 1.15, `--measure` 46ch | APH: 39 to 43 characters per line for large print |
| Space | `--sp-1` 4 to `--sp-9` 96 px, `--gutter` 16 to 32 | 4px base |
| Targets | `--target-min` 48, `--target-comfort` 56, `--target-primary` 64, `--target-gap` 8 (px) | Android 48dp with 8dp gaps; Apple 44pt; WCAG 2.5.8 needs 24, 2.5.5 needs 44 |
| Shape | `--r-primary` 14 (primary buttons only), `--r-control` 6, `--r-chip` 2, `--r-none`, `--r-dot`; `--bw-control` 2, `--bw-strong` 3 | |
| Colour | `--c-paper`, `--c-surface`, `--c-surface-2`, `--c-ink`, `--c-ink-2`, `--c-accent`, `--c-accent-strong`, `--c-on-accent`, `--c-rule`, `--c-rule-soft`, `--c-mark`, `--c-on-mark`, `--c-good`, `--c-bad`, `--c-caution` | light and dark; `prefers-contrast: more` collapses Ink 2 into Ink and thickens borders |
| Focus | `--focus-width` 3 | one ring: `3px solid var(--c-accent)`, offset 2px; accent vs page 5.57:1 light, 6.96:1 dark |
| Data | `--d-*`, `--heat-1..4`, `--heat-alpha` | read by canvas code through `getComputedStyle` |
| Motion | `--dur-*`, `--ease-out`, `--motion-scale` | reduced motion sets durations to 0 and `--motion-scale` to 0 |
| Visitor titles and space | `--fs-title-visitor` 40 to 56, `--fw-title-visitor` 700, `--lh-title-visitor` 1.05, `--tracking-title-visitor`, `--sp-section` 48 to 80 (px) | Apple minimal layer, 1.4; fluid only between 360 and 720 like the rest |
| Glass | tint alpha 0.96 light, 0.89 dark (in `--glass-*-tint`), `--glass-blur` 16px, `--glass-bar-*`, `--glass-panel-*`, `--glass-filter`, `--glass-border` | judge screens only, 1.4; solid by default and under reduced transparency, more contrast and forced colours |
| Layers | `--z-base` 0, `--z-canvas-overlay` 10, `--z-sticky` 20, `--z-caption` 30, `--z-popover` 40, `--z-toast` 50, `--z-dialog` 60, `--z-operator` 70, `--z-skip` 100 | |

Themes: default is light; `prefers-color-scheme: dark` switches to the dark theme unless the page pins
`<html data-theme="light">`. The observer pins light (lit expo hall; the Matterport plan is dark lines on
white). `data-theme="dark"` forces dark. Windows forced colours keep shapes and borders and let the
system palette win; the plan canvas opts out (`forced-color-adjust: none`) but its legend is HTML text.

### 2.1 Small TS helpers (put in `web/src/ui/tokens.ts`)

```ts
export const token = (name: string, el: Element = document.documentElement): string =>
  getComputedStyle(el).getPropertyValue(name).trim();

export const reducedMotion = (): boolean =>
  matchMedia("(prefers-reduced-motion: reduce)").matches;

export type PlanPalette = ReturnType<typeof planPalette>;
export function planPalette() {
  const t = (n: string) => token(n);
  return {
    wall: t("--d-wall"), glass: t("--d-glass"), obstacle: t("--d-obstacle"),
    route: t("--d-route"), casing: t("--d-route-casing"), before: t("--d-before"),
    stairsA: t("--d-stairs-a"), stairsB: t("--d-stairs-b"),
    traveller: t("--d-traveller"), travellerRing: t("--d-traveller-ring"), caneFree: t("--d-cane-free"),
    heat: [t("--heat-1"), t("--heat-2"), t("--heat-3"), t("--heat-4")],
    heatAlpha: Number(t("--heat-alpha")), planOpacity: Number(t("--d-plan-image-opacity")),
    paper: t("--c-surface"), ink: t("--c-ink"), ink2: t("--c-ink-2"),
  };
}

/** Re read the palette when theme, contrast or motion preferences change. */
export function onPrefsChange(fn: () => void): void {
  for (const q of ["(prefers-color-scheme: dark)", "(prefers-contrast: more)", "(prefers-reduced-motion: reduce)"])
    matchMedia(q).addEventListener("change", fn);
}

/** Diagonal hatch for stairs and "simulated" areas on canvas. */
export function hatch(ctx: CanvasRenderingContext2D, a: string, b: string, size = 12): CanvasPattern {
  const c = document.createElement("canvas"); c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.fillStyle = b; g.fillRect(0, 0, size, size);
  g.strokeStyle = a; g.lineWidth = size / 3;
  g.beginPath(); g.moveTo(-size, size); g.lineTo(size, -size); g.moveTo(0, 2 * size); g.lineTo(2 * size, 0); g.stroke();
  return ctx.createPattern(c, "repeat")!;
}

/** Size a canvas for crisp lines on any display. Call on resize. */
export function fitCanvas(cv: HTMLCanvasElement): CanvasRenderingContext2D {
  const r = cv.getBoundingClientRect(), d = devicePixelRatio || 1;
  cv.width = Math.round(r.width * d); cv.height = Math.round(r.height * d);
  const ctx = cv.getContext("2d")!; ctx.setTransform(d, 0, 0, d, 0, 0); return ctx;
}
```

---

## 3. Components

Class names below are suggestions; keep them, so the forced colours block in the tokens file applies.

### 3.1 Buttons

| Variant | Look | Use |
|---|---|---|
| `.btn--primary` | `--c-accent` fill, `--c-on-accent` text, no border, `--r-primary` (14px) radius | one per screen (1.4): Start, Start rehearsal, Next question, Start run 2 |
| `.btn--secondary` | `--c-surface` fill, `--c-ink` text, 2px `--c-rule` border | everything else |
| `.step-button` | phone only, see below | |

* Size: `min-height: var(--target-min)` (48px), primary and rehearsal controls `var(--target-primary)`
  (64px). Padding `0 var(--sp-5)`. Font `--fs-body`, weight `--fw-bold`. Radius `--r-control` (6px); primary buttons only use `--r-primary`.
  Gap between adjacent buttons at least `--target-gap`.
* States: hover darkens (`--c-accent-strong` or `--c-surface-2`); pressed adds a 3px inset ink border
  (`box-shadow: inset 0 0 0 3px var(--c-ink)` is allowed here because it is a state, not decoration);
  focus uses the global single accent ring; busy keeps the same width and changes the label ("Building
  rehearsal" with `aria-busy="true"` on the region it controls).
* Never `disabled` without a reason. Prefer `aria-disabled="true"` plus a visible line saying why.
* Labels are verbs that say what happens: "Start", "Start run 2", "Copy driver message", "Open rehearsal".
  The result echoes the verb: "Copied".

```css
.btn { display:inline-flex; align-items:center; gap:var(--sp-2); min-height:var(--target-min);
  padding:0 var(--sp-5); font:inherit; font-weight:var(--fw-bold); border-radius:var(--r-control);
  border:var(--bw-control) solid var(--c-rule); background:var(--c-surface); color:var(--c-ink); cursor:pointer; }
.btn--primary { background:var(--c-accent); color:var(--c-on-accent); border-color:var(--c-accent); min-height:var(--target-primary); border-radius:var(--r-primary); }
.btn--primary:hover { background:var(--c-accent-strong); border-color:var(--c-accent-strong); }
.btn:active { box-shadow: inset 0 0 0 var(--bw-strong) var(--c-ink); }
```

**Phone Step button.** A real `<button class="step-button">Step</button>` that fills the screen above
the bottom bar (`position: fixed; inset: 0 0 var(--bottom-bar-h) 0`). Fill `--c-accent`, label "Step" in
`--c-on-accent`, `--fs-step` at `--fw-heavy`, with a one line hint under it in `--fs-lead`: "Tap to take one step". The
accessible name is just "Step" (short, so VoiceOver repeats it quickly; the hint is `aria-hidden`).
On press: the fill changes to `--c-accent-strong` for 120 ms (a colour change, kept under reduced
motion) plus `pulse(25)`. The current spoken line is shown over the top of the button inside the transcript region
(section 3.4) with `pointer-events: none`, so taps always reach the button. Bottom bar: three equal
`.btn--secondary` buttons, 72px tall: **Repeat**, **Where am I**, **Recentre**. No swipes anywhere.
Focus goes to Step when Rehearse starts.

### 3.2 Text input (Home)

* Visible `<label>` above in `--fs-lead` bold: "Where is your appointment?"
* Input 64px tall, `--fs-lead`, 2px `--c-rule` border, `--c-surface` fill, radius `--r-control`, full
  width of the content column (max 36rem).
* Hint under it, `--fs-small`, `--c-ink-2`, joined with `aria-describedby`: "For example: the clinic
  name and the city."
* Error under it in `--c-bad` starting with the word "Error:", `aria-invalid="true"`, and a fix: "We could not find
  that place. Try the clinic name and the city, or the street address."
* `enterkeyhint="go"`, `autocomplete="off"`. Enter submits the same as Start.

### 3.3 Mode switcher (superseded: always app voice, no choice screen)

After Start, the Start button is replaced in place by two large choice buttons; focus moves to the
first. Each is a `.btn--secondary` at least 96px tall, full width on phone, side by side above 720px:

| Title (`--fs-lead`, bold) | Line under it (`--fs-small`) |
|---|---|
| Start with app voice | SecondVisit speaks every line. Use headphones. |
| Start with my screen reader | Your screen reader reads every line. SecondVisit plays sounds only. |

The chosen mode is written in the operator panel and in the header: "Voice: app" or "Voice: screen reader".
This is the gesture that creates the AudioContext (Task 8 `start()`), so nothing plays before it.

The rehearsal steps nav (Explore, Rehearse, Check yourself, Pocket summary) is a real sequence:
`<nav aria-label="Rehearsal steps"><ol>` of buttons with `aria-current="step"` on the current one. The
current item is bold with a 4px ink bar under it and the visible word "now" after it; colour is
never the only signal.

### 3.4 Live transcript region

One persistent element present from page load (CLAUDE.md rule 7, agent3 section 2.2):

```html
<section class="transcript" aria-labelledby="tr-h">
  <h2 id="tr-h" class="sr-only">What SecondVisit says</h2>
  <p id="say-polite" class="transcript__now" aria-live="off"></p>       <!-- "polite" in screen reader mode -->
  <p id="say-assertive" class="sr-only" aria-live="off"></p>             <!-- "assertive" in screen reader mode: stairs, arrived, off route -->
  <ol class="transcript__history" aria-label="Earlier lines"></ol>       <!-- never live; last 5 lines -->
</section>
```

* Current line: `--fs-caption`, `--fw-medium`, `--c-ink` on `--c-surface`, 4px ink left rule, at most
  3 lines then it scrolls the history. Safety lines get a 4px accent left rule and keep their words
  ("Stairs ahead.").
* Replace the text, never append. Same line twice: clear, then set on the next animation frame.
* History: `--fs-small`, `--c-ink-2`, newest first.
* A small text tag "Speaking" shows while a clip plays (`Speech.speaking`); no waveform, no pulsing dot.

### 3.5 Provenance chip and layer meter

```html
<button class="chip chip--mp" aria-expanded="false" aria-controls="prov-42"
        aria-label="Source: Matterport scan. Show details">MP</button>
<div id="prov-42" class="chip__details" hidden>
  <dl><dt>Field</dt><dd>rooms[3].dimensions.area</dd><dt>Pulled</dt><dd>21:42</dd></dl>
</div>
```

| Chip | Text | Border | Fill | `aria-label` |
|---|---|---|---|---|
| `MP` | MP | 2px solid ink | none | Source: Matterport scan |
| `VX` | VX | 2px solid ink | none | Source: Vexcel aerial image |
| `CS` | CS | 2px solid ink | none | Source: CoStar record |
| `CALC` | CALC | 2px solid ink | none | Computed from MP and CS (list the inputs) |
| `AI` | AI 0.72 | 2px **dotted** ink | none | Labelled by AI, confidence 0.72 |
| `HAND` | HAND | 2px solid ink | `--c-mark` | Confirmed by a person |

* Size: `--fs-small` bold, height 1.75rem (28px), padding 0 8px, radius `--r-chip`. Above the 24px
  WCAG 2.5.8 minimum; in tables give the cell 8px around it.
* AI under 0.6: the chip shows the confidence value ("AI 0.42") in `--c-caution` bold. The label itself is
  the short spoken name only; the word "possibly" is never spoken or shown (human decision 15 Nov).
* Placement: on a column header or a section heading when every value below shares a source (portfolio
  CoStar columns); per value only when sources differ value to value (landmarks, spoken numbers).
  Do not sprinkle chips on every cell.
* Details: click or Enter toggles the `<dl>` below the chip; Escape closes and returns focus. Key S in
  rehearsal speaks the source of the current instruction (Task 19).

**Layer meter** ("Where the facts come from"): one row of cells, not a dotted string.

```html
<figure class="layer-meter">
  <figcaption>Where the facts come from</figcaption>
  <dl><div><dt>MP</dt><dd>23</dd></div><div><dt>VX</dt><dd>4</dd></div><div><dt>CS</dt><dd>5</dd></div>
      <div><dt>CALC</dt><dd>9</dd></div><div class="is-hand"><dt>HAND</dt><dd>2</dd></div></dl>
  <p>Placed by a person: entrance and drop off. Everything else came from the scan, the aerial image and the record.</p>
</figure>
```

Under the cells, an `aria-hidden` bar with one segment per source, widths proportional to counts, 2px
paper gaps between segments, all ink except HAND in yellow with an ink outline.

### 3.6 "simulated", "assumed", "scripted", "replay" tags

Lowercase words, exactly as CLAUDE.md rule 8 names them, placed straight after the number or item:
"Arrival 82% `simulated`".

```css
.tag { display:inline-block; font-size:var(--fs-small); font-weight:var(--fw-medium); padding:0 6px;
  border:var(--bw-control) solid var(--c-ink); border-radius:var(--r-chip); color:var(--c-ink); }
.tag--simulated { background: repeating-linear-gradient(135deg, var(--c-hatch) 0 2px, transparent 2px 7px); }
.tag--assumed, .tag--scripted, .tag--replay { border-style: dashed; }
```

Screen readers read the word naturally ("82 percent simulated"); no extra ARIA.

### 3.7 Data table (portfolio, before and after, run comparison)

* Real `<table>` with a visible `<caption>` (`--fs-h3`), `<th scope="col">`, `<th scope="row">` for the
  first column. Wrap in `<div role="region" aria-labelledby="cap-id" tabindex="0">` with
  `overflow-x: auto` so at 200% zoom it scrolls sideways inside its box (allowed for data tables).
* Text `--fs-small` (18px), rows at least 48px, numbers right aligned with tabular figures, units in
  the header ("Build (s)"), not repeated in cells.
* Header bottom border 2px ink; row borders 1px `--c-rule-soft`. No zebra stripes, no hover lift.
  Selected row: `--c-surface-2` plus a 4px ink bar on the left.
* Sortable headers: `<button>` inside `<th>`, `aria-sort` on the `<th>`, the sort direction written as
  words ("high to low") next to the label, no arrow icon. Default sort is by score, high to low.
* Score cells carry an inline bar: 8px tall, ink, width proportional, value text to its left. No colour
  scale on cells.

### 3.8 Before and after card (venue)

A table first, a small paired bar second.

| Measure | Now | With changes | Change |
|---|---|---|---|
| Navigability score `CALC` | 0.58 | 0.74 | up 0.16 |
| Arrival rate `simulated` | 61% | 83% | up 22 points |
| Open area to cross (m) `CALC` | 7.4 | 2.1 | down 5.3 m |
| Turns | 5 | 3 | down 2 |

(Numbers above are layout examples only; the real ones come from `Report`.) Change is written as words.
Under the table, one horizontal paired bar per percentage measure: "Now" bar in `--d-before` graphite,
"With changes" bar in `--d-route` blue, 12px tall with a 2px gap, both direct labelled with their value.
One axis, starting at 0.

### 3.9 Agent trace panel line

```
21:42:07  site_investigator  resolve_place("Medical Office Houston")   done
21:42:09  annotator          look(pano 14, front)                       running
21:42:15  annotator          placed reception desk  AI 0.91             done
21:43:02  orchestrator       scripted fallback: model did not answer    [scripted]
```

* Grid: `8ch` time, `11rem` actor, `1fr` text, `auto` status. Time and status in `--c-ink-2`.
* Actor in `--fw-bold`. Tool calls in `--font-mono` at `--fs-small`; plain sentences in `--font-sans`.
* Status as a word, no icon: "running" (regular weight), "done", "failed" (bold), and "scripted" or
  "replay" as the matching dashed tag.
* `ask_visitor` lines (the one clarifying question) get a 4px accent left rule and the word "question": a question to a person.
* `role="log"` with `aria-live="off"`. A separate `role="status"` line under the panel announces phase
  changes only ("Annotator finished: 14 landmarks"). Keep 200 lines, show the last 12; if the user has
  scrolled up, stop auto scrolling and show a "Show newest" button.

### 3.10 Status and toast

Only on venue, portfolio, observer and pick pages; in rehearsal every message goes through `say()`.
Bottom left, `--z-toast`, `--c-surface` fill, 2px ink border, words only (no icon), `role="status"`
(errors `role="alert"`). Stays until replaced or closed with its Close button (no timed dismissal).
Errors say what happened and what to do: "Matterport did not answer. Showing the cached scan from 21:10."

### 3.11 Quiz option buttons

* Four stacked full width `.btn--secondary` buttons, each at least 64px, `--fs-lead`, gap 8px. Phone
  and laptop are the same (agent3 2.2: stacked buttons, not screen quadrants).
* Left side: a 48px ink outlined square with the digit 1 to 4 (the key). The digit is `aria-hidden`;
  the button name is the option text.
* After an answer: the chosen option shows the word "Correct" or "Not this
  one" (with a solid or dashed border); the right option gets "Correct answer". Options become `aria-disabled` and focus
  moves to "Next question". Spoken feedback is the same words.
* R repeats the options; 1 to 4 answer.

### 3.12 Pointing dial readout

A clock face, because spoken directions use clock hours: an SVG circle (220px in the app, 30vh on the
observer) with 12 at the top meaning "facing into the building", hour ticks, and 12, 3, 6, 9 labelled.

* Before confirm (rehearsal screen): only the user's current heading as a route blue line and the words
  "You are facing 2 o'clock". **No target, no hint**; Task 10 test `no feedback before confirm` covers
  speech and the dial must follow the same rule.
* After confirm: the target bearing as an ink line ending in a labelled ink dot ("Reception desk"), the
  pointed heading as a blue line with an arrow head ("You pointed"), the error arc between them filled
  with hatch, and the number in `--fs-h1`: "14° off". Text under it repeats the spoken line.
* Observer: two dials side by side, "Run 1" and "Run 2", numbers in `--fs-proj-number`.

---

## 4. Screens

Widths: laptop 1280 to 1440 CSS px, content column max 72rem, gutter `--gutter`. At 200% zoom every
laptop layout collapses to the single column phone order shown in each wireframe's reading order.
Every page: `<html lang="en">`, a skip link, one `<h1>`, landmarks (`header`, `nav`, `main`). On
visitor screens the `<h1>` is the big title (`--fs-title-visitor`, 700) with one line under it in
`--c-ink-2`; there is no coloured band. Judge screens keep a top bar (frosted, ink text, 1.4).

### 4.1 Home / Start (`index.html`, before Start)

```
  Make your first visit your second.                          --fs-title-visitor, 700
  Tell us where your appointment is.                          one line, --c-ink-2

  Where is your appointment?                                  --fs-lead bold
  ┌──────────────────────────────────────────────────┐
  │ Medical Office, Houston                          │        64px input
  └──────────────────────────────────────────────────┘
  For example: the clinic name and the city.                   --fs-small

  ┌────────────┐
  │   Start    │                                               64px primary, 14px radius
  └────────────┘
  Nothing plays until you press Start. Wired headphones work best.

  ── after Start, in place of the button, focus on the first ──
  ┌──────────────────────────────────┐  ┌──────────────────────────────────┐
  │ Start with app voice             │  │ Start with my screen reader      │
  │ SecondVisit speaks every line.   │  │ Your screen reader reads every   │
  │ Use headphones.                  │  │ line. SecondVisit plays sounds.  │
  └──────────────────────────────────┘  └──────────────────────────────────┘

  ── then, while the agent builds (this is demo beat 1) ──
  Building your rehearsal                                       h2, aria-busy
  1. Found the building: Medical Office, 1 floor    done   CS   ordered list, state in words
  2. Read the scan: 9 rooms, 3 doors                done   MP
  3. Looking at panoramas for landmarks             running  AI
  4. Planning a cane friendly route                 waiting  CALC
  [ Start rehearsal ]  (appears when ready, takes focus)
```

Left aligned; no centred hero. With `?b=<sid>` (demo links) the input is replaced by the resolved name as
plain text so Start is the only focusable element before Start (Task 8 test `start gate`).

### 4.2 Rehearsal, laptop (`index.html`, after Start)

```
  Medical Office, Houston                                 Voice: app  Theme    h1, --fs-title-visitor
  Rehearse the way in, one stretch at a time.                                  one line, --c-ink-2

  Rehearsal steps:  1 Explore   2 Rehearse (now)   3 Check yourself   4 Pocket summary
                                ▔▔▔▔▔▔▔▔ ink bar under the current step
┌───────────────────────────────────────────────────┐  ┌─────────────────────┐
│ STAGE  role="application" tabindex="0"             │  │ Keys                │
│ ┌───────────────────────────────────────────────┐ │  │ Up       walk       │
│ ▌ Wall on your left. Walk about 12 steps to     │ │  │ Down     step back  │
│ ▌ the doorway.                    --fs-caption  │ │  │ Left Right  turn    │
│ └───────────────────────────────────────────────┘ │  │ Space    repeat     │
│ Earlier lines                                      │  │ W  where am I       │
│  Open area for about 6 steps, nothing to follow.   │  │ H  heading          │
│  You are entering the waiting room.                │  │ B  destination hint │
│                                                    │  │ S  source of line   │
│ Stretch 2 of 6   Room: Corridor  MP   Speaking     │  │ M mono  + − rate    │
└───────────────────────────────────────────────────┘  └─────────────────────┘
  Sound: running   Motion: unavailable, using keys   (status line, polite)
```

* The stage gets focus on entering Explore or Rehearse and keeps a visible focus ring (a sighted helper
  must see where keys go). The keys list is a real `<dl>`; on narrow screens it moves under the stage.
* No map on the rehearsal screen by default (sensory honesty: the user rehearses by sound). A "Show
  plan for a sighted helper" toggle is P2 and off by default.
* **Check yourself:** pointing dial on the left, after confirm the result text; then the quiz (3 questions,
  stacked option buttons, progress "Question 2 of 3").
* **Pocket summary:** an ordered list of instructions (one `<li>` per spoken line, Space reads them one
  per utterance), then the driver message in a bordered box with "Copy driver message", then the
  Vexcel arrival image with a yellow drop off pin (HAND chip fill) and an ink entrance pin, and real alt text
  built from data: "Aerial photo, north at the top. Drop off point on the north side by the main
  entrance." Chips next to each fact. Under the run, "Start run 2" (primary) with the coach line above it.

### 4.2a Rehearsal, laptop and projector: the 3D room (supersedes the 4.2 sketch above and its "no map" rule)

The rehearsal screen is also what judges and companions watch. The traveller's experience does not change:
audio, keys, the `role="application"` stage and the transcript behave exactly as in 4.2. The visual layer is
decorative for sighted watchers (`aria-hidden="true"` canvas and mini plan) and carries nothing a blind
user needs. It is hidden on phones (4.3 is unchanged).

```
┌ top bar ───────────────────────────────────────────────────────────────────────────────────────┐
│ Medical Office   29.9666, -95.5394   Map 2024-05-24   MP VX CS AI HAND     Explore Rehearse ...  │
├───────────────────────────────────────────────────────────┬─────────────────────────────────────┤
│ STAGE role="application" tabindex="0"                      │ Objects (every landmark)            │
│  3D room (three.js canvas, aria-hidden), largest           │  name, kind, confidence, fixed or   │
│  view buttons: Behind, Top, Orbit; Scanned view if a file  │  movable, source tag; click = ring  │
│  caption card: the current spoken line (transcript)        │  in 3D; Rename, Remove, Add         │
│                                                            ├─────────────────────────────────────┤
│                                                            │ Floor plan (Matterport image, route,│
│                                                            │ you are here dot and heading)       │
├───────────────────────────────────────────────────────────┴─────────────────────────────────────┤
│ Live instruction, --fs-caption     Stretch 2 of 5    Steps to destination 14    progress bar    │
├─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ Agent and data (a <details>, closed by default): agent trace, quiz, coach line and plan,         │
│ pointing error run 1 and run 2, record facts                                                     │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

* Style stays light Apple minimal: tokens only, solid surfaces, 2px ink rules, no shadows beyond the
  3D scene's own soft light. The scene palette is neutral: floor and plan image on white, walls soft light
  grey, glass a pale translucent blue, movable furniture low soft grey blocks, unscanned rooms hatched.
  The route is the accent blue, the walker and "you are here" are `--c-mark` yellow, the destination is ink.
* 3D data comes only from `package.json`: walls from grid code 1, glass 4, movable 3, fixed 2, rooms with
  `scanned: false` hatched, landmarks as labelled pins, the route as a ribbon with the current segment
  solid and the rest lighter. The floor is textured with `floorplan.jpg` placed by `floorplan.json`
  (origin metres, resolution px per metre). Missing plan: the visible note "Floor plan not available" (R16).
* Camera: behind and above the walker with smooth follow; buttons Behind, Top, Orbit (keys `[`, `]` and `\`
  are free; existing keys keep their meaning). `prefers-reduced-motion`: the camera snaps.
* Walker: a small yellow capsule; the cane a thin line that sweeps with the cane angle; a ring marks a tap.
* Objects list is a real `<table>` with a caption. Edits save to `data/<sid>/overrides.json` through
  `POST /api/overrides/<sid>/landmarks`; they take effect in the package on the next build and the list says so.
* Bottom strip text is the route's own instruction and counters from the package, not model text.

### 4.2b The new experience (14 Nov 23:37 decisions; binding, supersedes 3.3 and the home wireframe in 4.1)

Build order (human reorder, 14 Nov): first the interior 3D cockpit (items 5, 6, 8 below, plus the layout in 4.2a), reviewed
by the human; then outdoor, fly in and home (1 to 4), then sound ring and intro (7, 9). One continuous flow, light Apple minimal, tokens only:

1. **Home.** One address box ("Where is your appointment?"), nothing else competing. Submit resolves the
   place (engine resolver; a fixed offline list backs the demo so the clinic name or address always resolves)
   and loads its package. Unknown place: the 3.2 error with a fix. `?b=<sid>` skips typing.
2. **Fly in.** The 3D camera starts high above the street and eases down onto the Vexcel aerial (ortho
   ground quad, `VX`). It reveals, in order: the yellow drop off pin (`HAND`), the blue path with a tick
   every step (`CALC`), the door pin under the canopy slab, and the building massing (`MP` outline from the
   scan if nothing better, labelled "suite from the scan"). It speaks the arrival line, then lands behind the
   walker at the curb. `prefers-reduced-motion`: cuts, no moves. Any key skips the fly in.
3. **Walk starts at the curb.** Outdoors the building outline is a wall; one continuous camera move carries
   the walker through the door into the interior scene, same world frame, the building shell fading away.
4. **Outdoor and interior 3D** share one frame. Every outdoor object wears its chip (`VX`, `HAND`, `CALC`, `MP`,
   `assumed`). Nothing invented: unknown canopy or door type is drawn dashed as `assumed`, or left out.
5. **Always app voice.** No voice choice screen. Start goes straight to the rehearsal; we speak every line.
6. **Captions** are always visible, with direction ("Reception desk, 2 o'clock" plus an arrow), in an
   `aria-live="off"` region; speech always equals its caption.
7. **Sound ring** (a later task) draws every positioned sound around the walker in the 3D view, the same
   events that drive audio and captions.
8. **Cockpit.** The 3D view is the widest element (full width of the stage, no dead grey beside it); the
   caption is a card overlaid at its bottom, not a box that takes height from it; objects, floor plan and
   data sit around and below it.
9. **Intro.** A short guided intro (about 10 s, Esc skips) names what is on screen, then the first action.

### 4.3 Rehearsal, phone

```
┌──────────────────────────┐
│ Medical Office   Voice:app│  48px header, --fs-small, plain ink on white
├──────────────────────────┤
│ ▌Wall on your left. Walk │  transcript region, pointer-events none
│ ▌about 12 steps.         │
│                          │
│                          │
│          Step            │  full screen <button>, accent blue, --fs-step 700
│   Tap to take one step   │
│                          │
│                          │
├────────┬────────┬────────┤
│ Repeat │ Where  │Recentre│  3 buttons, 72px tall, 8px gaps
│        │  am I  │        │
└────────┴────────┴────────┘
```

Turning is the body (relative yaw); the cane sweeps with gamma. Pointing task on phone: the Step button
becomes "Confirm" with the same size and position. Quiz: the four stacked option buttons fill the same
area. Follows the system theme; the dark theme is comfortable for light sensitive users.

### 4.4 Observer view (`observer.html`, projector, read from 5 m)

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│ Medical Office, Houston    Run 2 of 2    Rehearse    Stretch 3 of 6               6vh band │
├─────────────────────────────────────────────────────────────┬────────────────────────────┤
│                                                             │ Matterport 3D tour (16:9)  │
│   PLAN CANVAS                                               │ iframe, only if public     │
│   floorplan.jpg grey at 35%                                 ├────────────────────────────┤
│   walls ink, glass double teal, obstacles orange            │ Pointing error             │
│   route blue (current stretch thicker)                      │   Run 1         Run 2      │
│   run 1 trail graphite, run 2 trail blue, labelled          │   (dial) 38°    (dial) 11° │
│   traveller: yellow disc, ink ring, heading wedge           ├────────────────────────────┤
│   cane ray, tap rings                                       │ Agent trace (last 6 lines) │
│                                                             │ or, after run 2: the run   │
│  Legend (HTML): wall  glass  obstacle  chair  route  you    │ 1 vs run 2 table           │
├─────────────────────────────────────────────────────────────┴────────────────────────────┤
│ They hear:  "Open area for about 6 steps, nothing to follow."            5.2vh caption    │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

Grid: `grid-template-columns: 64fr 36fr; grid-template-rows: 6vh 1fr auto;`. Pinned
`data-theme="light"` (a lit hall washes out dark backgrounds; the Matterport plan is dark on white).
The 6vh top band is `.glass-bar` and the agent trace panel is `.glass-panel` (1.4); everything else on
the observer is solid.

**Projector rules** (5 m viewing distance, 1080p assumed):

* Sizing basis: signage practice is about 25 mm of letter height per 10 m for comfortable reading, so
  12.5 mm at 5 m; slide practice puts the absolute minimum at 1/50 of screen height (21.6px at 1080p).
  On a 1.5 m tall screen 1px is about 1.4 mm. Our floor is **32px text (3vh)**, cap height about 21px or
  30 mm: more than twice the comfort rule, which leaves room for a washed out projector, a smaller screen
  and judges with low vision.
* Minimums at 1080p: any text 3vh (32px); body 3.6vh; panel headings 4.4vh; caption 5.2vh (56px), at
  most 2 lines; big numbers 10vh. Room labels on the plan 3vh with a 4px paper halo
  (`ctx.strokeText` in `--c-surface` under `fillText`).
* Lines at 1080p (scale by `canvas_height / 1080`): walls 4px, glass two 2px lines 3px apart, route 8px
  with a 3px white casing, current stretch 12px, completed stretches 4px graphite, trails 4px (run 1)
  and 6px (run 2), cane ray 3px.
* The observer is one way and never flashes the whole screen. Tap rings are small (well under the
  WCAG 2.3.1 flash area) and at most one per 60 ms gate.

**What to draw, in order** (canvas 2D, `fitCanvas` for DPR):

| # | Layer | Style |
|---|---|---|
| 1 | Fill | `--c-surface` |
| 2 | Floor plan image | `floorplan.jpg` placed by origin and resolution, `ctx.filter = "grayscale(1)"`, `globalAlpha = --d-plan-image-opacity` (0.35) |
| 3 | Room labels | `--c-ink-2`, 3vh, paper halo; from `rooms[].label` |
| 4 | Lost heatmap (venue only) | 4 bins `--heat-1..4` at `--heat-alpha`, cells with zero lost unfilled |
| 5 | Fixed obstacles (code 2) | `--d-obstacle` at 35% fill plus 2px solid outline |
| 6 | Movable (code 3) | `--d-obstacle` 2px dashed outline (6 on, 4 off), no fill |
| 7 | Walls (code 1) | `--d-wall` 4px; door gaps left open |
| 8 | Glass (code 4) | `--d-glass` double line |
| 9 | Stairs or drop (code 5) | `hatch(--d-stairs-a, --d-stairs-b)`: the real world step edge marking |
| 10 | Route | casing then `--d-route`; current stretch thicker; completed stretches graphite |
| 11 | Trails | run 1 `--d-before` 4px, run 2 `--d-route` 6px; "Run 1" / "Run 2" written at each trail end |
| 12 | Landmarks | 10px ink ring plus label; AI landmarks dotted ring; under 0.6 the AI chip shows the confidence value; the label never says "possibly" |
| 13 | Destination | 16px ink square, label |
| 14 | Cane ray | free: `--d-cane-free` 3px to `CANE_M`; on contact: material colour, ends at the contact shape |
| 15 | Tap rings | at contact; radius 10 to 24px over `--dur-tap` (300 ms), 4px stroke; shape by material: wall ink circle, glass teal double circle, fixed obstacle orange square, movable orange dashed triangle, bump ink cross 24px. Reduced motion: static shape for 300 ms |
| 16 | Traveller | 16px radius `--d-traveller` disc, 4px `--d-traveller-ring` ring, ink heading wedge 60 degrees, 32px long |
| 17 | Pointing | from the entrance: true bearing ink line, pointed heading blue arrow, hatch error arc, number in 10vh |

Legend in HTML under the canvas (so forced colours and zoom work): a drawn swatch with its shape plus
the word for each of wall, glass, fixed obstacle, chair or movable, stairs, route, run 1, run 2, you.
The canvas has `role="img"` and an `aria-label` updated each segment ("Traveller in the corridor,
stretch 3 of 6, 4 m from the waiting room").

### 4.5 Venue view (`venue.html`, Layout tab)

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ Venue view: Medical Office, Houston                         [ Layout ] [ Portfolio ]   │ glass bar, ink text
└────────────────────────────────────────────────────────────────────────────────────────┘
  "Where should reception go?"   [ Run layout advisor ]
┌──────────────────┬──────────────────────────────────────────┬──────────────────────────┐
│ Agent trace      │ PLAN                                     │ Before and after         │
│ (role=log)       │  current route: graphite solid           │  table (3.8)             │
│                  │  proposed route: blue dashed             │  paired bars             │
│ 21:50 layout_    │  current desk: ink square "Desk now"     ├──────────────────────────┤
│ advisor ...      │  proposed desk: blue dashed square       │ Fixes                    │
│                  │  tactile strip: yellow with ink edge     │  1. Move desk to C3      │
│                  │  seating edge: orange dashed             │  2. Tactile strip from   │
│                  │  lost heatmap, 4 bins                    │     door to desk         │
│                  │ Legend: Lost here (simulated, 300 runs)  ├──────────────────────────┤
│                  │  ■ up to 2%  ■ 2 to 5%  ■ 5 to 10%       │ Advisor rounds (ol)      │
│                  │  ■ over 10%   (hatched legend frame)     │  Round 1 proposal,       │
│                  │                                          │  result, critique AI     │
└──────────────────┴──────────────────────────────────────────┴──────────────────────────┘
```

Grid `minmax(18rem, 22rem) 1fr minmax(22rem, 26rem)`; below 1200px the trace drops under the plan.
The top bar is `.glass-bar` (sticky, so the page scrolls under it) and the agent trace column
is `.glass-panel` (1.4). The plan, the before and after card, fixes and rounds stay solid.
Heatmap bins are fixed (not quantiles) so before and after maps are comparable; each bin swatch carries
its range as text. The heatmap legend frame is hatched because the whole layer is simulated.
Critique text is AI written and carries the `AI` chip; every number next to it comes from code.

### 4.6 Portfolio (`venue.html`, Portfolio tab)

```
┌ top bar: Venue view: Medical and office suites, Houston ────────────────────────────────┐
  20 suites built in 6 min 40 s  CALC      Entrance for each is assumed  [assumed]
  ┌──────────────────────────────────────────────────────────────────────────────────────┐
  │ Ranked by how easy they are to learn (caption)                                        │
  │ Rank │ Building and address       │ Type, class CS │ Rooms MP │ Score CALC ▼ │ Wall   │
  │      │                            │                │          │              │ share  │
  │   1  │ Medical Office             │ Medical, B     │     9    │ 0.81 ██████▍ │  64%   │
  │      │ 1234 Example St, Houston   │                │          │              │        │
  │   2  │ ...                        │                │          │              │        │
  │      │ ... Decisions │ Open m │ Entrance [assumed] │ Build (s) │ [ Open rehearsal ]    │
  └──────────────────────────────────────────────────────────────────────────────────────┘
```

(Row text above is placeholder layout, not data.) Chips sit in the column headers. "Open rehearsal" is a
secondary button per row. Row count and total build time are the scale moment, so they get `--fs-h2`.

### 4.7 pick.html (internal, low priority)

Tokens and the base layer only: a plain table of candidate pins, the floor plan canvas with the same
draw order, and "Save pin" buttons that write `HAND` entries. No extra design work.

---

## 5. Copy and voice

**Principles**

* Plain words, short sentences, sentence case, no exclamation marks.
* Name things the way a visitor or a building manager would: "the reception desk", "the waiting room",
  "drop off point"; never "node", "segment" or "pano" on a user screen (say "stretch" for segment).
* Numbers come from the package and are said with "about" when they are step counts: "about 12 steps".
* Directions are left, right, straight on, or a clock hour from where you face.
* Every spoken line does one job and ends with what to do. At most 160 characters (Task 8).
* Say what we do not know: "chairs may move", "this number is simulated". Low confidence labels show only
  as the AI chip value, never a word in speech (human decision 15 Nov).
* Errors say what happened and what to do next; they never apologise and are never vague.

**Spoken lines (examples)**

| Moment | Say | Not |
|---|---|---|
| Instruction | "Wall on your left. Walk about 12 steps to the doorway." | "Proceed along segment 2 for 8.4 metres." |
| Open area | "Open area for about 6 steps, nothing to follow." | "Caution! Large open space detected!" |
| Off route | "Off route. Wall was on your right." | "Oops, you went the wrong way." |
| Arrive | "You have reached the reception desk." | "Congratulations, you made it!" |
| Pointing | "You were 14 degrees off. The desk is at 1 o'clock from here." | "Great job, almost perfect!" |
| Coach | "Next run starts just before the turn after the waiting room." | "Our AI has optimised your learning path." |
| Paused | "Paused. Focus lost." | |
| Motion denied | "Motion not available. Use the Step button and the arrow buttons." | |

**On screen (examples)**

| Place | Text |
|---|---|
| Home title | Make your first visit your second. |
| Input label | Where is your appointment? |
| Start note | Nothing plays until you press Start. Wired headphones work best. |
| Build list | Found the building / Read the scan / Looking at panoramas for landmarks / Planning a cane friendly route |
| Venue question | Where should reception go? |
| Heatmap legend | Lost here (simulated, 300 runs) |
| Portfolio caption | Ranked by how easy they are to learn |
| Limits note (summary footer) | SecondVisit helps you prepare. It does not replace your cane, your guide dog or mobility training. |

**Never** say "experience blindness", "see what it's like to be blind", "replaces a cane", "ADA
compliant", "tested with blind users" (unless it happened tonight, then say exactly who and how many),
"AI powered", "revolutionary", "seamless". Prefer "blind and low vision people" over "the visually
impaired".

---

## 6. Ten minute accessibility check

Run before every merge to main after 03:00, and once at freeze (05:00). Each line says what proves it.

| # | Check (minutes) | Pass when | Automated by |
|---|---|---|---|
| 1 | **Keyboard only** (2): unplug the mouse. Home: Tab to input, type, Enter, choose a mode, rehearse a stretch with arrows, Space, W, H; Tab out of the stage; do the pointing task and quiz with keys; reach Copy driver message | Everything reachable, focus ring always visible (accent ring), focus never lost to `<body>`, arrows never scroll the page | `start gate`, `key repeat throttled`, `blur pauses` (Task 8); add `stage prevents scroll` (arrow keydown on stage has `defaultPrevented`) |
| 2 | **VoiceOver** (3): Cmd F5 in Chrome. Choose "my screen reader". Hear one instruction, an off route line, the arrive line; check our voice never speaks. On iPhone: VoiceOver on, double tap Step walks; Repeat, Where am I, Recentre are named | Every line heard once, no double speech, buttons have names, headings list makes sense (VO U) | `screen reader mode does not speak`, `speech priority` (Task 8); add `live regions exist at load` (both `#say-polite` and `#say-assertive` in `index.html` before any script runs) and `every button has a name` (jsdom: no `button` with empty `textContent` and no `aria-label`) |
| 3 | **Contrast** (1): run the token test; spot check the plan legend and chips in DevTools picker | All text pairs at least 4.5:1 (AA) and non text at least 3:1 | add `tokens contrast` (below) |
| 4 | **Zoom 200%** (2): Cmd plus to 200% on Home, Rehearsal, Venue, Portfolio | No horizontal scroll of the page (tables scroll inside their region), nothing overlaps, text doubled | manual; computed check: `--fs-body` at 720px viewport equals its max |
| 5 | **Reduced motion and contrast** (1): macOS Settings, Accessibility, Display: Reduce motion and Increase contrast on; reload observer and venue | Tap rings appear static, no transitions; borders thicker, secondary text turns full ink | add `reduced motion makes tap ring static` (mock `matchMedia`, renderer radius constant) |
| 6 | **Glass** (1): on observer and venue, scroll content under the top bar; then turn on macOS Reduce transparency, then Increase contrast | Bar and trace text stay readable over the busiest backdrop; with either setting on, both surfaces turn solid; no blur anywhere on `index.html` | add `glass alpha keeps 4.5:1` (composite each `--glass-*-tint` over white and black, check ink and ink 2 on it) and `no glass on visitor screens` (no `backdrop-filter` in `index.html` styles or `main.ts` output) |
| 7 | **Colour not alone** (1): DevTools Rendering, Emulate vision deficiencies: deuteranopia, then achromatopsia; look at observer, venue heatmap, quiz result | Every state still readable from shape or words: legend words, "Correct" and "Not this one", dashed vs solid, run labels | add `heat legend has text` (each swatch has a range string) |

The contrast helpers live in `web/src/ui/tokens.test.ts` (WCAG 2 relative luminance; glass tints are
composited over white and black in sRGB). It checks, for the light block and again for the dark block:
ink and ink 2 on page and quiet fill, on-accent on accent and accent strong, accent on page and quiet
fill (4.5, and 3 as the focus ring), good, bad and caution on page (4.5), rule on page and quiet fill
(3), route and glass data colours on surface (3). For glass: ink and ink 2 on each tint over white and
black at 4.5 or better. It also fails if a removed token (`--c-sign*`, `--focus-inner/outer`) or an
`@font-face` comes back, and if any visitor file mentions `backdrop-filter` or `glass-`.

**Voice rule (15 Nov 2026, supersedes the mode switcher above):** one voice, am_michael. A line with a pre-rendered clip plays it; a line without one is
rendered by `POST /api/tts` (same line hash) while the caption shows at once; if that fails or takes over 600 ms a soft sine tone (about 0.12 s) plays and the caption
stays. Browser speech (`speechSynthesis`) is not used anywhere. The ids agree between web and engine (`engine/tests/line_id_golden.json`, checked by both suites).

### 6.1 Result of the check, 15 Nov 2026 (index, observer, venue, pick)

Automated in `web/src/a11y.test.ts` (all four pages) plus `app.test.ts`, `tokens.test.ts`, and a Chrome run with real Tab, Escape and F6.

Passed: `lang` and a `SecondVisit` title on every page; the stage is `role="application"` with the four keys in its name;
`#say-polite`, `#say-assertive`, `#caption`, agent log and venue trace are `aria-live="off"`; the 3D view, intro prompt and mini plan are
`aria-hidden`; every button, input, select and tab has a text name (Rename and Remove carry the object's name); canvases are `role="img"` with a label;
no positive `tabindex`; the focus ring (3px accent) shows on Start, the stage, the top bar and the panel summaries in Chrome; Home Tab reaches Start first;
Escape with nothing running leaves the stage for the top bar (Enter returns), F6 and Shift+F6 cycle top bar, stage, objects list, Keys, Agent and data;
all token contrast pairs (light and dark) pass; no page scrolls at 1280x800, 1440x900, 1920x1080 (`docs/screens/fit_*.png`).

Failed and fixed: (1) the objects list and add form could not be reached by keyboard at all (Tab is the stage's place picker): F6 now stops on the objects list;
(2) the pick page canvas had a label but no role: `role="img"` added; (3) observer and venue drew 48 overlapping landmark names: only confident names and the destination are written, the rest are dots;
(4) observer, venue and pick requested a missing favicon (404 in the console): `data:` icon added.

Not fixed: the 3D view buttons (Behind, Top, Orbit) sit inside the stage and have no key; they are for sighted companions and work with the mouse only.
`index.html` has no skip link on purpose (Start must be the first Tab stop; the top bar is hidden at Home). Zoom 200%, VoiceOver and the vision-deficiency emulation (rows 2, 4, 7) were not run by hand in this pass.

---

## 7. Build order for the 10 hours (web side)

1. Copy tokens (no font imports), base layer: 10 min. Everything after inherits it.
2. Transcript region, buttons, Start and mode switcher, phone Step layout: 45 min (with Task 8).
3. Chips and tags as two functions `chip(kind, opts)` and `tag(word)` returning elements: 30 min
   (Task 19).
4. Observer canvas draw order rows 1 to 16, legend, caption strip: 60 min (Task 17).
5. Quiz options and pointing dial: 40 min (Task 10).
6. Data table, before and after, heatmap legend, trace line: 60 min (Tasks 12, 20, trace panel).
7. The ten minute check: 10 min, then fix.

---

## 8. Sources

* Apple HIG, Typography (system font, Dynamic Type): https://developer.apple.com/design/human-interface-guidelines/typography
* Apple, SF Pro font licence (the fonts may not be embedded on websites):
  https://developer.apple.com/fonts/
* APH, Research based large print guidelines (18 pt body, 1.25 spacing, 39 to 43 characters, avoid
  italics, avoid grey text): https://www.aph.org/app/uploads/2022/04/Research-Based-Large-Print-Guidelines.pdf
* RNIB, print sizes (clear 14 pt, large 16 pt+, giant 18 pt+): https://help.rnib.org.uk/help/daily-living/large-print-size
* RNIB, Colour and contrast for people with sight loss (never yellow on white; red/green; LRV 20 to 30
  points): https://media.rnib.org.uk/documents/Colour_and_contrast_for_people_with_sight_loss_2020.pdf
* NFB, web accessibility rules of the road (headings, labels, keyboard, landmarks):
  https://nfb.org/node/10594
* Apple HIG, Accessibility (44x44 pt controls, 200% text, colour not alone, reduce motion):
  https://developer.apple.com/design/human-interface-guidelines/accessibility
* Android Accessibility Help, touch target size (48x48dp, 8dp apart):
  https://support.google.com/accessibility/android/answer/7101858
* WCAG 2.2 Understanding 2.5.8 Target Size Minimum (24px; 2.5.5 is 44px):
  https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html
* WCAG 2.2 Understanding 2.4.13 Focus Appearance (2px perimeter, 3:1 change):
  https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance.html
* Letter height versus viewing distance (25 mm per 10 m):
  https://www.studiomatrx.org/students/wayfinding-and-environmental-graphics/legibility-size-and-viewing-distance
* Projected text, 8H rule and 1/50 of screen height minimum:
  https://www.rdpslides.com/pptfaq/FAQ00125_How_big_should_text_be-_What-s_the_ideal_font_size-.htm
* Nuñez, Anderton, Renslow (2018), cividis, colormaps for colour vision deficiency:
  https://pmc.ncbi.nlm.nih.gov/articles/PMC6070163
