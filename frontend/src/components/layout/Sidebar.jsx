import { MessageSquare, Brain, CheckSquare, PenLine, Settings, Plus, Trash2, PanelLeftClose, PanelLeft, Terminal, Download } from "lucide-react";
import useStore from "../../store";
import { useChat } from "../../hooks/useChat";

const navItems = [
  { key: "chat", icon: MessageSquare, label: "对话" },
  { key: "memory", icon: Brain, label: "记忆库" },
  { key: "tasks", icon: CheckSquare, label: "任务" },
  { key: "writing", icon: PenLine, label: "写作" },
  { key: "commands", icon: Terminal, label: "命令" },
  { key: "settings", icon: Settings, label: "设置" },
];

export default function Sidebar() {
  const { conversations, activeConversation, sidebarOpen, toggleSidebar, activeTab, setActiveTab, darkMode, toggleDarkMode } = useStore();
  const { createConversation, selectConversation, deleteConversation } = useChat();

  if (!sidebarOpen) {
    return (
      <button onClick={toggleSidebar}
        className="p-3 hover:bg-gray-100 dark:hover:bg-gray-800 border-r border-gray-100 dark:border-gray-800 shrink-0">
        <PanelLeft className="w-5 h-5 text-gray-500" />
      </button>
    );
  }

  // 分组对话
  const today = new Date().toDateString();
  const todayConvs = conversations.filter((c) => new Date(c.created_at).toDateString() === today);
  const olderConvs = conversations.filter((c) => new Date(c.created_at).toDateString() !== today);

  return (
    <aside className="w-64 flex flex-col border-r border-gray-100 dark:border-gray-800 bg-gray-50/50 dark:bg-gray-900/50 shrink-0">
      {/* 头部 */}
      <div className="p-4 flex items-center justify-between border-b border-gray-100 dark:border-gray-800">
        <h1 className="text-lg font-bold text-[#534AB7] tracking-tight select-none">agent-me</h1>
        <button onClick={toggleSidebar} className="p-1 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors">
          <PanelLeftClose className="w-4 h-4 text-gray-400" />
        </button>
      </div>

      {/* 新对话按钮 */}
      <button onClick={createConversation}
        className="mx-3 mt-3 flex items-center justify-center gap-2 btn-primary">
        <Plus className="w-4 h-4" /> 新对话
      </button>

      {/* 导航 */}
      <nav className="px-3 mt-3 space-y-0.5">
        {navItems.map(({ key, icon: Icon, label }) => (
          <button key={key} onClick={() => { setActiveTab(key); }}
            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-all duration-200 ${
              activeTab === key
                ? "bg-[#f3f1ff] dark:bg-[#534AB7]/15 text-[#534AB7] font-medium"
                : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
            }`}>
            <Icon className="w-4 h-4" /> {label}
          </button>
        ))}
      </nav>

      {/* 对话列表 */}
      <div className="mt-4 px-3 flex-1 overflow-y-auto space-y-0.5">
        <p className="px-3 mb-2 text-[11px] text-gray-400 uppercase tracking-wider font-medium">对话列表</p>

        {conversations.length === 0 && (
          <p className="px-3 text-xs text-gray-400">暂无对话</p>
        )}

        {todayConvs.length > 0 && (
          <>
            <p className="px-3 text-[10px] text-gray-400 uppercase tracking-wider mt-1">今天</p>
            {todayConvs.map((c) => (
              <ConvItem key={c.id} conv={c} isActive={activeConversation === c.id}
                        onSelect={selectConversation} onDelete={deleteConversation} />
            ))}
          </>
        )}

        {olderConvs.length > 0 && (
          <>
            <p className="px-3 text-[10px] text-gray-400 uppercase tracking-wider mt-2">更早</p>
            {olderConvs.map((c) => (
              <ConvItem key={c.id} conv={c} isActive={activeConversation === c.id}
                        onSelect={selectConversation} onDelete={deleteConversation} />
            ))}
          </>
        )}
      </div>

      {/* 底部 */}
      <div className="p-3 border-t border-gray-100 dark:border-gray-800 flex items-center gap-1">
        <button onClick={toggleDarkMode}
          className="flex-1 btn-ghost flex items-center justify-center gap-1.5 text-xs">
          {darkMode ? "☀ 亮色" : "☾ 暗色"}
        </button>
      </div>
    </aside>
  );
}

function ConvItem({ conv, isActive, onSelect, onDelete }) {
  return (
    <div onClick={() => onSelect(conv.id)}
      className={`group flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer text-sm transition-all duration-200 ${
        isActive
          ? "bg-[#f3f1ff] dark:bg-[#534AB7]/15 text-[#534AB7] font-medium"
          : "text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800"
      }`}>
      <span className="truncate flex-1">{conv.title}</span>
      <button onClick={(e) => { e.stopPropagation(); onDelete(conv.id); }}
        className="opacity-0 group-hover:opacity-100 p-1 hover:bg-red-100 dark:hover:bg-red-900/30 rounded transition-all">
        <Trash2 className="w-3 h-3 text-red-400" />
      </button>
    </div>
  );
}
