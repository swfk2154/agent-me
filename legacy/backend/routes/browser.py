"""Kimi WebBridge 浏览器控制 API"""
from fastapi import APIRouter
from pydantic import BaseModel
from services.webbridge_service import send_command_sync, get_status, ACTIONS

router = APIRouter(prefix="/api/browser", tags=["browser"])


class BrowserCommand(BaseModel):
    action: str
    args: dict = {}
    session: str = "agent-me"


@router.get("/status")
async def browser_status():
    """检查 WebBridge 运行状态"""
    status = get_status()
    return {"status": "connected" if status.get("running") else "disconnected", **status}


@router.get("/actions")
async def list_actions():
    """列出所有可用的浏览器操作"""
    return ACTIONS


@router.post("/command")
async def browser_command(req: BrowserCommand):
    """发送浏览器命令"""
    if req.action not in ACTIONS:
        return {"ok": False, "error": f"未知操作: {req.action}，可用: {list(ACTIONS.keys())}"}
    result = send_command_sync(req.action, req.args, req.session)
    return result


@router.post("/navigate")
async def browser_navigate(url: str, new_tab: bool = True, session: str = "agent-me"):
    """快捷打开网页"""
    return send_command_sync("navigate", {"url": url, "newTab": new_tab}, session)


@router.post("/snapshot")
async def browser_snapshot(session: str = "agent-me"):
    """获取页面元素"""
    return send_command_sync("snapshot", {}, session)


@router.post("/click")
async def browser_click(selector: str, session: str = "agent-me"):
    """点击元素"""
    return send_command_sync("click", {"selector": selector}, session)


@router.post("/fill")
async def browser_fill(selector: str, value: str, session: str = "agent-me"):
    """填写表单"""
    return send_command_sync("fill", {"selector": selector, "value": value}, session)


@router.post("/screenshot")
async def browser_screenshot(format: str = "png", session: str = "agent-me"):
    """截图"""
    return send_command_sync("screenshot", {"format": format}, session)


@router.post("/evaluate")
async def browser_evaluate(expression: str, session: str = "agent-me"):
    """执行 JavaScript"""
    return send_command_sync("evaluate", {"expression": expression}, session)
