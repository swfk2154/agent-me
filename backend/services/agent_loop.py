"""Agent 循环 v2.0：think → act → observe
参考 smolagents CodeAgent + OpenAI Agents SDK + LangGraph 最佳实践
- 8+ 实用工具（文件/命令/浏览器/搜索）
- 参数验证 + 超时控制
- 并行工具调用
- 递归限制 + 成本 ceiling
"""
import json, asyncio, os
from pathlib import Path
from typing import AsyncGenerator
from datetime import datetime
from services.llm_client import acompletion
from services.llm_service import chat_stream, _get_llm_kwargs, _build_system_prompt
from services.search_service import search_web
from services.memory_service import memory_service
from services.command_service import command_service
from services.webbridge_service import send_command as webbridge_send


# ========== 工具定义（MCP 兼容格式）==========

AGENT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_current_time",
            "description": "获取当前日期和时间。用于回答需要时间信息的问题。",
            "parameters": {"type": "object", "properties": {}},
        }
    },
    {
        "type": "function",
        "function": {
            "name": "web_search",
            "description": "搜索互联网获取最新信息、新闻、数据。当你需要查找实时信息时使用。",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "搜索关键词"}
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "read_file",
            "description": "读取本地文件内容。用于查看代码、配置文件、日志等。限制 100KB。",
            "parameters": {
                "type": "object",
                "properties": {
                    "file_path": {"type": "string", "description": "文件绝对路径或相对路径"},
                    "offset": {"type": "integer", "description": "起始行号（从0开始）", "default": 0},
                    "limit": {"type": "integer", "description": "读取行数，默认100", "default": 100},
                },
                "required": ["file_path"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "list_directory",
            "description": "列出目录中的文件和子目录。用于探索项目结构。",
            "parameters": {
                "type": "object",
                "properties": {
                    "dir_path": {"type": "string", "description": "目录路径，默认当前目录", "default": "."},
                    "max_depth": {"type": "integer", "description": "最大递归深度，默认1", "default": 1},
                },
                "required": []
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "run_command",
            "description": "执行安全的终端命令（如 ls, cat, grep, git status, python --version）。危险命令会被自动阻止。",
            "parameters": {
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "要执行的命令"},
                    "workdir": {"type": "string", "description": "工作目录，默认当前目录", "default": "."},
                },
                "required": ["command"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_memory",
            "description": "从用户的长期记忆（历史对话、事实、偏好）中检索相关信息。",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "记忆搜索词"}
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "search_files",
            "description": "从用户上传的文件（PDF/DOCX/TXT）中检索相关信息。",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {"type": "string", "description": "文件内容搜索词"}
                },
                "required": ["query"]
            }
        }
    },
    {
        "type": "function",
        "function": {
            "name": "browser_navigate",
            "description": "控制浏览器打开网页。需要先确认 Kimi WebBridge 已启动。",
            "parameters": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "要打开的网址"},
                    "action": {"type": "string", "description": "操作类型：navigate(导航)|snapshot(截图页面内容)|click(点击)|screenshot(截图)", "default": "navigate"},
                    "selector": {"type": "string", "description": "CSS选择器（click操作时使用）", "default": ""},
                },
                "required": ["url"]
            }
        }
    },
]


# ========== 工具参数验证 ==========

# 允许的文件读取根目录（从环境变量或默认值获取）
_ALLOWED_READ_ROOTS = None

def _get_allowed_roots() -> list[Path]:
    global _ALLOWED_READ_ROOTS
    if _ALLOWED_READ_ROOTS is not None:
        return _ALLOWED_READ_ROOTS
    env = os.environ.get("AGENT_ME_ALLOWED_PATHS", "")
    if env:
        _ALLOWED_READ_ROOTS = [Path(r).resolve() for r in env.split(os.pathsep) if r.strip()]
    else:
        # 默认允许：当前工作目录、用户主目录
        _ALLOWED_READ_ROOTS = [Path.cwd().resolve(), Path.home().resolve()]
    return _ALLOWED_READ_ROOTS


# 敏感路径黑名单（绝对路径或路径片段匹配）
_SENSITIVE_PATHS = [
    "Windows/System32", "Windows/SysWOW64", "Windows/Security",
    "Program Files/WindowsApps", "Windows/WinSxS",
    "/etc/shadow", "/etc/passwd", "/etc/ssh", ".ssh/",
    ".aws/", ".azure/", ".gcp/", "id_rsa", "id_ed25519",
]


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


def _validate_read_file(args: dict) -> tuple[bool, str]:
    fp = args.get("file_path", "")
    if not fp:
        return False, "file_path 不能为空"
    # 阻止路径遍历尝试
    normalized = os.path.normpath(fp)
    if ".." in normalized.split(os.sep):
        return False, "路径中不允许包含 .."
    p = Path(fp)
    if not p.exists():
        return False, f"文件不存在: {fp}"
    if not p.is_file():
        return False, f"不是文件: {fp}"
    if _is_sensitive_path(str(p)):
        return False, "该路径属于敏感区域，不允许读取"
    if not _is_under_allowed_roots(p):
        return False, f"文件不在允许读取的目录范围内。可通过环境变量 AGENT_ME_ALLOWED_PATHS 扩展。"
    if p.stat().st_size > 100 * 1024:
        return False, f"文件超过 100KB 限制: {fp}"
    return True, ""


