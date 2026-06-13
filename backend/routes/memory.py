"""记忆 + 画像 API"""
from fastapi import APIRouter
from services.memory_service import memory_service

router = APIRouter(prefix="/api/memory", tags=["memory"])


@router.get("/search")
async def search_memories(q: str = ""):
    results = memory_service.search_memories(q) if q else []
    return results


@router.delete("/clear")
async def clear_memory():
    memory_service.clear_long_term()
    return {"ok": True}


@router.get("/profile")
async def get_profile():
    return memory_service.get_profile()


@router.post("/profile")
async def update_profile(updates: dict):
    memory_service.update_profile(updates)
    return {"ok": True}


@router.post("/cleanup")
async def cleanup_memories(max_age_days: int = 90, min_importance: int = 3):
    """清理过期的低重要性记忆"""
    deleted = memory_service.cleanup_old_memories(max_age_days, min_importance)
    return {"ok": True, "deleted": deleted}


@router.get("/stats")
async def memory_stats():
    """获取记忆系统统计"""
    try:
        count = memory_service.memory_collection.count()
    except Exception:
        count = 0
    return {
        "total_memories": count,
        "short_term_sessions": len(memory_service.short_term),
    }
