import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { Header } from '@/components/header';
import './globals.css';

export const metadata: Metadata = { title: 'Social Handle Agent', description: 'Check social handle availability and plan account registration.' };
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Header />
        <main className="mx-auto max-w-6xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
