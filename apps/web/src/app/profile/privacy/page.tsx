"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Download, Fingerprint, KeyRound, Mail, Pencil, ShieldCheck, Trash2, UserRoundX, X as XIcon } from "lucide-react";
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";
import { QRCodeSVG } from "qrcode.react";
import { AppToast } from "@/components/app-toast";
import { PasswordInput } from "@/components/password-input";
import { OtpCodeInput } from "@/components/otp-code-input";
import { useLanguage } from "@/components/language-provider";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { deletePasskeyWithEmail, deletePasskeyWithPassword, deletePasskeyWithTotp, getPasskeyDeletionOptions, getPasskeyRegistrationOptions, getTotpDisablePasskeyOptions, isAuthExpiredError, listPasskeys, renamePasskey, requestPasskeyDeletionEmail, verifyPasskeyDeletion, verifyPasskeyRegistration, verifyTotpDisablePasskey, type PasskeySummary } from "@/lib/auth-api";
import { localizedPath } from "@/lib/i18n";
import { beginTotpEnrollment, cancelAccountDeletion, confirmTotp, disableTotp, disableTotpWithEmail, disableTotpWithPassword, downloadDataExport, getAccountPrivacyOverview, getDataExport, listPrivacyAudit, requestAccountDeletion, requestDataExport, requestTotpDisableEmailVerification, type AccountPrivacyOverview, type ExportJob } from "@/lib/account-privacy-api";
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
  const [totpSecret, setTotpSecret] = useState("");
  const [totpUri, setTotpUri] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [passkeys, setPasskeys] = useState<PasskeySummary[]>([]);
  const [passkeyName, setPasskeyName] = useState("");
  const [editingPasskeyId, setEditingPasskeyId] = useState<number | null>(null);
  const [editingPasskeyName, setEditingPasskeyName] = useState("");
  const [securityVerificationTarget, setSecurityVerificationTarget] = useState<"passkey" | "totp" | null>(null);
  const [securityVerificationStep, setSecurityVerificationStep] = useState<"choose" | "passkey" | "email" | "password" | "totp" | null>(null);
  const [securityVerificationId, setSecurityVerificationId] = useState<number | null>(null);
  const [securityVerificationCode, setSecurityVerificationCode] = useState("");
  const [securityVerificationPassword, setSecurityVerificationPassword] = useState("");
  const [securityVerificationEmailChallenge, setSecurityVerificationEmailChallenge] = useState("");
  const [securityVerificationEmailCooldown, setSecurityVerificationEmailCooldown] = useState(0);
  const securityVerificationSubmitRef = useRef(false);
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
    if (securityVerificationEmailCooldown <= 0) return;
    const timer = window.setInterval(() => setSecurityVerificationEmailCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [securityVerificationEmailCooldown]);

  async function load(currentToken: string) {
    try {
      const [nextOverview, nextAudit, nextPasskeys] = await Promise.all([getAccountPrivacyOverview(currentToken), listPrivacyAudit(currentToken), listPasskeys(currentToken)]);
      setOverview(nextOverview);
      setAudit(nextAudit);
      setPasskeys(nextPasskeys);
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

  async function handleRegisterPasskey() {
    if (!token) return;
    await run("register-passkey", async () => {
      const challenge = await getPasskeyRegistrationOptions(token);
      let response;
      try {
        response = await startRegistration({ optionsJSON: challenge.options });
      } catch (registrationError) {
        if (isPasskeyCancellation(registrationError)) {
          setNotice(phrase("已取消添加通行密钥。", "Passkey enrollment was cancelled."));
          return;
        }
        throw registrationError;
      }
      await verifyPasskeyRegistration(token, {
        challengeToken: challenge.challengeToken,
        response,
        name: passkeyName.trim() || undefined,
      });
      setPasskeyName("");
      await load(token);
      setNotice(phrase("通行密钥已添加。", "Passkey added."));
    });
  }

  async function handleRenamePasskey(id: number) {
    if (!token || !editingPasskeyName.trim()) return;
    await run(`rename-passkey-${id}`, async () => {
      await renamePasskey(token, id, editingPasskeyName);
      setEditingPasskeyId(null);
      setEditingPasskeyName("");
      await load(token);
      setNotice(phrase("通行密钥名称已更新。", "Passkey name updated."));
    });
  }

  async function handleDeletePasskey(id: number) {
    if (!token) return;
    setError("");
    setNotice("");
    setSecurityVerificationTarget("passkey");
    setSecurityVerificationId(id);
    setSecurityVerificationStep("choose");
    setSecurityVerificationCode("");
    setSecurityVerificationPassword("");
    setSecurityVerificationEmailChallenge("");
    setSecurityVerificationEmailCooldown(0);
  }

  function openTotpDisable() {
    setError("");
    setNotice("");
    setSecurityVerificationTarget("totp");
    setSecurityVerificationId(null);
    setSecurityVerificationStep("choose");
    setSecurityVerificationCode("");
    setSecurityVerificationPassword("");
    setSecurityVerificationEmailChallenge("");
    setSecurityVerificationEmailCooldown(0);
  }

  function closeSecurityVerification() {
    setSecurityVerificationTarget(null);
    setSecurityVerificationStep(null);
    setSecurityVerificationId(null);
    setSecurityVerificationCode("");
    setSecurityVerificationPassword("");
    setSecurityVerificationEmailChallenge("");
    setSecurityVerificationEmailCooldown(0);
  }

  async function completeSecurityVerification() {
    if (!token) return;
    const target = securityVerificationTarget;
    closeSecurityVerification();
    await load(token);
    setNotice(target === "totp" ? phrase("双因素认证已关闭。", "Two-factor authentication is disabled.") : phrase("通行密钥已移除。", "Passkey removed."));
  }

  async function handleSelectSecurityVerificationMethod(method: "passkey" | "email" | "password" | "totp") {
    if (!token || !securityVerificationTarget || busy) return;
    const target = securityVerificationTarget;
    const passkeyId = securityVerificationId;
    setError("");
    setSecurityVerificationStep(method);
    setSecurityVerificationCode("");
    setSecurityVerificationPassword("");
    if (method === "passkey") {
      void handleVerifySecurityPasskey(target, passkeyId);
      return;
    }
    if (method === "email") {
      await run(`${target}-disable-email`, async () => {
        if (target === "passkey" && passkeyId !== null) {
          const result = await requestPasskeyDeletionEmail(token, passkeyId);
          setSecurityVerificationEmailChallenge(result.challengeToken);
          setSecurityVerificationEmailCooldown(result.retryAfterSeconds);
        } else {
          const result = await requestTotpDisableEmailVerification(token);
          setSecurityVerificationEmailCooldown(result.retryAfterSeconds);
        }
        setNotice(phrase("验证码已发送至你的邮箱。", "A verification code was sent to your email."));
      });
    }
  }

  async function handleVerifySecurityPasskey(target: "passkey" | "totp", passkeyId: number | null) {
    if (!token || securityVerificationSubmitRef.current) return;
    if (target === "passkey" && passkeyId === null) return;
    securityVerificationSubmitRef.current = true;
    await run(`${target}-disable-passkey`, async () => {
      const challenge = target === "passkey" && passkeyId !== null
        ? await getPasskeyDeletionOptions(token, passkeyId)
        : await getTotpDisablePasskeyOptions(token);
      let response;
      try {
        response = await startAuthentication({ optionsJSON: challenge.options });
      } catch (verificationError) {
        if (isPasskeyCancellation(verificationError)) {
          setNotice(phrase("已取消验证通行密钥。", "Passkey verification was cancelled."));
          return;
        }
        throw verificationError;
      }
      if (target === "passkey" && passkeyId !== null) {
        await verifyPasskeyDeletion(token, passkeyId, { challengeToken: challenge.challengeToken, response });
      } else {
        await verifyTotpDisablePasskey(token, { challengeToken: challenge.challengeToken, response });
      }
      await completeSecurityVerification();
    });
    securityVerificationSubmitRef.current = false;
  }

  async function handleVerifySecurityCode(method: "email" | "totp", code: string) {
    if (!token || !securityVerificationTarget || securityVerificationSubmitRef.current) return;
    if (method === "email" && securityVerificationTarget === "passkey" && !securityVerificationEmailChallenge) return;
    const target = securityVerificationTarget;
    const passkeyId = securityVerificationId;
    if (target === "passkey" && passkeyId === null) return;
    securityVerificationSubmitRef.current = true;
    await run(`${target}-disable-${method}`, async () => {
      if (target === "passkey" && passkeyId !== null) {
        if (method === "email") {
          await deletePasskeyWithEmail(token, passkeyId, securityVerificationEmailChallenge, code);
        } else {
          await deletePasskeyWithTotp(token, passkeyId, code);
        }
      } else {
        if (method === "email") {
          await disableTotpWithEmail(token, code);
        } else {
          await disableTotp(token, code);
        }
      }
      await completeSecurityVerification();
    });
    securityVerificationSubmitRef.current = false;
  }

  async function handleVerifySecurityPassword() {
    if (!token || !securityVerificationTarget || !securityVerificationPassword.trim()) return;
    const target = securityVerificationTarget;
    const passkeyId = securityVerificationId;
    if (target === "passkey" && passkeyId === null) return;
    await run(`${target}-disable-password`, async () => {
      if (target === "passkey" && passkeyId !== null) {
        await deletePasskeyWithPassword(token, passkeyId, securityVerificationPassword);
      } else {
        await disableTotpWithPassword(token, securityVerificationPassword);
      }
      await completeSecurityVerification();
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
            <Fingerprint size={18} />
            <div>
              <h2>{phrase("通行密钥", "Passkeys")}</h2>
              <p>
                {phrase(
                  "使用设备指纹、面容或安全密钥登录，无需输入密码。若账号启用了邮箱验证或双因素认证，仍会继续验证。",
                  "Sign in with your device, face, or security key without typing a password. Email and two-factor checks still apply when enabled.",
                )}
              </p>
            </div>
          </div>
          <div className="privacy-passkey-add">
            <input
              aria-label={phrase("通行密钥名称", "Passkey name")}
              maxLength={120}
              onChange={(event) => setPasskeyName(event.target.value)}
              placeholder={phrase("例如：工作电脑", "For example: Work laptop")}
              value={passkeyName}
            />
            <button
              className="button"
              disabled={busy !== ""}
              onClick={() => void handleRegisterPasskey()}
              type="button"
            >
              <Fingerprint size={16} />
              {busy === "register-passkey"
                ? phrase("绑定中", "Adding")
                : phrase("添加通行密钥", "Add passkey")}
            </button>
          </div>
          <div className="privacy-passkey-list">
            {passkeys.map((passkey) => (
              <div className="privacy-passkey-row" key={passkey.id}>
                {editingPasskeyId === passkey.id ? (
                  <input
                    aria-label={phrase("编辑通行密钥名称", "Edit passkey name")}
                    autoFocus
                    maxLength={120}
                    onChange={(event) =>
                      setEditingPasskeyName(event.target.value)
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter")
                        void handleRenamePasskey(passkey.id);
                      if (event.key === "Escape") setEditingPasskeyId(null);
                    }}
                    value={editingPasskeyName}
                  />
                ) : (
                  <span>
                    <strong>{passkey.name}</strong>
                    <small>
                      {phrase(
                        `添加于 ${new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(passkey.createdAt))}`,
                        `Added ${new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(passkey.createdAt))}`,
                      )}
                      {passkey.lastUsedAt
                        ? phrase(
                            ` · 最近使用 ${new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(passkey.lastUsedAt))}`,
                            ` · Last used ${new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(passkey.lastUsedAt))}`,
                          )
                        : ""}
                    </small>
                  </span>
                )}
                <div className="privacy-passkey-actions">
                  {editingPasskeyId === passkey.id ? (
                    <>
                      <button
                        aria-label={phrase(
                          "保存通行密钥名称",
                          "Save passkey name",
                        )}
                        className="table-icon-action"
                        disabled={busy !== "" || !editingPasskeyName.trim()}
                        onClick={() => void handleRenamePasskey(passkey.id)}
                        title={phrase("保存", "Save")}
                        type="button"
                      >
                        <ShieldCheck size={15} />
                      </button>
                      <button
                        aria-label={phrase(
                          "取消编辑通行密钥名称",
                          "Cancel passkey name edit",
                        )}
                        className="table-icon-action"
                        disabled={busy !== ""}
                        onClick={() => setEditingPasskeyId(null)}
                        title={phrase("取消", "Cancel")}
                        type="button"
                      >
                        <XIcon size={15} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        aria-label={phrase(
                          "编辑通行密钥名称",
                          "Edit passkey name",
                        )}
                        className="table-icon-action"
                        disabled={busy !== ""}
                        onClick={() => {
                          setEditingPasskeyId(passkey.id);
                          setEditingPasskeyName(passkey.name);
                        }}
                        title={phrase("编辑", "Edit")}
                        type="button"
                      >
                        <Pencil size={15} />
                      </button>
                      <button
                        aria-label={phrase("移除通行密钥", "Remove passkey")}
                        className="table-icon-action danger"
                        disabled={busy !== ""}
                        onClick={() => void handleDeletePasskey(passkey.id)}
                        title={phrase("移除", "Remove")}
                        type="button"
                      >
                        <Trash2 size={15} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
            {!passkeys.length ? (
              <p className="privacy-empty">
                {phrase(
                  "还没有绑定通行密钥。",
                  "No passkeys have been added yet.",
                )}
              </p>
            ) : null}
          </div>
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
            <button className="button secondary" disabled={busy !== ""} onClick={openTotpDisable} type="button">
              {phrase("解除双因素认证", "Remove 2FA")}
            </button>
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
      {securityVerificationStep && securityVerificationTarget ? (
        <div className="modal-backdrop passkey-delete-backdrop">
          <section aria-labelledby="passkey-delete-title" aria-modal="true" className="modal-panel passkey-delete-dialog" role="dialog">
            <header className="passkey-delete-heading">
              <div>
                <span className="section-label">{phrase("安全验证", "Security verification")}</span>
                <h2 id="passkey-delete-title">
                  {securityVerificationStep === "choose"
                    ? phrase("选择验证方式", "Choose a verification method")
                    : securityVerificationTarget === "totp"
                      ? phrase("验证后解除双因素认证", "Verify to remove 2FA")
                      : phrase("验证后移除通行密钥", "Verify to remove passkey")}
                </h2>
                <p>
                  {securityVerificationStep === "choose"
                    ? phrase("任选一种方式验证即可，不需要重复验证。", "Use any one method. Additional verification is not required.")
                    : securityVerificationTarget === "totp"
                      ? phrase("验证成功后将关闭当前账号的双因素认证。", "Two-factor authentication will be disabled after verification.")
                      : phrase("验证成功后只会移除当前选中的通行密钥。", "Only the selected passkey will be removed after verification.")}
                </p>
              </div>
              <div className="passkey-delete-heading-actions">
                {securityVerificationStep !== "choose" ? (
                  <button aria-label={phrase("换一种方式", "Choose another method")} className="table-icon-action" disabled={busy !== ""} onClick={() => setSecurityVerificationStep("choose")} title={phrase("换一种方式", "Choose another method")} type="button">
                    <ArrowLeft size={16} />
                  </button>
                ) : null}
                <button aria-label={phrase("关闭", "Close")} className="table-icon-action" disabled={busy !== ""} onClick={closeSecurityVerification} title={phrase("关闭", "Close")} type="button">
                  <XIcon size={16} />
                </button>
              </div>
            </header>
            {securityVerificationStep === "choose" ? (
              <div className="passkey-delete-methods">
                {securityVerificationTarget === "passkey" || passkeys.length ? (
                  <button className="passkey-delete-method" disabled={busy !== ""} onClick={() => void handleSelectSecurityVerificationMethod("passkey")} type="button">
                    <Fingerprint size={18} />
                    <span><strong>{phrase("通行密钥", "Passkey")}</strong><small>{phrase("使用设备验证", "Use device verification")}</small></span>
                  </button>
                ) : null}
                <button className="passkey-delete-method" disabled={busy !== ""} onClick={() => void handleSelectSecurityVerificationMethod("email")} type="button">
                  <Mail size={18} />
                  <span><strong>{phrase("邮箱验证码", "Email code")}</strong><small>{phrase("发送 6 位验证码", "Send a 6-digit code")}</small></span>
                </button>
                <button className="passkey-delete-method" disabled={busy !== ""} onClick={() => void handleSelectSecurityVerificationMethod("password")} type="button">
                  <KeyRound size={18} />
                  <span><strong>{phrase("当前密码", "Current password")}</strong><small>{phrase("输入当前账号密码", "Enter your account password")}</small></span>
                </button>
                {overview.totp.enabled ? (
                  <button className="passkey-delete-method" disabled={busy !== ""} onClick={() => void handleSelectSecurityVerificationMethod("totp")} type="button">
                    <ShieldCheck size={18} />
                    <span><strong>{phrase("双因素认证", "Authenticator")}</strong><small>{phrase("输入身份验证器验证码或恢复码", "Enter an authenticator code or recovery code")}</small></span>
                  </button>
                ) : null}
              </div>
            ) : (
              <div className="passkey-delete-verification">
                {securityVerificationStep === "passkey" ? (
                  <>
                    <p>{busy ? phrase("正在等待设备完成通行密钥验证。", "Complete passkey verification in your device prompt.") : phrase("请在设备或浏览器窗口中完成通行密钥验证。", "Complete passkey verification in your device or browser prompt.")}</p>
                  </>
                ) : securityVerificationStep === "password" ? (
                  <>
                    <PasswordInput aria-label={phrase("当前密码", "Current password")} autoComplete="current-password" className="passkey-delete-password-input" disabled={busy !== ""} onChange={(event) => setSecurityVerificationPassword(event.target.value)} placeholder={phrase("输入当前密码", "Enter your current password")} value={securityVerificationPassword} />
                    <button className="button passkey-delete-confirm-button" disabled={busy !== "" || !securityVerificationPassword.trim()} onClick={() => void handleVerifySecurityPassword()} type="button">
                      {busy ? phrase("验证中", "Verifying") : securityVerificationTarget === "totp" ? phrase("确定解除", "Confirm removal") : phrase("确定移除", "Confirm removal")}
                    </button>
                  </>
                ) : (
                  <>
                    <span className="passkey-delete-code-label">
                      {securityVerificationStep === "email"
                        ? phrase("输入邮箱中的 6 位验证码，输入完成后自动验证。", "Enter the 6-digit email code. It will verify automatically when complete.")
                        : phrase("输入身份验证器验证码或 6 位恢复码，输入完成后自动验证。", "Enter the authenticator code or 6-character recovery code. It will verify automatically when complete.")}
                    </span>
                    <OtpCodeInput
                      allowLetters={securityVerificationStep === "totp"}
                      ariaLabel={securityVerificationStep === "email" ? phrase("邮箱验证码", "Email verification code") : phrase("身份验证器验证码或恢复码", "Authenticator code or recovery code")}
                      autoFocus
                      disabled={busy !== ""}
                      onChange={setSecurityVerificationCode}
                      onComplete={(code) => void handleVerifySecurityCode(securityVerificationStep, code)}
                      value={securityVerificationCode}
                    />
                    {securityVerificationStep === "email" ? (
                      <button className="text-action passkey-delete-resend" disabled={busy !== "" || securityVerificationEmailCooldown > 0} onClick={() => void handleSelectSecurityVerificationMethod("email")} type="button">
                        {securityVerificationEmailCooldown > 0 ? `${securityVerificationEmailCooldown}s` : phrase("重新发送验证码", "Resend code")}
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            )}
          </section>
        </div>
      ) : null}
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

function isPasskeyCancellation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "NotAllowedError";
}
