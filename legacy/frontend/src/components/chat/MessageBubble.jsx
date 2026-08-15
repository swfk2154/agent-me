import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { Copy, Bot, Wrench, ChevronDown, ChevronUp } from "lucide-react";
import useStore from "../../store";
import { useState } from "react";

function ToolCallBlock({ lines }) {
  const [expanded, setExpanded] = useState(true);
  // lines: ["🔧 **tool_name**({args})", "> result...", ...]
  const toolName = lines[0]?.match(/\*\*(.+?)\*\*/)?.[1] || "工具";
  const args = lines[0]?.match(/\((.+?)\)$/)?.[1] || "";
  const result = lines.slice(1).join("\n").replace(/^> /gm, "");

  return (
    <div className="my-2 border border-[#534AB7]/20 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-3 py-2 bg-[#f3f1ff] dark:bg-[#534AB7]/10 text-left text-xs"
      >
        <Wrench className="w-3 h-3 text-[#534AB7]" />
        <span className="font-medium text-[#534AB7]">{toolName}</span>
        <span className="text-gray-400 truncate flex-1">{args}</span>
        {expanded ? <ChevronUp className="w-3 h-3 text-gray-400" /> : <ChevronDown className="w-3 h-3 text-gray-400" />}
      </button>
      {expanded && (
        <div className="px-3 py-2 bg-gray-50 dark:bg-gray-900/50 text-xs text-gray-600 dark:text-gray-400 font-mono whitespace-pre-wrap">
          {result || "执行中..."}
        </div>
      )}
    </div>
  );
}

function parseContent(content) {
  // 将内容拆分为普通文本和工具调用块
  const lines = content.split("\n");
  const parts = [];
  let currentText = [];
  let currentTool = [];
  let inTool = false;

  for (const line of lines) {
    if (line.startsWith("🔧 ")) {
      if (currentText.length > 0) {
        parts.push({ type: "text", content: currentText.join("\n") });
        currentText = [];
      }
      inTool = true;
      currentTool = [line];
    } else if (inTool && line.startsWith("> ")) {
      currentTool.push(line);
    } else {
      if (inTool && currentTool.length > 0) {
        parts.push({ type: "tool", lines: currentTool });
        currentTool = [];
        inTool = false;
      }
      currentText.push(line);
    }
  }

  if (currentTool.length > 0) {
    parts.push({ type: "tool", lines: currentTool });
  }
  if (currentText.length > 0) {
    parts.push({ type: "text", content: currentText.join("\n") });
  }

  return parts;
}

