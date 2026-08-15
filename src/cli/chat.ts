/**
 * Interactive chat mode: readline REPL with slash commands, streaming output,
 * ask_user support, Ctrl+C cancellation — styled via cli/ui.ts.
 */
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { Runtime } from "../runtime.ts";
import type { AgentEvent } from "../core/agent/loop.ts";
import { saveConfig } from "../core/config.ts";
import {
  banner,
  sep,
  USER_PROMPT,
  AGENT_PREFIX,
  toolCallLine,
  toolFailLine,
  usageLine,
  errorLine,
  infoLine,
  colors,
} from "./ui.ts";

export interface ChatOptions {
  model?: string;
  provider?: string;
}

const HELP = `
${colors.bold("斜杠命令")}
  /new [标题]        新对话
  /model [名称]      查看或切换模型
  /provider [id]     查看或切换 provider
  /stats             查看缓存命中率统计
  /history           显示最近消息
  /quit              退出
  /help              显示帮助
`;

export async function runChat(runtime: Runtime, opts: ChatOptions = {}): Promise<void> {
  if (opts.provider) runtime.config.activeProvider = opts.provider;
  if (opts.model) runtime.config.activeModel = opts.model;
  await saveConfig(runtime.paths, runtime.config);

  const rl = createInterface({ input, output, terminal: true });
  let conversationId = runtime.newConversationId();
  let title = "新对话";
  runtime.ensureConversation(conversationId, title);
  let generation = false;
  let lastAbort: AbortController | undefined;

  banner(runtime.config.activeProvider, runtime.config.activeModel || "(默认模型)", "CLI");

  // Ctrl+C: cancel in-flight generation; otherwise quit.
  process.on("SIGINT", () => {
    if (generation) {
      process.stdout.write("\n");
      errorLine("已中断本次生成");
      lastAbort?.abort();
    } else {
      rl.close();
      process.exit(0);
    }
  });

  for (;;) {
    const line = (await rl.question(USER_PROMPT)).trim();
    if (!line) continue;

    if (line.startsWith("/")) {
      const handled = await handleSlash(runtime, rl, conversationId, line, (id, t) => {
        conversationId = id;
        title = t;
      });
      if (handled === "quit") {
        rl.close();
        process.exit(0);
      }
      continue;
    }

    // One turn.
    generation = true;
    const abort = new AbortController();
    lastAbort = abort;
    let requestNo = runtime.store.cacheSummary(conversationId).requests;
    try {
      const context = await runtime.newContext(conversationId);
      runtime.store.addMessage(conversationId, { role: "user", content: line });
      runtime.store.touchConversation(conversationId, title);

      const agent = await runtime.newAgent(context, {
        onAsk: async (question) => {
          process.stdout.write(`\n  ${colors.yellow("❓")} ${question}\n`);
          const answer = (await rl.question(USER_PROMPT)).trim();
          return answer || "（无回答）";
        },
      });

      process.stdout.write(`${AGENT_PREFIX} `);
      const events: AgentEvent[] = [];
      for await (const ev of agent.run(line, abort.signal)) {
        events.push(ev);
        switch (ev.type) {
          case "delta":
            process.stdout.write(ev.text);
            break;
          case "thinking":
            // Reasoning stream rendered dim + italic-style (no italic in
            // plain ANSI; dim + cyan reads as "thinking").
            process.stdout.write(colors.dim(ev.text));
            break;
          case "tool_call":
            process.stdout.write("\n");
            toolCallLine(ev.tool, JSON.stringify(ev.args).slice(0, 100));
            break;
          case "tool_result":
            if (!ev.ok) toolFailLine(ev.tool, ev.error ?? "unknown error");
            break;
          case "usage": {
            const cached = Math.max(ev.usage.details.cachedTokens, ev.usage.details.cacheReadTokens);
            usageLine(ev.usage.promptTokens, cached);
            break;
          }
          case "done":
            if (!ev.text) process.stdout.write(colors.dim("(空回复)"));
            process.stdout.write("\n");
            break;
          default:
            break;
        }
      }
      sep();

      // Persist events to the store.
      for (const ev of events) {
        if (ev.type === "tool_call") {
          runtime.store.addMessage(conversationId, {
            role: "assistant",
            content: "",
            toolCalls: [{ id: ev.callId, type: "function", function: { name: ev.tool, arguments: JSON.stringify(ev.args) } }],
          });
        } else if (ev.type === "tool_result") {
          runtime.store.addMessage(conversationId, {
            role: "tool",
            content: ev.ok ? ev.output : `ERROR: ${ev.error ?? "unknown"}`,
            toolCallId: ev.callId,
          });
        } else if (ev.type === "usage") {
          requestNo++;
          runtime.store.addCacheStat(conversationId, requestNo, ev.usage);
        } else if (ev.type === "done") {
          runtime.store.addMessage(conversationId, { role: "assistant", content: ev.text });
          const t = firstLine(ev.text);
          if (t) {
            runtime.store.touchConversation(conversationId, t.slice(0, 30));
            title = t.slice(0, 30);
          }
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errorLine(msg);
    } finally {
      generation = false;
    }
  }
}

function firstLine(s: string): string {
  const line = s.split("\n").find((l) => l.trim().length > 0);
  return line?.trim() ?? "";
}

async function handleSlash(
  runtime: Runtime,
  rl: ReturnType<typeof createInterface>,
  conversationId: string,
  line: string,
  setConv: (id: string, title: string) => void,
): Promise<"continue" | "quit"> {
  const [cmdRaw, ...rest] = line.split(/\s+/);
  const cmd = cmdRaw!;
  const arg = rest.join(" ");
  switch (cmd) {
    case "/new": {
      const id = runtime.newConversationId();
      const t = arg || "新对话";
      runtime.ensureConversation(id, t);
      setConv(id, t);
      infoLine(`已开始新对话 ${colors.dim(id.slice(0, 8))}`);
      return "continue";
    }
    case "/model": {
      if (arg) {
        runtime.config.activeModel = arg;
        await saveConfig(runtime.paths, runtime.config);
        infoLine(`模型已切换: ${colors.bold(arg)}`);
      } else {
        console.log(`  当前模型: ${colors.bold(runtime.config.activeModel || "(默认)")}`);
      }
      return "continue";
    }
    case "/provider": {
      if (arg) {
        runtime.config.activeProvider = arg;
        await saveConfig(runtime.paths, runtime.config);
        infoLine(`provider 已切换: ${colors.bold(arg)}`);
      } else {
        console.log(`  当前 provider: ${colors.bold(runtime.config.activeProvider)}`);
      }
      return "continue";
    }
    case "/stats": {
      const s = runtime.store.cacheSummary(conversationId);
      const pct = s.requests > 0 ? (s.hitRate * 100).toFixed(1) : "—";
      const colored = s.hitRate >= 0.7 ? colors.green(pct) : s.hitRate >= 0.3 ? colors.yellow(pct) : colors.red(pct);
      console.log(`  ${colors.bold("缓存统计")} ${colors.dim("(本对话)")}`);
      console.log(`    请求数:      ${s.requests}`);
      console.log(`    prompt:      ${s.promptTokens} tok`);
      console.log(`    缓存命中:    ${s.cachedTokens} tok`);
      console.log(`    命中率:      ${colored}%`);
      return "continue";
    }
    case "/history": {
      const msgs = runtime.store.listMessages(conversationId, 50);
      console.log(`  共 ${msgs.length} 条消息，最近 10 条:`);
      for (const m of msgs.slice(-10)) {
        const preview = m.content.slice(0, 70).replace(/\n/g, " ");
        const roleColor = m.role === "user" ? colors.cyan(m.role) : m.role === "assistant" ? colors.green(m.role) : colors.yellow(m.role);
        console.log(`    ${colors.dim("·")} ${roleColor.padEnd(9)} ${colors.dim(preview)}`);
      }
      return "continue";
    }
    case "/quit":
    case "/exit":
      return "quit";
    case "/help":
      console.log(HELP);
      return "continue";
    default:
      console.log(`  未知命令: ${colors.yellow(cmd)}（/help 查看帮助）`);
      return "continue";
  }
}
