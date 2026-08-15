/**
 * System prompt assembly.
 *
 * CACHE-FRIENDLINESS: the system prompt must be byte-identical across every
 * request of a session. Dynamic data (current time, cwd, …) NEVER goes here —
 * it is provided through tool results or user messages instead, so the
 * system prefix always hits the prompt cache.
 *
 * AGENTS.md (the de-facto standard from the "memory file war" — see
 * https://blogbu2154.site/ai-coding-agents-compare/): if present in the
 * workspace root it is appended as project-level instructions.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

const BASE_SYSTEM_PROMPT = `你是 agent-me，一个运行在本机的通用个人 AI 助手。

## 能力
- 你可以调用工具来：查看时间、搜索网页、读写工作区文件、在目录中搜索代码、
  执行 shell 命令、检索长期记忆、以及向用户提问。
- 需要外部信息或执行操作时，主动调用工具；能直接回答的问题直接回答。
- 工具结果要如实使用；工具失败时如实说明，不要编造结果。

## 工作方式
- 复杂任务先拆解：明确目标 → 规划步骤 → 逐步执行 → 检查结果。
- 修改文件前先读取相关文件，理解上下文后再动手。
- 执行有副作用的操作（写文件、装依赖、git 提交等）时，如果用户没有明确要求，
  先说明你的计划。
- 回答保持简洁、准确、可执行；中文回答默认使用中文。

## 约束
- 只能在允许的沙箱范围内读写文件、执行命令（安全策略由运行参数决定）。
- 不要泄露 API Key 等敏感信息。`;

const AGENTS_MD = "AGENTS.md";

/** Load the base system prompt, optionally extending with AGENTS.md. */
export async function loadSystemPrompt(opts: {
  cwd: string;
  customPath?: string;
  workspaceRoot?: string;
}): Promise<string> {
  let prompt = BASE_SYSTEM_PROMPT;
  const parts: string[] = [prompt];

  // 1. Custom system prompt file (highest priority, replaces base).
  if (opts.customPath) {
    try {
      const custom = await readFile(path.resolve(opts.cwd, opts.customPath), "utf8");
      return custom.trim();
    } catch (err) {
      console.warn(`[system] cannot read custom prompt ${opts.customPath}: ${(err as Error).message}`);
    }
  }

  // 2. AGENTS.md from the workspace root.
  const root = opts.workspaceRoot ?? opts.cwd;
  const agentsMd = path.join(root, AGENTS_MD);
  try {
    const md = await readFile(agentsMd, "utf8");
    parts.push(`## 项目指令（来自 ${AGENTS_MD}）\n${md.trim()}`);
  } catch {
    // no AGENTS.md — fine
  }

  return parts.join("\n\n");
}
