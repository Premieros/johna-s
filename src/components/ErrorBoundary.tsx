import { Component, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';
import { userFacingErrorMessage } from '@/lib/userFacingError';

interface Props { children: ReactNode; }
interface State { error: Error | null; }

const STALE_CHUNK_KEY = 'premier_stale_chunk_reload';

export function isStaleChunkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /Failed to fetch dynamically imported module|Importing a module script failed|Loading chunk [\w-]+ failed|ChunkLoadError/i.test(message);
}

function staleChunkReloadAlreadyAttempted(): boolean {
  try {
    // sessionStorage survives a page reload but is cleared when the tab closes.
    // This caps automatic stale-build recovery to once per working tab instead
    // of repeatedly reloading operators after every deployment.
    return sessionStorage.getItem(STALE_CHUNK_KEY) !== null;
  } catch {
    return false;
  }
}

export function recoverFromStaleChunk(): boolean {
  if (staleChunkReloadAlreadyAttempted()) return false;
  try { sessionStorage.setItem(STALE_CHUNK_KEY, String(Date.now())); } catch { /* ignore storage errors */ }

  const url = new URL(window.location.href);
  url.searchParams.set('__refresh', String(Date.now()));
  window.location.replace(url.toString());
  return true;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info);
    if (isStaleChunkError(error)) recoverFromStaleChunk();
  }

  render() {
    if (this.state.error) {
      const ar = document.documentElement.dir === 'rtl';
      const staleChunk = isStaleChunkError(this.state.error);
      return (
        <div className="min-h-screen flex items-center justify-center bg-ui-page p-4">
          <div className="text-center max-w-md bg-ui-surface rounded-2xl shadow-ui-xl p-8 border border-ui-border">
            <div className="w-16 h-16 rounded-full bg-ui-danger-soft flex items-center justify-center mx-auto mb-4">
              <AlertTriangle className="w-8 h-8 text-ui-danger" />
            </div>
            <h2 className="text-xl font-bold text-ui-text mb-2">{ar ? 'حدث خطأ' : 'Something went wrong'}</h2>
            <p className="text-sm text-ui-muted mb-4">
              {staleChunk
                ? (ar ? 'تم نشر إصدار أحدث من التطبيق. حدّث الصفحة لتحميل الملفات الجديدة.' : 'A newer app version was deployed. Refresh to load the new files.')
                : userFacingErrorMessage(this.state.error, ar ? 'ar' : 'en')}
            </p>
            <button
              onClick={() => {
                if (staleChunk) {
                  window.location.reload();
                  return;
                }
                this.setState({ error: null });
              }}
              className="px-6 py-2.5 bg-ui-primary hover:bg-ui-primary-hover text-ui-primary-fg font-medium rounded-xl transition-colors"
            >
              {staleChunk ? (ar ? 'تحديث التطبيق' : 'Refresh app') : (ar ? 'إعادة المحاولة' : 'Try again')}
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
