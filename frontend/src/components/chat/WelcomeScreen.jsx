import { MessageSquare, Sparkles, ArrowRight } from "lucide-react";

const suggestions = [
  "帮我写一份工作周报",
  "解释什么是量子计算",
  "分析这份PDF文档的内容",
  "帮我润色这段文字",
  "今天的科技新闻有哪些",
  "帮我规划一个Python项目的目录结构",
  "查看当前目录有哪些文件",
  "搜索 Python 异步编程最佳实践",
];

export default function WelcomeScreen({ onCreate }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-4 py-8 overflow-y-auto">
      <div className="max-w-2xl w-full text-center animate-fadeIn">
        <div className="w-16 h-16 mx-auto mb-6 bg-[#f3f1ff] dark:bg-[#534AB7]/15 rounded-2xl flex items-center justify-center">
          <MessageSquare className="w-8 h-8 text-[#534AB7]" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-2 tracking-tight">
          你好，我是 <span className="text-[#534AB7]">agent-me</span>
        </h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mb-8 max-w-md mx-auto">
          你的个人 AI 助手，支持多厂商模型、文件分析、写作辅助
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
          {suggestions.map((s, i) => (
            <button
              key={i}
              onClick={() => onCreate().then(() => {})}
              className="card-hover text-left text-sm text-gray-600 dark:text-gray-400
                         flex items-center gap-3 py-3 px-4 animate-fadeIn"
              style={{ animationDelay: `${i * 0.05}s` }}
            >
              <Sparkles className="w-4 h-4 text-[#534AB7] shrink-0" />
              <span className="truncate">{s}</span>
              <ArrowRight className="w-3 h-3 ml-auto text-gray-300 dark:text-gray-600 shrink-0" />
            </button>
          ))}
        </div>

        <div className="max-w-lg mx-auto">
          <div className="bg-[#f8f9fa] dark:bg-gray-900 border border-gray-100 dark:border-gray-800
                          rounded-xl p-4 flex items-center gap-4 animate-fadeIn"
               style={{ animationDelay: "0.35s" }}>
            <div className="flex-1">
              <input
                className="w-full bg-transparent border-none outline-none text-sm placeholder:text-gray-400"
                placeholder="直接输入消息开始对话..."
                onKeyDown={(e) => { if (e.key === "Enter" && e.target.value.trim()) { onCreate(); } }}
              />
            </div>
            <button onClick={() => onCreate()} className="btn-primary shrink-0 flex items-center gap-1">
              开始 <ArrowRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
