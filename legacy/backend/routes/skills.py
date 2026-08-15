"""技能模式 API"""
from fastapi import APIRouter
from services.skills_service import get_modes, get_mode_prompt, SYSTEM_PRESETS

router = APIRouter(prefix="/api/skills", tags=["skills"])


@router.get("/modes")
async def list_modes():
    return get_modes()


@router.get("/{mode_key}")
async def mode_detail(mode_key: str):
    mode = SYSTEM_PRESETS.get(mode_key)
    if not mode:
        return {"error": "未知技能模式"}
    return {"key": mode_key, "name": mode["name"], "description": mode["description"],
            "prompt": mode["prompt_addon"]}
