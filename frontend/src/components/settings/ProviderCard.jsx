import { useState, useEffect } from "react";
import { Eye, EyeOff, Wifi, CheckCircle, Star, X } from "lucide-react";
import { api } from "../../utils/api";

export default function ProviderCard({ provider, onSave, onTest, onSetDefault }) {
  const [apiKey, setApiKey] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [selectedModels, setSelectedModels] = useState([]);
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [maskedKey, setMaskedKey] = useState("");

  // 初始化时从 provider props 加载，再从后端拉取完整配置
  useEffect(() => {
    setEnabled(provider.enabled || false);
    setSelectedModels(provider.models || []);
    setBaseUrl(provider.base_url || "");
    setMaskedKey(provider.masked_key || "");
    if (provider.configured) {
      loadStored();
    } else {
      setLoaded(true);
    }
  }, [provider.key]);

  const loadStored = async () => {
    try {
      const data = await api.getProvider(provider.key);
      if (data.masked_key) setMaskedKey(data.masked_key);
      if (data.enabled !== undefined) setEnabled(data.enabled);
      if (data.models?.length) setSelectedModels(data.models);
      if (data.base_url) setBaseUrl(data.base_url);
    } catch (e) {
      console.error("Failed to load provider config:", e);
    }
    setLoaded(true);
  };

  // 用户输入 API Key 时同步更新 masked
  const handleKeyChange = (val) => {
    setApiKey(val);
    if (!val) setMaskedKey("");
  };

  const handleTest = async () => {
    setTesting(true); setTestResult(null);
    try {
      const res = await onTest({
        provider_key: provider.key,
        api_key: apiKey || "",
        base_url: provider.is_custom ? baseUrl : null,
        model: selectedModels[0] || null,
      });
      setTestResult(res);
    } catch (e) {
      setTestResult({ success: false, message: e.message });
    }
    setTesting(false);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await api.saveProvider({
        provider_key: provider.key,
        api_key: apiKey || "",
        enabled: enabled,
        is_default: provider.is_default,
        models: selectedModels,
        base_url: baseUrl || undefined,
      });
      // 保存成功，同步本地状态
      if (apiKey) {
        const masked = apiKey.length > 8
          ? apiKey.slice(0, 4) + "*".repeat(apiKey.length - 8) + apiKey.slice(-4)
          : "*".repeat(apiKey.length);
        setMaskedKey(masked);
      }
      onSave?.(provider.key);
    } catch (e) {
      console.error("Save failed:", e);
    }
    setSaving(false);
  };

  const removeModel = (model) => setSelectedModels((p) => p.filter((m) => m !== model));
  const addModel = (model) => {
    if (model.trim() && !selectedModels.includes(model.trim())) {
      setSelectedModels((p) => [...p, model.trim()]);
    }
  };

  const hasKey = !!(apiKey || maskedKey);

  return (
    <div className={`card border transition-colors ${
      enabled && hasKey ? "border-green-200 dark:border-green-800" : "border-gray-100 dark:border-gray-800"
    }`}>
      {/* 头部 */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold text-gray-800 dark:text-gray-200">{provider.name}</h3>
          {enabled && hasKey && <CheckCircle className="w-4 h-4 text-green-500" />}
          {provider.api_key_url && (
            <a href={provider.api_key_url} target="_blank" rel="noreferrer"
               className="text-xs text-primary-500 hover:underline">获取 Key</a>
          )}
          {maskedKey && !apiKey && (
            <span className="text-[11px] text-gray-400 bg-gray-50 dark:bg-gray-800 px-2 py-0.5 rounded">
              已保存: {maskedKey}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => { setEnabled(!enabled); }}
            className={`w-9 h-5 rounded-full transition-colors relative ${
              enabled ? "bg-[#534AB7]" : "bg-gray-300 dark:bg-gray-600"
            }`}>
            <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
              enabled ? "left-4" : "left-0.5"
            }`} />
          </button>
          <button onClick={() => onSetDefault(provider.key)}
            className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg" title="设为默认模型">
            <Star className={`w-4 h-4 ${provider.is_default ? "fill-yellow-400 text-yellow-400" : "text-gray-300"}`} />
          </button>
        </div>
      </div>

      {/* Base URL (自定义提供商) */}
      {(provider.is_custom || provider.key === "custom" || provider.key === "searxng") && (
        <div className="mb-3">
          <label className="text-xs text-gray-500 mb-1 block">
            Base URL {provider.key === "searxng" ? "(默认为 http://localhost:8080/search)" : ""}
          </label>
          <input className="input-field" value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={provider.key === "searxng" ? "http://localhost:8080/search" : "https://api.example.com/v1"} />
        </div>
      )}

      {/* API Key */}
      <div className="mb-3">
        <label className="text-xs text-gray-500 mb-1 block">
          API Key {maskedKey ? <span className="text-green-500">(已保存)</span> : ""}
        </label>
        <div className="flex gap-2">
          <div className="relative flex-1">
            <input type={showKey ? "text" : "password"} className="input-field pr-10"
              value={apiKey} onChange={(e) => handleKeyChange(e.target.value)}
              placeholder={maskedKey ? "留空则不修改" : "输入 API Key"} />
            <button onClick={() => setShowKey(!showKey)}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600">
              {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          <button onClick={handleTest} disabled={testing || (!apiKey && !maskedKey)}
            className="btn-secondary flex items-center gap-1 flex-shrink-0 text-xs">
            <Wifi className="w-3 h-3" /> {testing ? "测试中..." : "测试"}
          </button>
        </div>
      </div>

      {testResult && (
        <div className={`text-xs px-3 py-1.5 rounded-lg mb-3 ${
          testResult.success ? "bg-green-50 dark:bg-green-900/30 text-green-700" : "bg-red-50 dark:bg-red-900/30 text-red-700"
        }`}>
          {testResult.message}
        </div>
      )}

      {/* 模型选择 */}
      <div className="mb-3">
        <label className="text-xs text-gray-500 mb-1 block">可用模型 (点击 × 删除，回车添加)</label>
        <div className="flex flex-wrap gap-1.5">
          {selectedModels.map((m) => (
            <span key={m} className="badge-primary inline-flex items-center gap-1 text-xs px-2.5 py-0.5 rounded-full">
              {m}
              <button onClick={() => removeModel(m)}
                className="p-0.5 hover:bg-red-100 dark:hover:bg-red-900/30 rounded-full">
                <X className="w-3 h-3 text-gray-400 hover:text-red-500" />
              </button>
            </span>
          ))}
          <input className="input-field flex-1 min-w-[120px] text-xs px-2 py-0.5"
            placeholder="输入模型名，回车添加"
            onKeyDown={(e) => {
              if (e.key === "Enter" && e.target.value.trim()) {
                addModel(e.target.value.trim());
                e.target.value = "";
              }
            }} />
        </div>
      </div>

      <button onClick={handleSave} disabled={saving} className="btn-primary text-xs">
        {saving ? "保存中..." : "保存配置"}
      </button>
    </div>
  );
}
