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
import { AdminPageHeader, AdminPageLoading } from "@/components/admin-page-header";
import { GlassSelect } from "@/components/glass-select";
import { useLanguage } from "@/components/language-provider";
import { PasswordInput } from "@/components/password-input";
import { type AuthUser, getMe, isAuthExpiredError } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { localizedPath } from "@/lib/i18n";
import { isSiteManager } from "@/lib/user-permissions";
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
  const { locale, phrase } = useLanguage();
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
      router.replace(localizedPath("/login", locale));
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
          router.replace(localizedPath("/", locale));
          return;
        }
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : phrase("安全管理数据读取失败。", "Could not load security management data."),
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
  }, [locale, phrase, router]);

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
            router.replace(localizedPath("/", locale));
            return;
          }
          if (active) {
            setError(
              loadError instanceof Error ? loadError.message : phrase("记录读取失败。", "Could not load records."),
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
  }, [accessToken, locale, page, phrase, router, search, status, tab, user]);

  const canEdit = user?.isSuperAdmin ?? false;
  const lastUpdated = config?.updatedAt
    ? formatDateTime(config.updatedAt, locale)
    : phrase("尚未记录", "Not recorded");

  function updateDraft<K extends keyof SecurityAdminConfig>(
    key: K,
    value: SecurityAdminConfig[K],
  ) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
  }

  function updateMailServiceEnabled(checked: boolean) {
    setDraft((current) =>
      current
        ? {
            ...current,
            smtpEnabled: checked,
            ...(!checked
              ? {
                  registrationEmailVerificationEnabled: false,
                  passwordRecoveryEnabled: false,
                  untrustedDeviceEmailVerificationEnabled: false,
                  turnstileRecoveryEnabled: false,
                }
              : {}),
          }
        : current,
    );
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
        untrustedDeviceEmailVerificationEnabled:
          draft.untrustedDeviceEmailVerificationEnabled,
        turnstileSiteKey: draft.turnstileSiteKey,
        turnstileRegistrationEnabled: draft.turnstileRegistrationEnabled,
        turnstileLoginEnabled: draft.turnstileLoginEnabled,
        turnstileRecoveryEnabled: draft.turnstileRecoveryEnabled,
        loginFailureTurnstileThreshold: draft.loginFailureTurnstileThreshold,
        ...(draft.smtpPassword ? { smtpPassword: draft.smtpPassword } : {}),
        ...(draft.turnstileSecret
          ? { turnstileSecret: draft.turnstileSecret }
          : {}),
      };
      const saved = await updateSecurityAdminConfig(accessToken, update);
      setConfig(saved);
      setDraft({ ...saved, smtpPassword: "", turnstileSecret: "" });
      setNotice(phrase("账号安全配置已保存。", "Account security settings saved."));
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : phrase("安全配置保存失败。", "Could not save security settings."),
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
      setNotice(result.message || phrase("SMTP 连接测试成功。", "SMTP connection test passed."));
    } catch (testError) {
      setError(
        testError instanceof Error ? testError.message : phrase("SMTP 连接测试失败。", "SMTP connection test failed."),
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

  if (isLoading) return <AdminPageLoading className="security-admin-shell" loadingLabel={phrase("正在读取安全配置", "Loading security settings")} title={phrase("安全管理", "Security management")} />;

  if (!user || !canAccessSecurityAdmin(user)) {
    return (
      <section className="page-shell admin-shell security-admin-shell">
        <div className="search-page-empty">
          <strong>{phrase("无权访问", "Access denied")}</strong>
          <span>{phrase("安全管理仅超级管理员和管理员可查看。", "Only super administrators and administrators can view security management.")}</span>
        </div>
      </section>
    );
  }

  return (
    <section className="page-shell admin-shell security-admin-shell">
      <AdminPageHeader className="security-admin-head" description={`${canEdit ? phrase("超级管理员配置", "Super administrator settings") : phrase("管理员只读", "Administrator read-only")} · ${phrase("更新于", "Updated")} ${lastUpdated}`} title={phrase("安全管理", "Security management")} actions={<span className={config?.encryptionConfigured ? "ready" : "warning"}>
          {config?.encryptionConfigured ? phrase("凭据加密可用", "Credential encryption available") : phrase("凭据加密未配置", "Credential encryption is not configured")}
        </span>} />

      {draft ? (
        <form className="security-config-grid" onSubmit={handleSave}>
          <section className="security-config-panel">
            <div className="security-config-heading">
              <div>
                <Mail aria-hidden="true" size={17} />
                <strong>{phrase("SMTP 邮件", "SMTP mail")}</strong>
              </div>
              <ToggleField
                checked={draft.smtpEnabled}
                disabled={!canEdit}
                label={phrase("启用邮件服务", "Enable mail service")}
                onChange={updateMailServiceEnabled}
              />
            </div>
            <div className="security-form-grid">
              <Field label={phrase("SMTP 主机", "SMTP host")}>
                <input
                  disabled={!canEdit}
                  onChange={(event) =>
                    updateDraft("smtpHost", event.target.value)
                  }
                  value={draft.smtpHost}
                />
              </Field>
              <Field label={phrase("端口", "Port")}>
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
              <Field label={phrase("账号", "Account")}>
                <input
                  autoComplete="off"
                  disabled={!canEdit}
                  onChange={(event) =>
                    updateDraft("smtpUsername", event.target.value)
                  }
                  value={draft.smtpUsername}
                />
              </Field>
              <Field label={phrase("密码", "Password")}>
                <PasswordInput
                  autoComplete="new-password"
                  disabled={!canEdit}
                  onChange={(event) =>
                    updateDraft("smtpPassword", event.target.value)
                  }
                  placeholder={
                    draft.smtpPasswordConfigured
                      ? phrase("已配置，留空保持不变", "Configured. Leave blank to keep it unchanged.")
                      : phrase("输入 SMTP 密码", "Enter SMTP password")
                  }
                  value={draft.smtpPassword ?? ""}
                />
              </Field>
              <Field label={phrase("发件名称", "Sender name")}>
                <input
                  disabled={!canEdit}
                  onChange={(event) =>
                    updateDraft("smtpFromName", event.target.value)
                  }
                  value={draft.smtpFromName}
                />
              </Field>
              <Field label={phrase("发件邮箱", "Sender email")}>
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
              label={phrase("使用 TLS 安全连接", "Use TLS")}
              onChange={(checked) => updateDraft("smtpSecure", checked)}
            />
          </section>

          <section className="security-config-panel">
            <div className="security-config-heading">
              <div>
                <ShieldCheck aria-hidden="true" size={17} />
                <strong>{phrase("验证策略", "Verification policy")}</strong>
              </div>
            </div>
            <div className="security-policy-toggles">
              <ToggleField
                checked={draft.registrationEmailVerificationEnabled}
                disabled={!canEdit || !draft.smtpEnabled}
                label={phrase("注册邮箱验证", "Verify email on registration")}
                onChange={(checked) =>
                  updateDraft("registrationEmailVerificationEnabled", checked)
                }
              />
              <ToggleField
                checked={draft.passwordRecoveryEnabled}
                disabled={!canEdit || !draft.smtpEnabled}
                label={phrase("密码找回", "Password recovery")}
                onChange={(checked) =>
                  updateDraft("passwordRecoveryEnabled", checked)
                }
              />
              <ToggleField
                checked={draft.untrustedDeviceEmailVerificationEnabled}
                disabled={!canEdit || !draft.smtpEnabled}
                label={phrase("非信任设备邮箱验证", "Email verification for untrusted devices")}
                onChange={(checked) =>
                  updateDraft(
                    "untrustedDeviceEmailVerificationEnabled",
                    checked,
                  )
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
                      ? phrase("已配置，留空保持不变", "Configured. Leave blank to keep it unchanged")
                      : phrase("输入 Secret Key", "Enter Secret Key")
                  }
                  value={draft.turnstileSecret ?? ""}
                />
              </Field>
              <Field label={phrase("失败触发次数", "Failure threshold")}>
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
                label={phrase("注册", "Registration")}
                onChange={(checked) =>
                  updateDraft("turnstileRegistrationEnabled", checked)
                }
              />
              <ToggleField
                checked={draft.turnstileLoginEnabled}
                disabled={!canEdit}
                label={phrase("登录失败", "Sign-in failures")}
                onChange={(checked) =>
                  updateDraft("turnstileLoginEnabled", checked)
                }
              />
              <ToggleField
                checked={draft.turnstileRecoveryEnabled}
                disabled={!canEdit || !draft.smtpEnabled}
                label={phrase("密码找回", "Password recovery")}
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
                {isTesting ? phrase("测试中", "Testing") : phrase("测试连接", "Test connection")}
              </button>
              <button className="button" disabled={isSaving} type="submit">
                <Save aria-hidden="true" size={15} />
                {isSaving ? phrase("保存中", "Saving") : phrase("保存配置", "Save settings")}
              </button>
            </div>
          ) : null}
        </form>
      ) : null}

      <section className="security-records-panel">
        <div className="security-records-head">
          <nav aria-label={phrase("安全记录类型", "Security record type")} className="security-admin-tabs">
            {tabOptions.map(({ value, Icon }) => (
              <button
                aria-selected={tab === value}
                className={tab === value ? "active" : ""}
                key={value}
                onClick={() => selectTab(value)}
                role="tab"
                type="button"
              >
                <Icon aria-hidden="true" size={15} />
                {securityTabLabel(value, phrase)}
              </button>
            ))}
          </nav>
          <span>{phrase(`${total} 条记录`, `${total} records`)}</span>
        </div>

        <div className="security-record-filters">
          <label className="security-record-search">
            <Search aria-hidden="true" size={15} />
            <input
              aria-label={phrase("搜索安全记录", "Search security records")}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder={searchPlaceholder(tab, phrase)}
              type="search"
              value={searchDraft}
            />
          </label>
          <GlassSelect
            ariaLabel={phrase("记录状态", "Record status")}
            onChange={(value) => {
              setPage(1);
              setStatus(value);
            }}
            options={statusOptions[tab].map(([value]) => ({ value, label: securityStatusLabel(value, phrase) }))}
            value={status}
          />
        </div>

        <div className="admin-table-wrap security-table-wrap">
          <SecurityTable isLoading={isListLoading} items={items} locale={locale} phrase={phrase} tab={tab} />
        </div>
        <nav aria-label={phrase("安全记录分页", "Security records pagination")} className="admin-pagination">
          <span>
            {phrase(`第 ${page} / ${totalPages} 页`, `Page ${page} / ${totalPages}`)}
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

function Field({
  children,
  label,
}: {
  children: React.ReactNode;
  label: string;
}) {
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
  locale,
  phrase,
  tab,
}: {
  isLoading: boolean;
  items: SecurityAdminOverviewItem[];
  locale: "zh-CN" | "en-US";
  phrase: (chinese: string, english: string) => string;
  tab: SecurityAdminTab;
}) {
  const columnCount = tab === "risk-events" ? 5 : 6;
  return (
    <table className="admin-table security-admin-table">
      <thead>
        {tab === "mail-jobs" ? (
          <tr>
            <th>{phrase("创建时间", "Created")}</th>
            <th>{phrase("收件人", "Recipient")}</th>
            <th>{phrase("类型", "Type")}</th>
            <th>{phrase("主题", "Subject")}</th>
            <th>{phrase("状态", "Status")}</th>
            <th>{phrase("发送结果", "Delivery result")}</th>
          </tr>
        ) : tab === "verification-codes" ? (
          <tr>
            <th>{phrase("创建时间", "Created")}</th>
            <th>{phrase("邮箱", "Email")}</th>
            <th>{phrase("用途", "Purpose")}</th>
            <th>{phrase("状态", "Status")}</th>
            <th>{phrase("尝试次数", "Attempts")}</th>
            <th>{phrase("有效时间", "Expires")}</th>
          </tr>
        ) : (
          <tr>
            <th>{phrase("发生时间", "Time")}</th>
            <th>{phrase("用户", "User")}</th>
            <th>{phrase("事件", "Event")}</th>
            <th>{phrase("风险", "Risk")}</th>
            <th>{phrase("来源", "Source")}</th>
          </tr>
        )}
      </thead>
      <tbody>
        {isLoading ? (
          <tr>
            <td className="admin-table-state" colSpan={columnCount}>
              {phrase("正在读取安全记录", "Loading security records")}
            </td>
          </tr>
        ) : !items.length ? (
          <tr>
            <td className="admin-table-state" colSpan={columnCount}>
              {phrase("暂无匹配记录", "No matching records")}
            </td>
          </tr>
        ) : (
          items.map((item) => (
            <SecurityRecordRow item={item} key={item.id} locale={locale} phrase={phrase} tab={tab} />
          ))
        )}
      </tbody>
    </table>
  );
}

