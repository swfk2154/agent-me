"""写作助手模型"""
from typing import Optional
from pydantic import BaseModel

class WritingRequest(BaseModel):
    template_key: str
    content: str
    model: Optional[str] = None
