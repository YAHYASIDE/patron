import Header from '@/components/Header';
import Footer from '@/components/Footer';
import WakeBanner from '@/components/WakeBanner';
import VerifyBanner from '@/components/VerifyBanner';
import AuthGate from '@/components/AuthGate';
import WhatsAppFab from '@/components/WhatsAppFab';
import InstallPrompt from '@/components/InstallPrompt';
import ErrorReporter from '@/components/ErrorReporter';

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <Header />
      <WakeBanner />
      <VerifyBanner />
      {/* at least a screen tall: the footer starts below the fold, so content
          arriving after the catalogue loads never pushes a visible footer down */}
      {/* and room at the bottom on phones, so the WhatsApp button never sits on the last line */}
      <main className="min-h-[100svh] flex-1 pb-20 lg:pb-0">
        <AuthGate>{children}</AuthGate>
      </main>
      <Footer />
      <WhatsAppFab />
      <InstallPrompt />
      <ErrorReporter />
    </div>
  );
}
