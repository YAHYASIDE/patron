import type { Metadata } from 'next';
import { Cairo } from 'next/font/google';
import './globals.css';

const cairo = Cairo({
  subsets: ['arabic', 'latin'],
  weight: ['400', '500', '600', '700', '800'],
  variable: '--font-cairo',
  display: 'swap',
});

/** Set only by render.staging.yaml: a test copy of the dashboard, never the real one. */
const STAGING = process.env.NEXT_PUBLIC_STAGING === 'true';

export const metadata: Metadata = {
  title: STAGING ? 'نسخة تجريبية — لوحة تحكم patron' : 'لوحة تحكم patron',
  description: 'لوحة إدارة منصة patron للمنتجات الرقمية.',
};

// Apply the stored or system theme before paint to avoid a flash.
const themeInit = `(function(){try{var t=localStorage.getItem('patron-theme');var d=t?t==='dark':matchMedia('(prefers-color-scheme: dark)').matches;if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ar" dir="rtl" className={cairo.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body className="font-sans antialiased">
        {STAGING && (
          <div role="status" className="sticky top-0 z-50 bg-amber-400 px-4 py-1.5 text-center text-sm font-bold text-black">
            نسخة تجريبية: بياناتها منفصلة عن المتجر الحقيقي، وأرقام الاستلام فيها أرقام اختبار.
          </div>
        )}
        {children}
      </body>
    </html>
  );
}
