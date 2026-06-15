# agent-me v2.1 — Universal Personal AI Agent

A full-stack AI assistant with multi-LLM support, smart memory, file analysis, automated tool calling, Web/CLI dual interface. All data stored locally.

---

## Quick Start

### Prerequisites

- Python ≥ 3.10
- Node.js ≥ 18
- Git

### 1. Clone

```bash
git clone https://github.com/swfk2154/agent-me.git
cd agent-me
```

### 2. Install Dependencies

Choose your edition:

| Edition | Size | Features |
|---------|------|----------|
| **Lite** | ~50MB | Multi-turn chat, web search, command execution, task management, writing assistant, CLI, user profile |
| **Full** | ~400MB | Lite + **vector semantic memory (long-term)** + **file upload analysis (PDF/DOCX/TXT)** |

> Start with Lite. Upgrade later with `pip install -r requirements-full.txt`.

```bash
# Backend (run in separate terminal)
cd backend
pip install -r requirements.txt --prefer-binary

# Frontend
cd ../frontend
npm install

# CLI (optional)
cd ../cli
pip install -e . --prefer-binary
```

### 3. Start

**Windows**

```powershell
.\start.ps1     # Start backend + frontend (~3s)
.\stop.ps1      # Stop services
```

**macOS / Linux**

```bash
chmod +x start.sh stop.sh
./start.sh      # Start
./stop.sh       # Stop
```

**Manual (two terminals)**

```bash
# Terminal 1 — Backend
cd backend
python3 -m uvicorn main:app --port 8000

# Terminal 2 — Frontend
cd frontend
npm run dev
```

### 4. Configure & Use

1. Open `http://localhost:3000`
2. Go to **Settings** → **LLM Config**
3. Pick a provider (OpenAI, Anthropic, DeepSeek, etc.), enter API Key, save
4. Click **Test** to verify connection
5. Toggle the provider **enabled**, optionally set as default
6. Go back to **Chat** tab, select your model from the top-right dropdown
7. Start typing

> API Keys are encrypted locally. Model selection persists across page refreshes.

---

## Features

| Feature | Description |
|---------|-------------|
| **Multi-turn Chat** | SSE streaming + Markdown rendering + code highlighting, Ctrl+C to cancel |
| **Auto Agent Mode** | Automatically decides whether to call tools based on message content |
| **8 Built-in Tools** | Web search, file read, directory list, command execution, memory search, file search, browser control, current time |
| **18 Skill Modes** | Architecture planning, product mindset, ship-first, minimal deps, OOP, functional, Claude Code style, Cursor style, pair programming, caveman, diagnose, grill, prototype, TDD, architecture review, triage, zoom-out, security |
| **9 LLM Providers** | OpenAI / Anthropic / Google / DeepSeek / Kimi / MiniMax / GLM (Zhipu) / Doubao (ByteDance) / Custom |
| **Smart Memory v2.0** | Short-term (50 rounds/session) + long-term (vector/SQLite) + structured user profile (auto fact extraction) |
| **Session Summaries** | Auto-generated one-line summary every 20 rounds, replaces per-message storage |
| **File Analysis** | PDF / DOCX / TXT upload → chunking → RAG retrieval (Full edition) |
| **Writing Assistant** | Polish / expand / condense / translate (EN↔ZH) / formal / casual / outline / email / weekly report — 10 templates |
| **Task Management** | Kanban board with due dates and completion status |
| **Web Search** | DuckDuckGo (free) / Tavily / Brave / SerpAPI / Serper / SearXNG / Custom |
| **Command Execution** | 3-tier security approval (auto-allow / confirm / deny) with high-risk pattern detection |
| **Browser Control** | Kimi WebBridge integration: navigate, click, screenshot, JavaScript execution |
| **Conversation Export** | Markdown / JSON |
| **Dark Mode** | Auto-follow system / manual toggle |
| **Log Viewer** | Web UI at `/api/logs`, rolling storage (5MB × 3) |
| **Token Savings** | History truncation (20 msg pairs / 32K chars) + Anthropic prompt caching (90% cost reduction) |

---

## Auto Agent Mode

No manual switching needed. agent-me detects your intent automatically:

- **"Write a Python script"** → Normal chat, generates directly
- **"Search for async Python best practices"** → Calls `web_search` tool
- **"List files in current directory"** → Calls `list_directory` tool
- **"Read backend/main.py and explain"** → Calls `read_file` tool
- **"Open github.com in browser"** → Calls `browser_navigate` tool

### Trigger Keywords

| Category | Examples |
|----------|----------|
| Search | search, find, google, look up, query |
| File | read file, open file, view file, cat, list directory, ls, dir |
| Command | run, execute, git status, git diff, npm, pip, python |
| Browser | open page, browser, screenshot, visit, navigate |
| Memory | search memory, recall, what did we say about, long-term memory |
| General | check, find, look for |

### 8 Built-in Tools

