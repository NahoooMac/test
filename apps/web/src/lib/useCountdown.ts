import { useEffect, useState } from 'react';

/** Seconds remaining until `deadline` (ms timestamp); ticks once a second, stops at 0. */
export function useCountdown(deadline: number): number {
  const remaining = () => Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
  const [left, setLeft] = useState(remaining);

  useEffect(() => {
    setLeft(remaining());
    const id = setInterval(() => {
      const r = remaining();
      setLeft(r);
      if (r === 0) clearInterval(id);
    }, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `remaining` only depends on deadline
  }, [deadline]);

  return left;
}

export function formatClock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
