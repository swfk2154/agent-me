"""任务 CRUD API"""
from fastapi import APIRouter, HTTPException
from models.tasks import TaskCreateRequest, TaskUpdateRequest
from services.task_service import TaskService

router = APIRouter(prefix="/api/tasks", tags=["tasks"])
task_service = TaskService()

@router.get("/list")
async def list_tasks():
    return task_service.list_tasks()

@router.post("/create")
async def create_task(req: TaskCreateRequest):
    return task_service.create_task(
        title=req.title, description=req.description, due_date=req.due_date,
    )

@router.put("/{task_id}")
async def update_task(task_id: str, req: TaskUpdateRequest):
    result = task_service.update_task(
        task_id,
        title=req.title,
        description=req.description,
        completed=req.completed,
        due_date=req.due_date,
    )
    if result is None:
        raise HTTPException(404, "任务不存在")
    return result

@router.delete("/{task_id}")
async def delete_task(task_id: str):
    ok = task_service.delete_task(task_id)
    if not ok:
        raise HTTPException(404, "任务不存在")
    return {"ok": True}
