"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  KeyRound,
  ShieldCheck,
  ShieldOff,
  UserRoundCheck,
  UserRoundPen,
  UserRoundX,
} from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import { AppToast } from "@/components/app-toast";
import { AdminPageHeader, AdminPageLoading } from "@/components/admin-page-header";
import { GlassSelect } from "@/components/glass-select";
import { useLanguage } from "@/components/language-provider";
import { PasswordInput } from "@/components/password-input";
import { RoleSymbol } from "@/components/role-symbol";
import { ManagementIdentitySymbol } from "@/components/user-identity-badges";
import {
  listAdminUsers,
  resetUserNickname,
  updateUserAdministrator,
  updateUserPassword,
  updateUserStatus,
} from "@/lib/admin-api";
import {
  ApiRequestError,
  AuthUser,
  getMe,
  isAuthExpiredError,
} from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { localizedPath } from "@/lib/i18n";
import { growthLevelLabel } from "@/lib/system-labels";
import { getManagementIdentity, isSiteManager } from "@/lib/user-permissions";

export default function AdminPage() {
  const router = useRouter();
  const { locale, phrase } = useLanguage();
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [users, setUsers] = useState<AuthUser[]>([]);
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
      router.replace(localizedPath("/login", locale));
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
      } catch (loadError) {
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          router.replace(localizedPath("/", locale));
          return;
        }

        if (isMounted) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : phrase("无法读取管理数据。", "Could not load management data."),
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
  }, [locale, phrase, router]);

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
          router.replace(localizedPath("/", locale));
          return;
        }

        if (isMounted) {
          setError(
            listError instanceof Error
              ? listError.message
              : phrase("无法读取用户列表。", "Could not load user list."),
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
    locale,
    phrase,
    router,
    searchQuery,
  ]);

  async function handleAdministratorToggle(user: AuthUser) {
    if (!accessToken) {
      return;
    }

    setBusyUserId(user.id);
    setError("");
    setNotice("");

    try {
      const updatedUser = await updateUserAdministrator(
        accessToken,
        user.id,
        !user.isAdministrator,
      );
      replaceUser(updatedUser);
      setNotice(
        updatedUser.isAdministrator
          ? phrase(`已授予 ${updatedUser.username} 站点管理员身份。`, `${updatedUser.username} is now a site administrator.`)
          : phrase(`已取消 ${updatedUser.username} 的站点管理员身份。`, `${updatedUser.username} is no longer a site administrator.`),
      );
    } catch (administratorError) {
      setError(
        administratorError instanceof Error
          ? administratorError.message
          : phrase("管理员身份更新失败。", "Could not update administrator access."),
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
      setNotice(nextStatus === "active" ? phrase(`已启用 ${updatedUser.username}。`, `${updatedUser.username} enabled.`) : phrase(`已停用 ${updatedUser.username}。`, `${updatedUser.username} disabled.`));
    } catch (statusError) {
      setError(
        statusError instanceof Error ? statusError.message : phrase("状态更新失败。", "Could not update account status."),
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
      setNotice(phrase(`已将 ${updatedUser.username} 的昵称重置为用户名。`, `${updatedUser.username}'s nickname was reset to the username.`));
    } catch (nicknameError) {
      setError(
        nicknameError instanceof Error
          ? nicknameError.message
          : phrase("昵称重置失败。", "Could not reset nickname."),
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
      setError(phrase("新密码至少需要 8 位。", "New password must be at least 8 characters."));
      setNotice("");
      return;
    }

    if (newPassword !== passwordConfirmation) {
      setError(phrase("两次输入的密码不一致。", "Passwords do not match."));
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
      setNotice(phrase(`已更新 ${updatedUser.username} 的密码。`, `${updatedUser.username}'s password was updated.`));
    } catch (passwordError) {
      setError(
        passwordError instanceof Error
          ? passwordError.message
          : phrase("密码更新失败。", "Could not update password."),
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

  const pageDescription = phrase("管理用户账号、角色和状态。", "Manage user accounts, roles, and status.");

  if (isLoading) return <AdminPageLoading description={pageDescription} loadingLabel={phrase("正在读取权限", "Checking access")} title={phrase("用户管理", "User management")} />;

  if (!currentUser) {
    return (
      <section className="page-shell admin-shell">
        <span className="eyebrow">HLOVET Admin</span>
        <h1>{phrase("无法进入管理后台", "Cannot open management")}</h1>
        <p>{error || phrase("请重新登录后再访问。", "Sign in again to continue.")}</p>
        <div className="actions">
          <Link className="button secondary" href={localizedPath("/login", locale)}>
            {phrase("返回登录", "Back to sign in")}
          </Link>
        </div>
      </section>
    );
  }

  if (!canAccessUserManagement(currentUser)) {
    return (
      <section className="page-shell admin-shell">
        <span className="eyebrow">HLOVET Admin</span>
        <h1>{phrase("无权访问", "Access denied")}</h1>
        <p>{phrase("该页面仅超级管理员和管理员可查看。", "This page is available only to site administrators.")}</p>
        <div className="actions">
          <Link className="button secondary" href={localizedPath("/dashboard", locale)}>
            {phrase("返回工作台", "Back to workspace")}
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="page-shell admin-shell">
      <AdminPageHeader actions={<Link className="text-action" href={localizedPath("/admin/deleted-users", locale)}>{phrase("已注销账号", "Deleted accounts")}</Link>} description={pageDescription} title={phrase("用户管理", "User management")} />
      <div className="admin-list-toolbar">
        <div className="admin-summary" aria-label={phrase("用户概览", "User summary")}>
          <span>{phrase(`${total} 个账号`, `${total} accounts`)}</span>
          <span>{phrase(`${activeCount} 个启用`, `${activeCount} active`)}</span>
        </div>
        <label className="admin-search-field">
          <span>{phrase("搜索用户", "Search users")}</span>
          <input
            maxLength={64}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder={phrase("输入昵称或用户名", "Enter nickname or username")}
            type="search"
            value={searchDraft}
          />
        </label>
        <label className="admin-page-size">
          <span>{phrase("每页显示", "Per page")}</span>
          <GlassSelect ariaLabel={phrase("每页显示", "Per page")} onChange={(value) => { setPage(1); setPageSize(Number(value)); }} options={[10, 20, 50].map((value) => ({ value: String(value), label: phrase(`${value} 条`, `${value} items`) }))} value={String(pageSize)} />
        </label>
      </div>
      <AppToast
        duration={error ? 4200 : 2600}
        message={error || notice}
        onDismiss={() => {
          setError("");
          setNotice("");
        }}
        tone={error ? "error" : "success"}
      />
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>{phrase("账号", "Account")}</th>
              <th>{phrase("邮箱", "Email")}</th>
              <th>{phrase("成长等级 / 管理身份", "Level / site access")}</th>
              <th>{phrase("状态", "Status")}</th>
              <th>{phrase("操作", "Actions")}</th>
            </tr>
          </thead>
          <tbody>
            {isListLoading ? (
              <tr>
                <td className="admin-table-state" colSpan={5}>
                  {phrase("正在读取用户", "Loading users")}
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td className="admin-table-state" colSpan={5}>
                  {searchQuery ? phrase("没有找到匹配的用户", "No matching users") : phrase("暂无用户", "No users yet")}
                </td>
              </tr>
            ) : (
              users.map((user) => {
                const isBusy = busyUserId === user.id;
                const canChangeAdministrator = canChangeUserAdministrator(
                  currentUser,
                  user,
                );
                const canChangeStatus = canChangeUserStatus(currentUser, user);
                const canChangePassword = canChangeUserPassword(
                  currentUser,
                  user,
                );
                const canResetNickname = canResetUserNickname(
                  currentUser,
                  user,
                );
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
                      <div className="admin-user-identity">
                        <span className="table-role-label" title={phrase("成长等级", "Account level")}>
                          <RoleSymbol code={user.role.code} />
                          {growthLevelLabel(user.role.code, locale, user.role.name)} · Lv.{user.role.level}
                        </span>
                        {getManagementIdentity(user) ? (
                          <span className="table-management-label">
                            <ManagementIdentitySymbol user={user} />
                            {getManagementIdentity(user)?.label}
                          </span>
                        ) : (
                          <span className="table-management-label muted">{phrase("普通用户", "Member")}</span>
                        )}
                      </div>
                    </td>
                    <td>
                      <span className={`status-badge ${user.status}`}>
                        {user.status === "active" ? phrase("启用", "Active") : phrase("停用", "Disabled")}
                      </span>
                    </td>
                    <td>
                      <div className="table-actions">
                        {canChangeAdministrator ? (
                          <button
                            aria-label={user.isAdministrator ? phrase("取消站点管理员", "Remove site administrator") : phrase("授予站点管理员", "Grant site administrator")}
                            className="table-icon-action"
                            disabled={isBusy}
                            onClick={() => void handleAdministratorToggle(user)}
                            title={user.isAdministrator ? phrase("取消站点管理员", "Remove site administrator") : phrase("授予站点管理员", "Grant site administrator")}
                            type="button"
                          >
                            {user.isAdministrator ? <ShieldOff aria-hidden="true" size={16} /> : <ShieldCheck aria-hidden="true" size={16} />}
                          </button>
                        ) : null}
                        {canChangeStatus ? (
                          <button
                            aria-label={user.status === "active" ? phrase("停用账号", "Disable account") : phrase("启用账号", "Enable account")}
                            className="table-icon-action"
                            disabled={isBusy}
                            onClick={() => void handleStatusToggle(user)}
                            title={user.status === "active" ? phrase("停用账号", "Disable account") : phrase("启用账号", "Enable account")}
                            type="button"
                          >
                            {user.status === "active" ? <UserRoundX aria-hidden="true" size={16} /> : <UserRoundCheck aria-hidden="true" size={16} />}
                          </button>
                        ) : null}
                        {canChangePassword ? (
                          <button
                            aria-label={phrase("修改密码", "Change password")}
                            className="table-icon-action"
                            disabled={isBusy}
                            onClick={() => openPasswordDialog(user)}
                            title={phrase("修改密码", "Change password")}
                            type="button"
                          >
                            <KeyRound aria-hidden="true" size={16} />
                          </button>
                        ) : null}
                        {canResetNickname ? (
                          <button
                            aria-label={phrase("重置昵称", "Reset nickname")}
                            className="table-icon-action"
                            disabled={isBusy}
                            onClick={() => void handleNicknameReset(user)}
                            title={phrase("重置昵称", "Reset nickname")}
                            type="button"
                          >
                            <UserRoundPen aria-hidden="true" size={16} />
                          </button>
                        ) : null}
                        {!canChangeAdministrator &&
                        !canChangeStatus &&
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
      <nav aria-label={phrase("用户列表分页", "User list pagination")} className="admin-pagination">
        <span>
          {phrase(`第 ${page} / ${totalPages} 页`, `Page ${page} of ${totalPages}`)}
        </span>
        <div>
          <button
            disabled={isListLoading || page <= 1}
            onClick={() => setPage((value) => value - 1)}
            type="button"
          >
            {phrase("上一页", "Previous")}
          </button>
          <button
            disabled={isListLoading || page >= totalPages}
            onClick={() => setPage((value) => value + 1)}
            type="button"
          >
            {phrase("下一页", "Next")}
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
              <span className="eyebrow">{phrase("密码", "Password")}</span>
              <h2 id="password-modal-title">{phrase("修改密码", "Change password")}</h2>
              <p>{phrase(`目标账号：${passwordTarget.username}`, `Target account: ${passwordTarget.username}`)}</p>
            </div>
            <form
              className="form-stack modal-form"
              onSubmit={(event) => void handlePasswordSubmit(event)}
            >
              <label>
                {phrase("新密码", "New password")}
                <PasswordInput
                  autoComplete="new-password"
                  disabled={isPasswordSaving}
                  minLength={8}
                  onChange={(event) => setNewPassword(event.target.value)}
                  value={newPassword}
                />
              </label>
              <label>
                {phrase("确认密码", "Confirm password")}
                <PasswordInput
                  autoComplete="new-password"
                  disabled={isPasswordSaving}
                  minLength={8}
                  onChange={(event) =>
                    setPasswordConfirmation(event.target.value)
                  }
                  value={passwordConfirmation}
                />
              </label>
              <div className="actions">
                <button
                  className="button"
                  disabled={isPasswordSaving}
                  type="submit"
                >
                  {isPasswordSaving ? phrase("保存中", "Saving") : phrase("保存", "Save")}
                </button>
                <button
                  className="button secondary"
                  disabled={isPasswordSaving}
                  onClick={closePasswordDialog}
                  type="button"
                >
                  {phrase("取消", "Cancel")}
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
  return isSiteManager(user);
}

function canChangeUserAdministrator(actor: AuthUser, target: AuthUser): boolean {
  return actor.isSuperAdmin && !target.isSuperAdmin;
}

function canChangeUserStatus(actor: AuthUser, target: AuthUser): boolean {
  if (target.isSuperAdmin) {
    return false;
  }

  return actor.isSuperAdmin || (actor.isAdministrator && !target.isAdministrator);
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

  return actor.isSuperAdmin || (actor.isAdministrator && !target.isAdministrator);
}
