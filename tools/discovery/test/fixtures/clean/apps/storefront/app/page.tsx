import { useT } from '../lib/i18n';

export default function Home({ name }: { name: string }) {
  const t = useT();
  return (
    <main>
      <p>{t('مرحبًا {name}', { name })}</p>
      <button type="button">{t('حذف')}</button>
      <span>{t('Latin text is not a dictionary key')}</span>
    </main>
  );
}
