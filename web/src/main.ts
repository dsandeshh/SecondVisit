import "./styles/tokens.css";
import "./styles/app.css";
// Rehearsal app entry (Task 8).
import { boot } from "./app";

void boot(document, new URLSearchParams(location.search)).then(app => {
  if (import.meta.env.DEV) (window as any).__sv = app; // dev only: lets the screenshot scripts place the walker
});
