// ============================================================================
// live API —— REST + WS 客户端(LIVE 模式)
//   同源相对路径:dev 由 vite proxy 转发到 :8000(见 vite.config.ts),
//   生产由反代托管;避免硬编码 localhost 导致展会大屏 / 局域网访问失效。
// ============================================================================

const BASE = "/api/v1/live";

/** 后端推送的实时事件(payload 形状随 type 变化,由 liveBus 解析) */
export interface LiveEvent {
  type: string;
  ts: number;
  session_id: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload: any;
}

export interface SelectResponse {
  session_id: string;
  scenario_id: string;
  capabilities: string;
  /** true = 后端只给了 DEMO 占位,前端应留在 DEMO 模式 */
  demo?: boolean;
}

/** 场景 → 该场景支持的最高模式("live" 才可切 LIVE) */
export async function getCapabilities(): Promise<Record<string, "live" | "demo">> {
  const r = await fetch(`${BASE}/capabilities`);
  if (!r.ok) throw new Error(`capabilities ${r.status}`);
  return r.json();
}

/** 申请一个 LIVE session;后端可能返回 demo:true 占位 */
export async function selectScenario(scenarioId: string): Promise<SelectResponse> {
  const r = await fetch(`${BASE}/select`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ scenario_id: scenarioId }),
  });
  if (!r.ok) throw new Error(`select ${r.status}`);
  return r.json();
}

/** 控制指令(play/pause/inject/...);失败静默 —— 控制面不阻塞演示 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function control(sessionId: string, action: string, payload?: any): Promise<void> {
  await fetch(`${BASE}/control`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: sessionId, action, payload }),
  });
}

/** 打开事件流 WS;onClose 供 App 做降级(切回 DEMO) */
export function openLiveSocket(
  sessionId: string,
  onEvent: (ev: LiveEvent) => void,
  onClose: () => void,
): WebSocket {
  const proto = typeof location !== "undefined" && location.protocol === "https:" ? "wss:" : "ws:";
  const host = typeof location !== "undefined" ? location.host : "localhost:5175";
  const ws = new WebSocket(`${proto}//${host}/ws/live?session_id=${encodeURIComponent(sessionId)}`);
  ws.onmessage = (e) => {
    try {
      onEvent(JSON.parse(e.data));
    } catch {
      // 非 JSON 帧忽略
    }
  };
  ws.onclose = () => onClose();
  return ws;
}
