export const number = (value: number) => value.toLocaleString("en-US");
export const time = (value: string) =>
  new Date(value).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
export const procedure = (value: string) =>
  ({
    PduSessionEstablishment: "PDU 会话建立",
    ServiceRequest: "Service Request",
    InitialRegistration: "初始注册",
  })[value] || value;
export const shortCause = (value: string) =>
  ({
    SIM_SBI_TIMEOUT: "SBI 响应超时",
    SIM_TRANSPORT_RETRANS_EXHAUSTED: "传输重传耗尽",
    SIM_AMF_UPSTREAM_FAILURE: "下游失败传播",
    "5GSM:27": "DNN 未知",
    "5GSM:29": "鉴权失败",
    "5GSM:26": "资源不足",
    "5GMM:22": "拥塞",
  })[value] || value;
export const scientific = (value: number) =>
  value === 0
    ? "< 1e-300"
    : value < 0.001
      ? value.toExponential(1)
      : value.toFixed(3);
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(
      typeof body?.detail === "string"
        ? body.detail
        : `请求失败（${response.status}）`,
    );
  }
  return response.json();
}
export function downloadJson(value: unknown, filename: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
