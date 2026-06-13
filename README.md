# agent-me v2.1 — 通用个人 AI Agent

全栈 AI 助手，支持多厂商 LLM、智能记忆、文件分析、自动工具调用、Web/CLI 双端，所有数据本地存储。

## 快速开始

### Windows (PowerShell)

```powershell
# 右键 → "使用 PowerShell 运行"
start.ps1          # 后台启动后端 + 前端，~3s 就绪，无窗口
stop.ps1           # 关闭所有服务
```

### macOS / Linux (bash)

**启动（两个终端窗口）**

终端 1 — 后端：
```bash
cd backend
uvicorn main:app --port 8000
```

终端 2 — 前端：
```bash
cd frontend
npm run dev
```

**关闭**
```bash
pkill -f "uvicorn main:app"    # 关闭后端
pkill -f "npm run dev"          # 关闭前端
```

### 开始使用

1. **Web 端**：浏览器打开 http://localhost:3000 → 设置 → 配 API Key → 开始
2. **CLI 端**（先启动后端）：
   ```bash
   cd cli && pip install -e .    # 仅首次（macOS/Linux）
   cd cli; pip install -e .      # 仅首次（PowerShell）
   agent-me chat                  # 交互式，启动时可选模型
   agent-me ask "问题"             # 一次性问答，-m deepseek 跳过选择
   ```

**依赖安装**（仅首次）：

**Windows (PowerShell)**
```powershell
cd backend; pip install -r requirements.txt    # Python 依赖
cd frontend; npm install                        # 前端依赖
```

**macOS / Linux (bash)**
```bash
cd backend && pip install -r requirements.txt    # Python 依赖
cd frontend && npm install                        # 前端依赖
```

## 界面预览

**Web 端**

![Web 界面](docs/screenshot-web.png)

**CLI 端**

![CLI 界面](docs/screenshot-cli.png)

## 功能清单

| 功能 | 说明 |
|------|------|
| **多轮对话** | SSE 流式输出 + Markdown 渲染 + 代码高亮，Ctrl+C 取消 |
| **自动 Agent 模式** | 无需手动切换，根据消息内容自动判断是否需要调用工具 |
| **8 个内置工具** | 联网搜索、读取文件、列出目录、执行命令、搜索记忆、搜索文件、浏览器控制、获取时间 |
| **18 种技能模式** | plan_first / product_mindset / ship_first / minimal_deps / oop / functional / claude_code_style / cursor_style / pair_programming / caveman / diagnose / grill / prototype / tdd / architecture / triage / zoom_out / security |
| **多厂商 LLM** | OpenAI / Anthropic / Google / DeepSeek / Kimi (月之暗面) / MiniMax / 智谱 GLM / 字节豆包 / 自定义 —— 9 家 |
| **智能记忆 v2.0** | 短期(会话缓存 50 轮) + 长期(ChromaDB 向量检索+重要性评分+时间衰减) + 结构化用户画像(自动事实提取) |
| **会话摘要** | 每 20 轮自动生成一句话摘要，替代逐条存储，大幅减少 token |
| **文件分析** | PDF / DOCX / TXT 上传解析 → 切片 → RAG 检索 |
| **写作助手** | 润色 / 扩写 / 缩写 / 英译中 / 中译英 / 正式语气 / 随意语气 / 列大纲 / 写邮件 / 周报 —— 10 种模板 |
| **任务管理** | 待办看板 + 截止日期 + 完成状态 |
| **联网搜索** | DuckDuckGo (免费) / Tavily / Brave / SerpAPI / Serper / SearXNG / 自定义 |
| **命令执行** | 三级安全审批（自动放行 / 确认 / 禁止），含高危模式检测和多段命令拦截 |
| **浏览器控制** | Kimi WebBridge 集成，支持页面导航、点击、截图、JS 执行 |
| **对话导出** | Markdown / JSON |
| **深色模式** | 自动适配系统偏好 / 手动切换 |
| **日志查看** | Web 端 /api/logs 实时查看，滚动存储（5MB × 3） |
| **Token 节省** | 对话历史截断(20条/32K字符) + Anthropic prompt caching(缓存命中降费90%) |

