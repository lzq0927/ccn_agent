import React from "react";
import ReactDOM from "react-dom/client";
// 字体:本地打包(@fontsource),离线可用;CJK 按 unicode-range 分包按需加载
import "@fontsource-variable/noto-serif-sc";
import "@fontsource-variable/inter";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";
import App from "./App";
import { ThemeProvider } from "./components/Shell/ThemeContext";
import "./styles/global.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider>
      <App />
    </ThemeProvider>
  </React.StrictMode>,
);
