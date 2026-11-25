import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { clearClientCacheSafely, initSyncStore } from './utils/storage';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

class AppErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorMessage: '' };
  }

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error instanceof Error ? error.message : 'Unexpected display error',
    };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 shadow-xs space-y-4 text-center">
            <h1 className="text-base font-bold text-slate-900 dark:text-white">
              Page Refresh Needed
            </h1>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Cached browser state from an earlier deployment caused a display error ({this.state.errorMessage}). Your database records remain safe.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => {
                  clearClientCacheSafely();
                  window.location.reload();
                }}
                className="px-4 py-2 text-xs font-bold text-slate-950 bg-amber-500 hover:bg-amber-400 rounded-lg cursor-pointer"
              >
                Clear Browser Cache &amp; Reload
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="px-4 py-2 text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 rounded-lg cursor-pointer"
              >
                Reload Page
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('vite:preloadError', () => {
    clearClientCacheSafely();
    window.location.reload();
  });
}

async function bootstrap() {
  await Promise.race([
    initSyncStore(),
    new Promise<void>((resolve) => setTimeout(resolve, 1500)),
  ]);
  createRoot(document.getElementById('root')!).render(
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  );
}

void bootstrap();
