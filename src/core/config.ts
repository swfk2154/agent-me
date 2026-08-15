/**
 * Core configuration: data directories, provider definitions, encrypted
 * API key storage (AES-256-GCM, key file separate from ciphertext).
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

// ---------------------------------------------------------------------------
// Data directories
// ---------------------------------------------------------------------------

export function homeDir(): string {
  const v = process.env.AGENT_ME_HOME;
  if (v) return v;
  return path.join(homedir(), ".agent-me");
}

export interface Paths {
  root: string;
  config: string;
  secrets: string;
  keyFile: string;
  db: string;
  logs: string;
  skillsDir: string;
  webDist: string;
}

export async function defaultPaths(): Promise<Paths> {
  const root = homeDir();
  const p: Paths = {
    root,
    config: path.join(root, "config.json"),
    secrets: path.join(root, "secrets.enc"),
    keyFile: path.join(root, "keyfile.key"),
    db: path.join(root, "agent-me.db"),
    logs: path.join(root, "logs"),
    skillsDir: path.join(root, "skills"),
    webDist: path.join(process.cwd(), "web", "dist"),
  };
  await mkdir(p.logs, { recursive: true, mode: 0o700 });
  await mkdir(p.skillsDir, { recursive: true, mode: 0o700 });
  return p;
}

// ---------------------------------------------------------------------------
// Provider definitions (migrated & extended from agent-me v2.2)
// ---------------------------------------------------------------------------

export interface Provider {
  id: string;
  name: string;
  baseUrl: string;
  apiKeyUrl?: string;
  models: string[];
  /** "openai" (OpenAI-compatible REST/SSE) or "anthropic" (native Messages API) */
  apiStyle: "openai" | "anthropic";
  supportsTools: boolean;
  supportsCache: boolean;
  /** "explicit" (Anthropic cache_control) | "automatic" (DeepSeek/OpenAI prefix cache) */
  cacheStyle: "explicit" | "automatic" | "none";
  isCustom?: boolean;
  defaultModel?: string;
}

export const BUILTIN_PROVIDERS: Provider[] = [
  { id: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1",
    apiKeyUrl: "https://platform.openai.com/api-keys",
    models: ["gpt-5.5", "gpt-5.5-pro", "gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano"],
    apiStyle: "openai", supportsTools: true, supportsCache: true, cacheStyle: "automatic", defaultModel: "gpt-5.5" },
  { id: "anthropic", name: "Anthropic", baseUrl: "https://api.anthropic.com",
    apiKeyUrl: "https://console.anthropic.com/settings/keys",
    models: ["claude-opus-4.8", "claude-sonnet-4.6", "claude-haiku-4.5"],
    apiStyle: "anthropic", supportsTools: true, supportsCache: true, cacheStyle: "explicit", defaultModel: "claude-sonnet-4.6" },
  { id: "google", name: "Google Gemini", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    apiKeyUrl: "https://aistudio.google.com/app/apikey",
    models: ["gemini-3.1-pro", "gemini-3.5-flash"],
    apiStyle: "openai", supportsTools: true, supportsCache: true, cacheStyle: "automatic", defaultModel: "gemini-3.5-flash" },
  { id: "deepseek", name: "DeepSeek", baseUrl: "https://api.deepseek.com/v1",
    apiKeyUrl: "https://platform.deepseek.com/api_keys",
    models: ["deepseek-v4-pro", "deepseek-v4-flash", "deepseek-chat", "deepseek-reasoner"],
    apiStyle: "openai", supportsTools: true, supportsCache: true, cacheStyle: "automatic", defaultModel: "deepseek-v4-flash" },
  { id: "kimi", name: "Kimi (月之暗面)", baseUrl: "https://api.moonshot.cn/v1",
    apiKeyUrl: "https://platform.moonshot.cn/console/api-keys",
    models: ["kimi-k2.6", "kimi-k2.5", "moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"],
    apiStyle: "openai", supportsTools: true, supportsCache: true, cacheStyle: "automatic", defaultModel: "kimi-k2.6" },
  { id: "minimax", name: "MiniMax", baseUrl: "https://api.minimax.chat/v1",
    apiKeyUrl: "https://platform.minimaxi.com/user-center/basic-information/interface-key",
    models: ["MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2.5", "MiniMax-M2.1", "MiniMax-M2"],
    apiStyle: "openai", supportsTools: false, supportsCache: true, cacheStyle: "automatic", defaultModel: "MiniMax-M3" },
  { id: "glm", name: "智谱 GLM (Z.ai)", baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    apiKeyUrl: "https://open.bigmodel.cn/usercenter/apikeys",
    models: ["glm-5.1", "glm-5", "glm-4.7", "glm-4.7-flash"],
    apiStyle: "openai", supportsTools: true, supportsCache: true, cacheStyle: "automatic", defaultModel: "glm-5.1" },
  { id: "doubao", name: "字节豆包 (Doubao)", baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    apiKeyUrl: "https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey",
    models: ["doubao-seed-2.0-pro", "doubao-seed-2.0-mini"],
    apiStyle: "openai", supportsTools: true, supportsCache: true, cacheStyle: "automatic", defaultModel: "doubao-seed-2.0-pro" },
  { id: "ollama", name: "Ollama (本地)", baseUrl: "http://localhost:11434/v1",
    models: ["llama3.3", "qwen3", "deepseek-r1"],
    apiStyle: "openai", supportsTools: true, supportsCache: false, cacheStyle: "none", defaultModel: "qwen3" },
  { id: "custom", name: "自定义 (OpenAI 兼容)", baseUrl: "",
    models: [],
    apiStyle: "openai", supportsTools: true, supportsCache: true, cacheStyle: "automatic", isCustom: true, defaultModel: "" },
];

