# agent-me v2.1 — 通用个人 AI Agent

纯本地部署的个人 AI 助手。支持多厂商 LLM、智能记忆、文件分析、自动工具调用、Web/CLI 双端，所有对话数据本地存储，隐私可控。

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

安装脚本在 `script/` 目录下，按顺序使用即可：

| 脚本 | 用于 | 说明 |
|------|------|------|
| `script\install.bat` | **仅首次** 装依赖 | 检测环境 → 装 Python 包 → 装 npm 包 → 装 CLI |
| `script\start.ps1` | **每次使用前** 启动 | 后台启动后端 (8000) + 前端 (3000)，在 PowerShell 运行 |
| `script\stop.ps1` | **用完** 关闭 | 停止所有服务进程 |

#### Windows 完整流程

```cmd
:: 1. 安装依赖（仅首次）
script\install.bat                    → 轻量版（~50MB，推荐）
script\install.bat --full             → 完整版（+向量记忆+文件分析）
script\install.bat --mirror           → 国内镜像加速（下载慢时强烈推荐）

:: 2. 启动服务（在 PowerShell 中运行）
powershell -ExecutionPolicy Bypass -File script\start.ps1

:: 3. 打开浏览器
访问 http://localhost:3000

:: 4. 配置 API Key
左侧"设置" → "LLM 配置" → 选提供商 → 输入 Key → 保存 → 测试 → 启用

:: 5. 开始对话
回到"对话"标签 → 选好模型 → 输入消息

:: 6. 用完关闭（在 PowerShell 中运行）
powershell -ExecutionPolicy Bypass -File script\stop.ps1
```

> **参数说明**：`--mirror` 国内镜像加速（下载 pip/npm 包变快）、`--full` 完整版（文件分析）、`--venv` 虚拟环境。

> **为什么有 bat 和 ps1 两套？** Windows 默认禁止运行 `.ps1` 脚本（PowerShell 执行策略限制），`.bat` 双击就能运行不受策略限制。功能完全一样，选一套用即可。

> **PowerShell 版**（bat 报错时备用）：
> ```powershell
> # 先执行一次放行当前窗口：
> Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process
> .\script\install.ps1 -UseMirror
> .\script\start.ps1
> .\script\stop.ps1
> ```

#### macOS / Linux

```bash
chmod +x script/install.sh script/start.sh script/stop.sh
script/install.sh          # 装依赖
script/start.sh            # 启动
script/stop.sh             # 停止
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
| 启动后 LLM 配置页面不显示 | 后端没启动 | 运行 `script\stop.ps1` → 重新 `script\start.ps1` |
| 文件上传无法解析 | 需要完整版 | `pip install -r requirements-full.txt` |

### 3. 启动服务

**macOS / Linux — 一键启动（推荐）**

```bash
chmod +x script/start.sh script/stop.sh

# 后台启动后端 + 前端
script/start.sh

# 关闭服务
script/stop.sh
```

**手动启动（两个终端窗口）**

```bash
# 终端 1 — 后端
cd backend
python3 -m uvicorn main:app --port 8000

# 终端 2 — 前端
cd frontend
npm run dev
```

**关闭手动启动的进程**

```bash
# 按端口关闭
lsof -ti:8000 | xargs kill -9 2>/dev/null   # 关闭后端
lsof -ti:3000 | xargs kill -9 2>/dev/null   # 关闭前端

# 按进程名关闭
pkill -f "uvicorn"   # 关闭后端
pkill -f "vite"      # 关闭前端
```

Windows 用户请使用 `script\stop.ps1` 关闭。如果无效，手动操作：

```cmd
netstat -ano | findstr :8000
netstat -ano | findstr :3000
taskkill /F /PID 12345   :: 假设找到的 PID=12345
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
agent-me status                  # 确认后端启动
agent-me config                  # 交互式配置 API Key
agent-me config list             # 查看已配置的提供商
agent-me config test openai      # 测试连接
agent-me chat                    # 交互式聊天
agent-me ask "今天的科技新闻有哪些"  # 一次性问答
```

> CLI 端依赖后端服务（`http://localhost:8000`），需先启动后端。

