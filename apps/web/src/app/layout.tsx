import type { Metadata } from 'next';
import { TopNav } from '@/components/top-nav';
import './globals.css';

export const metadata: Metadata = {
  title: 'HLOVET',
  description: 'HLOVET personal portal, navigation, toolbox, and account workspace',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <TopNav />
        <main className="content-shell">{children}</main>
      </body>
    </html>
  );
}
