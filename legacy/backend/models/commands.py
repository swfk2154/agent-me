"""命令执行 Pydantic 模型"""
from typing import Optional
from pydantic import BaseModel

class CommandExecuteRequest(BaseModel):
    command: str
    workdir: str = '.'
    timeout: int = 30
    approved: bool = False

class CommandEvaluateRequest(BaseModel):
    command: str
    workdir: str = '.'

class CommandRuleItem(BaseModel):
    prefix: list[str]
    action: str
    reason: str
