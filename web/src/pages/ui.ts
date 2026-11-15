// Which shell the app mounts: v1 (the cockpit, today's flow) or v2 (one page at a time).
/** THE DEFAULT SWITCH: change "v1" to "v2" to make the page-at-a-time shell the default. `?ui=v1` or `?ui=v2` always wins. */
export const DEFAULT_UI: "v1" | "v2" = "v2"; // flipped 15 Nov 04:12 after the photo view, walking feel and error-recovery work checked out; ?ui=v1 is the escape hatch
export const uiVersion = (params: URLSearchParams): "v1" | "v2" => (params.get("ui") ?? DEFAULT_UI) === "v2" ? "v2" : "v1";
