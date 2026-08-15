/**
 * Agent main loop.
 *
 * Flow (tool-calling loop):
 *   user input → context.append(user)
 *   repeat up to maxTurns:
 *     req = context.buildRequest()          ← cache-aware request assembly
 *     stream assistant response
 *     if tool_calls: append assistant msg → run tools (parallel, ordered
 *       results) → append tool results → continue
 *     else: append assistant msg → done
 *
 * Safeguards:
 *   - maxTurns cap (default 8) — no infinite tool loops
 *   - consecutive-failure fuse (3) — stop burning tokens on a broken tool
 *     (inherited from agent-me v2.2's safety fuse)
 *   - AbortSignal propagation to LLM stream and tool execution
 */
import type { ChatProvider, Message, ToolCall, Usage } from "../llm/types.ts";
import type { ContextManager } from "../context/manager.ts";
import type { ToolRegistry, ToolContext } from "../tools/registry.ts";
import type { MemoryStore } from "../memory/store.ts";

export type AgentEvent =
  | { type: "message_start" }
  | { type: "delta"; text: string }
  | { type: "thinking"; text: string }
  | { type: "tool_call"; tool: string; args: unknown; callId: string }
  | { type: "tool_result"; tool: string; callId: string; ok: boolean; output: string; error?: string }
  | { type: "usage"; usage: Usage }
  | { type: "done"; text: string; turns: number; toolCalls: number };

export interface AgentOptions {
  provider: ChatProvider;
  /** Model identifier passed to the provider (e.g. "deepseek-v4-flash"). */
  model: string;
  context: ContextManager;
  tools: ToolRegistry;
  memory?: MemoryStore;
  toolCtx: Omit<ToolContext, "signal">;
  maxTurns?: number;
  maxConsecutiveFailures?: number;
  temperature?: number;
  maxOutputTokens?: number;
  /** Called when the agent wants to ask the user (ask_user tool). */
  onAsk?: (question: string) => Promise<string>;
}

export class Agent {
  private provider: ChatProvider;
  private model: string;
  private context: ContextManager;
  private tools: ToolRegistry;
  private memory?: MemoryStore;
  private toolCtx: Omit<ToolContext, "signal">;
  private maxTurns: number;
  private maxFailures: number;
  private temperature?: number;
  private maxOutputTokens?: number;
  private onAsk?: (question: string) => Promise<string>;

  constructor(opts: AgentOptions) {
    this.provider = opts.provider;
    this.model = opts.model;
    this.context = opts.context;
    this.tools = opts.tools;
    this.memory = opts.memory;
    this.toolCtx = opts.toolCtx;
    this.maxTurns = opts.maxTurns ?? 8;
    this.maxFailures = opts.maxConsecutiveFailures ?? 3;
    this.temperature = opts.temperature;
    this.maxOutputTokens = opts.maxOutputTokens;
    this.onAsk = opts.onAsk;
  }

  /**
   * Run one user turn. Consume the async generator to drive the loop;
   * events are emitted as they happen. Caller controls cancellation via
   * the passed AbortSignal.
   */
  async *run(input: string, signal?: AbortSignal): AsyncGenerator<AgentEvent> {
    this.context.append({ role: "user", content: input });
    yield { type: "message_start" };

    let turns = 0;
    let totalToolCalls = 0;
    let failures = 0;
    let fullText = "";

    try {
      for (; turns < this.maxTurns; turns++) {
        const finalReq = await this.context.buildRequest(this.model, {
          temperature: this.temperature,
          maxTokens: this.maxOutputTokens,
        });

        let usage: Usage | undefined;
        let assistant: Message = { role: "assistant", content: "" };

        for await (const ev of this.provider.stream(finalReq, signal)) {
          if (ev.error) throw ev.error;
          if (ev.thinking) {
            // Reasoning/thinking stream (DeepSeek reasoning_content,
            // OpenAI reasoning, Anthropic thinking blocks) — display-only,
            // not part of the persisted assistant content.
            yield { type: "thinking", text: ev.thinking };
          }
          if (ev.delta) {
            assistant.content += ev.delta;
            fullText += ev.delta;
            yield { type: "delta", text: ev.delta };
          }
          if (ev.toolCalls && ev.toolCalls.length > 0) {
            assistant.toolCalls = ev.toolCalls;
          }
          if (ev.usage) usage = ev.usage;
        }

        if (usage) {
          this.context.recordUsage(usage);
          yield { type: "usage", usage };
        }

        if (!assistant.toolCalls || assistant.toolCalls.length === 0) {
          // Final textual answer.
          this.context.append(assistant);
          yield { type: "done", text: assistant.content, turns: turns + 1, toolCalls: totalToolCalls };
          return;
        }

        // Tool round.
        this.context.append(assistant);
        const results = await this.runToolCalls(assistant.toolCalls, signal);
        totalToolCalls += results.length;

        let roundFailed = false;
        for (const r of results) {
          yield { type: "tool_call", tool: r.tool, args: r.args, callId: r.callId };
          yield { type: "tool_result", tool: r.tool, callId: r.callId, ok: r.ok, output: r.output, error: r.error };
          this.context.append({ role: "tool", content: r.ok ? r.output : `ERROR: ${r.error ?? "unknown"}`, toolCallId: r.callId });
          if (!r.ok) roundFailed = true;
        }

        failures = roundFailed ? failures + 1 : 0;
        if (failures >= this.maxFailures) {
          yield {
            type: "done",
            text: `${assistant.content}\n\n[已停止：连续 ${this.maxFailures} 次工具调用失败，避免浪费 token。请检查工具/环境后重试。]`,
            turns: turns + 1,
            toolCalls: totalToolCalls,
          };
          return;
        }
      }

      yield {
        type: "done",
        text: `${fullText}\n\n[已达到最大工具调用轮数 ${this.maxTurns}，任务可能未完成。]`,
        turns,
        toolCalls: totalToolCalls,
      };
    } finally {
      // Nothing to clean up per-turn; ContextManager owns window state.
    }
  }

  private async runToolCalls(
    calls: ToolCall[],
    signal?: AbortSignal,
  ): Promise<Array<{ callId: string; tool: string; args: unknown; ok: boolean; output: string; error?: string }>> {
    const results = await Promise.all(
      calls.map(async (tc) => {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments || "{}") as Record<string, unknown>;
        } catch {
          args = { _raw: tc.function.arguments };
        }
        const res = await this.tools.call(tc.function.name, args, {
          ...this.toolCtx,
          memory: this.memory,
          signal,
          ask: this.onAsk,
        });
        return {
          callId: tc.id,
          tool: tc.function.name,
          args,
          ok: res.ok,
          output: res.output,
          error: res.error,
        };
      }),
    );
    return results;
  }
}
