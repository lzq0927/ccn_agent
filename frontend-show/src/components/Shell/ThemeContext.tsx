// ============================================================================
// ThemeContext —— 三主题(深邃 / 暮光 / 明亮)切换
//   真源为 global.css 的 CSS 变量，由 <html data-theme="..."> 选择;
//   本 provider 负责读写该属性 + localStorage 持久化 + 同步 meta theme-color。
//   首屏前的 data-theme 由 index.html 内联脚本设置，避免 FOUC。
// ============================================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export type ThemeId = "dark" | "dim" | "light";

export const THEMES: ThemeId[] = ["dark", "dim", "light"];

/** 各主题标签(中文) */
export const THEME_LABELS: Record<ThemeId, string> = {
  dark: "深邃",
  dim: "暮光",
  light: "明亮",
};

/** 各主题对应的页面背景色，用于同步 <meta name="theme-color"> */
export const THEME_BG: Record<ThemeId, string> = {
  dark: "#04070f",
  dim: "#0b1322",
  light: "#eef2f7",
};

const STORAGE_KEY = "ccn.theme";
const DEFAULT_THEME: ThemeId = "dark";

interface ThemeCtxValue {
  theme: ThemeId;
  setTheme: (t: ThemeId) => void;
}

const ThemeCtx = createContext<ThemeCtxValue | null>(null);

function readInitialTheme(): ThemeId {
  // 展会 demo:每次启动固定默认深邃(dark)，不沿用上次选择 —— 确保每场演示一致开场。
  // (主题切换仍可在会话内即时生效，刷新后回到深邃。)
  return DEFAULT_THEME;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<ThemeId>(readInitialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* 忽略写入失败(隐私模式等) */
    }
    // 同步移动端浏览器顶栏配色
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", THEME_BG[theme]);
  }, [theme]);

  const setTheme = useCallback((t: ThemeId) => setThemeState(t), []);

  const value = useMemo<ThemeCtxValue>(() => ({ theme, setTheme }), [theme, setTheme]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): ThemeCtxValue {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error("useTheme 必须在 ThemeProvider 内使用");
  return ctx;
}
