import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Patron Admin',
  description: 'Administration dashboard for the Patron platform.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
