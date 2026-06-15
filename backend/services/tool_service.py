"""工具系统：BaseTool + ToolRegistry
从 agent_loop.py 中重构而来，统一工具抽象，不再硬编码 JSON + 散落函数。
"""

from __future__ import annotations
import json, asyncio, os, math, datetime, re
from pathlib import Path
from typing import Any, Dict, List, Optional
from dataclasses import dataclass, field
from abc import ABC, abstractmethod


# =============================================================================
# 基础类型
# =============================================================================

@dataclass
class ToolResult:
    success: bool
    output: str = ""
    error: Optional[str] = None
    metadata: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def ok(cls, output: str = "", **metadata) -> "ToolResult":
        return cls(success=True, output=output, metadata=metadata)

    @classmethod
    def fail(cls, error: str, **metadata) -> "ToolResult":
        return cls(success=False, error=error, metadata=metadata)


class BaseTool(ABC):
    """工具基类。子类只需设 name/description/parameters 并实现 execute。"""
    name: str = ""
    description: str = ""
    parameters: Dict[str, Any] = {}

    @abstractmethod
    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        ...

    def to_openai_tool(self) -> dict:
        """生成 OpenAI-compatible tool JSON Schema。"""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }

    def to_spec(self) -> dict:
        return {
            "name": self.name,
            "description": self.description,
            "parameters": self.parameters,
        }


# =============================================================================
# 注册中心
# =============================================================================

class ToolRegistry:
    """工具注册中心，管理工具的注册/查找/执行。"""

    def __init__(self):
        self._tools: Dict[str, BaseTool] = {}

    def register(self, tool: BaseTool) -> None:
        if tool.name in self._tools:
            raise ValueError(f"工具 '{tool.name}' 已注册")
        self._tools[tool.name] = tool

    def unregister(self, name: str) -> None:
        self._tools.pop(name, None)

    def get(self, name: str) -> Optional[BaseTool]:
        return self._tools.get(name)

    def list_specs(self) -> List[dict]:
        return [t.to_spec() for t in self._tools.values()]

    def to_openai_tools(self) -> List[dict]:
        return [t.to_openai_tool() for t in self._tools.values()]

    async def execute(self, name: str, args: Dict[str, Any]) -> ToolResult:
        tool = self.get(name)
        if tool is None:
            return ToolResult.fail(f"未知工具: {name}")
        try:
            return await tool.execute(args)
        except Exception as e:
            return ToolResult.fail(f"工具执行错误 [{name}]: {str(e)}")


# =============================================================================
# 工具：获取当前时间
# =============================================================================

class GetCurrentTimeTool(BaseTool):
    name = "get_current_time"
    description = "获取当前日期和时间。用于回答需要时间信息的问题。"
    parameters = {"type": "object", "properties": {}}

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        return ToolResult.ok(datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S (%A)"))


# =============================================================================
# 工具：Web 搜索
# =============================================================================

class WebSearchTool(BaseTool):
    name = "web_search"
    description = "搜索互联网获取最新信息、新闻、数据。当你需要查找实时信息时使用。"
    parameters = {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "搜索关键词"}
        },
        "required": ["query"],
    }

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        query = args.get("query", "")
        if not query:
            return ToolResult.fail("query 不能为空")
        from services.search_service import search_web
        try:
            results = await asyncio.wait_for(
                asyncio.to_thread(search_web, query, max_results=5),
                timeout=25,
            )
        except asyncio.TimeoutError:
            return ToolResult.fail("搜索超时 (25s)，请检查网络连接后重试")
        if not results:
            return ToolResult.ok("未找到相关搜索结果。")
        lines = []
        for i, r in enumerate(results, 1):
            lines.append(f"{i}. {r.get('title', '')}")
            if r.get("snippet"):
                lines.append(f"   {r['snippet'][:200]}")
            if r.get("url"):
                lines.append(f"   来源: {r['url']}")
        return ToolResult.ok("\n".join(lines))


# =============================================================================
# 工具：读取文件
# =============================================================================

# 安全常量
_ALLOWED_READ_ROOTS: Optional[List[Path]] = None
_SENSITIVE_PATHS = [
    "Windows/System32", "Windows/SysWOW64", "Windows/Security",
    "Program Files/WindowsApps", "Windows/WinSxS",
    "/etc/shadow", "/etc/passwd", "/etc/ssh", ".ssh/",
    ".aws/", ".azure/", ".gcp/", "id_rsa", "id_ed25519",
]


def _get_allowed_roots() -> List[Path]:
    global _ALLOWED_READ_ROOTS
    if _ALLOWED_READ_ROOTS is not None:
        return _ALLOWED_READ_ROOTS
    env = os.environ.get("AGENT_ME_ALLOWED_PATHS", "")
    if env:
        _ALLOWED_READ_ROOTS = [Path(r).resolve() for r in env.split(os.pathsep) if r.strip()]
    else:
        _ALLOWED_READ_ROOTS = [Path.cwd().resolve(), Path.home().resolve()]
    return _ALLOWED_READ_ROOTS