def _validate_list_directory(args: dict) -> tuple[bool, str]:
    dp = args.get("dir_path", ".")
    max_depth = args.get("max_depth", 1)
    normalized = os.path.normpath(dp)
    if ".." in normalized.split(os.sep):
        return False, "路径中不允许包含 .."
    p = Path(dp)
    if not p.exists():
        return False, f"目录不存在: {dp}"
    if not p.is_dir():
        return False, f"不是目录: {dp}"
    if _is_sensitive_path(str(p)):
        return False, "该路径属于敏感区域，不允许访问"
    if not _is_under_allowed_roots(p):
        return False, f"目录不在允许访问的范围内。可通过环境变量 AGENT_ME_ALLOWED_PATHS 扩展。"
    if max_depth > 3:
        return False, "max_depth 不能超过 3"
    return True, ""


def _validate_run_command(args: dict) -> tuple[bool, str]:
    cmd = args.get("command", "")
    if not cmd:
        return False, "command 不能为空"
    eval_result = command_service.evaluate(cmd, args.get("workdir", "."))
    if eval_result["action"] == "never_allow":
        return False, f"命令被安全策略阻止: {eval_result.get('reason', '')}"
    if eval_result["action"] == "ask_first":
        return False, f"命令需要用户确认: {eval_result.get('reason', '')}"
    return True, ""


# ========== 工具执行 ==========

async def _tool_get_current_time(_args: dict) -> str:
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S (%A)")


async def _tool_web_search(args: dict) -> str:
    query = args.get("query", "")
    if not query:
        return "错误: query 不能为空"
    try:
        results = await asyncio.wait_for(
            asyncio.to_thread(search_web, query, max_results=5),
            timeout=15
        )
    except asyncio.TimeoutError:
        return "搜索超时 (15s)"
    if not results:
        return "未找到相关搜索结果。"
    lines = []
    for i, r in enumerate(results, 1):
        lines.append(f"{i}. {r.get('title', '')}")
        if r.get("snippet"):
            lines.append(f"   {r['snippet'][:200]}")
        if r.get("url"):
            lines.append(f"   来源: {r['url']}")
    return "\n".join(lines)


async def _tool_read_file(args: dict) -> str:
    ok, err = _validate_read_file(args)
    if not ok:
        return f"错误: {err}"
    p = Path(args["file_path"])
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
        return header + result
    except Exception as e:
        return f"读取失败: {e}"


async def _tool_list_directory(args: dict) -> str:
    ok, err = _validate_list_directory(args)
    if not ok:
        return f"错误: {err}"
    dp = args.get("dir_path", ".")
    max_depth = args.get("max_depth", 1)

    def _list(p: Path, depth: int, prefix: str = "") -> list[str]:
        lines = []
        try:
            items = sorted(p.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower()))
        except PermissionError:
            return [f"{prefix}[权限拒绝] {p.name}"]
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

    lines = [f"[目录: {Path(dp).resolve()}]"] + _list(Path(dp), 1)
    return "\n".join(lines)


async def _tool_run_command(args: dict) -> str:
    ok, err = _validate_run_command(args)
    if not ok:
        return f"错误: {err}"
    cmd = args["command"]
    workdir = args.get("workdir", ".")
    try:
        result = await asyncio.wait_for(
            asyncio.to_thread(command_service.execute, cmd, workdir, timeout=15, approved=True),
            timeout=20
        )
    except asyncio.TimeoutError:
        return "命令执行超时 (20s)"
    if result.get("success"):
        output = result.get("output", "")
        return output[-3000:] if len(output) > 3000 else output
    else:
        err_out = result.get("error", "")
        return f"命令失败: {err_out}"


async def _tool_search_memory(args: dict) -> str:
    query = args.get("query", "")
    if not query:
        return "错误: query 不能为空"
    memories = memory_service.retrieve_memories(query, k=5)
    if not memories:
        return "未找到相关记忆。"
    return "\n---\n".join(f"[{i+1}] {m}" for i, m in enumerate(memories))


async def _tool_search_files(args: dict) -> str:
    query = args.get("query", "")
    if not query:
        return "错误: query 不能为空"
    chunks = memory_service.retrieve_file_chunks(query, k=5)
    if not chunks:
        return "未找到相关文件内容。"
    return "\n---\n".join(f"[{i+1}] {c[:500]}" for i, c in enumerate(chunks))


