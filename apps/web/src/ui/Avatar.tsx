import { useState } from 'react';
import { cn } from './cn.ts';

const initialsOf = (name: string | null | undefined) =>
  (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('') || '•';

/** Round profile picture; shows initials when there is no photo (or it fails to load). */
export function Avatar({
  name,
  src,
  className,
  fallbackClassName = 'bg-accent-soft text-accent-soft-ink',
}: {
  name: string | null | undefined;
  src?: string | null;
  className?: string;
  fallbackClassName?: string;
}) {
  const [broken, setBroken] = useState(false);
  const showPhoto = !!src && !broken;
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center overflow-hidden rounded-full font-bold',
        !showPhoto && fallbackClassName,
        className,
      )}
    >
      {showPhoto ? (
        <img
          src={src}
          alt={name ? `${name}` : ''}
          className="size-full object-cover"
          loading="lazy"
          onError={() => setBroken(true)}
        />
      ) : (
        initialsOf(name)
      )}
    </span>
  );
}
