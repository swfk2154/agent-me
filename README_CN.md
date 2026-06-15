# agent-me v2.1 — 通用个人 AI Agent

全栈 AI 助手，支持多厂商 LLM、智能记忆、文件分析、自动工具调用、Web/CLI 双端，所有数据本地存储。

## 快速开始

### 前置条件

- Python ≥ 3.10
- Node.js ≥ 18

### 1. 克隆仓库

```bash
git clone https://github.com/swfk2154/agent-me.git
cd agent-me
```

### 2. 安装与启动

项目提供三套脚本，按顺序使用即可完成安装、启动、停止。

| 脚本 | 何时用 | 做什么 |
|------|--------|--------|
| `install.bat` | **仅首次**装依赖 | 检测环境 → 装 Python 包 → 装 npm 包 → 装 CLI |
| `start.bat` | **每次用都启动** | 启动后端 (8000) + 前端 (3000)，关窗口不影响服务 |
| `stop.bat` | **用完关闭** | 停止所有服务进程 |

#### Windows 完整流程

```cmd
:: 第 1 步：安装依赖（仅首次）
install.bat                  → 轻量版（~50MB，推荐新手）
install.bat --full           → 完整版（+向量记忆+文件分析）
install.bat --mirror         → 国内镜像加速（下载慢时强烈推荐）

:: 第 2 步：启动服务
start.bat                    → 后台启动后端+前端
                             → 看到"已在后台启动"即成功
                             → 关掉窗口不影响服务

:: 第 3 步：打开浏览器
访问 http://localhost:3000

:: 第 4 步：配置 API Key
左侧"设置" → "LLM 配置" → 选提供商 → 输入 Key → 保存 → 测试 → 启用

:: 第 5 步：开始对话
回到"对话"标签 → 选好模型 → 输入消息

:: 第 6 步：用完关闭
stop.bat                     → 停止所有服务
```

> **参数说明**：`--mirror` 国内镜像加速（下载 pip/npm 包变快）、`--full` 完整版（文件分析）、`--venv` 虚拟环境。

> **为什么有 bat 和 ps1 两套？** Windows 默认禁止运行 `.ps1` 脚本（PowerShell 执行策略限制），`.bat` 双击就能运行不受策略限制。功能完全一样，选一套用即可。
>
> **PowerShell 版**（如 bat 报错时备用）：
> ```powershell
> # 先执行一次放行当前窗口：Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process
> .\install.ps1 -UseMirror
> .\start.ps1
> .\stop.ps1
> ```

#### macOS / Linux

```bash
chmod +x install.sh start.sh stop.sh
./install.sh        # 装依赖
./start.sh          # 启动
./stop.sh           # 停止
```

#### 手动安装（各平台通用）

```bash
cd backend && pip install -r requirements.txt --prefer-binary
cd ../frontend && npm install
cd ../cli && pip install -e . --prefer-binary  # CLI 可选
```

#### 常见问题

| 问题 | 原因 | 解决 |
|------|------|------|
| `pip install` 卡住/超时 | 从外网下载包慢 | 加 `--mirror` 参数 |
| `npm install` 报错"禁止运行脚本" | PowerShell 策略 | 改用 `install.bat`（CMD） |
| 启动后浏览器白屏 | 前端依赖没装 | 检查 `frontend\node_modules` 是否存在 |
| 启动后 LLM 配置页面不显示 | 后端没启动 | 检查 `stop.bat` → 重新 `start.bat` |
| 文件上传无法解析 | 需要完整版 | `pip install -r requirements-full.txt` |

### 3. 启动服务

**macOS / Linux — 一键启动（推荐）**

```bash
# 赋予执行权限（仅首次）
chmod +x start.sh stop.sh

# 后台启动后端 + 前端
./start.sh

# 关闭服务
./stop.sh
```

**手动启动（两个终端窗口）**

终端 1 — 后端：
```bash
cd backend
python3 -m uvicorn main:app --port 8000
```

终端 2 — 前端：
```bash
cd frontend
npm run dev
```

**关闭手动启动的进程**

```bash
# macOS / Linux — 按端口关闭
lsof -ti:8000 | xargs kill -9 2>/dev/null   # 关闭后端
lsof -ti:3000 | xargs kill -9 2>/dev/null   # 关闭前端

# macOS / Linux — 按进程名关闭
pkill -f "uvicorn"   # 关闭后端
pkill -f "vite"      # 关闭前端
```

