// ============================================================================
// HudFrame —— 通用 HUD 面板外壳:标题栏 + 角标 + 可滚动内容
// ============================================================================

import type { CSSProperties, ReactNode } from "react";

interface Props {
  title: string;
  subtitle?: string;
  right?: ReactNode;
  bodyStyle?: CSSProperties;
  bodyClass?: string;
  tall?: boolean;
  children: ReactNode;
}

export function HudFrame({ title, subtitle, right, bodyStyle, bodyClass, children }: Props) {
  return (
    <div className="hud" style={{ display: "flex", flexDirection: "column", minHeight: 0, height: "100%", overflow: "hidden" }}>
      <div className="hud-head">
        <span className="title">
          <span className="dot" />
          {title}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {subtitle && <span style={{ color: "var(--text-faint)" }}>{subtitle}</span>}
          {right}
        </span>
      </div>
      <div className={bodyClass} style={{ padding: 10, overflowY: "auto", minHeight: 0, flex: 1, ...bodyStyle }}>
        {children}
      </div>
    </div>
  );
}
