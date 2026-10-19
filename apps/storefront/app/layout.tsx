import type { Metadata, Viewport } from 'next';
import { Cairo } from 'next/font/google';
import { dirOf, translate } from '@/lib/i18n/core';
import { serverLang } from '@/lib/i18n/server';
import { LangProvider } from '@/lib/i18n';
import './globals.css';

const cairo = Cairo({
  subsets: ['arabic', 'latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-cairo',
  display: 'swap',
});

export async function generateMetadata(): Promise<Metadata> {
  const lang = await serverLang();
  return {
    title: {
      default: translate(lang, 'باترون — بطاقات وشحن رقمي فوري'),
      template: `%s · ${translate(lang, 'باترون')}`,
    },
    description: translate(
      lang,
      'اشترِ شحن الألعاب وبطاقات الهدايا والاشتراكات رقميًّا، وتسلّمها فورًا. أسعار واضحة ودفع آمن.',
    ),
  };
}

export const viewport: Viewport = {
  themeColor: '#0d6d64',
  width: 'device-width',
  initialScale: 1,
};

// Set the theme before paint to avoid a flash: honor a saved choice, else the
// system preference. Mirrors the admin so both faces behave the same.
const themeInit = `(function(){try{var t=localStorage.getItem('patron-theme');var d=t?t==='dark':matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const lang = await serverLang();
  return (
    <html lang={lang} dir={dirOf(lang)} className={cairo.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="font-sans antialiased">
        <LangProvider lang={lang}>{children}</LangProvider>
      </body>
    </html>
  );
}
