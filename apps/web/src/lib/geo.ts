import type { LatLng } from '@dp/shared';

/** Why the browser gave no position. `insecure`: geolocation only works on https or localhost. */
export type GeoProblem = 'insecure' | 'unsupported' | 'denied' | 'unavailable';

export function geoProblemNow(): GeoProblem | null {
  if (!window.isSecureContext) return 'insecure';
  if (!('geolocation' in navigator)) return 'unsupported';
  return null;
}

/** One position fix; the browser shows its "allow location" prompt the first time. */
export function getPosition(): Promise<{ ok: true; point: LatLng } | { ok: false; problem: GeoProblem }> {
  const early = geoProblemNow();
  if (early) return Promise.resolve({ ok: false, problem: early });
  return new Promise((resolve) =>
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        resolve({ ok: true, point: { lat: pos.coords.latitude, lng: pos.coords.longitude } }),
      (err) =>
        resolve({ ok: false, problem: err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable' }),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 30_000 },
    ),
  );
}