function SecurityRecordRow({
  item,
  locale,
  phrase,
  tab,
}: {
  item: SecurityAdminOverviewItem;
  locale: "zh-CN" | "en-US";
  phrase: (chinese: string, english: string) => string;
  tab: SecurityAdminTab;
}) {
  if (tab === "mail-jobs") {
    return (
      <tr>
        <td>{formatDateTime(item.createdAt, locale)}</td>
        <td>{item.recipient || item.email || "-"}</td>
        <td>{mailTypeLabel(item.type, phrase)}</td>
        <td className="security-table-summary">{item.subject || "-"}</td>
        <td>
          <StatusBadge phrase={phrase} value={item.status} />
        </td>
        <td>
          <strong>
            {item.sentAt
              ? formatDateTime(item.sentAt, locale)
              : phrase(`${item.attempts ?? 0} 次尝试`, `${item.attempts ?? 0} attempts`)}
          </strong>
          {item.lastError ? <small>{item.lastError}</small> : null}
        </td>
      </tr>
    );
  }

  if (tab === "verification-codes") {
    return (
      <tr>
        <td>{formatDateTime(item.createdAt, locale)}</td>
        <td>{item.email || "-"}</td>
        <td>{purposeLabel(item.purpose, phrase)}</td>
        <td>
          <StatusBadge phrase={phrase} value={item.status} />
        </td>
        <td>{item.attempts ?? 0}</td>
        <td>
          <strong>{formatDateTime(item.expiresAt, locale)}</strong>
          {item.verifiedAt || item.consumedAt ? (
            <small>
              {phrase("完成于", "Completed")} {formatDateTime(item.consumedAt || item.verifiedAt, locale)}
            </small>
          ) : null}
        </td>
      </tr>
    );
  }

  return (
    <tr>
      <td>{formatDateTime(item.createdAt, locale)}</td>
      <td>
        <strong>{item.user?.nickname || phrase("未知用户", "Unknown user")}</strong>
        <small>{item.user?.username ? `@${item.user.username}` : ""}</small>
      </td>
      <td className="security-table-summary">
        <strong>{securityTypeLabel(item.type, phrase)}</strong>
      </td>
      <td>
        <StatusBadge phrase={phrase} value={item.riskLevel} />
      </td>
      <td>
        <strong>{item.deviceLabel || phrase("未知设备", "Unknown device")}</strong>
        <small>{item.ip || phrase("IP 未记录", "IP not recorded")}</small>
      </td>
    </tr>
  );
}

