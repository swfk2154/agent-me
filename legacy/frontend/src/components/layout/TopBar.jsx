import { Moon, Sun } from "lucide-react";
import useStore from "../../store";
import ModelSwitcher from "../chat/ModelSwitcher";

export default function TopBar() {
  const { darkMode, toggleDarkMode, activeTab, skillModes, activeSkill, setActiveSkill } = useStore();
  const tabLabels = { chat: "对话", memory: "记忆", tasks: "任务", writing: "写作", commands: "命令", settings: "设置" };

  return (
    <header className="h-11 border-b border-gray-100 dark:border-gray-800 flex items-center justify-between px-4 shrink-0 bg-white dark:bg-gray-950">
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-gray-500 select-none">{tabLabels[activeTab] || activeTab}</span>
        {activeTab === "chat" && skillModes.length > 0 && (
          <div className="flex items-center gap-1 ml-2 border-l border-gray-200 dark:border-gray-700 pl-2 overflow-x-auto">
            {skillModes.slice(0, 12).map((m) => (
              <button key={m.key} onClick={() => setActiveSkill(m.key)}
                className={`px-2 py-0.5 text-[11px] rounded-full transition-all duration-200 whitespace-nowrap ${
                  activeSkill === m.key
                    ? "bg-[#f3f1ff] dark:bg-[#534AB7]/20 text-[#534AB7] font-medium"
                    : "text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                }`} title={m.description}>
                {m.name}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <ModelSwitcher />
        <button onClick={toggleDarkMode}
          className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
          {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>
      </div>
    </header>
  );
}
