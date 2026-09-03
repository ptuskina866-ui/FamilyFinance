import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCw, Home } from 'lucide-react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
  onReset?: () => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/80 backdrop-blur-md">
          <div className="bg-white rounded-3xl p-6 max-w-md w-full shadow-2xl border border-rose-100 flex flex-col gap-4 text-slate-800">
            <div className="flex items-center gap-3 text-rose-600">
              <div className="w-10 h-10 rounded-2xl bg-rose-50 border border-rose-100 flex items-center justify-center shrink-0">
                <AlertCircle size={22} />
              </div>
              <div>
                <h3 className="text-sm font-black text-slate-800">
                  {this.props.fallbackTitle || 'Произошла ошибка в интерфейсе'}
                </h3>
                <p className="text-[11px] text-slate-400 font-medium">
                  Приложение перехватило сбой для предотвращения белого экрана
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-2xl bg-slate-50 border border-slate-200/80 text-[11px] font-mono text-slate-700 max-h-48 overflow-y-auto break-all select-text">
              <span className="font-bold text-rose-600 block mb-1">
                {this.state.error?.name}: {this.state.error?.message}
              </span>
              {this.state.error?.stack && (
                <pre className="text-[10px] text-slate-500 whitespace-pre-wrap mt-2">
                  {this.state.error.stack}
                </pre>
              )}
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={this.handleReset}
                className="flex-1 py-3 px-4 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-all flex items-center justify-center gap-1.5 shadow-md active:scale-95"
              >
                <Home size={14} />
                Вернуться
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="py-3 px-4 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-all flex items-center justify-center gap-1.5 active:scale-95"
              >
                <RefreshCw size={14} />
                Обновить
              </button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
