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
import { AUTH_STATE_CHANGE_EVENT, clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { deletePasskeyWithEmail, deletePasskeyWithPassword, deletePasskeyWithTotp, getPasskeyDeletionOptions, getPasskeyRegistrationOptions, getSensitiveActionPasskeyOptions, getTotpDisablePasskeyOptions, isAuthExpiredError, listPasskeys, renamePasskey, requestPasskeyDeletionEmail, verifyPasskeyDeletion, verifyPasskeyRegistration, verifySensitiveActionPasskey, verifyTotpDisablePasskey, type PasskeySummary } from "@/lib/auth-api";
import { localizedPath } from "@/lib/i18n";
import { beginTotpEnrollment, cancelAccountDeletion, changeEmailAfterVerification, changePasswordAfterVerification, confirmTotp, disableTotp, disableTotpWithEmail, disableTotpWithPassword, downloadDataExport, getAccountPrivacyOverview, getDataExport, listPrivacyAudit, requestAccountDeletion, requestDataExport, requestSensitiveActionEmailVerification, verifySensitiveActionEmail, verifySensitiveActionPassword, verifySensitiveActionTotp, requestTotpDisableEmailVerification, type AccountPrivacyOverview, type ExportJob, type SensitiveAction } from "@/lib/account-privacy-api";
import { unblockFriendship } from "@/lib/social-api";

export default function AccountPrivacyPage() {
  const router = useRouter();
  const { locale, phrase } = useLanguage();
  const [token, setToken] = useState<string | null>(null);
  const [overview, setOverview] = useState<AccountPrivacyOverview | null>(null);
  const [audit, setAudit] = useState<Array<{ id: number; action: string; metadata: unknown; createdAt: string }>>([]);
  const [exportJob, setExportJob] = useState<ExportJob | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [totpSecret, setTotpSecret] = useState("");
  const [totpUri, setTotpUri] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [passkeys, setPasskeys] = useState<PasskeySummary[]>([]);
  const [passkeyName, setPasskeyName] = useState("");
  const [emailDraft, setEmailDraft] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordConfirmation, setPasswordConfirmation] = useState("");
  const [editingPasskeyId, setEditingPasskeyId] = useState<number | null>(null);
  const [editingPasskeyName, setEditingPasskeyName] = useState("");
  const [securityVerificationTarget, setSecurityVerificationTarget] = useState<"passkey" | "totp" | SensitiveAction | null>(null);
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
    const currentToken = readAccessToken() ?? token;
    if (!currentToken || !exportJob || !["queued", "processing"].includes(exportJob.status)) return;
    const timer = window.setInterval(() => {
      void getDataExport(readAccessToken() ?? currentToken, exportJob.id).then(setExportJob).catch(showError);
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
      setToken(readAccessToken() ?? currentToken);
      setOverview(nextOverview);
      setEmailDraft(nextOverview.email);
      setAudit(nextAudit);
      setPasskeys(nextPasskeys);
    } catch (loadError) {
      const latestToken = readAccessToken();
      if (isAuthExpiredError(loadError) && latestToken && latestToken !== currentToken) {
        setToken(latestToken);
        await load(latestToken);
        return;
      }
      handleAuthError(loadError);
    }
  }

  function getCurrentToken() {
    const currentToken = readAccessToken();
    if (currentToken && currentToken !== token) setToken(currentToken);
    return currentToken ?? token;
  }

  function showError(loadError: unknown) {
    if (isAuthExpiredError(loadError)) {
      const latestToken = readAccessToken();
      if (latestToken && latestToken !== token) {
        setToken(latestToken);
        return;
      }
      clearAuthTokens();
      router.replace(localizedPath("/", locale));
      return;
    }
    setError(loadError instanceof Error ? loadError.message : phrase("操作失败。", "The operation failed."));
  }

  async function withFreshToken<T>(operation: (accessToken: string) => Promise<T>): Promise<T> {
    const initialToken = getCurrentToken();
    if (!initialToken) throw new Error(phrase("登录状态已失效。", "Your session has expired."));
    try {
      return await operation(initialToken);
    } catch (requestError) {
      const latestToken = readAccessToken();
      if (isAuthExpiredError(requestError) && latestToken && latestToken !== initialToken) {
        setToken(latestToken);
        return operation(latestToken);
      }
      throw requestError;
    }
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
    const currentToken = getCurrentToken();
    if (!currentToken) return;
    await run("export", async () => {
      const job = await requestDataExport(currentToken);
      setExportJob(job);
      setNotice(phrase("数据导出任务已创建，完成后可下载。", "The data export is being prepared. You can download it when ready."));
    });
  }

  async function handleDownload() {
    const currentToken = getCurrentToken();
    if (!currentToken || !exportJob) return;
    await run("download", async () => {
      const blob = await downloadDataExport(currentToken, exportJob.id);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `lingxi-data-export-${exportJob.id}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setNotice(phrase("导出文件已下载。", "The export file was downloaded."));
    });
  }

  async function handleCancelDeletion() {
    const currentToken = getCurrentToken();
    if (!currentToken) return;
    await run("cancel-delete", async () => {
      await cancelAccountDeletion(currentToken);
      await load(readAccessToken() ?? currentToken);
      setNotice(phrase("注销申请已撤回。", "The deletion request was cancelled."));
    });
  }

  function openSensitiveAction(target: SensitiveAction) {
    if (!getCurrentToken() || busy) return;
    setError("");
    setNotice("");
    setSecurityVerificationTarget(target);
    setSecurityVerificationId(null);
    setSecurityVerificationStep("choose");
    setSecurityVerificationCode("");
    setSecurityVerificationPassword("");
    setSecurityVerificationEmailChallenge("");
    setSecurityVerificationEmailCooldown(0);
  }

  async function handleRenamePasskey(id: number) {
    const currentToken = getCurrentToken();
    if (!currentToken || !editingPasskeyName.trim()) return;
    await run(`rename-passkey-${id}`, async () => {
      await renamePasskey(currentToken, id, editingPasskeyName);
      setEditingPasskeyId(null);
      setEditingPasskeyName("");
      await load(readAccessToken() ?? currentToken);
      setNotice(phrase("通行密钥名称已更新。", "Passkey name updated."));
    });
  }

  async function handleDeletePasskey(id: number) {
    if (!getCurrentToken()) return;
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

  function requestEmailChange() {
    const nextEmail = emailDraft.trim().toLowerCase();
    if (!nextEmail || !/^\S+@\S+\.\S+$/.test(nextEmail)) {
      setError(phrase("请输入有效的邮箱地址。", "Enter a valid email address."));
      setNotice("");
      return;
    }
    if (nextEmail === overview?.email) {
      setError(phrase("新邮箱与当前邮箱相同。", "The new email is the same as the current email."));
      setNotice("");
      return;
    }
    setEmailDraft(nextEmail);
    openSensitiveAction("email_change");
  }

  function requestPasswordChange() {
    if (newPassword.length < 8) {
      setError(phrase("新密码至少需要 8 位。", "New password must be at least 8 characters."));
      setNotice("");
      return;
    }
    if (newPassword !== passwordConfirmation) {
      setError(phrase("两次输入的新密码不一致。", "The new passwords do not match."));
      setNotice("");
      return;
    }
    openSensitiveAction("password_change");
  }

  async function executeSensitiveAction(target: SensitiveAction, verificationToken: string) {
    if (!getCurrentToken()) return;
    closeSecurityVerification();
    if (target === "account_deletion") {
      await withFreshToken((currentToken) => requestAccountDeletion(currentToken, verificationToken));
      await load(readAccessToken()!);
      setNotice(phrase("账号已进入 7 天注销冷静期，可在此期间撤回。", "Your account entered a 7-day deletion cooling-off period. You can cancel it during this period."));
      return;
    }
    if (target === "totp_enrollment") {
      const result = await withFreshToken((currentToken) => beginTotpEnrollment(currentToken, verificationToken));
      setTotpSecret(result.secret);
      setTotpUri(result.otpAuthUri);
      setNotice(phrase("请将密钥添加到身份验证器后输入验证码确认。", "Add the secret to your authenticator, then enter a code to confirm."));
      return;
    }
    if (target === "password_change") {
      const result = await withFreshToken((currentToken) => changePasswordAfterVerification(currentToken, verificationToken, newPassword));
      setNewPassword("");
      setPasswordConfirmation("");
      setNotice(result.revokedSessions
        ? phrase(`密码已更新，并退出了 ${result.revokedSessions} 个其他设备会话。`, `Password updated and ${result.revokedSessions} other device session(s) were signed out.`)
        : phrase("密码已更新。", "Password updated."));
      return;
    }
    if (target === "email_change") {
      const result = await withFreshToken((currentToken) => changeEmailAfterVerification(currentToken, verificationToken, emailDraft));
      setEmailDraft(result.email);
      window.dispatchEvent(new Event(AUTH_STATE_CHANGE_EVENT));
      await load(readAccessToken()!);
      setNotice(phrase("邮箱已更新。", "Email updated."));
      return;
    }
    const challenge = await withFreshToken((currentToken) => getPasskeyRegistrationOptions(currentToken, verificationToken));
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
    await withFreshToken((currentToken) => verifyPasskeyRegistration(currentToken, {
      challengeToken: challenge.challengeToken,
      response,
      name: passkeyName.trim() || undefined,
    }));
    setPasskeyName("");
    await load(readAccessToken()!);
    setNotice(phrase("通行密钥已添加。", "Passkey added."));
  }

  async function completeSecurityVerification() {
    if (!getCurrentToken()) return;
    const target = securityVerificationTarget;
    closeSecurityVerification();
    await load(readAccessToken()!);
    setNotice(target === "totp" ? phrase("双因素认证已关闭。", "Two-factor authentication is disabled.") : phrase("通行密钥已移除。", "Passkey removed."));
  }

  async function handleSelectSecurityVerificationMethod(method: "passkey" | "email" | "password" | "totp") {
    const currentToken = getCurrentToken();
    if (!currentToken || !securityVerificationTarget || busy) return;
    const target = securityVerificationTarget;
    const passkeyId = securityVerificationId;
    setError("");
    setSecurityVerificationStep(method);
    setSecurityVerificationCode("");
    setSecurityVerificationPassword("");
    if (isSensitiveActionTarget(target)) {
      if (method === "passkey") {
        void handleVerifySensitiveActionPasskey(target);
        return;
      }
      if (method === "email") {
        await run(`${target}-email`, async () => {
          const result = await withFreshToken((accessToken) => requestSensitiveActionEmailVerification(accessToken, target));
          setSecurityVerificationEmailChallenge(result.challengeToken);
          setSecurityVerificationEmailCooldown(result.retryAfterSeconds);
          setNotice(phrase("验证码已发送至你的邮箱。", "A verification code was sent to your email."));
        });
        return;
      }
      return;
    }
    if (method === "passkey") {
      void handleVerifySecurityPasskey(target, passkeyId);
      return;
    }
    if (method === "email") {
      await run(`${target}-disable-email`, async () => {
        if (target === "passkey" && passkeyId !== null) {
          const result = await withFreshToken((accessToken) => requestPasskeyDeletionEmail(accessToken, passkeyId));
          setSecurityVerificationEmailChallenge(result.challengeToken);
          setSecurityVerificationEmailCooldown(result.retryAfterSeconds);
        } else {
          const result = await withFreshToken((accessToken) => requestTotpDisableEmailVerification(accessToken));
          setSecurityVerificationEmailCooldown(result.retryAfterSeconds);
        }
        setNotice(phrase("验证码已发送至你的邮箱。", "A verification code was sent to your email."));
      });
    }
  }

  async function handleVerifySensitiveActionPasskey(action: SensitiveAction) {
    const currentToken = getCurrentToken();
    if (!currentToken || securityVerificationSubmitRef.current) return;
    securityVerificationSubmitRef.current = true;
    await run(`${action}-passkey`, async () => {
      const challenge = await withFreshToken((accessToken) => getSensitiveActionPasskeyOptions(accessToken, action));
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
      const result = await withFreshToken((accessToken) => verifySensitiveActionPasskey(accessToken, action, { challengeToken: challenge.challengeToken, response }));
      await executeSensitiveAction(action, result.verificationToken);
    });
    securityVerificationSubmitRef.current = false;
  }

  async function handleVerifySensitiveActionCode(method: "email" | "totp", code: string) {
    const currentToken = getCurrentToken();
    if (!currentToken || !securityVerificationTarget || !isSensitiveActionTarget(securityVerificationTarget) || securityVerificationSubmitRef.current) return;
    if (method === "email" && !securityVerificationEmailChallenge) return;
    const action = securityVerificationTarget;
    securityVerificationSubmitRef.current = true;
    await run(`${action}-${method}`, async () => {
      const result = method === "email"
        ? await withFreshToken((accessToken) => verifySensitiveActionEmail(accessToken, action, securityVerificationEmailChallenge, code))
        : await withFreshToken((accessToken) => verifySensitiveActionTotp(accessToken, action, code));
      await executeSensitiveAction(action, result.verificationToken);
    });
    securityVerificationSubmitRef.current = false;
  }

  async function handleVerifySensitiveActionPassword() {
    const currentToken = getCurrentToken();
    if (!currentToken || !securityVerificationTarget || !isSensitiveActionTarget(securityVerificationTarget) || !securityVerificationPassword.trim()) return;
    const action = securityVerificationTarget;
    const password = securityVerificationPassword;
    if (securityVerificationSubmitRef.current) return;
    securityVerificationSubmitRef.current = true;
    try {
      await run(`${action}-password`, async () => {
        const result = await withFreshToken((accessToken) => verifySensitiveActionPassword(accessToken, action, password));
        await executeSensitiveAction(action, result.verificationToken);
      });
    } finally {
      securityVerificationSubmitRef.current = false;
    }
  }

  async function handleVerifySecurityPasskey(target: "passkey" | "totp", passkeyId: number | null) {
    const currentToken = getCurrentToken();
    if (!currentToken || securityVerificationSubmitRef.current) return;
    if (target === "passkey" && passkeyId === null) return;
    securityVerificationSubmitRef.current = true;
    await run(`${target}-disable-passkey`, async () => {
      const challenge = target === "passkey" && passkeyId !== null
        ? await withFreshToken((accessToken) => getPasskeyDeletionOptions(accessToken, passkeyId))
        : await withFreshToken((accessToken) => getTotpDisablePasskeyOptions(accessToken));
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
        await withFreshToken((accessToken) => verifyPasskeyDeletion(accessToken, passkeyId, { challengeToken: challenge.challengeToken, response }));
      } else {
        await withFreshToken((accessToken) => verifyTotpDisablePasskey(accessToken, { challengeToken: challenge.challengeToken, response }));
      }
      await completeSecurityVerification();
    });
    securityVerificationSubmitRef.current = false;
  }

  async function handleVerifySecurityCode(method: "email" | "totp", code: string) {
    const currentToken = getCurrentToken();
    if (!currentToken || !securityVerificationTarget || securityVerificationSubmitRef.current) return;
    if (method === "email" && securityVerificationTarget === "passkey" && !securityVerificationEmailChallenge) return;
    const target = securityVerificationTarget;
    const passkeyId = securityVerificationId;
    if (target === "passkey" && passkeyId === null) return;
    securityVerificationSubmitRef.current = true;
    await run(`${target}-disable-${method}`, async () => {
      if (target === "passkey" && passkeyId !== null) {
        if (method === "email") {
          await withFreshToken((accessToken) => deletePasskeyWithEmail(accessToken, passkeyId, securityVerificationEmailChallenge, code));
        } else {
          await withFreshToken((accessToken) => deletePasskeyWithTotp(accessToken, passkeyId, code));
        }
      } else {
        if (method === "email") {
          await withFreshToken((accessToken) => disableTotpWithEmail(accessToken, code));
        } else {
          await withFreshToken((accessToken) => disableTotp(accessToken, code));
        }
      }
      await completeSecurityVerification();
    });
    securityVerificationSubmitRef.current = false;
  }

  async function handleVerifySecurityPassword() {
    const currentToken = getCurrentToken();
    if (!currentToken || !securityVerificationTarget || !securityVerificationPassword.trim()) return;
    const target = securityVerificationTarget;
    const passkeyId = securityVerificationId;
    if (target === "passkey" && passkeyId === null) return;
    await run(`${target}-disable-password`, async () => {
      if (target === "passkey" && passkeyId !== null) {
        await withFreshToken((accessToken) => deletePasskeyWithPassword(accessToken, passkeyId, securityVerificationPassword));
      } else {
        await withFreshToken((accessToken) => disableTotpWithPassword(accessToken, securityVerificationPassword));
      }
      await completeSecurityVerification();
    });
  }

  async function handleConfirmTotp() {
    const currentToken = getCurrentToken();
    if (!currentToken || !totpCode) return;
    await run("confirm-totp", async () => {
      const result = await withFreshToken((accessToken) => confirmTotp(accessToken, totpCode));
      setRecoveryCodes(result.recoveryCodes);
      setTotpCode("");
      setTotpSecret("");
      setTotpUri("");
      await load(readAccessToken()!);
      setNotice(phrase("双因素认证已启用，请保存恢复码。", "Two-factor authentication is enabled. Save your recovery codes."));
    });
  }

  async function handleUnblock(friendshipId: number) {
    const currentToken = getCurrentToken();
    if (!currentToken) return;
    await run(`unblock-${friendshipId}`, async () => {
      await withFreshToken((accessToken) => unblockFriendship(accessToken, friendshipId));
      await load(readAccessToken()!);
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
        <div className="privacy-column privacy-column-credentials">
          <section className="profile-panel privacy-card privacy-credentials-card">
          <div className="privacy-card-heading">
            <ShieldCheck size={18} />
            <div>
              <h2>{phrase("账号凭据", "Account credentials")}</h2>
              <p>{phrase("修改邮箱或密码前，需要通过一种安全验证。", "Choose one security method before changing your email or password.")}</p>
            </div>
          </div>
          <div className="privacy-credential-section">
            <label className="privacy-field">
              <span>{phrase("当前邮箱", "Current email")}</span>
              <input readOnly value={overview.email} />
            </label>
            <label className="privacy-field">
              <span>{phrase("新邮箱", "New email")}</span>
              <input autoComplete="email" onChange={(event) => setEmailDraft(event.target.value)} placeholder={phrase("输入新的邮箱地址", "Enter a new email address")} type="email" value={emailDraft} />
            </label>
            <button className="button secondary" disabled={busy !== ""} onClick={requestEmailChange} type="button">
              <Mail size={15} />
              {phrase("修改邮箱", "Change email")}
            </button>
          </div>
          <div className="privacy-credential-section">
            <label className="privacy-field">
              <span>{phrase("新密码", "New password")}</span>
              <PasswordInput autoComplete="new-password" onChange={(event) => setNewPassword(event.target.value)} placeholder={phrase("至少 8 位", "At least 8 characters")} value={newPassword} />
            </label>
            <label className="privacy-field">
              <span>{phrase("确认新密码", "Confirm new password")}</span>
              <PasswordInput autoComplete="new-password" onChange={(event) => setPasswordConfirmation(event.target.value)} placeholder={phrase("再次输入新密码", "Enter the new password again")} value={passwordConfirmation} />
            </label>
            <button className="button secondary" disabled={busy !== ""} onClick={requestPasswordChange} type="button">
              <KeyRound size={15} />
              {phrase("修改密码", "Change password")}
            </button>
          </div>
          </section>
        </div>
        <div className="privacy-column privacy-column-security">
          <section className="profile-panel privacy-card privacy-deletion-card">
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
          <section className="profile-panel privacy-card privacy-totp-card">
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
            <button className="button danger" disabled={busy !== ""} onClick={() => openSensitiveAction("account_deletion")} type="button">
              {phrase("申请注销", "Request deletion")}
            </button>
          )}
          </section>
          <section className="profile-panel privacy-card privacy-blocked-card">
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
        <div className="privacy-column privacy-column-access">
          <section className="profile-panel privacy-card privacy-passkey-card">
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
              onClick={() => openSensitiveAction("passkey_registration")}
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
          <section className="profile-panel privacy-card privacy-data-export-card">
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
            <button className="button" disabled={busy !== ""} onClick={() => openSensitiveAction("totp_enrollment")} type="button">
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
        </div>
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
                      : securityVerificationTarget === "account_deletion"
                        ? phrase("验证后申请注销账号", "Verify to request account deletion")
                        : securityVerificationTarget === "passkey_registration"
                          ? phrase("验证后添加通行密钥", "Verify to add a passkey")
                          : securityVerificationTarget === "totp_enrollment"
                            ? phrase("验证后绑定双因素认证", "Verify to enable two-factor authentication")
                            : securityVerificationTarget === "password_change"
                              ? phrase("验证后修改密码", "Verify to change password")
                              : securityVerificationTarget === "email_change"
                                ? phrase("验证后修改邮箱", "Verify to change email")
                            : phrase("验证后移除通行密钥", "Verify to remove passkey")}
                </h2>
                <p>
                  {securityVerificationStep === "choose"
                    ? phrase("任选一种方式验证即可，不需要重复验证。", "Use any one method. Additional verification is not required.")
                    : securityVerificationTarget === "totp"
                      ? phrase("验证成功后将关闭当前账号的双因素认证。", "Two-factor authentication will be disabled after verification.")
                      : securityVerificationTarget === "account_deletion"
                        ? phrase("验证成功后账号将进入 7 天注销冷静期。", "After verification, the account will enter a 7-day deletion cooling-off period.")
                        : securityVerificationTarget === "passkey_registration"
                          ? phrase("验证成功后继续使用当前设备添加通行密钥。", "After verification, continue adding a passkey on this device.")
                          : securityVerificationTarget === "totp_enrollment"
                          ? phrase("验证成功后生成双因素认证绑定信息。", "After verification, enrollment details for two-factor authentication will be generated.")
                          : securityVerificationTarget === "password_change"
                            ? phrase("验证成功后会更新密码，并退出其他设备。", "Your password will be updated and other devices will be signed out after verification.")
                            : securityVerificationTarget === "email_change"
                              ? phrase("验证成功后会更新当前账号邮箱。", "Your account email will be updated after verification.")
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
                    <PasswordInput aria-label={phrase("当前密码", "Current password")} autoComplete="current-password" className="security-verification-password-input" disabled={busy !== ""} onChange={(event) => setSecurityVerificationPassword(event.target.value)} placeholder={phrase("输入当前密码", "Enter your current password")} value={securityVerificationPassword} />
                    <button className="button passkey-delete-confirm-button" disabled={busy !== "" || !securityVerificationPassword.trim()} onClick={() => void (isSensitiveActionTarget(securityVerificationTarget) ? handleVerifySensitiveActionPassword() : handleVerifySecurityPassword())} type="button">
                      {busy ? phrase("验证中", "Verifying") : securityVerificationTarget === "totp" ? phrase("确定解除", "Confirm removal") : securityVerificationTarget === "passkey" ? phrase("确定移除", "Confirm removal") : phrase("继续", "Continue")}
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
                      onComplete={(code) => void (isSensitiveActionTarget(securityVerificationTarget) ? handleVerifySensitiveActionCode(securityVerificationStep, code) : handleVerifySecurityCode(securityVerificationStep, code))}
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

function isSensitiveActionTarget(target: "passkey" | "totp" | SensitiveAction | null): target is SensitiveAction {
  return target === "account_deletion" || target === "passkey_registration" || target === "totp_enrollment" || target === "password_change" || target === "email_change";
}
