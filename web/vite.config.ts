import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const page = (name: string) => fileURLToPath(new URL(name, import.meta.url));

export default defineConfig({
  server: {
    open: false,  // never pop a browser window: agents use headless Chrome (human, 15 Nov 02:20)
    proxy: {
      "/api": "http://localhost:8000",
      "/ws": { target: "ws://localhost:8000", ws: true },
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: page("index.html"),
        observer: page("observer.html"),
        venue: page("venue.html"),
        pick: page("pick.html"),
      },
    },
  },
});
