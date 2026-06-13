import { useState, useEffect } from "react";
import useStore from "../../store";
import { useChat } from "../../hooks/useChat";
import MessageBubble from "./MessageBubble";
import ChatInput from "./ChatInput";
import WelcomeScreen from "./WelcomeScreen";
export default function ChatArea() {
  const { messages, activeConversation, streaming } = useStore();
  const { createConversation, loadMessages } = useChat();
  const [loaded, setLoaded] = useState(false);
  const msgs = activeConversation ? (messages[activeConversation] || []) : [];

  useEffect(() => {
    if (activeConversation && !messages[activeConversation]) {
      loadMessages(activeConversation).then(() => setLoaded(true));
    } else {
      setLoaded(true);
    }
  }, [activeConversation]);

  useEffect(() => {
    document.getElementById("chat-bottom")?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, streaming]);

  if (!activeConversation) {
    return <WelcomeScreen onCreate={createConversation} />;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-4 py-6 space-y-1">
          {!loaded ? (
            <div className="space-y-4 p-4">
              <div className="skeleton h-16 w-3/4 rounded-lg" />
              <div className="skeleton h-24 w-full rounded-lg" />
              <div className="skeleton h-16 w-1/2 rounded-lg" />
            </div>
          ) : msgs.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-sm text-gray-400 select-none">
              发送消息开始对话
            </div>
          ) : (
            msgs.map((msg, i) => <MessageBubble key={i} message={msg} />)
          )}
          {streaming && (
            <div className="flex items-center gap-2 py-2 px-4">
              <div className="typing-indicator"><span /><span /><span /></div>
            </div>
          )}
          <div id="chat-bottom" />
        </div>
      </div>
      <ChatInput />
    </div>
  );
}
