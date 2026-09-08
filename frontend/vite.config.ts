import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // Primary: frontend uses /api/* → backend
      "/api": {
        target: "http://127.0.0.1:5050",
        changeOrigin: true,
        timeout: 1_200_000,
        proxyTimeout: 1_200_000,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
      // API only. Do not proxy "/recordings" — that path is a client route.
      "/recordings/db": {
        target: "http://127.0.0.1:5050",
        changeOrigin: true,
        timeout: 1_200_000,
        proxyTimeout: 1_200_000,
      },
      "/jobs": {
        target: "http://127.0.0.1:5050",
        changeOrigin: true,
        timeout: 1_200_000,
        proxyTimeout: 1_200_000,
      },
      "/health": {
        target: "http://127.0.0.1:5050",
        changeOrigin: true,
      },
    },
  },
});
