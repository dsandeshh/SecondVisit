import "./styles/tokens.css";
import "./styles/app.css";
// Rehearsal app entry (Task 8). Two shells: v1 (the cockpit, today's flow) and v2 (one page at a time, hash routes).
import { boot } from "./app";
import { uiVersion } from "./pages/ui";

const params = new URLSearchParams(location.search);
const expose = (app: unknown) => { if (import.meta.env.DEV) (window as any).__sv = app; }; // dev only: lets the screenshot scripts place the walker

if (uiVersion(params) === "v2") {
  void Promise.all([import("./pages/shell_v2.html?raw"), import("./styles/pages.css"), import("./app_v2")]).then(([shell, , v2]) => {
    document.body.innerHTML = shell.default;
    document.body.dataset.page = "home";
    return v2.boot(document, params);
  }).then(expose);
} else {
  void boot(document, params).then(expose);
}
