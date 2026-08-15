/**
 * Anthropic native Messages API provider with explicit prompt caching.
 *
 * Prompt caching (Anthropic): cache_control breakpoints are placed on the
 * system block and at approx-token intervals through the message list.
 * The server caches the prefix up to each breakpoint; consecutive turns
 * with an identical prefix hit `cache_read_input_tokens`.
 *
 * Wire-format notes (Anthropic vs OpenAI):
 *   - system prompt is a top-level `system` field, NOT a message
 *   - `tool` role messages become user messages with a tool_result block
 *   - assistant tool calls become `tool_use` content blocks
 */
import type { ChatProvider, Message, Request, Response, StreamEvent, ToolDef, Usage } from "./types.ts";
import { emptyUsage } from "./types.ts";
import { parseSSE } from "./sse.ts";

export interface AnthropicProviderOptions {
  apiKey: string;
  baseUrl?: string;
  /** Enable extended thinking (Anthropic thinking blocks). */
  enableThinking?: boolean;
  thinkingBudgetTokens?: number;
}

const API_VERSION = "2023-06-01";
const CACHE_BETA = "prompt-caching-2024-07-31";
const THINKING_BETA = "extended-thinking-2025-01-15";

interface ContentBlock {
  type: string;
  [k: string]: unknown;
}

interface AnthropicUsageRaw {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
}

export class AnthropicProvider implements ChatProvider {
  readonly id = "anthropic";
  readonly apiStyle = "anthropic" as const;
  readonly supportsCache = true;
  readonly cacheStyle = "explicit" as const;

  private opts: AnthropicProviderOptions;

  constructor(opts: AnthropicProviderOptions) {
    this.opts = opts;
  }

  private headers(): Record<string, string> {
    const betas = this.opts.enableThinking ? `${CACHE_BETA},${THINKING_BETA}` : CACHE_BETA;
    return {
      "Content-Type": "application/json",
      "x-api-key": this.opts.apiKey,
      "anthropic-version": API_VERSION,
      "anthropic-beta": betas,
    };
  }

  private endpoint(): string {
    const base = (this.opts.baseUrl ?? "https://api.anthropic.com").replace(/\/+$/, "");
    return `${base}/v1/messages`;
  }