| Tool | Function | Restrictions |
|------|----------|-------------|
| `get_current_time` | Get current date/time | None |
| `web_search` | Web search (15s timeout) | None |
| `read_file` | Read local files | Max 100KB, supports pagination |
| `list_directory` | List directory contents | Max recursion depth 3 |
| `run_command` | Execute shell commands | Only always-allow level commands |
| `search_memory` | Retrieve long-term memory | None |
| `search_files` | Search uploaded file contents | None |
| `browser_navigate` | Browser automation | 15s timeout |

---

## Smart Memory v2.0

### 3-Layer Architecture

| Layer | Storage | Capacity | Mechanism | Edition Required |
|-------|---------|----------|-----------|-----------------|
| **Short-term** | In-memory deque | 50 rounds/session | Cleared on session end | Lite / Full |
| **Long-term** | ChromaDB vector / SQLite | Unlimited | Importance scoring + time decay | Full=vector; Lite=keyword |
| **User Profile** | JSON file | Persistent | Auto fact extraction | Lite / Full |

### Auto Fact Extraction

Every 10 rounds, agent-me calls the LLM to extract structured facts:

```json
[{"fact": "User prefers Python", "category": "skill", "importance": 8}]
```

Auto-classified into profile:
- **Identity** → `profile.name` + `profile.facts`
- **Skill** → `profile.skills`
- **Habits** → `profile.habits`
- **Preferences** → `profile.preferences`

### Importance Scoring

Each memory scored 1-10 by the LLM before storage:
- ≥5: stored in long-term memory
- ≥7: also stored in user profile
- <5: discarded

### Time Decay

Retrieval uses composite score: `relevance × importance × decay`

- Decay formula: `decay = exp(-days_old / 30)`
- 30-day half-life: memories from 30 days ago weigh 50%
- Manual cleanup: `POST /api/memory/cleanup`

### Session Summaries

Every 20 rounds, agent-me auto-generates a one-line summary:

```
"User asked me to optimize their CLI tool; I modified main.py to add slash commands"
```

---

## Browser Control

Requires **Kimi WebBridge**:

