"""LiteLLM 统一调用封装 —— 含 token 预算截断 + Anthropic prompt caching"""
import asyncio, json
from typing import AsyncGenerator, Optional
import litellm
from app_config.encryption import ConfigEncryption
from app_config.providers import PROVIDERS
from app_config.settings import CONFIG_DIR

_encryption = ConfigEncryption(CONFIG_DIR)

# Token 预算配置
MAX_CONTEXT_CHARS = 32000   # 约 8k tokens (中文字符密度)
MAX_HISTORY_MESSAGES = 20   # 最多保留的消息对数


def _get_model_string(provider_key: str, model_name: str) -> str:
    provider = PROVIDERS.get(provider_key)
    if not provider: raise ValueError(f"未知的提供商: {provider_key}")
    prefix = provider["litellm_prefix"]
    return model_name if model_name.startswith(prefix) else f"{prefix}{model_name}"


def _get_llm_kwargs(provider_key: str) -> dict:
    config = _encryption.load_config()
    saved = config.get(provider_key, {})
    kwargs = {"api_key": saved.get("api_key", "")}
    info = PROVIDERS.get(provider_key, {})
    if info.get("base_url") and not info.get("is_native", True):
        kwargs["api_base"] = saved.get("base_url") or info["base_url"]
    return kwargs


def _estimate_tokens(text: str) -> int:
    """粗略估算 token 数：英文≈0.25/字，中文≈0.5/字"""
    cn_chars = sum(1 for c in text if "一" <= c <= "鿿")
    en_chars = len(text) - cn_chars
    return int(en_chars * 0.25 + cn_chars * 0.5)


def _truncate_history(messages: list, max_chars: int = MAX_CONTEXT_CHARS,
                      max_msgs: int = MAX_HISTORY_MESSAGES) -> list:
    """按字符预算截断历史消息，保留最近对话"""
    if not messages:
        return messages

    # 先按消息数截断
    trimmed = messages[-max_msgs:] if len(messages) > max_msgs else list(messages)

    # 再按字符预算截断（从旧消息开始丢弃）
    total = sum(len(str(m.get("content", ""))) for m in trimmed)
    while total > max_chars and len(trimmed) > 2:
        removed = trimmed.pop(0)
        total -= len(str(removed.get("content", "")))

    return trimmed


def _build_system_prompt(ctx: str, profile: dict, search: str, skill: str, custom: str) -> str:
    parts = [custom or "你是 agent-me，一个智能个人助手。用中文交流，语气温暖、专业。"]
    parts.append("\n【核心原则】真相优先、不编造、先理解再回答、范围控制、明确边界。")
    parts.append("\n【回复规范】")
    parts.append("- 回答简洁直接，除非用户要求详细解释")
    parts.append("- 不添加不必要的前言/结语（如'答案是...'、'基于...'）")
    parts.append("- 不使用 emoji，除非用户明确要求")
    parts.append("- 代码修改后只做简要说明，不自动写总结段落")
    parts.append("- 用户要求时才行动，不擅自扩展功能范围")
    if profile.get("name"): parts.append(f"用户：{profile['name']}")
    if profile.get("preferences"): parts.append(f"偏好：{'；'.join(profile['preferences'])}")
    if search: parts.append(f"[联网搜索结果]\n{search}")
    if ctx: parts.append(f"[历史记忆]\n{ctx}")
    if skill: parts.append(skill)
    return "\n\n".join(parts)


def _supports_prompt_caching(provider_key: str, model: str) -> bool:
    """检测是否支持 prompt caching（目前仅 Anthropic Claude 3.5+）"""
    if provider_key != "anthropic":
        return False
    # Claude 3.5 Sonnet 及更新模型支持 caching
    claude_caching_models = ["claude-sonnet", "claude-opus", "claude-haiku"]
    return any(cm in model.lower() for cm in claude_caching_models)


def _build_messages_with_caching(system: str, history: list, provider_key: str, model: str) -> list:
    """构建消息列表，对支持的模型启用 prompt caching"""
    if _supports_prompt_caching(provider_key, model):
        messages = [{"role": "system", "content": system}] + history
        if len(messages) >= 2:
            # 在倒数第二条用户消息添加 cache_control，使前面所有内容被缓存
            last_user_idx = None
            for i in range(len(messages) - 1, -1, -1):
                if messages[i].get("role") == "user":
                    last_user_idx = i
                    break
            if last_user_idx is not None:
                msg = messages[last_user_idx]
                content = msg.get("content", "")
                if isinstance(content, str) and content:
                    messages[last_user_idx] = {
                        **msg,
                        "content": [
                            {"type": "text", "text": content,
                             "cache_control": {"type": "ephemeral"}}
                        ]
                    }
                elif isinstance(content, list):
                    # vision 格式：在最后一个 text 元素上添加 cache_control
                    new_content = []
                    for j, part in enumerate(content):
                        if isinstance(part, dict) and part.get("type") == "text":
                            new_content.append({**part, "cache_control": {"type": "ephemeral"}})
                        else:
                            new_content.append(part)
                    if new_content:
                        messages[last_user_idx] = {**msg, "content": new_content}
        return messages
    else:
        return [{"role": "system", "content": system}] + history


def test_connection(provider_key: str, api_key: str, base_url=None, model=None) -> tuple:
    info = PROVIDERS.get(provider_key)
    if not info: return False, f"未知提供商: {provider_key}"
    test_model = model or (info["models"][0] if info.get("models") else "gpt-4o-mini")
    model_str = _get_model_string(provider_key, test_model)
    kwargs = {"api_key": api_key, "timeout": 10}
    if not info.get("is_native", True) and (base_url or info.get("base_url")):
        kwargs["api_base"] = base_url or info["base_url"]
    try:
        resp = litellm.completion(model=model_str, messages=[{"role": "user", "content": "Hi"}], max_tokens=5, **kwargs)
        return True, f"连接成功！模型响应: {resp.choices[0].message.content[:50]}"
    except Exception as e:
        return False, f"连接失败: {str(e)}"


