import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
  resetKey?: string;
  sectionName?: string;
  onResetToHome?: () => void;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'An unexpected rendering error occurred.',
    };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Studio ErrorBoundary caught error:', error, info);
  }

  componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, message: '' });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="mx-auto max-w-2xl px-4 py-10">
          <div
            role="alert"
            className="rounded-3xl border border-red-500/35 bg-[#121216]/90 backdrop-blur-xl p-8 text-center shadow-[0_24px_80px_rgba(0,0,0,0.75)]"
          >
            <AlertTriangle className="mx-auto h-10 w-10 text-[#E5C158] mb-3" />
            <h2 className="font-display text-xl font-bold text-[#F5F3EE]">
              {this.props.sectionName ? `${this.props.sectionName} encountered an issue` : 'Something went wrong'}
            </h2>
            <p className="mt-2 text-sm text-[#B8B2A6]">{this.state.message}</p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => this.setState({ hasError: false, message: '' })}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[#E5C158]/70 bg-gradient-to-b from-[#E5C158] to-[#C59B27] px-5 py-2 text-sm font-semibold text-[#09090C] cursor-pointer"
              >
                <RotateCcw className="h-4 w-4" />
                <span>Recover Section</span>
              </button>
              {this.props.onResetToHome && (
                <button
                  type="button"
                  onClick={() => {
                    this.setState({ hasError: false, message: '' });
                    this.props.onResetToHome?.();
                  }}
                  className="inline-flex min-h-[44px] items-center rounded-xl border border-white/15 bg-white/5 px-5 py-2 text-sm font-medium text-[#F5F3EE] hover:border-[#D4AF37]/40 cursor-pointer"
                >
                  Back to Home
                </button>
              )}
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
