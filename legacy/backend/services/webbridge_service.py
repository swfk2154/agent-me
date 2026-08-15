"""Kimi WebBridge 浏览器控制服务 —— HTTP API 封装"""
import json
import os
from pathlib import Path
import httpx

WEBBRIDGE_URL = "http://127.0.0.1:10086/command"


def _discover_webbridge_bin() -> Path | None:
    """自动发现 Kimi WebBridge 可执行文件路径"""
    # 1. 环境变量优先
    env_path = os.environ.get("AGENT_ME_WEBBRIDGE_PATH", "")
    if env_path:
        p = Path(env_path)
        if p.exists():
            return p
    # 2. 常见安装路径
    home = Path.home()
    candidates = [
        home / ".kimi-webbridge" / "bin" / "kimi-webbridge.exe",
        home / "AppData" / "Local" / "kimi-webbridge" / "kimi-webbridge.exe",
        Path("/usr/local/bin/kimi-webbridge"),
        Path("/opt/kimi-webbridge/bin/kimi-webbridge"),
    ]
    for c in candidates:
        if c.exists():
            return c
    return None


WEBBRIDGE_BIN = _discover_webbridge_bin()

ACTIONS = {
    "navigate": {"desc": "打开网页", "args": {"url": "string (必填)", "newTab": "bool", "session": "string"}},
    "snapshot": {"desc": "获取页面可访问性树和元素引用", "args": {"session": "string"}},
    "click": {"desc": "点击元素", "args": {"selector": "string (CSS选择器或 @e 引用)", "session": "string"}},
    "fill": {"desc": "填写输入框", "args": {"selector": "string", "value": "string", "session": "string"}},
    "evaluate": {"desc": "执行 JavaScript", "args": {"expression": "string", "session": "string"}},
    "screenshot": {"desc": "页面截图", "args": {"format": "png/jpeg", "session": "string"}},
    "network": {"desc": "查看网络请求", "args": {"session": "string"}},
    "list_tabs": {"desc": "列出所有标签页", "args": {}},
    "close_tab": {"desc": "关闭标签页", "args": {"session": "string"}},
}


async def send_command(action: str, args: dict = None, session: str = "agent-me",
                       timeout: int = 30) -> dict:
    """向 Kimi WebBridge 发送命令"""
    if args is None:
        args = {}
    if "session" not in args and session:
        args["session"] = session
    payload = {"action": action, "args": args, "session": session}
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            resp = await client.post(WEBBRIDGE_URL, json=payload)
            if resp.status_code == 200:
                return {"ok": True, "data": resp.json() if resp.text else {}}
            return {"ok": False, "error": f"HTTP {resp.status_code}: {resp.text[:500]}"}
    except httpx.ConnectError:
        return {"ok": False, "error": "WebBridge 服务未运行。请在 Kimi WebBridge 中手动 start。"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def send_command_sync(action: str, args: dict = None, session: str = "agent-me",
                      timeout: int = 30) -> dict:
    """同步版本，用于路由"""
    if args is None:
        args = {}
    if "session" not in args and session:
        args["session"] = session
    payload = {"action": action, "args": args, "session": session}
    try:
        resp = httpx.post(WEBBRIDGE_URL, json=payload, timeout=timeout)
        if resp.status_code == 200:
            return {"ok": True, "data": resp.json() if resp.text else {}}
        return {"ok": False, "error": f"HTTP {resp.status_code}: {resp.text[:500]}"}
    except httpx.ConnectError:
        return {"ok": False, "error": "WebBridge 服务未运行"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def get_status() -> dict:
    """检查 WebBridge 运行状态"""
    try:
        resp = httpx.get("http://127.0.0.1:10086/status", timeout=3)
        if resp.status_code == 200:
            return {"running": True, **resp.json()}
        return {"running": False, "error": f"HTTP {resp.status_code}"}
    except Exception:
        # 尝试用 CLI 检查
        if WEBBRIDGE_BIN and WEBBRIDGE_BIN.exists():
            import subprocess
            try:
                r = subprocess.run([str(WEBBRIDGE_BIN), "status"], capture_output=True, text=True, timeout=5)
                return {"running": "running: true" in r.stdout.lower(), "raw": r.stdout}
            except Exception:
                pass
        return {"running": False, "error": "WebBridge 未响应。请安装 Kimi WebBridge（github.com/your-org/kimi-webbridge）并运行 start 命令。"}
