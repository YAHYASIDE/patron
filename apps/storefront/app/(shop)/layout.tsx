import Header from '@/components/Header';
import Footer from '@/components/Footer';
import WakeBanner from '@/components/WakeBanner';
import VerifyBanner from '@/components/VerifyBanner';
import AuthGate from '@/components/AuthGate';
import WhatsAppFab from '@/components/WhatsAppFab';

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <Header />
      <WakeBanner />
      <VerifyBanner />
      <main className="flex-1">
        <AuthGate>{children}</AuthGate>
      </main>
      <Footer />
      <WhatsAppFab />
    </div>
  );
}
