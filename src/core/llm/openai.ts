/**
 * OpenAI-compatible chat completions provider (covers OpenAI, DeepSeek,
 * Kimi, GLM, Doubao, MiniMax, Google's OpenAI endpoint, Ollama, custom).
 *
 * Prompt caching: DeepSeek / OpenAI use *automatic* prefix caching — the
 * server caches the longest matching prefix of the request. We therefore
 * keep the wire payload byte-stable (see context/manager.ts) and surface
 * cache metrics from usage fields:
 *   - deepseek: `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`
 *   - openai:   `prompt_tokens_details.cached_tokens`
 */
import type { ChatProvider, Message, Request, Response, StreamEvent, ToolDef, Usage } from "./types.ts";
import { emptyUsage } from "./types.ts";
import { parseSSE } from "./sse.ts";

interface OpenAIToolCallDelta {
  index: number;
  id?: string;
  function?: { name?: string; arguments?: string };
}

export interface OpenAIProviderOptions {
  baseUrl: string;
  apiKey: string;
  /** Extra headers, e.g. Ollama's "x-ollama-api-key". */
  extraHeaders?: Record<string, string>;
}

export class OpenAIProvider implements ChatProvider {
  readonly apiStyle = "openai" as const;
  readonly supportsCache: boolean;
  readonly cacheStyle: "automatic" | "none";

  readonly id: string;
  private opts: OpenAIProviderOptions;

  constructor(id: string, opts: OpenAIProviderOptions, supportsCache = true) {
    this.id = id;
    this.opts = opts;
    this.supportsCache = supportsCache;
    this.cacheStyle = supportsCache ? "automatic" : "none";
  }

