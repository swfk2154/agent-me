import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Root = web/; output lands in web/dist, served by the agent-me server
// (src/server.ts) at the same origin.
export default defineConfig({
  root: "web",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:8080",
    },
  },
});
