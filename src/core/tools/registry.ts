/**
 * Tool registry: tools are registered once, exposed to the LLM as stable
 * JSON-Schema definitions, and invoked through a single call() path.
 *
 * Schema stability matters: the registry returns tools sorted by name so the
 * wire bytes never change between requests (prompt-cache friendliness).
 */
import type { ToolDef } from "../llm/types.ts";
import type { Config, Paths, SecretBox } from "../config.ts";
import type { MemoryStore } from "../memory/store.ts";
import { registerTimeTools } from "./time.ts";
import { registerFsTools } from "./filesystem.ts";
import { registerShellTool, type SecurityConfig } from "./shell.ts";
import { registerWebSearchTool } from "./websearch.ts";
import { registerFetchUrlTool } from "./fetchurl.ts";
import { registerMemoryTools } from "./memory.ts";
import { registerAskTool } from "./ask.ts";

export interface ToolContext {
  cwd: string;
  paths: Paths;
  config: Config;
  memory?: MemoryStore;
  secrets?: SecretBox;
  signal?: AbortSignal;
  security?: SecurityConfig;
  /** Interactive ask (CLI: stdin; Web: pending SSE roundtrip). */
  ask?: (question: string) => Promise<string>;
}

export interface ToolResult {
  ok: boolean;
  output: string;
  error?: string;
}

export type ToolHandler = (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;

export interface Tool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  handler: ToolHandler;
}

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(t: Tool): void {
    this.tools.set(t.name, t);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  get names(): string[] {
    return [...this.tools.keys()].sort();
  }

  /** Stable, sorted tool definitions for the LLM. */
  defs(): ToolDef[] {
    return [...this.tools.values()]
      .map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }))
      .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  }

  async call(name: string, args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { ok: false, output: "", error: `unknown tool: ${name}` };
    }
    try {
      return await tool.handler(args, ctx);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, output: "", error: `${name}: ${msg}` };
    }
  }
}

/** Register all built-in tools. Tools that depend on security config bind it lazily. */
export function registerBuiltinTools(registry: ToolRegistry, security?: () => SecurityConfig): void {
  registerTimeTools(registry);
  registerFsTools(registry);
  registerShellTool(registry, security);
  registerWebSearchTool(registry);
  registerFetchUrlTool(registry);
  registerMemoryTools(registry);
  registerAskTool(registry);
}