  private endpoint(): string {
    const base = this.opts.baseUrl.replace(/\/+$/, "");
    if (base.endsWith("/chat/completions")) return base;
    return `${base}/chat/completions`;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.opts.apiKey}`,
      ...this.opts.extraHeaders,
    };
    return h;
  }

  private buildPayload(req: Request): Record<string, unknown> {
    const payload: Record<string, unknown> = {
      model: req.model,
      messages: req.messages.map(toWireMessage),
      stream: true,
    };
    if (req.tools && req.tools.length > 0) {
      payload.tools = req.tools.map(toWireTool);
      payload.tool_choice = "auto";
    }
    if (req.temperature !== undefined) payload.temperature = req.temperature;
    if (req.maxTokens !== undefined) payload.max_tokens = req.maxTokens;
    return payload;
  }

  async complete(req: Request, signal?: AbortSignal): Promise<Response> {
    const payload = this.buildPayload(req);
    payload.stream = false;
    const res = await fetch(this.endpoint(), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(payload),
      signal,
    });
    if (!res.ok) {
      throw new Error(`LLM ${this.id} HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
    }
    const data = (await res.json()) as OpenAIResponse;
    const choice = data.choices?.[0];
    return {
      id: data.id ?? "",
      message: choice ? fromWireMessage(choice.message ?? {}) : { role: "assistant", content: "" },
      usage: parseUsage(data.usage),
    };
  }

  async *stream(req: Request, signal?: AbortSignal): AsyncGenerator<StreamEvent> {
    const payload = this.buildPayload(req);
    const res = await fetch(this.endpoint(), {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify(payload),
      signal,
    });
    if (!res.ok) {
      throw new Error(`LLM ${this.id} HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
    }
    if (!res.body) {
      throw new Error(`LLM ${this.id}: empty response body`);
    }

    let usage: Usage | undefined;
    // Tool-call deltas arrive fragmented across chunks (id/name in one,
    // arguments in the next); accumulate per index and emit once at the end.
    const toolAcc = new Map<number, ToolCallAcc>();
    let sawToolDelta = false;

    for await (const ev of parseSSE(res.body)) {
      if (ev.data === "[DONE]") break;
      let chunk: OpenAIChatChunk;
      try {
        chunk = JSON.parse(ev.data) as OpenAIChatChunk;
      } catch {
        continue;
      }
      if (chunk.usage) usage = parseUsage(chunk.usage);
      const delta = chunk.choices?.[0]?.delta;
      if (!delta) {
        if (usage) yield { done: false, usage };
        continue;
      }
      const event: StreamEvent = {
        delta: delta.content ?? undefined,
        // DeepSeek streams reasoning in `reasoning_content`; OpenAI o-series
        // uses `reasoning`. Some gateways use `reasoning` too.
        thinking: delta.reasoning_content ?? delta.reasoning ?? undefined,
        done: false,
      };
      if (usage) event.usage = usage;
      yield event;

      // Accumulate tool-call fragments (do not emit per-chunk; assembled below).
      if (delta.tool_calls && delta.tool_calls.length > 0) {
        sawToolDelta = true;
        for (const d of delta.tool_calls) {
          const cur = toolAcc.get(d.index) ?? { index: d.index };
          if (d.id) cur.id = d.id;
          if (d.function?.name) cur.name = (cur.name ?? "") + d.function.name;
          if (d.function?.arguments) cur.args = (cur.args ?? "") + d.function.arguments;
          toolAcc.set(d.index, cur);
        }
      }
    }

    // Emit fully-assembled tool calls once, after the stream ends.
    if (sawToolDelta && toolAcc.size > 0) {
      const calls: import("./types.ts").ToolCall[] = [];
      for (const a of toolAcc.values()) {
        calls.push({
          id: a.id ?? `call_${a.index}`,
          type: "function",
          function: { name: a.name ?? "", arguments: a.args ?? "{}" },
        });
      }
      yield { toolCalls: calls, done: false };
    }
    yield { done: true, usage };
  }
}

// ---------------------------------------------------------------------------
// Wire conversion
// ---------------------------------------------------------------------------

function toWireMessage(m: Message): Record<string, unknown> {
  const wire: Record<string, unknown> = { role: m.role };
  if (m.role === "tool") {
    wire.content = m.content;
    wire.tool_call_id = m.toolCallId ?? "";
    return wire;
  }
  if (m.toolCalls && m.toolCalls.length > 0) {
    wire.content = m.content || null;
    wire.tool_calls = m.toolCalls.map((tc) => ({
      id: tc.id,
      type: "function",
      function: { name: tc.function.name, arguments: tc.function.arguments },
    }));
    return wire;
  }
  wire.content = m.content;
  return wire;
}

function toWireTool(t: ToolDef): Record<string, unknown> {
  return {
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  };
}

function fromWireMessage(w: OpenAIWireMessage): Message {
  const m: Message = { role: "assistant", content: w.content ?? "" };
  if (w.tool_calls && w.tool_calls.length > 0) {
    m.toolCalls = w.tool_calls.map((tc) => ({
      id: tc.id,
      type: "function",
      function: { name: tc.function?.name ?? "", arguments: tc.function?.arguments ?? "{}" },
    }));
  }
  return m;
}

interface ToolCallAcc {
  index: number;
  id?: string;
  name?: string;
  args?: string;
}

// ---------------------------------------------------------------------------
// Response shapes & usage parsing
// ---------------------------------------------------------------------------

interface OpenAIWireMessage {
  role?: string;
  content?: string | null;
  /** DeepSeek reasoning model stream field. */
  reasoning_content?: string;
  /** OpenAI o-series reasoning stream field. */
  reasoning?: string;
  tool_calls?: Array<{ id: string; type?: string; function?: { name?: string; arguments?: string } }>;
}

interface OpenAIChoice {
  index?: number;
  message?: OpenAIWireMessage;
  delta?: OpenAIWireMessage & { tool_calls?: OpenAIToolCallDelta[] };
}

interface OpenAIChatChunk {
  id?: string;
  choices?: OpenAIChoice[];
  usage?: unknown;
}

interface OpenAIResponse {
  id?: string;
  choices?: OpenAIChoice[];
  usage?: unknown;
}

function parseUsage(u: unknown): Usage {
  const out = emptyUsage();
  if (!u || typeof u !== "object") return out;
  const raw = u as Record<string, unknown>;
  out.promptTokens = num(raw.prompt_tokens);
  out.completionTokens = num(raw.completion_tokens);
  out.totalTokens = num(raw.total_tokens);
  const details = raw.prompt_tokens_details as Record<string, unknown> | undefined;
  if (details && typeof details === "object") {
    out.details.cachedTokens = num(details.cached_tokens);
  }
  // DeepSeek-specific cache fields.
  out.details.cachedTokens = out.details.cachedTokens || num(raw.prompt_cache_hit_tokens);
  return out;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
