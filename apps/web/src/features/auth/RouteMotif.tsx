/** Simple pickup → drop-off route line used as the sign-in visual. Decorative only. */
export function RouteMotif({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 320 120" fill="none" aria-hidden className={className}>
      <path
        d="M28 92 C 90 92, 96 34, 160 40 S 236 86, 288 30"
        stroke="var(--c-line-strong)"
        strokeWidth="10"
        strokeLinecap="round"
      />
      <path
        d="M28 92 C 90 92, 96 34, 160 40 S 236 86, 288 30"
        stroke="var(--c-accent)"
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray="2 10"
      />
      <circle
        cx="28"
        cy="92"
        r="11"
        fill="var(--c-surface)"
        stroke="var(--c-ink)"
        strokeWidth="4"
      />
      <path
        d="M288 6c-10 0-18 8-18 18 0 13 18 30 18 30s18-17 18-30c0-10-8-18-18-18z"
        fill="var(--c-ink)"
      />
      <circle cx="288" cy="24" r="6" fill="var(--c-accent)" />
    </svg>
  );
}
