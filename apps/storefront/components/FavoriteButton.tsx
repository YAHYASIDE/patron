'use client';

import { useState } from 'react';
import { toggleFavorite, useFavorites } from '@/lib/favorites';
import { useT } from '@/lib/i18n';
import { HeartIcon } from './discovery-icons';

/**
 * The heart on a brand. On a tile it sits over the card art (a dark glass
 * disc, so it reads on any art); on the brand page it is a plain button.
 */
export default function FavoriteButton({ brandKey, variant = 'tile' }: { brandKey: string; variant?: 'tile' | 'page' }) {
  const t = useT();
  const on = useFavorites().includes(brandKey);
  const [pop, setPop] = useState(false);

  function onClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!on) {
      setPop(true);
      setTimeout(() => setPop(false), 320);
    }
    toggleFavorite(brandKey).catch(() => undefined);
  }

  const label = on ? t('أزل من المفضّلة') : t('أضف إلى المفضّلة');
  if (variant === 'page') {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={on}
        aria-label={label}
        title={label}
        className={`grid h-10 w-10 flex-none place-items-center rounded-xl border transition ${
          on
            ? 'border-[#e5486b]/40 bg-[#e5486b]/10 text-[#e5486b]'
            : 'border-[rgb(var(--line))] text-muted hover:border-[#e5486b]/50 hover:text-[#e5486b]'
        }`}
      >
        <HeartIcon size={19} filled={on} className={pop ? 'animate-[heartpop_.32s_ease-out]' : undefined} />
      </button>
    );
  }
  return (
    // a 32px target around a 26px disc, tucked into the card's corner
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      aria-label={label}
      title={label}
      className="absolute end-0 top-0 z-10 grid h-10 w-10 place-items-center rounded-full"
    >
      <span
        className={`grid h-[26px] w-[26px] place-items-center rounded-full backdrop-blur-sm transition ${
          on ? 'bg-white text-[#e5486b] shadow-card' : 'bg-black/35 text-white hover:bg-black/50'
        }`}
      >
        <HeartIcon size={14} filled={on} className={pop ? 'animate-[heartpop_.32s_ease-out]' : undefined} />
      </span>
    </button>
  );
}
