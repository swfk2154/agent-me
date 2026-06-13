"""文件上传 + 分析 API"""
import uuid
import asyncio
from pathlib import Path
from fastapi import APIRouter, UploadFile, File, HTTPException
from services.file_service import FileService
from services.memory_service import memory_service
from app_config.settings import UPLOADS_DIR, MAX_UPLOAD_SIZE

router = APIRouter(prefix="/api/files", tags=["files"])
file_service = FileService()

# 文件魔数验证
FILE_MAGIC = {
    b"%PDF": "pdf",
    b"PK": "docx",  # ZIP-based formats (DOCX)
}


def _validate_content(content: bytes, expected_type: str) -> bool:
    """验证文件内容魔数"""
    if expected_type == "txt":
        # 文本文件：尝试 UTF-8 解码，无异常则为有效文本
        try:
            content.decode("utf-8")
            return True
        except UnicodeDecodeError:
            return False
    for magic, ftype in FILE_MAGIC.items():
        if content.startswith(magic):
            return ftype == expected_type
    return False


@router.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    if not file.filename or not FileService.allowed(file.filename):
        raise HTTPException(400, "不支持的文件格式，请上传 PDF / DOCX / TXT")

    content = await file.read()
    if len(content) > MAX_UPLOAD_SIZE:
        raise HTTPException(400, f"文件过大，最大 {MAX_UPLOAD_SIZE // 1024 // 1024}MB")

    # 验证文件内容
    file_type = FileService.get_type(file.filename)
    if not _validate_content(content, file_type):
        raise HTTPException(400, "文件内容与实际格式不符")

    file_id = str(uuid.uuid4())
    ext = Path(file.filename).suffix
    save_path = UPLOADS_DIR / f"{file_id}{ext}"

    # 异步保存文件，避免阻塞事件循环
    await asyncio.to_thread(save_path.write_bytes, content)

    text = await file_service.extract_text(str(save_path), file_type)
    chunks = FileService.chunk_text(text)
    memory_service.store_file_chunks(chunks, {
        "file_id": file_id, "filename": file.filename,
        "file_type": file_type, "chunk_count": len(chunks),
    })
    return {
        "id": file_id, "filename": file.filename,
        "file_type": file_type, "chunk_count": len(chunks),
        "preview": text[:300],
    }


@router.get("/list")
async def list_files():
    return memory_service.list_files()


@router.delete("/{file_id}")
async def delete_file(file_id: str):
    # 清理上传目录中的文件
    await asyncio.to_thread(_delete_uploaded_file, file_id)
    return {"ok": True}


def _delete_uploaded_file(file_id: str):
    for f in UPLOADS_DIR.iterdir():
        if f.stem == file_id:
            f.unlink(missing_ok=True)
