"""写作助手 API"""
from fastapi import APIRouter
from models.writing import WritingRequest
from services.writing_service import get_templates, execute

router = APIRouter(prefix="/api/writing", tags=["writing"])

@router.get("/templates")
async def list_templates():
    return get_templates()

@router.post("/execute")
async def execute_writing(req: WritingRequest):
    model_str = req.model or "openai/gpt-4o-mini"
    provider_key = "openai"
    for pkey in ["openai", "anthropic", "google", "deepseek",
                 "kimi", "minimax", "glm", "doubao", "custom"]:
        if model_str.startswith(pkey):
            provider_key = pkey
            break
    result = execute(req.template_key, req.content, model_str, provider_key)
    return {"result": result}
