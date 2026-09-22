import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Won Deals & Billing Plan — Kleecks',
  description:
    'Won and closing deals with licence period, billing plan, cash flow forecast and linked Billing subscriptions and invoices.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-GB">
      <body className="min-h-screen bg-ink font-sans antialiased">{children}</body>
    </html>
  );
}
