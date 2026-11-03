// Records the route actually travelled during a job. Fixes are queued in localStorage (so a lost
// connection or a reload loses nothing) and uploaded in batches; the server de-duplicates by
// timestamp, so re-sending a batch after a failed response is harmless. Only real GPS fixes are
// recorded: nothing is interpolated here or on the server.
import { ROUTE_BATCH_MAX } from '@dp/shared';
import { api, ApiRequestError } from '../../lib/api.ts';

const KEY = 'rider.routeQueue.v1';
/** A fix at most every 5 s and only after moving ~8 m, to keep the route light. */
const MIN_INTERVAL_MS = 5000;
const MIN_MOVE_M = 8;
const FLUSH_EVERY_MS = 30_000;
/** Never keep more than this many unsent fixes (≈ 4 h at one per 5 s). */
const QUEUE_CAP = 3000;

interface QueuedFix {
  jobId: string;
  lat: number;
  lng: number;
  recordedAt: string;
  accuracyM: number;
}

function load(): QueuedFix[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as QueuedFix[]) : [];
  } catch {
    return [];
  }
}
function save(q: QueuedFix[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(q.slice(-QUEUE_CAP)));
  } catch {
    // storage full or blocked: the fixes stay in memory until the next flush
  }
}

let queue: QueuedFix[] = load();
let last: { lat: number; lng: number; t: number } | null = null;
let flushing = false;
let timer: ReturnType<typeof setInterval> | null = null;

const metres = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const r = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(h));
};

export function recordFix(jobId: string, p: { lat: number; lng: number }, accuracy: number, timestamp: number) {
  if (last && (timestamp - last.t < MIN_INTERVAL_MS || metres(last, p) < MIN_MOVE_M)) return;
  last = { ...p, t: timestamp };
  queue.push({
    jobId,
    lat: p.lat,
    lng: p.lng,
    recordedAt: new Date(timestamp).toISOString(),
    accuracyM: Math.round(accuracy),
  });
  save(queue);
  timer ??= setInterval(() => void flushRoute(), FLUSH_EVERY_MS);
}

/** Uploads queued fixes, one job and batch at a time. Safe to call often. */
export async function flushRoute() {
  if (flushing || !queue.length || !navigator.onLine) return;
  flushing = true;
  try {
    while (queue.length) {
      const jobId = queue[0]!.jobId;
      const batch = queue.filter((f) => f.jobId === jobId).slice(0, ROUTE_BATCH_MAX);
      try {
        await api(`/rider/jobs/${jobId}/route`, {
          method: 'POST',
          body: { points: batch.map(({ lat, lng, recordedAt, accuracyM }) => ({ lat, lng, recordedAt, accuracyM })) },
        });
      } catch (err) {
        // A job that is not ours (or gone) will never accept these: drop them. Otherwise retry later.
        if (!(err instanceof ApiRequestError && (err.status === 404 || err.status === 400))) return;
      }
      const sent = new Set(batch);
      queue = queue.filter((f) => !sent.has(f));
      save(queue);
    }
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  } finally {
    flushing = false;
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void flushRoute());
  if (queue.length) timer = setInterval(() => void flushRoute(), FLUSH_EVERY_MS);
}