Windows 用户请使用 `.\stop.ps1` 关闭。如果 `stop.ps1` 无效，手动操作：

```cmd
:: 查看谁占用了端口
netstat -ano | findstr :8000
netstat -ano | findstr :3000

:: 找到 PID 后终止（假设 PID=12345）
taskkill /F /PID 12345
```

### 4. 开始使用

**Web 端**

1. 浏览器打开 `http://localhost:3000`
2. 左侧导航栏点击 **设置** → **LLM 配置**
3. 选择提供商（如 OpenAI、DeepSeek），输入 API Key，点击 **保存配置**
4. 点击 **测试** 验证连接是否正常
5. 确保该提供商 **已启用**（绿色开关），可设为默认
6. 切换回 **对话** 标签，右上角下拉框选择刚配置好的模型
7. 输入消息开始对话

> API Key 加密存储在本地，不会上传。刷新页面后模型选择会保留。

**CLI 端**

```bash
# 查看后端状态（确认服务已启动）
agent-me status

# 交互式配置 API Key（选择厂商 → 输入 Key → 保存）
agent-me config

# 查看已配置的提供商列表
agent-me config list

# 测试连接
agent-me config test openai

# 配置 API Key（交互式输入，输入时隐藏不显示）
agent-me config set openai

# 测试连接
agent-me config test openai

# 交互式聊天（启动时选模型）
agent-me chat

# 一次性问答
agent-me ask "今天的科技新闻有哪些"

# 指定模型一次性问答
agent-me ask "用 Python 写一个排序算法" -m gpt-4o
```

> CLI 端依赖后端服务（`http://localhost:8000`），需先通过 `.\start.ps1` 启动后端。

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
| **智能记忆 v2.0** | 短期(会话缓存 50 轮) + 长期记忆 + 结构化用户画像(自动事实提取) |
| **会话摘要** | 每 20 轮自动生成一句话摘要，替代逐条存储，大幅减少 token |
| **文件分析** | PDF / DOCX / TXT 上传解析 → 切片 → RAG 检索（需完整版） |
| **写作助手** | 润色 / 扩写 / 缩写 / 英译中 / 中译英 / 正式语气 / 随意语气 / 列大纲 / 写邮件 / 周报 —— 10 种模板 |
| **任务管理** | 待办看板 + 截止日期 + 完成状态 |
| **联网搜索** | DuckDuckGo (免费) / Tavily / Brave / SerpAPI / Serper / SearXNG / 自定义 |
| **命令执行** | 三级安全审批（自动放行 / 确认 / 禁止），含高危模式检测和多段命令拦截 |
| **浏览器控制** | Kimi WebBridge 集成，支持页面导航、点击、截图、 JS 执行 |
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

| 层级 | 存储 | 容量 | 机制 | 版本要求 |
|------|------|------|------|----------|
| **短期记忆** | 内存 deque | 50 轮/会话 | 会话结束自动清除 | 轻量版/完整版 |
| **长期记忆** | ChromaDB 向量 / SQLite | 无上限 | 重要性评分 + 时间衰减 | 完整版=向量检索；轻量版=关键词匹配 |
| **用户画像** | JSON 文件 | 持久 | 自动事实提取 | 轻量版/完整版 |

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
├── install.bat                # 一键安装依赖 (Windows CMD)
├── install.ps1                # 一键安装依赖 (Windows PowerShell)
├── install.sh                 # 一键安装依赖 (macOS/Linux)
├── start.bat                  # 一键启动 (Windows CMD, 无需改PS策略)
├── start.ps1                  # 一键启动 (Windows PowerShell)
├── start.sh                   # 一键启动 (macOS/Linux)
├── stop.bat                   # 一键关闭 (Windows CMD)
├── stop.ps1                   # 一键关闭 (Windows PowerShell)
├── stop.sh                    # 一键关闭 (macOS/Linux)
├── backend/
│   ├── requirements.txt      # 核心依赖（轻量版，~50MB）
│   ├── requirements-full.txt # 完整依赖（+向量记忆+文件分析，~400MB）
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
agent-me config list             # 查看提供商配置
agent-me config set <id>          # 交互式配置 API Key（不显示明文，安全）
agent-me config test <id>         # 测试连接

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
