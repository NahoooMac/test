import { useRef, useState, useCallback, useEffect, type ReactNode } from 'react';
import { cn } from './cn.ts';
import { Spinner } from './Spinner.tsx';

export interface SwipeSliderProps {
  label: string;
  onConfirm: () => void;
  loading?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
  /** accent: blue track (go online, confirm); quiet: light track (go offline). */
  tone?: 'accent' | 'quiet';
  className?: string;
}

const THUMB = 56;
const THRESHOLD = 0.85;

export function SwipeSlider({
  label,
  onConfirm,
  loading,
  disabled,
  icon,
  tone = 'accent',
  className,
}: SwipeSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const dragging = useRef(false);
  // The latest drag distance, readable at release even if React hasn't re-rendered yet (fast flicks).
  const offsetRef = useRef(0);
  const startX = useRef(0);
  const maxTravel = useRef(0);

  const reset = useCallback(() => {
    setOffset(0);
    dragging.current = false;
  }, []);

  useEffect(() => {
    if (!loading && confirmed) {
      setConfirmed(false);
      reset();
    }
  }, [loading, confirmed, reset]);

  const computeMax = () => {
    if (!trackRef.current) return 0;
    return trackRef.current.offsetWidth - THUMB - 8;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled || loading || confirmed) return;
    dragging.current = true;
    offsetRef.current = 0;
    startX.current = e.clientX;
    maxTravel.current = computeMax();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - startX.current;
    offsetRef.current = Math.max(0, Math.min(dx, maxTravel.current));
    setOffset(offsetRef.current);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    dragging.current = false;
    // Count the release position too: a quick flick may have no move event at its end.
    const travel = Math.max(offsetRef.current, Math.min(e.clientX - startX.current, maxTravel.current));
    offsetRef.current = 0;
    if (maxTravel.current > 0 && travel / maxTravel.current >= THRESHOLD) {
      setConfirmed(true);
      setOffset(maxTravel.current);
      onConfirm();
    } else {
      setOffset(0);
    }
  };

  const progress = maxTravel.current > 0 ? offset / maxTravel.current : 0;

  return (
    <div
      ref={trackRef}
      className={cn(
        'relative flex h-16 select-none items-center overflow-hidden rounded-[var(--radius-lg)]',
        tone === 'accent' ? 'bg-accent shadow-[var(--shadow-md)]' : 'bg-surface-2 ring-1 ring-line',
        disabled && 'opacity-50',
        className,
      )}
    >
      {/* Shimmer hint */}
      {!confirmed && !loading && (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.12) 40%, rgba(255,255,255,0.2) 50%, rgba(255,255,255,0.12) 60%, transparent 100%)',
            backgroundSize: '200% 100%',
            animation: 'swipe-shimmer 2.5s ease-in-out infinite',
          }}
        />
      )}

      {/* Label */}
      <span
        className={cn(
          'pointer-events-none absolute inset-0 flex items-center justify-center pl-12 text-[15px] font-semibold transition-opacity duration-200',
          tone === 'accent' ? 'text-accent-ink' : 'text-ink',
        )}
        style={{ opacity: 1 - progress * 1.5 }}
      >
        {label}
      </span>

      {/* Filled track */}
      <div
        className={cn(
          'absolute top-1 bottom-1 left-1 rounded-[calc(var(--radius-lg)-2px)] transition-[width] duration-75',
          tone === 'accent' ? 'bg-white/15' : 'bg-danger/15',
        )}
        style={{ width: offset + THUMB }}
      />

      {/* Thumb */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={cn(
          'absolute top-1 left-1 z-10 flex items-center justify-center rounded-[calc(var(--radius-lg)-2px)] shadow-[var(--shadow-sm)]',
          tone === 'accent' ? 'bg-white text-accent' : 'bg-navy text-white',
          'touch-none cursor-grab active:cursor-grabbing',
          !dragging.current && !confirmed && 'transition-transform duration-300 ease-[var(--ease-out)]',
        )}
        style={{
          width: THUMB,
          height: THUMB,
          transform: `translateX(${offset}px)`,
        }}
      >
        {loading ? (
          <Spinner className="size-5 text-accent" />
        ) : icon ? (
          icon
        ) : (
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden>
            <path
              d="M7.5 4L13.5 10L7.5 16"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>
    </div>
  );
}
