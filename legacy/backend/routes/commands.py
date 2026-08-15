"""命令执行 API —— 安全审批 + 执行"""
from fastapi import APIRouter, HTTPException
from models.commands import CommandExecuteRequest, CommandEvaluateRequest, CommandRuleItem
from services.command_service import command_service

router = APIRouter(prefix="/api/commands", tags=["commands"])

@router.post("/evaluate")
async def evaluate_command(req: CommandEvaluateRequest):
    return command_service.evaluate(req.command, req.workdir)

@router.post("/execute")
async def execute_command(req: CommandExecuteRequest):
    result = command_service.execute(
        req.command, req.workdir, req.timeout, req.approved,
    )
    if result.get("needs_approval"):
        return result  # 返回审批请求，不执行
    return result

@router.get("/rules")
async def get_rules():
    return command_service.get_rules()

@router.post("/rules")
async def save_rules(rules: list[CommandRuleItem]):
    command_service.save_rules([r.model_dump() for r in rules])
    return {"ok": True}

@router.post("/rules/reset")
async def reset_rules():
    command_service.reset_rules()
    return {"ok": True}

@router.get("/log")
async def get_log(limit: int = 50):
    return command_service.get_log(limit)