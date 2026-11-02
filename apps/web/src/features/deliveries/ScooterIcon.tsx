export function ScooterIcon({ className = 'size-5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="6" cy="17" r="2.5" />
      <circle cx="18" cy="17" r="2.5" />
      <path d="M8.5 17H14l2-5H9l-1.5 5" />
      <path d="M16 12l2 5" />
      <path d="M7 9h4l1 3" />
      <path d="M14 7h2" />
    </svg>
  );
}
