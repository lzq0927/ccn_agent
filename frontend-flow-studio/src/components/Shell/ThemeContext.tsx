// ============================================================================
// ThemeContext —— 三主题(墨 ink / 雾 mist / 纸 paper)切换
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

export type ThemeId = "ink" | "mist" | "paper";

export const THEMES: ThemeId[] = ["ink", "mist", "paper"];

/** 各主题标签(中文) */
export const THEME_LABELS: Record<ThemeId, string> = {
  ink: "墨",
  mist: "雾",
  paper: "纸",
};

/** 各主题对应的页面背景色，用于同步 <meta name="theme-color"> */
export const THEME_BG: Record<ThemeId, string> = {
  ink: "#0c0d11",
  mist: "#14161c",
  paper: "#f4f2ec",
};

const STORAGE_KEY = "ccn.studio.theme";
const DEFAULT_THEME: ThemeId = "ink";

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