def _is_under_allowed_roots(path: Path) -> bool:
    try:
        resolved = path.resolve()
        for root in _get_allowed_roots():
            try:
                resolved.relative_to(root)
                return True
            except ValueError:
                continue
    except (OSError, RuntimeError):
        pass
    return False


def _is_sensitive_path(path: str) -> bool:
    p = path.replace("\\", "/")
    for s in _SENSITIVE_PATHS:
        if s in p:
            return True
    return False


class ReadFileTool(BaseTool):
    name = "read_file"
    description = "读取本地文件内容。用于查看代码、配置文件、日志等。限制 100KB。"
    parameters = {
        "type": "object",
        "properties": {
            "file_path": {"type": "string", "description": "文件绝对路径或相对路径"},
            "offset": {"type": "integer", "description": "起始行号（从0开始）", "default": 0},
            "limit": {"type": "integer", "description": "读取行数，默认100", "default": 100},
        },
        "required": ["file_path"],
    }

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        fp = args.get("file_path", "")
        if not fp:
            return ToolResult.fail("file_path 不能为空")
        normalized = os.path.normpath(fp)
        if ".." in normalized.split(os.sep):
            return ToolResult.fail("路径中不允许包含 ..")
        p = Path(fp)
        if not p.exists():
            return ToolResult.fail(f"文件不存在: {fp}")
        if not p.is_file():
            return ToolResult.fail(f"不是文件: {fp}")
        if _is_sensitive_path(str(p)):
            return ToolResult.fail("该路径属于敏感区域，不允许读取")
        if not _is_under_allowed_roots(p):
            return ToolResult.fail("文件不在允许读取的目录范围内。可通过环境变量 AGENT_ME_ALLOWED_PATHS 扩展。")
        if p.stat().st_size > 100 * 1024:
            return ToolResult.fail(f"文件超过 100KB 限制: {fp}")

        offset = args.get("offset", 0)
        limit = args.get("limit", 100)
        try:
            with open(p, "r", encoding="utf-8", errors="replace") as f:
                lines = f.readlines()
            selected = lines[offset:offset + limit]
            result = "".join(selected)
            total = len(lines)
            header = f"[文件: {p.name} | 总行数: {total} | 显示: {offset+1}-{min(offset+limit, total)}]\n"
            if total > offset + limit:
                result += f"\n... 还有 {total - offset - limit} 行未显示 ..."
            return ToolResult.ok(header + result)
        except Exception as e:
            return ToolResult.fail(f"读取失败: {e}")


# =============================================================================
# 工具：列出目录
# =============================================================================

class ListDirectoryTool(BaseTool):
    name = "list_directory"
    description = "列出目录中的文件和子目录。用于探索项目结构。"
    parameters = {
        "type": "object",
        "properties": {
            "dir_path": {"type": "string", "description": "目录路径，默认当前目录", "default": "."},
            "max_depth": {"type": "integer", "description": "最大递归深度，默认1", "default": 1},
        },
        "required": [],
    }

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        dp = args.get("dir_path", ".")
        max_depth = args.get("max_depth", 1)
        normalized = os.path.normpath(dp)
        if ".." in normalized.split(os.sep):
            return ToolResult.fail("路径中不允许包含 ..")
        p = Path(dp)
        if not p.exists():
            return ToolResult.fail(f"目录不存在: {dp}")
        if not p.is_dir():
            return ToolResult.fail(f"不是目录: {dp}")
        if _is_sensitive_path(str(p)):
            return ToolResult.fail("该路径属于敏感区域，不允许访问")
        if not _is_under_allowed_roots(p):
            return ToolResult.fail("目录不在允许访问的范围内。可通过环境变量 AGENT_ME_ALLOWED_PATHS 扩展。")
        if max_depth > 3:
            return ToolResult.fail("max_depth 不能超过 3")

        def _list(path: Path, depth: int, prefix: str = "") -> List[str]:
            lines = []
            try:
                items = sorted(path.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower()))
            except PermissionError:
                return [f"{prefix}[权限拒绝] {path.name}"]
            for item in items:
                icon = "📁" if item.is_dir() else "📄"
                size = ""
                if item.is_file():
                    size_kb = item.stat().st_size / 1024
                    size = f" ({size_kb:.1f}KB)" if size_kb < 1024 else f" ({size_kb/1024:.1f}MB)"
                lines.append(f"{prefix}{icon} {item.name}{size}")
                if item.is_dir() and depth < max_depth:
                    lines.extend(_list(item, depth + 1, prefix + "  "))
            return lines

        lines = [f"[目录: {p.resolve()}]"] + _list(p, 1)
        return ToolResult.ok("\n".join(lines))


