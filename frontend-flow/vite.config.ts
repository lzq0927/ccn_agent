/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 方案流程演示前端 — 独立于 frontend/ 与 frontend-show/, dev 端口 5175。
// /api 与 /ws 代理到 FastAPI 后端 :8000(首版纯 DEMO 不依赖,proxy 保留备用)。
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // 监听 0.0.0.0,允许同网段机器通过 IP 访问(展会大屏/他人调试)
    port: 5175,
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
  test: {
    environment: "jsdom",
    globals: false,
  },
});
