"""搜索 API"""
from fastapi import APIRouter, Query
from services.search_service import search_web

router = APIRouter(prefix="/api/search", tags=["search"])

@router.get("/web")
async def web_search(q: str = Query(...), max_results: int = 5):
    return search_web(q, max_results)

@router.get("/news")
async def news_search(q: str = Query(...), max_results: int = 5):
    return search_web(q, max_results)
@router.get("/config")
async def get_config():
    from services.search_service import get_search_config
    return get_search_config()

@router.post("/config")
async def save_config(data: dict):
    from services.search_service import save_search_config
    save_search_config(data.get("active_provider", "duckduckgo"), data.get("providers", {}))
    return {"ok": True}

@router.post("/test")
async def test_provider(data: dict):
    from services.search_service import test_search_connection
    from app_config.logging_config import get_logger
    log = get_logger(__name__)
    provider_key = data.get("provider_key", "duckduckgo")
    api_key = data.get("api_key", "")
    base_url = data.get("base_url", "")
    log.info(f"Search test: provider={provider_key} api_key_len={len(api_key)} base_url={base_url}")
    ok, msg = test_search_connection(provider_key, api_key, base_url)
    log.info(f"Search test result: ok={ok} msg={msg}")
    return {"success": ok, "message": msg}