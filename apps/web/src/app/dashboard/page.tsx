'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { AuthUser, getMe, logout } from '@/lib/auth-api';
import { clearAuthTokens, readAccessToken, readRefreshToken } from '@/lib/auth-storage';

export default function DashboardPage() {
  const router = useRouter();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isLoggingOut, setIsLoggingOut] = useState(false);

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
        setError(loadError instanceof Error ? loadError.message : '无法获取当前用户。');
      })
      .finally(() => {
        setIsLoading(false);
      });
  }, [router]);

  async function handleLogout() {
    setIsLoggingOut(true);
    const refreshToken = readRefreshToken();

    try {
      if (refreshToken) {
        await logout(refreshToken);
      }
    } finally {
      clearAuthTokens();
      router.replace('/login');
    }
  }

  return (
    <section>
      <span className="eyebrow">Workspace</span>
      <h1>个人工作台</h1>
      <p>当前阶段先展示身份和角色，后续导航、页面和工具都会基于这里的权限判断。</p>
      <div className="status-row">
        <span className="status">{isLoading ? '正在读取身份' : user ? '已登录' : '未登录'}</span>
      </div>
      {error ? <p className="message error">{error}</p> : null}
      {user ? (
        <div className="identity-list">
          <div>
            <span>用户名</span>
            <strong>{user.username}</strong>
          </div>
          <div>
            <span>邮箱</span>
            <strong>{user.email}</strong>
          </div>
          <div>
            <span>角色</span>
            <strong>
              {user.role.name} · {user.role.level}
            </strong>
          </div>
          <div>
            <span>超级管理员</span>
            <strong>{user.isSuperAdmin ? '是' : '否'}</strong>
          </div>
        </div>
      ) : null}
      <div className="actions">
        <button className="button secondary" disabled={isLoggingOut || !user} onClick={handleLogout} type="button">
          {isLoggingOut ? '退出中' : '退出登录'}
        </button>
      </div>
    </section>
  );
}
