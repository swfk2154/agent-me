/**
 * Config & utility commands: models, providers, config list/set/test,
 * stats, memory.
 */
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import type { Runtime } from "../runtime.ts";
import { providerById, providerIds, saveConfig, BUILTIN_PROVIDERS } from "../core/config.ts";

export async function cmdModels(runtime: Runtime): Promise<void> {
  const active = runtime.config.activeProvider;
  const activeModel = runtime.config.activeModel;
  for (const p of BUILTIN_PROVIDERS) {
    const mark = p.id === active ? "*" : " ";
    const models = (p.isCustom ? (runtime.config.customModels ?? []) : p.models).join(", ") || "(未配置)";
    console.log(`${mark} ${p.id.padEnd(10)} ${p.name}  —  ${models}`);
  }
  console.log(`\n当前激活: ${active} / ${activeModel || "(默认)"}`);
}

export async function cmdProviders(runtime: Runtime): Promise<void> {
  for (const id of providerIds()) {
    const p = providerById(id, runtime.config);
    if (!p) continue;
    const key = await runtime.secrets.get(`key:${id}`);
    const status = key ? "已配置 Key" : "未配置 Key";
    const active = runtime.config.activeProvider === id ? " ← 激活" : "";
    console.log(`${id.padEnd(12)} ${status.padEnd(12)} ${p.baseUrl}${active}`);
  }
}

export async function cmdConfigList(runtime: Runtime): Promise<void> {
  const cfg = runtime.config;
  console.log(`activeProvider: ${cfg.activeProvider}`);
  console.log(`activeModel:    ${cfg.activeModel || "(默认)"}`);
  console.log(`maxWindowTokens: ${cfg.maxWindowTokens} (缓存感知上下文窗口)`);
  console.log(`cacheEnabled:   ${cfg.cacheEnabled}`);
  console.log(`temperature:    ${cfg.temperature}`);
  console.log(`searchProvider: ${cfg.searchProvider}`);
}

export async function cmdConfigSet(runtime: Runtime, providerId: string): Promise<void> {
  const p = providerById(providerId, runtime.config);
  if (!p) {
    console.error(`未知 provider: ${providerId}（可用: ${providerIds().join(", ")}）`);
    return;
  }
  const rl = createInterface({ input, output, terminal: true });
  // Read with a simple hidden-input mode (raw mode, no echo).
  process.stdout.write(`请输入 ${p.name} 的 API Key（输入将隐藏）:\n`);
  const key = await readHidden(rl);
  if (key.trim()) {
    await runtime.secrets.set(`key:${providerId}`, key.trim());
    console.log(`✅ ${p.name} API Key 已保存（AES-256-GCM 加密存储）`);
    if (!runtime.config.activeProvider) {
      runtime.config.activeProvider = providerId;
      await saveConfig(runtime.paths, runtime.config);
    }
  } else {
    console.log("已取消（空输入）");
  }
  rl.close();
}

async function readHidden(rl: ReturnType<typeof createInterface>): Promise<string> {
  return new Promise((resolve) => {
    const isRaw = (process.stdin as { isRaw?: boolean }).isRaw;
    process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    let buf = "";
    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n") {
          process.stdin.setRawMode?.(isRaw ?? false);
          process.stdin.pause();
          process.stdin.off("data", onData);
          process.stdout.write("\n");
          resolve(buf);
          return;
        }
        if (ch === "\u0003") {
          process.stdin.setRawMode?.(isRaw ?? false);
          process.stdin.pause();
          process.stdin.off("data", onData);
          process.stdout.write("\n");
          resolve("");
          return;
        }
        if (ch === "\u007f" || ch === "\b") {
          buf = buf.slice(0, -1);
        } else {
          buf += ch;
        }
      }
    };
    process.stdin.on("data", onData);
    void rl; // readline interface unused for raw input; kept for signature parity
  });
}

export async function cmdConfigTest(runtime: Runtime, providerId: string): Promise<void> {
  const p = providerById(providerId, runtime.config);
  if (!p) {
    console.error(`未知 provider: ${providerId}`);
    return;
  }
  const key = await runtime.secrets.get(`key:${providerId}`);
  if (!key) {
    console.error(`未配置 ${p.name} 的 API Key，先运行: agent-me config set ${providerId}`);
    return;
  }
  console.log(`测试 ${p.name} (${p.baseUrl}) ...`);
  try {
    const { createProvider } = await import("../core/llm/index.ts");
    const provider = createProvider({ provider: p, apiKey: key });
    const model = p.models[0] ?? "default";
    const res = await provider.complete({
      model,
      messages: [{ role: "user", content: "ping，请只回复 pong" }],
      maxTokens: 16,
      cacheEnabled: false,
    });
    console.log(`✅ 连接成功 (${res.message.content?.slice(0, 60) || "ok"})`);
  } catch (err) {
    console.error(`❌ 连接失败: ${(err as Error).message}`);
  }
}

export async function cmdConfigProvider(runtime: Runtime, providerId: string): Promise<void> {
  const p = providerById(providerId, runtime.config);
  if (!p) {
    console.error(`未知 provider: ${providerId}（可用: ${providerIds().join(", ")}）`);
    return;
  }
  runtime.config.activeProvider = providerId;
  await saveConfig(runtime.paths, runtime.config);
  console.log(`✅ 已切换激活 provider: ${p.name}`);
}

export async function cmdConfigModel(runtime: Runtime, model: string): Promise<void> {
  runtime.config.activeModel = model;
  await saveConfig(runtime.paths, runtime.config);
  console.log(`✅ 已设置模型: ${model}`);
}

export async function cmdStats(runtime: Runtime): Promise<void> {
  const s = runtime.store.cacheSummary();
  const memories = runtime.store.listMemories(1000).length;
  const convs = runtime.store.listConversations(1000).length;
  console.log(`缓存命中率（全部对话）:`);
  console.log(`  请求数:      ${s.requests}`);
  console.log(`  prompt tokens: ${s.promptTokens}`);
  console.log(`  缓存命中:    ${s.cachedTokens} tok`);
  console.log(`  命中率:      ${(s.hitRate * 100).toFixed(1)}%`);
  console.log(`对话数: ${convs} · 记忆条目: ${memories}`);
}

export async function cmdMemory(runtime: Runtime, sub: string, args: string[]): Promise<void> {
  switch (sub) {
    case "search": {
      const q = args.join(" ");
      if (!q) {
        console.error("用法: agent-me memory search <关键词>");
        return;
      }
      const hits = await runtime.memory.search(q, 5);
      if (hits.length === 0) console.log("(无匹配)");
      for (const h of hits) {
        console.log(`[${h.category}] (${h.importance}/10) ${h.createdAt.toISOString().slice(0, 10)}\n  ${h.content}`);
      }
      return;
    }
    case "add": {
      const content = args.join(" ");
      if (!content) {
        console.error("用法: agent-me memory add <内容>");
        return;
      }
      const id = await runtime.memory.add({ content, category: "manual", importance: 6 });
      console.log(`✅ 已保存记忆 #${id}`);
      return;
    }
    case "list": {
      const all = await runtime.memory.all(50);
      if (all.length === 0) console.log("(空)");
      for (const m of all) {
        console.log(`#${m.id} [${m.category}] (${m.importance}/10) ${m.content.slice(0, 100)}`);
      }
      return;
    }
    default:
      console.error("用法: agent-me memory search|add|list ...");
  }
}