  private buildPayload(req: Request): Record<string, unknown> {
    const { system, messages } = splitSystem(req.messages);
    const payload: Record<string, unknown> = {
      model: req.model,
      max_tokens: req.maxTokens ?? 4096,
      stream: true,
    };
    if (req.temperature !== undefined) payload.temperature = req.temperature;
    if (this.opts.enableThinking) {
      payload.thinking = { type: "enabled", budget_tokens: this.opts.thinkingBudgetTokens ?? 2048 };
      if (req.maxTokens === undefined || req.maxTokens < 4096) payload.max_tokens = Math.max(req.maxTokens ?? 4096, 4096);
    }

    const cacheEnabled = req.cacheEnabled !== false;

    // System block with an explicit cache breakpoint (cached across all turns).
    if (system.length > 0) {
      const blocks: ContentBlock[] = [];
      if (cacheEnabled) {
        blocks.push({ type: "text", text: system, cache_control: { type: "ephemeral" } });
      } else {
        blocks.push({ type: "text", text: system });
      }
      payload.system = blocks;
    }

    if (req.tools && req.tools.length > 0) {
      payload.tools = req.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.parameters,
      }));
      payload.tool_choice = { type: "auto" };
    }

    payload.messages = toAnthropicMessages(messages, cacheEnabled, req.cacheBreakpointTokens ?? 2048);
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
      throw new Error(`LLM anthropic HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
    }
    const data = (await res.json()) as AnthropicResponse;
    return {
      id: data.id ?? "",
      message: messageFromBlocks(data.content ?? [], "assistant"),
      usage: parseAnthropicUsage(data.usage),
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
      throw new Error(`LLM anthropic HTTP ${res.status}: ${(await res.text()).slice(0, 500)}`);
    }
    if (!res.body) throw new Error("LLM anthropic: empty response body");

    let usage: Usage | undefined;
    let textBuf = "";
    let toolAcc = new Map<string, { id: string; name: string; input: string }>();
    let currentIndex = 0;
    let inputJson: string[] = [];

    for await (const ev of parseSSE(res.body)) {
      switch (ev.event) {
        case "message_start": {
          const raw = JSON.parse(ev.data) as { message?: { usage?: AnthropicUsageRaw } };
          if (raw.message?.usage) usage = parseAnthropicUsage(raw.message.usage);
          break;
        }
        case "content_block_start": {
          const raw = JSON.parse(ev.data) as { index: number; content_block?: ContentBlock };
          currentIndex = raw.index ?? 0;
          const cb = raw.content_block;
          if (cb?.type === "tool_use") {
            toolAcc.set(String(raw.index), {
              id: String(cb.id ?? ""),
              name: String(cb.name ?? ""),
              input: "",
            });
          }
          break;
        }
        case "content_block_delta": {
          const raw = JSON.parse(ev.data) as {
            index: number;
            delta?: { type?: string; text?: string; partial_json?: string; thinking?: string };
          };
          const delta = raw.delta;
          if (!delta) break;
          if (delta.type === "text_delta" && delta.text) {
            textBuf += delta.text;
            yield { delta: delta.text, done: false };
          } else if (delta.type === "thinking_delta" && delta.thinking) {
            yield { thinking: delta.thinking, done: false };
          } else if (delta.type === "input_json_delta" && delta.partial_json) {
            inputJson.push(delta.partial_json);
            const t = toolAcc.get(String(raw.index));
            if (t) t.input += delta.partial_json;
          }
          break;
        }
        case "message_delta": {
          const raw = JSON.parse(ev.data) as { usage?: AnthropicUsageRaw };
          if (raw.usage) usage = parseAnthropicUsage(raw.usage);
          break;
        }
        case "message_stop":
          break;
        default:
          break;
      }
    }

    // Emit assembled tool calls, if any.
    if (toolAcc.size > 0) {
      const calls: import("./types.ts").ToolCall[] = [];
      for (const t of toolAcc.values()) {
        calls.push({
          id: t.id,
          type: "function",
          function: { name: t.name, arguments: t.input || "{}" },
        });
      }
      yield { toolCalls: calls, done: false };
    }
    if (usage) yield { usage, done: false };
    yield { done: true, usage };
  }
}

// ---------------------------------------------------------------------------
// Message format conversion
// ---------------------------------------------------------------------------

function splitSystem(messages: Message[]): { system: string; messages: Message[] } {
  let system = "";
  const rest: Message[] = [];
  for (const m of messages) {
    if (m.role === "system") system += (system ? "\n\n" : "") + m.content;
    else rest.push(m);
  }
  return { system, messages: rest };
}

function toAnthropicMessages(messages: Message[], cacheEnabled: boolean, breakpointTokens: number): unknown[] {
  const out: unknown[] = [];
  let approxTokens = 0;

  for (const m of messages) {
    const blocks: ContentBlock[] = [];

    if (m.role === "tool") {
      // Anthropic: tool results are user messages with tool_result blocks.
      blocks.push({
        type: "tool_result",
        tool_use_id: m.toolCallId ?? "",
        content: m.content,
      });
      out.push({ role: "user", content: blocks });
      approxTokens += Math.ceil(m.content.length / 4);
      continue;
    }

    if (m.toolCalls && m.toolCalls.length > 0) {
      if (m.content) blocks.push({ type: "text", text: m.content });
      for (const tc of m.toolCalls) {
        blocks.push({
          type: "tool_use",
          id: tc.id,
          name: tc.function.name,
          input: safeParseJson(tc.function.arguments),
        });
      }
    } else {
      blocks.push({ type: "text", text: m.content });
    }

    const msg: { role: string; content: ContentBlock[] } = { role: m.role, content: blocks };
    if (cacheEnabled && m.cachePoint) {
      // Explicit breakpoint on the last block of this message.
      const last = msg.content[msg.content.length - 1];
      if (last && last.type === "text") {
        last.cache_control = { type: "ephemeral" };
      }
    }
    out.push(msg);
    approxTokens += Math.ceil(m.content.length / 4);
  }

  if (cacheEnabled && out.length > 0) {
    // Best practice: mark the final message as a breakpoint so the whole
    // prefix is cacheable on the next turn. Only meaningful for the last
    // user message, so guard against assistant-only tails.
    const lastMsg = out[out.length - 1] as { role: string; content: ContentBlock[] };
    const lastBlock = lastMsg.content[lastMsg.content.length - 1];
    if (lastBlock && lastBlock.type === "text" && !lastBlock.cache_control) {
      // Only attach to user messages to avoid confusing stop sequences.
      if (lastMsg.role === "user") {
        lastBlock.cache_control = { type: "ephemeral" };
      }
    }
  }
  return out;
}

function messageFromBlocks(blocks: ContentBlock[], role: "user" | "assistant"): Message {
  let text = "";
  const toolCalls: import("./types.ts").ToolCall[] = [];
  for (const b of blocks) {
    if (b.type === "text") text += String(b.text ?? "");
    if (b.type === "tool_use") {
      toolCalls.push({
        id: String(b.id ?? ""),
        type: "function",
        function: { name: String(b.name ?? ""), arguments: JSON.stringify(b.input ?? {}) },
      });
    }
  }
  const m: Message = { role, content: text };
  if (toolCalls.length > 0) m.toolCalls = toolCalls;
  return m;
}

function safeParseJson(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Response shapes & usage parsing
// ---------------------------------------------------------------------------

interface AnthropicResponse {
  id?: string;
  content?: ContentBlock[];
  usage?: AnthropicUsageRaw;
}

function parseAnthropicUsage(u: AnthropicUsageRaw | undefined): Usage {
  const out = emptyUsage();
  if (!u) return out;
  out.promptTokens = u.input_tokens ?? 0;
  out.completionTokens = u.output_tokens ?? 0;
  out.totalTokens = out.promptTokens + out.completionTokens;
  out.details.cacheReadTokens = u.cache_read_input_tokens ?? 0;
  out.details.cacheCreationTokens = u.cache_creation_input_tokens ?? 0;
  return out;
}
