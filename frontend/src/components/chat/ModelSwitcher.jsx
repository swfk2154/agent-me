import { useState, useRef, useEffect } from "react";
import { ChevronDown, Circle } from "lucide-react";
import useStore from "../../store";

export default function ModelSwitcher() {
  const { currentModel, setCurrentModel, availableModels, providers } = useStore();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const currentLabel = availableModels.find((m) => m.value === currentModel)?.label || "选择模型";

  const grouped = {};
  availableModels.forEach((m) => {
    if (!grouped[m.provider]) grouped[m.provider] = [];
    grouped[m.provider].push(m);
  });
  const providerNames = {};
  providers.forEach((p) => { providerNames[p.key] = p.name; });

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors">
        <Circle className="w-2 h-2 fill-green-400 text-green-400" />
        <span className="text-gray-600 dark:text-gray-300 max-w-[140px] truncate">{currentLabel}</span>
        <ChevronDown className="w-3 h-3 text-gray-400" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-72 bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-xl shadow-lg z-50 max-h-80 overflow-y-auto animate-fadeIn">
          {Object.entries(grouped).map(([provider, models]) => (
            <div key={provider}>
              <div className="px-3 py-1.5 text-[10px] uppercase tracking-wider text-gray-400 font-medium bg-gray-50 dark:bg-gray-800/50">
                {providerNames[provider] || provider}
              </div>
              {models.map((m) => (
                <button key={m.value} onClick={() => { setCurrentModel(m.value); setOpen(false); }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors ${
                    currentModel === m.value
                      ? "bg-[#f3f1ff] dark:bg-[#534AB7]/15 text-[#534AB7] font-medium"
                      : "text-gray-700 dark:text-gray-300"
                  }`}>
                  <span>{m.label.split(" - ")[1] || m.label}</span>
                </button>
              ))}
            </div>
          ))}
          {availableModels.length === 0 && (
            <div className="px-3 py-3 text-sm text-gray-400 text-center">暂无可用模型，请先配置</div>
          )}
        </div>
      )}
    </div>
  );
}
