import { Component, type ReactNode } from 'react';
import Dashboard from './components/Dashboard';
import { ThemeProvider } from './context/ThemeContext';

/* ─── Global Error Boundary ──────────────────────────────────────────────── */

class AppErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error?: Error }
> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: any) {
    console.error('[AppErrorBoundary] Uncaught error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 bg-gray-950 flex items-center justify-center z-[9999]">
          <div className="text-center max-w-md p-8">
            <div className="w-16 h-16 rounded-full bg-red-500/10 flex items-center justify-center mx-auto mb-4">
              <span className="text-red-400 text-2xl font-bold">!</span>
            </div>
            <h1 className="text-xl font-semibold text-white mb-2">
              Something went wrong
            </h1>
            <p className="text-sm text-gray-400 mb-1">
              The application encountered an unexpected error.
            </p>
            <p className="text-xs text-gray-500 mb-6 font-mono break-all">
              {this.state.error?.message ?? 'Unknown error'}
            </p>
            <button
              className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors text-sm font-medium"
              onClick={() => {
                this.setState({ hasError: false });
                window.location.reload();
              }}
            >
              Reload Application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ─── App Root ───────────────────────────────────────────────────────────── */

export default function App() {
  return (
    <AppErrorBoundary>
      <ThemeProvider>
        <Dashboard />
      </ThemeProvider>
    </AppErrorBoundary>
  );
}
