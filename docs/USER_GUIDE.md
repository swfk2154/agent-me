# agent-me v3 用户指南 / User Guide

> 中英双语 · Bilingual (中文 / English)

---

## 1. 简介 / Introduction

**中文**：agent-me v3 是一个运行在本机的通用个人 AI Agent，提供 **CLI 与 Web 双模式**。它基于 DeepSeek 等多家大模型，支持联网搜索、文件操作、命令执行、长期记忆，并通过**缓存感知上下文管理**自动优化 prompt-cache 命中率、降低 API 成本。

**English**: agent-me v3 is a universal personal AI agent that runs locally with **both CLI and Web modes**. Built on DeepSeek and other LLM providers, it supports web search, file operations, command execution, long-term memory, and optimizes **prompt-cache hit rate** automatically through cache-aware context management.

> **截图 / Screenshots**
> CLI 模式 | Web 模式
> :---: | :---:
> ![CLI](screenshots/cli.png) | ![Web](screenshots/web.png)

---

## 2. 快速开始 / Quick Start

### 2.1 环境要求 / Requirements

| 项 Item | 要求 Requirement |
|---------|-----------------|
| Node.js | ≥ 24（原生运行 TypeScript，零编译 / runs TS natively, no build step） |

### 2.2 首次准备 / First-time Setup

```powershell
cd D:\32550\Documents\Agent\claude\agent-me
npm install            # 安装依赖（Web 前端构建需要）
```

**API Key 三种来源（三选一）** / **Three ways to provide an API key (pick one)**：

| 方式 Method | 操作 Action |
|------------|-------------|
| ① 环境变量（推荐 / recommended） | 设置 `DEEPSEEK_API_KEY`（或 `OPENAI_API_KEY` 等），agent-me 自动检测复用 |
| ② 加密存储 / Encrypted store | `node src/cli.ts config set deepseek`，隐藏输入，AES-256-GCM 加密保存 |
| ③ 注册表回退（Windows）/ Registry fallback | 用户级环境变量自动读取，从任何环境启动都能用 |

```powershell
node src/cli.ts config test deepseek    # 验证连接 / verify connection
node src/cli.ts providers               # 查看各提供商 Key 状态 / check key status
```

---

## 3. CLI 模式 / CLI Mode

### 3.1 启动 / Launch

```powershell
node src/cli.ts chat
```

启动后显示横幅与提示（见 `docs/screenshots/cli.png`）：

```
╔═══════════════════════════════════════════╗
║  agent-me v3  ·  通用个人 AI Agent CLI    ║
║  deepseek / deepseek-v4-flash             ║
╚═══════════════════════════════════════════╝
/help 查看命令 · Ctrl+C 中断生成 · Ctrl+C 再次退出
```

### 3.2 界面元素 / UI Elements

| 元素 Element | 说明 Description |
|-------------|-----------------|
| 横幅 Banner | 显示版本、provider 与模型 |
| 灰色文字 Gray text | **思考过程**（reasoning），流式实时显示 |
| `⚙️` 图标 | 工具调用（如联网搜索、读文件） |
| `[in N tok · cache 命中 X%]` | 每次请求的 token 用量与缓存命中率（≥70% 绿 / ≥30% 黄 / 其余红） |

### 3.3 斜杠命令 / Slash Commands

| 命令 Command | 功能 Function |
|--------------|---------------|
| `/new [标题]` | 新对话 / New conversation |
| `/model [名称]` | 查看或切换模型 / View or switch model |
| `/provider [id]` | 查看或切换提供商 / View or switch provider |
| `/stats` | 缓存命中率统计 / Cache hit-rate stats |
| `/history` | 显示最近消息 / Show recent messages |
| `/quit` | 退出 / Quit |
| `/help` | 帮助 / Help |

### 3.4 一次性提问（可接脚本）/ One-shot (script-friendly)

```powershell
node src/cli.ts ask "搜索一下 TypeScript 的性能"              # 文本输出 / text
node src/cli.ts ask "现在几点了？" --output-format json        # JSON 输出
node src/cli.ts ask "列出当前目录" --output-format stream-json # 事件流 / event stream
node src/cli.ts ask "…" -f README.md                          # 附带文件 / attach file
```

---

## 4. Web 模式 / Web Mode

### 4.1 启动 / Launch

```powershell
npm run build:web        # 首次构建前端（后续无需重复）/ build frontend once
node src/cli.ts serve    # 打开浏览器访问 http://127.0.0.1:8080
```

> 也可双击 `script\start-web.bat`（自动构建并启动）。

### 4.2 界面布局 / Layout（见 `docs/screenshots/web.png`）

**左侧边栏 / Left sidebar**
- `＋ 新对话` 按钮
- 对话历史列表（点击切换 / 可删除）
- **缓存统计面板**：命中率、请求数、命中 tokens（≥70% 绿色高亮）

**中间聊天区 / Chat area**
- 顶部显示当前 `provider/model` 标签
- 消息气泡：用户（你）与 AI（A）
- **思考过程折叠块**（黄色边框，点击展开）
- **工具调用卡片**（⚙ 工具名 / 参数 / 结果，失败红色）
- 流式回复 + `▊` 光标
- 底部输入框：Enter 发送，Shift+Enter 换行，运行时按钮变「■ 停止」

