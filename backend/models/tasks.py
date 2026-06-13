"""任务模型"""
from typing import Optional
from pydantic import BaseModel

class TaskCreateRequest(BaseModel):
    title: str
    description: str = ''
    due_date: Optional[str] = None

class TaskUpdateRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    completed: Optional[bool] = None
    due_date: Optional[str] = None