## 界面预览

**Web 端**                                              **CLI 端**

![Web 界面](docs/screenshot-web.png)                 ![CLI 界面](docs/screenshot-cli.png)

## 功能清单

| 功能 | 说明 |
|------|------|
| **多轮对话** | SSE 流式输出 + Markdown 渲染 + 代码高亮，Ctrl+C 取消 |
| **自动 Agent 模式** | 根据消息内容自动判断是否需要调用工具 |
| **10 个内置工具** | 搜索、天气、新闻、读文件、列目录、执行命令、搜索记忆、搜索文件、浏览器控制、获取时间 |
| **18 种技能模式** | plan_first / product_mindset / ship_first / minimal_deps / oop / functional / claude_code_style / cursor_style / pair_programming / caveman / diagnose / grill / prototype / tdd / architecture / triage / zoom_out / security |
| **多厂商 LLM** | OpenAI / Anthropic / Google / DeepSeek / Kimi / MiniMax / 智谱 GLM / 字节豆包 / 自定义 |
| **智能记忆 v2.0** | 短期（50 轮/会话）+ 长期（向量/SQLite）+ 结构化用户画像（自动事实提取） |
| **会话摘要** | 每 20 轮自动生成摘要，替代逐条存储 |
| **文件分析** | PDF/DOCX/TXT 上传 → 切片 → RAG 检索（需完整版） |
| **写作助手** | 润色/扩写/缩写/翻译/正式/随意/大纲/邮件/周报 — 10 种模板 |
| **任务管理** | 待办看板 + 截止日期 + 完成状态 |
| **联网搜索** | DuckDuckGo（免费）/ Tavily / Brave / SerpAPI / Serper / SearXNG / 自定义 |
| **命令执行** | 三级安全审批（自动放行/确认/禁止） |
| **浏览器控制** | Kimi WebBridge 集成：导航、点击、截图 |
| **对话导出** | Markdown / JSON |
| **深色模式** | 自动适配系统 / 手动切换 |
| **日志查看** | Web 端 `/api/logs`，滚动存储（5MB × 3） |
| **Token 节省** | 历史截断（20 条/32K 字符）+ Anthropic prompt caching |

## 自动 Agent 模式

agent-me 会自动判断是否调用工具：

- **"帮我写一段 Python 代码"** → 普通模式，直接生成
- **"搜索 Python 异步编程最佳实践"** → 自动调用 `web_search`
- **"查看当前目录有哪些文件"** → 自动调用 `list_directory`
- **"读取 backend/main.py 并解释"** → 自动调用 `read_file`
- **"打开浏览器访问 github.com"** → 自动调用 `browser_navigate`

### 10 个内置工具

| 工具 | 功能 | 安全限制 |
|------|------|----------|
| `get_current_time` | 获取当前日期时间 | 无 |
| `web_search` | 联网搜索 | 无 |
| `get_weather` | 查询天气（免费，无需 API Key） | 无 |
| `get_news` | 获取新闻（可配 NewsAPI Key，否则回退搜索） | 受限 |
| `read_file` | 读取本地文件 | 限制 100KB，安全路径白名单 |
| `list_directory` | 列出目录内容 | 最大递归深度 3 |
| `run_command` | 执行终端命令 | 仅 always_allow 级别 |
| `search_memory` | 检索长期记忆 | 无 |
| `search_files` | 检索上传文件内容 | 无 |
| `browser_navigate` | 浏览器自动化 | 15s 超时 |

## 智能记忆系统 v2.0

### 三层架构

| 层级 | 存储 | 容量 | 机制 | 版本要求 |
|------|------|------|------|----------|
| **短期记忆** | 内存 deque | 50 轮/会话 | 会话结束自动清除 | 轻量/完整 |
| **长期记忆** | ChromaDB 向量 / SQLite | 无上限 | 重要性评分 + 时间衰减 | 完整版=向量；轻量版=关键词 |
| **用户画像** | JSON 文件 | 持久 | 自动事实提取 | 轻量/完整 |

