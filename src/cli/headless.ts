/**
 * Headless one-shot mode (agent-me ask "…" / -p) — script & CI friendly,
 * mirroring the `-p` + `--output-format json|stream-json` pattern used by
 * Grok Build and Kimi Code (see https://blogbu2154.site/ai-coding-agents-compare/).
 */
import { readFile } from "node:fs/promises";
import type { Runtime } from "../runtime.ts";
import type { AgentEvent } from "../core/agent/loop.ts";

export interface HeadlessOptions {
  prompt: string;
  files: string[];
  outputFormat: "text" | "json" | "stream-json";
  conversationId?: string;
}

export async function runHeadless(runtime: Runtime, opts: HeadlessOptions): Promise<number> {
  let prompt = opts.prompt;
  for (const f of opts.files) {
    try {
      const content = await readFile(f, "utf8");
      prompt += `\n\n[文件 ${f}]\n${content.slice(0, 100_000)}`;
    } catch (err) {
      if (opts.outputFormat === "stream-json") {
        emitLine({ type: "error", message: `cannot read file ${f}: ${(err as Error).message}` });
      } else {
        console.error(`❌ 无法读取文件 ${f}: ${(err as Error).message}`);
      }
      return 1;
    }
  }

  const convId = opts.conversationId ?? runtime.newConversationId();
  runtime.ensureConversation(convId);
  const context = await runtime.newContext(convId);
  runtime.store.addMessage(convId, { role: "user", content: prompt });

  const agent = await runtime.newAgent(context, {
    // Headless: no interactive channel — ask_user tools will fail gracefully.
    onAsk: async () => {
      throw new Error("headless 模式无交互通道，无法回答 ask_user 问题");
    },
  });

  let text = "";
  let requestNo = runtime.store.cacheSummary(convId).requests;

  for await (const ev of agent.run(prompt)) {
    switch (opts.outputFormat) {
      case "stream-json":
        emitLine(toStreamJson(ev));
        break;
      case "text":
        if (ev.type === "delta") process.stdout.write(ev.text);
        break;
      case "json":
        // Buffered: only the final JSON object is emitted.
        break;
      default:
        break;
    }
    if (ev.type === "done") text = ev.text;
    if (ev.type === "usage") {
      requestNo++;
      runtime.store.addCacheStat(convId, requestNo, ev.usage);
    }
    if (ev.type === "tool_call") {
      runtime.store.addMessage(convId, {
        role: "assistant",
        content: "",
        toolCalls: [{ id: ev.callId, type: "function", function: { name: ev.tool, arguments: JSON.stringify(ev.args) } }],
      });
    }
    if (ev.type === "tool_result") {
      runtime.store.addMessage(convId, { role: "tool", content: ev.ok ? ev.output : `ERROR: ${ev.error ?? ""}`, toolCallId: ev.callId });
    }
  }

  runtime.store.addMessage(convId, { role: "assistant", content: text });
  const summary = runtime.store.cacheSummary(convId);

  if (opts.outputFormat === "json") {
    emitLine({
      text,
      conversationId: convId,
      cache: {
        requests: summary.requests,
        promptTokens: summary.promptTokens,
        cachedTokens: summary.cachedTokens,
        hitRate: summary.hitRate,
      },
    });
  } else if (opts.outputFormat === "text" && !process.stdout.isTTY) {
    process.stdout.write("\n");
  }
  return 0;
}

function toStreamJson(ev: AgentEvent): unknown {
  switch (ev.type) {
    case "delta":
      return { type: "delta", text: ev.text };
    case "thinking":
      return { type: "thinking", text: ev.text };
    case "tool_call":
      return { type: "tool_call", tool: ev.tool, args: ev.args };
    case "tool_result":
      return { type: "tool_result", tool: ev.tool, ok: ev.ok, output: ev.output, error: ev.error };
    case "usage":
      return { type: "usage", usage: ev.usage };
    case "done":
      return { type: "done", text: ev.text, turns: ev.turns, toolCalls: ev.toolCalls };
    default:
      return { type: ev.type };
  }
}

function emitLine(obj: unknown): void {
  process.stdout.write(JSON.stringify(obj) + "\n");
}
