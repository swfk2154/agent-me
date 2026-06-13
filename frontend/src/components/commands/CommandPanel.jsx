import { useState, useEffect, useRef } from "react";
import { Terminal, Play, Shield, ShieldAlert, ShieldCheck, RotateCcw } from "lucide-react";
import { api } from "../../utils/api";

const actionLabels = { always_allow: "自动放行", ask_first: "需确认", never_allow: "已禁止" };
const actionColors = {
  always_allow: "text-green-600 bg-green-50 dark:bg-green-900/20",
  ask_first: "text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20",
  never_allow: "text-red-600 bg-red-50 dark:bg-red-900/20",
};
const actionIcons = { always_allow: ShieldCheck, ask_first: ShieldAlert, never_allow: Shield };

export default function CommandPanel() {
  const [cmd, setCmd] = useState("");
  const [workdir, setWorkdir] = useState(".");
  const [log, setLog] = useState([]);
  const [evalResult, setEvalResult] = useState(null);
  const [execResult, setExecResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const autoRan = useRef(false);

  const refreshLog = async () => { try { setLog(await api.getCommandLog(30)); } catch {} };
  useEffect(() => { refreshLog(); }, []);

  const doExecute = async (evalRes) => {
    setLoading(true); setExecResult(null);
    const needsApproval = evalRes?.action === "ask_first";
    if (evalRes?.action === "never_allow") { setLoading(false); return; }
    try {
      const r = await api.executeCommand({ command: cmd, workdir, timeout: 30, approved: !needsApproval });
      setExecResult(r);
      if (!r.needs_approval) refreshLog();
    } catch (e) {
      setExecResult({ success: false, error: e.message });
    }
    setLoading(false);
  };

  const evaluate = async () => {
    if (!cmd.trim()) return;
    setLoading(true); setEvalResult(null); setExecResult(null); autoRan.current = false;
    try {
      const r = await api.evaluateCommand({ command: cmd, workdir });
      setEvalResult(r);
      if (r.action === "always_allow") { autoRan.current = true; doExecute(r); }
    } catch (e) {
      setEvalResult({ action: "never_allow", reason: e.message, segments: [] });
    }
    setLoading(false);
  };

  const ActionIcon = evalResult ? actionIcons[evalResult.action] || Shield : Shield;

  return (
    <div className="max-w-4xl mx-auto p-6 h-full overflow-y-auto">
      <div className="flex items-center gap-2 mb-1">
        <Terminal className="w-5 h-5 text-primary-600" />
        <h2 className="text-lg font-semibold">命令执行</h2>
      </div>
      <p className="text-sm text-gray-500 mb-6">使用 PowerShell 执行，安全命令自动放行</p>

      <div className="card mb-4 space-y-3">
        <div className="flex gap-2">
          <input className="input-field font-mono text-sm flex-1"
                 value={cmd} onChange={(e) => setCmd(e.target.value)}
                 placeholder="输入命令..." onKeyDown={(e) => { if (e.key === "Enter") evaluate(); }} />
          <button onClick={evaluate} disabled={loading || !cmd.trim()} className="btn-secondary flex items-center gap-1">
            <Shield className="w-4 h-4" /> 评估
          </button>
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span>工作目录:</span>
          <input className="input-field flex-1 text-xs" value={workdir} onChange={(e) => setWorkdir(e.target.value)} />
          {evalResult && evalResult.action === "ask_first" && (
            <button onClick={() => doExecute(evalResult)} disabled={loading} className="btn-primary flex items-center gap-1 text-xs">
              <Play className="w-3 h-3" /> 确认执行
            </button>
          )}
        </div>
      </div>

      {evalResult && (
        <div className={`card mb-4 border ${
          evalResult.action === "always_allow" ? "border-green-200 dark:border-green-800" :
          evalResult.action === "ask_first" ? "border-yellow-200 dark:border-yellow-800" :
          "border-red-200 dark:border-red-800"
        }`}>
          <div className="flex items-center gap-2 mb-3">
            <ActionIcon className={`w-5 h-5 ${
              evalResult.action === "always_allow" ? "text-green-500" :
              evalResult.action === "ask_first" ? "text-yellow-500" : "text-red-500"
            }`} />
            <span className={`px-2 py-0.5 rounded text-xs font-medium ${actionColors[evalResult.action]}`}>
              {actionLabels[evalResult.action]}
            </span>
            {evalResult.reason && <span className="text-xs text-gray-500">{evalResult.reason}</span>}
          </div>
          {evalResult.segments?.map((seg, i) => (
            <div key={i} className="flex items-center gap-2 text-xs py-1 border-t border-gray-50 dark:border-gray-800">
              <span className={`px-1.5 py-0.5 rounded ${actionColors[seg.action]}`}>{actionLabels[seg.action]}</span>
              <code className="text-gray-600 dark:text-gray-400">{seg.segment}</code>
              <span className="text-gray-400">{seg.reason}</span>
            </div>
          ))}
        </div>
      )}

      {execResult && (
        <div className={`card mb-4 ${execResult.success ? "border-green-200 dark:border-green-800" : "border-red-200 dark:border-red-800"}`}>
          <div className="flex items-center gap-2 mb-2">
            <span className={`text-xs font-medium ${execResult.success ? "text-green-600" : "text-red-600"}`}>
              {execResult.success ? "执行成功" : "执行失败"}
            </span>
            {execResult.returncode !== undefined && <span className="text-xs text-gray-400">code: {execResult.returncode}</span>}
          </div>
          {execResult.output && <pre className="bg-gray-50 dark:bg-gray-800 p-3 rounded-lg text-xs overflow-x-auto max-h-48">{execResult.output}</pre>}
          {execResult.error && <pre className="bg-red-50 dark:bg-red-900/20 p-3 rounded-lg text-xs text-red-600 dark:text-red-400 overflow-x-auto max-h-48">{execResult.error}</pre>}
        </div>
      )}

      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-gray-500">执行历史</h3>
          <button onClick={refreshLog} className="text-xs text-primary-500 hover:underline flex items-center gap-1">
            <RotateCcw className="w-3 h-3" /> 刷新
          </button>
        </div>
        <div className="space-y-1">
          {log.slice().reverse().map((entry, i) => (
            <div key={i} className="flex items-center gap-2 text-xs py-1.5 px-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800">
              <span className={`w-1.5 h-1.5 rounded-full ${entry.success ? "bg-green-400" : "bg-red-400"}`} />
              <code className="text-gray-600 dark:text-gray-400 truncate flex-1">{entry.command}</code>
              <span className="text-gray-400">{entry.timestamp?.slice(11, 19)}</span>
            </div>
          ))}
          {log.length === 0 && <p className="text-xs text-gray-400 py-4 text-center">暂无执行记录</p>}
        </div>
      </div>
    </div>
  );
}
