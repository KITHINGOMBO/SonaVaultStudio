import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || 'An unexpected error occurred in SonaVault Studio.',
    };
  }

  override render() {
    if (this.state.hasError) {
      let friendly = this.state.message;
      try {
        const parsed = JSON.parse(this.state.message);
        if (parsed?.error) {
          friendly = `Cloud operation failed (${parsed.operationType || 'request'}): ${parsed.error}`;
        }
      } catch {
        // Keep raw message
      }

      return (
        <div className="min-h-screen bg-[#0E1116] text-slate-100 flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-[#161B22] border border-[#2A3241] rounded-lg p-6 space-y-4">
            <h2 className="text-xl font-semibold text-slate-100">Studio Session Interrupted</h2>
            <p className="text-sm text-slate-300 leading-relaxed break-words">{friendly}</p>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 text-sm font-medium bg-[#E59A3C] text-[#0E1116] rounded-md hover:bg-amber-400 transition-colors"
            >
              Reload Studio
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
