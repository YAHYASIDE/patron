import type { Metadata, Viewport } from 'next';
import { Cairo } from 'next/font/google';
import { dirOf, translate } from '@/lib/i18n/core';
import { serverLang } from '@/lib/i18n/server';
import { LangProvider } from '@/lib/i18n';
import { INSTALL_INIT, SPLASH_INIT } from '@/lib/boot-scripts';
import Splash from '@/components/Splash';
import ServiceWorker from '@/components/ServiceWorker';
import './globals.css';
import '@/components/discovery.css';

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
    applicationName: translate(lang, 'باترون'),
    // installable app (public/manifest.webmanifest, icons from public/icons/*.svg)
    manifest: '/manifest.webmanifest',
    icons: {
      icon: [
        { url: '/icons/icon.svg', type: 'image/svg+xml' },
        { url: '/icons/favicon-32.png', sizes: '32x32', type: 'image/png' },
        { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      ],
      apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
    },
    appleWebApp: { capable: true, title: translate(lang, 'باترون'), statusBarStyle: 'default' },
    formatDetection: { telephone: false },
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
        <script dangerouslySetInnerHTML={{ __html: themeInit + SPLASH_INIT + INSTALL_INIT }} />
        {/* without JavaScript the opening would replay on every page */}
        <noscript>
          <style>{'.splash{display:none}'}</style>
        </noscript>
      </head>
      <body className="font-sans antialiased">
        <LangProvider lang={lang}>
          {children}
          <Splash />
          <ServiceWorker />
        </LangProvider>
      </body>
    </html>
  );
}