# =============================================================================
# 工具：执行命令
# =============================================================================

class RunCommandTool(BaseTool):
    name = "run_command"
    description = "执行安全的终端命令（如 ls, cat, grep, git status, python --version）。危险命令会被自动阻止。"
    parameters = {
        "type": "object",
        "properties": {
            "command": {"type": "string", "description": "要执行的命令"},
            "workdir": {"type": "string", "description": "工作目录，默认当前目录", "default": "."},
        },
        "required": ["command"],
    }

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        cmd = args.get("command", "")
        if not cmd:
            return ToolResult.fail("command 不能为空")
        from services.command_service import command_service
        eval_result = command_service.evaluate(cmd, args.get("workdir", "."))
        if eval_result["action"] == "never_allow":
            return ToolResult.fail(f"命令被安全策略阻止: {eval_result.get('reason', '')}")
        if eval_result["action"] == "ask_first":
            return ToolResult.fail(f"命令需要用户确认: {eval_result.get('reason', '')}")
        workdir = args.get("workdir", ".")
        try:
            result = await asyncio.wait_for(
                asyncio.to_thread(command_service.execute, cmd, workdir, timeout=15, approved=True),
                timeout=20,
            )
        except asyncio.TimeoutError:
            return ToolResult.fail("命令执行超时 (20s)")
        if result.get("success"):
            output = result.get("output", "")
            return ToolResult.ok(output[-3000:] if len(output) > 3000 else output)
        else:
            return ToolResult.fail(result.get("error", ""))


# =============================================================================
# 工具：搜索记忆
# =============================================================================

class SearchMemoryTool(BaseTool):
    name = "search_memory"
    description = "从用户的长期记忆（历史对话、事实、偏好）中检索相关信息。"
    parameters = {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "记忆搜索词"}
        },
        "required": ["query"],
    }

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        query = args.get("query", "")
        if not query:
            return ToolResult.fail("query 不能为空")
        from services.memory_service import memory_service
        memories = memory_service.retrieve_memories(query, k=5)
        if not memories:
            return ToolResult.ok("未找到相关记忆。")
        return ToolResult.ok("\n---\n".join(f"[{i+1}] {m}" for i, m in enumerate(memories)))


# =============================================================================
# 工具：搜索文件
# =============================================================================

class SearchFilesTool(BaseTool):
    name = "search_files"
    description = "从用户上传的文件（PDF/DOCX/TXT）中检索相关信息。"
    parameters = {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "文件内容搜索词"}
        },
        "required": ["query"],
    }

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        query = args.get("query", "")
        if not query:
            return ToolResult.fail("query 不能为空")
        from services.memory_service import memory_service
        chunks = memory_service.retrieve_file_chunks(query, k=5)
        if not chunks:
            return ToolResult.ok("未找到相关文件内容。")
        return ToolResult.ok("\n---\n".join(f"[{i+1}] {c[:500]}" for i, c in enumerate(chunks)))


# =============================================================================
# 工具：浏览器控制
# =============================================================================

class BrowserNavigateTool(BaseTool):
    name = "browser_navigate"
    description = "控制浏览器打开网页。需要先确认 Kimi WebBridge 已启动。"
    parameters = {
        "type": "object",
        "properties": {
            "url": {"type": "string", "description": "要打开的网址"},
            "action": {
                "type": "string",
                "description": "操作类型：navigate(导航)|snapshot(截图页面内容)|click(点击)|screenshot(截图)",
                "default": "navigate",
            },
            "selector": {"type": "string", "description": "CSS选择器（click操作时使用）", "default": ""},
        },
        "required": ["url"],
    }

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        url = args.get("url", "")
        action = args.get("action", "navigate")
        selector = args.get("selector", "")
        if not url:
            return ToolResult.fail("url 不能为空")
        from services.webbridge_service import send_command as webbridge_send
        try:
            if action == "navigate":
                result = await asyncio.wait_for(
                    webbridge_send("navigate", {"url": url, "newTab": True}),
                    timeout=15,
                )
            elif action == "snapshot":
                result = await asyncio.wait_for(webbridge_send("snapshot", {}), timeout=15)
            elif action == "click" and selector:
                result = await asyncio.wait_for(
                    webbridge_send("click", {"selector": selector}),
                    timeout=15,
                )
            elif action == "screenshot":
                result = await asyncio.wait_for(webbridge_send("screenshot", {}), timeout=15)
            else:
                return ToolResult.fail(f"不支持的操作: {action}")
        except asyncio.TimeoutError:
            return ToolResult.fail("浏览器操作超时 (15s)")
        if result.get("ok"):
            data = result.get("data", {})
            if action == "snapshot" and "text" in data:
                return ToolResult.ok(data["text"][:2000])
            return ToolResult.ok(json.dumps(data, ensure_ascii=False, indent=2)[:2000])
        else:
            return ToolResult.fail(result.get("error", "未知错误"))


