/** Cardboard parcel illustration (public/parcel.svg; source art in design-assets/). */
export function ParcelIcon3D({ className = 'size-12' }: { className?: string }) {
  return (
    <img
      src="/parcel.svg"
      alt=""
      aria-hidden
      decoding="async"
      className={className}
    />
  );
}
