import { useCallback, useEffect } from "react";
import useStore from "../store";
import { api } from "../utils/api";

export function useConfig() {
  const providers = useStore((s) => s.providers);
  const store = useStore();

  const loadProviders = useCallback(async () => {
    try {
      const list = await api.getProviders();
      store.setProviders(list);
      const models = await api.getModels();
      store.setAvailableModels(models);
      if (models.length) {
        const saved = localStorage.getItem("agent-me-model");
        const exists = models.some((m) => m.value === saved);
        if (exists && saved) {
          store.setCurrentModel(saved);
        } else {
          // 当前模型不在列表中，自动选中第一个可用模型
          store.setCurrentModel(models[0].value);
        }
      }
    } catch {}
  }, []);

  const saveProvider = async (data) => {
    await api.saveProvider(data);
    await loadProviders();
    store.addToast("配置已保存", "success");
  };
  const testConnection = async (data) => api.testConnection(data);
  const setDefaultModel = async (providerKey) => { await api.setDefault(providerKey); await loadProviders(); };

  useEffect(() => { loadProviders(); }, [loadProviders]);

  return { providers: providers || [], loadProviders, saveProvider, testConnection, setDefaultModel };
}
