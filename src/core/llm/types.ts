/**
 * LLM provider types shared across all backends.
 * The internal message model is OpenAI-shaped; Anthropic conversion happens
 * inside the anthropic adapter.
 */

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface FunctionCall {
  name: string;
  /** JSON-encoded arguments string (OpenAI wire format). */
  arguments: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: FunctionCall;
}

export interface Message {
  role: MessageRole;
  content: string;
  toolCalls?: ToolCall[];
  /** Present on role === "tool": the id of the tool call this result answers. */
  toolCallId?: string;
  /** Internal marker: insert explicit cache breakpoint on this message (Anthropic cache_control). */
  cachePoint?: boolean;
}

/** A tool definition exposed to the model. `parameters` is a JSON Schema object. */
export interface ToolDef {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface PromptTokensDetails {
  /** OpenAI-style: tokens already cached (deepseek: prompt_cache_hit_tokens). */
  cachedTokens: number;
  /** Anthropic-style: read from cache. */
  cacheReadTokens: number;
  /** Anthropic-style: written to cache this request. */
  cacheCreationTokens: number;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  details: PromptTokensDetails;
}

export function emptyUsage(): Usage {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0,
    details: { cachedTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 } };
}

export interface Request {
  model: string;
  messages: Message[];
  tools?: ToolDef[];
  temperature?: number;
  maxTokens?: number;
  /** Whether prompt caching is enabled for this request. */
  cacheEnabled?: boolean;
  /** Approx-token granularity for explicit cache breakpoints. */
  cacheBreakpointTokens?: number;
}

export interface Response {
  id: string;
  message: Message;
  usage: Usage;
}

export interface StreamEvent {
  /** Incremental text delta (content or tool-call arguments). */
  delta?: string;
  /** Incremental reasoning/thinking delta (DeepSeek reasoning_content,
   *  OpenAI reasoning, Anthropic thinking blocks). */
  thinking?: string;
  toolCalls?: ToolCall[];
  done: boolean;
  error?: Error;
  usage?: Usage;
}

export interface ChatProvider {
  readonly id: string;
  readonly apiStyle: "openai" | "anthropic";
  readonly supportsCache: boolean;
  readonly cacheStyle: "explicit" | "automatic" | "none";
  complete(req: Request, signal?: AbortSignal): Promise<Response>;
  stream(req: Request, signal?: AbortSignal): AsyncIterable<StreamEvent>;
}

// ---------------------------------------------------------------------------
// Tool schema helpers (stable serialization matters for prompt-cache hits)
// ---------------------------------------------------------------------------

/**
 * Serialize tool definitions with a canonical, stable ordering so the bytes
 * sent to the LLM never change between requests (byte-identical prefix ⇒
 * maximum prompt-cache hit rate).
 */
export function canonicalTools(tools: ToolDef[]): ToolDef[] {
  return [...tools].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

export function toolSchemaBytes(tools: ToolDef[]): string {
  return JSON.stringify(canonicalTools(tools));
}
