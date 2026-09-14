/** 前端 SSE 流解析客户端（React 版） */

export interface SSEEvent {
  event: string;
  data: string;
}

export type SSEHandler = (data: string) => void;
export type SSEHandlers = Record<string, SSEHandler | undefined>;

/**
 * 发起 POST 并持续消费 SSE 流。
 * 事件名与 data 字符串回调；可用 onDone / onError 处理收尾。
 */
export async function postSse(
  url: string,
  body: Record<string, unknown>,
  handlers: SSEHandlers & { onDone?: () => void; onError?: (message: string) => void }
): Promise<void> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    let msg = `请求失败 (${response.status})`;
    try {
      const json = (await response.json()) as { error?: string };
      if (json.error) msg = json.error;
    } catch {}
    handlers.onError?.(msg);
    return;
  }

  if (!response.body) {
    handlers.onError?.("浏览器不支持流式响应");
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let currentEvent = "";
  let dataLines: string[] = [];

  function dispatch() {
    if (currentEvent && dataLines.length) {
      const data = dataLines.join("\n");
      if (currentEvent === "error") {
        try {
          const parsed = JSON.parse(data) as { message?: string };
          handlers.onError?.(parsed.message || "处理失败");
        } catch {
          handlers.onError?.(data);
        }
      } else if (currentEvent === "done") {
        handlers.onDone?.();
        handlers.done?.(data);
      } else {
        handlers[currentEvent]?.(data);
      }
    }
    dataLines = [];
    currentEvent = "";
  }

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line === "") {
          dispatch();
          continue;
        }
        if (line.startsWith(":")) continue;

        const colonIdx = line.indexOf(":");
        if (colonIdx < 0) continue;
        const field = line.slice(0, colonIdx);
        let val = line.slice(colonIdx + 1);
        if (val.startsWith(" ")) val = val.slice(1);

        if (field === "event") currentEvent = val;
        else if (field === "data") dataLines.push(val);
      }
    }
    dispatch();
    handlers.onDone?.();
  } catch (err) {
    handlers.onError?.(err instanceof Error ? err.message : "流读取中断");
  } finally {
    reader.releaseLock();
  }
}