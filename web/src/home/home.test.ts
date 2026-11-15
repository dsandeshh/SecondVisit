// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { CHOOSE_BELOW_LINE, mountHome, NO_INDOOR_LINE, NOT_AVAILABLE_LINE, offlineResolve, OFFLINE, resolveAddress, tierLines } from "./home";

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
  it("Office B is a built building in the list; the shared address still means the clinic", () => {
    expect(OFFLINE.map(o => o.name)).toEqual(expect.arrayContaining(["Medical Office", "Office B", "Demo lobby"]));
    expect(offlineResolve("Office B")?.sid).toBe("hpGRjK5uFPW");
    expect(offlineResolve("office b, 7400 FM-1960 W")?.sid).toBe("hpGRjK5uFPW");
    expect(offlineResolve("7400 FM-1960 W")?.sid).toBe("x37LjPx62VA");
  });
  it("three tiers: ready opens, outdoor and none say why and point at the buildings", async () => {
    const ready = vi.fn(async () => jsonRes({ tier: "ready", sid: "hpGRjK5uFPW", name: "Office B", address: "7400 FM-1960 W" }));
    const a = await resolveAddress("Office B", ready as any);
    expect(a).toMatchObject({ tier: "ready", sid: "hpGRjK5uFPW" });
    expect(tierLines(a)).toEqual([]);
    const outdoor = vi.fn(async () => jsonRes({ tier: "outdoor", sid: "1uXpcwty9Sr", name: "Brentwood Medical Plaza", address: "11980 San Vicente Blvd", city: "Los Angeles" }));
    const b = await resolveAddress("Brentwood Medical Plaza", outdoor as any);
    expect(b).toMatchObject({ tier: "outdoor", sid: "1uXpcwty9Sr", city: "Los Angeles" });
    expect(tierLines(b)).toEqual([NO_INDOOR_LINE, CHOOSE_BELOW_LINE]);
    const nf = vi.fn(async () => jsonRes({ error: "not_found", tier: "none" }, false));
    const c = await resolveAddress("10 Downing Street London", nf as any);
    expect(c).toBeNull();
    expect(tierLines(c)).toEqual([NOT_AVAILABLE_LINE, CHOOSE_BELOW_LINE]);
    expect(NO_INDOOR_LINE).toBe("No indoor scan yet for this building.");
    expect(NOT_AVAILABLE_LINE).toBe("This building is not available yet.");
    // an old engine answer without a tier is a ready building, as before
    const old = vi.fn(async () => jsonRes({ sid: "abc", name: "A", address: "B" }));
    expect((await resolveAddress("x", old as any))?.tier).toBe("ready");
  });
});
