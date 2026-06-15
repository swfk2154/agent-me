import { useState, useEffect } from "react";
import { Shield, Wand2, Globe, ScrollText, Cpu } from "lucide-react";
import { useConfig } from "../../hooks/useConfig";
import { api } from "../../utils/api";
import ProviderCard from "./ProviderCard";
import SearchProviderCard from "./SearchProviderCard";
import LogViewer from "./LogViewer";

const categories = [
  { key: "llm", icon: Cpu, label: "LLM 配置" },
  { key: "search", icon: Globe, label: "搜索配置" },
  { key: "logs", icon: ScrollText, label: "日志" },
  { key: "about", icon: Wand2, label: "关于" },
];

const SEARCH_LIST = [
  { key: "duckduckgo", name: "DuckDuckGo", description: "免费即时搜索，无需 API Key", needs_api_key: false, api_key_url: "", is_custom: false },
  { key: "tavily", name: "Tavily", description: "专为 AI Agent 优化的搜索 API", needs_api_key: true, api_key_url: "https://app.tavily.com/home", is_custom: false },
  { key: "brave", name: "Brave Search", description: "Brave 搜索引擎 API", needs_api_key: true, api_key_url: "https://api.search.brave.com/app/keys", is_custom: false },
  { key: "bing", name: "Bing Search", description: "微软 Bing 搜索 API（免费 1000次/月）", needs_api_key: true, api_key_url: "https://portal.azure.com/#create/microsoft.bingsearch", is_custom: false },
  { key: "serpapi", name: "SerpAPI", description: "Google 搜索结果 API", needs_api_key: true, api_key_url: "https://serpapi.com/manage-api-key", is_custom: false },
  { key: "serper", name: "Serper.dev", description: "快速 Google 搜索 API（免费额度 2500次/月）", needs_api_key: true, api_key_url: "https://serper.dev/api-key", is_custom: false },
  { key: "searxng", name: "SearXNG (自建)", description: "开源元搜索引擎，可 Docker 自建 — github.com/searxng/searxng", needs_api_key: false, api_key_url: "https://github.com/searxng/searxng", is_custom: false },
  { key: "custom", name: "自定义搜索", description: "兼容 JSON 格式的搜索 API，自行填写 URL", needs_api_key: true, api_key_url: "", is_custom: true },
];

export default function SettingsPage() {
  const [cat, setCat] = useState("llm");
  const { providers, saveProvider, testConnection, setDefaultModel } = useConfig();
  const [searchConfig, setSearchConfig] = useState({ active_provider: "duckduckgo", providers: {} });
  const [searchLoaded, setSearchLoaded] = useState(false);

  const loadSearchConfig = async () => {
    try { const cfg = await api.getSearchConfig(); setSearchConfig(cfg); } catch {}
    setSearchLoaded(true);
  };
  useEffect(() => { if (cat === "search" && !searchLoaded) loadSearchConfig(); }, [cat, searchLoaded]);

  const saveSearchProvider = async (key, cfg) => {
    const np = { ...searchConfig.providers, [key]: cfg };
    await api.saveSearchConfig({ active_provider: searchConfig.active_provider, providers: np });
    setSearchConfig((prev) => ({ ...prev, providers: np }));
  };
  const testSearchConn = async (data) => api.testSearchConnection(data);
  const setActiveSearch = async (key) => {
    // 只允许一个搜索引擎激活
    await api.saveSearchConfig({ active_provider: key, providers: searchConfig.providers });
    setSearchConfig((prev) => ({ ...prev, active_provider: key }));
  };
  const setLLMDefault = async (providerKey) => {
    // 只允许一个LLM默认
    await setDefaultModel(providerKey);
  };

  return (
    <div className="flex h-full">
      <nav className="w-48 border-r border-gray-100 dark:border-gray-800 p-4 space-y-1 shrink-0">
        {categories.map(({ key, icon: Icon, label }) => (
          <button key={key} onClick={() => setCat(key)}
            className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
              cat === key
                ? "bg-[#f3f1ff] dark:bg-[#534AB7]/15 text-[#534AB7] font-medium"
                : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
            }`}>
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </nav>
      <div className="flex-1 overflow-y-auto p-6">
        {cat === "llm" && (
          <div>
            <h2 className="text-lg font-semibold mb-1">LLM 提供商配置</h2>
            <p className="text-sm text-gray-500 mb-6">配置至少一家提供商的 API Key 即可开始使用</p>
            <div className="space-y-3">
              {providers.map((p) => (
                <ProviderCard key={p.key} provider={p} onSave={saveProvider} onTest={testConnection} onSetDefault={setLLMDefault} />
              ))}
            </div>
          </div>
        )}
        {cat === "search" && (
          <div>
            <h2 className="text-lg font-semibold mb-1">联网搜索配置</h2>
            <p className="text-sm text-gray-500 mb-6">选择搜索引擎，DuckDuckGo 免费无需 Key</p>
            <div className="space-y-3">
              {SEARCH_LIST.map((sp) => (
                <SearchProviderCard key={sp.key} provider={sp}
                  isActive={searchConfig.active_provider === sp.key}
                  config={searchConfig.providers[sp.key] || {}}
                  onSave={saveSearchProvider} onTest={testSearchConn} onSetActive={setActiveSearch} />
              ))}
            </div>
          </div>
        )}
        {cat === "logs" && <LogViewer />}
        {cat === "about" && (
          <div className="max-w-lg">
            <h2 className="text-lg font-semibold mb-4">关于 agent-me</h2>
            <div className="card space-y-3 text-sm text-gray-600 dark:text-gray-400">
              <p>agent-me v2.0 — 通用个人 AI Agent</p>
              <p>支持 9 家 LLM 厂商、三层记忆系统、文件分析、写作助手、任务管理、联网搜索、命令安全执行、对话导出。</p>
              <p>所有数据（API Key、对话记录、记忆）均加密存储在本地，不上传任何第三方服务器。</p>
              <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-800">
                <h3 className="font-medium text-gray-800 dark:text-gray-200 mb-2">内置 15 种技能模式</h3>
                <ul className="list-disc ml-5 mt-1 space-y-0.5 text-xs">
                  <li>架构与规划 / 产品思维 / 交付迭代 / 极简依赖</li>
                  <li>OOP风格 / 函数式风格</li>
                  <li>极简回复 / 诊断排查 / 深度追问 / 快速原型</li>
                  <li>TDD / 架构审查 / 问题分诊 / 全局视角 / 安全审查</li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
