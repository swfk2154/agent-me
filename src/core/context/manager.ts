/**
 * Cache-aware context manager — the heart of prompt-cache hit-rate
 * optimization.
 *
 * Design principles (each maps to a concrete mechanism):
 *
 * 1. STABLE PREFIX — the system prompt and tool schema are byte-identical
 *    across every request of a session. Dynamic data (time, cwd, …) never
 *    enters the system prompt; it is appended as regular messages.
 *
 * 2. APPEND-ONLY LOG — conversation messages are only ever appended.
 *    Historical messages are never rewritten or reordered, so the prefix
 *    stays byte-identical and the server-side cache (automatic prefix
 *    caching on DeepSeek/OpenAI, explicit cache_control on Anthropic)
 *    keeps hitting.
 *
 * 3. CACHE-AWARE TRIM — when the window overflows, the oldest messages are
 *    replaced by ONE synthetic summary message placed at the trim point.
 *    Everything after the summary is untouched; every future request
 *    therefore starts with the same prefix:
 *        [system] [tools] [summary] [recent messages…]
 *    and the summary is frozen after creation (never regenerated unless the
 *    window overflows again).
 *
 * 4. EXPLICIT BREAKPOINTS (Anthropic) — cachePoint flags are set on
 *    messages at approx-token intervals so the provider stores multiple
 *    prefix checkpoints; growing conversations still get incremental hits.
 *
 * 5. CACHE METRICS — every response usage is recorded; hit rate is
 *    queryable by the UI/CLI (`/stats`).
 */
import type { Message, Request, ToolDef, Usage } from "../llm/types.ts";
import { canonicalTools, toolSchemaBytes } from "../llm/types.ts";
import { estimateTokens, messageTokens } from "./tokens.ts";

export interface CacheStats {
  requests: number;
  promptTokens: number;
  completionTokens: number;
  /** Tokens read from cache (hit). */
  cachedTokens: number;
  /** Tokens written to cache. */
  cacheCreationTokens: number;
  /** cached / prompt, 0..1 */
  hitRate: number;
}

export function emptyCacheStats(): CacheStats {
  return { requests: 0, promptTokens: 0, completionTokens: 0, cachedTokens: 0, cacheCreationTokens: 0, hitRate: 0 };
}

export interface Summarizer {
  summarize(dropped: Message[]): Promise<string>;
}

export interface ContextManagerOptions {
  systemPrompt: string;
  maxWindowTokens: number;
  cacheBreakpointTokens: number;
  cacheEnabled: boolean;
  summarizer?: Summarizer;
}

/** Marker for the synthetic summary message. */
export const SUMMARY_PREFIX = "[对话摘要，可替代此前全部历史]";

export class ContextManager {
  private system: string;
  private tools: ToolDef[] = [];
  private toolsBytes = "";
  private log: Message[] = [];
  private summary: string | undefined;
  private stats: CacheStats = emptyCacheStats();
  private summarizing = false;

  readonly maxWindowTokens: number;
  readonly cacheBreakpointTokens: number;
  readonly cacheEnabled: boolean;
  readonly summarizer?: Summarizer;

  constructor(opts: ContextManagerOptions) {
    this.system = opts.systemPrompt;
    this.maxWindowTokens = opts.maxWindowTokens;
    this.cacheBreakpointTokens = opts.cacheBreakpointTokens;
    this.cacheEnabled = opts.cacheEnabled;
    this.summarizer = opts.summarizer;
  }

  // -------------------------------------------------------------------------
  // State mutation
  // -------------------------------------------------------------------------

  setSystemPrompt(p: string): void {
    this.system = p;
  }

  setTools(tools: ToolDef[]): void {
    this.tools = canonicalTools(tools);
    this.toolsBytes = toolSchemaBytes(this.tools);
  }

  get toolsList(): readonly ToolDef[] {
    return this.tools;
  }

  /** Append a message to the append-only log. */
  append(m: Message): void {
    this.log.push(m);
  }

  /** Reset the session (new conversation). */
  reset(): void {
    this.log = [];
    this.summary = undefined;
    this.stats = emptyCacheStats();
  }

  get messageCount(): number {
    return this.log.length;
  }

  // -------------------------------------------------------------------------
  // Request building (cache-aware)
  // -------------------------------------------------------------------------

