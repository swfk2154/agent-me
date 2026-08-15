/**
 * Mock OpenAI-compatible LLM server for end-to-end tests.
 *
 * Behavior:
 *   - Recognizes a few intents and emits tool_calls (get_current_time,
 *     list_directory, web_search, add_memory) via streaming SSE.
 *   - After tool results come back, produces a final textual answer.
 *   - Simulates prompt caching: tracks the longest shared prefix of
 *     consecutive requests and reports prompt_cache_hit_tokens for it,
 *     so the cache-aware context manager's hit-rate can be verified.
 *
 * Usage: node tests/mock-llm.ts [port]   (default 19191)
 */
import http from "node:http";

const PORT = Number(process.argv[2] ?? 19191);

interface WireMessage {
  role?: string;
  content?: string | null;
  tool_calls?: unknown;
  tool_call_id?: string;
}

/** Remember last request's messages (for prefix-cache simulation). */
let lastMessages: WireMessage[] = [];

function usage(promptTokens: number, hitTokens: number): Record<string, unknown> {
  return {
    prompt_tokens: promptTokens,
    completion_tokens: 24,
    total_tokens: promptTokens + 24,
    prompt_cache_hit_tokens: hitTokens,
    prompt_cache_miss_tokens: promptTokens - hitTokens,
  };
}

function estimateTokens(messages: WireMessage[]): number {
  let n = 0;
  for (const m of messages) {
    n += Math.ceil(String(m.content ?? "").length / 4) + 4;
  }
  return n;
}

function sameMessage(a: WireMessage, b: WireMessage): boolean {
  return a.role === b.role && a.content === b.content && a.tool_call_id === b.tool_call_id;
}

/**
 * Simulate automatic prefix caching (DeepSeek/OpenAI style): the server
 * caches the longest shared prefix between consecutive requests.
 */
function simulateCache(messages: WireMessage[]): { promptTokens: number; hitTokens: number } {
  const promptTokens = estimateTokens(messages);
  let shared = 0;
  const limit = Math.min(messages.length, lastMessages.length);
  while (shared < limit && sameMessage(messages[shared]!, lastMessages[shared]!)) shared++;
  lastMessages = messages;
  return { promptTokens, hitTokens: estimateTokens(messages.slice(0, shared)) };
}

function buildAssistant(text: string, toolCalls: unknown[] | null): Record<string, unknown> {
  const m: Record<string, unknown> = { role: "assistant", content: toolCalls ? null : text };
  if (toolCalls) m.tool_calls = toolCalls;
  return m;
}

function toolCall(id: string, name: string, args: Record<string, unknown>): Record<string, unknown> {
  return { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

function chunk(obj: Record<string, unknown>): string {
  return `data: ${JSON.stringify(obj)}\n\n`;
}

/** Decide next step given the conversation. Returns SSE chunks to emit. */
function plan(messages: WireMessage[]): string[] {
  const last = [...messages].filter((m) => m.role !== "system").at(-1) ?? { role: "user", content: "" };

  // Tool-result round: produce the final answer.
  if (last.role === "tool") {
    const toolName = last.tool_call_id ?? "tool";
    const result = String(last.content ?? "").slice(0, 200);
    const answer = `工具结果已获取（模拟）: ${result.replace(/\n/g, " ").slice(0, 150)}`;
    return [assistantChunk(answer)];
  }

  // Tool-invocation round based on intent.
  const text = String(last.content ?? "");
  const tool: Record<string, unknown> | null = /时间|几点|date|time/i.test(text)
    ? toolCall("call_time_1", "get_current_time", {})
    : /列出|目录|list|ls|文件/i.test(text)
      ? toolCall("call_dir_1", "list_directory", { path: ".", depth: 1 })
      : /搜索|查一下|搜索一下/i.test(text)
        ? toolCall("call_search_1", "web_search", { query: text.replace(/搜索(一下)?/i, "").trim() || "test" })
        : /记住|remember/i.test(text)
          ? toolCall("call_mem_1", "add_memory", { content: text.replace(/记住[:：]?/i, "").trim(), importance: 7 })
          : null;

  if (tool) {
    const fn = tool.function as { name: string; arguments: string };
    return [
      chunk({ choices: [{ index: 0, delta: { role: "assistant" } }] }),
      chunk({
        choices: [
          {
            index: 0,
            delta: { tool_calls: [{ index: 0, id: tool.id, type: "function", function: { name: fn.name, arguments: "" } }] },
          },
        ],
      }),
      chunk({
        choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: fn.arguments } }] } }],
      }),
    ];
  }

  // Plain answer.
  return [assistantChunk(`（模拟回答）你说了：${text.slice(0, 80)}`)];

  function assistantChunk(content: string): string {
    return chunk({ choices: [{ index: 0, delta: { role: "assistant", content } }] });
  }
}

const server = http.createServer((req, res) => {
  if (req.method === "POST" && req.url === "/v1/chat/completions") {
    let body = "";
    req.on("data", (d: Buffer) => (body += d.toString()));
    req.on("end", () => {
      let payload: { messages?: WireMessage[]; stream?: boolean; model?: string };
      try {
        payload = JSON.parse(body) as { messages?: WireMessage[]; stream?: boolean; model?: string };
      } catch {
        res.writeHead(400);
        res.end(JSON.stringify({ error: "bad json" }));
        return;
      }
      const messages = payload.messages ?? [];
      const stream = payload.stream !== false;

      const { promptTokens, hitTokens } = simulateCache(messages);
      const usageObj = usage(promptTokens, hitTokens);
      const chunks = plan(messages);

      if (!stream) {
        res.writeHead(200, { "Content-Type": "application/json" });
        const first = chunks[0];
        const content = first ? ((JSON.parse(first.slice(6)) as { choices: Array<{ delta: { content?: string } }> }).choices[0]?.delta?.content ?? "") : "";
        res.end(
          JSON.stringify({
            id: "mock",
            choices: [{ index: 0, message: buildAssistant(content, null) }],
            usage: usageObj,
          }),
        );
        return;
      }

      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" });
      res.write(chunk({ id: "mock", choices: [], usage: usageObj }));
      for (const c of chunks) res.write(c);
      res.write("data: [DONE]\n\n");
      res.end();
    });
    return;
  }
  res.writeHead(404);
  res.end("not found");
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`mock-llm listening on http://127.0.0.1:${PORT}`);
});
