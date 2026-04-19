import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      // REST API calls: /api/v1/... → http://localhost:8000/api/v1/...
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      // WebSocket upgrade: /ws/... → ws://localhost:8000/ws/...
      // IMPORTANT: target must use http:// (not ws://) — Vite upgrades it.
      "/ws": {
        target: "http://localhost:8000",
        ws: true,
        changeOrigin: true,
      },
    },
  },
})