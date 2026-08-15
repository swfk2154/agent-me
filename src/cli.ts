#!/usr/bin/env node
/**
 * agent-me v3 — CLI entry point.
 *
 * Usage:
 *   agent-me chat                        interactive chat
 *   agent-me ask "问题" [-f file] [--output-format text|json|stream-json]
 *   agent-me serve [--port 8080]         Web mode
 *   agent-me models | providers
 *   agent-me config list|set|test|provider|model
 *   agent-me stats | memory search|add|list
 *   agent-me version | help
 *
 * Global flags: --sandbox read-only|workspace-write|danger-full-access
 *               --approval untrusted|on-request|never
 *               --workspace <dir>   --model <name>  --provider <id>
 */
import { parseArgs, type CliFlags } from "./cli/args.ts";
import { runChat } from "./cli/chat.ts";
import { runHeadless } from "./cli/headless.ts";
import {
  cmdModels,
  cmdProviders,
  cmdConfigList,
  cmdConfigSet,
  cmdConfigTest,
  cmdConfigProvider,
  cmdConfigModel,
  cmdStats,
  cmdMemory,
} from "./cli/commands.ts";
import { Runtime } from "./runtime.ts";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { SecurityConfig } from "./core/tools/shell.ts";

const VERSION = "3.0.0";

const HELP = `agent-me v3 — 通用个人 AI Agent（Web + CLI）

用法:
  agent-me chat                       交互式聊天（推荐）
  agent-me ask "问题" [-f 文件...]     一次性提问
  agent-me serve [--port 8080]        Web 模式（内嵌前端）
  agent-me models                     列出所有 provider 与模型
  agent-me providers                  查看 provider 与 Key 状态
  agent-me config list                查看当前配置
  agent-me config set <provider>      设置 API Key（隐藏输入，加密存储）
  agent-me config test <provider>     测试连接
  agent-me config provider <id>       切换激活 provider
  agent-me config model <名称>        设置模型
  agent-me stats                      缓存命中率统计
  agent-me memory search|add|list     长期记忆
  agent-me version                    版本信息

全局选项:
  --sandbox read-only|workspace-write|danger-full-access
  --approval untrusted|on-request|never
  --workspace <目录>   工作区根目录（文件工具的作用域）
  --model <名称>        临时指定模型
  --provider <id>       临时指定 provider
  -f, --file <路径>     ask 模式附带文件
  --output-format text|json|stream-json   ask 输出格式
  -h, --help            帮助
  -v, --version         版本
`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  let flags: CliFlags;
  try {
    flags = parseArgs(argv);
  } catch (err) {
    console.error(`❌ ${(err as Error).message}`);
    console.error("用 agent-me --help 查看用法");
    process.exit(2);
  }

  if (flags.version) {
    console.log(`agent-me v${VERSION}`);
    return;
  }
  if (flags.help || flags.positionals.length === 0) {
    console.log(HELP);
    return;
  }

  const cmd = flags.positionals[0]!;
  const args = flags.positionals.slice(1);
  const security: SecurityConfig = { sandbox: flags.sandbox, approval: flags.approval };

  switch (cmd) {
    case "version":
      console.log(`agent-me v${VERSION}`);
      return;
    case "help":
      console.log(HELP);
      return;
    case "chat": {
      const runtime = await Runtime.create({ cwd: flags.cwd, workspaceRoot: flags.workspace, security });
      await runChat(runtime, { model: flags.model, provider: flags.provider });
      return;
    }
    case "ask": {
      const prompt = flags.prompt ?? args.join(" ");
      if (!prompt) {
        console.error("❌ 缺少问题。用法: agent-me ask \"你的问题\"");
        process.exitCode = 2;
        return;
      }
      const runtime = await Runtime.create({ cwd: flags.cwd, workspaceRoot: flags.workspace, security });
      const code = await runHeadless(runtime, {
        prompt,
        files: flags.files,
        outputFormat: flags.outputFormat,
        conversationId: flags.conversationId,
      });
      process.exitCode = code;
      return;
    }
    case "serve": {
      const runtime = await Runtime.create({ cwd: flags.cwd, workspaceRoot: flags.workspace, security });
      const { startServer } = await import("./server.ts");
      await startServer(runtime, { port: flags.port ?? 8080 });
      return;
    }
    case "models":
    case "providers": {
      const runtime = await Runtime.create({ security });
      if (cmd === "models") await cmdModels(runtime);
      else await cmdProviders(runtime);
      return;
    }
    case "config": {
      const runtime = await Runtime.create({ security });
      const sub = args[0] ?? "list";
      switch (sub) {
        case "list":
          await cmdConfigList(runtime);
          return;
        case "set": {
          const id = args[1];
          if (!id) {
            console.error("用法: agent-me config set <provider>");
            process.exit(2);
          }
          await cmdConfigSet(runtime, id);
          return;
        }
        case "test": {
          const id = args[1] ?? runtime.config.activeProvider;
          await cmdConfigTest(runtime, id);
          return;
        }
        case "provider": {
          const id = args[1];
          if (!id) {
            console.error("用法: agent-me config provider <id>");
            process.exit(2);
          }
          await cmdConfigProvider(runtime, id);
          return;
        }
        case "model": {
          const model = args[1];
          if (!model) {
            console.error("用法: agent-me config model <名称>");
            process.exit(2);
          }
          await cmdConfigModel(runtime, model);
          return;
        }
        default:
          console.error(`未知 config 子命令: ${sub}`);
          process.exit(2);
      }
      return;
    }
    case "stats": {
      const runtime = await Runtime.create({ security });
      await cmdStats(runtime);
      return;
    }
    case "memory": {
      const runtime = await Runtime.create({ security });
      await cmdMemory(runtime, args[0] ?? "", args.slice(1));
      return;
    }
    case "-p":
    case "--prompt": {
      const runtime = await Runtime.create({ security });
      const code = await runHeadless(runtime, { prompt: flags.prompt ?? "", files: flags.files, outputFormat: flags.outputFormat });
      process.exitCode = code;
      return;
    }
    default:
      console.error(`未知命令: ${cmd}\n用 agent-me --help 查看用法`);
      process.exit(2);
  }
}

// Read version from package.json without importing it (keeps tsx-free runtime).
async function readVersion(): Promise<string> {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(await readFile(path.join(here, "..", "package.json"), "utf8")) as { version?: string };
    return pkg.version ?? VERSION;
  } catch {
    return VERSION;
  }
}

main().catch((err) => {
  console.error(`❌ 致命错误: ${err instanceof Error ? err.stack ?? err.message : String(err)}`);
  process.exit(1);
});
