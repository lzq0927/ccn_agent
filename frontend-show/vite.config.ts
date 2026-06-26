import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 展会演示前端 — 独立于旧 frontend/, dev 端口 5174。
// /api 与 /ws 代理到 FastAPI 后端 :8000(可选 live 模式)。
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    strictPort: false,
    proxy: {
      "/api": { target: "http://localhost:8000", changeOrigin: true },
      "/ws": { target: "ws://localhost:8000", ws: true, changeOrigin: true },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
