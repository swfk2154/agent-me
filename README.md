# agent-me v3 — 通用个人 AI Agent

TypeScript 重写的高性能个人 AI Agent：**Web + CLI 双模式**、**缓存感知上下文管理**（prompt-cache 命中率优化）、多 LLM 提供商、工具调用、长期记忆、沙箱化命令执行。单进程部署，核心零运行时依赖（Node ≥ 24 原生 TypeScript + `node:sqlite`）。

## 设计哲学

设计参考了主流 agent 架构（[deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) / [grok-build](https://github.com/xai-org/grok-build)），并对标业界 agent 的设计差异分析（[六大 AI 编程智能体的本质差异](https://blogbu2154.site/ai-coding-agents-compare/)）：

| 维度 | agent-me v3 的选择 |
|------|-------------------|
| 设计哲学 | 克制的 agent loop（Codex 减法）+ 按需扩展的技能/工具（Claude 加法） |
| 安全哲学 | **两层模型**：沙箱档位（`read-only` / `workspace-write` / `danger-full-access`）× 审批策略（`untrusted` / `on-request` / `never`），风险前置、默认最小权限 |
| 记忆持久化 | 仓库内 `AGENTS.md`（事实标准）+ 本地 SQLite 长期记忆 + 用户配置记忆 |
| 自动化 | Headless 模式 `ask -p "…" --output-format json\|stream-json`，可直接接入 CI |
| 架构 | 单一 TS 代码库，`core`（LLM/上下文/agent/工具/存储）被 CLI 与 Web 共享 |

## 缓存命中率优化（核心特性）

Prompt caching 是 LLM 成本与延迟的关键。agent-me v3 把"缓存友好"做进上下文管理器（`src/core/context/manager.ts`）：

1. **稳定前缀**：system prompt 与工具 schema 字节级稳定（工具按名排序、序列化不变）；动态信息（时间等）永不进入 system，而是作为普通消息追加。
2. **追加式消息日志**：历史消息只追加、绝不重写或重排，保证服务器端自动前缀缓存（DeepSeek / OpenAI）持续命中。
3. **缓存感知压缩**：窗口超限时，最旧的对话被**单条摘要消息**替换（摘要冻结后不再变），截断点之后的消息原样保留——每次请求的前缀恒定：
   `[system] [tools] [summary] [recent messages…]`
4. **显式断点**（Anthropic）：按 token 间隔在消息上打 `cache_control: ephemeral`，长对话获得增量缓存命中。
5. **命中率可观测**：每次请求读取 `prompt_cache_hit_tokens` / `cache_read_input_tokens`，CLI `/stats`、Web 统计面板、headless JSON 均可查看。

## 快速开始

### 环境

- Node.js ≥ 24（原生运行 TypeScript，无需编译；内置 `node:sqlite`）
- npm（可选，仅构建 Web 前端时需要）

### CLI 模式

```bash
npm install              # 仅需一次（Web 构建依赖）
node src/cli.ts chat     # 交互式聊天（彩色界面）
```

配置模型提供商：

```bash
node src/cli.ts config list              # 查看配置
node src/cli.ts config set deepseek      # 输入 API Key（隐藏输入、加密存储）
node src/cli.ts config test deepseek     # 测试连接
node src/cli.ts models                   # 列出所有提供商与模型
```

一次性提问 / CI：

```bash
node src/cli.ts ask "搜索一下 TypeScript 的性能" --output-format json
node src/cli.ts ask "现在几点了？" --output-format stream-json   # 事件流
```

### Web 模式

```bash
npm run build:web        # 构建前端（web/dist）
node src/cli.ts serve    # 打开 http://127.0.0.1:8080
```

Web 界面包含：流式回复、思考过程折叠显示、工具调用卡片（参数/结果）、缓存命中率面板、对话历史、设置（提供商/模型/搜索后端）。

### 安全选项

```bash
node src/cli.ts chat --sandbox read-only              # 只读沙箱
node src/cli.ts chat --sandbox workspace-write        # 默认：仅工作区可写
node src/cli.ts chat --approval never                 # 不询问（YOLO，危险命令仍拒绝）
```

| 沙箱档位 | 能碰哪里 |
|---------|---------|
| `read-only` | 文件系统只读，仅允许只读命令 |
| `workspace-write` | 工作区内读写（默认） |
| `danger-full-access` | 不限制文件系统 |

## 内置工具

| 工具 | 说明 |
|------|------|
| `web_search` | 联网搜索：DuckDuckGo / Bing（免费）→ Tavily / Brave（可选 Key），自动回退 |
| `fetch_url` | 读取网页正文（Jina Reader，免费无 Key） |
| `get_current_time` | 当前日期时间 |
| `read_file` / `write_file` / `list_directory` / `grep_files` | 工作区文件操作（路径越界防护） |
| `run_command` | shell 命令执行（沙箱 + 审批 + 危险命令拒绝 + 超时） |
| `search_memory` / `add_memory` | 长期记忆（关键词评分 + 30 天半衰期衰减） |
| `ask_user` | 向用户提问（CLI stdin / Web SSE 挂起） |

新增工具 = 一个 `register()` 调用（`src/core/tools/`）。

## 架构

```
src/
├── cli.ts                 # CLI 入口（chat / ask / serve / config / stats / memory）
├── server.ts              # Web 入口（hono + SSE + 静态前端托管）
├── runtime.ts             # CLI 与 Web 共享的组装层（wiring）
└── core/
    ├── config.ts          # 配置 + AES-256-GCM 密钥加密
    ├── llm/               # LLM 抽象：OpenAI 兼容 + Anthropic（缓存头/thinking）
    ├── context/           # ★ 缓存感知上下文管理 + token 估算
    ├── agent/             # agent 主循环（工具调用、熔断、中断）
    ├── tools/             # 工具注册表 + 实现（含安全模型）
    ├── store/             # SQLite（node:sqlite，零依赖）
    ├── memory/            # 长期记忆
    └── prompts/           # system prompt（AGENTS.md 注入）
web/                       # React + Vite 前端（构建后由 server 托管）
tests/                     # mock LLM + 端到端测试
```

## 开发

```bash
npm run typecheck     # tsc --noEmit
npm test              # node --test tests/（内置 mock LLM server，无需真实 Key）
npm run dev:web       # Vite dev server（代理 /api → 8080）
npm run build:web     # 构建前端
```

## 数据与隐私

- 数据目录：`~/.agent-me/`（可用 `AGENT_ME_HOME` 覆盖）
- API Key：AES-256-GCM 加密存储（`keyfile.key` 与 `secrets.enc` 分离）
- 对话/记忆：本地 SQLite，不离开你的机器

## Changelog

### v3.0.0（2026-08）

- TypeScript 全量重写（原 v2.2 Python/React 移至 `legacy/`）
- 缓存感知上下文管理（稳定前缀 / 追加式日志 / 摘要压缩 / 显式断点 / 命中率统计）
- 安全两层模型（沙箱 × 审批）
- Web + CLI 双模式共享 core
- reasoning/thinking 流解析（DeepSeek / OpenAI / Anthropic）
- 联网搜索多后端 + fetch_url 读网页
- Headless JSON / stream-json 输出
- 内置 mock LLM 的端到端测试
