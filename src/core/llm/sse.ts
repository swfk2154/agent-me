/**
 * Minimal SSE (Server-Sent Events) line parser for LLM streaming responses.
 * Handles the `data: ` framing plus optional `event:` lines, and the
 * OpenAI `[DONE]` terminator.
 */
import { createReadStream } from "node:fs";

export interface SSEEvent {
  event?: string;
  data: string;
}

/**
 * Parse a ReadableStream (from fetch) into SSE events.
 * An async generator that yields {event, data} per `data:` frame.
 */
export async function* parseSSE(stream: ReadableStream<Uint8Array>): AsyncGenerator<SSEEvent> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let eventName: string | undefined;
  let dataLines: string[] = [];

  const flush = (): SSEEvent | undefined => {
    if (dataLines.length === 0) return undefined;
    const ev: SSEEvent = { data: dataLines.join("\n") };
    if (eventName !== undefined) ev.event = eventName;
    eventName = undefined;
    dataLines = [];
    return ev;
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).replace(/\r$/, "");
        buf = buf.slice(idx + 1);
        if (line === "") {
          const ev = flush();
          if (ev) yield ev;
          continue;
        }
        if (line.startsWith(":")) continue; // comment / heartbeat
        if (line.startsWith("event:")) {
          eventName = line.slice(6).trim();
        } else if (line.startsWith("data:")) {
          dataLines.push(line.slice(5).trimStart());
        }
      }
    }
    // Flush any trailing event without a blank line terminator.
    const ev = flush();
    if (ev) yield ev;
  } finally {
    reader.releaseLock();
  }
}

// Re-export for tests that want to parse files.
export { createReadStream };