export default function MessageBubble({ message }) {
  const isUser = message.role === "user";
  const isAgent = message.isAgent;
  const addToast = useStore((s) => s.addToast);

  const handleCopy = () => {
    navigator.clipboard.writeText(message.content).then(() => {
      addToast?.("已复制到剪贴板", "success", 2000);
    });
  };

  const parts = isUser ? [] : parseContent(message.content || "");
  const hasTools = parts.some((p) => p.type === "tool");

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"} animate-fadeIn group`}>
      <div className={`max-w-[90%] sm:max-w-[80%] ${
        isUser
          ? "bg-[#534AB7] text-white rounded-2xl rounded-br-md"
          : hasTools || isAgent
            ? "bg-white dark:bg-gray-900 border border-[#534AB7]/20 dark:border-[#534AB7]/30 rounded-2xl rounded-bl-md shadow-sm"
            : "bg-gray-50 dark:bg-gray-900 border border-gray-100 dark:border-gray-800 text-gray-900 dark:text-gray-100 rounded-2xl rounded-bl-md shadow-sm"
      } px-4 py-3`}>
        {/* Agent 标识 */}
        {(isAgent || hasTools) && !isUser && (
          <div className="flex items-center gap-1.5 mb-2 pb-2 border-b border-gray-100 dark:border-gray-800">
            <Bot className="w-3.5 h-3.5 text-[#534AB7]" />
            <span className="text-[11px] font-medium text-[#534AB7]">Agent</span>
            {hasTools && (
              <span className="text-[10px] text-gray-400 ml-1">
                已调用 {parts.filter((p) => p.type === "tool").length} 个工具
              </span>
            )}
          </div>
        )}

        {isUser ? (
          <div className="text-sm whitespace-pre-wrap leading-relaxed">
            {message.images && message.images.length > 0 && (
              <div className="flex gap-2 mb-2 flex-wrap">
                {message.images.map((img, i) => (
                  <img key={i}
                    src={`data:image/${img.format || "png"};base64,${img.data}`}
                    alt={img.name || `图片${i+1}`}
                    className="max-w-[200px] max-h-[200px] rounded-lg border border-white/20"
                  />
                ))}
              </div>
            )}
            <p>{message.content}</p>
          </div>
        ) : (
          <div className="markdown-body text-sm">
            {parts.length > 0 ? (
              parts.map((part, i) =>
                part.type === "tool" ? (
                  <ToolCallBlock key={i} lines={part.lines} />
                ) : part.content.trim() ? (
                  <ReactMarkdown
                    key={i}
                    remarkPlugins={[remarkGfm]}
                    components={{
                      code({ node, inline, className, children, ...props }) {
                        const match = /language-(\w+)/.exec(className || "");
                        const codeStr = String(children).replace(/\n$/, "");
                        if (!inline && match) {
                          return (
                            <div className="relative group/code my-2">
                              <div className="flex items-center justify-between px-4 py-1.5 bg-gray-200 dark:bg-gray-800 rounded-t-lg text-xs text-gray-500">
                                <span>{match[1]}</span>
                                <button
                                  onClick={() => { navigator.clipboard.writeText(codeStr); addToast?.("代码已复制", "success", 1500); }}
                                  className="opacity-0 group-hover/code:opacity-100 transition-opacity hover:text-gray-700 dark:hover:text-gray-300"
                                >
                                  <Copy className="w-3 h-3" />
                                </button>
                              </div>
                              <SyntaxHighlighter style={oneDark} language={match[1]} PreTag="div"
                                customStyle={{ margin: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0, borderRadius: "0 0 8px 8px" }}
                                {...props}>{codeStr}</SyntaxHighlighter>
                            </div>
                          );
                        }
                        return <code className="bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-xs font-mono" {...props}>{children}</code>;
                      },
                    }}
                  >
                    {part.content}
                  </ReactMarkdown>
                ) : null
              )
            ) : message.content ? (
              <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                  code({ node, inline, className, children, ...props }) {
                    const match = /language-(\w+)/.exec(className || "");
                    const codeStr = String(children).replace(/\n$/, "");
                    if (!inline && match) {
                      return (
                        <div className="relative group/code my-2">
                          <div className="flex items-center justify-between px-4 py-1.5 bg-gray-200 dark:bg-gray-800 rounded-t-lg text-xs text-gray-500">
                            <span>{match[1]}</span>
                            <button
                              onClick={() => { navigator.clipboard.writeText(codeStr); addToast?.("代码已复制", "success", 1500); }}
                              className="opacity-0 group-hover/code:opacity-100 transition-opacity hover:text-gray-700 dark:hover:text-gray-300"
                            >
                              <Copy className="w-3 h-3" />
                            </button>
                          </div>
                          <SyntaxHighlighter style={oneDark} language={match[1]} PreTag="div"
                            customStyle={{ margin: 0, borderTopLeftRadius: 0, borderTopRightRadius: 0, borderRadius: "0 0 8px 8px" }}
                            {...props}>{codeStr}</SyntaxHighlighter>
                        </div>
                      );
                    }
                    return <code className="bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded text-xs font-mono" {...props}>{children}</code>;
                  },
                }}
              >
                {message.content}
              </ReactMarkdown>
            ) : (
              <span className="text-gray-400 italic">...</span>
            )}
          </div>
        )}
      </div>
      {!isUser && message.content && (
        <div className="flex items-center gap-0.5 ml-1 opacity-0 group-hover:opacity-100 transition-opacity self-end">
          <button onClick={handleCopy} className="p-1 hover:bg-gray-100 dark:hover:bg-gray-800 rounded text-gray-400" title="复制">
            <Copy className="w-3 h-3" />
          </button>
        </div>
      )}
    </div>
  );
}
