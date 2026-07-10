import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: '灵犀门户',
  description: '个人门户、导航、工具箱和服务器入口',
};

const navigationItems = [
  { href: '/', label: '总览', caption: '门户首页' },
  { href: '/dashboard', label: '工作台', caption: '身份与权限' },
  { href: '/nav', label: '导航', caption: '公开入口' },
  { href: '/tools', label: '工具箱', caption: '常用工具' },
  { href: '/admin', label: '管理', caption: '用户后台' },
];

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>
        <div className="app-shell">
          <aside className="sidebar" aria-label="站点导航">
            <Link className="brand" href="/">
              <span className="brand-mark">灵</span>
              <span className="brand-copy">
                <strong>灵犀门户</strong>
                <span>Lingxi Portal</span>
              </span>
            </Link>
            <nav className="side-nav" aria-label="主导航">
              {navigationItems.map((item) => (
                <Link className="side-link" href={item.href} key={item.href}>
                  <span>{item.label}</span>
                  <small>{item.caption}</small>
                </Link>
              ))}
            </nav>
            <div className="sidebar-note">
              <span>当前体系</span>
              <strong>练气起步 · 权限成长</strong>
            </div>
            <Link className="login-link" href="/login">
              登录账号
            </Link>
          </aside>
          <main className="content-shell">{children}</main>
        </div>
      </body>
    </html>
  );
}
