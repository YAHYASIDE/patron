/**
 * The Patron mark: a bold P on a teal tile with the gold dot of "patron.".
 * Vector, so it is sharp from the header to a 4K splash. The same drawing is
 * the app icon (public/icons/icon.svg).
 */
export default function BrandMark({ size, className, id = 'pm' }: { size?: number; className?: string; id?: string }) {
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-hidden>
      <defs>
        <linearGradient id={`${id}-bg`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2dd4bf" />
          <stop offset="0.55" stopColor="#0d6d64" />
          <stop offset="1" stopColor="#07423c" />
        </linearGradient>
        <linearGradient id={`${id}-shine`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#fff" stopOpacity="0.28" />
          <stop offset="0.5" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}-gold`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#f3d77e" />
          <stop offset="1" stopColor="#c79a3a" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="17" fill={`url(#${id}-bg)`} />
      <rect width="64" height="64" rx="17" fill={`url(#${id}-shine)`} />
      <path
        d="M23 47V17h10.5a10 10 0 0 1 0 20H23"
        fill="none"
        stroke="#fff"
        strokeWidth="7.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="43.5" cy="46" r="5" fill={`url(#${id}-gold)`} />
    </svg>
  );
}
