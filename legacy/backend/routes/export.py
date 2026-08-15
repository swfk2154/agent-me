"""导出 API"""
from fastapi import APIRouter, Query
from services.db_service import db

router = APIRouter(prefix="/api/export", tags=["export"])


@router.get("/{conv_id}")
async def export_conversation(conv_id: str, fmt: str = Query("markdown", alias="format")):
    data = db.export_conversation(conv_id)
    if not data:
        return {"error": "对话不存在"}
    conv = data["conversation"]
    msgs = data["messages"]

    if fmt == "json":
        return data

    # Markdown format
    lines = [f"# {conv['title']}", "", f"日期: {conv['created_at']}", f"模型: {conv.get('model', 'N/A')}", "", "---", ""]
    for m in msgs:
        role_label = "👤 用户" if m["role"] == "user" else "🤖 助手"
        lines.append(f"### {role_label} ({m['created_at']})")
        lines.append("")
        lines.append(m["content"])
        lines.append("")
        lines.append("---")
        lines.append("")
    return {"format": "markdown", "content": "\n".join(lines), "title": conv["title"]}
