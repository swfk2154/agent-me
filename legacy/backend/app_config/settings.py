"""应用全局设置 —— 相对路径，无硬编码"""
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
STORAGE_DIR = BASE_DIR / "storage"
CONFIG_DIR = STORAGE_DIR
CHROMA_DIR = STORAGE_DIR / "chroma"
UPLOADS_DIR = STORAGE_DIR / "uploads"
PROFILE_PATH = STORAGE_DIR / "profile.json"
TASKS_PATH = STORAGE_DIR / "tasks.json"
DB_PATH = STORAGE_DIR / "agent-me.db"

for d in [CONFIG_DIR, CHROMA_DIR, UPLOADS_DIR]:
    d.mkdir(parents=True, exist_ok=True)

SHORT_TERM_MAX_ROUNDS = 50
LONG_TERM_TOP_K = 5
FILE_CHUNK_SIZE = 500
FILE_CHUNK_OVERLAP = 100
EMBEDDING_MODEL = "all-MiniLM-L6-v2"
CHROMA_MEMORY_COLLECTION = "long_term_memory"
CHROMA_FILES_COLLECTION = "uploaded_files"
MAX_UPLOAD_SIZE = 10 * 1024 * 1024

# 记忆系统升级配置
MEMORY_DECAY_DAYS = 30          # 记忆衰减半衰期（天）
MEMORY_IMPORTANCE_MIN = 5       # 存入长期记忆的最低重要性阈值
FACT_EXTRACTION_INTERVAL = 5    # 每 N 轮对话提取一次事实
SUMMARY_INTERVAL = 10           # 每 N 轮对话生成一次摘要
