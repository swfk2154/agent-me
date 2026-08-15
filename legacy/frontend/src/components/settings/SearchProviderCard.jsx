import { useState } from "react";
import { Eye, EyeOff, Wifi, CheckCircle, Star, Globe } from "lucide-react";

export default function SearchProviderCard({ provider, isActive, config, onSave, onTest, onSetActive }) {
  const [apiKey, setApiKey] = useState(config?.api_key || "");
  const [baseUrl, setBaseUrl] = useState(config?.base_url || "");
  const [showKey, setShowKey] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  const needsApiKey = provider.needs_api_key !== false;
  const needsUrl = !!(provider.key === "searxng" || provider.key === "custom" || provider.is_custom);

  const handleTest = async () => {
    setTesting(true); setTestResult(null);
    try {
      const res = await onTest({
        provider_key: provider.key,
        api_key: apiKey,
        base_url: needsUrl ? baseUrl : undefined,
      });
      setTestResult(res);
    } catch (e) {
      setTestResult({ success: false, message: e.message });
    }
    setTesting(false);
  };

  const handleSave = async () => {
    setSaving(true);
    await onSave(provider.key, { api_key: apiKey, base_url: baseUrl });
    setSaving(false);
  };

  const savedKey = config?.api_key || "";
  const savedUrl = config?.base_url || "";
  const hasCredentials = !!(savedKey || savedUrl || provider.key === "duckduckgo");

  return (
    <div className={`card border ${
      isActive ? "border-green-200 dark:border-green-800" : "border-gray-100 dark:border-gray-800"
    }`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-primary-500" />
          <h3 className="font-semibold text-sm text-gray-800 dark:text-gray-200">{provider.name}</h3>
          {isActive && <CheckCircle className="w-4 h-4 text-green-500" />}
          {savedKey && !apiKey && (
            <span className="text-[11px] text-gray-400 bg-gray-50 dark:bg-gray-800 px-2 py-0.5 rounded">
              已保存: {savedKey.slice(0,4)}****{savedKey.slice(-4)}
            </span>
          )}
          {hasCredentials && !apiKey && !savedKey && provider.key !== "duckduckgo" && (
            <span className="text-[11px] text-green-500 bg-green-50 dark:bg-green-900/20 px-2 py-0.5 rounded">
              已配置
            </span>
          )}
          {provider.api_key_url && (
            <a href={provider.api_key_url} target="_blank" rel="noreferrer"
               className="text-xs text-primary-500 hover:underline">获取 Key</a>
          )}
        </div>
        <button onClick={() => onSetActive(provider.key)}
          className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg" title="设为默认搜索引擎">
          <Star className={`w-4 h-4 ${isActive ? "fill-yellow-400 text-yellow-400" : "text-gray-300"}`} />
        </button>
      </div>
      <p className="text-xs text-gray-500 mb-3">{provider.description}</p>

      {/* Base URL (SearXNG / 自定义) */}
      {needsUrl && (
        <div className="mb-2">
          <label className="text-xs text-gray-500 mb-1 block">
            {provider.key === "searxng" ? "SearXNG 地址" : "API URL"}
            {savedUrl && <span className="text-green-500 ml-1">(已保存)</span>}
          </label>
          <input className="input-field text-xs" value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={provider.key === "searxng" ? "http://localhost:8080/search" : "https://your-api.com/search"} />
        </div>
      )}

      {/* API Key */}
      {needsApiKey && (
        <>
          <div className="mb-2">
            <label className="text-xs text-gray-500 mb-1 block">
              API Key {savedKey ? <span className="text-green-500">(已保存)</span> : ""}
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input type={showKey ? "text" : "password"} className="input-field pr-10"
                  value={apiKey} onChange={(e) => setApiKey(e.target.value)}
                  placeholder={savedKey ? "留空则不修改" : "输入 API Key"} />
                <button onClick={() => setShowKey(!showKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600">
                  {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
              <button onClick={handleTest} disabled={testing || (!apiKey && !savedKey && needsApiKey)}
                className="btn-secondary flex items-center gap-1 flex-shrink-0 text-xs">
                <Wifi className="w-3 h-3" /> {testing ? "测试中..." : "测试"}
              </button>
            </div>
          </div>
          {testResult && (
            <div className={`text-xs px-3 py-1.5 rounded-lg mb-2 ${
              testResult.success ? "bg-green-50 dark:bg-green-900/30 text-green-700" : "bg-red-50 dark:bg-red-900/30 text-red-700"
            }`}>
              {testResult.message}
            </div>
          )}
        </>
      )}
      {/* 即使不需要 Key 也可以测试 */}
      {!needsApiKey && (
        <div className="mb-2">
          <button onClick={handleTest} disabled={testing}
            className="btn-secondary flex items-center gap-1 flex-shrink-0 text-xs">
            <Wifi className="w-3 h-3" /> {testing ? "测试中..." : "测试连接"}
          </button>
          {testResult && (
            <div className={`text-xs px-3 py-1.5 rounded-lg mt-2 ${
              testResult.success ? "bg-green-50 dark:bg-green-900/30 text-green-700" : "bg-red-50 dark:bg-red-900/30 text-red-700"
            }`}>
              {testResult.message}
            </div>
          )}
        </div>
      )}

      <button onClick={handleSave} disabled={saving} className="btn-primary text-xs">
        {saving ? "保存中..." : "保存配置"}
      </button>
    </div>
  );
}
