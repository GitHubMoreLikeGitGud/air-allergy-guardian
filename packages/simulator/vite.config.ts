import { defineConfig } from "vite";

// The web UI talks to the bridge through /api so that dev, preview and e2e all share one origin.
const bridgePort = Number(process.env["AAG_BRIDGE_PORT"] ?? 3334);

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${bridgePort}`,
        rewrite: (path) => path.replace(/^\/api/, "")
      }
    }
  },
  preview: {
    port: 4173
  },
  build: {
    target: "es2022"
  }
});
