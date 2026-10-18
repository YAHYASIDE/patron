import type { Metadata, Viewport } from 'next';
import { Cairo } from 'next/font/google';
import './globals.css';

const cairo = Cairo({
  subsets: ['arabic', 'latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-cairo',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'باترون — بطاقات وشحن رقمي فوري',
    template: '%s · باترون',
  },
  description:
    'اشترِ شحن الألعاب وبطاقات الهدايا والاشتراكات رقميًّا، وتسلّمها فورًا. أسعار واضحة ودفع آمن.',
};

export const viewport: Viewport = {
  themeColor: '#0d6d64',
  width: 'device-width',
  initialScale: 1,
};

// Set the theme before paint to avoid a flash: honor a saved choice, else the
// system preference. Mirrors the admin so both faces behave the same.
const themeInit = `(function(){try{var t=localStorage.getItem('patron-theme');var d=t?t==='dark':matchMedia('(prefers-color-scheme: dark)').matches;document.documentElement.classList.toggle('dark',d);}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={cairo.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
