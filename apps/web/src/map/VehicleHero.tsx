import { useEffect, useState } from 'react';
import { cn } from '../ui/cn.ts';
import type { VehicleKind } from './vehicle3d.ts';

/** Illustrated vehicles in public/vehicles (trimmed WebP of design-assets/, right-facing). Scooter has none yet, so it falls back to 3D. */
const PHOTOS: Partial<Record<VehicleKind, { rider: string; bare: string }>> = {
  motorcycle: { rider: '/vehicles/motorcycle-rider.webp', bare: '/vehicles/motorcycle.webp' },
  bicycle: { rider: '/vehicles/bicycle-rider.webp', bare: '/vehicles/bicycle.webp' },
};

/** Vehicle picture (optionally with rider). Uses the illustration when there is one, else a 3D render. */
export function VehicleHero({
  kind,
  width = 360,
  height = 260,
  rider = true,
  className,
}: {
  kind: VehicleKind;
  width?: number;
  height?: number;
  rider?: boolean;
  className?: string;
}) {
  const photo = PHOTOS[kind];
  const [rendered, setRendered] = useState<string | null>(null);
  useEffect(() => {
    if (photo) return;
    let live = true;
    void import('./vehicle3d.ts').then((m) => {
      const url = m.renderVehicleHero(kind, width, height, rider);
      if (live) setRendered(url);
    });
    return () => {
      live = false;
    };
  }, [photo, kind, width, height, rider]);

  const src = photo ? (rider ? photo.rider : photo.bare) : rendered;
  return (
    <span
      aria-hidden
      className={cn('block', className)}
      style={{ aspectRatio: `${width} / ${height}` }}
    >
      {src && (
        <img
          src={src}
          alt=""
          decoding="async"
          className="h-full w-full animate-fade-in object-contain drop-shadow-[0_12px_14px_rgba(15,23,42,0.22)]"
        />
      )}
    </span>
  );
}