export function providerById(id: string, cfg?: Config): Provider | undefined {
  const p = BUILTIN_PROVIDERS.find((x) => x.id === id);
  if (!p) return undefined;
  if (p.isCustom && cfg) {
    return { ...p, baseUrl: cfg.customBaseUrl ?? "", models: cfg.customModels ?? [] };
  }
  return p;
}

export function providerIds(): string[] {
  return BUILTIN_PROVIDERS.map((p) => p.id).sort();
}

/** Effective model name: explicit config wins, else provider default. */
export function resolveModel(cfg: Config, p: Provider): string {
  if (cfg.activeModel) return cfg.activeModel;
  if (p.defaultModel) return p.defaultModel;
  return p.models[0] ?? "";
}

// ---------------------------------------------------------------------------
// Environment-variable discovery (industry conventions)
// ---------------------------------------------------------------------------

interface EnvMapping {
  /** Env var names tried in order for the API key. */
  keys: string[];
  /** Optional env vars that override the provider's base URL. */
  baseUrls?: string[];
}

/**
 * Mapping from provider id to conventional environment variables.
 * This lets agent-me reuse keys already present on the host (e.g. from
 * OpenAI / Claude Code / other tools) with zero configuration.
 */
export const ENV_KEY_MAPPINGS: Record<string, EnvMapping> = {
  openai: { keys: ["OPENAI_API_KEY"], baseUrls: ["OPENAI_BASE_URL"] },
  anthropic: { keys: ["ANTHROPIC_API_KEY"], baseUrls: ["ANTHROPIC_BASE_URL"] },
  google: { keys: ["GEMINI_API_KEY", "GOOGLE_API_KEY"], baseUrls: ["GEMINI_BASE_URL", "GOOGLE_GENERATIVE_AI_BASE_URL"] },
  deepseek: { keys: ["DEEPSEEK_API_KEY"], baseUrls: ["DEEPSEEK_BASE_URL"] },
  kimi: { keys: ["MOONSHOT_API_KEY", "KIMI_API_KEY"], baseUrls: ["MOONSHOT_BASE_URL"] },
  minimax: { keys: ["MINIMAX_API_KEY"], baseUrls: ["MINIMAX_BASE_URL"] },
  glm: { keys: ["GLM_API_KEY", "ZHIPU_API_KEY"], baseUrls: ["GLM_BASE_URL"] },
  doubao: { keys: ["DOUBAO_API_KEY", "ARK_API_KEY"], baseUrls: ["DOUBAO_BASE_URL"] },
  ollama: { keys: [] },
  custom: { keys: ["AGENT_ME_API_KEY", "CUSTOM_API_KEY"], baseUrls: ["AGENT_ME_BASE_URL"] },
};

/** Find an API key in the environment for a provider id (first match wins). */
export function apiKeyFromEnv(providerId: string): string | undefined {
  const mapping = ENV_KEY_MAPPINGS[providerId];
  if (!mapping) return undefined;
  for (const name of mapping.keys) {
    const v = process.env[name];
    if (v && v.trim()) return v.trim();
    // Windows fallback: the process may be launched from a sandboxed/limited
    // environment (e.g. an agent harness) that does not inherit the user's
    // registry environment variables. Read the user-level registry env
    // directly so the key is still discovered. Cached per variable.
    const reg = readUserEnvWindows(name);
    if (reg) return reg;
  }
  return undefined;
}

// Cache of HKCU\Environment values read once per variable name.
const registryEnvCache = new Map<string, string | undefined>();

