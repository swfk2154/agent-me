/**
 * Runtime assembly — shared by CLI and Web modes.
 *
 * Wiring: config → store → memory → tools(security) → provider → agent.
 */
import { randomUUID } from "node:crypto";
import type { Paths, Config, Provider } from "./core/config.ts";
import { loadConfig, defaultPaths, providerById, SecretBox, resolveModel, apiKeyFromEnv, baseUrlFromEnv, envVarNames } from "./core/config.ts";
import { Store } from "./core/store/db.ts";
import { MemoryStore } from "./core/memory/store.ts";
import { ToolRegistry, registerBuiltinTools } from "./core/tools/registry.ts";
import type { SecurityConfig } from "./core/tools/shell.ts";
import { DEFAULT_SECURITY } from "./core/tools/shell.ts";
import { createProvider } from "./core/llm/index.ts";
import { ContextManager } from "./core/context/manager.ts";
import { Agent } from "./core/agent/loop.ts";
import { loadSystemPrompt } from "./core/prompts/system.ts";

export interface RuntimeOptions {
  cwd?: string;
  security?: SecurityConfig;
  workspaceRoot?: string;
  paths?: Paths;
}

export class Runtime {
  readonly paths: Paths;
  readonly config: Config;
  readonly store: Store;
  readonly memory: MemoryStore;
  readonly tools: ToolRegistry;
  readonly secrets: SecretBox;
  readonly security: SecurityConfig;
  readonly cwd: string;
  readonly workspaceRoot: string;

  private constructor(
    paths: Paths,
    config: Config,
    store: Store,
    memory: MemoryStore,
    tools: ToolRegistry,
    secrets: SecretBox,
    security: SecurityConfig,
    cwd: string,
    workspaceRoot: string,
  ) {
    this.paths = paths;
    this.config = config;
    this.store = store;
    this.memory = memory;
    this.tools = tools;
    this.secrets = secrets;
    this.security = security;
    this.cwd = cwd;
    this.workspaceRoot = workspaceRoot;
  }

  static async create(opts: RuntimeOptions = {}): Promise<Runtime> {
    const paths = opts.paths ?? (await defaultPaths());
    const config = await loadConfig(paths);
    const store = new Store(paths.db);
    const memory = new MemoryStore(store);
    const security = opts.security ?? DEFAULT_SECURITY;
    const tools = new ToolRegistry();
    registerBuiltinTools(tools, () => security);
    const secrets = new SecretBox(paths.keyFile);
    const cwd = opts.cwd ?? process.cwd();
    const workspaceRoot = opts.workspaceRoot ?? process.env.AGENT_ME_WORKSPACE ?? cwd;
    return new Runtime(paths, config, store, memory, tools, secrets, security, cwd, workspaceRoot);
  }

  /**
   * Resolve any provider's effective config + api key.
   *
   * Key resolution order: encrypted store → environment variable
   * (conventional names like DEEPSEEK_API_KEY) → none.
   * Base URL order: environment override (*_BASE_URL) → provider default.
   */
  async resolveProvider(id: string): Promise<{ provider: Provider; apiKey: string; keySource: "store" | "env" | "none" }> {
    const p = providerById(id, this.config);
    if (!p) throw new Error(`未知 provider: ${id}`);

    let apiKey = await this.secrets.get(`key:${id}`);
    let keySource: "store" | "env" | "none" = "store";
    if (!apiKey) {
      apiKey = apiKeyFromEnv(id);
      keySource = apiKey ? "env" : "none";
    }

    // Base URL: env override wins over config/provider default.
    const envBase = baseUrlFromEnv(id);
    const provider = envBase ? { ...p, baseUrl: envBase } : p;
    return { provider, apiKey: apiKey ?? "", keySource };
  }

  /** Resolve the active provider, throwing an actionable error if no key. */
  async activeProvider(): Promise<{ provider: Provider; apiKey: string; keySource: "store" | "env" | "none" }> {
    const resolved = await this.resolveProvider(this.config.activeProvider);
    if (!resolved.apiKey && resolved.provider.id !== "ollama") {
      const envNames = envVarNames(resolved.provider.id);
      const hint = envNames.length > 0 ? `，或设置环境变量 ${envNames.join(" / ")}` : "";
      throw new Error(
        `未配置 ${resolved.provider.name} 的 API Key。请运行: agent-me config set ${resolved.provider.id}${hint}` +
          (resolved.provider.apiKeyUrl ? `（或访问 ${resolved.provider.apiKeyUrl} 获取）` : ""),
      );
    }
    return resolved;
  }

  /**
   * Build a fresh ContextManager. If conversationId is given, its message
   * history is restored into the append-only log.
   */
  async newContext(conversationId?: string, opts?: { systemPrompt?: string }): Promise<ContextManager> {
    let systemPrompt = opts?.systemPrompt;
    if (!systemPrompt) {
      systemPrompt = await loadSystemPrompt({
        cwd: this.cwd,
        customPath: this.config.systemPromptPath,
        workspaceRoot: this.workspaceRoot,
      });
    }
    const cm = new ContextManager({
      systemPrompt,
      maxWindowTokens: this.config.maxWindowTokens,
      cacheBreakpointTokens: this.config.cacheBreakpointTokens,
      cacheEnabled: this.config.cacheEnabled,
    });
    cm.setTools(this.tools.defs());
    if (conversationId) {
      const rows = this.store.listMessages(conversationId, 2000);
      for (const m of this.store.toLLMMessages(rows)) cm.append(m);
    }
    return cm;
  }

  async newAgent(
    context: ContextManager,
    opts?: {
      onAsk?: (question: string) => Promise<string>;
    },
  ): Promise<Agent> {
    const { provider, apiKey } = await this.activeProvider();
    const chat = createProvider({ provider, apiKey });
    const model = resolveModel(this.config, provider);
    return new Agent({
      provider: chat,
      model,
      context,
      tools: this.tools,
      memory: this.memory,
      toolCtx: {
        cwd: this.workspaceRoot,
        paths: this.paths,
        config: this.config,
        security: this.security,
        ask: opts?.onAsk,
      },
      onAsk: opts?.onAsk,
      temperature: this.config.temperature,
      maxOutputTokens: this.config.maxOutputTokens,
    });
  }

  /** Create a conversation row if it does not exist. */
  ensureConversation(conversationId: string, title?: string): void {
    const existing = this.store.listConversations(1000).find((c) => c.id === conversationId);
    if (!existing) this.store.createConversation(conversationId, title ?? "新对话");
  }

  newConversationId(): string {
    return randomUUID();
  }
}
