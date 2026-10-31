import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { RiderHome } from '@dp/shared';
import { api } from '../../lib/api.ts';
import { pollEvery } from '../../lib/live.ts';

export const riderHomeKey = ['rider', 'home'] as const;

/**
 * Rider state: profile, open offer and active job. Live events refresh it instantly; polling is the
 * fallback (every 4 s while online if the live stream is down, otherwise every 30 s).
 */
export function useRiderHome(enabled = true) {
  return useQuery({
    queryKey: riderHomeKey,
    queryFn: () => api<RiderHome>('/rider/home'),
    enabled,
    refetchInterval: (q) => {
      const d = q.state.data;
      return d && (d.profile?.isOnline || d.job) ? pollEvery(4000, 30_000) : 30_000;
    },
    refetchIntervalInBackground: true,
  });
}

export type GpsState = 'off' | 'waiting' | 'ok' | 'blocked' | 'unsupported';

/** Shares the rider's position while `active`: first fix immediately, then at most every 10 s. */
export function useLocationSharing(active: boolean) {
  const [state, setState] = useState<GpsState>('off');
  const [position, setPosition] = useState<{ lat: number; lng: number } | null>(null);
  const lastSent = useRef(0);

  useEffect(() => {
    if (!active) {
      setState('off');
      return;
    }
    if (!('geolocation' in navigator)) {
      setState('unsupported');
      return;
    }
    setState('waiting');
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setPosition(p);
        setState('ok');
        const now = Date.now();
        if (now - lastSent.current >= 10_000) {
          lastSent.current = now;
          void api('/rider/location', {
            method: 'POST',
            body: { ...p, accuracyM: Math.round(pos.coords.accuracy) },
          }).catch(() => {
            lastSent.current = 0; // retry on the next fix
          });
        }
      },
      (err) => setState(err.code === err.PERMISSION_DENIED ? 'blocked' : 'waiting'),
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20_000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [active]);

  return { state, position };
}

/**
 * Keeps the screen on while online. A browser cannot share GPS reliably with the screen off
 * (plan risk R3); this is the mitigation until a native wrapper exists.
 */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return;
    let lock: WakeLockSentinel | null = null;
    let cancelled = false;
    const acquire = async () => {
      try {
        lock = await navigator.wakeLock.request('screen');
      } catch {
        // denied (battery saver, not visible): nothing else to do
      }
      if (cancelled) void lock?.release();
    };
    void acquire();
    const onVisible = () => document.visibilityState === 'visible' && void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release();
    };
  }, [active]);
}
