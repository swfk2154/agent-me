import { Component } from "react";
import useStore from "./store";
import Layout from "./components/layout/Layout";
import ToastContainer from "./components/ui/Toast";

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }
  componentDidCatch(error, errorInfo) {
    console.error("ErrorBoundary:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-screen items-center justify-center bg-gray-50 dark:bg-gray-950">
          <div className="card max-w-md text-center space-y-4">
            <div className="text-4xl">⚠</div>
            <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-200">出了点问题</h2>
            <p className="text-sm text-gray-500">{this.state.error?.message || "未知错误"}</p>
            <button onClick={() => { this.setState({ hasError: false }); window.location.reload(); }}
              className="btn-primary">
              刷新页面
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const { darkMode } = useStore();
  if (darkMode) {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }

  return (
    <ErrorBoundary>
      <Layout />
      <ToastContainer />
    </ErrorBoundary>
  );
}
