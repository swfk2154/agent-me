# agent-me CLI

终端版 agent-me，提供交互式聊天、一次性问答和配置管理。

## 安装

```bash
cd cli
pip install -e .
```

## 使用

```bash
# 交互式聊天
agent-me chat

# 一次性问答
agent-me ask "解释什么是量子计算"

# 管理配置
agent-me config list
agent-me config set openai -k sk-xxx --default
agent-me config test openai

# 查看模型
agent-me model list

# 导出对话
agent-me export
```

## 前置条件

需要先启动后端服务:

```bash
cd ../backend
uvicorn main:app --port 8000
```
