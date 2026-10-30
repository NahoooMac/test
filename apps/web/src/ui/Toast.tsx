import { createContext, use, useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { cn } from './cn.ts';

type ToastTone = 'info' | 'success' | 'danger';
interface ToastItem {
  id: number;
  tone: ToastTone;
  message: string;
}

const ToastContext = createContext<((message: string, tone?: ToastTone) => void) | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setItems((xs) => xs.filter((x) => x.id !== id)), []);
  const show = useCallback(
    (message: string, tone: ToastTone = 'info') => {
      const id = nextId.current++;
      setItems((xs) => [...xs.slice(-2), { id, tone, message }]);
      setTimeout(() => dismiss(id), tone === 'danger' ? 7000 : 4000);
    },
    [dismiss],
  );
  const value = useMemo(() => show, [show]);

  const icons = { info: Info, success: CheckCircle2, danger: XCircle };

  return (
    <ToastContext value={value}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 top-0 z-50 flex flex-col items-center gap-2 p-4"
      >
        {items.map((t) => {
          const Icon = icons[t.tone];
          return (
            <div
              key={t.id}
              role={t.tone === 'danger' ? 'alert' : 'status'}
              className="pointer-events-auto flex w-full max-w-sm items-start gap-3 rounded-2xl bg-inverse px-4 py-3 text-inverse-ink shadow-lg"
            >
              <Icon
                aria-hidden
                className={cn(
                  'mt-0.5 size-5 shrink-0',
                  t.tone === 'success' && 'text-success',
                  t.tone === 'danger' && 'text-danger',
                )}
              />
              <p className="flex-1 text-sm font-medium">{t.message}</p>
              <button
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
                className="-m-1 p-1 opacity-70 hover:opacity-100"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext>
  );
}

export function useToast() {
  const ctx = use(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}
