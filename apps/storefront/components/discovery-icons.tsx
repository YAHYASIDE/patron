/** Icons for the discovery features, drawn like components/icons.tsx (24 grid, 1.8 stroke). */

type P = { className?: string; size?: number };

function base(size = 20) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    'aria-hidden': true,
  };
}

const HEART = 'M12 20.3s-7.6-4.5-9.3-9.4C1.6 7.6 3.7 4.3 7 4.3c2 0 3.4 1.1 5 3 1.6-1.9 3-3 5-3 3.3 0 5.4 3.3 4.3 6.6-1.7 4.9-9.3 9.4-9.3 9.4Z';

export const HeartIcon = ({ className, size, filled }: P & { filled?: boolean }) => (
  <svg {...base(size)} className={className} fill={filled ? 'currentColor' : 'none'}>
    <path d={HEART} />
  </svg>
);

export const BellIcon = ({ className, size }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M6 9.5a6 6 0 0 1 12 0c0 4.6 1.8 6.4 2.3 6.9a.4.4 0 0 1-.3.6H4a.4.4 0 0 1-.3-.6c.5-.5 2.3-2.3 2.3-6.9Z" />
    <path d="M10 20a2.2 2.2 0 0 0 4 0" />
  </svg>
);

export const ShareIcon = ({ className, size }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="18" cy="5.5" r="2.5" />
    <circle cx="6" cy="12" r="2.5" />
    <circle cx="18" cy="18.5" r="2.5" />
    <path d="m8.2 10.8 7.6-4.1M8.2 13.2l7.6 4.1" />
  </svg>
);

/** Safari's share glyph, for the "add to home screen" how-to. */
export const IosShareIcon = ({ className, size }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 3v12M8 7l4-4 4 4" />
    <path d="M8 10H6.5A1.5 1.5 0 0 0 5 11.5v8A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5v-8a1.5 1.5 0 0 0-1.5-1.5H16" />
  </svg>
);

export const StarIcon = ({ className, size, filled = true }: P & { filled?: boolean }) => (
  <svg {...base(size)} className={className} fill={filled ? 'currentColor' : 'none'} strokeWidth={1.5}>
    <path d="m12 3.2 2.7 5.5 6 .9-4.4 4.3 1 6-5.3-2.9-5.4 2.9 1-6-4.3-4.3 6-.9L12 3.2Z" />
  </svg>
);

export const ClockIcon = ({ className, size }: P) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </svg>
);

export const CopyIcon = ({ className, size }: P) => (
  <svg {...base(size)} className={className}>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
    <path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
  </svg>
);

export const DownloadIcon = ({ className, size }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14" />
  </svg>
);

export const TagIcon = ({ className, size }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M3.5 12.2V4.8a1.3 1.3 0 0 1 1.3-1.3h7.4l8.3 8.3a1.3 1.3 0 0 1 0 1.8l-7.4 7.4a1.3 1.3 0 0 1-1.8 0l-7.8-7.8Z" />
    <circle cx="8" cy="8" r="1.4" />
  </svg>
);

export const TrendIcon = ({ className, size }: P) => (
  <svg {...base(size)} className={className}>
    <path d="m3.5 16.5 5.5-5.5 4 4 7.5-7.5M15 7.5h5.5V13" />
  </svg>
);

export const HistoryIcon = ({ className, size }: P) => (
  <svg {...base(size)} className={className}>
    <path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.6" />
    <path d="M4 4v4.6h4.6M12 8v4.3l2.8 1.7" />
  </svg>
);
