"""Agent 循环 API —— think → act → observe"""
import json, asyncio
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from services.agent_loop import agent_loop_stream
from services.memory_service import memory_service
from app_config.logging_config import get_logger

log = get_logger(__name__)
router = APIRouter(prefix="/api/agent", tags=["agent"])


class AgentRunRequest(BaseModel):
    messages: list[dict]  # [{"role": "user", "content": "..."}]
    model: str = ""
    max_iterations: int = 8
    system_prompt: str = ""


@router.post("/run")
async def run_agent(req: AgentRunRequest):
    """运行 Agent 循环，返回 SSE 流式输出"""
    from app_config.providers import PROVIDERS, PROVIDER_ORDER
    from app_config.encryption import ConfigEncryption
    from app_config.settings import CONFIG_DIR

    # 解析模型
    model_str = req.model
    provider_key = "openai"
    if model_str:
        for pk in PROVIDER_ORDER:
            if model_str.startswith(pk + "/"):
                provider_key = pk
                break
    else:
        enc = ConfigEncryption(CONFIG_DIR)
        cfg = enc.load_config()
        for pk in PROVIDER_ORDER:
            saved = cfg.get(pk, {})
            if saved.get("enabled") and saved.get("api_key"):
                models = saved.get("models", PROVIDERS[pk].get("models", []))
                if models:
                    from services.llm_service import _get_model_string
                    model_str = _get_model_string(pk, models[0])
                    provider_key = pk
                    break
        if not model_str:
            model_str = "openai/gpt-4o-mini"
            provider_key = "openai"

    profile = memory_service.get_profile()

    async def generate():
        try:
            async for chunk in agent_loop_stream(
                messages=req.messages,
                model=model_str,
                provider_key=provider_key,
                profile=profile,
                max_iterations=req.max_iterations,
            ):
                yield f"data: {json.dumps({'token': chunk})}\n\n"
        except Exception as e:
            log.error(f"Agent error: {e}")
            yield f"data: {json.dumps({'token': f'[错误: {str(e)}]'})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"},
    )


@router.get("/tools")
async def list_tools():
    """列出所有可用的 Agent 工具"""
    from services.tool_service import get_tool_registry
    registry = get_tool_registry()
    return {"tools": registry.list_specs()}