### 自动事实提取

每 10 轮对话自动调用 LLM 提取结构化事实，自动分类存入画像：

```json
[{"fact": "用户喜欢 Python", "category": "技能偏好", "importance": 8}]
```

### 重要性评分

每条记忆存入前由 LLM 打分（1-10）：≥5 分存入长期记忆，≥7 分同时存画像，<5 分丢弃。

### 时间衰减

检索综合分 = relevance × importance × decay，30 天半衰期。

## 技术栈

| 层 | 技术 |
|---|---|
| 后端 | Python 3.10+ · FastAPI · ChromaDB · SQLite |
| 前端 | React 18 · Zustand · TailwindCSS · Vite |
| CLI | Click · Rich · HTTPX |
| 加密 | cryptography (Fernet)，密钥与数据分离 |
| 嵌入 | sentence-transformers (all-MiniLM-L6-v2) |

## 项目结构

```
agent-me/
├── script/                    # 安装/启动/停止脚本
│   ├── install.bat(.ps1)     # 装依赖（Windows）
│   ├── start.ps1              # 启动服务（Windows）
│   ├── stop.ps1               # 停止服务（Windows）
│   ├── install.sh            # 装依赖（macOS/Linux）
│   ├── start.sh              # 启动服务（macOS/Linux）
│   └── stop.sh               # 停止服务（macOS/Linux）
├── SYSTEM_PROMPT.md           # 系统提示词，运行时加载
├── backend/
│   ├── requirements.txt      # 核心依赖（轻量，~50MB）
│   ├── requirements-full.txt # 完整依赖（+向量+文件分析，~400MB）
│   ├── main.py               # FastAPI 入口
│   ├── app_config/           # 配置模块
│   ├── routes/               # 12 个路由模块
│   ├── services/             # 业务逻辑层
│   ├── models/               # Pydantic 模型
│   └── storage/              # SQLite + ChromaDB + 加密配置 + 日志
├── frontend/                 # React SPA
│   └── src/
│       ├── components/       # UI 组件
│       ├── hooks/            # 自定义 Hooks
│       ├── utils/api.js      # API 封装
│       └── store.js          # Zustand 状态管理
├── cli/
│   └── agent_me/main.py      # CLI 入口
└── docs/                     # 文档截图
```

## CLI 命令参考

```bash
# === 核心命令 ===
agent-me chat              # 交互式聊天（启动时选模型，支持斜杠命令）
agent-me ask "问题"         # 一次性问答，-m 模型 -f 文件 -s 技能 --search

# === 模型与配置 ===
agent-me models            # 查看可用模型
agent-me config list       # 查看提供商配置
agent-me config set <id>   # 交互式配置 API Key（不显示明文）
agent-me config test <id>  # 测试连接

# === 对话管理 ===
agent-me conversations     # 列出所有对话
agent-me export [id]       # 导出对话（Markdown）

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

## 隐私

- API Key 用 Fernet 加密存储于 `backend/storage/config.enc`，密钥分离
- 对话记录和记忆仅保存在本地 SQLite + ChromaDB
- 不上传任何数据到第三方服务器

## 更新日志

### v2.1 (2025-06-13)

- **Agent 自动判断**：根据消息内容自动决定是否调用工具
- **工具扩展**：3 → 10 个工具（新增天气、新闻、读文件、列目录、执行命令、浏览器控制、获取时间）
- **工具系统重构**：BaseTool + ToolRegistry 注册表模式，加工具只需注册一个类
- **安全熔断**：连续 3 次工具失败自动暂停，防止 Token 浪费
- **前端静态托管**：`npm run build` 后单个进程即可部署
- **智能记忆 v2.0**：自动事实提取、会话摘要、重要性评分、时间衰减
- **结构化画像**：name + preferences + skills + habits + facts
- **安全增强**：CORS 限制、异常脱敏、命令精确化、文件魔数验证
