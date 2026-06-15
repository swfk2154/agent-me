"""agent-me FastAPI 入口"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app_config.logging_config import setup_logging, LOG_DIR

logger = setup_logging()
logger.info("=" * 50)
logger.info("agent-me 启动中...")

from routes import chat, config_routes, files, memory, tasks, writing, skills, commands, search, export, browser, agent

app = FastAPI(title="agent-me", version="2.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.error(f"未捕获异常 [{request.method} {request.url.path}]: {exc}", exc_info=True)
    return JSONResponse(status_code=500, content={"detail": "内部服务器错误"})


app.include_router(chat.router)
app.include_router(config_routes.router)
app.include_router(files.router)
app.include_router(memory.router)
app.include_router(tasks.router)
app.include_router(writing.router)
app.include_router(skills.router)
app.include_router(commands.router)
app.include_router(search.router)
app.include_router(export.router)
app.include_router(browser.router)
app.include_router(agent.router)


@app.get("/api/health")
async def health():
    return {
        "status": "ok", "name": "agent-me", "version": "2.1.0",
        "features": [
            "multi_model_chat", "memory_system", "file_analysis",
            "writing_assistant", "task_management", "web_search",
            "command_execution", "skills_system", "conversation_export",
            "agent_loop", "streaming_cancel",
        ],
    }


@app.get("/api/logs")
async def view_logs(type: str = "all", lines: int = 100):
    lines = min(max(lines, 1), 5000)
    path = LOG_DIR / ("errors.log" if type == "errors" else "agent-me.log")
    if not path.exists():
        return {"logs": [], "message": "暂无日志"}
    log_lines = _tail(path, lines)
    return {"logs": log_lines, "file": path.name, "total_lines": "?"}


def _tail(path: Path, n: int) -> list[str]:
    """从文件尾部读取最后 n 行，避免大文件全量读入内存"""
    chunk_size = 1024
    with open(path, "rb") as f:
        f.seek(0, 2)
        total_bytes = f.tell()
        data = []
        pos = total_bytes
        while len(data) < n and pos > 0:
            read_size = min(chunk_size, pos)
            pos -= read_size
            f.seek(pos)
            buf = f.read(read_size)
            data = buf.split(b"\n") + data
        lines = []
        for b_line in data[-n:]:
            try:
                lines.append(b_line.decode("utf-8", errors="replace"))
            except Exception:
                lines.append("")
        return lines


logger.info("所有路由加载完成")
logger.info("agent-me 启动就绪")
