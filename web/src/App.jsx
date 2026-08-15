import React, { useEffect, useRef, useState, useCallback } from "react";
import { chatStream, api } from "./api.js";

// ---------------------------------------------------------------------------
// Small building blocks
// ---------------------------------------------------------------------------

function ThinkingBlock({ text }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  return (
    <div className="thinking">
      <button className="thinking-toggle" onClick={() => setOpen(!open)}>
        <span className={open ? "chevron open" : "chevron"}>▸</span>
        {open ? "收起思考过程" : "展开思考过程"} <span className="dim">({text.length} 字)</span>
      </button>
      {open && <pre className="thinking-text">{text}</pre>}
    </div>
  );
}

function ToolCard({ call }) {
  const [open, setOpen] = useState(false);
  const { tool, args, ok, output, error } = call;
  let preview = "";
  try {
    const parsed = JSON.stringify(JSON.parse(args), null, 2);
    preview = parsed.length > 200 ? parsed.slice(0, 200) + "…" : parsed;
  } catch {
    preview = String(args).slice(0, 200);
  }
  return (
    <div className={`tool-card ${ok === false ? "tool-fail" : ""}`}>
      <button className="tool-head" onClick={() => setOpen(!open)}>
        <span className="tool-icon">{ok === false ? "✗" : "⚙"}</span>
        <span className="tool-name">{tool}</span>
        <span className="tool-status">{ok === false ? "失败" : "完成"}</span>
        <span className="chevron">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="tool-body">
          <div className="tool-section-label">参数</div>
          <pre className="tool-args">{preview}</pre>
          <div className="tool-section-label">结果</div>
          <pre className={`tool-output ${ok === false ? "fail" : ""}`}>
            {ok === false ? error : output}
          </pre>
        </div>
      )}
    </div>
  );
}

function UsageChip({ usage }) {
  if (!usage) return null;
  const cached = Math.max(usage.details?.cachedTokens ?? 0, usage.details?.cacheReadTokens ?? 0);
  const hit = usage.promptTokens > 0 ? (cached / usage.promptTokens) * 100 : 0;
  const cls = hit >= 70 ? "hit-good" : hit >= 30 ? "hit-mid" : "hit-bad";
  return (
    <div className="usage-chip">
      <span className="dim">in {usage.promptTokens} tok</span>
      <span className={cls}>缓存命中 {hit.toFixed(0)}%</span>
    </div>
  );
}

function AssistantMessage({ msg }) {
  return (
    <div className="msg assistant">
      <div className="msg-avatar">A</div>
      <div className="msg-body">
        {msg.thinking && msg.thinking.length > 0 && <ThinkingBlock text={msg.thinking} />}
        {msg.toolCalls.length > 0 && (
          <div className="tool-list">
            {msg.toolCalls.map((c, i) => (
              <ToolCard key={c.callId ?? i} call={c} />
            ))}
          </div>
        )}
        {msg.content ? (
          <div className="msg-text">{msg.content}</div>
        ) : msg.streaming ? (
          <span className="cursor-blink">▊</span>
        ) : null}
        {msg.usage && <UsageChip usage={msg.usage} />}
      </div>
    </div>
  );
}

