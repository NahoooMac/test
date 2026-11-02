import { cn } from './cn.ts';

/**
 * Addis Ababa skyline (public/skyline.webp, cropped from Mirrored_City_Skyline_Silhouette.png):
 * Meskel Square obelisk, Lion of Judah, Menelik II statue, churches. A soft backdrop; decorative only.
 */
export function CitySkyline({ className }: { className?: string }) {
  return (
    <img
      src="/skyline.webp"
      alt=""
      aria-hidden
      decoding="async"
      className={cn('pointer-events-none object-contain object-bottom opacity-[0.13] select-none', className)}
    />
  );
}

export function EthiopiaFlag({ className = 'h-3.5 w-5' }: { className?: string }) {
  return (
    <svg viewBox="0 0 30 18" className={className} aria-hidden>
      <rect width="30" height="6" fill="#078930" />
      <rect y="6" width="30" height="6" fill="#fcdd09" />
      <rect y="12" width="30" height="6" fill="#da121a" />
      <circle cx="15" cy="9" r="4.4" fill="#0f47af" />
      <path
        d="M15 5.9l.8 2.3h2.4l-1.9 1.4.7 2.3-2-1.4-2 1.4.7-2.3-1.9-1.4h2.4z"
        fill="#fcdd09"
      />
    </svg>
  );
}

/** Brand mark: a location pin holding a parcel. */
export function BrandPin({ className = 'size-14' }: { className?: string }) {
  return (
    <svg viewBox="0 0 56 64" className={className} aria-hidden>
      <defs>
        <linearGradient id="brandpin" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="var(--c-accent-2)" />
          <stop offset="100%" stopColor="var(--c-accent)" />
        </linearGradient>
      </defs>
      <path
        d="M28 2C14.2 2 3 12.9 3 26.4 3 44.5 28 62 28 62s25-17.5 25-35.6C53 12.9 41.8 2 28 2z"
        fill="url(#brandpin)"
      />
      <path d="M28 14l11 5.5v12L28 37l-11-5.5v-12z" fill="#fff" />
      <path d="M28 25l11-5.5M28 25v12M28 25l-11-5.5" stroke="var(--c-accent)" strokeWidth="1.6" />
    </svg>
  );
}
