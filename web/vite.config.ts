import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  server: {
    proxy: {
      "/api": "http://localhost:8000",
      "/ws": { target: "ws://localhost:8000", ws: true },
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        observer: resolve(__dirname, "observer.html"),
        venue: resolve(__dirname, "venue.html"),
        pick: resolve(__dirname, "pick.html"),
      },
    },
  },
});
