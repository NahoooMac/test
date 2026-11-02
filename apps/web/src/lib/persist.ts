// Keeps the signed-in user and their recent data in this browser (localStorage), so reopening the
// app shows it instantly and it still works on a weak connection. The server stays the authority:
// everything is refreshed in the background, a 401 signs out, and sign-out wipes the copy.
import { dehydrate, hydrate, type QueryClient } from '@tanstack/react-query';

const KEY = 'dp-cache-v1';
const MAX_AGE_MS = 7 * 24 * 3600_000;
// Staff data is never written to the device; neither are throwaway lookups.
const SKIP = new Set(['admin', 'geo', 'quote']);

interface Saved {
  at: number;
  state: ReturnType<typeof dehydrate>;
}

function read(): Saved | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as Saved) : null;
  } catch {
    return null;
  }
}

/** Restores the saved copy (if fresh), then saves changes, at most once a second. */
export function persistQueries(client: QueryClient): void {
  const saved = read();
  if (saved && Date.now() - saved.at < MAX_AGE_MS) {
    try {
      hydrate(client, saved.state);
      // Show the saved copy at once, but treat it as stale so each screen refreshes it.
      void client.invalidateQueries({ refetchType: 'none' });
    } catch {
      clearPersisted();
    }
  }

  let timer: ReturnType<typeof setTimeout> | null = null;
  const save = () => {
    timer = null;
    const state = dehydrate(client, {
      shouldDehydrateQuery: (q) =>
        q.state.status === 'success' && !SKIP.has(String(q.queryKey[0])),
    });
    try {
      localStorage.setItem(KEY, JSON.stringify({ at: Date.now(), state } satisfies Saved));
    } catch {
      // Storage full or blocked (private mode): the app works without the copy.
    }
  };
  client.getQueryCache().subscribe((event) => {
    if (event.type !== 'updated' && event.type !== 'removed') return;
    if (!timer) timer = setTimeout(save, 1000);
  });
}

export function clearPersisted(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

const PHONE_KEY = 'dp-last-phone';

/** The last phone number used to sign in on this device, so signing in again is one tap. */
export const lastPhone = {
  get: (): string => {
    try {
      return localStorage.getItem(PHONE_KEY) ?? '';
    } catch {
      return '';
    }
  },
  set: (v: string) => {
    try {
      localStorage.setItem(PHONE_KEY, v);
    } catch {
      // ignore
    }
  },
};
