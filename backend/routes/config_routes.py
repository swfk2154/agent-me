"""配置管理 API：提供商 CRUD + 测试连接 —— API Key 永不出后端"""
from fastapi import APIRouter, HTTPException
from app_config.encryption import ConfigEncryption
from app_config.providers import PROVIDERS, PROVIDER_ORDER
from app_config.settings import CONFIG_DIR
from models.config import ProviderConfig, TestConnectionRequest, SetDefaultRequest
from services.llm_service import test_connection

router = APIRouter(prefix="/api/config", tags=["config"])
_encrypt = ConfigEncryption(CONFIG_DIR)


@router.get("/providers")
async def list_providers():
    config = _encrypt.load_config()
    result = []
    for key in PROVIDER_ORDER:
        info = PROVIDERS[key]
        saved = config.get(key, {})
        user_models = saved.get("models", info.get("models", []))
        api_key = saved.get("api_key", "")
        result.append({
            "key": key, "name": info["name"],
            "base_url": info.get("base_url", ""),
            "api_key_url": info.get("api_key_url", ""),
            "models": user_models,
            "enabled": saved.get("enabled", False),
            "is_default": saved.get("is_default", False),
            "configured": bool(api_key),
            "masked_key": ConfigEncryption.mask_key(api_key),
            "is_custom": info.get("is_custom", False),
            "supports_tools": info.get("supports_tools", True),
        })
    return result


@router.get("/provider/{provider_key}")
async def get_provider(provider_key: str):
    if provider_key not in PROVIDERS:
        raise HTTPException(404, "Provider not found")
    config = _encrypt.load_config()
    saved = config.get(provider_key, {})
    api_key = saved.get("api_key", "")
    return {
        "enabled": saved.get("enabled", False),
        "models": saved.get("models", PROVIDERS[provider_key].get("models", [])),
        "is_default": saved.get("is_default", False),
        "masked_key": ConfigEncryption.mask_key(api_key),
        "base_url": saved.get("base_url", ""),
        "configured": bool(api_key),
    }


@router.post("/provider")
async def save_provider(provider: ProviderConfig):
    if provider.provider_key not in PROVIDERS:
        raise HTTPException(404, "Provider not found")
    config = _encrypt.load_config()
    entry = {
        "api_key": provider.api_key,
        "enabled": provider.enabled,
        "is_default": provider.is_default,
        "models": provider.models,
    }
    if provider.base_url:
        entry["base_url"] = provider.base_url
    config[provider.provider_key] = entry
    if provider.is_default:
        for k in config:
            config[k]["is_default"] = (k == provider.provider_key)
    _encrypt.save_config(config)
    return {"ok": True}


@router.post("/test")
async def test_provider(req: TestConnectionRequest):
    api_key = req.api_key
    if not api_key and req.provider_key in PROVIDERS:
        config = _encrypt.load_config()
        api_key = config.get(req.provider_key, {}).get("api_key", "")
    if not api_key:
        return {"success": False, "message": "请提供 API Key"}
    ok, msg = test_connection(req.provider_key, api_key, req.base_url, req.model)
    return {"success": ok, "message": msg}


@router.get("/models")
async def available_models():
    config = _encrypt.load_config()
    models = []
    for key in PROVIDER_ORDER:
        saved = config.get(key, {})
        if saved.get("enabled") and saved.get("api_key"):
            from services.llm_service import _get_model_string
            provider_models = saved.get("models") or PROVIDERS[key].get("models", [])
            for m in provider_models:
                full = _get_model_string(key, m)
                models.append({"value": full, "label": f"{PROVIDERS[key]['name']} - {m}", "provider": key})
    if not models:
        for key in PROVIDER_ORDER:
            saved = config.get(key, {})
            if saved.get("enabled") and saved.get("api_key"):
                provider_models = saved.get("models") or PROVIDERS[key].get("models", [])
                if provider_models:
                    from services.llm_service import _get_model_string
                    full = _get_model_string(key, provider_models[0])
                    models.append({"value": full, "label": f"{PROVIDERS[key]['name']} - {provider_models[0]}", "provider": key})
                    break
    if not models:
        models.append({"value": "openai/gpt-4o-mini", "label": "OpenAI - gpt-4o-mini", "provider": "openai"})
    return models


@router.post("/default")
async def set_default(req: SetDefaultRequest):
    config = _encrypt.load_config()
    if req.provider_key not in config or not config[req.provider_key].get("api_key"):
        raise HTTPException(400, "请先配置该提供商的 API Key")
    for k in config:
        config[k]["is_default"] = (k == req.provider_key)
    _encrypt.save_config(config)
    models_list = config[req.provider_key].get("models", [])
    default_model = models_list[0] if models_list else "gpt-4o-mini"
    return {"success": True, "model": f"{req.provider_key}/{default_model}"}
