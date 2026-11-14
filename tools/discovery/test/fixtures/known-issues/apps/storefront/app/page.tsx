// Fixture: one key missing from both dictionaries, one with a placeholder lost in French.
import { useT } from '../lib/i18n';

export default function Home({ name }: { name: string }) {
  const t = useT();
  return (
    <main>
      <h1>{t('الرئيسية')}</h1>
      <p>{t('مرحبًا {name}', { name })}</p>
      <button type="button">{t('أضف إلى السلة')}</button>
    </main>
  );
}
