"""文件处理服务：PDF/DOCX/TXT 解析、切片、入库"""
import uuid
import re
from pathlib import Path
from app_config.settings import UPLOADS_DIR, FILE_CHUNK_SIZE, FILE_CHUNK_OVERLAP

class FileService:
    ALLOWED_TYPES = {
        ".pdf": "pdf", ".docx": "docx", ".doc": "docx",
        ".txt": "txt", ".md": "txt",
    }

    @staticmethod
    def allowed(filename: str) -> bool:
        return Path(filename).suffix.lower() in FileService.ALLOWED_TYPES

    @staticmethod
    def get_type(filename: str) -> str:
        return FileService.ALLOWED_TYPES.get(Path(filename).suffix.lower(), "unknown")

    async def extract_text(self, file_path: str, file_type: str) -> str:
        if file_type == "pdf":
            return self._extract_pdf(file_path)
        elif file_type == "docx":
            return self._extract_docx(file_path)
        elif file_type == "txt":
            return self._extract_txt(file_path)
        return ""

    def _extract_pdf(self, path: str) -> str:
        try:
            import pdfplumber
            text = ""
            with pdfplumber.open(path) as pdf:
                for page in pdf.pages:
                    page_text = page.extract_text()
                    if page_text:
                        text += page_text + "\n"
            return text.strip()
        except ImportError:
            try:
                from PyPDF2 import PdfReader
                reader = PdfReader(path)
                return "\n".join(
                    page.extract_text() or "" for page in reader.pages
                ).strip()
            except ImportError:
                return "[错误] 未安装 PDF 解析库 (pdfplumber 或 PyPDF2)"

    def _extract_docx(self, path: str) -> str:
        try:
            from docx import Document
            doc = Document(path)
            return "\n".join(p.text for p in doc.paragraphs if p.text.strip())
        except ImportError:
            return "[错误] 未安装 python-docx"

    def _extract_txt(self, path: str) -> str:
        for enc in ["utf-8", "gbk", "gb2312", "latin-1"]:
            try:
                with open(path, "r", encoding=enc) as f:
                    return f.read()
            except (UnicodeDecodeError, UnicodeError):
                continue
        return "[错误] 无法识别文件编码"

    @staticmethod
    def chunk_text(text: str, chunk_size: int = FILE_CHUNK_SIZE,
                   overlap: int = FILE_CHUNK_OVERLAP) -> list[str]:
        """按句子边界切片，避免在词中间截断"""
        sentences = re.split(r"(?<=[。！？.!?\n])", text)
        chunks = []
        current = ""
        for sent in sentences:
            if len(current) + len(sent) <= chunk_size:
                current += sent
            else:
                if current:
                    chunks.append(current.strip())
                if overlap:
                    current = (current[-overlap:] if current else "") + sent
                else:
                    current = sent
                while len(current) > chunk_size:
                    chunks.append(current[:chunk_size].strip())
                    current = current[chunk_size - overlap:] if overlap else current[chunk_size:]
        if current.strip():
            chunks.append(current.strip())
        return chunks
