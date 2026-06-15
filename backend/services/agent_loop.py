"""Agent 循环 v2.1：think → act → observe
基于 ToolRegistry 重构，新增安全熔断机制。

- ToolRegistry 统一管理工具（不再硬编码 JSON + 散落函数）
- 连续失败检测 → 自动熔断 → 请求人工介入
- 工具调用总数上限 + 迭代上限双重保护
"""
import json, asyncio
from typing import AsyncGenerator
from services.tool_service import get_tool_registry
from services.llm_client import acompletion
from services.llm_service import _get_llm_kwargs, _build_system_prompt
from services.memory_service import memory_service

# ========== 安全护栏常量 ==========

MAX_ITERATIONS = 8          # 最大 agent 循环轮数
MAX_TOOL_CALLS = 15         # 单次执行总工具调用上限
MAX_CONSECUTIVE_FAILURES = 3  # 连续工具失败自动熔断


# ========== Agent 主循环 ==========

async def agent_loop_stream(
    messages: list, model: str, provider_key: str,
    profile: dict = None, max_iterations: int = MAX_ITERATIONS,
    cancel_event: asyncio.Event = None,
    model_params: dict = None,
    custom_prompt: str = "",
) -> AsyncGenerator[str, None]:
    """Agent 循环：ToolRegistry 驱动，安全熔断保护。"""
    if profile is None:
        profile = {}
    if model_params is None:
        model_params = {}

    registry = get_tool_registry()

    yield "[Agent 思考中...]\n\n"
    iteration = 0
    conversation = list(messages)
    total_tool_calls = 0
    consecutive_failures = 0

    while iteration < max_iterations:
        if cancel_event and cancel_event.is_set():
            yield "\n[已取消]"
            break
        iteration += 1

        # 构建 LLM 参数
        kwargs = _get_llm_kwargs(provider_key)
        for k in ("temperature", "top_p", "max_tokens"):
            if model_params.get(k) is not None:
                kwargs[k] = model_params[k]

        # 检索相关记忆注入上下文
        last_user_msg = ""
        for m in reversed(conversation):
            if m.get("role") == "user":
                content = m.get("content", "")
                if isinstance(content, str):
                    last_user_msg = content
                break

        mem_context = ""
        if last_user_msg:
            memories = memory_service.retrieve_memories(last_user_msg, k=3)
            if memories:
                mem_context = "\n".join(memories)

        system = _build_system_prompt(mem_context, profile, "", "", custom_prompt)
        full_msgs = [{"role": "system", "content": system}] + conversation

        try:
            response = await acompletion(
                model=model, messages=full_msgs,
                tools=registry.to_openai_tools(),
                tool_choice="auto", **kwargs)
        except Exception as e:
            yield f"\n[Agent 错误: {e}]"
            break

        msg = response.choices[0].message

        # 文本输出
        if msg.content:
            yield msg.content

        # 工具调用
        if msg.tool_calls:
            tool_calls = msg.tool_calls
            total_tool_calls += len(tool_calls)

            # --- 熔断检查：总调用上限 ---
            if total_tool_calls > MAX_TOOL_CALLS:
                yield f"\n\n[达到工具调用上限 {MAX_TOOL_CALLS}，停止执行]"
                break

            # 解析所有工具调用
            calls = []
            for tc in tool_calls:
                tool_name = tc.function.name
                try:
                    tool_args = json.loads(tc.function.arguments)
                except Exception:
                    tool_args = {}
                calls.append({
                    "id": tc.id,
                    "name": tool_name,
                    "args": tool_args,
                })

            # 显示正在执行的工具
            for c in calls:
                yield f"\n\n🔧 **{c['name']}**({json.dumps(c['args'], ensure_ascii=False)})"

            # 并行执行所有工具
            results = await asyncio.gather(*[
                registry.execute(c["name"], c["args"]) for c in calls
            ])

            # 显示结果并检测连续失败
            all_success = True
            for c, result in zip(calls, results):
                if result.success:
                    yield f"\n> {result.output[:400]}{'...' if len(result.output) > 400 else ''}"
                else:
                    all_success = False
                    yield f"\n> ❌ {result.error[:400]}"

            # --- 熔断检查：连续失败 ---
            if all_success:
                consecutive_failures = 0
            else:
                consecutive_failures += 1
                if consecutive_failures >= MAX_CONSECUTIVE_FAILURES:
                    yield (
                        f"\n\n⚠️ **连续 {MAX_CONSECUTIVE_FAILURES} 次工具调用失败，Agent 已暂停。**\n"
                        f"建议：检查网络连接 / API 状态 / 工具参数后重试。"
                    )
                    break

            # 构建 assistant 消息
            conversation.append({
                "role": "assistant",
                "content": msg.content or "",
                "tool_calls": [{
                    "id": c["id"], "type": "function",
                    "function": {"name": c["name"], "arguments": json.dumps(c["args"])},
                } for c in calls],
            })

            # 添加工具结果
            for c, result in zip(calls, results):
                conversation.append({
                    "role": "tool",
                    "content": result.output if result.success else f"[错误] {result.error}",
                    "tool_call_id": c["id"],
                })
        else:
            # 没有工具调用，完成
            break

    yield f"\n\n[Agent 完成 | 迭代: {iteration}/{max_iterations} | 工具调用: {total_tool_calls}]"
