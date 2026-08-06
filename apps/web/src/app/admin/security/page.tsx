"use client";

import {
  AlertTriangle,
  KeyRound,
  Mail,
  Save,
  Search,
  Send,
  ShieldCheck,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { AppToast } from "@/components/app-toast";
import { PasswordInput } from "@/components/password-input";
import {
  type AuthUser,
  getMe,
  isAuthExpiredError,
} from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import {
  getSecurityAdminConfig,
  getSecurityAdminOverview,
  type SecurityAdminConfig,
  type SecurityAdminConfigUpdate,
  type SecurityAdminOverviewItem,
  type SecurityAdminTab,
  testSmtpConnection,
  updateSecurityAdminConfig,
} from "@/lib/security-api";

const tabOptions: Array<{
  value: SecurityAdminTab;
  label: string;
  Icon: typeof Mail;
}> = [
  { value: "mail-jobs", label: "邮件任务", Icon: Mail },
  { value: "verification-codes", label: "验证码", Icon: KeyRound },
  { value: "risk-events", label: "风险事件", Icon: AlertTriangle },
];

const statusOptions: Record<SecurityAdminTab, Array<[string, string]>> = {
  "mail-jobs": [
    ["", "全部状态"],
    ["pending", "待发送"],
    ["sending", "发送中"],
    ["sent", "已发送"],
    ["failed", "发送失败"],
  ],
  "verification-codes": [
    ["", "全部状态"],
    ["pending", "待验证"],
    ["verified", "已验证"],
    ["consumed", "已使用"],
    ["expired", "已过期"],
  ],
  "risk-events": [
    ["", "全部等级"],
    ["info", "信息"],
    ["low", "低风险"],
    ["medium", "中风险"],
    ["high", "高风险"],
  ],
};

export default function SecurityAdminPage() {
  const router = useRouter();
  const [accessToken, setAccessToken] = useState("");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [config, setConfig] = useState<SecurityAdminConfig | null>(null);
  const [draft, setDraft] = useState<SecurityAdminConfig | null>(null);
  const [tab, setTab] = useState<SecurityAdminTab>("mail-jobs");
  const [items, setItems] = useState<SecurityAdminOverviewItem[]>([]);
  const [searchDraft, setSearchDraft] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isListLoading, setIsListLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const token = readAccessToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    let active = true;

    async function loadWorkspace() {
      try {
        const currentUser = await getMe(token as string);
        if (!active) return;
        setUser(currentUser);
        setAccessToken(token as string);
        if (!canAccessSecurityAdmin(currentUser)) return;

        const nextConfig = await getSecurityAdminConfig(token as string);
        if (!active) return;
        setConfig(nextConfig);
        setDraft({ ...nextConfig, smtpPassword: "", turnstileSecret: "" });
      } catch (loadError) {
        if (isAuthExpiredError(loadError)) {
          clearAuthTokens();
          router.replace("/");
          return;
        }
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "安全管理数据读取失败。",
          );
        }
      } finally {
        if (active) setIsLoading(false);
      }
    }

    void loadWorkspace();
    return () => {
      active = false;
    };
  }, [router]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setPage(1);
      setSearch(searchDraft.trim());
    }, 280);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  useEffect(() => {
    if (!accessToken || !user || !canAccessSecurityAdmin(user)) return;
    let active = true;
    const timer = window.setTimeout(() => {
      setIsListLoading(true);
      getSecurityAdminOverview(accessToken, {
        tab,
        page,
        pageSize: 10,
        search,
        status,
      })
        .then((response) => {
          if (!active) return;
          setItems(response.items);
          setTotal(response.total);
          setTotalPages(response.totalPages);
          if (response.page !== page) setPage(response.page);
        })
        .catch((loadError) => {
          if (isAuthExpiredError(loadError)) {
            clearAuthTokens();
            router.replace("/");
            return;
          }
          if (active) {
            setError(
              loadError instanceof Error ? loadError.message : "记录读取失败。",
            );
          }
        })
        .finally(() => {
          if (active) setIsListLoading(false);
        });
    }, 0);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [accessToken, page, router, search, status, tab, user]);

  const canEdit = user?.isSuperAdmin ?? false;
  const lastUpdated = config?.updatedAt
    ? formatDateTime(config.updatedAt)
    : "尚未记录";

  function updateDraft<K extends keyof SecurityAdminConfig>(
    key: K,
    value: SecurityAdminConfig[K],
  ) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  async function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken || !draft || !canEdit) return;

    setIsSaving(true);
    setError("");
    setNotice("");
    try {
      const update: SecurityAdminConfigUpdate = {
        smtpEnabled: draft.smtpEnabled,
        smtpHost: draft.smtpHost,
        smtpPort: draft.smtpPort,
        smtpSecure: draft.smtpSecure,
        smtpUsername: draft.smtpUsername,
        smtpFromName: draft.smtpFromName,
        smtpFromEmail: draft.smtpFromEmail,
        registrationEmailVerificationEnabled:
          draft.registrationEmailVerificationEnabled,
        passwordRecoveryEnabled: draft.passwordRecoveryEnabled,
        turnstileSiteKey: draft.turnstileSiteKey,
        turnstileRegistrationEnabled: draft.turnstileRegistrationEnabled,
        turnstileLoginEnabled: draft.turnstileLoginEnabled,
        turnstileRecoveryEnabled: draft.turnstileRecoveryEnabled,
        loginFailureTurnstileThreshold:
          draft.loginFailureTurnstileThreshold,
        ...(draft.smtpPassword ? { smtpPassword: draft.smtpPassword } : {}),
        ...(draft.turnstileSecret
          ? { turnstileSecret: draft.turnstileSecret }
          : {}),
      };
      const saved = await updateSecurityAdminConfig(accessToken, update);
      setConfig(saved);
      setDraft({ ...saved, smtpPassword: "", turnstileSecret: "" });
      setNotice("账号安全配置已保存。");
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : "安全配置保存失败。",
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSmtpTest() {
    if (!accessToken || !canEdit) return;
    setIsTesting(true);
    setError("");
    setNotice("");
    try {
      const result = await testSmtpConnection(accessToken);
      setNotice(result.message || "SMTP 连接测试成功。");
    } catch (testError) {
      setError(
        testError instanceof Error ? testError.message : "SMTP 连接测试失败。",
      );
    } finally {
      setIsTesting(false);
    }
  }

  function selectTab(nextTab: SecurityAdminTab) {
    setTab(nextTab);
    setPage(1);
    setStatus("");
  }

  if (isLoading) {
    return (
      <section className="page-shell admin-shell security-admin-shell">
        <span className="status">正在读取安全配置</span>
      </section>
    );
  }

  if (!user || !canAccessSecurityAdmin(user)) {
    return (
      <section className="page-shell admin-shell security-admin-shell">
        <div className="search-page-empty">
          <strong>无权访问</strong>
          <span>安全管理仅超级管理员和管理员可查看。</span>
        </div>
      </section>
    );
  }

  return (
    <section className="page-shell admin-shell security-admin-shell">
      <header className="security-admin-head">
        <div>
          <span className="security-admin-mark">
            <ShieldCheck aria-hidden="true" size={21} />
          </span>
          <div>
            <h1>安全管理</h1>
            <p>
              {canEdit ? "超级管理员配置" : "管理员只读"} · 更新于 {lastUpdated}
            </p>
          </div>
        </div>
        <span className={config?.encryptionConfigured ? "ready" : "warning"}>
          {config?.encryptionConfigured ? "凭据加密可用" : "凭据加密未配置"}
        </span>
      </header>

      {draft ? (
        <form className="security-config-grid" onSubmit={handleSave}>
          <section className="security-config-panel">
            <div className="security-config-heading">
              <div>
                <Mail aria-hidden="true" size={17} />
                <strong>SMTP 邮件</strong>
              </div>
              <ToggleField
                checked={draft.smtpEnabled}
                disabled={!canEdit}
                label="启用邮件服务"
                onChange={(checked) => updateDraft("smtpEnabled", checked)}
              />
            </div>
            <div className="security-form-grid">
              <Field label="SMTP 主机">
                <input
                  disabled={!canEdit}
                  onChange={(event) => updateDraft("smtpHost", event.target.value)}
                  value={draft.smtpHost}
                />
              </Field>
              <Field label="端口">
                <input
                  disabled={!canEdit}
                  max={65535}
                  min={1}
                  onChange={(event) =>
                    updateDraft("smtpPort", Number(event.target.value))
                  }
                  type="number"
                  value={draft.smtpPort}
                />
              </Field>
              <Field label="账号">
                <input
                  autoComplete="off"
                  disabled={!canEdit}
                  onChange={(event) =>
                    updateDraft("smtpUsername", event.target.value)
                  }
                  value={draft.smtpUsername}
                />
              </Field>
              <Field label="密码">
                <PasswordInput
                  autoComplete="new-password"
                  disabled={!canEdit}
                  onChange={(event) =>
                    updateDraft("smtpPassword", event.target.value)
                  }
                  placeholder={
                    draft.smtpPasswordConfigured ? "已配置，留空保持不变" : "输入 SMTP 密码"
                  }
                  value={draft.smtpPassword ?? ""}
                />
              </Field>
              <Field label="发件名称">
                <input
                  disabled={!canEdit}
                  onChange={(event) =>
                    updateDraft("smtpFromName", event.target.value)
                  }
                  value={draft.smtpFromName}
                />
              </Field>
              <Field label="发件邮箱">
                <input
                  disabled={!canEdit}
                  onChange={(event) =>
                    updateDraft("smtpFromEmail", event.target.value)
                  }
                  type="email"
                  value={draft.smtpFromEmail}
                />
              </Field>
            </div>
            <ToggleField
              checked={draft.smtpSecure}
              disabled={!canEdit}
              label="使用 TLS 安全连接"
              onChange={(checked) => updateDraft("smtpSecure", checked)}
            />
          </section>

          <section className="security-config-panel">
            <div className="security-config-heading">
              <div>
                <ShieldCheck aria-hidden="true" size={17} />
                <strong>验证策略</strong>
              </div>
            </div>
            <div className="security-policy-toggles">
              <ToggleField
                checked={draft.registrationEmailVerificationEnabled}
                disabled={!canEdit}
                label="注册邮箱验证"
                onChange={(checked) =>
                  updateDraft("registrationEmailVerificationEnabled", checked)
                }
              />
              <ToggleField
                checked={draft.passwordRecoveryEnabled}
                disabled={!canEdit}
                label="密码找回"
                onChange={(checked) =>
                  updateDraft("passwordRecoveryEnabled", checked)
                }
              />
            </div>
            <div className="security-form-grid turnstile-config-grid">
              <Field label="Turnstile Site Key">
                <input
                  disabled={!canEdit}
                  onChange={(event) =>
                    updateDraft("turnstileSiteKey", event.target.value)
                  }
                  value={draft.turnstileSiteKey}
                />
              </Field>
              <Field label="Turnstile Secret Key">
                <PasswordInput
                  autoComplete="new-password"
                  disabled={!canEdit}
                  onChange={(event) =>
                    updateDraft("turnstileSecret", event.target.value)
                  }
                  placeholder={
                    draft.turnstileSecretConfigured
                      ? "已配置，留空保持不变"
                      : "输入 Secret Key"
                  }
                  value={draft.turnstileSecret ?? ""}
                />
              </Field>
              <Field label="失败触发次数">
                <input
                  disabled={!canEdit}
                  max={5}
                  min={1}
                  onChange={(event) =>
                    updateDraft(
                      "loginFailureTurnstileThreshold",
                      Number(event.target.value),
                    )
                  }
                  type="number"
                  value={draft.loginFailureTurnstileThreshold}
                />
              </Field>
            </div>
            <div className="security-policy-toggles compact">
              <ToggleField
                checked={draft.turnstileRegistrationEnabled}
                disabled={!canEdit}
                label="注册"
                onChange={(checked) =>
                  updateDraft("turnstileRegistrationEnabled", checked)
                }
              />
              <ToggleField
                checked={draft.turnstileLoginEnabled}
                disabled={!canEdit}
                label="登录失败"
                onChange={(checked) =>
                  updateDraft("turnstileLoginEnabled", checked)
                }
              />
              <ToggleField
                checked={draft.turnstileRecoveryEnabled}
                disabled={!canEdit}
                label="密码找回"
                onChange={(checked) =>
                  updateDraft("turnstileRecoveryEnabled", checked)
                }
              />
            </div>
          </section>

          {canEdit ? (
            <div className="security-config-actions">
              <button
                className="text-action"
                disabled={isTesting || !config?.smtpEnabled}
                onClick={() => void handleSmtpTest()}
                type="button"
              >
                <Send aria-hidden="true" size={15} />
                {isTesting ? "测试中" : "测试连接"}
              </button>
              <button className="button" disabled={isSaving} type="submit">
                <Save aria-hidden="true" size={15} />
                {isSaving ? "保存中" : "保存配置"}
              </button>
            </div>
          ) : null}
        </form>
      ) : null}

      <section className="security-records-panel">
        <div className="security-records-head">
          <nav aria-label="安全记录类型" className="security-admin-tabs">
            {tabOptions.map(({ value, label, Icon }) => (
              <button
                aria-selected={tab === value}
                className={tab === value ? "active" : ""}
                key={value}
                onClick={() => selectTab(value)}
                role="tab"
                type="button"
              >
                <Icon aria-hidden="true" size={15} />
                {label}
              </button>
            ))}
          </nav>
          <span>{total} 条记录</span>
        </div>

        <div className="security-record-filters">
          <label className="security-record-search">
            <Search aria-hidden="true" size={15} />
            <input
              aria-label="搜索安全记录"
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder={searchPlaceholder(tab)}
              type="search"
              value={searchDraft}
            />
          </label>
          <select
            aria-label="记录状态"
            onChange={(event) => {
              setPage(1);
              setStatus(event.target.value);
            }}
            value={status}
          >
            {statusOptions[tab].map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>

        <div className="admin-table-wrap security-table-wrap">
          <SecurityTable isLoading={isListLoading} items={items} tab={tab} />
        </div>
        <nav aria-label="安全记录分页" className="admin-pagination">
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
      </section>

      <AppToast
        duration={error ? 4200 : 2800}
        message={error || notice}
        onDismiss={() => {
          setError("");
          setNotice("");
        }}
        tone={error ? "error" : "success"}
      />
    </section>
  );
}

function Field({ children, label }: { children: React.ReactNode; label: string }) {
  return (
    <label className="security-field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function ToggleField({
  checked,
  disabled,
  label,
  onChange,
}: {
  checked: boolean;
  disabled: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="security-toggle-field">
      <span>{label}</span>
      <input
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
    </label>
  );
}

function SecurityTable({
  isLoading,
  items,
  tab,
}: {
  isLoading: boolean;
  items: SecurityAdminOverviewItem[];
  tab: SecurityAdminTab;
}) {
  const columnCount = tab === "risk-events" ? 5 : 6;
  return (
    <table className="admin-table security-admin-table">
      <thead>
        {tab === "mail-jobs" ? (
          <tr>
            <th>创建时间</th>
            <th>收件人</th>
            <th>类型</th>
            <th>主题</th>
            <th>状态</th>
            <th>发送结果</th>
          </tr>
        ) : tab === "verification-codes" ? (
          <tr>
            <th>创建时间</th>
            <th>邮箱</th>
            <th>用途</th>
            <th>状态</th>
            <th>尝试次数</th>
            <th>有效时间</th>
          </tr>
        ) : (
          <tr>
            <th>发生时间</th>
            <th>用户</th>
            <th>事件</th>
            <th>风险</th>
            <th>来源</th>
          </tr>
        )}
      </thead>
      <tbody>
        {isLoading ? (
          <tr>
            <td className="admin-table-state" colSpan={columnCount}>
              正在读取安全记录
            </td>
          </tr>
        ) : !items.length ? (
          <tr>
            <td className="admin-table-state" colSpan={columnCount}>
              暂无匹配记录
            </td>
          </tr>
        ) : (
          items.map((item) => (
            <SecurityRecordRow item={item} key={item.id} tab={tab} />
          ))
        )}
      </tbody>
    </table>
  );
}

function SecurityRecordRow({
  item,
  tab,
}: {
  item: SecurityAdminOverviewItem;
  tab: SecurityAdminTab;
}) {
  if (tab === "mail-jobs") {
    return (
      <tr>
        <td>{formatDateTime(item.createdAt)}</td>
        <td>{item.recipient || item.email || "-"}</td>
        <td>{mailTypeLabel(item.type)}</td>
        <td className="security-table-summary">{item.subject || "-"}</td>
        <td>
          <StatusBadge value={item.status} />
        </td>
        <td>
          <strong>{item.sentAt ? formatDateTime(item.sentAt) : `${item.attempts ?? 0} 次尝试`}</strong>
          {item.lastError ? <small>{item.lastError}</small> : null}
        </td>
      </tr>
    );
  }

  if (tab === "verification-codes") {
    return (
      <tr>
        <td>{formatDateTime(item.createdAt)}</td>
        <td>{item.email || "-"}</td>
        <td>{purposeLabel(item.purpose)}</td>
        <td>
          <StatusBadge value={item.status} />
        </td>
        <td>{item.attempts ?? 0}</td>
        <td>
          <strong>{formatDateTime(item.expiresAt)}</strong>
          {item.verifiedAt || item.consumedAt ? (
            <small>
              完成于 {formatDateTime(item.consumedAt || item.verifiedAt)}
            </small>
          ) : null}
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td>{formatDateTime(item.createdAt)}</td>
      <td>
        <strong>{item.user?.nickname || "未知用户"}</strong>
        <small>{item.user?.username ? `@${item.user.username}` : ""}</small>
      </td>
      <td className="security-table-summary">
        <strong>{item.summary || securityTypeLabel(item.type)}</strong>
        <small>{securityTypeLabel(item.type)}</small>
      </td>
      <td>
        <StatusBadge value={item.riskLevel} />
      </td>
      <td>
        <strong>{item.deviceLabel || "未知设备"}</strong>
        <small>{item.ip || "IP 未记录"}</small>
      </td>
    </tr>
  );
}

function StatusBadge({ value = "unknown" }: { value?: string }) {
  return (
    <span className={`security-status-badge ${value}`}>
      {statusLabel(value)}
    </span>
  );
}

function canAccessSecurityAdmin(user: AuthUser): boolean {
  return user.isSuperAdmin || user.role.level >= 90;
}

function searchPlaceholder(tab: SecurityAdminTab): string {
  if (tab === "mail-jobs") return "收件人、主题或错误";
  if (tab === "verification-codes") return "邮箱或 IP";
  return "用户、事件、设备或 IP";
}

function statusLabel(value: string): string {
  const labels: Record<string, string> = {
    pending: "待处理",
    sending: "发送中",
    sent: "已发送",
    failed: "失败",
    verified: "已验证",
    consumed: "已使用",
    expired: "已过期",
    info: "信息",
    low: "低风险",
    medium: "中风险",
    high: "高风险",
  };
  return labels[value] ?? value;
}

function mailTypeLabel(value?: string): string {
  const labels: Record<string, string> = {
    registration_verification: "注册验证",
    account_email_verification: "邮箱验证",
    password_reset: "密码找回",
    login_risk: "登录风险",
    security_notice: "安全通知",
  };
  return labels[value ?? ""] ?? value ?? "-";
}

function purposeLabel(value?: string): string {
  return value === "registration"
    ? "注册验证"
    : value === "account_email"
      ? "账号邮箱"
      : value || "-";
}

function securityTypeLabel(value?: string): string {
  const labels: Record<string, string> = {
    login_success: "登录成功",
    new_device: "新设备登录",
    new_ip: "陌生 IP 登录",
    unusual_frequency: "异常登录频率",
    login_blocked: "登录已限制",
    password_reset: "密码已重置",
    password_changed: "密码已修改",
    email_verified: "邮箱已验证",
  };
  return labels[value ?? ""] ?? value ?? "安全事件";
}

function formatDateTime(value?: string | null): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}
