'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { listAdminUsers, listRoles, updateUserRole, updateUserStatus } from '@/lib/admin-api';
import { AuthRole, AuthUser, getMe } from '@/lib/auth-api';
import { readAccessToken } from '@/lib/auth-storage';

const STATUS_LABEL: Record<AuthUser['status'], string> = {
  active: '启用',
  disabled: '停用',
};

export default function AdminPage() {
  const router = useRouter();
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [roles, setRoles] = useState<AuthRole[]>([]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [busyUserId, setBusyUserId] = useState<number | null>(null);

  useEffect(() => {
    let isMounted = true;
    const token = readAccessToken();

    if (!token) {
      router.replace('/login');
      return;
    }

    async function loadAdminWorkspace(verifiedToken: string) {
      setError('');
      try {
        const me = await getMe(verifiedToken);
        if (!isMounted) {
          return;
        }

        setAccessToken(verifiedToken);
        setCurrentUser(me);

        if (!me.isSuperAdmin) {
          return;
        }

        const [nextUsers, nextRoles] = await Promise.all([listAdminUsers(verifiedToken), listRoles()]);
        if (!isMounted) {
          return;
        }

        setUsers(nextUsers);
        setRoles(nextRoles);
      } catch (loadError) {
        if (isMounted) {
          setError(loadError instanceof Error ? loadError.message : '无法读取管理数据。');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadAdminWorkspace(token);

    return () => {
      isMounted = false;
    };
  }, [router]);

  const enabledCount = useMemo(() => users.filter((user) => user.status === 'active').length, [users]);

  async function handleRoleChange(user: AuthUser, roleCode: string) {
    if (!accessToken || user.role.code === roleCode) {
      return;
    }

    setBusyUserId(user.id);
    setError('');
    setNotice('');

    try {
      const updatedUser = await updateUserRole(accessToken, user.id, roleCode);
      replaceUser(updatedUser);
      setNotice(`已更新 ${updatedUser.username} 的角色。`);
    } catch (roleError) {
      setError(roleError instanceof Error ? roleError.message : '角色更新失败。');
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleStatusToggle(user: AuthUser) {
    if (!accessToken) {
      return;
    }

    const nextStatus: AuthUser['status'] = user.status === 'active' ? 'disabled' : 'active';
    setBusyUserId(user.id);
    setError('');
    setNotice('');

    try {
      const updatedUser = await updateUserStatus(accessToken, user.id, nextStatus);
      replaceUser(updatedUser);
      setNotice(`已${STATUS_LABEL[nextStatus]} ${updatedUser.username}。`);
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : '状态更新失败。');
    } finally {
      setBusyUserId(null);
    }
  }

  function replaceUser(updatedUser: AuthUser) {
    setUsers((currentUsers) => currentUsers.map((user) => (user.id === updatedUser.id ? updatedUser : user)));
  }

  if (isLoading) {
    return (
      <section className="admin-shell">
        <span className="eyebrow">Admin</span>
        <h1>用户管理</h1>
        <div className="status-row">
          <span className="status">正在读取权限</span>
        </div>
      </section>
    );
  }

  if (!currentUser) {
    return (
      <section className="admin-shell">
        <span className="eyebrow">Admin</span>
        <h1>无法进入管理后台</h1>
        <p>{error || '请重新登录后再访问。'}</p>
        <div className="actions">
          <Link className="button secondary" href="/login">
            返回登录
          </Link>
        </div>
      </section>
    );
  }

  if (currentUser && !currentUser.isSuperAdmin) {
    return (
      <section className="admin-shell">
        <span className="eyebrow">Admin</span>
        <h1>无权访问</h1>
        <p>该页面仅超级管理员可查看。</p>
        <div className="actions">
          <Link className="button secondary" href="/dashboard">
            返回工作台
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="admin-shell">
      <span className="eyebrow">Admin</span>
      <div className="admin-heading">
        <div>
          <h1>用户管理</h1>
          <p>维护账号角色和启用状态。</p>
        </div>
        <div className="admin-summary" aria-label="用户概览">
          <span>{users.length} 个账号</span>
          <span>{enabledCount} 个启用</span>
        </div>
      </div>
      {error ? <p className="message error">{error}</p> : null}
      {notice ? <p className="message success">{notice}</p> : null}
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>账号</th>
              <th>邮箱</th>
              <th>角色</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => {
              const isBusy = busyUserId === user.id;

              return (
                <tr key={user.id}>
                  <td>
                    <div className="user-cell">
                      <strong>{user.username}</strong>
                      {user.isSuperAdmin ? <span>超级管理员</span> : null}
                    </div>
                  </td>
                  <td>{user.email}</td>
                  <td>
                    <select
                      aria-label={`${user.username} 的角色`}
                      disabled={isBusy}
                      onChange={(event) => void handleRoleChange(user, event.target.value)}
                      value={user.role.code}
                    >
                      {roles.map((role) => (
                        <option key={role.code} value={role.code}>
                          {role.name} · {role.level}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <span className={`status-badge ${user.status}`}>{STATUS_LABEL[user.status]}</span>
                  </td>
                  <td>
                    <button
                      className="table-action"
                      disabled={isBusy}
                      onClick={() => void handleStatusToggle(user)}
                      type="button"
                    >
                      {isBusy ? '保存中' : user.status === 'active' ? '停用' : '启用'}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
