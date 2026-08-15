"""任务服务：JSON 文件持久化 CRUD"""
import json
import uuid
import threading
from datetime import datetime
from app_config.settings import TASKS_PATH

class TaskService:
    def __init__(self):
        self._lock = threading.Lock()
        self._ensure_file()

    def _ensure_file(self):
        if not TASKS_PATH.exists():
            with open(TASKS_PATH, "w", encoding="utf-8") as f:
                json.dump([], f)

    def _load(self) -> list:
        with self._lock:
            with open(TASKS_PATH, "r", encoding="utf-8") as f:
                return json.load(f)

    def _save(self, tasks: list):
        with self._lock:
            with open(TASKS_PATH, "w", encoding="utf-8") as f:
                json.dump(tasks, f, ensure_ascii=False, indent=2)

    def list_tasks(self) -> list[dict]:
        return sorted(self._load(), key=lambda t: t.get("created_at", ""))

    def create_task(self, title: str, description: str = "",
                    due_date: str = None) -> dict:
        tasks = self._load()
        task = {
            "id": str(uuid.uuid4()),
            "title": title,
            "description": description,
            "completed": False,
            "created_at": datetime.now().isoformat(),
            "due_date": due_date,
        }
        tasks.append(task)
        self._save(tasks)
        return task

    def update_task(self, task_id: str, **kwargs) -> dict | None:
        tasks = self._load()
        for task in tasks:
            if task["id"] == task_id:
                for k, v in kwargs.items():
                    if v is not None:
                        task[k] = v
                if "completed" in kwargs and kwargs["completed"]:
                    task["completed_at"] = datetime.now().isoformat()
                self._save(tasks)
                return task
        return None

    def delete_task(self, task_id: str) -> bool:
        tasks = self._load()
        new_tasks = [t for t in tasks if t["id"] != task_id]
        if len(new_tasks) == len(tasks):
            return False
        self._save(new_tasks)
        return True
