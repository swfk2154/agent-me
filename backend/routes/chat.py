"""对话 API：SQLite持久化 + SSE流 + 文件RAG + 流取消 + 自动Agent判断"""
import json, asyncio, traceback
from datetime import datetime
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse
from models.chat import SendMessageRequest, CreateConversationRequest
from services.llm_service import chat_stream, _get_model_string, extract_facts, generate_summary, score_memory
from services.agent_loop import agent_loop_stream
from services.memory_service import memory_service
from services.search_service import format_search_context
from services.db_service import db
from app_config.logging_config import get_logger
from app_config.encryption import ConfigEncryption
from app_config.providers import PROVIDERS, PROVIDER_ORDER
from app_config.settings import CONFIG_DIR, FACT_EXTRACTION_INTERVAL, SUMMARY_INTERVAL

log = get_logger(__name__)
router = APIRouter(prefix="/api/chat", tags=["chat"])

# 每个 conversation 的取消事件
_cancel_events: dict[str, asyncio.Event] = {}

# 自动判断是否需要工具调用的关键词
_TOOL_KEYWORDS = [
    # 搜索
    "搜索", "查一下", "查查", "google", "百度", "必应", "查找", "查询",
    # 文件
    "读取文件", "打开文件", "查看文件", "cat ", "查看目录", "列出文件", "ls ", "dir ",
    # 命令
    "执行", "运行", "git status", "git diff", "git log", "npm ", "pip ", "python ",
    # 浏览器
    "打开网页", "浏览器", "截图", "访问网站", "打开 ", "navigate",
    # 记忆
    "搜索记忆", "回忆", "之前说过", "长期记忆",
    # 天气
    "天气", "气温", "温度", "下雨", "下雪", "台风", "刮风", "wetter", "weather",
    # 新闻
    "新闻", "资讯", "头条", "热点", "最新消息", "今天有什么", "news",
    "科技", "军事", "娱乐", "体育", "财经", "快讯", "时讯", "消息",
    # 通用任务
    "帮我查看", "帮我找", "帮我搜", "帮我运行", "帮我执行",
]


def _should_use_tools(content: str) -> bool:
    """根据用户消息内容自动判断是否需要调用工具"""
    if not content:
        return False
    lower = content.lower()
    for kw in _TOOL_KEYWORDS:
        if kw.lower() in lower:
            return True
    return False

def _resolve_model(model_str: str = "") -> tuple[str, str]:
    """解析模型字符串，未指定时查找第一个已配置的默认提供商"""
    if model_str:
        for pk in PROVIDER_ORDER:
            if model_str.startswith(pk + "/"):
                return model_str, pk
        return model_str, "openai"
    # 无指定模型：按 provider_order 查找第一个已配置的默认提供商
    enc = ConfigEncryption(CONFIG_DIR)
    cfg = enc.load_config()
    for pk in PROVIDER_ORDER:
        saved = cfg.get(pk, {})
        if saved.get("enabled") and saved.get("api_key"):
            models = saved.get("models", PROVIDERS[pk].get("models", []))
            if models:
                return _get_model_string(pk, models[0]), pk
    return "openai/gpt-4o-mini", "openai"

@router.post("/new")
async def create_conversation(req: CreateConversationRequest):
    conv = db.create_conversation(title=req.title or "新对话", model=req.model or "", system_prompt=req.system_prompt or "")
    return conv


@router.get("/list")
async def list_conversations():
    return db.list_conversations()


@router.get("/{conv_id}")
async def get_conversation(conv_id: str):
    conv = db.get_conversation(conv_id)
    if not conv:
        raise HTTPException(404, "对话不存在")
    return conv


@router.get("/{conv_id}/messages")
async def get_messages(conv_id: str, limit: int = 200):
    return db.get_messages(conv_id, limit)


@router.delete("/{conv_id}")
async def delete_conversation(conv_id: str):
    ok = db.delete_conversation(conv_id)
    memory_service.clear_short_term(conv_id)
    _cancel_events.pop(conv_id, None)
    if not ok:
        raise HTTPException(404, "对话不存在")
    return {"ok": True}


@router.post("/cancel/{conv_id}")
async def cancel_stream(conv_id: str):
    event = _cancel_events.get(conv_id)
    if event:
        event.set()
        return {"ok": True}
    return {"ok": False, "message": "没有进行中的流"}


