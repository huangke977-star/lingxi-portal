"use client";

import { startAuthentication } from "@simplewebauthn/browser";
import { FormEvent, useEffect, useState } from "react";
import { Fingerprint, KeyRound, Link2, Mail, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import { AppToast } from "@/components/app-toast";
import { AdminPageHeader } from "@/components/admin-page-header";
import { OtpCodeInput } from "@/components/otp-code-input";
import { PasswordInput } from "@/components/password-input";
import { useLanguage } from "@/components/language-provider";
import { bindGoogleIdentity, getMe, getSensitiveActionPasskeyOptions, isAuthExpiredError, listPasskeys, verifySensitiveActionPasskey, type AuthUser } from "@/lib/auth-api";
import { clearAuthTokens, readAccessToken } from "@/lib/auth-storage";
import { createExternalChannel, createReadOnlyToken, deleteExternalChannel, listExternalChannels, listReadOnlyTokens, revokeReadOnlyToken, verifyExternalChannel, type ExternalChannel, type ReadOnlyScope, type ReadOnlyToken } from "@/lib/integrations-api";
import { requestSensitiveActionEmailVerification, verifySensitiveActionEmail, verifySensitiveActionPassword, verifySensitiveActionTotp } from "@/lib/account-privacy-api";
import { localizedPath } from "@/lib/i18n";
import { useRouter } from "next/navigation";

const scopes: Array<[ReadOnlyScope, string, string]> = [["read_articles", "文章只读", "Read articles"], ["read_profile", "公开资料只读", "Read public profiles"], ["read_notifications", "通知只读", "Read notifications"]];
type GoogleLinkStep = "choose" | "passkey" | "email" | "password" | "totp";

export default function ProfileIntegrationsPage() {
  const router = useRouter();
  const { locale, phrase } = useLanguage();
  const [token, setToken] = useState("");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [tokens, setTokens] = useState<ReadOnlyToken[]>([]);
  const [channels, setChannels] = useState<ExternalChannel[]>([]);
  const [passkeyCount, setPasskeyCount] = useState(0);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [tokenOpen, setTokenOpen] = useState(false);
  const [channelOpen, setChannelOpen] = useState(false);
  const [tokenName, setTokenName] = useState("");
  const [selected, setSelected] = useState<ReadOnlyScope[]>(["read_articles"]);
  const [expiry, setExpiry] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [secret, setSecret] = useState("");
  const [verifyId, setVerifyId] = useState(0);
  const [verifyCode, setVerifyCode] = useState("");
  const [pendingGoogleToken, setPendingGoogleToken] = useState("");
  const [pendingGoogleEmail, setPendingGoogleEmail] = useState("");
  const [googleLinkStep, setGoogleLinkStep] = useState<GoogleLinkStep>("choose");
  const [googleLinkCode, setGoogleLinkCode] = useState("");
  const [googleLinkPassword, setGoogleLinkPassword] = useState("");
  const [googleLinkEmailChallenge, setGoogleLinkEmailChallenge] = useState("");
  const [googleLinkCooldown, setGoogleLinkCooldown] = useState(0);
  const [googleLinkBusy, setGoogleLinkBusy] = useState(false);

  async function load(current = token) {
    if (!current) return;
    try {
      const [nextTokens, nextChannels, nextPasskeys] = await Promise.all([listReadOnlyTokens(current), listExternalChannels(current), listPasskeys(current)]);
      setTokens(nextTokens);
      setChannels(nextChannels);
      setPasskeyCount(nextPasskeys.length);
    } catch (loadError) {
      if (isAuthExpiredError(loadError)) {
        clearAuthTokens();
        router.replace(localizedPath("/login", locale));
      } else {
        setError(loadError instanceof Error ? loadError.message : phrase("集成加载失败。", "Could not load integrations."));
      }
    }
  }

  useEffect(() => {
    const current = readAccessToken();
    if (!current) {
      router.replace(localizedPath("/login", locale));
      return;
    }
    const pendingTimer = window.setTimeout(() => {
      setPendingGoogleToken(window.localStorage.getItem("hlovet.oauth.pending") || "");
      setPendingGoogleEmail(window.localStorage.getItem("hlovet.oauth.pending.email") || "");
    }, 0);
    void getMe(current).then((next) => {
      setToken(current);
      setUser(next);
      return load(current);
    }).catch((loadError) => setError(loadError instanceof Error ? loadError.message : phrase("账号读取失败。", "Could not load account.")));
    return () => window.clearTimeout(pendingTimer);
  }, [locale, phrase, router]);

  useEffect(() => {
    if (googleLinkCooldown <= 0) return;
    const timer = window.setInterval(() => setGoogleLinkCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [googleLinkCooldown]);

  async function submitToken(event: FormEvent) {
    event.preventDefault();
    try {
      const created = await createReadOnlyToken(token, { name: tokenName, scopes: selected, ...(expiry ? { expiresAt: expiry } : {}) });
      setTokenOpen(false);
      setTokenName("");
      setExpiry("");
      setNotice(phrase(`令牌只显示这一次：${created.token}`, `Token shown once: ${created.token}`));
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : phrase("令牌创建失败。", "Could not create token."));
    }
  }

  async function submitChannel(event: FormEvent) {
    event.preventDefault();
    try {
      const created = await createExternalChannel(token, { kind: "webhook", endpoint, ...(secret ? { secret } : {}) });
      setChannelOpen(false);
      setEndpoint("");
      setSecret("");
      setVerifyId(created.id);
      setNotice(phrase("验证请求已发送到外部通道。", "Verification request sent to the external channel."));
      await load();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : phrase("通道创建失败。", "Could not create channel."));
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    try {
      await verifyExternalChannel(token, verifyId, verifyCode);
      setVerifyId(0);
      setVerifyCode("");
      setNotice(phrase("外部通知通道已验证。", "External notification channel verified."));
      await load();
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : phrase("验证失败。", "Verification failed."));
    }
  }

  function resetGoogleLinkVerification() {
    setGoogleLinkStep("choose");
    setGoogleLinkCode("");
    setGoogleLinkPassword("");
    setGoogleLinkEmailChallenge("");
    setGoogleLinkCooldown(0);
  }

  function cancelGoogleLink() {
    window.localStorage.removeItem("hlovet.oauth.pending");
    window.localStorage.removeItem("hlovet.oauth.pending.email");
    setPendingGoogleToken("");
    setPendingGoogleEmail("");
    resetGoogleLinkVerification();
    setNotice(phrase("本次未关联 Google 账号。", "Google account was not linked."));
  }

  async function completeGoogleLink(verificationToken: string) {
    if (!pendingGoogleToken) return;
    await bindGoogleIdentity(token, pendingGoogleToken, verificationToken);
    window.localStorage.removeItem("hlovet.oauth.pending");
    window.localStorage.removeItem("hlovet.oauth.pending.email");
    setPendingGoogleToken("");
    setPendingGoogleEmail("");
    resetGoogleLinkVerification();
    setNotice(phrase("Google 账号已安全绑定。", "Google account linked securely."));
  }

  async function verifyGoogleWithPasskey() {
    if (!token || googleLinkBusy || !pendingGoogleToken) return;
    setGoogleLinkStep("passkey");
    setGoogleLinkBusy(true);
    setError("");
    try {
      const challenge = await getSensitiveActionPasskeyOptions(token, "google_account_link");
      const response = await startAuthentication({ optionsJSON: challenge.options });
      const result = await verifySensitiveActionPasskey(token, "google_account_link", { challengeToken: challenge.challengeToken, response });
      await completeGoogleLink(result.verificationToken);
    } catch (verificationError) {
      if (isPasskeyCancellation(verificationError)) setNotice(phrase("已取消 Passkey 验证。", "Passkey verification was cancelled."));
      else setError(verificationError instanceof Error ? verificationError.message : phrase("Passkey 验证失败。", "Passkey verification failed."));
    } finally {
      setGoogleLinkBusy(false);
    }
  }

  async function selectGoogleLinkMethod(method: Exclude<GoogleLinkStep, "choose">) {
    if (googleLinkBusy) return;
    setError("");
    setGoogleLinkCode("");
    setGoogleLinkPassword("");
    setGoogleLinkStep(method);
    if (method !== "email") return;
    setGoogleLinkBusy(true);
    try {
      const result = await requestSensitiveActionEmailVerification(token, "google_account_link");
      setGoogleLinkEmailChallenge(result.challengeToken);
      setGoogleLinkCooldown(result.retryAfterSeconds);
      setNotice(phrase("验证码已发送至你的邮箱。", "A verification code was sent to your email."));
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : phrase("验证码发送失败。", "Could not send the verification code."));
    } finally {
      setGoogleLinkBusy(false);
    }
  }

  async function verifyGoogleCode(method: "email" | "totp", code: string) {
    if (!token || googleLinkBusy || !pendingGoogleToken || (method === "email" && !googleLinkEmailChallenge)) return;
    setGoogleLinkBusy(true);
    setError("");
    try {
      const result = method === "email"
        ? await verifySensitiveActionEmail(token, "google_account_link", googleLinkEmailChallenge, code)
        : await verifySensitiveActionTotp(token, "google_account_link", code);
      await completeGoogleLink(result.verificationToken);
    } catch (verifyError) {
      setGoogleLinkCode("");
      setError(verifyError instanceof Error ? verifyError.message : phrase("验证失败。", "Verification failed."));
    } finally {
      setGoogleLinkBusy(false);
    }
  }

  async function verifyGooglePassword() {
    if (!token || googleLinkBusy || !googleLinkPassword.trim()) return;
    setGoogleLinkBusy(true);
    setError("");
    try {
      const result = await verifySensitiveActionPassword(token, "google_account_link", googleLinkPassword);
      await completeGoogleLink(result.verificationToken);
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : phrase("密码验证失败。", "Password verification failed."));
    } finally {
      setGoogleLinkBusy(false);
    }
  }

  return <section className="page-shell integrations-user-page"><AdminPageHeader title={phrase("外部集成", "External integrations")} description={phrase("管理只读访问令牌与外部通知通道。", "Manage read-only access tokens and external notification channels.")} />
    {pendingGoogleToken ? <section className="integrations-panel integrations-google-link-panel"><header><span><Link2 size={17} />{phrase("待完成的 Google 绑定", "Pending Google link")}</span></header><p>{phrase(`Google 邮箱 ${pendingGoogleEmail || ""} 已存在本地账号。请完成一次安全验证后再关联，系统不会自动合并账号。`, `The Google email ${pendingGoogleEmail || ""} already belongs to a local account. Complete one security check to link it; accounts are never merged automatically.`)}</p>{googleLinkStep === "choose" ? <div className="integrations-google-link-methods">{passkeyCount ? <button className="integrations-google-link-method" disabled={googleLinkBusy} onClick={() => void verifyGoogleWithPasskey()} type="button"><Fingerprint size={17} /><span><strong>{phrase("Passkey", "Passkey")}</strong><small>{phrase("使用设备验证", "Use device verification")}</small></span></button> : null}<button className="integrations-google-link-method" disabled={googleLinkBusy} onClick={() => void selectGoogleLinkMethod("email")} type="button"><Mail size={17} /><span><strong>{phrase("邮箱验证码", "Email code")}</strong><small>{phrase("发送 6 位验证码", "Send a 6-digit code")}</small></span></button>{user?.totpEnabled ? <button className="integrations-google-link-method" disabled={googleLinkBusy} onClick={() => void selectGoogleLinkMethod("totp")} type="button"><ShieldCheck size={17} /><span><strong>{phrase("双因素认证", "Authenticator")}</strong><small>{phrase("输入身份验证器验证码", "Enter an authenticator code")}</small></span></button> : null}<button className="integrations-google-link-method" disabled={googleLinkBusy} onClick={() => void selectGoogleLinkMethod("password")} type="button"><KeyRound size={17} /><span><strong>{phrase("当前密码", "Current password")}</strong><small>{phrase("输入当前账号密码", "Enter your account password")}</small></span></button></div> : <div className="integrations-google-link-verification"><button className="text-action" disabled={googleLinkBusy} onClick={resetGoogleLinkVerification} type="button">{phrase("返回验证方式", "Back to methods")}</button>{googleLinkStep === "passkey" ? <p>{phrase("请在设备或浏览器窗口中完成 Passkey 验证。", "Complete Passkey verification in your device or browser prompt.")}</p> : googleLinkStep === "password" ? <><PasswordInput autoComplete="current-password" disabled={googleLinkBusy} onChange={(event) => setGoogleLinkPassword(event.target.value)} placeholder={phrase("输入当前密码", "Enter current password")} value={googleLinkPassword} /><button className="button" disabled={googleLinkBusy || !googleLinkPassword.trim()} onClick={() => void verifyGooglePassword()} type="button">{googleLinkBusy ? phrase("验证中", "Verifying") : phrase("确认验证", "Verify")}</button></> : <><p>{googleLinkStep === "email" ? phrase("输入邮箱中的 6 位验证码，输入完成后自动验证。", "Enter the 6-digit email code. It verifies automatically when complete.") : phrase("输入身份验证器中的 6 位验证码，输入完成后自动验证。", "Enter the 6-digit authenticator code. It verifies automatically when complete.")}</p><OtpCodeInput allowLetters={false} ariaLabel={googleLinkStep === "email" ? phrase("邮箱验证码", "Email verification code") : phrase("身份验证器验证码", "Authenticator code")} autoFocus disabled={googleLinkBusy} onChange={setGoogleLinkCode} onComplete={(code) => void verifyGoogleCode(googleLinkStep, code)} value={googleLinkCode} />{googleLinkStep === "email" ? <button className="text-action" disabled={googleLinkBusy || googleLinkCooldown > 0} onClick={() => void selectGoogleLinkMethod("email")} type="button">{googleLinkCooldown > 0 ? `${googleLinkCooldown}s` : phrase("重新发送验证码", "Resend code")}</button> : null}</>}</div>}<footer><button className="button secondary" disabled={googleLinkBusy} onClick={cancelGoogleLink} type="button">{phrase("暂不关联", "Not now")}</button></footer></section> : null}
    <section className="integrations-panel"><header><span><KeyRound size={17} />{phrase("只读 API 令牌", "Read-only API tokens")}</span><button className="admin-header-icon-action" onClick={() => setTokenOpen(true)} title={phrase("新增令牌", "New token")} type="button"><Plus size={17} /></button></header>{tokens.map((item) => <article className="integration-inline-row" key={item.id}><div><strong>{item.name}</strong><small>{item.tokenPrefix} · {item.scopes.join(", ")}</small></div><span>{item.revokedAt ? phrase("已撤销", "Revoked") : phrase("有效", "Active")}</span><button className="table-icon-action" onClick={() => void revokeReadOnlyToken(token, item.id).then(() => load()).catch((loadError) => setError(loadError instanceof Error ? loadError.message : phrase("撤销失败。", "Could not revoke token.")))} title={phrase("撤销", "Revoke")} type="button"><Trash2 size={15} /></button></article>)}{!tokens.length ? <p className="article-empty-state">{phrase("暂无只读令牌。", "No read-only tokens yet.")}</p> : null}</section>
    <section className="integrations-panel"><header><span><Link2 size={17} />{phrase("外部通知通道", "External notification channels")}</span><button className="admin-header-icon-action" onClick={() => setChannelOpen(true)} title={phrase("添加通道", "Add channel")} type="button"><Plus size={17} /></button></header>{channels.map((item) => <article className="integration-inline-row" key={item.id}><div><strong>{item.endpoint}</strong><small>{item.verified ? phrase("已验证", "Verified") : phrase("待验证", "Verification required")}</small></div><span>{item.enabled ? phrase("启用", "Enabled") : phrase("停用", "Disabled")}</span><button className="table-icon-action" onClick={() => void deleteExternalChannel(token, item.id).then(() => load()).catch((loadError) => setError(loadError instanceof Error ? loadError.message : phrase("删除失败。", "Could not delete channel.")))} title={phrase("删除", "Delete")} type="button"><Trash2 size={15} /></button></article>)}{!channels.length ? <p className="article-empty-state">{phrase("暂无外部通知通道。", "No external channels yet.")}</p> : null}</section>
    {tokenOpen ? <div className="modal-backdrop"><form className="modal-panel integrations-dialog" onSubmit={(event) => void submitToken(event)}><header><h2>{phrase("新增只读令牌", "New read-only token")}</h2><button onClick={() => setTokenOpen(false)} type="button"><X size={17} /></button></header><label>{phrase("名称", "Name")}<input onChange={(event) => setTokenName(event.target.value)} required value={tokenName} /></label><label>{phrase("过期时间（可选）", "Expiry (optional)")}<input onChange={(event) => setExpiry(event.target.value)} type="datetime-local" value={expiry} /></label><fieldset><legend>{phrase("权限范围", "Scopes")}</legend>{scopes.map(([value, zh, en]) => <label key={value}><input checked={selected.includes(value)} onChange={(event) => setSelected((current) => event.target.checked ? [...current, value] : current.filter((item) => item !== value))} type="checkbox" />{phrase(zh, en)}</label>)}</fieldset><footer><button className="button secondary" onClick={() => setTokenOpen(false)} type="button">{phrase("取消", "Cancel")}</button><button className="button" type="submit">{phrase("创建", "Create")}</button></footer></form></div> : null}
    {channelOpen ? <div className="modal-backdrop"><form className="modal-panel integrations-dialog" onSubmit={(event) => void submitChannel(event)}><header><h2>{phrase("添加外部通知通道", "Add external channel")}</h2><button onClick={() => setChannelOpen(false)} type="button"><X size={17} /></button></header><label>HTTPS URL<input onChange={(event) => setEndpoint(event.target.value)} required type="url" value={endpoint} /></label><label>Secret<input onChange={(event) => setSecret(event.target.value)} type="password" value={secret} /></label><footer><button className="button secondary" onClick={() => setChannelOpen(false)} type="button">{phrase("取消", "Cancel")}</button><button className="button" type="submit">{phrase("发送验证", "Send verification")}</button></footer></form></div> : null}
    {verifyId ? <div className="modal-backdrop"><form className="modal-panel integrations-dialog" onSubmit={(event) => void verify(event)}><header><h2>{phrase("验证外部通道", "Verify external channel")}</h2></header><label>{phrase("6 位验证码", "6-digit code")}<input autoFocus inputMode="numeric" maxLength={6} onChange={(event) => setVerifyCode(event.target.value.replace(/\D/g, "").slice(0, 6))} required value={verifyCode} /></label><footer><button className="button" type="submit">{phrase("确认", "Confirm")}</button></footer></form></div> : null}
    <AppToast message={error || notice} onDismiss={() => { setError(""); setNotice(""); }} tone={error ? "error" : "success"} />
  </section>;
}

function isPasskeyCancellation(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { name?: unknown }).name === "NotAllowedError";
}
