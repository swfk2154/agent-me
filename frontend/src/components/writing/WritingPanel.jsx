import { useState, useEffect } from "react";
import { Send, Copy, Check } from "lucide-react";
import { api } from "../../utils/api";
import useStore from "../../store";

export default function WritingPanel() {
  const [templates, setTemplates] = useState([]);
  const [selected, setSelected] = useState("");
  const [input, setInput] = useState("");
  const [result, setResult] = useState("");
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const { currentModel } = useStore();

  useEffect(() => { api.getTemplates().then(setTemplates).catch(() => {}); }, []);

  const execute = async () => {
    if (!selected || !input.trim()) return;
    setLoading(true); setResult("");
    try {
      const res = await api.executeWriting({ template_key: selected, content: input, model: currentModel });
      setResult(res.result);
    } catch (e) {
      setResult("[错误] " + e.message);
    }
    setLoading(false);
  };

  const copyToClipboard = () => {
    navigator.clipboard.writeText(result);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="max-w-4xl mx-auto p-6 h-full overflow-y-auto">
      <h2 className="text-lg font-semibold mb-1">写作助手</h2>
      <p className="text-sm text-gray-500 mb-6">选择模板并输入内容</p>
      <div className="flex flex-wrap gap-2 mb-4">
        {templates.map((t) => (
          <button key={t.key} onClick={() => setSelected(t.key)}
            className={`px-3 py-1.5 text-xs rounded-lg border transition-colors ${
              selected === t.key ? "bg-primary-50 dark:bg-primary-900/30 border-primary-300 text-primary-700" : "border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-400 hover:border-gray-300"
            }`} title={t.description}>
            {t.name}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <textarea className="input-field h-48 resize-none" value={input} onChange={(e) => setInput(e.target.value)}
                    placeholder="输入需要处理的文本..." />
          <button onClick={execute} disabled={loading || !selected || !input.trim()}
            className="btn-primary mt-3 flex items-center gap-1">
            <Send className="w-3 h-3" /> {loading ? "处理中..." : "开始写作"}
          </button>
        </div>
        <div className="relative">
          <div className="input-field h-48 overflow-y-auto whitespace-pre-wrap text-sm">
            {result || <span className="text-gray-400">结果将显示在这里...</span>}
          </div>
          {result && (
            <button onClick={copyToClipboard}
              className="absolute top-2 right-2 p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">
              {copied ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3 text-gray-400" />}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
