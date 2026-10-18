import Header from '@/components/Header';
import Footer from '@/components/Footer';
import WakeBanner from '@/components/WakeBanner';

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[100dvh] flex-col">
      <Header />
      <WakeBanner />
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  );
}