## 浏览器控制

浏览器控制功能基于 **Kimi WebBridge**，使用前需要安装并启动该服务：

1. **安装 Kimi WebBridge**：参考 [Kimi WebBridge 官方仓库](https://github.com/kimi-webbridge/kimi-webbridge) 获取安装包
2. **启动服务**：运行 `kimi-webbridge start`（默认监听 `127.0.0.1:10086`）
3. **自定义路径**（可选）：如果 Kimi WebBridge 安装在非标准位置，设置环境变量
   ```powershell
   # Windows
   $env:AGENT_ME_WEBBRIDGE_PATH = "C:\Path\To\kimi-webbridge.exe"
   ```
   ```bash
   # macOS / Linux
   export AGENT_ME_WEBBRIDGE_PATH=/usr/local/bin/kimi-webbridge
   ```

> **安全提示**：浏览器控制会操作用户已登录的网页。如果浏览器已登录银行、邮箱等敏感账户，请谨慎使用。

## 自动 Agent 模式

agent-me v2.1 引入了**自动判断模式**，无需手动切换：

- 你说 **"帮我写一段 Python 代码"** → 普通模式，直接生成
- 你说 **"搜索 Python 异步编程最佳实践"** → 自动调用 `web_search` 工具
- 你说 **"查看当前目录有哪些文件"** → 自动调用 `list_directory` 工具
- 你说 **"读取 backend/main.py 并解释"** → 自动调用 `read_file` 工具
- 你说 **"打开浏览器访问 github.com"** → 自动调用 `browser_navigate` 工具

### 触发关键词

| 类别 | 关键词示例 |
|------|-----------|
| 搜索 | 搜索、查一下、查查、google、百度、查找、查询 |
| 文件 | 读取文件、打开文件、查看文件、cat、查看目录、列出文件、ls、dir |
| 命令 | 执行、运行、git status、git diff、npm、pip、python |
| 浏览器 | 打开网页、浏览器、截图、访问网站、navigate |
| 记忆 | 搜索记忆、回忆、之前说过、长期记忆 |
| 通用 | 帮我查看、帮我找、帮我搜、帮我运行、帮我执行 |

### 8 个内置工具

| 工具 | 功能 | 安全限制 |
|------|------|----------|
| `get_current_time` | 获取当前日期时间 | 无 |
| `web_search` | 联网搜索（超时 15s） | 无 |
| `read_file` | 读取本地文件 | 限制 100KB，支持分页 |
| `list_directory` | 列出目录内容 | 最大递归深度 3 |
| `run_command` | 执行终端命令 | 只执行 always_allow 级别命令 |
| `search_memory` | 检索长期记忆 | 无 |
| `search_files` | 检索上传文件 | 无 |
| `browser_navigate` | 浏览器控制 | 超时 15s |

## 智能记忆系统 v2.0

### 三层架构

| 层级 | 存储 | 容量 | 机制 |
|------|------|------|------|
| **短期记忆** | 内存 deque | 50 轮/会话 | 会话结束自动清除 |
| **长期记忆** | ChromaDB 向量 | 无上限 | 重要性评分 + 时间衰减 |
| **用户画像** | JSON 文件 | 持久 | 自动事实提取 |

### 自动事实提取

每 10 轮对话自动调用 LLM 提取结构化事实：

```json
[{"fact": "用户喜欢 Python", "category": "技能偏好", "importance": 8}]
```

自动分类存入画像：
- **身份** → `profile.name` + `profile.facts`
- **技能偏好** → `profile.skills`
- **工作习惯** → `profile.habits`
- **个人喜好** → `profile.preferences`

### 重要性评分

每条记忆存入前由 LLM 打分（1-10）：
- ≥5 分：存入长期记忆
- ≥7 分：同时存入用户画像
- <5 分：不存入

### 时间衰减

检索时计算综合分数：`relevance × importance × decay`

- 衰减公式：`decay = exp(-days_old / 30)`
- 30 天半衰期：30 天前的记忆权重降为 50%
- 支持手动清理：`POST /api/memory/cleanup`

### 会话摘要

每 20 轮对话自动生成一句话摘要，替代逐条消息存储：

```
"用户让我帮他优化 CLI，我修改了 main.py 添加了斜杠命令"
```

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Python 3.10 + FastAPI + LiteLLM + ChromaDB + SQLite |
| 前端 | React 18 + Zustand + TailwindCSS + Vite |
| CLI | Click + Rich + HTTPX |
| 加密 | cryptography (Fernet)，密钥与数据分离存储，5 秒内存缓存 |
| 嵌入 | sentence-transformers (all-MiniLM-L6-v2) |

## 项目结构

```
agent-me/
├── start.ps1                 # 一键后台启动 (v2.1)
├── stop.ps1                  # 一键关闭 (v2.1)
├── backend/
│   ├── main.py               # FastAPI 入口
│   ├── app_config/           # providers / settings / encryption / logging / search_providers
│   ├── routes/               # chat / config / files / memory / tasks / writing / skills / commands / search / export / browser / agent
│   ├── services/             # llm / memory / db / agent_loop / command / search / file / webbridge
│   ├── models/               # chat / config / commands / tasks / writing
│   └── storage/              # SQLite + ChromaDB + 加密配置 + 上传文件 + 日志
├── frontend/                 # React SPA (Vite + TailwindCSS)
│   └── src/
│       ├── components/       # chat / layout / settings / tasks / writing / commands / memory / ui
│       ├── hooks/            # useChat / useConfig / useMemory
│       ├── utils/api.js      # 前端 API 封装
│       └── store.js          # Zustand 全局状态
├── cli/
│   └── agent_me/main.py      # CLI 入口 (agent-me 命令) v2.1
└── README.md
```

## API Key 申请

| 提供商 | 地址 | Agent 工具支持 |
|---|---|---|
| OpenAI | https://platform.openai.com/api-keys | ✅ 支持 |
| Anthropic | https://console.anthropic.com/settings/keys | ✅ 支持 |
| Google | https://aistudio.google.com/app/apikey | ✅ 支持 |
| DeepSeek | https://platform.deepseek.com/api_keys | ✅ 支持 |
| Kimi | https://platform.moonshot.cn/console/api-keys | ✅ 支持 |
| MiniMax | https://platform.minimaxi.com/user-center/basic-information/interface-key | ❌ 不支持 |
| GLM | https://open.bigmodel.cn/usercenter/apikeys | ✅ 支持 |
| 豆包 | https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey | ✅ 支持 |
| 自定义 | - | ✅ 默认支持 |

> 不支持 function calling 的模型（如 MiniMax）会自动 fallback 为普通模式。

## CLI 命令参考

```bash
# === 核心命令 ===
agent-me chat              # 交互式聊天（启动时选模型，支持斜杠命令）
agent-me ask "问题"         # 一次性问答，-m 模型 -f 文件 -s 技能 --search

# === 模型与配置 ===
agent-me models            # 查看可用模型
agent-me config list       # 查看提供商配置
agent-me config set <id> -k <key> --default   # 配置 API Key
agent-me config test <id>  # 测试连接

# === 对话管理 ===
agent-me conversations     # 列出所有对话
agent-me export [id]       # 导出对话 (Markdown)

# === 搜索与记忆 ===
agent-me search "查询"      # 联网搜索
agent-me memory "关键词"    # 搜索长期记忆

# === 其他 ===
agent-me tasks             # 查看任务列表
agent-me status            # 查看后端状态
agent-me logs -n 50        # 查看后端日志
```

### CLI 聊天斜杠命令

在 `agent-me chat` 交互模式下输入：

| 命令 | 功能 |
|------|------|
| `/new [标题]` | 新建对话 |
| `/list` | 列出所有对话 |
| `/switch <ID>` | 切换到指定对话 |
| `/model [名称]` | 查看或切换模型 |
| `/skill [名称]` | 查看或切换技能模式 |
| `/search [查询]` | 临时联网搜索 |
| `/file <路径>` | 上传文件到当前对话 |
| `/clear` | 清空当前对话 |
| `/history` | 显示对话历史 |
| `/info` | 显示当前会话信息 |
| `/export [ID]` | 导出为 Markdown |
| `/help` | 显示帮助 |
| `/quit` | 退出 |

## 系统提示词

每次对话的系统提示词由以下部分组成（按顺序拼接）：

1. **基础角色**："你是 agent-me，一个智能个人助手。用中文交流，语气温暖、专业。"
2. **核心原则**："真相优先、不编造、先理解再回答、范围控制、明确边界。"
3. **回复规范**：回答简洁直接、不添加前言/结语、不使用 emoji、代码修改后只做简要说明
4. **用户画像**：名称 + 偏好 + 技能 + 习惯 + 事实（从设置页配置，自动提取）
5. **联网搜索结果**（开启搜索时）
6. **文件RAG片段**（上传文件时）
7. **技能模式附加提示词**（选择技能时）

### 18 种技能模式

| 技能 | 说明 |
|------|------|
| plan_first | 先设计架构再编码，按职责拆分模块 |
| product_mindset | 主动思考用户需求，关注完整产品体验 |
| ship_first | 先跑通再优化，首轮交付MVP |
| minimal_deps | 减少外部依赖，保持简单够用 |
| oop_style | 面向对象、模块化优先 |
| functional_style | 函数式、渐进式 |
| claude_code_style | 简洁直接，4行以内，最小化token |
| cursor_style | 代码修改只显示变更，遵循schema |
| pair_programming | 结对协作，关键决策点提供建议 |
| caveman | 只输出核心结论，不要任何解释 |
| diagnose | 系统化排查：复现→缩小→假设→验证→修复→回归 |
| grill_me | 持续追问直到理清决策树所有分支 |
| prototype | 快速搭建最小可运行原型 |
| tdd | 红→绿→重构循环 |
| architecture | 审查代码架构，找耦合点和改善机会 |
| triage | 按优先级分类问题，给出严重程度和处理顺序 |
| zoom_out | 跳出细节，给出高层上下文 |
| security | 检查注入、认证、存储、敏感信息暴露，给CVSS评分 |

## Token 节省机制

- **对话历史截断**：每轮最多保留 20 条消息，总字符预算 32000（约 8k tokens），超出时从旧消息丢弃
- **会话摘要**：每 20 轮自动生成摘要，替代逐条存储
- **Prompt Caching**：使用 Anthropic Claude 模型时，自动在最后一条用户消息添加 `cache_control`，后续轮次命中缓存可降低约 90% token 费用
- **系统提示词精简**：去除冗余固定指令，保留必要信息

## 隐私

- API Key 用 Fernet 加密存储于 `backend/storage/config.enc`，密钥分离存储
- 对话记录和记忆仅保存在本地 SQLite + ChromaDB
- 不上传任何数据到第三方服务器
- 联网搜索仅在用户触发时执行

## 更新日志

### v2.1 (2025-06-13)

- **Agent 自动判断**：根据消息内容自动决定是否调用工具，无需手动切换
- **工具扩展**：从 3 个工具扩展到 8 个（新增 read_file、list_directory、run_command、browser_navigate、get_current_time）
- **智能记忆 v2.0**：自动事实提取、会话摘要、重要性评分、时间衰减
- **结构化画像**：用户画像扩展为 name + preferences + skills + habits + facts
- **新增技能**：claude_code_style、cursor_style、pair_programming
- **CLI v2.1**：代码库感知、斜杠命令扩展、新命令（search、memory、tasks、status、logs）
- **前端优化**：Agent 模式视觉反馈、工具调用可折叠卡片、模型支持检测
- **安全增强**：CORS 限制、异常信息脱敏、命令执行精确化、文件魔数验证
