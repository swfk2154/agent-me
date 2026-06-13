"""日志配置 —— 同时输出到控制台和文件"""
import logging
import sys
from pathlib import Path
from logging.handlers import RotatingFileHandler

LOG_DIR = Path(__file__).resolve().parent.parent / "storage" / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)

def setup_logging():
    logger = logging.getLogger("agent-me")
    logger.setLevel(logging.DEBUG)
    logger.handlers.clear()

    # 控制台 handler
    console = logging.StreamHandler(sys.stdout)
    console.setLevel(logging.INFO)
    console.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(message)s", "%H:%M:%S"))
    logger.addHandler(console)

    # 完整日志文件（滚动，最多 5MB x 3 个文件）
    file_handler = RotatingFileHandler(
        LOG_DIR / "agent-me.log", maxBytes=5*1024*1024, backupCount=3, encoding="utf-8"
    )
    file_handler.setLevel(logging.DEBUG)
    file_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(name)s:%(lineno)d %(message)s"))
    logger.addHandler(file_handler)

    # 错误日志文件
    error_handler = RotatingFileHandler(
        LOG_DIR / "errors.log", maxBytes=2*1024*1024, backupCount=2, encoding="utf-8"
    )
    error_handler.setLevel(logging.ERROR)
    error_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(name)s:%(lineno)d %(message)s"))
    logger.addHandler(error_handler)

    return logger

def get_logger(name: str = "agent-me") -> logging.Logger:
    return logging.getLogger(name)