/** Read a user-level environment variable from the Windows registry. */
function readUserEnvWindows(name: string): string | undefined {
  if (process.platform !== "win32") return undefined;
  if (registryEnvCache.has(name)) return registryEnvCache.get(name);
  let value: string | undefined;
  try {
    const out = execFileSync("reg", ["query", "HKCU\\Environment", "/v", name], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 3000,
      stdio: ["ignore", "pipe", "ignore"],
    });
    const m = /REG_\w+\s+(.+)$/m.exec(out);
    value = m?.[1]?.trim() ?? undefined;
  } catch {
    value = undefined;
  }
  registryEnvCache.set(name, value);
  return value;
}

/** Find a base-URL override in the environment for a provider id. */
export function baseUrlFromEnv(providerId: string): string | undefined {
  const mapping = ENV_KEY_MAPPINGS[providerId];
  if (!mapping?.baseUrls) return undefined;
  for (const name of mapping.baseUrls) {
    const v = process.env[name];
    if (v && v.trim()) return v.trim();
  }
  return undefined;
}

/** All env var names that can provide a key, for help text. */
export function envVarNames(providerId: string): string[] {
  return ENV_KEY_MAPPINGS[providerId]?.keys ?? [];
}

// ---------------------------------------------------------------------------
// User config
// ---------------------------------------------------------------------------

export interface Config {
  activeProvider: string;
  activeModel: string;
  /** Cache-aware context window (approx tokens) kept per request. */
  maxWindowTokens: number;
  maxOutputTokens: number;
  temperature: number;
  cacheEnabled: boolean;
  /** Prompt-cache breakpoint granularity in approx tokens (explicit-cache providers). */
  cacheBreakpointTokens: number;
  searchProvider: string;
  /** API key for the search provider (Tavily / Brave); DuckDuckGo needs none. */
  searchAPIKey?: string;
  systemPromptPath?: string;
  customBaseUrl?: string;
  customModels?: string[];
}

export function defaultConfig(): Config {
  return {
    activeProvider: "deepseek",
    activeModel: "deepseek-v4-flash",
    maxWindowTokens: 32000,
    maxOutputTokens: 4096,
    temperature: 0.7,
    cacheEnabled: true,
    cacheBreakpointTokens: 2048,
    searchProvider: "duckduckgo",
  };
}

export async function loadConfig(paths: Paths): Promise<Config> {
  const cfg = defaultConfig();
  try {
    const raw = await readFile(paths.config, "utf8");
    const parsed = JSON.parse(raw) as Partial<Config>;
    Object.assign(cfg, parsed);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[config] cannot read ${paths.config}: ${(err as Error).message}`);
    }
  }
  return cfg;
}

export async function saveConfig(paths: Paths, cfg: Config): Promise<void> {
  const tmp = paths.config + ".tmp";
  await writeFile(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  await rename(tmp, paths.config);
}

// ---------------------------------------------------------------------------
// Encrypted secret storage (AES-256-GCM)
// ---------------------------------------------------------------------------

function encryptString(key: Buffer, plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}

function decryptString(key: Buffer, data: string): string {
  const buf = Buffer.from(data, "base64");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

async function loadOrCreateKey(keyFile: string): Promise<Buffer> {
  try {
    return await readFile(keyFile);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    const key = randomBytes(32);
    await writeFile(keyFile, key, { mode: 0o600 });
    return key;
  }
}

/**
 * SecretBox stores provider API keys encrypted with AES-256-GCM.
 * The 256-bit key lives in keyfile.key (0600), ciphertext in secrets.enc.
 */
export class SecretBox {
  private keyFile: string;
  private keyP: Promise<Buffer>;

  constructor(keyFile: string) {
    this.keyFile = keyFile;
    this.keyP = loadOrCreateKey(keyFile);
  }

  private file(): string {
    return path.join(path.dirname(this.keyFile), "secrets.enc");
  }

  private async load(): Promise<Record<string, string>> {
    try {
      const raw = await readFile(this.file(), "utf8");
      return JSON.parse(raw) as Record<string, string>;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw err;
    }
  }

  private async persist(map: Record<string, string>): Promise<void> {
    const f = this.file();
    const tmp = f + ".tmp";
    await writeFile(tmp, JSON.stringify(map), { mode: 0o600 });
    await rename(tmp, f);
  }

  async get(key: string): Promise<string | undefined> {
    const k = await this.keyP;
    const map = await this.load();
    const v = map[key];
    if (v === undefined) return undefined;
    return decryptString(k, v);
  }

  async set(key: string, value: string): Promise<void> {
    const k = await this.keyP;
    const map = await this.load();
    map[key] = encryptString(k, value);
    await this.persist(map);
  }

  async delete(key: string): Promise<void> {
    const map = await this.load();
    delete map[key];
    await this.persist(map);
  }
}
