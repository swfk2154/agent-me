import { useState, useEffect } from "react";
import { Plus, Trash2, Check, Calendar } from "lucide-react";
import { api } from "../../utils/api";

export default function TaskPanel() {
  const [tasks, setTasks] = useState([]);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [due, setDue] = useState("");

  const refresh = async () => { try { setTasks(await api.listTasks()); } catch {} };
  useEffect(() => { refresh(); }, []);

  const add = async () => {
    if (!title.trim()) return;
    await api.createTask({ title: title.trim(), description: desc.trim(), due_date: due || null });
    setTitle(""); setDesc(""); setDue("");
    refresh();
  };

  const toggle = async (t) => {
    await api.updateTask(t.id, { completed: !t.completed });
    refresh();
  };

  const del = async (id) => { await api.deleteTask(id); refresh(); };

  return (
    <div className="max-w-3xl mx-auto p-6 h-full overflow-y-auto">
      <h2 className="text-lg font-semibold mb-1">任务管理</h2>
      <p className="text-sm text-gray-500 mb-6">管理你的待办事项</p>
      <div className="card mb-6 space-y-3">
        <input className="input-field" value={title} onChange={(e) => setTitle(e.target.value)}
               placeholder="任务标题" onKeyDown={(e) => { if (e.key === "Enter") add(); }} />
        <textarea className="input-field" value={desc} onChange={(e) => setDesc(e.target.value)}
                  placeholder="描述（可选）" rows={2} />
        <div className="flex gap-2">
          <input type="date" className="input-field flex-1" value={due} onChange={(e) => setDue(e.target.value)} />
          <button onClick={add} className="btn-primary flex items-center gap-1"><Plus className="w-4 h-4" /> 添加</button>
        </div>
      </div>
      <div className="space-y-2">
        {tasks.filter((t) => !t.completed).map((t) => (
          <div key={t.id} className="card flex items-start gap-3">
            <button onClick={() => toggle(t)} className="mt-0.5 w-5 h-5 rounded-full border-2 border-gray-300 dark:border-gray-600 flex items-center justify-center hover:border-primary-500 flex-shrink-0">
              <Check className="w-3 h-3 text-transparent" />
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-800 dark:text-gray-200">{t.title}</p>
              {t.description && <p className="text-xs text-gray-500 mt-0.5">{t.description}</p>}
              {t.due_date && <span className="inline-flex items-center gap-1 text-xs text-gray-400 mt-1"><Calendar className="w-3 h-3" /> {t.due_date}</span>}
            </div>
            <button onClick={() => del(t.id)} className="p-1 hover:bg-red-50 dark:hover:bg-red-900/30 rounded"><Trash2 className="w-3 h-3 text-red-400" /></button>
          </div>
        ))}
        {tasks.some((t) => t.completed) && (
          <div className="mt-4">
            <p className="text-xs text-gray-400 mb-2">已完成</p>
            {tasks.filter((t) => t.completed).map((t) => (
              <div key={t.id} className="card flex items-start gap-3 opacity-60 mb-2">
                <button onClick={() => toggle(t)} className="mt-0.5 w-5 h-5 rounded-full bg-primary-600 flex items-center justify-center flex-shrink-0">
                  <Check className="w-3 h-3 text-white" />
                </button>
                <div className="flex-1 min-w-0">
                  <p className="text-sm line-through text-gray-500">{t.title}</p>
                </div>
                <button onClick={() => del(t.id)} className="p-1 hover:bg-red-50 rounded"><Trash2 className="w-3 h-3 text-red-400" /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
