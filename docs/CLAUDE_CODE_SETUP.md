# Claude Code setup for SecondVisit (Saturday night, demo Sunday)

Checked against primary sources on 2026-11-14. Every command below has its source URL next to it.
Anything marked **UNVERIFIED** was not confirmed in a primary source; check it before relying on it.

Budget: about 30 minutes for one person, then commit the shared files (`.mcp.json` or
`.claude/settings.json`, `.claude/agents/`, `.claude/hooks/`, `web/e2e/`, `web/playwright.config.ts`)
so the other lanes only run the per machine installs.

---

## 0. Where to type what (VS Code extension vs CLI)

* The VS Code extension supports a **subset** of commands and skills (type `/` to see them). For
  anything missing, run `claude` in the VS Code integrated terminal (`` Cmd+` ``).
  Source: https://code.claude.com/docs/en/vs-code (section "VS Code extension vs. Claude Code CLI")
* **The extension does not put `claude` on your PATH.** `claude mcp add` and `claude plugin install`
  in a terminal need the standalone CLI install: https://code.claude.com/docs/en/setup
* **Plugins in the VS Code panel:** type `/plugins` to open **Manage plugins** (Plugins tab and
  Marketplaces tab). The extension runs the same commands as the CLI, and plugins and marketplaces
  configured in either are available in both. Source: https://code.claude.com/docs/en/vs-code#manage-plugins
* **MCP in the VS Code panel:** type `/mcp` to add, remove, enable and reconnect servers. It saves to the
  same config as `claude mcp add`. Source: https://code.claude.com/docs/en/vs-code#connect-to-external-tools-with-mcp
* The terminal, desktop app and VS Code extension on one computer read the same settings files.
  Source: https://code.claude.com/docs/en/discover-plugins
* Node: Playwright Test lists Node 22.x, 24.x or 26.x (https://playwright.dev/docs/intro); Lighthouse
  needs Node 22+ (https://github.com/GoogleChrome/lighthouse); Playwright MCP needs Node 18+
  (https://github.com/microsoft/playwright-mcp). Run `node -v` first.

---

## 1. Setup, in order

### Step 1. frontend-design plugin (Anthropic, official marketplace)

What it gives you: the `frontend-design` skill, which pushes Claude toward a deliberate aesthetic
direction instead of templated defaults, and explicitly asks for a quality floor: "responsive down to
mobile, visible keyboard focus, reduced motion respected, visually accessible" and self review with
screenshots. Source:
https://github.com/anthropics/claude-plugins-official/tree/main/plugins/frontend-design

The official marketplace `claude-plugins-official` is added automatically the first time you open an
interactive terminal session (https://code.claude.com/docs/en/discover-plugins).

| Where | Command |
| :- | :- |
| VS Code panel | `/plugins`, search `frontend-design`, click **Install**, pick **Install for this project** |
| Claude Code session (terminal) | `/plugin install frontend-design@claude-plugins-official` |
| Your shell | `claude plugin install frontend-design@claude-plugins-official --scope project` |

If the VS Code Plugins tab lists nothing, add `anthropics/claude-plugins-official` on the
Marketplaces tab first. On a fresh machine where no interactive session has run, the shell route needs
`claude plugin marketplace add anthropics/claude-plugins-official` first.
Install command source: https://github.com/anthropics/claude-plugins-official (README:
`/plugin install {plugin-name}@claude-plugins-official`).

Verify: type `/` and look for the plugin's skills in the form `/<plugin>:<skill>`, so
`/frontend-design:frontend-design` (format from https://code.claude.com/docs/en/discover-plugins;
the exact menu label is inferred from that rule). Or run `claude plugin list` in a shell.

Note: the same skill also ships in `example-skills@anthropic-agent-skills`
(https://github.com/anthropics/skills). Install it from one place only.

**Project tension to resolve in your prompts:** the skill encourages bold visual risk. SecondVisit's
CLAUDE.md rule 7 (blind and low vision users, keyboard first, large high contrast text, nothing only
visual) wins. The prompts in section 4 say so explicitly.

### Step 2. superpowers plugin (you already use it; confirm it is installed)

Source: https://github.com/obra/superpowers (README, "Installation > Claude Code"). It is listed in the
official marketplace (`.claude-plugin/marketplace.json` in
https://github.com/anthropics/claude-plugins-official, source `https://github.com/obra/superpowers.git`).

| Where | Command |
| :- | :- |
| Official marketplace | `/plugin install superpowers@claude-plugins-official` |
| Author's own marketplace (alternative) | `/plugin marketplace add obra/superpowers-marketplace` then `/plugin install superpowers@superpowers-marketplace` |

Install from one marketplace only. Verify: `claude plugin list`, or type `/` and look for
`superpowers:` skills.

Skills that matter tonight (names from the README "Skills Library"):

| Skill | Use tonight for |
| :- | :- |
| `superpowers:test-driven-development` | Every task (CLAUDE.md rule 10 already demands it) |
| `superpowers:systematic-debugging` | Any failing test, NaN position, audio glitch, agent loop |
| `superpowers:verification-before-completion` | Before every "done" or commit: run the suites and read output |
| `superpowers:subagent-driven-development` | Executing several plan.md tasks with review between them |
| `superpowers:requesting-code-review` | Before push; pairs well with built in `/code-review` |
| `superpowers:brainstorming` | Only for genuinely open design questions (it asks questions first, which costs time) |

Skip tonight: `using-git-worktrees`, `writing-skills`, `finishing-a-development-branch` (you push to a
shared branch with rebase per CLAUDE.md rule 11).

### Step 3. Playwright MCP (lets Claude open, resize, screenshot and drive its own UI)

Pick **one** of these two routes. Both run the same server (`npx @playwright/mcp@latest`). Doing both
gives you duplicate browser tools.

**Route A, plugin (easiest in VS Code):** `/plugins`, search `playwright`, Install; or
`/plugin install playwright@claude-plugins-official`. The plugin's `.mcp.json` is
`{"playwright": {"command": "npx", "args": ["@playwright/mcp@latest"]}}`. Source:
https://github.com/anthropics/claude-plugins-official/tree/main/external_plugins/playwright

**Route B, MCP command (verbatim from the official Playwright MCP README):**

```bash
claude mcp add playwright npx @playwright/mcp@latest
```

Source: https://github.com/microsoft/playwright-mcp (README, "Claude Code"). To share it with the team
through a committed `.mcp.json`, use project scope and the `--` separator, which keeps server flags
away from Claude's own options (syntax from https://code.claude.com/docs/en/mcp):

```bash
claude mcp add --scope project playwright -- npx @playwright/mcp@latest
```

Each teammate approves project scoped servers once when Claude Code prompts.

Verify: `claude mcp list` should show `✔ Connected`, or type `/mcp` in the panel. Then ask:
"Use the playwright MCP to open http://localhost:5173 and tell me the page title."

Tools you will use (from the README tool list): `browser_navigate`, `browser_resize` (width, height),
`browser_take_screenshot` (supports `fullPage`, `filename`), `browser_snapshot` (accessibility tree,
"better than screenshot" for actions), `browser_press_key`, `browser_click`,
`browser_console_messages`, `browser_evaluate`.

Caveats:

* **Start the dev servers first.** `cd web && npm run dev` (Vite, port 5173 as used by the tunnel
  command in CLAUDE.md) and, for live data, `cd engine && uvicorn dr.api:app --reload --port 8000`.
  The MCP only sees what is running; use `?b=fixture` if the clinic package is not built yet.
* The browser is **headed by default** and uses a persistent profile. A persistent profile can only be
  used by one browser instance at a time, so if two Claude sessions on one machine both use Playwright,
  add `--isolated` (README "Options").
* It cannot hear. Web Audio, speech and HRTF panning are verified by vitest mocks and by a human with
  closed back headphones. It also cannot read pixels inside `<canvas>` through the snapshot; it needs
  a screenshot for the observer floor plan.
* Big pages can hit the MCP output limit (warning at 10,000 tokens, cap 25,000 by default, raise with
  `MAX_MCP_OUTPUT_TOKENS`). Source: https://code.claude.com/docs/en/mcp

**Alternatives (optional):**

* **Claude in Chrome**, built in: type `@browser` in the VS Code prompt box, or `claude --chrome` in
  the CLI. Needs the Claude in Chrome extension 1.0.36+, a direct Anthropic plan (Pro, Max, Team or
  Enterprise) and `/login` sign in (API key sessions keep it off). It drives your real Chrome with your
  logins. Source: https://code.claude.com/docs/en/chrome
* **Chrome DevTools MCP** (Google, official repo; also listed in `claude-plugins-official` as
  `chrome-devtools-mcp`). Useful for performance traces and has an `a11y-debugging` skill. Commands
  from https://github.com/ChromeDevTools/chrome-devtools-mcp :
  `/plugin marketplace add ChromeDevTools/chrome-devtools-mcp` then
  `/plugin install chrome-devtools-mcp@chrome-devtools-plugins`, or MCP only:
  `claude mcp add chrome-devtools --scope user npx chrome-devtools-mcp@latest`.
  Recommendation: skip tonight unless Playwright misbehaves; one browser MCP is enough.

### Step 4. Accessibility tests in web/ (about 15 minutes)

Packages: `@playwright/test` (runner, https://playwright.dev/docs/intro) and `@axe-core/playwright`
(Deque, https://github.com/dequelabs/axe-core-npm/tree/develop/packages/playwright).

```bash
cd web
npm install -D @playwright/test @axe-core/playwright
npx playwright install chromium
```

(`npx playwright install <browser>` pattern from https://playwright.dev/docs/browsers.)

**4a. Keep vitest away from Playwright specs.** vitest's default include is
`**/*.{test,spec}.?(c|m)[jt]s?(x)` (https://vitest.dev/config/include), so it would try to run
`e2e/*.spec.ts`. Add to the `test` block of `web/vite.config.ts` (or `vitest.config.ts`):

```ts
import { configDefaults } from 'vitest/config'
// inside defineConfig({ ... test: { ... } })
exclude: [...configDefaults.exclude, 'e2e/**'],
```

(Pattern from https://vitest.dev/config/exclude.)

**4b. `web/playwright.config.ts`** (webServer and baseURL from https://playwright.dev/docs/test-webserver,
viewport from https://playwright.dev/docs/test-use-options):

```ts
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:5173' },
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } } },
    { name: 'phone', use: { browserName: 'chromium', viewport: { width: 390, height: 844 } } },
  ],
});
```

**4c. `web/e2e/a11y.spec.ts`** (AxeBuilder, `withTags`, `violations` toEqual `[]` from
https://playwright.dev/docs/accessibility-testing; `exclude` from the Deque README):

```ts
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const PAGES = [
  '/?b=fixture',
  '/observer.html?b=fixture&obs=demo',
  '/venue.html?b=fixture',
  '/pick.html',
];

for (const path of PAGES) {
  test(`no detectable WCAG A/AA violations: ${path}`, async ({ page }, info) => {
    await page.goto(path);
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: `test-results/shots/${info.project.name}${path.replace(/[^a-z0-9]+/gi, '_')}.png`, fullPage: true });
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .exclude('iframe') // Matterport Showcase tour is third party
      .analyze();
    const summary = results.violations.map(v => ({ id: v.id, impact: v.impact, help: v.help, targets: v.nodes.map(n => n.target) }));
    expect(summary).toEqual([]);
  });
}

test('start gate: Start is the first and only focus stop before Start', async ({ page }) => {
  await page.goto('/?b=fixture');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: /start/i })).toBeFocused();
});
```

Adjust the page list and the Start button name to what lane C actually renders. Add a second axe pass
after Start (press Start, choose "my screen reader", then scan) once that flow exists.

**4d. Scripts in `web/package.json`:** `"test:e2e": "playwright test"`. Run with `npm run test:e2e`.
Screenshots land in `web/test-results/shots/` (add `test-results/` to `.gitignore`).

Verify it works: temporarily delete the `aria-label` or text of the Start button, run
`npm run test:e2e`, and watch the axe test fail with `button-name`. Put it back.

**Other options, and why not tonight:**

* **vitest + axe-core in jsdom:** `npm install axe-core --save-dev`. axe-core's README says JSDOM
  support is limited and the `color-contrast` rule does not work in JSDOM
  (https://github.com/dequelabs/axe-core). For a high contrast app that is the rule you most want, so
  prefer the real browser test above. `jest-axe` / `vitest-axe` are community packages, not Deque:
  **UNVERIFIED**, not checked.
* **Lighthouse CLI** (needs Chrome and Node 22+), from https://github.com/GoogleChrome/lighthouse :

  ```bash
  npx lighthouse "http://localhost:5173/?b=fixture" --only-categories=accessibility --preset=desktop --view
  ```

  (Quote the URL: zsh, the macOS default shell, treats an unquoted `?` as a glob.)

  Gives a single 0 to 100 accessibility score for the pitch slide. It runs axe rules too, so it does
  not add coverage over 4c.
* **Automated checks are a floor.** Playwright's docs: "many accessibility problems can only be
  discovered through manual testing." Do one pass with VoiceOver on (macOS, `Cmd+F5`) in the
  "my screen reader" mode before the freeze.

### Step 5. Optional plugins (only if you have spare minutes)

| Plugin | Install | Why | Cost |
| :- | :- | :- | :- |
| `typescript-lsp@claude-plugins-official` | `/plugin install typescript-lsp@claude-plugins-official` plus `npm install -g typescript-language-server typescript` | Claude sees type errors and references in web/ | Global binary |
| `pyright-lsp@claude-plugins-official` | `/plugin install pyright-lsp@claude-plugins-official` plus `npm install -g pyright` | Same for engine/ | Global binary |
| `design@knowledge-work-plugins` | `claude plugin marketplace add anthropics/knowledge-work-plugins` then `claude plugin install design@knowledge-work-plugins` | `accessibility-review` (WCAG 2.1 AA checklist incl. 44x44 touch targets) and `design-critique` skills | Also bundles remote MCP connectors (Slack, Figma, Linear, Notion and more) in its `.mcp.json`; disable the ones you do not use in `/mcp` |

Sources: https://github.com/anthropics/claude-plugins-official/tree/main/plugins/typescript-lsp,
https://github.com/anthropics/claude-plugins-official/tree/main/plugins/pyright-lsp,
https://github.com/anthropics/knowledge-work-plugins

Do **not** install `web-artifacts-builder`: it builds claude.ai artifacts with React, Tailwind and
shadcn/ui (https://github.com/anthropics/skills/tree/main/skills/web-artifacts-builder), which breaks
"no UI framework". `webapp-testing` (same repo) writes Python Playwright scripts; it overlaps with
Step 3 and Step 4.

### Step 6. Project subagent: `ui-verifier` (commit it)

Format (frontmatter `name`, `description`, optional `tools`, `disallowedTools`, `model`) from
https://code.claude.com/docs/en/sub-agents . Save as `.claude/agents/ui-verifier.md`:

```markdown
---
name: ui-verifier
description: Opens the running SecondVisit web app with the Playwright MCP, screenshots every screen at 390x844 and 1440x900, checks keyboard flow and the accessibility tree against CLAUDE.md rule 7 and docs/UI_DESIGN.md, and reports issues. Use after any UI change. Does not edit code.
disallowedTools: Edit, Write, NotebookEdit
model: sonnet
---

You verify the SecondVisit UI. Assume the dev server is on http://localhost:5173 (ask the caller if it
is not reachable; never start or kill servers yourself unless told to).

For each page given to you (default: /?b=fixture, /observer.html?b=fixture&obs=demo,
/venue.html?b=fixture, /pick.html), at 390x844 and then 1440x900 (browser_resize):
1. browser_navigate, wait for load, browser_take_screenshot with fullPage.
2. browser_snapshot and check: every control has an accessible name; headings are in order; the
   transcript region has the right aria-live value for the chosen mode; the rehearsal stage has
   role="application"; nothing is conveyed only by colour or only on the canvas.
3. Keyboard only: press Tab repeatedly and list the focus order; confirm a visible focus ring;
   before Start, Start is the only focusable element.
4. browser_console_messages: report errors and warnings.
5. Look at the screenshot: clipped or overlapping text, horizontal scroll at 390 wide, text smaller
   than the design's body size, touch targets under 44x44 on phone, low contrast.

Report a table: page, viewport, issue, evidence (selector or screenshot file), suggested fix, severity.
Do not claim something is fine without having looked at it.
```

Invoke with natural language ("Use the ui-verifier subagent on /venue.html") or `@agent-ui-verifier`.
`tools` is omitted on purpose so it inherits the MCP browser tools whatever the server is named.

### Step 7. One cheap hook: typecheck web/ after every TypeScript edit

Hook mechanics from https://code.claude.com/docs/en/hooks-guide and https://code.claude.com/docs/en/hooks :
PostToolUse with matcher `Edit|Write`, input JSON on stdin with `.tool_input.file_path`, and on
PostToolUse "exit 2 shows stderr to Claude; the tool already ran". So Claude sees type errors at once.

`.claude/hooks/web-typecheck.sh` (then `chmod +x .claude/hooks/web-typecheck.sh`):

```bash
#!/bin/bash
FILE=$(python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("file_path",""))')
case "$FILE" in
  */web/*.ts) ;;
  *) exit 0 ;;
esac
cd "$CLAUDE_PROJECT_DIR/web" || exit 0
OUT=$(npx tsc --noEmit -p . 2>&1) || { echo "$OUT" | tail -n 30 >&2; exit 2; }
exit 0
```

Add to `.claude/settings.json`:

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "Edit|Write",
        "hooks": [
          { "type": "command", "command": "\"$CLAUDE_PROJECT_DIR\"/.claude/hooks/web-typecheck.sh" }
        ]
      }
    ]
  }
}
```

Verify: `/hooks` lists it (VS Code: Customize section, **Hooks**). Ask Claude to add a deliberate
type error to a scratch .ts file in web/src and watch it get the tsc output back.

Skip tonight: a Prettier format on edit hook (rule 11 says do not reformat files you don't own, and
nobody has agreed a Prettier config), and a Stop hook that runs the full suites (slow, and a Stop hook
that keeps blocking is overridden after eight blocks in a row; superpowers
`verification-before-completion` covers this).

### Step 8. Built in commands worth using tonight

Source: https://code.claude.com/docs/en/commands and https://code.claude.com/docs/en/permission-modes

| Command | Use |
| :- | :- |
| Plan mode (`/plan <task>`, or `Shift+Tab` in the CLI; in VS Code click the mode indicator under the prompt box) | Read plan.md and propose before editing; approve then let it run |
| `/code-review` (alias `/review`), `--fix` to apply | Review the current diff for correctness bugs before push |
| `/simplify` | Cleanup pass on changed code (not a bug finder) |
| `/verify`, `/run`, `/run-skill-generator` | Bundled skills that build and run the app and observe the result; `/run-skill-generator` records the launch recipe (engine plus web) in `.claude/skills/run-<name>/` once |
| `/rewind` | Undo a bad edit run (checkpoints) |
| `/context`, `/compact` | When a long lane session gets slow |
| `/btw <question>` | Side question without polluting the session |

Output styles (`/output-style`) exist but save no time tonight. If a command is missing in the VS Code
panel, run it from `claude` in the integrated terminal.

---

## 2. Which skill for which task

| Lane | Task type | Invoke |
| :- | :- | :- |
| A Data (Matterport, CoStar, Vexcel, observer, portfolio) | API pulls, caching, parsers | `superpowers:test-driven-development`, `superpowers:systematic-debugging` |
| A Data | observer.html projector view | `frontend-design`, then `ui-verifier` subagent, then `npm run test:e2e` |
| B Spatial engine (grid, import, planner, simulation) | Geometry, planner, scoring | `superpowers:test-driven-development`, `superpowers:systematic-debugging`, `/code-review` |
| B Spatial engine | "No route" and NaN bugs | `superpowers:systematic-debugging` (root cause before fix) |
| C Audio experience | Start gate, Explore, Rehearse, Check yourself, Pocket summary screens | `frontend-design` with docs/UI_DESIGN.md, Playwright MCP at both sizes, axe test, `design:accessibility-review` if installed |
| C Audio experience | Audio engine, cane, echo, speech, haptics | `superpowers:test-driven-development` with mocks; humans verify by ear |
| D Agents and layout | Deep agent, coach, streaming API | `superpowers:test-driven-development`, `superpowers:systematic-debugging` |
| D Agents and layout | venue.html, portfolio and pick views | `frontend-design`, `ui-verifier`, axe test |
| Everyone | Several plan.md tasks in a row | `superpowers:subagent-driven-development` |
| Everyone | Before saying done or committing | `superpowers:verification-before-completion`, then `superpowers:requesting-code-review` or `/code-review` |

---

## 3. Copy paste prompts

**P1. Apply the design system (one person, first, 15 min)**

```
docs/UI_DESIGN.md is the design spec and web_tokens.css (repo root) holds its tokens. Copy
web_tokens.css to web/src/styles/tokens.css and import it first in every web entry file, exactly as
UI_DESIGN.md section 2 says. Install the self hosted fonts it names
(@fontsource-variable/atkinson-hyperlegible-next and @fontsource-variable/atkinson-hyperlegible-mono)
so the demo works without venue wifi. Add the contrast test from UI_DESIGN.md's accessibility
section and make it pass. Do not restyle any page yet. Commit "feat(ui): tokens and fonts".
```

**P2. Build or restyle a screen (lanes C and D)**

```
Use the frontend-design skill with docs/UI_DESIGN.md and web/src/styles/tokens.css to build <screen,
e.g. the Start gate and Rehearsal screen in web/index.html + web/src/main.ts>. Plain DOM and CSS, no
framework. Keep every behaviour in CLAUDE.md rule 7 (Start asks "app voice" or "my screen reader",
aria-live rules, role="application" stage, phone Step / Repeat / Where am I / Recentre buttons).
Write or update the vitest tests first. When done, use the ui-verifier subagent on this page and fix
what it reports.
```

**P3. Visual check with Playwright MCP**

```
The dev server is running on http://localhost:5173. Use the Playwright MCP to open
/?b=fixture, /observer.html?b=fixture&obs=demo, /venue.html?b=fixture and /pick.html. For each, resize
to 390x844 and take a full page screenshot, then resize to 1440x900 and take another. Look at every
screenshot and fix any layout issue: clipped or overlapping text, horizontal scrolling at 390 wide,
controls smaller than 44x44 on phone, low contrast, focus ring not visible. Also Tab through each page
and report the focus order. Re-screenshot after each fix and show me before and after file names.
```

**P4. Accessibility test**

```
Run `cd web && npm run test:e2e`. For every axe violation, find the cause in our code, fix it at the
source (semantic HTML first, ARIA only when needed), and rerun until the suite is green on both the
desktop and phone projects. Do not exclude rules or selectors to make it pass, except the third party
Matterport iframe. Then run `npm test` too. Use superpowers:verification-before-completion before you
say it is done.
```

**P5. Set up the test harness (one person, 15 min)**

```
Follow docs/CLAUDE_CODE_SETUP.md step 4 exactly in web/: install @playwright/test and
@axe-core/playwright as dev dependencies, install chromium, exclude e2e/** from vitest, add
playwright.config.ts with the desktop 1440x900 and phone 390x844 projects, add e2e/a11y.spec.ts and
the test:e2e script, and add test-results/ to .gitignore. Adjust the page list and Start button name
to what the app renders today. Prove the axe test can fail by temporarily removing the Start button
label, then restore it. Commit "test(web): playwright + axe accessibility suite".
```

**P6. Debug a UI bug**

```
Use superpowers:systematic-debugging. Symptom: <what you see>. Reproduce it with the Playwright MCP on
http://localhost:5173/<page> (console messages and an accessibility snapshot), find the root cause
before changing code, write a failing vitest or Playwright test, then fix.
```

**P7. Before push**

```
Run /code-review on my diff, fix real bugs only, then run cd engine && pytest -q and cd web && npm test
&& npm run test:e2e, and show me the output before committing.
```

---

## 4. UNVERIFIED items

* The exact label of the frontend-design skill in the `/` menu (`/frontend-design:frontend-design`)
  is inferred from the documented `/<plugin>:<skill>` rule, not seen in a screenshot.
* `jest-axe` and `vitest-axe` were not checked (not Deque packages).
* MCP tool names for the subagent: with Route B the server is named `playwright`, so its tools follow
  the `mcp__<server>__*` pattern documented for subagents; the naming for plugin bundled servers was
  not checked, which is why the subagent omits `tools`.
* `cmd+F5` for VoiceOver is standard macOS behaviour but was not checked against Apple docs here.
* Whether the VS Code panel lists `/verify`, `/run`, `/simplify` and `/code-review` in its command
  subset was not checked; they are documented for Claude Code in general.
