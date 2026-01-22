import { cn } from "@/lib/utils";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ 
          display: 'flex', 
          alignItems: 'center', 
          justifyContent: 'center', 
          minHeight: '100vh', 
          padding: '2rem', 
          backgroundColor: '#ffffff', 
          color: '#000000',
          fontFamily: 'sans-serif'
        }}>
          <div style={{ 
            display: 'flex', 
            flexDirection: 'column', 
            alignItems: 'center', 
            width: '100%', 
            maxWidth: '800px',
            border: '2px solid #ff0000',
            padding: '2rem',
            borderRadius: '8px'
          }}>
            <h2 style={{ fontSize: '1.5rem', marginBottom: '1rem', color: '#ff0000', fontWeight: 'bold' }}>
              Application Crashed
            </h2>

            <div style={{ 
              padding: '1rem', 
              width: '100%', 
              backgroundColor: '#f0f0f0', 
              overflow: 'auto', 
              marginBottom: '1.5rem',
              border: '1px solid #ccc',
              borderRadius: '4px',
              maxHeight: '400px'
            }}>
              <p style={{ fontWeight: 'bold', marginBottom: '0.5rem' }}>{this.state.error?.message}</p>
              <pre style={{ fontSize: '0.875rem', whiteSpace: 'pre-wrap' }}>
                {this.state.error?.stack}
              </pre>
            </div>

            <button
              onClick={() => window.location.reload()}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.75rem 1.5rem',
                borderRadius: '0.5rem',
                backgroundColor: '#000000',
                color: '#ffffff',
                border: 'none',
                cursor: 'pointer',
                fontSize: '1rem'
              }}
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
