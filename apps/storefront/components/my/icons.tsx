/** Account-area icons, drawn like components/icons.tsx (24 grid, 1.8 stroke). */

type P = { className?: string; size?: number };

const base = (size = 20) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
});

export const BagIcon = ({ className, size }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M5 8h14l-1 12H6L5 8z" />
    <path d="M9 8V6a3 3 0 0 1 6 0v2" />
  </svg>
);

export const KeyIcon = ({ className, size }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="8" cy="15" r="4" />
    <path d="m11 12 9-9M17 6l2 2M15 8l2 2" />
  </svg>
);

export const HeartIcon = ({ className, size }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z" />
  </svg>
);

export const WalletIcon = ({ className, size }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 7a2 2 0 0 1 2-2h11v4" />
    <rect x="4" y="7" width="16" height="12" rx="2" />
    <path d="M16 13h2" />
  </svg>
);

export const BellIcon = ({ className, size }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16z" />
    <path d="M10 20a2 2 0 0 0 4 0" />
  </svg>
);

export const ChatIcon = ({ className, size }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 5h16v11H9l-5 4V5z" />
    <path d="M8 10h8M8 13h5" />
  </svg>
);
