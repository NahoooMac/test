import { useRef, useState, useCallback, useEffect, type ReactNode } from 'react';
import { cn } from './cn.ts';
import { Spinner } from './Spinner.tsx';

export interface SwipeSliderProps {
  label: string;
  onConfirm: () => void;
  loading?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
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
  className,
}: SwipeSliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [offset, setOffset] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const dragging = useRef(false);
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
    startX.current = e.clientX;
    maxTravel.current = computeMax();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragging.current) return;
    const dx = e.clientX - startX.current;
    setOffset(Math.max(0, Math.min(dx, maxTravel.current)));
  };

  const onPointerUp = () => {
    if (!dragging.current) return;
    dragging.current = false;
    if (maxTravel.current > 0 && offset / maxTravel.current >= THRESHOLD) {
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
        'bg-accent shadow-[var(--shadow-md)]',
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
        className="pointer-events-none absolute inset-0 flex items-center justify-center text-[15px] font-semibold text-accent-ink transition-opacity duration-200"
        style={{ opacity: 1 - progress * 1.5 }}
      >
        {label}
      </span>

      {/* Filled track */}
      <div
        className="absolute top-1 bottom-1 left-1 rounded-[calc(var(--radius-lg)-2px)] bg-white/15 transition-[width] duration-75"
        style={{ width: offset + THUMB }}
      />

      {/* Thumb */}
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={cn(
          'absolute top-1 left-1 z-10 flex items-center justify-center rounded-[calc(var(--radius-lg)-2px)] bg-white text-accent shadow-[var(--shadow-sm)]',
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