function StatusBadge({ phrase, value = "unknown" }: { phrase: (chinese: string, english: string) => string; value?: string }) {
  return (
    <span className={`security-status-badge ${value}`}>
      {securityStatusLabel(value, phrase)}
    </span>
  );
}

function canAccessSecurityAdmin(user: AuthUser): boolean {
  return isSiteManager(user);
}

function securityTabLabel(tab: SecurityAdminTab, phrase: (chinese: string, english: string) => string): string {
  if (tab === "mail-jobs") return phrase("邮件任务", "Mail jobs");
  if (tab === "verification-codes") return phrase("验证码", "Verification codes");
  return phrase("风险事件", "Risk events");
}

function searchPlaceholder(tab: SecurityAdminTab, phrase: (chinese: string, english: string) => string): string {
  if (tab === "mail-jobs") return phrase("收件人、主题或错误", "Recipient, subject, or error");
  if (tab === "verification-codes") return phrase("邮箱或 IP", "Email or IP");
  return phrase("用户、事件、设备或 IP", "User, event, device, or IP");
}

function securityStatusLabel(value: string, phrase: (chinese: string, english: string) => string): string {
  const labels: Record<string, [string, string]> = {
    "": ["全部状态", "All statuses"],
    pending: ["待处理", "Pending"],
    sending: ["发送中", "Sending"],
    sent: ["已发送", "Sent"],
    failed: ["失败", "Failed"],
    verified: ["已验证", "Verified"],
    consumed: ["已使用", "Used"],
    expired: ["已过期", "Expired"],
    info: ["信息", "Info"],
    low: ["低风险", "Low risk"],
    medium: ["中风险", "Medium risk"],
    high: ["高风险", "High risk"],
  };
  const label = labels[value];
  return label ? phrase(label[0], label[1]) : value;
}

