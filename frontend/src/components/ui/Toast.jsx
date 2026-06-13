import useStore from "../../store";

export default function ToastContainer() {
  const { toasts, removeToast } = useStore();
  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map((toast) => (
        <div key={toast.id} className={`toast toast-${toast.type}`}
             onClick={() => removeToast(toast.id)}>
          <span className="flex-1">{toast.message}</span>
          <button className="text-current opacity-50 hover:opacity-100 ml-2">&times;</button>
        </div>
      ))}
    </div>
  );
}
