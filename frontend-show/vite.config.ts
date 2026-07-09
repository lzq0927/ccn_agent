import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 展会演示前端 — 独立于旧 frontend/, dev 端口 5174。
// /api 与 /ws 代理到 FastAPI 后端 :8000(可选 live 模式)。
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // 监听 0.0.0.0,允许同网段机器通过 IP 访问(展会大屏/他人调试)
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