  /**
   * Build the LLM request. May trigger async summarization when the window
   * overflows. The returned messages array always starts with
   * [summary?] + [recent window] and the system/tools prefix is stable.
   */
  async buildRequest(model: string, opts?: { temperature?: number; maxTokens?: number }): Promise<Request> {
    await this.maybeTrim();

    const msgs: Message[] = [];
    if (this.summary) {
      msgs.push({ role: "user", content: `${SUMMARY_PREFIX}\n${this.summary}` });
    }
    msgs.push(...this.log);

    // Place explicit cache breakpoints at approx-token intervals (Anthropic).
    if (this.cacheEnabled) {
      let acc = estimateTokens(this.system) + this.toolsBytes.length / 4;
      for (const m of msgs) {
        acc += messageTokens(m.content);
        if (acc >= this.cacheBreakpointTokens) {
          m.cachePoint = true;
          acc = 0;
        }
      }
    }

    const req: Request = {
      model,
      messages: msgs,
      tools: this.toolsBytes ? this.tools : undefined,
      cacheEnabled: this.cacheEnabled,
      cacheBreakpointTokens: this.cacheBreakpointTokens,
    };
    if (opts?.temperature !== undefined) req.temperature = opts.temperature;
    if (opts?.maxTokens !== undefined) req.maxTokens = opts.maxTokens;
    return req;
  }

  /**
   * Trim the log to fit maxWindowTokens. Oldest messages are summarized into
   * a single frozen summary message placed at the trim boundary.
   */
  private async maybeTrim(): Promise<void> {
    const total = this.estimateLogTokens();
    if (total <= this.maxWindowTokens || this.log.length <= 4) return;

    const target = Math.floor(this.maxWindowTokens * 0.8);
    // Drop from the head while over budget; keep at least 4 recent messages.
    let drop = 0;
    let acc = 0;
    const limit = this.log.length - 4;
    while (drop < limit) {
      const m = this.log[drop]!;
      const t = messageTokens(m.content);
      if (total - acc - t <= target) break;
      acc += t;
      drop++;
    }
    if (drop <= 1) return;

    const dropped = this.log.slice(0, drop);
    this.log = this.log.slice(drop);
    try {
      this.summary = await this.makeSummary(dropped);
    } catch (err) {
      // Summary failure must not break the conversation; fall back to a
      // coarse concatenation so the trim still reduces the window.
      this.summary = dropped
        .map((m) => `${m.role}: ${m.content.slice(0, 200)}`)
        .join("\n")
        .slice(0, 2000);
      console.warn(`[context] summarize fallback: ${(err as Error).message}`);
    }
  }

  private async makeSummary(dropped: Message[]): Promise<string> {
    if (!this.summarizer) {
      return dropped
        .map((m) => `${m.role}: ${m.content.slice(0, 120)}`)
        .join("\n")
        .slice(0, 1500);
    }
    // Serialize summarization to avoid concurrent LLM calls racing.
    if (this.summarizing) {
      // Reuse whatever summary exists (caller waits for the in-flight one
      // via a simple spin is avoided; fall back to coarse text).
      return dropped.map((m) => `${m.role}: ${m.content.slice(0, 120)}`).join("\n").slice(0, 1500);
    }
    this.summarizing = true;
    try {
      return await this.summarizer.summarize(dropped);
    } finally {
      this.summarizing = false;
    }
  }

  estimateLogTokens(): number {
    let acc = estimateTokens(this.system) + this.toolsBytes.length / 4;
    for (const m of this.log) acc += messageTokens(m.content);
    if (this.summary) acc += messageTokens(this.summary);
    return Math.ceil(acc);
  }

  // -------------------------------------------------------------------------
  // Cache metrics
  // -------------------------------------------------------------------------

  recordUsage(u: Usage): void {
    const s = this.stats;
    s.requests++;
    s.promptTokens += u.promptTokens;
    s.completionTokens += u.completionTokens;
    const cached = Math.max(u.details.cachedTokens, u.details.cacheReadTokens);
    s.cachedTokens += cached;
    s.cacheCreationTokens += u.details.cacheCreationTokens;
    s.hitRate = s.promptTokens > 0 ? s.cachedTokens / s.promptTokens : 0;
  }

  getStats(): CacheStats {
    return { ...this.stats };
  }
}
