import { useState, useEffect } from "react";
import { RotateCcw, AlertTriangle, FileText } from "lucide-react";
import { api } from "../../utils/api";

export default function LogViewer() {
  const [logs, setLogs] = useState([]);
  const [type, setType] = useState("all");
  const [info, setInfo] = useState({});

  const refresh = async () => {
    try {
      const data = await api.getLogs(type, 200);
      setLogs(data.logs || []);
      setInfo(data);
    } catch (e) {
      setLogs(["[错误] 无法读取日志: " + e.message]);
    }
  };

  useEffect(() => { refresh(); const t = setInterval(refresh, 5000); return () => clearInterval(t); }, [type]);

  const levelColor = (line) => {
    if (line.includes("[ERROR]")) return "text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20";
    if (line.includes("[WARNING]")) return "text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20";
    return "";
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold">运行日志</h2>
          <p className="text-sm text-gray-500">查看 agent-me 的运行状态和错误信息</p>
          {info.file && <p className="text-xs text-gray-400 mt-0.5">文件: {info.file} · {info.total_lines} 行</p>}
        </div>
        <div className="flex gap-2">
          <button onClick={() => setType("all")}
            className={`px-3 py-1 text-xs rounded-lg border ${type === "all" ? "bg-primary-50 border-primary-300 text-primary-700" : "border-gray-200 text-gray-500"}`}>
            <FileText className="w-3 h-3 inline mr-1" />全部
          </button>
          <button onClick={() => setType("errors")}
            className={`px-3 py-1 text-xs rounded-lg border ${type === "errors" ? "bg-red-50 border-red-300 text-red-700" : "border-gray-200 text-gray-500"}`}>
            <AlertTriangle className="w-3 h-3 inline mr-1" />错误
          </button>
          <button onClick={refresh} className="btn-secondary text-xs flex items-center gap-1">
            <RotateCcw className="w-3 h-3" />刷新
          </button>
        </div>
      </div>
      <div className="bg-gray-950 text-gray-300 rounded-xl p-4 font-mono text-xs overflow-auto max-h-[calc(100vh-280px)]">
        {logs.length === 0 ? (
          <p className="text-gray-500">暂无日志</p>
        ) : (
          logs.map((line, i) => (
            <div key={i} className={`py-0.5 px-1 rounded ${levelColor(line)}`}>
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
