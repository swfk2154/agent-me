# ADR-0001: 语言选型 — TypeScript

- 日期: 2026-07-XX
- 状态: 已接受（原选 Go，经用户确认后改为 TypeScript）

## 背景

agent-me v3 需要同时支持 Web 与 CLI 双模式、良好的流式并发性能，并针对 LLM
prompt caching 优化缓存命中率。需要选择一个实现语言。

## 市场调研（2026-07 实测 GitHub 数据）

| 项目 | Stars | 主要语言 | 定位 |
|------|-------|---------|------|
| sst/opencode | 197K | TypeScript | Coding agent（最主流） |
| anthropics/claude-code | 141K | TypeScript | Coding agent |
| openai/codex | 106K | Rust | Coding agent（性能派） |
| deepseek-ai/deepseek-harness | 101K | TypeScript | Agent 框架（插件化） |
| zed-industries/zed | 88K | Rust | 高性能编辑器 |
| All-Hands-AI/OpenHands | 84K | TypeScript | Agent 平台 |
| cline/cline | 66K | TypeScript | 编辑器内 agent |
| Aider-AI/aider | 48K | Python | CLI agent |
| xai-org/grok-build | 25K | Rust | TUI agent（单二进制） |

结论：**TypeScript 是 Agent 开发的事实标准语言**（市占与生态最广）；
Rust 是性能派代表；Go 几乎没有 agent 先例。

## 决策分析

| 维度 | TypeScript | Go | Rust |
|------|-----------|----|------|
| 市场主流/生态 | ✅ 绝对主流 | ❌ 无先例 | 性能派 |
| Agent 实际瓶颈 | LLM API 网络延迟（非 CPU） | 同左 | 同左 |
| 流式/SSE 并发 | ✅ 事件循环强项 | ✅ | ✅ |
| 通用性（SDK/MCP/三方工具） | ✅ 最丰富 | 一般 | 一般 |
| 开发/维护成本 | 低 | 低 | 高 |
| 本机工具链 | ✅ Node 24（原生跑 TS + node:sqlite） | ✅ Go 1.25 | ❌ 未装 |
| 单二进制 | 可（Node SEA / Bun compile） | ✅ | ✅ |
| 用户技术背景 | ✅ 现有前端 React/JS | 需新学 | 需新学 |

## 决策

**采用 TypeScript（Node.js 24+，ESM）**。理由：

1. **市场主流**：agent 开发的事实标准，生态（SDK、MCP、工具链）最丰富，
   满足"通用性"需求；本实现参考 deepseek-harness（同为 TS）的架构。
2. **性能足够**：agent 运行时是 I/O 密集型（HTTP 流式 + SSE + JSON + SQLite），
   瓶颈是 LLM API 延迟。Node 事件循环对 SSE 流式并发转发是强项。
3. **零编译工作流**：Node 24 原生支持 TypeScript 类型擦除（type stripping），
   `.ts` 文件直接运行；`node:sqlite` 内置 SQLite，核心零依赖。
4. **双模式**：CLI（node:readline 交互式 REPL + 子命令）与 Web（hono + SSE +
   React/Vite 前端静态托管）共享同一套 core 模块。
5. **部署**：CLI 通过 npm 全局安装 / npx 运行；如后续需要单二进制，
   可迁移到 Bun compile 或 Node SEA。

## 架构借鉴

- **deepseek-harness**（TS）：agent 循环 + 工具注册表 + compaction + 缓存感知
  上下文管理、Web host 与 CLI 双入口、mock LLM server 用于测试。
- **grok-build**（Rust）：工具/workspace/沙箱分层、composition-root 入口。

## 备选

若未来需要极致启动性能或免 Node 运行时的单二进制，可将 core 层接口保持不变，
CLI 打包迁移至 Bun（`bun build --compile`），或整体平移 Rust。