@router.post("/send")
async def send_message(req: SendMessageRequest):
    conv_id = req.conversation_id

    conv = db.get_conversation(conv_id)
    if not conv:
        conv = db.create_conversation(title="新对话", model=req.model or "", system_prompt=req.system_prompt or "")
        conv_id = conv["id"]
    else:
        if req.system_prompt:
            db.update_conversation(conv_id, system_prompt=req.system_prompt)
        if req.model and not conv.get("model"):
            db.update_conversation(conv_id, model=req.model)

    if conv.get("title") == "新对话" and req.content:
        db.update_conversation(conv_id, title=req.content[:40])

    # 保存用户消息
    db.add_message(conv_id, "user", req.content)

    # 短时记忆
    memory_service.add_to_short_term(conv_id, "user", req.content)

    model_str, provider_key = _resolve_model(req.model or conv.get("model", ""))

    log.info(f"Chat: model={model_str} provider={provider_key} msg={req.content[:50]}")

    # 长期记忆（轻量读取）
    profile = memory_service.get_profile()
    # 文件RAG
    file_context = ""
    if req.file_ids:
        chunks = []
        for fid in req.file_ids:
            chunks.extend(memory_service.retrieve_file_chunks(req.content))
        if chunks:
            file_context = "\n\n[上传文件相关片段]\n" + "\n---\n".join(chunks)

    # Skill prompt
    skill_prompt = ""
    if req.skill_key and req.skill_key != "default":
        try:
            from services.skills_service import get_mode_prompt
            skill_prompt = get_mode_prompt(req.skill_key)
        except Exception:
            pass

    # 构建消息列表 —— 支持多模态图片
    history = memory_service.get_short_term(conv_id)
    # 如果有上传图片，构建 vision 格式
    if req.image_data:
        # 图片消息：content 为 vision 数组格式
        content_parts = [{"type": "text", "text": req.content or "请描述这张图片"}]
        for img_b64 in req.image_data:
            content_parts.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/{img_b64.get('format','png')};base64,{img_b64.get('data','')}"}
            })
        vision_msg = {"role": "user", "content": content_parts}
        history = history + [vision_msg]
    else:
        pass  # 使用普通文本消息

    # 模型参数
    model_params = req.model_params.model_dump(exclude_none=True) if req.model_params else {}

    # 取消事件
    cancel_event = asyncio.Event()
    _cancel_events[conv_id] = cancel_event

    # 创建助手空消息占位
    db.add_message(conv_id, "assistant", "")

    # 自动判断是否走 Agent 模式
    use_agent = _should_use_tools(req.content)
    if use_agent:
        log.info(f"Auto-agent triggered for conv {conv_id[:8]}: {req.content[:50]}")

    async def generate():
        full = ""
        err_msg = ""
        try:
            if use_agent:
                # Agent 模式：自动调用工具
                async for token in agent_loop_stream(
                    messages=history, model=model_str, provider_key=provider_key,
                    profile=profile, max_iterations=8,
                    cancel_event=cancel_event, model_params=model_params,
                    custom_prompt=req.system_prompt or conv.get("system_prompt", ""),
                ):
                    full += token
                    yield f"data: {json.dumps({'token': token})}\n\n"
            else:
                # 普通模式
                async for token in chat_stream(
                    messages=history, model=model_str, provider_key=provider_key,
                    long_term_context=file_context, profile=profile, search_context="",
                    skill_prompt=skill_prompt, custom_prompt=req.system_prompt or conv.get("system_prompt", ""),
                    model_params=model_params, cancel_event=cancel_event,
                ):
                    full += token
                    yield f"data: {json.dumps({'token': token})}\n\n"
        except Exception as e:
            log.error(f"Stream error: {e}\n{traceback.format_exc()}")
            err_msg = f"\n\n[错误: {str(e)}]"
            full += err_msg
            yield f"data: {json.dumps({'token': err_msg})}\n\n"
        finally:
            # 存助手消息
            try:
                db.update_last_assistant(conv_id, full)
                memory_service.add_to_short_term(conv_id, "assistant", full)

                # --- 智能记忆系统 v2.0 ---
                msg_count = memory_service.get_message_count(conv_id)

                # 1. 评分并存储本轮记忆（替代简单的逐条存储）
                memory_text = f"用户: {req.content}\n助手: {full[:500]}"
                importance = score_memory(memory_text, model_str, provider_key)
                if importance >= 5:
                    memory_service.store_memory(memory_text, importance=importance)

                # 2. 事实提取（每 FACT_EXTRACTION_INTERVAL 轮一次）
                if msg_count % (FACT_EXTRACTION_INTERVAL * 2) == 0 and msg_count > 0:
                    try:
                        history_text = "\n".join(
                            f"{m['role']}: {str(m['content'])[:200]}"
                            for m in memory_service.get_short_term(conv_id)[-10:]
                        )
                        facts = extract_facts(history_text, model_str, provider_key)
                        if facts:
                            memory_service.merge_facts_into_profile(facts)
                            log.info(f"Extracted {len(facts)} facts from conv {conv_id[:8]}")
                    except Exception as e:
                        log.error(f"Fact extraction error: {e}")

                # 3. 会话摘要（每 SUMMARY_INTERVAL 轮一次）
                if msg_count % (SUMMARY_INTERVAL * 2) == 0 and msg_count > 0:
                    try:
                        msgs = db.get_messages(conv_id, limit=20)
                        summary = generate_summary(msgs, model_str, provider_key)
                        if summary:
                            memory_service.store_summary(conv_id, summary)
                            log.info(f"Generated summary for conv {conv_id[:8]}: {summary[:50]}")
                    except Exception as e:
                        log.error(f"Summary generation error: {e}")

            except Exception as e:
                log.error(f"Memory store error: {e}")
            _cancel_events.pop(conv_id, None)
            yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream",
                             headers={"X-Accel-Buffering": "no", "Cache-Control": "no-cache"})