1. Install from [Kimi WebBridge repository](https://github.com/kimi-webbridge/kimi-webbridge)
2. Start the service (default: `127.0.0.1:10086`)
3. Optional: set custom path via env var:
   ```bash
   export AGENT_ME_WEBBRIDGE_PATH=/path/to/kimi-webbridge
   ```

> **Security note**: Browser control operates on your already-logged-in browser sessions. Exercise caution if your browser is logged into sensitive accounts (banking, email, etc.).

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Python 3.10+ · FastAPI · ChromaDB · SQLite |
| Frontend | React 18 · Zustand · TailwindCSS · Vite |
| CLI | Click · Rich · HTTPX |
| Encryption | cryptography (Fernet), key separate from data, 5s in-memory cache |
| Embeddings | sentence-transformers (all-MiniLM-L6-v2) |

---

## Project Structure

```
agent-me/
├── install.ps1               # Windows one-click dependency install
├── install.sh                # macOS/Linux one-click dependency install
├── start.ps1                 # Windows one-click start
├── start.sh                  # macOS/Linux one-click start
├── stop.ps1                  # Windows stop
├── stop.sh                   # macOS/Linux stop
├── SYSTEM_PROMPT.md          # System prompt loaded at runtime
├── backend/
│   ├── requirements.txt      # Core dependencies (Lite, ~50MB)
│   ├── requirements-full.txt # Full dependencies (+vector +file analysis, ~400MB)
│   ├── main.py               # FastAPI entry point
│   ├── app_config/           # Providers, settings, encryption, logging, search providers
│   ├── routes/               # Chat, config, files, memory, tasks, writing, skills, commands, search, export, browser, agent
│   ├── services/             # LLM, memory, DB, agent loop, command, search, file, webbridge
│   ├── models/               # Pydantic models
│   └── storage/              # SQLite, ChromaDB, encrypted config, uploads, logs
├── frontend/                 # React SPA (Vite + TailwindCSS)
│   └── src/
│       ├── components/       # Chat, layout, settings, tasks, writing, commands, memory, UI
│       ├── hooks/            # useChat, useConfig, useMemory
│       ├── utils/api.js      # Frontend API wrapper
│       └── store.js          # Zustand global state
├── cli/
│   └── agent_me/main.py      # CLI entry (agent-me command)
└── README.md
```

---

## API Key Providers

| Provider | Console URL | Agent Tools |
|----------|------------|-------------|
| OpenAI | https://platform.openai.com/api-keys | ✅ Yes |
| Anthropic | https://console.anthropic.com/settings/keys | ✅ Yes |
| Google | https://aistudio.google.com/app/apikey | ✅ Yes |
| DeepSeek | https://platform.deepseek.com/api_keys | ✅ Yes |
| Kimi (Moonshot) | https://platform.moonshot.cn/console/api-keys | ✅ Yes |
| MiniMax | https://platform.minimaxi.com/user-center/basic-information/interface-key | ❌ No |
| GLM (Zhipu) | https://open.bigmodel.cn/usercenter/apikeys | ✅ Yes |
| Doubao (ByteDance) | https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey | ✅ Yes |
| Custom | - | ✅ Yes (default) |

> Models without function calling support (e.g., MiniMax) automatically fall back to normal chat mode.

---

## CLI Reference

```bash
# === Core ===
agent-me chat              # Interactive chat (model selection on start)
agent-me ask "question"    # One-shot question, -m model -f file -s skill --search

# === Model & Config ===
agent-me models            # List available models
agent-me config list       # List provider configurations
agent-me config set <id>   # Interactive API Key setup (input hidden)
agent-me config test <id>  # Test connection

# === Conversation ===
agent-me conversations     # List all conversations
agent-me export [id]       # Export conversation (Markdown)

# === Search & Memory ===
agent-me search "query"    # Web search
agent-me memory "keyword"  # Search long-term memory

# === Other ===
agent-me tasks             # View task list
agent-me status            # Check backend status
agent-me logs -n 50        # View backend logs
```

### CLI Chat Slash Commands

Within `agent-me chat`:

| Command | Function |
|---------|----------|
| `/new [title]` | New conversation |
| `/list` | List all conversations |
| `/switch <ID>` | Switch to conversation |
| `/model [name]` | View or switch model |
| `/skill [name]` | View or switch skill mode |
| `/search [query]` | Temporary web search |
| `/file <path>` | Upload file |
| `/clear` | Clear current conversation |
| `/history` | Show conversation history |
| `/info` | Show current session info |
| `/export [ID]` | Export as Markdown |
| `/help` | Show help |
| `/quit` | Exit |

---

## System Prompt

The system prompt for each conversation is composed from the following sources (in order):

1. **`SYSTEM_PROMPT.md`** (project root) — loaded at runtime if the file exists
2. **Fallback default** — "You are agent-me, an intelligent personal assistant" plus core principles, if no file and no custom prompt set
3. **User profile** — name + preferences + skills + habits + facts
4. **Web search results** — injected when search is enabled
5. **File RAG chunks** — injected when files are uploaded
6. **Skill mode addon** — additional instructions for the selected skill

### 18 Skill Modes

| Skill | Description |
|-------|-------------|
| plan_first | Design architecture before coding, split modules by responsibility |
| product_mindset | Think about user needs proactively, focus on complete product experience |
| ship_first | Make it work first, deliver MVP, keep scope tight |
| minimal_deps | Minimize external dependencies, stay simple and sufficient |
| oop_style | Object-oriented, modular, data and behavior together |
| functional_style | Functional, progressive, start simple |
| claude_code_style | Concise (4 lines max), minimal tokens, no emoji, no preamble |
| cursor_style | Show only changed code, mark unchanged regions with `// ... existing code ...` |
| pair_programming | Collaborate like a pair programming partner, suggest at key decision points |
| caveman | Output only the core conclusion, no explanation |
| diagnose | Systematic: reproduce → isolate → hypothesize → verify → fix → regression |
| grill_me | Keep questioning until all decision-tree branches are clear |
| prototype | Build minimum runnable prototype quickly |
| tdd | Red → Green → Refactor cycle |
| architecture | Review code architecture, find coupling and improvement opportunities |
| triage | Classify by priority with severity, impact, and recommended order |
| zoom_out | Step back from details, give high-level context |
| security | Check injection, auth, storage, data exposure, provide CVSS scores |

---

## Token Savings

- **History truncation**: max 20 message pairs, 32000 chars (~8k tokens), drops oldest when exceeded
- **Session summaries**: auto-generated every 20 rounds, replaces per-message storage in long-term memory
- **Prompt caching**: Anthropic Claude models get `cache_control` on the last user message, reducing cost ~90% on subsequent turns
- **System prompt**: loaded from `SYSTEM_PROMPT.md` when present, otherwise a minimal built-in default

---

## Privacy

- API Keys encrypted with Fernet, stored at `backend/storage/config.enc`, key file separate
- Conversations and memories stored only in local SQLite + ChromaDB
- No data uploaded to any third-party server
- Web search only executes when you trigger it

---

## Changelog

### v2.1 (2025-06-13)

- **Auto Agent mode**: automatically decides tool invocation based on message intent
- **Tool expansion**: 3 → 8 tools (added read_file, list_directory, run_command, browser_navigate, get_current_time)
- **Smart Memory v2.0**: auto fact extraction, session summaries, importance scoring, time decay
- **Structured profile**: name + preferences + skills + habits + facts
- **New skills**: claude_code_style, cursor_style, pair_programming
- **CLI v2.1**: codebase-aware, extended slash commands, new commands (search, memory, tasks, status, logs)
- **Frontend**: Agent visual feedback, collapsible tool-call cards, model capability detection
- **Security**: CORS restriction, error message sanitization, precise command evaluation, file magic number validation
