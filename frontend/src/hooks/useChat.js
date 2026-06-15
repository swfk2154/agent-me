import { useEffect, useCallback, useRef, useState } from "react";
import useStore from "../store";
import { api } from "../utils/api";

export function useChat() {
  const store = useStore();
  const abortRef = useRef(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api.listConversations().then((list) => {
      store.setConversations(list);
      if (list.length && !store.activeConversation) store.setActiveConversation(list[0].id);
    }).catch(() => {});
    api.getSkillModes().then((modes) => store.setSkillModes(modes)).catch(() => {});
    // 初始化时加载模型列表，确保顶栏下拉框立即可用
    api.getProviders().then((list) => store.setProviders(list)).catch(() => {});
    api.getModels().then((models) => {
      store.setAvailableModels(models);
      if (models.length) {
        const saved = localStorage.getItem("agent-me-model");
        const exists = models.some((m) => m.value === saved);
        if (exists && saved) {
          store.setCurrentModel(saved);
        } else if (!store.currentModel) {
          store.setCurrentModel(models[0].value);
        }
      }
    }).catch(() => {});
  }, []);

  const loadMessages = useCallback(async (convId) => {
    try {
      const msgs = await api.getMessages(convId);
      store.setMessages(convId, msgs.map((m) => ({ role: m.role, content: m.content, timestamp: m.created_at })));
    } catch {
      store.setMessages(convId, []);
    }
  }, []);

  const createConversation = async (title = "新对话") => {
    setCreating(true);
    try {
      const conv = await api.newConversation(title, store.currentModel, store.systemPrompt);
      store.addConversation(conv);
      store.setActiveConversation(conv.id);
      store.setMessages(conv.id, []);
      store.setActiveTab("chat");
      return conv;
    } catch (e) {
      store.addToast(`创建对话失败: ${e.message || "请检查后端是否已启动"}`, "error");
      throw e;
    } finally {
      setCreating(false);
    }
  };

  const sendMessage = async (content, fileIds = [], imageData = []) => {
    let convId = store.activeConversation;
    if (!convId) {
      try {
        const conv = await createConversation();
        convId = conv.id;
      } catch {
        return;
      }
    }

    store.addMessage(convId, { role: "user", content: imageData.length ? `[图片] ${content}` : content, images: imageData, timestamp: new Date().toISOString() });
    store.addMessage(convId, { role: "assistant", content: "", timestamp: new Date().toISOString() });
    store.setStreaming(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const response = await api.sendMessageStream(convId, content, store.currentModel, {
        modelParams: Object.keys(store.modelParams || {}).length > 0 ? store.modelParams : undefined,
        systemPrompt: store.systemPrompt || undefined,
        skillKey: store.activeSkill !== "default" ? store.activeSkill : undefined,
        searchEnabled: store.searchEnabled,
        fileIds: fileIds,
        imageData: imageData,
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (controller.signal.aborted) return;
          if (line.startsWith("data: ") && line !== "data: [DONE]") {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.token) store.updateLastAssistant(convId, data.token);
            } catch {}
          }
        }
      }
    } catch (e) {
      if (e.name !== "AbortError") {
        store.addToast(e.message, "error");
      }
    } finally {
      store.setStreaming(false);
      // Refresh conversation list
      try {
        const list = await api.listConversations();
        store.setConversations(list);
      } catch {}
    }
  };

  const cancelStream = () => {
    if (abortRef.current) abortRef.current.abort();
    store.setStreaming(false);
  };

  const selectConversation = (id) => {
    store.setActiveConversation(id);
    store.setActiveTab("chat");
  };

  const deleteConversation = async (id) => {
    await api.deleteConversation(id);
    store.removeConversation(id);
    if (store.activeConversation === id) {
      store.setActiveConversation(null);
    }
  };

  return { createConversation, sendMessage, cancelStream, selectConversation, deleteConversation, loadMessages, creating };
}
