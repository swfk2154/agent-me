import { useState } from "react";
import { Search, Trash2 } from "lucide-react";
import { useMemory } from "../../hooks/useMemory";

export default function MemoryBrowser() {
  const [query, setQuery] = useState("");
  const { memories, search, clear } = useMemory();
  return (
    <div className="max-w-3xl mx-auto p-6 h-full overflow-y-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-lg font-semibold">记忆库</h2>
          <p className="text-sm text-gray-500">搜索长期记忆中保存的重要信息</p>
        </div>
        <button onClick={clear} className="btn-danger text-xs flex items-center gap-1">
          <Trash2 className="w-3 h-3" /> 清空
        </button>
      </div>
      <div className="flex gap-2 mb-6">
        <input className="input-field" value={query} onChange={(e) => setQuery(e.target.value)}
               placeholder="搜索记忆..." onKeyDown={(e) => { if (e.key === "Enter") search(query); }} />
        <button onClick={() => search(query)} className="btn-primary flex items-center gap-1">
          <Search className="w-4 h-4" /> 搜索
        </button>
      </div>
      <div className="space-y-3">
        {memories.length === 0 && <p className="text-sm text-gray-400 text-center py-8">暂无记忆，开始对话后会自动记录</p>}
        {memories.map((m, i) => (
          <div key={i} className="card text-sm">
            <p className="text-gray-700 dark:text-gray-300">{m.content}</p>
            {m.metadata?.timestamp && <p className="text-xs text-gray-400 mt-1">{m.metadata.timestamp}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}
