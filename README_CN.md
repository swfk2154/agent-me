# agent-me v3 — 通用个人 AI Agent

TypeScript 重写的高性能个人 AI Agent：**Web + CLI 双模式**、**缓存感知上下文管理**（prompt-cache 命中率优化）、多 LLM 提供商、工具调用、长期记忆、沙箱化命令执行。单进程部署，核心零运行时依赖（Node ≥ 24 原生 TypeScript + `node:sqlite`）。

> 🌐 English version: [README.md](README.md)

---

## 界面预览

| CLI 模式 | Web 模式 |
|:---:|:---:|
| ![CLI](docs/screenshots/cli.png) | ![Web](docs/screenshots/web.png) |

---

## 特性

| 特性 | 说明 |
|------|------|
| **双模式** | CLI（彩色交互界面）+ Web（浏览器界面 + SSE 流式），共享同一 core |
| **缓存命中率优化** | 稳定前缀 / 追加式日志 / 摘要压缩 / 显式断点，自动提升 prompt-cache 命中率（见下文） |
| **多 LLM 提供商** | OpenAI / Anthropic / DeepSeek / Kimi / GLM / 豆包 / MiniMax / Google / Ollama / 自定义 |
| **环境变量自动复用** | 检测 `DEEPSEEK_API_KEY` 等惯例变量，Windows 注册表回退，零配置开箱即用 |
| **工具调用** | 联网搜索（免费后端 + 自动回退）、读网页、文件读写、代码搜索、命令执行、长期记忆、向用户提问 |
| **思考过程显示** | DeepSeek / OpenAI / Anthropic 的 reasoning/thinking 流实时展示（CLI 灰色文字 / Web 折叠块） |
| **安全两层模型** | 沙箱档位（read-only / workspace-write / danger-full-access）× 审批策略（untrusted / on-request / never） |
| **长期记忆** | 关键词检索 + 时间衰减，`AGENTS.md` 项目指令注入 |
| **Headless 模式** | `ask --output-format json\|stream-json`，可直接接入脚本与 CI |
| **密钥加密** | API Key 以 AES-256-GCM 加密存储，Key 文件与密文分离 |

---

## 安装说明（从克隆到运行）

### 1. 环境要求

