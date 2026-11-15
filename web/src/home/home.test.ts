// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { mountHome, offlineResolve, resolveAddress } from "./home";

const jsonRes = (j: unknown, ok = true) => ({ ok, headers: { get: () => "application/json" }, json: async () => j }) as unknown as Response;

describe("home address box", () => {
  it("the clinic address and name resolve offline from the fixed list", () => {
    for (const q of ["7400 FM-1960 W", "7400 fm 1960 w houston", "Medical Office"]) expect(offlineResolve(q)?.sid).toBe("x37LjPx62VA");
    expect(offlineResolve("zzz")).toBeNull();
  });
  it("uses the engine when it answers, the list when it does not", async () => {
    const ok = vi.fn(async () => jsonRes({ sid: "abc", name: "A", address: "B" }));
    expect((await resolveAddress("x", ok as any))?.via).toBe("engine");
    const down = vi.fn(async () => { throw new TypeError("offline"); });
    const r = await resolveAddress("7400 FM-1960 W", down as any);
    expect(r?.sid).toBe("x37LjPx62VA"); expect(r?.via).toBe("list");
    const nf = vi.fn(async () => jsonRes({ error: "not_found" }, false));
    expect(await resolveAddress("Medical Office", nf as any)).toMatchObject({ sid: "x37LjPx62VA" });
    expect(await resolveAddress("nowhere at all", nf as any)).toBeNull();
  });
  it("submit fires the gesture callback synchronously, then resolves", async () => {
    const host = document.createElement("div"); document.body.append(host);
    const order: string[] = [];
    const m = mountHome(host, { onGesture: () => order.push("gesture"), onResolved: r => order.push(r.sid), fetcher: (async () => { throw new Error("x"); }) as any });
    m.input.value = "Medical Office";
    host.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(order).toEqual(["gesture"]);
    await new Promise(r => setTimeout(r, 30));
    expect(order).toEqual(["gesture", "x37LjPx62VA"]);
  });
  it("an unknown place shows the error with a fix", async () => {
    const host = document.createElement("div"); document.body.append(host);
    const m = mountHome(host, { onResolved: () => {}, fetcher: (async () => jsonRes({}, false)) as any });
    m.input.value = "qqq";
    host.querySelector("form")!.dispatchEvent(new Event("submit", { cancelable: true }));
    await new Promise(r => setTimeout(r, 30));
    expect(host.querySelector(".home__err")!.textContent).toMatch(/could not find/);
  });
});
