'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { listAdminUsers, listRoles, updateUserPassword, updateUserRole, updateUserStatus } from '@/lib/admin-api';
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
  const [passwordTarget, setPasswordTarget] = useState<AuthUser | null>(null);
  const [newPassword, setNewPassword] = useState('');
  const [passwordConfirmation, setPasswordConfirmation] = useState('');
  const [isPasswordSaving, setIsPasswordSaving] = useState(false);

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

  function openPasswordDialog(user: AuthUser) {
    setPasswordTarget(user);
    setNewPassword('');
    setPasswordConfirmation('');
    setError('');
    setNotice('');
  }

  function closePasswordDialog() {
    if (isPasswordSaving) {
      return;
    }

    setPasswordTarget(null);
    setNewPassword('');
    setPasswordConfirmation('');
  }

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!accessToken || !passwordTarget) {
      return;
    }

    if (newPassword.length < 8) {
      setError('新密码至少需要 8 位。');
      setNotice('');
      return;
    }

    if (newPassword !== passwordConfirmation) {
      setError('两次输入的密码不一致。');
      setNotice('');
      return;
    }

    setBusyUserId(passwordTarget.id);
    setIsPasswordSaving(true);
    setError('');
    setNotice('');

    try {
      const updatedUser = await updateUserPassword(accessToken, passwordTarget.id, newPassword);
      replaceUser(updatedUser);
      setPasswordTarget(null);
      setNewPassword('');
      setPasswordConfirmation('');
      setNotice(`已更新 ${updatedUser.username} 的密码。`);
    } catch (passwordError) {
      setError(passwordError instanceof Error ? passwordError.message : '密码更新失败。');
    } finally {
      setIsPasswordSaving(false);
      setBusyUserId(null);
    }
  }

  function replaceUser(updatedUser: AuthUser) {
    setUsers((currentUsers) => currentUsers.map((user) => (user.id === updatedUser.id ? updatedUser : user)));
  }

  if (isLoading) {
    return (
      <section className="page-shell admin-shell">
        <span className="eyebrow">HLOVET Admin</span>
        <h1>用户管理</h1>
        <div className="status-row">
          <span className="status">正在读取权限</span>
        </div>
      </section>
    );
  }

  if (!currentUser) {
    return (
      <section className="page-shell admin-shell">
        <span className="eyebrow">HLOVET Admin</span>
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
      <section className="page-shell admin-shell">
        <span className="eyebrow">HLOVET Admin</span>
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
    <section className="page-shell admin-shell">
      <header className="page-header">
        <span className="eyebrow">HLOVET Admin</span>
        <div className="title-row">
          <div>
            <h1>用户管理</h1>
            <p>维护账号角色、启用状态和密码重置。</p>
          </div>
          <div className="admin-summary" aria-label="用户概览">
            <span>{users.length} 个账号</span>
            <span>{enabledCount} 个启用</span>
          </div>
        </div>
      </header>
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
                    <div className="table-actions">
                      <button
                        className="table-action"
                        disabled={isBusy}
                        onClick={() => void handleStatusToggle(user)}
                        type="button"
                      >
                        {isBusy ? '保存中' : user.status === 'active' ? '停用' : '启用'}
                      </button>
                      <button
                        className="table-action"
                        disabled={isBusy}
                        onClick={() => openPasswordDialog(user)}
                        type="button"
                      >
                        修改密码
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {passwordTarget ? (
        <div
          className="modal-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              closePasswordDialog();
            }
          }}
          role="presentation"
        >
          <div aria-labelledby="password-modal-title" aria-modal="true" className="modal-panel" role="dialog">
            <div className="modal-heading">
              <span className="eyebrow">Password</span>
              <h2 id="password-modal-title">修改密码</h2>
              <p>目标账号：{passwordTarget.username}</p>
            </div>
            <form className="form-stack modal-form" onSubmit={(event) => void handlePasswordSubmit(event)}>
              <label>
                新密码
                <input
                  autoComplete="new-password"
                  disabled={isPasswordSaving}
                  minLength={8}
                  onChange={(event) => setNewPassword(event.target.value)}
                  type="password"
                  value={newPassword}
                />
              </label>
              <label>
                确认密码
                <input
                  autoComplete="new-password"
                  disabled={isPasswordSaving}
                  minLength={8}
                  onChange={(event) => setPasswordConfirmation(event.target.value)}
                  type="password"
                  value={passwordConfirmation}
                />
              </label>
              <div className="actions">
                <button className="button" disabled={isPasswordSaving} type="submit">
                  {isPasswordSaving ? '保存中' : '保存'}
                </button>
                <button className="button secondary" disabled={isPasswordSaving} onClick={closePasswordDialog} type="button">
                  取消
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </section>
  );
}
