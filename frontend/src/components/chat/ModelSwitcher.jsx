import { useState, useRef, useEffect } from "react";
import { ChevronDown, ChevronLeft, Circle } from "lucide-react";
import useStore from "../../store";

export default function ModelSwitcher() {
  const { currentModel, setCurrentModel, availableModels, providers } = useStore();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState("provider"); // "provider" | "model"
  const [selectedProviderKey, setSelectedProviderKey] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setStep("provider"); } };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const providerNames = {};
  providers.forEach((p) => { providerNames[p.key] = p.name; });

  // 按厂商分组
  const grouped = {};
  availableModels.forEach((m) => {
    if (!grouped[m.provider]) grouped[m.provider] = [];
    grouped[m.provider].push(m);
  });

  // 当前显示的文字
  const currentLabel = (() => {
    const m = availableModels.find((m) => m.value === currentModel);
    if (!m) return "选择模型";
    const pname = providerNames[m.provider] || m.provider;
    const mname = m.label.split(" - ")[1] || m.label;
    return `${pname} · ${mname}`;
  })();

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
        <Circle className="w-2 h-2 fill-green-400 text-green-400" />
        <span className="text-gray-600 dark:text-gray-300 max-w-[160px] truncate">{currentLabel}</span>
        <ChevronDown className="w-3 h-3 text-gray-400" />
      </button>
      {open && step === "provider" && (
        <div className="absolute right-0 top-full mt-1 w-56 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl shadow-lg z-50 animate-fadeIn">
          <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-gray-400 font-medium border-b border-gray-100 dark:border-gray-800">
            选择厂商
          </div>
          {Object.keys(grouped).length === 0 ? (
            <div className="px-3 py-3 text-sm text-gray-400 text-center">暂无可用模型，请先配置</div>
          ) : (
            Object.entries(grouped).map(([key, models]) => (
              <button key={key} onClick={() => { setSelectedProviderKey(key); setStep("model"); }}
                className="w-full flex items-center justify-between px-3 py-2.5 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-gray-700 dark:text-gray-300">
                <span>{providerNames[key] || key}</span>
                <span className="text-[11px] text-gray-400">{models.length}个模型</span>
              </button>
            ))
          )}
        </div>
      )}
      {open && step === "model" && (
        <div className="absolute right-0 top-full mt-1 w-64 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl shadow-lg z-50 max-h-80 overflow-y-auto animate-fadeIn">
          <div className="sticky top-0 bg-white dark:bg-gray-900 border-b border-gray-100 dark:border-gray-800">
            <button onClick={() => setStep("provider")}
              className="flex items-center gap-1 px-3 py-2 text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
              <ChevronLeft className="w-3.5 h-3.5" />
              {providerNames[selectedProviderKey] || selectedProviderKey}
            </button>
          </div>
          {(grouped[selectedProviderKey] || []).map((m) => (
            <button key={m.value} onClick={() => { setCurrentModel(m.value); setOpen(false); setStep("provider"); }}
              className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${
                currentModel === m.value
                  ? "bg-[#f3f1ff] dark:bg-[#534AB7]/15 text-[#534AB7] font-medium"
                  : "text-gray-700 dark:text-gray-300"
              }`}>
              <span>{m.label.split(" - ")[1] || m.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
