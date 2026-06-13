import { create } from "zustand";

const savedModel = typeof localStorage !== "undefined" ? localStorage.getItem("agent-me-model") : null;

const useStore = create((set, get) => ({
  // Conversations
  conversations: [],
  activeConversation: null,
  setConversations: (list) => set({ conversations: list }),
  setActiveConversation: (id) => set({ activeConversation: id }),
  addConversation: (conv) => set((s) => ({ conversations: [conv, ...s.conversations] })),
  removeConversation: (id) => set((s) => ({
    conversations: s.conversations.filter((c) => c.id !== id),
    activeConversation: s.activeConversation === id ? null : s.activeConversation,
  })),
  updateConversation: (id, updates) => set((s) => ({
    conversations: s.conversations.map((c) => (c.id === id ? { ...c, ...updates } : c)),
  })),

  // Messages
  messages: {},
  addMessage: (convId, msg) => set((s) => ({
    messages: { ...s.messages, [convId]: [...(s.messages[convId] || []), msg] },
  })),
  updateLastAssistant: (convId, token) => set((s) => {
    const msgs = [...(s.messages[convId] || [])];
    const last = msgs[msgs.length - 1];
    if (last && last.role === "assistant") {
      msgs[msgs.length - 1] = { ...last, content: last.content + token };
    }
    return { messages: { ...s.messages, [convId]: msgs } };
  }),
  setMessages: (convId, msgs) => set((s) => ({ messages: { ...s.messages, [convId]: msgs } })),

  // Model
  currentModel: savedModel || "",
  setCurrentModel: (model) => {
    try { localStorage.setItem("agent-me-model", model); } catch {}
    set({ currentModel: model });
  },
  availableModels: [],
  setAvailableModels: (models) => set({ availableModels: models }),

  // Model Params
  modelParams: { temperature: null, top_p: null, max_tokens: 4096 },
  setModelParams: (params) => set((s) => ({ modelParams: { ...s.modelParams, ...params } })),

  // Providers
  providers: [],
  setProviders: (list) => set({ providers: list }),

  // Theme
  darkMode: window.matchMedia?.("(prefers-color-scheme: dark)").matches || false,
  toggleDarkMode: () =>
    set((s) => {
      const next = !s.darkMode;
      document.documentElement.classList.toggle("dark", next);
      return { darkMode: next };
    }),

  // Sidebar
  sidebarOpen: true,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),

  // Active Tab
  activeTab: "chat",
  setActiveTab: (tab) => set({ activeTab: tab }),

  // Stream state
  streaming: false,
  setStreaming: (v) => set({ streaming: v }),
  streamingAbort: null,
  setStreamingAbort: (fn) => set({ streamingAbort: fn }),

  // Skills
  skillModes: [],
  setSkillModes: (modes) => set({ skillModes: modes }),
  activeSkill: "default",
  setActiveSkill: (key) => set({ activeSkill: key }),

  // Search toggle
  searchEnabled: false,
  setSearchEnabled: (v) => set({ searchEnabled: v }),

  // System prompt per conversation
  systemPrompt: "",
  setSystemPrompt: (v) => set({ systemPrompt: v }),

  // Toast
  toasts: [],
  addToast: (message, type = "info", duration = 4000) => {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2);
    set((s) => ({ toasts: [...s.toasts, { id, message, type, duration }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, duration);
  },
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export default useStore;
