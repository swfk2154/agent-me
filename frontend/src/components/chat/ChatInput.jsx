import { useState, useRef } from "react";
import { Send, Paperclip, X, Globe, StopCircle, Image } from "lucide-react";
import { useChat } from "../../hooks/useChat";
import { api } from "../../utils/api";
import useStore from "../../store";

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function ChatInput() {
  const [input, setInput] = useState("");
  const [files, setFiles] = useState([]);
  const [images, setImages] = useState([]);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef(null);
  const imageRef = useRef(null);
  const textareaRef = useRef(null);
  const { sendMessage, cancelStream } = useChat();
  const { streaming, searchEnabled, setSearchEnabled } = useStore();

  const handleSend = async () => {
    if (!input.trim() && files.length === 0 && images.length === 0) return;
    let content = input.trim() || "请描述这张图片";
    if (files.length && !images.length && !input.trim()) content = "请分析我上传的文件";
    if (searchEnabled) content = "[联网搜索] " + content;
    setInput("");
    const fileIds = files.map((f) => f.id);
    const imageData = images.map((img) => ({ data: img.data, format: img.format }));
    setFiles([]);
    setImages([]);
    if (textareaRef.current) { textareaRef.current.style.height = "auto"; }
    await sendMessage(content, fileIds, imageData);
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleFileUpload = async (e) => {
    const fs = Array.from(e.target.files);
    if (!fs.length) return;
    setUploading(true);
    for (const f of fs) {
      try {
        if (f.type.startsWith("image/")) {
          const b64 = await fileToBase64(f);
          setImages((prev) => [...prev, { data: b64, format: f.type.split("/")[1] || "png", name: f.name }]);
        } else {
          const result = await api.uploadFile(f);
          setFiles((prev) => [...prev, result]);
        }
      } catch (err) {
        useStore.getState().addToast?.("上传失败: " + err.message, "error");
      }
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = "";
    if (imageRef.current) imageRef.current.value = "";
  };

  const allAttachments = [
    ...images.map((img) => ({ ...img, isImage: true })),
    ...files.map((f) => ({ ...f, isImage: false })),
  ];

  return (
    <div className="border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-950 px-4 py-3">
      <div className="max-w-3xl mx-auto">
        {allAttachments.length > 0 && (
          <div className="flex gap-2 mb-2 flex-wrap">
            {allAttachments.map((a, i) => (
              <span key={i} className={`badge-primary flex items-center gap-1 ${a.isImage ? "badge-success" : ""}`}>
                {a.isImage ? <Image className="w-3 h-3" /> : null}
                {a.name || a.filename}
                <button onClick={() => {
                  if (a.isImage) setImages((p) => p.filter((_, j) => j !== i));
                  else setFiles((p) => p.filter((x) => x.id !== a.id));
                }}>
                  <X className="w-3 h-3" />
                </button>
              </span>
            ))}
          </div>
        )}

        <div className="flex items-end gap-1.5 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl px-3 py-2 focus-within:ring-2 focus-within:ring-[#534AB7]/25 focus-within:border-[#534AB7] transition-all duration-200">
          <div className="flex items-center gap-0.5 pb-0.5">
            <button onClick={() => setSearchEnabled(!searchEnabled)}
              className={`p-1.5 rounded-lg transition-colors ${
                searchEnabled ? "bg-[#f3f1ff] dark:bg-[#534AB7]/15 text-[#534AB7]" : "text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800"
              }`} title="联网搜索">
              <Globe className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => imageRef.current?.click()} disabled={uploading}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50" title="上传图片">
              <Image className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => fileRef.current?.click()} disabled={uploading}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors disabled:opacity-50" title="上传文档">
              <Paperclip className="w-3.5 h-3.5" />
            </button>
            <input ref={fileRef} type="file" onChange={handleFileUpload}
              accept=".pdf,.docx,.doc,.txt,.md" multiple className="hidden" />
            <input ref={imageRef} type="file" onChange={handleFileUpload}
              accept="image/*" multiple className="hidden" />
          </div>

          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => { setInput(e.target.value); }}
            onKeyDown={handleKeyDown}
            placeholder={images.length ? "描述这张图片..." : "输入消息... (Shift+Enter 换行)"}
            rows={1}
            className="flex-1 resize-none bg-transparent border-none outline-none text-sm placeholder:text-gray-400 dark:placeholder:text-gray-500 py-1.5 max-h-32"
            disabled={streaming}
          />

          {streaming ? (
            <button onClick={cancelStream}
              className="p-1.5 bg-red-500 hover:bg-red-600 text-white rounded-xl transition-all shrink-0">
              <StopCircle className="w-4 h-4" />
            </button>
          ) : (
            <button onClick={handleSend} disabled={!input.trim() && files.length === 0 && images.length === 0}
              className="p-1.5 bg-[#534AB7] hover:bg-[#433d91] text-white rounded-xl transition-all disabled:opacity-30 shrink-0">
              <Send className="w-4 h-4" />
            </button>
          )}
        </div>

        <p className="text-[10px] text-gray-400 text-center mt-1.5 select-none">
          支持图片识别 (GPT-4o/Claude/Gemini) · 输入任务相关关键词自动调用工具 · agent-me 可能产生错误信息
        </p>
      </div>
    </div>
  );
}
