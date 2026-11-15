'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/lib/i18n';
import { SunIcon, MoonIcon } from './icons';

export default function ThemeToggle() {
  const t = useT();
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains('dark'));
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('patron-theme', next ? 'dark' : 'light');
    } catch {
      /* ignore */
    }
  }

  return (
    <button
      onClick={toggle}
      aria-label={t('تبديل السمة')}
      title={t('تبديل الوضع الليلي/النهاري')}
      className="grid h-10 w-10 place-items-center rounded-xl text-muted transition hover:bg-[rgb(var(--surface-2))] hover:text-[rgb(var(--text))]"
    >
      {dark ? <MoonIcon size={18} /> : <SunIcon size={18} />}
    </button>
  );
}