| 依赖 | 版本 | 说明 |
|------|------|------|
| [Node.js](https://nodejs.org) | ≥ 24 | 原生运行 TypeScript（无需编译）、内置 SQLite、内置 fetch/SSE |
| git | 任意 | 克隆仓库 |

> 验证：`node --version` 应输出 v24 及以上。

### 2. 克隆仓库

```bash
git clone https://github.com/swfk2154/agent-me.git
cd agent-me
```

### 3. 安装依赖

```bash
npm install
```

> 中国网络环境：npm 已默认使用国内镜像（registry.npmmirror.com）；如未配置可执行
> `npm config set registry https://registry.npmmirror.com`。

### 4. 配置 API Key（任选一种）

**方式 A — 环境变量（推荐）**：在系统设置或当前终端中设置：

```powershell
# Windows (当前会话)
$env:DEEPSEEK_API_KEY = "sk-你的key"
# 永久设置
setx DEEPSEEK_API_KEY "sk-你的key"
```

```bash
# macOS / Linux
export DEEPSEEK_API_KEY="sk-你的key"   # 建议写入 ~/.bashrc 或 ~/.zshrc
```

**方式 B — 加密存储**：运行 `node src/cli.ts config set deepseek`，按提示隐藏输入。

**方式 C — Windows 注册表回退**：用户级环境变量会被自动检测，从任何环境启动都可用。

验证配置：

```bash
node src/cli.ts providers          # 查看各提供商 Key 状态（环境变量/加密存储/未配置）
node src/cli.ts config test deepseek   # 真实调用测试连接
```

### 5. 启动 CLI 模式

```bash
node src/cli.ts chat
```

或双击 `script\start-cli.bat`（Windows）。

### 6. 启动 Web 模式

```bash
npm run build:web          # 首次构建前端（之后无需重复）
node src/cli.ts serve      # 浏览器打开 http://127.0.0.1:8080
```

或双击 `script\start-web.bat`（Windows，自动构建并启动）。

### 7. 常见启动问题

| 问题 | 解决 |
|------|------|
| `EADDRINUSE 端口 8080 被占用` | 可能已有 agent-me 在运行，直接打开 http://127.0.0.1:8080；或换端口 `node src/cli.ts serve --port 8081` |
| `未配置 API Key` | 设置环境变量或 `node src/cli.ts config set <provider>` |

### 8. 更新

```bash
git pull
npm install
npm run build:web    # 前端有变更时
```

---

## CLI 使用

```bash
node src/cli.ts chat        # 交互式聊天（斜杠命令见下）
node src/cli.ts ask "问题" [--output-format text|json|stream-json] [-f 文件] [--conversation-id ID]
node src/cli.ts serve [--port 8080]
node src/cli.ts models      # 所有提供商与模型
node src/cli.ts providers   # Key 状态
node src/cli.ts config list|set|test|provider|model
node src/cli.ts stats       # 缓存命中率统计
node src/cli.ts memory search|add|list
node src/cli.ts --help
```

**斜杠命令**：`/new` 新对话 · `/model` 切换模型 · `/provider` 切换提供商 · `/stats` 缓存统计 · `/history` 最近消息 · `/help` · `/quit`

**界面元素**：灰色文字 = 思考过程；`⚙️` = 工具调用；`[in N tok · cache 命中 X%]` = 每次请求的缓存命中率（≥70% 绿 / ≥30% 黄 / 其余红）。

**安全选项**：

```bash
node src/cli.ts chat --sandbox read-only              # 只读
node src/cli.ts chat --sandbox workspace-write        # 默认
node src/cli.ts chat --approval never                 # 不询问（危险命令仍拒绝）
```

---

## Web 使用

启动后浏览器访问 http://127.0.0.1:8080：

- **左侧**：新对话、历史列表、**缓存命中率面板**（命中率 / 请求数 / 命中 tokens，≥70% 绿色高亮）
- **中间**：流式对话（`▊` 光标）、思考过程折叠块（黄色边框）、工具调用卡片（⚙ 参数/结果，失败红色）、■ 停止按钮
- **右侧设置**（⚙）：Provider / 模型 / 搜索后端（DuckDuckGo·Bing 免费，Tavily·Brave 需 Key）/ 上下文窗口 / 缓存压缩开关

**REST API**：`GET /api/health` · `POST /api/chat`（SSE 流：delta/thinking/tool_call/tool_result/usage/done/ask）· `GET/PUT /api/config` · `GET /api/stats` · `GET/DELETE /api/conversations[/:id]` · `POST /api/answer`

---

## 缓存命中率优化（核心特性）

Prompt caching 是 LLM 成本与延迟的关键。agent-me 把"缓存友好"做进上下文管理器（`src/core/context/manager.ts`）：

1. **稳定前缀**：system prompt 与工具 schema 字节级稳定（工具按名排序）；动态信息（时间等）永不进入 system；
2. **追加式消息日志**：历史消息只追加、绝不重写或重排，服务器端自动前缀缓存（DeepSeek/OpenAI）持续命中；
3. **缓存感知压缩**：窗口超限时最旧对话被**单条冻结摘要**替换，截断点之后原样保留——每次请求前缀恒定：`[system] [tools] [summary] [recent…]`；
4. **显式断点**（Anthropic）：按 token 间隔打 `cache_control: ephemeral`，长对话增量命中；
5. **命中率可观测**：CLI `/stats`、Web 面板、headless JSON 均可查看。

---

## 环境变量

| Provider | API Key 变量 | Base URL 覆盖 |
|----------|-------------|---------------|
| OpenAI | `OPENAI_API_KEY` | `OPENAI_BASE_URL` |
| Anthropic | `ANTHROPIC_API_KEY` | `ANTHROPIC_BASE_URL` |
| DeepSeek | `DEEPSEEK_API_KEY` | `DEEPSEEK_BASE_URL` |
| Kimi | `MOONSHOT_API_KEY` / `KIMI_API_KEY` | `MOONSHOT_BASE_URL` |
| Google | `GEMINI_API_KEY` / `GOOGLE_API_KEY` | `GEMINI_BASE_URL` |
| GLM | `GLM_API_KEY` / `ZHIPU_API_KEY` | `GLM_BASE_URL` |
| 豆包 | `DOUBAO_API_KEY` / `ARK_API_KEY` | `DOUBAO_BASE_URL` |
| MiniMax | `MINIMAX_API_KEY` | `MINIMAX_BASE_URL` |
| 自定义 | `AGENT_ME_API_KEY` | `AGENT_ME_BASE_URL` |

---

## 安全模型

| 参数 | 取值 | 说明 |
|------|------|------|
| `--sandbox` | `read-only` / `workspace-write` / `danger-full-access` | 沙箱档位：能碰哪里 |
| `--approval` | `untrusted` / `on-request` / `never` | 审批策略：何时询问 |

默认 `workspace-write` + `on-request`。危险命令（递归删除、格式化、系统修改等）任何档位都拒绝。文件工具限制在工作区根目录内（符号链接越界防护）。

---

## 项目结构

```
src/
├── cli.ts                 # CLI 入口（chat / ask / serve / config / stats / memory）
├── server.ts              # Web 入口（hono + SSE + 静态前端托管）
├── runtime.ts             # CLI 与 Web 共享组装层
└── core/
    ├── config.ts          # 配置 + 密钥加密 + 环境变量检测
    ├── llm/               # OpenAI 兼容 + Anthropic（缓存头/thinking）
    ├── context/           # ★ 缓存感知上下文管理
    ├── agent/             # agent 主循环（工具调用、熔断、中断）
    ├── tools/             # 工具注册表 + 实现（含安全模型）
    ├── store/             # SQLite（node:sqlite 零依赖）
    ├── memory/            # 长期记忆
    └── prompts/           # system prompt（AGENTS.md 注入）
web/                       # React + Vite 前端（构建后由 server 托管）
script/                    # Windows 双击启动脚本
tests/                     # mock LLM + 端到端测试
legacy/                    # v2.2 旧版（Python + React）
```

## 开发

```bash
npm run typecheck     # 类型检查
npm test              # 端到端测试（内置 mock LLM，无需真实 Key）
npm run dev:web       # Vite 开发服务器（代理 /api → 8080）
npm run build:web     # 构建前端
```

## 数据与隐私

- 数据目录：`~/.agent-me/`（`AGENT_ME_HOME` 可覆盖）
- API Key：AES-256-GCM 加密，Key 文件与密文分离
- 对话/记忆：本地 SQLite，不离开你的机器

## FAQ

**Q: 支持哪些模型？** 所有 OpenAI 兼容 API（DeepSeek/Kimi/GLM/豆包/MiniMax/Google/Ollama/自定义中转）+ Anthropic 原生。`node src/cli.ts models` 查看。

**Q: 怎么加新工具？** 在 `src/core/tools/` 新建文件，`registry.register({ name, description, parameters, handler })` 一次调用。

**Q: 缓存命中率低怎么办？** 检查是否每次会话都在改 system prompt（不要手动注入动态内容）；长对话会自动摘要压缩；`/stats` 看趋势。

**Q: 旧版 v2.2 呢？** 已移至 `legacy/`，git 历史完整保留。

## Changelog

### v3.0.0（2026-08）

- TypeScript 全量重写（原 Python/React 版移至 legacy/）
- 缓存感知上下文管理（稳定前缀 / 追加式日志 / 摘要压缩 / 显式断点 / 命中率统计）
- 安全两层模型（沙箱 × 审批）
- Web + CLI 双模式共享 core
- reasoning/thinking 流解析（DeepSeek / OpenAI / Anthropic）
- 联网搜索多后端 + fetch_url 读网页
- 环境变量自动检测（含 Windows 注册表回退）
- Headless JSON / stream-json 输出
- 内置 mock LLM 的端到端测试
