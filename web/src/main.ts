import "./styles/tokens.css";
import "./styles/app.css";
// Rehearsal app entry (Task 8).
import { boot } from "./app";

void boot(document, new URLSearchParams(location.search));
