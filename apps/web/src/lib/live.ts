import { useEffect, useSyncExternalStore } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import type { Delivery } from '@dp/shared';

// Live updates arrive as Server-Sent Events. Each event is a signal to refetch (or, for rider
// positions, a small patch). While the stream is connected, polling slows right down; if it drops,
// polling takes over again until the browser reconnects.

let connected = false;
const listeners = new Set<() => void>();
const setConnected = (v: boolean) => {
  if (connected === v) return;
  connected = v;
  for (const l of listeners) l();
};

export const isLive = () => connected;

export function useLiveConnected(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => connected,
  );
}

/** Poll faster when live updates are down, slower (as a safety net) when they are up. */
export const pollEvery = (offlineMs: number, liveMs = 60_000) => (isLive() ? liveMs : offlineMs);

type LocationEvent = { deliveryId: string; riderId: string; lat: number; lng: number; at: string };

function handle(queryClient: QueryClient, type: string, data: Record<string, unknown>) {
  switch (type) {
    case 'delivery': {
      const id = data.id as string;
      void queryClient.invalidateQueries({ queryKey: ['delivery', id] });
      void queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      void queryClient.invalidateQueries({ queryKey: ['rider'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'ops'] });
      void queryClient.invalidateQueries({ queryKey: ['admin', 'notifications'] });
      void queryClient.invalidateQueries({ queryKey: ['track'] });
      break;
    }
    case 'location': {
      const e = data as unknown as LocationEvent;
      const point = { lat: e.lat, lng: e.lng, at: e.at };
      queryClient.setQueryData<Delivery>(['delivery', e.deliveryId], (old) =>
        old ? { ...old, riderLocation: point } : old,
      );
      queryClient.setQueryData<OpsSnapshot>(['admin', 'ops'], (old) =>
        old
          ? {
              ...old,
              riders: old.riders.map((r) =>
                r.id === e.riderId ? { ...r, lat: e.lat, lng: e.lng, locationUpdatedAt: e.at } : r,
              ),
            }
          : old,
      );
      break;
    }
    case 'offer':
    case 'rider':
      void queryClient.invalidateQueries({ queryKey: ['rider'] });
      break;
    case 'notice':
      // A message for this user (e.g. the final price to pay): shown by <PaymentNotice />.
      window.dispatchEvent(new CustomEvent('dp:notice', { detail: data }));
      break;
    case 'ops':
      if (!data.hello) {
        void queryClient.invalidateQueries({ queryKey: ['admin', 'ops'] });
        // Rider submissions and decisions: keep the verification queue current.
        void queryClient.invalidateQueries({ queryKey: ['admin', 'kyc'] });
        void queryClient.invalidateQueries({ queryKey: ['admin', 'notifications'] });
      }
      break;
  }
}

/** Opens the signed-in event stream while `enabled`. Mount once per app. */
export function useLiveEvents(enabled: boolean) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!enabled || typeof EventSource === 'undefined') return;
    const source = new EventSource('/api/events');
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false); // the browser retries on its own
    const types = ['delivery', 'location', 'offer', 'rider', 'ops', 'notice'];
    const onEvent = (ev: MessageEvent<string>) => {
      try {
        handle(queryClient, ev.type, JSON.parse(ev.data) as Record<string, unknown>);
      } catch {
        // malformed event: ignore, polling covers it
      }
    };
    for (const type of types) source.addEventListener(type, onEvent as EventListener);
    return () => {
      source.close();
      setConnected(false);
    };
  }, [enabled, queryClient]);
}

/** Shape of GET /admin/ops (kept here so the live patcher and the page agree). */
export interface OpsSnapshot {
  generatedAt: string;
  riders: Array<{
    id: string;
    name: string | null;
    phone: string;
    vehicleType: 'motorcycle' | 'bicycle';
    plate: string | null;
    isOnline: boolean;
    lat: number | null;
    lng: number | null;
    locationUpdatedAt: string | null;
    state: 'idle' | 'offered' | 'on_job';
  }>;
  deliveries: Array<{
    id: string;
    code: string;
    status: Delivery['status'];
    vehicleType: 'motorcycle' | 'bicycle';
    pickup: { address: string; lat: number; lng: number };
    dropoff: { address: string; lat: number; lng: number };
    fare: string;
    riderName: string | null;
    createdAt: string;
    waitingSec: number;
    needsAttention: boolean;
  }>;
}
