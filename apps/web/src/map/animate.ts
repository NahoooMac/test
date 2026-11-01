import type { YCoords, YGeoObject } from './yandex.ts';

interface Animation {
  from: YCoords;
  to: YCoords;
  start: number;
  duration: number;
  placemark: YGeoObject;
}

const active = new Map<string, Animation>();
let frameId = 0;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

function tick() {
  const now = performance.now();
  let anyActive = false;

  for (const [id, anim] of active) {
    const elapsed = now - anim.start;
    const t = Math.min(elapsed / anim.duration, 1);
    const e = easeInOut(t);

    const lat = lerp(anim.from[0], anim.to[0], e);
    const lng = lerp(anim.from[1], anim.to[1], e);
    anim.placemark.geometry?.setCoordinates([lat, lng]);

    if (t >= 1) {
      active.delete(id);
    } else {
      anyActive = true;
    }
  }

  if (anyActive) {
    frameId = requestAnimationFrame(tick);
  } else {
    frameId = 0;
  }
}

export function animateMarker(
  id: string,
  placemark: YGeoObject,
  from: YCoords,
  to: YCoords,
  duration = 1000,
) {
  active.set(id, { from, to, start: performance.now(), duration, placemark });
  if (!frameId) {
    frameId = requestAnimationFrame(tick);
  }
}

export function stopAnimation(id: string) {
  active.delete(id);
}

export function headingBetween(from: YCoords, to: YCoords): number {
  const dLat = to[0] - from[0];
  const dLng = to[1] - from[1];
  return Math.atan2(dLng, dLat);
}
