import { useEffect, useCallback, useRef } from "react";
import useStore from "../store";
import { api } from "../utils/api";

export function useChat() {
  const store = useStore();
  const abortRef = useRef(null);

  useEffect(() => {
    api.listConversations().then((list) => {
      store.setConversations(list);
      if (list.length && !store.activeConversation) store.setActiveConversation(list[0].id);
    }).catch(() => {});
    api.getSkillModes().then((modes) => store.setSkillModes(modes)).catch(() => {});
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
    const conv = await api.newConversation(title, store.currentModel, store.systemPrompt);
    store.addConversation(conv);
    store.setActiveConversation(conv.id);
    store.setMessages(conv.id, []);
    store.setActiveTab("chat");
    return conv;
  };

  const sendMessage = async (content, fileIds = [], imageData = []) => {
    let convId = store.activeConversation;
    if (!convId) {
      const conv = await createConversation();
      convId = conv.id;
    }

    store.addMessage(convId, { role: "user", content: imageData.length ? `[图片] ${content}` : content, timestamp: new Date().toISOString() });
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

  return { createConversation, sendMessage, cancelStream, selectConversation, deleteConversation, loadMessages };
}
