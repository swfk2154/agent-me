"""写作助手：10 种模板预设 system prompt —— 懒加载 LLM 以避免启动时网络请求"""
from typing import Optional

WRITING_TEMPLATES = [
    {"key": "polish", "name": "润色", "description": "让文字更流畅优雅",
     "prompt": "请润色以下文本，使其表达更流畅优雅，保持原意不变："},
    {"key": "expand", "name": "扩写", "description": "补充细节和论证",
     "prompt": "请扩写以下内容，补充细节、例子和论证，使篇幅扩展约 2 倍："},
    {"key": "condense", "name": "缩写", "description": "精简核心要点",
     "prompt": "请将以下内容精简为核心要点，保留关键信息，篇幅缩减约一半："},
    {"key": "translate_en", "name": "英译中", "description": "英文翻译为中文",
     "prompt": "请将以下英文翻译为流畅、准确的中文："},
    {"key": "translate_cn", "name": "中译英", "description": "中文翻译为英文",
     "prompt": "Please translate the following Chinese text into natural, fluent English:"},
    {"key": "tone_formal", "name": "正式语气", "description": "改写为正式书面语",
     "prompt": "请将以下文本改写为正式、专业的书面语气："},
    {"key": "tone_casual", "name": "随意语气", "description": "改写为轻松口语化",
     "prompt": "请将以下文本改写为轻松、口语化的语气："},
    {"key": "outline", "name": "列大纲", "description": "生成详细大纲",
     "prompt": "请为以下主题生成一份详细的大纲，包含多级结构："},
    {"key": "email", "name": "写邮件", "description": "根据要点撰写邮件",
     "prompt": "请根据以下要点撰写一封得体的邮件："},
    {"key": "weekly_report", "name": "周报", "description": "生成工作周报",
     "prompt": "请根据以下工作要点撰写一份结构清晰的周报："},
]

TEMPLATE_MAP = {t["key"]: t for t in WRITING_TEMPLATES}

def get_templates() -> list[dict]:
    return [{"key": t["key"], "name": t["name"], "description": t["description"]} for t in WRITING_TEMPLATES]

def execute(template_key: str, content: str, model: str, provider_key: str) -> str:
    template = TEMPLATE_MAP.get(template_key)
    if not template:
        return "[错误] 未知的写作模板"
    messages = [{"role": "user", "content": f"{template['prompt']}\n\n{content}"}]
    from services.llm_service import chat_non_stream
    return chat_non_stream(messages, model, provider_key)