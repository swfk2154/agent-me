const BASE = "/api";

async function request(path, options = {}) {
  const res = await fetch(BASE + path, {
    headers: { "Content-Type": "application/json", ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.detail || res.statusText);
  }
  return res.json();
}

export const api = {
  // Chat
  newConversation: (title, model, systemPrompt) =>
    request("/chat/new", { method: "POST", body: JSON.stringify({ title, model, system_prompt: systemPrompt }) }),
  listConversations: () => request("/chat/list"),
  getConversation: (id) => request("/chat/" + id),
  getMessages: (convId, limit = 200) => request(`/chat/${convId}/messages?limit=${limit}`),
  deleteConversation: (id) => request("/chat/" + id, { method: "DELETE" }),
  cancelStream: (convId) => request(`/chat/cancel/${convId}`, { method: "POST" }),
  sendMessageStream: (convId, content, model, opts = {}) =>
    fetch(BASE + "/chat/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversation_id: convId,
        content,
        model: model || undefined,
        model_params: opts.modelParams || undefined,
        system_prompt: opts.systemPrompt || undefined,
        skill_key: opts.skillKey || undefined,
        search_enabled: opts.searchEnabled || false,
        file_ids: opts.fileIds || [],
        image_data: opts.imageData?.length ? opts.imageData : undefined,
      }),
    }),

  // Config
  getProviders: () => request("/config/providers"),
  getProvider: (key) => request("/config/provider/" + key),
  saveProvider: (data) => request("/config/provider", { method: "POST", body: JSON.stringify(data) }),
  testConnection: (data) => request("/config/test", { method: "POST", body: JSON.stringify(data) }),
  getModels: () => request("/config/models"),
  setDefault: (providerKey) => request("/config/default", { method: "POST", body: JSON.stringify({ provider_key: providerKey }) }),

  // Files
  uploadFile: async (file) => {
    const fd = new FormData(); fd.append("file", file);
    const r = await fetch(BASE + "/files/upload", { method: "POST", body: fd });
    return r.json();
  },
  listFiles: () => request("/files/list"),
  deleteFile: (id) => request("/files/" + id, { method: "DELETE" }),

  // Memory
  searchMemories: (q) => request("/memory/search?q=" + encodeURIComponent(q)),
  clearMemory: () => request("/memory/clear", { method: "DELETE" }),
  getProfile: () => request("/memory/profile"),
  updateProfile: (data) => request("/memory/profile", { method: "POST", body: JSON.stringify(data) }),
  cleanupMemories: (maxAge = 90, minImportance = 3) =>
    request("/memory/cleanup?max_age_days=" + maxAge + "&min_importance=" + minImportance, { method: "POST" }),
  getMemoryStats: () => request("/memory/stats"),

  // Tasks
  listTasks: () => request("/tasks/list"),
  createTask: (data) => request("/tasks/create", { method: "POST", body: JSON.stringify(data) }),
  updateTask: (id, data) => request("/tasks/" + id, { method: "PUT", body: JSON.stringify(data) }),
  deleteTask: (id) => request("/tasks/" + id, { method: "DELETE" }),

  // Writing
  getTemplates: () => request("/writing/templates"),
  executeWriting: (data) => request("/writing/execute", { method: "POST", body: JSON.stringify(data) }),

  // Skills
  getSkillModes: () => request("/skills/modes"),
  getSkillDetail: (key) => request("/skills/" + key),

  // Search
  getSearchConfig: () => request("/search/config"),
  saveSearchConfig: (data) => request("/search/config", { method: "POST", body: JSON.stringify(data) }),
  testSearchConnection: (data) => request("/search/test", { method: "POST", body: JSON.stringify(data) }),
  searchWeb: (q, max = 5) => request("/search/web?q=" + encodeURIComponent(q) + "&max_results=" + max),

  // Export
  exportConversation: (id, format = "markdown") => request("/export/" + id + "?format=" + format),

  // Commands
  evaluateCommand: (data) => request("/commands/evaluate", { method: "POST", body: JSON.stringify(data) }),
  executeCommand: (data) => request("/commands/execute", { method: "POST", body: JSON.stringify(data) }),
  getCommandLog: (limit = 50) => request("/commands/log?limit=" + limit),
  getCommandRules: () => request("/commands/rules"),

  // Logs
  getLogs: (type, lines) => request("/logs?type=" + (type || "all") + "&lines=" + (lines || 100)),
  // Agent
  listAgentTools: () => request("/agent/tools"),
  runAgent: (messages, model, opts = {}) =>
    fetch(BASE + "/agent/run", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messages,
        model: model || undefined,
        max_iterations: opts.maxIterations || 8,
        system_prompt: opts.systemPrompt || "",
      }),
    }),

  health: () => request("/health"),
};
