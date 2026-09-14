/** sse.ts — SSE 流编码辅助（Route Handler 用） */

/** 生成单条 SSE 数据帧 */
export function formatSse(event: string, data: string): string {
  const safe = data.replace(/\r?\n/g, "\r\n");
  return `event: ${event}\ndata: ${safe}\n\n`;
}

/** 将异步生成器转为可供 Route Handler 返回的 ReadableStream */
export function sseStream(
  gen: AsyncGenerator<{ event: string; data: string }>
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      try {
        for await (const item of gen) {
          controller.enqueue(encoder.encode(formatSse(item.event, item.data)));
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        controller.enqueue(encoder.encode(formatSse("error", JSON.stringify({ message }))));
      } finally {
        controller.close();
      }
    },
  });
}