"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import {
  listAdminUsers,
  listRoles,
  resetUserNickname,
  updateUserPassword,
  updateUserRole,
  updateUserStatus,
} from "@/lib/admin-api";
import {
  ApiRequestError,
  AuthRole,
  AuthUser,
  getMe,
  isAuthExpiredError,
} from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";

const STATUS_LABEL: Record<AuthUser["status"], string> = {
  active: "启用",
  disabled: "停用",
};

export default function AdminPage() {
  const router = useRouter();
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [roles, setRoles] = useState<AuthRole[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isListLoading, setIsListLoading] = useState(false);
  const [busyUserId, setBusyUserId] = useState<number | null>(null);
  const [passwordTarget, setPasswordTarget] = useState<AuthUser | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [isPasswordSaving, setIsPasswordSaving] = useState(false);
  const [searchDraft, setSearchDraft] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [activeCount, setActiveCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [reloadVersion, setReloadVersion] = useState(0);

  useEffect(() => {
    let isMounted = true;
    const token = readAccessToken();

    if (!token) {
      router.replace("/login");
      return;
    }

    async function loadAdminWorkspace(verifiedToken: string) {
      setError("");
      try {
        const me = await getMe(verifiedToken);
        if (!isMounted) {
          return;
        }

        setAccessToken(verifiedToken);
        setCurrentUser(me);

        if (!canAccessUserManagement(me)) {
          return;
        }

        try {
          const nextRoles = await listRoles();
          if (!isMounted) {
            return;
          }

          setRoles(nextRoles);
        } catch (managementError) {
          if (
            managementError instanceof ApiRequestError &&
            managementError.status === 401
          ) {
            clearAuthTokens();
            router.replace("/");
            return;
          }

          if (isMounted) {
            setError(
              managementError instanceof Error
                ? managementError.message
                : "无法读取管理数据。",
            );
          }
        }
      } catch (loadError) {
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          router.replace("/");
          return;
        }

        if (isMounted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "无法读取管理数据。",
          );
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

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setPage(1);
      setSearchQuery(searchDraft.trim());
    }, 300);

    return () => window.clearTimeout(timeoutId);
  }, [searchDraft]);

  useEffect(() => {
    if (!accessToken || !currentUser || !canAccessUserManagement(currentUser)) {
      return;
    }

    const token = accessToken;
    let isMounted = true;

    async function loadUserPage() {
      setIsListLoading(true);
      setError("");

      try {
        const result = await listAdminUsers(token, {
          page,
          pageSize,
          search: searchQuery,
        });
        if (!isMounted) {
          return;
        }

        setUsers(result.items);
        setTotal(result.total);
        setActiveCount(result.activeCount);
        setTotalPages(result.totalPages);
        if (result.page !== page) {
          setPage(result.page);
        }
      } catch (listError) {
        if (listError instanceof ApiRequestError && listError.status === 401) {
          clearAuthTokens();
          router.replace("/");
          return;
        }

        if (isMounted) {
          setError(
            listError instanceof Error
              ? listError.message
              : "无法读取用户列表。",
          );
        }
      } finally {
        if (isMounted) {
          setIsListLoading(false);
        }
      }
    }

    void loadUserPage();

    return () => {
      isMounted = false;
    };
  }, [
    accessToken,
    currentUser,
    page,
    pageSize,
    reloadVersion,
    router,
    searchQuery,
  ]);

  async function handleRoleChange(user: AuthUser, roleCode: string) {
    if (!accessToken || user.role.code === roleCode) {
      return;
    }

    setBusyUserId(user.id);
    setError("");
    setNotice("");

    try {
      const updatedUser = await updateUserRole(accessToken, user.id, roleCode);
      replaceUser(updatedUser);
      setNotice(`已更新 ${updatedUser.username} 的角色。`);
    } catch (roleError) {
      setError(
        roleError instanceof Error ? roleError.message : "角色更新失败。",
      );
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleStatusToggle(user: AuthUser) {
    if (!accessToken) {
      return;
    }

    const nextStatus: AuthUser["status"] =
      user.status === "active" ? "disabled" : "active";
    setBusyUserId(user.id);
    setError("");
    setNotice("");

    try {
      const updatedUser = await updateUserStatus(
        accessToken,
        user.id,
        nextStatus,
      );
      replaceUser(updatedUser);
      if (updatedUser.status !== user.status) {
        setActiveCount((count) =>
          Math.max(0, count + (updatedUser.status === "active" ? 1 : -1)),
        );
      }
      setNotice(`已${STATUS_LABEL[nextStatus]} ${updatedUser.username}。`);
    } catch (statusError) {
      setError(
        statusError instanceof Error ? statusError.message : "状态更新失败。",
      );
    } finally {
      setBusyUserId(null);
    }
  }

  async function handleNicknameReset(user: AuthUser) {
    if (!accessToken) {
      return;
    }

    setBusyUserId(user.id);
    setError("");
    setNotice("");

    try {
      const updatedUser = await resetUserNickname(accessToken, user.id);
      replaceUser(updatedUser);
      setReloadVersion((version) => version + 1);
      setNotice(`已将 ${updatedUser.username} 的昵称重置为用户名。`);
    } catch (nicknameError) {
      setError(
        nicknameError instanceof Error
          ? nicknameError.message
          : "昵称重置失败。",
      );
    } finally {
      setBusyUserId(null);
    }
  }

  function openPasswordDialog(user: AuthUser) {
    setPasswordTarget(user);
    setNewPassword("");
    setPasswordConfirmation("");
    setError("");
    setNotice("");
  }

  function closePasswordDialog() {
    if (isPasswordSaving) {
      return;
    }

    setPasswordTarget(null);
    setNewPassword("");
    setPasswordConfirmation("");
  }

  async function handlePasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!accessToken || !passwordTarget) {
      return;
    }

    if (newPassword.length < 8) {
      setError("新密码至少需要 8 位。");
      setNotice("");
      return;
    }

    if (newPassword !== passwordConfirmation) {
      setError("两次输入的密码不一致。");
      setNotice("");
      return;
    }

    setBusyUserId(passwordTarget.id);
    setIsPasswordSaving(true);
    setError("");
    setNotice("");

    try {
      const updatedUser = await updateUserPassword(
        accessToken,
        passwordTarget.id,
        newPassword,
      );
      replaceUser(updatedUser);
      setPasswordTarget(null);
      setNewPassword("");
      setPasswordConfirmation("");
      setNotice(`已更新 ${updatedUser.username} 的密码。`);
    } catch (passwordError) {
      setError(
        passwordError instanceof Error
          ? passwordError.message
          : "密码更新失败。",
      );
    } finally {
      setIsPasswordSaving(false);
      setBusyUserId(null);
    }
  }

  function replaceUser(updatedUser: AuthUser) {
    setUsers((currentUsers) =>
      currentUsers.map((user) =>
        user.id === updatedUser.id ? updatedUser : user,
      ),
    );
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
        <p>{error || "请重新登录后再访问。"}</p>
        <div className="actions">
          <Link className="button secondary" href="/login">
            返回登录
          </Link>
        </div>
      </section>
    );
  }

  if (!canAccessUserManagement(currentUser)) {
    return (
      <section className="page-shell admin-shell">
        <span className="eyebrow">HLOVET Admin</span>
        <h1>无权访问</h1>
        <p>该页面仅超级管理员和管理员可查看。</p>
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
            <p>
              {currentUser.isSuperAdmin
                ? "维护账号角色、启用状态和密码。"
                : "维护低于管理员层级账号的角色和启用状态。"}
            </p>
          </div>
          <div className="admin-header-tools">
            <div className="admin-summary" aria-label="用户概览">
              <span>{total} 个账号</span>
              <span>{activeCount} 个启用</span>
            </div>
          </div>
        </div>
      </header>
      <div className="admin-list-toolbar">
        <label className="admin-search-field">
          <span>搜索用户</span>
          <input
            maxLength={64}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder="输入昵称或用户名"
            type="search"
            value={searchDraft}
          />
        </label>
        <label className="admin-page-size">
          <span>每页显示</span>
          <select
            onChange={(event) => {
              setPage(1);
              setPageSize(Number(event.target.value));
            }}
            value={pageSize}
          >
            <option value={10}>10 条</option>
            <option value={20}>20 条</option>
            <option value={50}>50 条</option>
          </select>
        </label>
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
            {isListLoading ? (
              <tr>
                <td className="admin-table-state" colSpan={5}>
                  正在读取用户
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td className="admin-table-state" colSpan={5}>
                  {searchQuery ? "没有找到匹配的用户" : "暂无用户"}
                </td>
              </tr>
            ) : (
              users.map((user) => {
                const isBusy = busyUserId === user.id;
                const canChangeRole = canChangeUserRole(currentUser, user);
                const canChangeStatus = canChangeUserStatus(currentUser, user);
                const canChangePassword = canChangeUserPassword(
                  currentUser,
                  user,
                );
                const canResetNickname = canResetUserNickname(
                  currentUser,
                  user,
                );
                const assignableRoles = currentUser.isSuperAdmin
                  ? roles
                  : roles.filter((role) => role.level < currentUser.role.level);

                return (
                  <tr key={user.id}>
                    <td>
                      <div className="user-cell">
                        <strong>{user.nickname}</strong>
                        <span>@{user.username}</span>
                      </div>
                    </td>
                    <td>{user.email}</td>
                    <td>
                      {canChangeRole ? (
                        <select
                          aria-label={`${user.username} 的角色`}
                          disabled={isBusy}
                          onChange={(event) =>
                            void handleRoleChange(user, event.target.value)
                          }
                          value={user.role.code}
                        >
                          {assignableRoles.map((role) => (
                            <option key={role.code} value={role.code}>
                              {role.name} · {role.level}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="table-role-label">
                          {user.isSuperAdmin
                            ? "超级管理员"
                            : `${user.role.name} · ${user.role.level}`}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className={`status-badge ${user.status}`}>
                        {STATUS_LABEL[user.status]}
                      </span>
                    </td>
                    <td>
                      <div className="table-actions">
                        {canChangeStatus ? (
                          <button
                            className="table-action"
                            disabled={isBusy}
                            onClick={() => void handleStatusToggle(user)}
                            type="button"
                          >
                            {isBusy
                              ? "保存中"
                              : user.status === "active"
                                ? "停用"
                                : "启用"}
                          </button>
                        ) : null}
                        {canChangePassword ? (
                          <button
                            className="table-action"
                            disabled={isBusy}
                            onClick={() => openPasswordDialog(user)}
                            type="button"
                          >
                            修改密码
                          </button>
                        ) : null}
                        {canResetNickname ? (
                          <button
                            className="table-action"
                            disabled={isBusy}
                            onClick={() => void handleNicknameReset(user)}
                            type="button"
                          >
                            重置昵称
                          </button>
                        ) : null}
                        {!canChangeStatus &&
                        !canChangePassword &&
                        !canResetNickname ? (
                          <span className="table-no-action">—</span>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
      <nav aria-label="用户列表分页" className="admin-pagination">
        <span>
          第 {page} / {totalPages} 页
        </span>
        <div>
          <button
            disabled={isListLoading || page <= 1}
            onClick={() => setPage((value) => value - 1)}
            type="button"
          >
            上一页
          </button>
          <button
            disabled={isListLoading || page >= totalPages}
            onClick={() => setPage((value) => value + 1)}
            type="button"
          >
            下一页
          </button>
        </div>
      </nav>
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
          <div
            aria-labelledby="password-modal-title"
            aria-modal="true"
            className="modal-panel"
            role="dialog"
          >
            <div className="modal-heading">
              <span className="eyebrow">Password</span>
              <h2 id="password-modal-title">修改密码</h2>
              <p>目标账号：{passwordTarget.username}</p>
            </div>
            <form
              className="form-stack modal-form"
              onSubmit={(event) => void handlePasswordSubmit(event)}
            >
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
                  onChange={(event) =>
                    setPasswordConfirmation(event.target.value)
                  }
                  type="password"
                  value={passwordConfirmation}
                />
              </label>
              <div className="actions">
                <button
                  className="button"
                  disabled={isPasswordSaving}
                  type="submit"
                >
                  {isPasswordSaving ? "保存中" : "保存"}
                </button>
                <button
                  className="button secondary"
                  disabled={isPasswordSaving}
                  onClick={closePasswordDialog}
                  type="button"
                >
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

function canAccessUserManagement(user: AuthUser): boolean {
  return user.isSuperAdmin || user.role.level >= 90;
}

function canChangeUserRole(actor: AuthUser, target: AuthUser): boolean {
  if (target.isSuperAdmin) {
    return false;
  }

  return actor.isSuperAdmin || target.role.level < actor.role.level;
}

function canChangeUserStatus(actor: AuthUser, target: AuthUser): boolean {
  if (target.isSuperAdmin) {
    return false;
  }

  return actor.isSuperAdmin || target.role.level < actor.role.level;
}

function canChangeUserPassword(actor: AuthUser, target: AuthUser): boolean {
  if (!actor.isSuperAdmin) {
    return false;
  }

  return !target.isSuperAdmin || target.id === actor.id;
}

function canResetUserNickname(actor: AuthUser, target: AuthUser): boolean {
  if (target.isSuperAdmin || target.nickname === target.username) {
    return false;
  }

  return actor.isSuperAdmin || target.role.level < actor.role.level;
}
