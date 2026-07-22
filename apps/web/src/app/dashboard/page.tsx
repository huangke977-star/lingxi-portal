'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AppToast } from '@/components/app-toast';
import { AuthUser, getMe, isAuthExpiredError } from '@/lib/auth-api';
import { clearAuthTokens, readAccessToken } from '@/lib/auth-storage';
import { getUserDisplayName } from '@/lib/user-display';

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const accessToken = readAccessToken();
    if (!accessToken) {
      router.replace('/login');
      return;
    }

    getMe(accessToken)
      .then((currentUser) => {
        setUser(currentUser);
      })
      .catch((loadError) => {
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          router.replace('/');
          return;
        }

        setError(loadError instanceof Error ? loadError.message : '无法获取当前用户。');
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [router]);

  return (
    <section className="page-shell">
      <div className="status-row">
        <span className="status">{isLoading ? '正在读取身份' : user ? '已登录' : '未登录'}</span>
      </div>
      {user ? (
        <div className="workspace-grid">
          <div className="profile-panel">
            <span className="section-label">当前账号</span>
            <strong>{getUserDisplayName(user)}</strong>
            <p>@{user.username}</p>
            <span className="realm-badge">{user.isSuperAdmin ? '超级管理员' : user.role.name}</span>
          </div>
          <div className="identity-list">
            <div>
              <span>角色等级</span>
              <strong>{user.role.level}</strong>
            </div>
            <div>
              <span>超级管理员</span>
              <strong>{user.isSuperAdmin ? '是' : '否'}</strong>
            </div>
            <div>
              <span>账号状态</span>
              <strong>{user.status === 'active' ? '启用' : '停用'}</strong>
            </div>
          </div>
          <div className="entry-list compact">
            <Link className="entry-item" href="/nav">
              <span className="entry-marker">NAV</span>
              <span className="entry-main">
                <strong>公开导航</strong>
                <span>查看所有公开入口。</span>
              </span>
              <span className="entry-meta">公开</span>
            </Link>
            <Link className="entry-item" href="/tools">
              <span className="entry-marker">KIT</span>
              <span className="entry-main">
                <strong>工具箱</strong>
                <span>按角色查看后续接入的工具。</span>
              </span>
              <span className="entry-meta">登录</span>
            </Link>
          </div>
        </div>
      ) : null}
      <AppToast message={error} onDismiss={() => setError('')} tone="error" />
    </section>
  );
}
