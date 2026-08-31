"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeftRight, Download, KeyRound, ShieldCheck, Trash2, UserRoundX } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { AppToast } from "@/components/app-toast";
import { PasswordInput } from "@/components/password-input";
import { OtpCodeInput } from "@/components/otp-code-input";
import { useLanguage } from "@/components/language-provider";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { isAuthExpiredError } from "@/lib/auth-api";
import { localizedPath } from "@/lib/i18n";
import { beginTotpEnrollment, cancelAccountDeletion, confirmTotp, disableTotp, disableTotpWithEmail, downloadDataExport, getAccountPrivacyOverview, getDataExport, listPrivacyAudit, requestAccountDeletion, requestDataExport, requestTotpDisableEmailVerification, type AccountPrivacyOverview, type ExportJob } from "@/lib/account-privacy-api";
import { unblockFriendship } from "@/lib/social-api";

export default function AccountPrivacyPage() {
  const router = useRouter();
  const { locale, phrase } = useLanguage();
  const [token, setToken] = useState<string | null>(null);
  const [overview, setOverview] = useState<AccountPrivacyOverview | null>(null);
  const [audit, setAudit] = useState<Array<{ id: number; action: string; metadata: unknown; createdAt: string }>>([]);
  const [exportJob, setExportJob] = useState<ExportJob | null>(null);
  const [deletionPassword, setDeletionPassword] = useState("");
  const [deletionOpen, setDeletionOpen] = useState(false);
  const [totpCode, setTotpCode] = useState("");
  const [totpDisableMethod, setTotpDisableMethod] = useState<"idle" | "authenticator" | "email">("idle");
  const [totpDisableEntry, setTotpDisableEntry] = useState<"otp" | "recovery">("otp");
  const [totpDisableCooldown, setTotpDisableCooldown] = useState(0);
  const [totpSecret, setTotpSecret] = useState("");
  const [totpUri, setTotpUri] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState("");

  useEffect(() => {
    const currentToken = readAccessToken();
    if (!currentToken) {
      router.replace(localizedPath("/login", locale));
      return;
    }
    const tokenTimer = window.setTimeout(() => {
      setToken(currentToken);
      void load(currentToken);
    }, 0);
    return () => window.clearTimeout(tokenTimer);
  }, [locale, router]);

  useEffect(() => {
    if (!token || !exportJob || !["queued", "processing"].includes(exportJob.status)) return;
    const timer = window.setInterval(() => {
      void getDataExport(token, exportJob.id).then(setExportJob).catch(showError);
    }, 1600);
    return () => window.clearInterval(timer);
  }, [exportJob, token]);

  useEffect(() => {
    if (totpDisableCooldown <= 0) return;
    const timer = window.setInterval(() => setTotpDisableCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [totpDisableCooldown]);

  async function load(currentToken: string) {
    try {
      const [nextOverview, nextAudit] = await Promise.all([getAccountPrivacyOverview(currentToken), listPrivacyAudit(currentToken)]);
      setOverview(nextOverview);
      setAudit(nextAudit);
    } catch (loadError) {
      handleAuthError(loadError);
    }
  }

  function showError(loadError: unknown) {
    if (isAuthExpiredError(loadError)) {
      clearAuthTokens();
      router.replace(localizedPath("/", locale));
      return;
    }
    setError(loadError instanceof Error ? loadError.message : phrase("操作失败。", "The operation failed."));
  }

  function handleAuthError(loadError: unknown) {
    showError(loadError);
  }

  async function run(action: string, task: () => Promise<void>) {
    setBusy(action);
    setError("");
    setNotice("");
    try {
      await task();
    } catch (taskError) {
      showError(taskError);
    } finally {
      setBusy("");
    }
  }

  async function handleExport() {
    if (!token) return;
    await run("export", async () => {
      const job = await requestDataExport(token);
      setExportJob(job);
      setNotice(phrase("数据导出任务已创建，完成后可下载。", "The data export is being prepared. You can download it when ready."));
    });
  }

  async function handleDownload() {
    if (!token || !exportJob) return;
    await run("download", async () => {
      const blob = await downloadDataExport(token, exportJob.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `lingxi-data-export-${exportJob.id}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setNotice(phrase("导出文件已下载。", "The export file was downloaded."));
    });
  }

  async function handleDeletion() {
    if (!token || !deletionPassword) return;
    await run("delete", async () => {
      await requestAccountDeletion(token, deletionPassword);
      setDeletionPassword("");
      setDeletionOpen(false);
      await load(token);
      setNotice(phrase("账号已进入 7 天注销冷静期，可在此期间撤回。", "Your account entered a 7-day deletion cooling-off period. You can cancel it during this period."));
    });
  }

  async function handleCancelDeletion() {
    if (!token) return;
    await run("cancel-delete", async () => {
      await cancelAccountDeletion(token);
      await load(token);
      setNotice(phrase("注销申请已撤回。", "The deletion request was cancelled."));
    });
  }

  async function handleEnroll() {
    if (!token) return;
    await run("enroll", async () => {
      const result = await beginTotpEnrollment(token);
      setTotpSecret(result.secret);
      setTotpUri(result.otpAuthUri);
      setNotice(phrase("请将密钥添加到身份验证器后输入验证码确认。", "Add the secret to your authenticator, then enter a code to confirm."));
    });
  }

  async function handleConfirmTotp() {
    if (!token || !totpCode) return;
    await run("confirm-totp", async () => {
      const result = await confirmTotp(token, totpCode);
      setRecoveryCodes(result.recoveryCodes);
      setTotpCode("");
      setTotpSecret("");
      setTotpUri("");
      await load(token);
      setNotice(phrase("双因素认证已启用，请保存恢复码。", "Two-factor authentication is enabled. Save your recovery codes."));
    });
  }

  async function handleDisableTotp() {
    if (!token || !totpCode) return;
    await run("disable-totp", async () => {
      await disableTotp(token, totpCode);
      setTotpCode("");
      setTotpDisableMethod("idle");
      setTotpDisableEntry("otp");
      await load(token);
      setNotice(phrase("双因素认证已关闭。", "Two-factor authentication is disabled."));
    });
  }

  async function handleSwitchTotpDisableMethod() {
    if (!token || busy || totpDisableCooldown > 0) return;
    if (totpDisableMethod === "email") {
      setTotpCode("");
      setTotpDisableEntry("otp");
      setTotpDisableMethod("authenticator");
      setTotpDisableCooldown(60);
      return;
    }
    await run("send-disable-totp-email", async () => {
      await requestTotpDisableEmailVerification(token);
      setTotpCode("");
      setTotpDisableEntry("otp");
      setTotpDisableMethod("email");
      setTotpDisableCooldown(60);
      setNotice(phrase("解除验证码已发送至你的邮箱。", "A removal code was sent to your email."));
    });
  }

  async function handleDisableTotpWithEmail() {
    if (!token || !totpCode) return;
    await run("disable-totp-email", async () => {
      await disableTotpWithEmail(token, totpCode);
      setTotpCode("");
      setTotpDisableMethod("idle");
      setTotpDisableEntry("otp");
      await load(token);
      setNotice(phrase("双因素认证已关闭。", "Two-factor authentication is disabled."));
    });
  }

  async function handleUnblock(friendshipId: number) {
    if (!token) return;
    await run(`unblock-${friendshipId}`, async () => {
      await unblockFriendship(token, friendshipId);
      await load(token);
    });
  }

  const actionLabel: Record<string, [string, string]> = {
    privacy_overview_viewed: ["查看隐私设置", "Viewed privacy settings"],
    data_export_requested: ["申请数据导出", "Requested data export"],
    data_export_completed: ["生成数据导出", "Generated data export"],
    data_export_downloaded: ["下载数据导出", "Downloaded data export"],
    account_deletion_requested: ["申请注销账号", "Requested account deletion"],
    account_deletion_cancelled: ["撤回注销申请", "Cancelled account deletion"],
    account_deleted: ["完成账号注销", "Completed account deletion"],
    totp_enrollment_started: ["开始绑定双因素认证", "Started two-factor enrollment"],
    totp_enabled: ["启用双因素认证", "Enabled two-factor authentication"],
    totp_disabled: ["关闭双因素认证", "Disabled two-factor authentication"],
    totp_disabled_by_email: ["通过邮箱关闭双因素认证", "Disabled two-factor authentication by email"],
    totp_reset_by_super_admin: ["超级管理员已解除双因素认证", "Two-factor authentication was reset by the super administrator"],
    totp_reset_for_user: ["为用户解除双因素认证", "Reset two-factor authentication for a user"],
  };

  if (!overview)
    return (
      <section className="page-shell profile-page">
        <div className="status-row compact-status-row">
          <span className="status">{phrase("正在读取隐私设置", "Loading privacy settings")}</span>
        </div>
      </section>
    );

  return (
    <section className="page-shell profile-page account-privacy-page">
      <header className="privacy-page-header">
        <div>
          <span className="section-label">{phrase("账号控制", "Account controls")}</span>
          <h1>{phrase("隐私与数据", "Privacy and data")}</h1>
          <p>{phrase("管理数据导出、账号生命周期、登录保护和屏蔽关系。", "Manage exports, account lifecycle, sign-in protection, and blocked relationships.")}</p>
        </div>
      </header>
      <div className="privacy-grid">
        <section className="profile-panel privacy-card">
          <div className="privacy-card-heading">
            <Download size={18} />
            <div>
              <h2>{phrase("数据导出", "Data export")}</h2>
              <p>{phrase("导出个人资料、文章、评论、收藏、订阅、积分和登录记录。", "Export your profile, articles, comments, favorites, subscriptions, points, and login records.")}</p>
            </div>
          </div>
          <button className="button" disabled={busy !== "" || Boolean(exportJob && ["queued", "processing"].includes(exportJob.status))} onClick={() => void handleExport()} type="button">
            {busy === "export" ? phrase("生成中", "Preparing") : phrase("申请导出", "Request export")}
          </button>
          {exportJob ? (
            <div className="privacy-job-status">
              <span>
                {phrase("任务状态", "Job status")}: {exportJob.status}
              </span>
              {exportJob.status === "completed" ? (
                <button className="text-action" disabled={busy !== ""} onClick={() => void handleDownload()} type="button">
                  <Download size={15} />
                  {phrase("下载 JSON", "Download JSON")}
                </button>
              ) : null}
              <small>
                {phrase("有效期至", "Expires")}:{" "}
                {new Intl.DateTimeFormat(locale, {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(exportJob.expiresAt))}
              </small>
            </div>
          ) : null}
        </section>
        <section className="profile-panel privacy-card">
          <div className="privacy-card-heading">
            <Trash2 size={18} />
            <div>
              <h2>{phrase("注销账号", "Delete account")}</h2>
              <p>{phrase("注销会保留公开内容并匿名显示；7 天冷静期后完成账号清理。", "Public content is retained and shown anonymously; account cleanup completes after a 7-day cooling-off period.")}</p>
            </div>
          </div>
          {overview.deletion.pending ? (
            <>
              <p className="privacy-warning">{phrase(`计划于 ${new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(overview.deletion.scheduledAt!))} 清理`, `Scheduled for cleanup on ${new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(overview.deletion.scheduledAt!))}`)}</p>
              <button className="button secondary" disabled={busy !== ""} onClick={() => void handleCancelDeletion()} type="button">
                {busy === "cancel-delete" ? phrase("处理中", "Working") : phrase("撤回注销申请", "Cancel deletion")}
              </button>
            </>
          ) : (
            deletionOpen ? (
              <div className="privacy-deletion-form">
                <PasswordInput autoComplete="current-password" className="privacy-password-input" disabled={busy !== ""} onChange={(event) => setDeletionPassword(event.target.value)} placeholder={phrase("输入当前密码确认", "Enter your current password to confirm")} value={deletionPassword} />
                <div className="privacy-deletion-actions">
                  <button className="button danger" disabled={busy !== "" || !deletionPassword} onClick={() => void handleDeletion()} type="button">
                    {phrase("确定", "Confirm")}
                  </button>
                  <button className="button secondary" disabled={busy !== ""} onClick={() => { setDeletionPassword(""); setDeletionOpen(false); }} type="button">
                    {phrase("取消", "Cancel")}
                  </button>
                </div>
              </div>
            ) : (
              <button className="button danger" disabled={busy !== ""} onClick={() => setDeletionOpen(true)} type="button">
                {phrase("申请注销", "Request deletion")}
              </button>
            )
          )}
        </section>
        <section className="profile-panel privacy-card">
          <div className="privacy-card-heading">
            <KeyRound size={18} />
            <div>
              <h2>{phrase("双因素认证", "Two-factor authentication")}</h2>
              <p>{phrase("使用身份验证器验证码保护登录，恢复码仅显示一次。", "Protect sign-in with an authenticator code. Recovery codes are shown once.")}</p>
            </div>
          </div>
          {overview.totp.enabled ? (
            totpDisableMethod === "idle" ? (
              <button
                className="button secondary"
                disabled={busy !== ""}
                onClick={() => {
                  setTotpCode("");
                  setTotpDisableEntry("otp");
                  setTotpDisableMethod("authenticator");
                }}
                type="button"
              >
                {phrase("解除双因素认证", "Remove 2FA")}
              </button>
            ) : (
              <div className="privacy-totp-disable">
                <div className="privacy-totp-code-row">
                  <div className="privacy-totp-code-field">
                    <span>{totpDisableEntry === "recovery" ? phrase("恢复码", "Recovery code") : totpDisableMethod === "email" ? phrase("邮箱验证码", "Email verification code") : phrase("身份验证器验证码", "Authenticator code")}</span>
                    {totpDisableEntry === "recovery" ? (
                      <input autoFocus inputMode="text" maxLength={12} onChange={(event) => setTotpCode(event.target.value.replace(/\s/g, "").slice(0, 12))} placeholder={phrase("输入恢复码", "Enter recovery code")} value={totpCode} />
                    ) : (
                      <OtpCodeInput
                        ariaLabel={totpDisableMethod === "email" ? phrase("邮箱验证码", "Email verification code") : phrase("身份验证器验证码", "Authenticator code")}
                        autoFocus
                        disabled={busy !== ""}
                        onChange={setTotpCode}
                        value={totpCode}
                      />
                    )}
                  </div>
                  <button
                    aria-label={totpDisableCooldown > 0 ? phrase(`${totpDisableCooldown} 秒后可切换验证方式`, `Switch verification method in ${totpDisableCooldown} seconds`) : phrase("切换验证方式", "Switch verification method")}
                    className="table-icon-action privacy-totp-switch"
                    disabled={busy !== "" || totpDisableCooldown > 0}
                    onClick={() => void handleSwitchTotpDisableMethod()}
                    title={totpDisableCooldown > 0 ? phrase(`${totpDisableCooldown} 秒后可切换验证方式`, `Switch verification method in ${totpDisableCooldown} seconds`) : phrase("切换验证方式", "Switch verification method")}
                    type="button"
                  >
                    <ArrowLeftRight aria-hidden="true" size={16} />
                  </button>
                </div>
                {totpDisableEntry === "otp" && totpDisableMethod === "authenticator" ? (
                  <button className="text-action privacy-recovery-toggle" disabled={busy !== ""} onClick={() => { setTotpCode(""); setTotpDisableEntry("recovery"); }} type="button">
                    {phrase("使用恢复码", "Use recovery code")}
                  </button>
                ) : null}
                <div className="privacy-totp-actions">
                  <button className="button" disabled={busy !== "" || (totpDisableEntry === "otp" ? !/^\d{6}$/.test(totpCode) : !totpCode.trim())} onClick={() => void (totpDisableMethod === "email" ? handleDisableTotpWithEmail() : handleDisableTotp())} type="button">
                    {phrase("确定", "Confirm")}
                  </button>
                  <button className="button secondary" disabled={busy !== ""} onClick={() => { setTotpCode(""); setTotpDisableEntry("otp"); setTotpDisableMethod("idle"); }} type="button">
                    {phrase("取消", "Cancel")}
                  </button>
                </div>
              </div>
            )
          ) : totpSecret ? (
            <>
              <div className="privacy-totp-enrollment">
                <div aria-label={phrase("使用身份验证器扫描二维码", "Scan this QR code with your authenticator")} className="privacy-qr-code">
                  <QRCodeSVG bgColor="transparent" fgColor="currentColor" includeMargin size={168} value={totpUri} />
                </div>
                <div className="privacy-totp-details">
                  <span>{phrase("使用 Google Authenticator 或其他身份验证器扫描，或手动输入密钥。", "Scan with Google Authenticator or another authenticator, or enter the secret manually.")}</span>
                  <code className="privacy-secret">{totpSecret}</code>
                  <small className="privacy-uri">{totpUri}</small>
                </div>
              </div>
              <div className="privacy-inline-field">
                <span>{phrase("身份验证器验证码", "Authenticator code")}</span>
                <OtpCodeInput ariaLabel={phrase("身份验证器验证码", "Authenticator code")} autoFocus onChange={setTotpCode} value={totpCode} />
              </div>
              <button className="button" disabled={busy !== "" || totpCode.length !== 6} onClick={() => void handleConfirmTotp()} type="button">
                {phrase("确认并启用", "Confirm and enable")}
              </button>
            </>
          ) : (
            <button className="button" disabled={busy !== ""} onClick={() => void handleEnroll()} type="button">
              {phrase("开始绑定", "Start enrollment")}
            </button>
          )}
          {recoveryCodes.length ? (
            <div className="privacy-recovery-codes">
              <strong>{phrase("恢复码，请立即保存", "Recovery codes, save them now")}</strong>
              <code>{recoveryCodes.join("  ")}</code>
            </div>
          ) : null}
        </section>
        <section className="profile-panel privacy-card">
          <div className="privacy-card-heading">
            <UserRoundX size={18} />
            <div>
              <h2>{phrase("屏蔽关系", "Blocked users")}</h2>
              <p>{phrase("被屏蔽的用户不会出现在发现、搜索、推荐和消息关系中。", "Blocked users are filtered from discovery, search, recommendations, and messaging relationships.")}</p>
            </div>
          </div>
          {overview.blocked.length ? (
            overview.blocked.map((item) => (
              <div className="privacy-blocked-row" key={item.friendshipId}>
                <span>{item.user.nickname || item.user.username}</span>
                <button aria-label={phrase("解除屏蔽", "Unblock user")} className="table-icon-action" disabled={busy !== ""} onClick={() => void handleUnblock(item.friendshipId)} title={phrase("解除屏蔽", "Unblock user")} type="button">
                  <ShieldCheck size={16} />
                </button>
              </div>
            ))
          ) : (
            <p className="privacy-empty">{phrase("暂无屏蔽用户。", "No blocked users.")}</p>
          )}
        </section>
      </div>
      <section className="profile-panel privacy-audit-card">
        <div className="privacy-card-heading">
          <ShieldCheck size={18} />
          <div>
            <h2>{phrase("隐私与授权记录", "Privacy and authorization log")}</h2>
            <p>{phrase("这里记录导出、注销和登录保护设置变化。", "Export, deletion, and sign-in protection changes are recorded here.")}</p>
          </div>
        </div>
        <div className="privacy-audit-list">
          {audit.map((item) => (
            <div key={item.id}>
              <span>{phrase(...(actionLabel[item.action] ?? [item.action, item.action]))}</span>
              <time>
                {new Intl.DateTimeFormat(locale, {
                  dateStyle: "medium",
                  timeStyle: "short",
                }).format(new Date(item.createdAt))}
              </time>
            </div>
          ))}
        </div>
      </section>
      <AppToast
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
