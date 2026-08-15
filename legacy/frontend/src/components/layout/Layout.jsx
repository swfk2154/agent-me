import useStore from "../../store";
import ChatArea from "../chat/ChatArea";
import SettingsPage from "../settings/SettingsPage";
import MemoryBrowser from "../memory/MemoryBrowser";
import TaskPanel from "../tasks/TaskPanel";
import WritingPanel from "../writing/WritingPanel";
import CommandPanel from "../commands/CommandPanel";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";

export default function Layout() {
  const { activeTab } = useStore();

  const renderContent = () => {
    switch (activeTab) {
      case "chat": return <ChatArea />;
      case "memory": return <MemoryBrowser />;
      case "tasks": return <TaskPanel />;
      case "writing": return <WritingPanel />;
      case "commands": return <CommandPanel />;
      case "settings": return <SettingsPage />;
      default: return <ChatArea />;
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-white dark:bg-gray-950">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar />
        <main className="flex-1 overflow-hidden">{renderContent()}</main>
      </div>
    </div>
  );
}
