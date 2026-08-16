import {StrictMode, Component, ErrorInfo, ReactNode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  public override state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  public override render() {
    if (this.state.hasError) {
      return (
        <div style={{ padding: "40px", color: "#ef4444", backgroundColor: "#000000", minHeight: "100vh", fontFamily: "monospace", overflow: "auto" }}>
          <h1 style={{ fontSize: "24px", marginBottom: "20px" }}>🚨 Cinemana TV: Runtime Render Error</h1>
          <p style={{ color: "#f8fafc", fontSize: "16px" }}>The React application crashed during rendering. Details below:</p>
          <pre style={{ color: "#ef4444", background: "#111", padding: "15px", borderRadius: "8px", border: "1px solid #333", whiteSpace: "pre-wrap" }}>
            {this.state.error?.toString()}
          </pre>
          <h3 style={{ color: "#94a3b8", marginTop: "20px" }}>Stack Trace:</h3>
          <pre style={{ color: "#64748b", background: "#111", padding: "15px", borderRadius: "8px", border: "1px solid #333", whiteSpace: "pre-wrap", fontSize: "12px" }}>
            {this.state.error?.stack}
          </pre>
        </div>
      );
    }

    return this.props.children;
  }
}

// Safe global error logging without blocking UI with black overlay
if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    console.error("Global JS Error:", event.error || event.message);
  });

  window.addEventListener('unhandledrejection', (event) => {
    console.warn("Unhandled Promise Rejection:", event.reason);
  });
}

// Safe mounting: mount directly into existing #root or wait for DOMContentLoaded
function mountApp() {
  let rootElement = document.getElementById('root') ||
                    document.getElementById('cinemana-tv-theme-elementor-container') || 
                    document.getElementById('cinemana-tv-theme-container');

  if (!rootElement) {
    if (!document.body && !document.documentElement) return false;
    rootElement = document.createElement('div');
    rootElement.id = 'root';
    rootElement.className = 'w-full min-h-screen bg-black overflow-hidden relative';
    if (document.body) {
      document.body.appendChild(rootElement);
    } else {
      document.documentElement.appendChild(rootElement);
    }
  }

  createRoot(rootElement).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
  return true;
}

let mounted = false;

function safeMount() {
  if (mounted) return;

  const target = document.getElementById('root') ||
                 document.getElementById('cinemana-tv-theme-elementor-container') || 
                 document.getElementById('cinemana-tv-theme-container');

  if (target) {
    mounted = true;
    mountApp();
  } else if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      if (!mounted) {
        mounted = true;
        mountApp();
      }
    });
  } else {
    mounted = true;
    mountApp();
  }
}

safeMount();


