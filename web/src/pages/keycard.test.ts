// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it, vi } from "vitest";

const html = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "shell_v2.html"), "utf8");
const load = () => { document.body.innerHTML = html; };

it("key card: shows once, any key dismisses it and is swallowed, ? brings it back", async () => {
    const { mountKeyCard, KEYCARD_LINE, cardSeen, cardWanted } = await import("./keycard");
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } });
    load();
    document.body.dataset.page = "inside";
    const said: string[] = [], stage = document.getElementById("stage")!, keys: string[] = [];
    stage.addEventListener("keydown", e => keys.push((e as KeyboardEvent).key));
    const c = mountKeyCard(document, stage, t => said.push(t));
    expect(cardWanted(new URLSearchParams())).toBe(true);
    c.show(true);
    expect(said).toEqual([KEYCARD_LINE]);
    expect(document.querySelectorAll("#keycard button").length).toBe(10);
    stage.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }));
    expect(keys).toEqual([]); expect(c.open).toBe(false); expect(cardSeen()).toBe(true);
    expect(cardWanted(new URLSearchParams())).toBe(false); expect(cardWanted(new URLSearchParams("card=1"))).toBe(true);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true })); expect(c.open).toBe(true);
    const b0 = document.querySelector("#keycard button") as HTMLButtonElement; b0.click();   // Up button: closes and sends ArrowUp
    expect(c.open).toBe(false); expect(keys).toEqual(["ArrowUp"]);
    vi.unstubAllGlobals();
});
