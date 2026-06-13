"""配置相关 Pydantic 模型"""
from typing import Optional
from pydantic import BaseModel

class ProviderConfig(BaseModel):
    provider_key: str
    api_key: str = ''
    enabled: bool = False
    is_default: bool = False
    models: list[str] = []
    base_url: Optional[str] = None

class TestConnectionRequest(BaseModel):
    provider_key: str
    api_key: Optional[str] = None
    base_url: Optional[str] = None
    model: Optional[str] = None

class SetDefaultRequest(BaseModel):
    provider_key: str