function mailTypeLabel(value: string | undefined, phrase: (chinese: string, english: string) => string): string {
  const labels: Record<string, [string, string]> = {
    registration_verification: ["注册验证", "Registration verification"],
    account_email_verification: ["邮箱验证", "Email verification"],
    password_reset: ["密码找回", "Password recovery"],
    login_risk: ["登录风险", "Sign-in risk"],
    security_notice: ["安全通知", "Security notice"],
  };
  const label = labels[value ?? ""];
  return label ? phrase(label[0], label[1]) : value ?? "-";
}

function purposeLabel(value: string | undefined, phrase: (chinese: string, english: string) => string): string {
  return value === "registration"
    ? phrase("注册验证", "Registration verification")
    : value === "account_email"
      ? phrase("账号邮箱", "Account email")
      : value || "-";
}

function securityTypeLabel(value: string | undefined, phrase: (chinese: string, english: string) => string): string {
  const labels: Record<string, [string, string]> = {
    login_success: ["登录成功", "Sign-in succeeded"],
    new_device: ["新设备登录", "New device sign-in"],
    new_ip: ["陌生 IP 登录", "New IP sign-in"],
    unusual_frequency: ["异常登录频率", "Unusual sign-in frequency"],
    login_blocked: ["登录已限制", "Sign-in restricted"],
    password_reset: ["密码已重置", "Password reset"],
    password_changed: ["密码已修改", "Password changed"],
    email_verified: ["邮箱已验证", "Email verified"],
  };
  const label = labels[value ?? ""];
  return label ? phrase(label[0], label[1]) : value ?? phrase("安全事件", "Security event");
}

function formatDateTime(value: string | null | undefined, locale: "zh-CN" | "en-US"): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}
