"""聊天相关 Pydantic 模型"""
from typing import Optional
from pydantic import BaseModel, Field

class ModelParams(BaseModel):
    temperature: Optional[float] = Field(None, ge=0, le=2)
    top_p: Optional[float] = Field(None, ge=0, le=1)
    max_tokens: Optional[int] = Field(None, ge=1, le=200000)
    presence_penalty: Optional[float] = Field(None, ge=-2, le=2)
    frequency_penalty: Optional[float] = Field(None, ge=-2, le=2)

class ImageData(BaseModel):
    data: str = ""       # base64 编码
    format: str = "png"  # png/jpeg/webp


class SendMessageRequest(BaseModel):
    conversation_id: str
    content: str
    model: Optional[str] = None
    model_params: Optional[ModelParams] = None
    system_prompt: Optional[str] = None
    skill_key: Optional[str] = None
    search_enabled: bool = False
    file_ids: list[str] = []
    image_data: Optional[list[ImageData]] = None  # 多模态图片

class CreateConversationRequest(BaseModel):
    title: Optional[str] = '新对话'
    model: Optional[str] = None
    system_prompt: Optional[str] = None
