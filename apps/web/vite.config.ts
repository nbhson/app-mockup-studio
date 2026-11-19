import { defineConfig } from "vite";
import type { ServerResponse } from "node:http";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";

// plan/08: monorepo — Vite resolves workspace packages via their dist builds.
export default defineConfig({
  plugins: [vue(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      // API + SSE streaming all go through the Nest backend.
      "/api": {
        target: "http://localhost:3000",
        changeOrigin: true,
        // Presence WebSocket (plan/07 4.4) upgrades through the same proxy.
        ws: true,
        configure(proxy) {
          // Without this handler an unreachable API only shows as
          // "[vite] http proxy error: /api/…" in the terminal while the
          // browser hangs on a request that never resolves. The app can only
          // react to a response, so answer with a real 502 + readable message.
          proxy.on("error", (_err, _req, res) => {
            const response = res as ServerResponse;
            if (typeof response.writeHead !== "function" || response.headersSent) return;
            response.writeHead(502, { "Content-Type": "application/json" });
            response.end(
              JSON.stringify({
                statusCode: 502,
                message:
                  "Không kết nối được API (http://localhost:3000). Chạy `pnpm dev` hoặc `pnpm dev:api` rồi thử lại.",
              }),
            );
          });
        },
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
