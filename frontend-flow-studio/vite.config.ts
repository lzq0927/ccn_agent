/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Studio 版引导式演示前端 — 拷贝自 frontend-flow-demo,按「静谧仪器」设计语言全面重构, dev 端口 5180。
// /api 与 /ws 代理到 FastAPI 后端 :8000(纯 DEMO 不依赖,proxy 保留备用)。
export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // 监听 0.0.0.0,允许同网段机器通过 IP 访问(展会大屏/他人调试)
    port: 5180,
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