async def _tool_browser_navigate(args: dict) -> str:
    url = args.get("url", "")
    action = args.get("action", "navigate")
    selector = args.get("selector", "")
    if not url:
        return "错误: url 不能为空"
    try:
        if action == "navigate":
            result = await asyncio.wait_for(
                webbridge_send("navigate", {"url": url, "newTab": True}),
                timeout=15
            )
        elif action == "snapshot":
            result = await asyncio.wait_for(
                webbridge_send("snapshot", {}),
                timeout=15
            )
        elif action == "click" and selector:
            result = await asyncio.wait_for(
                webbridge_send("click", {"selector": selector}),
                timeout=15
            )
        elif action == "screenshot":
            result = await asyncio.wait_for(
                webbridge_send("screenshot", {}),
                timeout=15
            )
        else:
            return f"不支持的操作: {action}"
    except asyncio.TimeoutError:
        return "浏览器操作超时 (15s)"
    if result.get("ok"):
        data = result.get("data", {})
        if action == "snapshot" and "text" in data:
            return data["text"][:2000]
        return json.dumps(data, ensure_ascii=False, indent=2)[:2000]
    else:
        return f"浏览器错误: {result.get('error', '未知错误')}"


# 工具路由表
TOOL_REGISTRY = {
    "get_current_time": _tool_get_current_time,
    "web_search": _tool_web_search,
    "read_file": _tool_read_file,
    "list_directory": _tool_list_directory,
    "run_command": _tool_run_command,
    "search_memory": _tool_search_memory,
    "search_files": _tool_search_files,
    "browser_navigate": _tool_browser_navigate,
}


async def execute_tool(name: str, args: dict) -> str:
    """执行单个工具，带错误处理"""
    handler = TOOL_REGISTRY.get(name)
    if not handler:
        return f"未知工具: {name}"
    try:
        return await handler(args)
    except Exception as e:
        return f"工具执行错误 [{name}]: {str(e)}"


# ========== Agent 主循环 ==========

async def agent_loop_stream(
    messages: list, model: str, provider_key: str,
    profile: dict = None, max_iterations: int = 8,
    cancel_event: asyncio.Event = None,
    model_params: dict = None,
    custom_prompt: str = "",
) -> AsyncGenerator[str, None]:
    """Agent 循环：支持并行工具调用、参数验证、超时控制、成本 ceiling"""
    if profile is None:
        profile = {}
    if model_params is None:
        model_params = {}

    yield "[Agent 思考中...]\n\n"
    iteration = 0
    conversation = list(messages)
    total_tool_calls = 0
    MAX_TOOL_CALLS = 15  # 成本 ceiling

    while iteration < max_iterations:
        if cancel_event and cancel_event.is_set():
            yield "\n[已取消]"
            break
        iteration += 1

        # 构建系统提示词
        kwargs = _get_llm_kwargs(provider_key)
        for k in ("temperature", "top_p", "max_tokens"):
            if model_params.get(k) is not None:
                kwargs[k] = model_params[k]

        # 检索相关记忆注入上下文
        last_user_msg = ""
        for m in reversed(conversation):
            if m.get("role") == "user":
                content = m.get("content", "")
                if isinstance(content, str):
                    last_user_msg = content
                break

        mem_context = ""
        if last_user_msg:
            memories = memory_service.retrieve_memories(last_user_msg, k=3)
            if memories:
                mem_context = "\n".join(memories)

        system = _build_system_prompt(mem_context, profile, "", "", custom_prompt)
        full_msgs = [{"role": "system", "content": system}] + conversation

        try:
            response = await acompletion(
                model=model, messages=full_msgs, tools=AGENT_TOOLS,
                tool_choice="auto", **kwargs)
        except Exception as e:
            yield f"\n[Agent 错误: {e}]"
            break

        msg = response.choices[0].message

        # 文本输出
        if msg.content:
            yield msg.content

        # 工具调用
        if msg.tool_calls:
            tool_calls = msg.tool_calls
            total_tool_calls += len(tool_calls)

            if total_tool_calls > MAX_TOOL_CALLS:
                yield f"\n\n[达到工具调用上限 {MAX_TOOL_CALLS}，停止执行]"
                break

            # 解析所有工具调用
            calls = []
            for tc in tool_calls:
                tool_name = tc.function.name
                try:
                    tool_args = json.loads(tc.function.arguments)
                except Exception:
                    tool_args = {}
                calls.append({
                    "id": tc.id,
                    "name": tool_name,
                    "args": tool_args,
                })

            # 显示正在执行的工具
            for c in calls:
                yield f"\n\n🔧 **{c['name']}**({json.dumps(c['args'], ensure_ascii=False)})"

            # 并行执行所有工具（独立的工具调用可以并行）
            results = await asyncio.gather(*[
                execute_tool(c["name"], c["args"]) for c in calls
            ])

            # 显示结果
            for c, result in zip(calls, results):
                yield f"\n> {result[:400]}{'...' if len(result) > 400 else ''}"

            # 构建 assistant 消息（包含所有 tool_calls）
            conversation.append({
                "role": "assistant",
                "content": msg.content or "",
                "tool_calls": [{
                    "id": c["id"], "type": "function",
                    "function": {"name": c["name"], "arguments": json.dumps(c["args"])}
                } for c in calls]
            })

            # 添加所有 tool 结果
            for c, result in zip(calls, results):
                conversation.append({
                    "role": "tool",
                    "content": result,
                    "tool_call_id": c["id"]
                })
        else:
            # 没有工具调用，完成
            break

    yield f"\n\n[Agent 完成 | 迭代: {iteration}/{max_iterations} | 工具调用: {total_tool_calls}]"