function UserMessage({ msg }) {
  return (
    <div className="msg user">
      <div className="msg-avatar">你</div>
      <div className="msg-body">
        <div className="msg-text">{msg.content}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Settings drawer
// ---------------------------------------------------------------------------

function Settings({ open, onClose, config, providers, onChange }) {
  if (!open) return null;
  const set = (patch) => onChange(patch);
  const p = providers.find((x) => x.id === config.activeProvider);
  return (
    <div className="drawer-mask" onClick={onClose}>
      <div className="drawer" onClick={(e) => e.stopPropagation()}>
        <h2>设置</h2>
        <label>Provider</label>
        <select
          value={config.activeProvider}
          onChange={(e) => set({ activeProvider: e.target.value })}
        >
          {providers.map((x) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        <label>模型</label>
        <input
          list="model-list"
          value={config.activeModel}
          onChange={(e) => set({ activeModel: e.target.value })}
          placeholder="输入或选择模型"
        />
        <datalist id="model-list">
          {(p?.models ?? []).map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <label>搜索后端</label>
        <select value={config.searchProvider} onChange={(e) => set({ searchProvider: e.target.value })}>
          <option value="duckduckgo">DuckDuckGo（免费，无需 Key）</option>
          <option value="bing">Bing（免费，回退）</option>
          <option value="tavily">Tavily（需 Key）</option>
          <option value="brave">Brave（需 Key）</option>
        </select>
        <label>搜索 API Key（Tavily/Brave）</label>
        <input
          type="password"
          value={config.searchAPIKey ?? ""}
          onChange={(e) => set({ searchAPIKey: e.target.value })}
          placeholder="可留空（免费后端无需）"
        />
        <label>上下文窗口 (tokens)</label>
        <input
          type="number"
          value={config.maxWindowTokens}
          onChange={(e) => set({ maxWindowTokens: Number(e.target.value) })}
        />
        <label>缓存感知压缩</label>
        <input
          type="checkbox"
          checked={config.cacheEnabled}
          onChange={(e) => set({ cacheEnabled: e.target.checked })}
        />
        <p className="drawer-note">
          当前 provider 未配置 API Key 时，请在 CLI 运行 <code>agent-me config set {config.activeProvider}</code>
          （Web 端密钥仅本地加密存储）。
        </p>
        <div className="drawer-actions">
          <button className="btn" onClick={onClose}>
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

export default function App() {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [conversationId, setConversationId] = useState(null);
  const [conversations, setConversations] = useState([]);
  const [stats, setStats] = useState(null);
  const [config, setConfig] = useState(null);
  const [providers, setProviders] = useState([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pendingAsk, setPendingAsk] = useState(null);
  const [error, setError] = useState(null);
  const abortRef = useRef(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  const refreshConversations = useCallback(async () => {
    try {
      const d = await api("/api/conversations");
      setConversations(d.conversations);
    } catch {
      /* server not ready */
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const [cfg, prov] = await Promise.all([api("/api/config"), api("/api/providers")]);
        setConfig(cfg);
        setProviders(prov.providers);
      } catch {
        setError("无法连接后端，请先运行: agent-me serve");
      }
      refreshConversations();
      refreshStats();
    })();
  }, [refreshConversations]);

  const refreshStats = useCallback(async () => {
    try {
      setStats(await api("/api/stats"));
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const newConversation = () => {
    setMessages([]);
    setConversationId(null);
    setError(null);
  };

  const loadConversation = async (id) => {
    try {
      const d = await api(`/api/conversations/${id}`);
      const msgs = d.messages.map((m) => ({
        id: m.id,
        role: m.role === "user" ? "user" : "assistant",
        content: m.content,
        thinking: "",
        toolCalls: [],
        usage: null,
        streaming: false,
      }));
      setMessages(msgs);
      setConversationId(id);
    } catch (e) {
      setError(String(e.message));
    }
  };

  const send = async () => {
    const text = input.trim();
    if (!text || running) return;
    setInput("");
    setError(null);

    // Append user + placeholder assistant message.
    const userMsg = { id: `u${Date.now()}`, role: "user", content: text };
    const botMsg = {
      id: `b${Date.now()}`,
      role: "assistant",
      content: "",
      thinking: "",
      toolCalls: [],
      usage: null,
      streaming: true,
    };
    setMessages((m) => [...m, userMsg, botMsg]);
    setRunning(true);
    const abort = new AbortController();
    abortRef.current = abort;

    let askId = null;
    try {
      for await (const ev of chatStream({ message: text, conversationId })) {
        switch (ev.type) {
          case "delta":
            setMessages((m) => updateBot(m, botMsg.id, (b) => ({ ...b, content: b.content + ev.text })));
            break;
          case "thinking":
            setMessages((m) => updateBot(m, botMsg.id, (b) => ({ ...b, thinking: b.thinking + ev.text })));
            break;
          case "tool_call": {
            const call = { callId: ev.callId, tool: ev.tool, args: JSON.stringify(ev.args), ok: undefined, output: "", error: undefined };
            setMessages((m) => updateBot(m, botMsg.id, (b) => ({ ...b, toolCalls: [...b.toolCalls, call] })));
            break;
          }
          case "tool_result":
            setMessages((m) =>
              updateBot(m, botMsg.id, (b) => ({
                ...b,
                toolCalls: b.toolCalls.map((c) =>
                  c.callId === ev.callId ? { ...c, ok: ev.ok, output: ev.output, error: ev.error } : c,
                ),
              })),
            );
            break;
          case "usage":
            setMessages((m) => updateBot(m, botMsg.id, (b) => ({ ...b, usage: ev.usage })));
            refreshStats();
            break;
          case "ask":
            askId = ev.askId;
            setPendingAsk({ askId: ev.askId, question: ev.question });
            break;
          case "done":
            if (ev.conversationId) setConversationId(ev.conversationId);
            setMessages((m) => updateBot(m, botMsg.id, (b) => ({ ...b, streaming: false })));
            break;
          case "error":
            setError(ev.message);
            setMessages((m) => updateBot(m, botMsg.id, (b) => ({ ...b, streaming: false })));
            break;
          default:
            break;
        }
      }
      refreshConversations();
    } catch (e) {
      if (!abort.signal.aborted) {
        setError(String(e.message));
        setMessages((m) => updateBot(m, botMsg.id, (b) => ({ ...b, streaming: false })));
      }
    } finally {
      setRunning(false);
      abortRef.current = null;
    }
  };

  const answerAsk = async (answer) => {
    if (!pendingAsk) return;
    setPendingAsk(null);
    try {
      await api("/api/answer", { method: "POST", body: JSON.stringify({ askId: pendingAsk.askId, answer }) });
      // The agent loop resumes inside the same SSE stream.
    } catch {
      /* ignore */
    }
  };

  const stop = () => abortRef.current?.abort();

  const updateBot = (msgs, id, fn) => msgs.map((m) => (m.id === id ? fn(m) : m));

  const applyConfig = async (patch) => {
    const next = { ...config, ...patch };
    setConfig(next);
    try {
      await api("/api/config", { method: "PUT", body: JSON.stringify(next) });
    } catch (e) {
      setError(String(e.message));
    }
  };

  const hitRate = stats ? ((stats.hitRate ?? 0) * 100).toFixed(1) : "—";

  return (
    <div className="app">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="brand">
          <span className="logo">🤖</span> agent-me <span className="dim">v3</span>
        </div>
        <button className="btn new-chat" onClick={newConversation}>
          ＋ 新对话
        </button>
        <div className="conv-list">
          {conversations.map((c) => (
            <button
              key={c.id}
              className={`conv-item ${c.id === conversationId ? "active" : ""}`}
              onClick={() => loadConversation(c.id)}
            >
              <span className="conv-title">{c.title}</span>
              <span className="dim conv-date">{new Date(c.updatedAt).toLocaleDateString()}</span>
            </button>
          ))}
        </div>
        <div className="sidebar-bottom">
          <div className="stats-box">
            <div className="stats-row">
              <span className="dim">缓存命中率</span>
              <b className={parseFloat(hitRate) >= 70 ? "hit-good" : parseFloat(hitRate) >= 30 ? "hit-mid" : "hit-bad"}>
                {hitRate}%
              </b>
            </div>
            <div className="stats-row">
              <span className="dim">请求</span>
              <span>{stats?.requests ?? 0}</span>
            </div>
            <div className="stats-row">
              <span className="dim">命中 tokens</span>
              <span>{stats?.cachedTokens ?? 0}</span>
            </div>
          </div>
          <button className="btn ghost" onClick={() => setSettingsOpen(true)}>
            ⚙ 设置
          </button>
        </div>
      </aside>

      {/* Main chat */}
      <main className="main">
        <div className="chat-header">
          <span className="model-chip">{config?.activeProvider}/{config?.activeModel || "默认"}</span>
          {pendingAsk && (
            <span className="ask-pill">⏳ 等待你回答</span>
          )}
        </div>

        <div className="chat-area">
          {messages.length === 0 ? (
            <div className="welcome">
              <h1>你好，我是 agent-me</h1>
              <p className="dim">
                通用个人 AI Agent · 支持联网搜索、文件读写、命令执行、长期记忆
                <br />
                缓存感知上下文管理，自动优化 prompt-cache 命中率
              </p>
              <div className="suggestions">
                {["搜索一下今天的热点新闻", "列出当前目录的文件", "帮我记住：我喜欢用 Go 语言", "现在几点了？"].map((s) => (
                  <button key={s} className="suggestion" onClick={() => { setInput(s); inputRef.current?.focus(); }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="msg-list">
              {messages.map((m) =>
                m.role === "user" ? <UserMessage key={m.id} msg={m} /> : <AssistantMessage key={m.id} msg={m} />,
              )}
              <div ref={bottomRef} />
            </div>
          )}
        </div>

        {error && (
          <div className="error-bar" onClick={() => setError(null)}>
            ✗ {error}
          </div>
        )}

        {pendingAsk && (
          <div className="ask-bar">
            <span className="ask-q">❓ {pendingAsk.question}</span>
            <input
              autoFocus
              placeholder="输入你的回答，回车发送"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  answerAsk(e.target.value);
                  e.target.value = "";
                }
              }}
            />
          </div>
        )}

        <div className="input-bar">
          <textarea
            ref={inputRef}
            value={input}
            rows={2}
            placeholder="输入消息…（Enter 发送，Shift+Enter 换行）"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
          {running ? (
            <button className="btn stop" onClick={stop}>
              ■ 停止
            </button>
          ) : (
            <button className="btn send" onClick={send} disabled={!input.trim()}>
              ➤ 发送
            </button>
          )}
        </div>
      </main>

      <Settings
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        config={config}
        providers={providers}
        onChange={applyConfig}
      />
    </div>
  );
}