# =============================================================================
# 工具：天气查询
# =============================================================================

class GetWeatherTool(BaseTool):
    name = "get_weather"
    description = "查询天气信息。支持城市名称如「北京」「Shanghai」「London」。返回温度、湿度、风速、天气状况等。"
    parameters = {
        "type": "object",
        "properties": {
            "city": {"type": "string", "description": "城市名称，如 北京、Shanghai、Tokyo、London"}
        },
        "required": ["city"],
    }

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        from urllib.request import Request, urlopen
        from urllib.parse import quote
        city = args.get("city", "")
        if not city:
            return ToolResult.fail("city 不能为空")
        try:
            url = f"https://wttr.in/{quote(city)}?format=%C|%t|%h|%w|%p"
            req = Request(url, headers={"User-Agent": "curl/8.0"})
            with urlopen(req, timeout=10) as resp:
                raw = resp.read().decode("utf-8", errors="replace").strip()
            parts = raw.split("|")
            if len(parts) >= 1 and parts[0]:
                return ToolResult.ok(
                    f"🌍 {city} 天气\n"
                    f"状况: {parts[0]}\n"
                    f"温度: {parts[1] if len(parts) > 1 else 'N/A'}\n"
                    f"湿度: {parts[2] if len(parts) > 2 else 'N/A'}\n"
                    f"风速: {parts[3] if len(parts) > 3 else 'N/A'}\n"
                    f"降水量: {parts[4] if len(parts) > 4 else 'N/A'}"
                )
            return ToolResult.fail(f"未获取到 {city} 的天气信息")
        except Exception as e:
            return ToolResult.fail(f"天气查询失败: {e}")


# =============================================================================
# 工具：新闻查询
# =============================================================================

class GetNewsTool(BaseTool):
    name = "get_news"
    description = "获取最新新闻资讯。按关键词搜索最新新闻。返回标题、摘要、来源、发布时间。"
    parameters = {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "新闻关键词，如 科技、AI、股票、体育"},
            "max_results": {"type": "integer", "description": "返回条数", "default": 5},
        },
        "required": ["query"],
    }

    async def execute(self, args: Dict[str, Any]) -> ToolResult:
        query = args.get("query", "")
        max_results = min(args.get("max_results", 5), 10)
        if not query:
            return ToolResult.fail("query 不能为空")

        from app_config.encryption import ConfigEncryption
        from app_config.settings import CONFIG_DIR
        enc = ConfigEncryption(CONFIG_DIR)
        config = enc.load_config()
        news_api_key = config.get("_news", {}).get("api_key", "")

        if not news_api_key:
            # 没有 Key 回退到 Web 搜索
            web = WebSearchTool()
            return await web.execute({"query": f"{query} 最新新闻 {datetime.datetime.now().strftime('%Y-%m-%d')}"})

        import httpx
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(
                    "https://newsapi.org/v2/everything",
                    params={
                        "q": query, "pageSize": max_results,
                        "language": "zh", "sortBy": "publishedAt",
                        "apiKey": news_api_key,
                    },
                )
                data = resp.json()
                articles = data.get("articles", [])
                if not articles:
                    return ToolResult.ok(f"未找到关于「{query}」的新闻")
                lines = [f"📰 {query} 最新新闻:"]
                for i, a in enumerate(articles[:max_results], 1):
                    title = a.get("title", "")
                    source = a.get("source", {}).get("name", "")
                    desc = (a.get("description") or "")[:100]
                    published = (a.get("publishedAt") or "")[:10]
                    url = a.get("url", "")
                    lines.append(f"\n{i}. {title}")
                    if desc:
                        lines.append(f"   {desc}")
                    lines.append(f"   来源: {source} | {published}")
                return ToolResult.ok("\n".join(lines))
        except Exception as e:
            return ToolResult.fail(f"新闻查询失败: {e}")


# =============================================================================
# 全局注册表实例（单例）
# =============================================================================

_tool_registry: Optional[ToolRegistry] = None


def get_tool_registry() -> ToolRegistry:
    """获取全局工具注册表单例，首次调用时自动注册所有内置工具。"""
    global _tool_registry
    if _tool_registry is not None:
        return _tool_registry

    registry = ToolRegistry()

    tools = [
        GetCurrentTimeTool(),
        WebSearchTool(),
        ReadFileTool(),
        ListDirectoryTool(),
        RunCommandTool(),
        SearchMemoryTool(),
        SearchFilesTool(),
        BrowserNavigateTool(),
        GetWeatherTool(),
        GetNewsTool(),
    ]

    for t in tools:
        registry.register(t)

    _tool_registry = registry
    return _tool_registry
