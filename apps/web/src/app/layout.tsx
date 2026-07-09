import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: '灵犀门户',
  description: '个人门户、导航、工具箱和服务器入口',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <header>
          <nav aria-label="主导航">
            <Link href="/">灵犀门户</Link>
            <Link href="/nav">导航</Link>
            <Link href="/tools">工具</Link>
            <Link href="/login">登录</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
