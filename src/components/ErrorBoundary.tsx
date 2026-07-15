import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error in ErrorBoundary:", error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#211b15] flex flex-col items-center justify-center p-4 font-sans text-slate-200">
          <div className="max-w-md w-full bg-[#2b241c]/80 backdrop-blur-xl rounded-3xl border border-rose-500/20 p-8 shadow-2xl text-center relative overflow-hidden">
            <div className="absolute top-0 left-0 right-0 h-1.5 bg-rose-500"></div>
            
            <div className="inline-flex bg-rose-500/10 p-4 rounded-2xl text-rose-400 mb-4 border border-rose-500/20">
              <AlertTriangle className="w-8 h-8 animate-pulse" />
            </div>
            
            <h2 className="text-xl font-extrabold text-white">Oops, Terjadi Kesalahan!</h2>
            <p className="text-sm text-slate-400 mt-2 leading-relaxed">
              Aplikasi mengalami masalah dalam memuat tampilan. Silakan muat ulang halaman.
            </p>
            
            {this.state.error && (
              <pre className="mt-4 p-3 bg-slate-950/80 rounded-xl text-left text-xs font-mono overflow-auto max-h-40 text-rose-300 border border-slate-900 leading-normal scrollbar-thin">
                {this.state.error.message || this.state.error.toString()}
              </pre>
            )}
            
            <button
              onClick={this.handleReload}
              className="w-full mt-6 bg-gradient-to-r from-rose-500 to-pink-600 hover:from-rose-600 hover:to-pink-700 text-white font-bold py-3 px-4 rounded-xl transition-all duration-200 shadow-lg shadow-rose-500/10 hover:shadow-rose-500/20 flex items-center justify-center gap-2 cursor-pointer"
            >
              <RefreshCw className="w-4 h-4" />
              Muat Ulang Halaman
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