**右侧设置面板 / Settings drawer**（⚙ 设置打开）
- Provider 下拉选择
- 模型输入（带模型列表提示）
- 搜索后端：DuckDuckGo / Bing（免费）或 Tavily / Brave（需 Key）
- 上下文窗口（tokens）：默认 32000
- 缓存感知压缩开关

### 4.3 API（供集成）/ REST API

| 端点 Endpoint | 方法 Method | 说明 Description |
|---------------|-------------|-----------------|
| `/api/health` | GET | 健康检查 / health check |
| `/api/chat` | POST | SSE 流式对话（`delta`/`thinking`/`tool_call`/`tool_result`/`usage`/`done`） |
| `/api/config` | GET/PUT | 读取/更新配置 / read/update config |
| `/api/stats` | GET | 缓存命中率统计 / cache stats |
| `/api/conversations` | GET/DELETE | 对话列表 / 删除 / list/delete conversations |
| `/api/answer` | POST | 回答 agent 的 ask_user 问题 |

---

## 5. 缓存命中率 / Cache Hit Rate

**中文**：agent-me 通过四项机制提升 prompt-cache 命中率（见截图左下角 `74.9%` 示例）：

1. **稳定前缀**：system prompt 与工具 schema 字节级不变，服务器前缀缓存持续命中；
2. **追加式日志**：历史消息只增不改，前缀永不失效；
3. **摘要压缩**：上下文超窗时，最旧对话被冻结的摘要替换，截断点之后不变；
4. **显式断点**（Anthropic）：按 token 间隔打 `cache_control`，长对话增量命中。

命中率查看：CLI `/stats`、Web 左侧面板、`node src/cli.ts stats`、`ask --output-format json` 的 `cache` 字段。

**English**: Four mechanisms drive the hit rate (e.g. `74.9%` in the screenshot):

1. **Stable prefix** — byte-identical system prompt & tool schema keep server-side prefix caches hot;
2. **Append-only log** — history is never rewritten, so the prefix never breaks;
3. **Summary compaction** — when the window overflows, the oldest messages are replaced by a frozen summary; everything after the trim point stays untouched;
4. **Explicit breakpoints** (Anthropic) — `cache_control` at token intervals for incremental hits on long conversations.

View hit rate: CLI `/stats`, Web left panel, `node src/cli.ts stats`, or the `cache` field of `ask --output-format json`.

---

## 6. 安全模型 / Security Model

| 参数 Flag | 取值 Values | 说明 Description |
|-----------|-------------|-----------------|
| `--sandbox` | `read-only` / `workspace-write` / `danger-full-access` | 沙箱档位：能碰哪里 / where the agent may touch |
| `--approval` | `untrusted` / `on-request` / `never` | 审批策略：何时询问 / when it asks |

默认 `workspace-write` + `on-request`：工作区内可写，其余命令逐条确认。危险命令（递归删除、格式化等）任何档位都拒绝。API Key 加密存储，Key 文件与密文分离。

Default is `workspace-write` + `on-request`: writable inside the workspace, everything else asks per action. Destructive commands are always refused. API keys are AES-256-GCM encrypted, key file separated from ciphertext.

---

## 7. 常用命令 / Command Reference

```powershell
node src/cli.ts chat                     # 交互聊天 / interactive chat
node src/cli.ts ask "问题" [--output-format json|stream-json] [-f 文件]
node src/cli.ts serve [--port 8080]      # Web 模式 / web mode
node src/cli.ts models                   # 所有提供商与模型 / list providers & models
node src/cli.ts providers                # Key 配置状态 / key status
node src/cli.ts config list|set|test|provider|model
node src/cli.ts stats                    # 缓存命中率统计 / cache stats
node src/cli.ts memory search|add|list   # 长期记忆 / long-term memory
node src/cli.ts --help                   # 全部命令 / all commands
```

---

## 8. 常见问题 / FAQ

**Q: Web 提示「端口 8080 已被占用」/ port in use?**
A: 可能已有 agent-me 在运行（直接打开 http://127.0.0.1:8080），或换端口 `--port 8081`。

**Q: 提示未配置 API Key / no API key?**
A: 设置 `DEEPSEEK_API_KEY` 环境变量，或运行 `node src/cli.ts config set deepseek`。Windows 用户级环境变量会被自动检测。

**Q: CLI 里没有颜色 / no colors in CLI?**
A: 终端需支持 ANSI 颜色（Windows Terminal / VS Code 终端均可）；管道输出自动禁用颜色。

**Q: 怎么加新工具 / how to add a tool?**
A: 在 `src/core/tools/` 新建文件并 `registry.register({ name, description, parameters, handler })` 一次调用即可。

**Q: 数据存在哪里 / where is data stored?**
A: `~/.agent-me/`（可用 `AGENT_ME_HOME` 覆盖）：config.json、secrets.enc（加密 Key）、agent-me.db（对话/记忆）。