async def chat_stream(
    messages, model, provider_key, long_term_context="", profile=None,
    search_context="", skill_prompt="", custom_prompt="",
    tools=None, model_params=None, cancel_event=None,
) -> AsyncGenerator[str, None]:
    if profile is None: profile = {}

    # 截断历史，控制 token 消耗
    truncated = _truncate_history(messages)

    system = _build_system_prompt(long_term_context, profile, search_context, skill_prompt, custom_prompt)
    full_msgs = _build_messages_with_caching(system, truncated, provider_key, model)

    kwargs = _get_llm_kwargs(provider_key)
    if not kwargs.get("api_key"):
        yield "\n\n[错误] 请先在设置页面配置该提供商的 API Key"
        return

    if model_params:
        for k in ("temperature", "top_p", "max_tokens", "presence_penalty", "frequency_penalty"):
            if model_params.get(k) is not None: kwargs[k] = model_params[k]

    try:
        resp = await litellm.acompletion(
            model=model, messages=full_msgs, stream=True,
            **(dict(tools=tools) if tools else {}), **kwargs)
        async for chunk in resp:
            if cancel_event and cancel_event.is_set(): break
            delta = chunk.choices[0].delta if chunk.choices else None
            if delta and delta.content: yield delta.content
    except Exception as e:
        yield f"\n\n[错误] {str(e)}"


def chat_non_stream(messages, model, provider_key, long_term_context="",
                    profile=None, search_context="", skill_prompt="",
                    custom_prompt="", model_params=None) -> str:
    if profile is None: profile = {}

    truncated = _truncate_history(messages)
    system = _build_system_prompt(long_term_context, profile, search_context, skill_prompt, custom_prompt)
    full_msgs = _build_messages_with_caching(system, truncated, provider_key, model)

    kwargs = _get_llm_kwargs(provider_key)
    if model_params:
        for k in ("temperature", "top_p", "max_tokens"):
            if model_params.get(k) is not None: kwargs[k] = model_params[k]
    try:
        resp = litellm.completion(model=model, messages=full_msgs, **kwargs)
        return resp.choices[0].message.content
    except Exception as e:
        return f"[错误] {str(e)}"


def extract_facts(text: str, model: str, provider_key: str) -> list[dict]:
    """从对话文本中提取结构化事实，返回 [{"fact": str, "category": str, "importance": int}]"""
    prompt = f"""从以下对话中提取关键事实。只提取关于用户偏好、身份、技能、习惯等持久性信息。
忽略临时性话题和一般性知识。

对话内容：
{text[:2000]}

请以 JSON 格式返回，格式如下：
[{{"fact": "用户喜欢 Python", "category": "技能偏好", "importance": 8}}]

category 只能是：身份、技能偏好、工作习惯、个人喜好、其他
importance 为 1-10 的整数，越高表示越重要。
如果没有可提取的事实，返回空数组 []。
只返回 JSON，不要其他内容。"""

    kwargs = _get_llm_kwargs(provider_key)
    if not kwargs.get("api_key"):
        return []
    try:
        resp = litellm.completion(
            model=model, messages=[{"role": "user", "content": prompt}],
            max_tokens=500, temperature=0.1, **kwargs)
        content = resp.choices[0].message.content.strip()
        # 清理可能的 markdown 代码块
        if content.startswith("```"):
            content = content.strip("`").strip()
            if content.startswith("json"):
                content = content[4:].strip()
        facts = json.loads(content)
        if isinstance(facts, list):
            return [f for f in facts if isinstance(f, dict) and f.get("fact")]
    except Exception:
        pass
    return []


def generate_summary(messages: list[dict], model: str, provider_key: str) -> str:
    """从对话消息列表生成一句话摘要"""
    if not messages:
        return ""
    # 只取最近 20 条消息
    recent = messages[-20:]
    text = "\n".join(f"{m.get('role', 'user')}: {str(m.get('content', ''))[:200]}" for m in recent)

    prompt = f"""请将以下对话总结为一句话摘要（50字以内），捕捉核心主题和关键行动：

{text[:3000]}

摘要："""

    kwargs = _get_llm_kwargs(provider_key)
    if not kwargs.get("api_key"):
        return ""
    try:
        resp = litellm.completion(
            model=model, messages=[{"role": "user", "content": prompt}],
            max_tokens=100, temperature=0.3, **kwargs)
        return resp.choices[0].message.content.strip()
    except Exception:
        return ""


def score_memory(text: str, model: str, provider_key: str) -> int:
    """给记忆打分（1-10），评估其长期价值"""
    prompt = f"""评估以下信息对 AI 助手的长期记忆价值（1-10分）。
高分：用户偏好、身份、关键决策、重要约定
低分：临时问题、一般性知识、闲聊

信息：{text[:500]}

只返回一个 1-10 的整数数字，不要其他内容。"""

    kwargs = _get_llm_kwargs(provider_key)
    if not kwargs.get("api_key"):
        return 5
    try:
        resp = litellm.completion(
            model=model, messages=[{"role": "user", "content": prompt}],
            max_tokens=10, temperature=0.1, **kwargs)
        content = resp.choices[0].message.content.strip()
        # 提取数字
        import re
        nums = re.findall(r'\d+', content)
        if nums:
            score = int(nums[0])
            return max(1, min(10, score))
    except Exception:
        pass
    return 5
