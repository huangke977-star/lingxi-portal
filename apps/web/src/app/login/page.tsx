"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fingerprint, KeyRound, Mail, ShieldCheck } from "lucide-react";
import { browserSupportsWebAuthn, startAuthentication } from "@simplewebauthn/browser";
import { FormEvent, useEffect, useRef, useState } from "react";
import { AppToast } from "@/components/app-toast";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useLanguage } from "@/components/language-provider";
import { OtpCodeInput } from "@/components/otp-code-input";
import { PasswordInput } from "@/components/password-input";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { ApiRequestError, consumeOAuthResult, getBrowserApiBaseUrl, getExternalAuthProviders, getGoogleLinkPasskeyOptions, getPasskeyLoginOptions, login, requestGoogleLinkEmail, resendDeviceLoginVerification, type DeviceLoginVerificationRequired, type OAuthLinkRequired, type TotpVerificationRequired, verifyDeviceLogin, verifyGoogleLinkEmail, verifyGoogleLinkPassword, verifyGoogleLinkPasskey, verifyGoogleLinkTotp, verifyPasskeyLogin, verifyTotpLogin } from "@/lib/auth-api";
import { saveAuthTokens } from "@/lib/auth-storage";
import { getSecurityPolicy, type SecurityPolicy } from "@/lib/security-api";
import { localizedPath } from "@/lib/i18n";

export default function LoginPage() {
  const router = useRouter();
  const { locale, phrase, t } = useLanguage();
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [policy, setPolicy] = useState<SecurityPolicy | null>(null);
  const [turnstileRequired, setTurnstileRequired] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [deviceChallenge, setDeviceChallenge] = useState<DeviceLoginVerificationRequired | null>(null);
  const [totpChallenge, setTotpChallenge] = useState<TotpVerificationRequired | null>(null);
  const [totpCode, setTotpCode] = useState("");
  const [totpRecoveryMode, setTotpRecoveryMode] = useState(false);
  const [deviceCode, setDeviceCode] = useState("");
  const [retryAfter, setRetryAfter] = useState(0);
  const [passkeySupported, setPasskeySupported] = useState(false);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const [googleLinkRequired, setGoogleLinkRequired] = useState<OAuthLinkRequired | null>(null);
  const [googleLinkMode, setGoogleLinkMode] = useState(false);
  const [googleLinkStep, setGoogleLinkStep] = useState<"methods" | "passkey" | "email" | "totp" | "password">("methods");
  const [googleLinkCode, setGoogleLinkCode] = useState("");
  const [googleLinkPassword, setGoogleLinkPassword] = useState("");
  const [googleLinkEmailChallenge, setGoogleLinkEmailChallenge] = useState("");
  const [googleLinkRetryAfter, setGoogleLinkRetryAfter] = useState(0);
  const googleLinkVerificationSubmitRef = useRef(false);
  const isLeavingRef = useRef(false);

  useEffect(() => {
    let active = true;
    getSecurityPolicy()
      .then((nextPolicy) => {
        if (active) setPolicy(nextPolicy);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    void getExternalAuthProviders().then((providers) => setGoogleEnabled(Boolean(providers.google?.enabled))).catch(() => setGoogleEnabled(false));
    const params = new URLSearchParams(window.location.search);
    const oauthError = params.get("oauthError");
    const oauthResult = params.get("oauthResult");
    if (oauthError) window.setTimeout(() => setError(oauthError), 0);
    if (!oauthResult) return;
    window.history.replaceState({}, "", window.location.pathname);
    window.setTimeout(() => setIsSubmitting(true), 0);
    void consumeOAuthResult(oauthResult).then((result) => {
      if ("oauthLinkRequired" in result) {
        setGoogleLinkRequired(result);
        setGoogleLinkMode(false);
        setGoogleLinkStep("methods");
        setNotice(phrase("Google 身份已验证，请选择是否关联已有账号。", "Google identity verified. Choose whether to link the existing account."));
        return;
      }
      if ("deviceVerificationRequired" in result) {
        setDeviceChallenge(result);
        setRetryAfter(Math.max(1, result.retryAfterSeconds));
        setNotice(phrase(`验证码已发送至 ${result.emailHint}`, `Verification code sent to ${result.emailHint}`));
        return;
      }
      if ("totpVerificationRequired" in result) {
        setTotpChallenge(result);
        setTotpRecoveryMode(false);
        setNotice(phrase("请输入身份验证器中的 6 位验证码。", "Enter the 6-digit code from your authenticator."));
        return;
      }
      saveAuthTokens(result);
      router.push(localizedPath("/dashboard", locale));
    }).catch((oauthLoadError) => setError(oauthLoadError instanceof Error ? oauthLoadError.message : phrase("Google 登录失败。", "Google sign-in failed."))).finally(() => setIsSubmitting(false));
  }, [locale, phrase, router]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => setPasskeySupported(browserSupportsWebAuthn()),
      0,
    );
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (retryAfter <= 0) return;
    const timer = window.setInterval(() => setRetryAfter((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [retryAfter]);

  useEffect(() => {
    if (googleLinkRetryAfter <= 0) return;
    const timer = window.setInterval(() => setGoogleLinkRetryAfter((value) => Math.max(0, value - 1)), 1000);
    return () => window.clearInterval(timer);
  }, [googleLinkRetryAfter]);

  function handleCancel() {
    isLeavingRef.current = true;
    const returnTo = new URLSearchParams(window.location.search).get("from");

    if (returnTo?.startsWith("/") && !returnTo.startsWith("//") && returnTo !== "/login") {
      router.push(returnTo);
      return;
    }

    router.push(localizedPath("/", locale));
  }

  function cancelGoogleLink() {
    setGoogleLinkRequired(null);
    setGoogleLinkMode(false);
    setGoogleLinkStep("methods");
    setGoogleLinkCode("");
    setGoogleLinkPassword("");
    setGoogleLinkEmailChallenge("");
    setNotice(phrase("本次未关联 Google 账号。", "Google account was not linked."));
  }

  function continueGoogleLink() {
    if (!googleLinkRequired) return;
    setGoogleLinkMode(true);
    setGoogleLinkStep("methods");
    setError("");
    setNotice(phrase("请选择一种方式验证已有账号，验证成功后会直接完成关联并登录。", "Choose one verification method. Linking and sign-in will complete after verification."));
  }

  function resetGoogleLinkVerification() {
    setGoogleLinkStep("methods");
    setGoogleLinkCode("");
    setGoogleLinkPassword("");
    setGoogleLinkEmailChallenge("");
    setGoogleLinkRetryAfter(0);
    setError("");
    setNotice("");
  }

  async function handleGoogleLinkPasskey() {
    if (!googleLinkRequired || isSubmitting || !passkeySupported) return;
    setGoogleLinkStep("passkey");
    setIsSubmitting(true);
    setError("");
    setNotice("");
    try {
      const challenge = await getGoogleLinkPasskeyOptions(googleLinkRequired.pendingToken);
      const response = await startAuthentication({ optionsJSON: challenge.options });
      const result = await verifyGoogleLinkPasskey({ pendingToken: googleLinkRequired.pendingToken, challengeToken: challenge.challengeToken, response });
      if (isLeavingRef.current) return;
      saveAuthTokens(result);
      router.push(postLoginPath());
    } catch (verificationError) {
      if (!isLeavingRef.current) setError(verificationError instanceof Error ? verificationError.message : phrase("通行密钥验证失败。", "Passkey verification failed."));
    } finally {
      if (!isLeavingRef.current) setIsSubmitting(false);
    }
  }

  async function handleGoogleLinkEmail() {
    if (!googleLinkRequired || isSubmitting || googleLinkRetryAfter > 0) return;
    setIsSubmitting(true);
    setError("");
    setNotice("");
    try {
      const result = await requestGoogleLinkEmail(googleLinkRequired.pendingToken);
      setGoogleLinkEmailChallenge(result.challengeToken);
      setGoogleLinkRetryAfter(Math.max(1, result.retryAfterSeconds));
      setNotice(phrase(`验证码已发送至 ${result.emailHint}`, `Verification code sent to ${result.emailHint}`));
    } catch (verificationError) {
      setError(verificationError instanceof Error ? verificationError.message : phrase("验证码发送失败。", "Could not send the verification code."));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleGoogleLinkCode(method: "email" | "totp", code: string) {
    if (!googleLinkRequired || !code.trim() || googleLinkVerificationSubmitRef.current || isSubmitting) return;
    if (method === "email" && !googleLinkEmailChallenge) return;
    googleLinkVerificationSubmitRef.current = true;
    setIsSubmitting(true);
    setError("");
    setNotice("");
    try {
      const result = method === "email"
        ? await verifyGoogleLinkEmail({ pendingToken: googleLinkRequired.pendingToken, challengeToken: googleLinkEmailChallenge, code: code.trim() })
        : await verifyGoogleLinkTotp(googleLinkRequired.pendingToken, code.trim());
      if (isLeavingRef.current) return;
      saveAuthTokens(result);
      router.push(postLoginPath());
    } catch (verificationError) {
      setGoogleLinkCode("");
      setError(verificationError instanceof Error ? verificationError.message : phrase("验证失败。", "Verification failed."));
    } finally {
      googleLinkVerificationSubmitRef.current = false;
      if (!isLeavingRef.current) setIsSubmitting(false);
    }
  }

  async function handleGoogleLinkPasswordSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!googleLinkRequired || !googleLinkPassword.trim() || isSubmitting) return;
    setIsSubmitting(true);
    setError("");
    setNotice("");
    try {
      const result = await verifyGoogleLinkPassword(googleLinkRequired.pendingToken, googleLinkPassword);
      if (isLeavingRef.current) return;
      saveAuthTokens(result);
      router.push(postLoginPath());
    } catch (verificationError) {
      setGoogleLinkPassword("");
      setError(verificationError instanceof Error ? verificationError.message : phrase("验证失败。", "Verification failed."));
    } finally {
      if (!isLeavingRef.current) setIsSubmitting(false);
    }
  }

  function selectGoogleLinkMethod(method: "passkey" | "email" | "totp" | "password") {
    setError("");
    setNotice("");
    setGoogleLinkCode("");
    setGoogleLinkPassword("");
    setGoogleLinkStep(method);
    if (method === "passkey") void handleGoogleLinkPasskey();
    if (method === "email") void handleGoogleLinkEmail();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");

    if (!account.trim() || !password) {
      setError(t("auth.enterAccountPassword"));
      return;
    }
    if (turnstileRequired && !turnstileToken) {
      setError(t("auth.completeTurnstile"));
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await login({
        account,
        password,
        turnstileToken: turnstileToken || undefined,
      });
      if (isLeavingRef.current) return;

      if ("deviceVerificationRequired" in response) {
        setDeviceChallenge(response);
        setDeviceCode("");
        setRetryAfter(Math.max(1, response.retryAfterSeconds));
        setPassword("");
        setTurnstileRequired(false);
        setTurnstileToken("");
        setTurnstileResetKey((value) => value + 1);
        setNotice(phrase(`验证码已发送至 ${response.emailHint}`, `Verification code sent to ${response.emailHint}`));
        return;
      }

      if ("totpVerificationRequired" in response) {
        setTotpChallenge(response);
        setTotpCode("");
        setTotpRecoveryMode(false);
        setPassword("");
        setNotice(phrase("请输入身份验证器中的 6 位验证码。", "Enter the 6-digit code from your authenticator."));
        return;
      }

      saveAuthTokens(response);
      router.push(postLoginPath());
    } catch (loginError) {
      if (isLeavingRef.current) return;

      if (loginError instanceof ApiRequestError && (loginError.code === "TURNSTILE_REQUIRED" || loginError.status === 428)) {
        setTurnstileRequired(true);
        if (!policy) {
          void getSecurityPolicy()
            .then(setPolicy)
            .catch(() => undefined);
        }
      }
      if (turnstileToken) {
        setTurnstileToken("");
        setTurnstileResetKey((value) => value + 1);
      }
      setError(loginError instanceof Error ? loginError.message : t("auth.loginFailed"));
    } finally {
      if (!isLeavingRef.current) setIsSubmitting(false);
    }
  }

  async function handlePasskeyLogin() {
    if (isSubmitting || !passkeySupported) return;
    setIsSubmitting(true);
    setError("");
    setNotice("");
    try {
      const challenge = await getPasskeyLoginOptions();
      const response = await startAuthentication({
        optionsJSON: challenge.options,
      });
      const result = await verifyPasskeyLogin({
        challengeToken: challenge.challengeToken,
        response,
      });
      if (isLeavingRef.current) return;
      if ("deviceVerificationRequired" in result) {
        setDeviceChallenge(result);
        setDeviceCode("");
        setRetryAfter(Math.max(1, result.retryAfterSeconds));
        setTotpChallenge(null);
        setNotice(
          phrase(
            `验证码已发送至 ${result.emailHint}`,
            `Verification code sent to ${result.emailHint}`,
          ),
        );
        return;
      }
      if ("totpVerificationRequired" in result) {
        setTotpChallenge(result);
        setTotpCode("");
        setTotpRecoveryMode(false);
        setDeviceChallenge(null);
        setNotice(
          phrase(
            "请输入身份验证器中的 6 位验证码。",
            "Enter the 6-digit code from your authenticator.",
          ),
        );
        return;
      }
      saveAuthTokens(result);
      router.push(postLoginPath());
    } catch (passkeyError) {
      if (!isLeavingRef.current)
        setError(
          passkeyError instanceof Error
            ? passkeyError.message
            : phrase("通行密钥登录失败。", "Passkey sign-in failed."),
        );
    } finally {
      if (!isLeavingRef.current) setIsSubmitting(false);
    }
  }

  async function handleDeviceVerification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!deviceChallenge || !/^\d{6}$/.test(deviceCode.trim())) {
      setError(t("auth.enterCode"));
      return;
    }

    setIsSubmitting(true);
    setError("");
    setNotice("");
    try {
      const response = await verifyDeviceLogin({
        challengeToken: deviceChallenge.challengeToken,
        code: deviceCode.trim(),
      });
      if (isLeavingRef.current) return;
      if ("totpVerificationRequired" in response) {
        setDeviceChallenge(null);
        setDeviceCode("");
        setRetryAfter(0);
        setTotpChallenge(response);
        setTotpCode("");
        setTotpRecoveryMode(false);
        setNotice(phrase("邮箱验证成功，请输入身份验证器中的 6 位验证码。", "Email verified. Enter the 6-digit code from your authenticator."));
        return;
      }
      saveAuthTokens(response);
      router.push(postLoginPath());
    } catch (verificationError) {
      setError(verificationError instanceof Error ? verificationError.message : t("auth.deviceFailed"));
    } finally {
      if (!isLeavingRef.current) setIsSubmitting(false);
    }
  }

  async function handleResendDeviceCode() {
    if (!deviceChallenge || retryAfter > 0 || isSubmitting) return;
    setIsSubmitting(true);
    setError("");
    setNotice("");
    try {
      const result = await resendDeviceLoginVerification(deviceChallenge.challengeToken);
      setDeviceChallenge((current) =>
        current
          ? {
              ...current,
              emailHint: result.emailHint,
              expiresAt: result.expiresAt,
              retryAfterSeconds: result.retryAfterSeconds,
            }
          : current,
      );
      setRetryAfter(Math.max(1, result.retryAfterSeconds));
      setNotice(phrase(`验证码已重新发送至 ${result.emailHint}`, `Verification code resent to ${result.emailHint}`));
    } catch (resendError) {
      setError(resendError instanceof Error ? resendError.message : t("auth.loginFailed"));
    } finally {
      setIsSubmitting(false);
    }
  }

  function resetDeviceVerification() {
    setDeviceChallenge(null);
    setDeviceCode("");
    setRetryAfter(0);
    setError("");
    setNotice("");
  }

  async function handleTotpVerification(code = totpCode) {
    if (!totpChallenge || !code.trim()) {
      setError(phrase("请输入身份验证器验证码或恢复码。", "Enter an authenticator code or recovery code."));
      return;
    }

    setIsSubmitting(true);
    setError("");
    setNotice("");
    try {
      const response = await verifyTotpLogin({
        challengeToken: totpChallenge.challengeToken,
        code: code.trim(),
      });
      if (isLeavingRef.current) return;
      saveAuthTokens(response);
      router.push(postLoginPath());
    } catch (verificationError) {
      setTotpCode("");
      setError(verificationError instanceof Error ? verificationError.message : phrase("双因素认证失败。", "Two-factor verification failed."));
    } finally {
      if (!isLeavingRef.current) setIsSubmitting(false);
    }
  }

  function postLoginPath() {
    return localizedPath("/dashboard", locale);
  }

  return (
    <section className="auth-page">
      <div className={`auth-panel${totpChallenge ? " auth-panel--verification" : ""}`}>
        <div className="auth-language-control">
          <LanguageSwitcher />
        </div>
        <button aria-label={t("auth.back")} className="auth-close" onClick={handleCancel} title={t("auth.back")} type="button" />
        <div className="auth-panel-head">
          <span className="section-label">HLOVET</span>
          <h1>{googleLinkRequired ? phrase("关联 Google 账号", "Link Google account") : deviceChallenge ? t("auth.newDevice") : totpChallenge ? phrase("双因素验证", "Two-factor verification") : t("auth.accountLogin")}</h1>
        </div>
        <form className="form-stack" onSubmit={googleLinkRequired && googleLinkMode && googleLinkStep === "password" ? handleGoogleLinkPasswordSubmit : googleLinkRequired ? (event) => event.preventDefault() : totpChallenge ? (event) => event.preventDefault() : deviceChallenge ? handleDeviceVerification : handleSubmit}>
          {googleLinkRequired ? (
            googleLinkMode ? (
              googleLinkStep === "methods" ? (
                <div className="auth-google-link-methods">
                  <p>{phrase("请选择一种方式验证已有账号。验证成功后会直接完成 Google 关联并登录。", "Choose a method to verify the existing account. Linking and sign-in will complete after verification.")}</p>
                  {googleLinkRequired.methods.passkey && passkeySupported ? <button className="auth-google-link-method" disabled={isSubmitting} onClick={() => selectGoogleLinkMethod("passkey")} type="button"><Fingerprint aria-hidden="true" size={17} /><span><strong>{phrase("通行密钥", "Passkey")}</strong><small>{phrase("使用已绑定的设备验证", "Use a registered device")}</small></span></button> : null}
                  {googleLinkRequired.methods.email ? <button className="auth-google-link-method" disabled={isSubmitting} onClick={() => selectGoogleLinkMethod("email")} type="button"><Mail aria-hidden="true" size={17} /><span><strong>{phrase("邮箱验证码", "Email code")}</strong><small>{phrase("发送验证码到已绑定邮箱", "Send a code to the account email")}</small></span></button> : null}
                  {googleLinkRequired.methods.totp ? <button className="auth-google-link-method" disabled={isSubmitting} onClick={() => selectGoogleLinkMethod("totp")} type="button"><ShieldCheck aria-hidden="true" size={17} /><span><strong>{phrase("双因素认证", "Two-factor authentication")}</strong><small>{phrase("输入身份验证器中的验证码", "Use your authenticator code")}</small></span></button> : null}
                  {googleLinkRequired.methods.password ? <button className="auth-google-link-method" disabled={isSubmitting} onClick={() => selectGoogleLinkMethod("password")} type="button"><KeyRound aria-hidden="true" size={17} /><span><strong>{phrase("当前密码", "Current password")}</strong><small>{phrase("输入已有账号的当前密码", "Enter the existing account password")}</small></span></button> : null}
                  <button className="button secondary" disabled={isSubmitting} onClick={cancelGoogleLink} type="button">{phrase("暂不关联", "Not now")}</button>
                </div>
              ) : (
                <div className="auth-google-link-verification">
                  <button className="text-action" disabled={isSubmitting} onClick={resetGoogleLinkVerification} type="button">{phrase("返回验证方式", "Back to methods")}</button>
                  {googleLinkStep === "passkey" ? <><p>{phrase("请在设备或浏览器窗口中完成通行密钥验证。", "Complete passkey verification in your device or browser prompt.")}</p><button className="button secondary" disabled={isSubmitting} onClick={() => void handleGoogleLinkPasskey()} type="button">{phrase("重试通行密钥", "Try passkey again")}</button></> : null}
                  {googleLinkStep === "email" ? <><p>{phrase("请输入发送到邮箱的 6 位验证码，输入完成后自动验证。", "Enter the 6-digit email code. It verifies automatically when complete.")}</p><OtpCodeInput ariaLabel={phrase("邮箱验证码", "Email verification code")} autoFocus disabled={isSubmitting} onChange={setGoogleLinkCode} onComplete={(code) => void handleGoogleLinkCode("email", code)} value={googleLinkCode} /><button className="text-action" disabled={isSubmitting || googleLinkRetryAfter > 0} onClick={() => void handleGoogleLinkEmail()} type="button">{googleLinkRetryAfter > 0 ? `${googleLinkRetryAfter}s` : phrase("重新发送验证码", "Resend code")}</button></> : null}
                  {googleLinkStep === "totp" ? <><p>{phrase("请输入身份验证器中的 6 位验证码，输入完成后自动验证。", "Enter the 6-digit authenticator code. It verifies automatically when complete.")}</p><OtpCodeInput ariaLabel={phrase("身份验证器验证码", "Authenticator code")} autoFocus disabled={isSubmitting} onChange={setGoogleLinkCode} onComplete={(code) => void handleGoogleLinkCode("totp", code)} value={googleLinkCode} /></> : null}
                  {googleLinkStep === "password" ? <><p>{phrase("请输入已有账号的当前密码。", "Enter the current password for the existing account.")}</p><PasswordInput autoComplete="current-password" autoFocus disabled={isSubmitting} onChange={(event) => setGoogleLinkPassword(event.target.value)} value={googleLinkPassword} /><button className="button" disabled={isSubmitting || !googleLinkPassword.trim()} type="submit">{isSubmitting ? phrase("验证中", "Verifying") : phrase("确认验证", "Verify")}</button></> : null}
                </div>
              )
            ) : (
            <div className="auth-google-link-choice">
              <p>{phrase(`Google 邮箱 ${googleLinkRequired.email} 已对应一个本地账号。为避免创建重复邮箱账号，请选择是否关联。`, `The Google email ${googleLinkRequired.email} already belongs to a local account. Choose whether to link it to avoid a duplicate email account.`)}</p>
              <div className="actions">
                <button className="button" onClick={continueGoogleLink} type="button">{phrase("关联已有账号", "Link existing account")}</button>
                <button className="button secondary" onClick={cancelGoogleLink} type="button">{phrase("暂不关联", "Not now")}</button>
              </div>
            </div>
            )
          ) : deviceChallenge ? (
            <>
              <label>
                <span>{t("auth.emailCode")}</span>
                <input autoComplete="one-time-code" autoFocus inputMode="numeric" maxLength={6} name="device-code" onChange={(event) => setDeviceCode(event.target.value.replace(/\D/g, "").slice(0, 6))} placeholder={phrase(`已发送至 ${deviceChallenge.emailHint}`, `Sent to ${deviceChallenge.emailHint}`)} value={deviceCode} />
              </label>
              <div className="auth-code-actions">
                <button className="text-action primary" disabled={isSubmitting || retryAfter > 0} onClick={() => void handleResendDeviceCode()} type="button">
                  {retryAfter > 0 ? `${retryAfter}s` : t("auth.resend")}
                </button>
              </div>
              <div className="actions">
                <button className="button" disabled={isSubmitting} type="submit">
                  {isSubmitting ? t("auth.verifying") : t("auth.verifyAndLogin")}
                </button>
                <button className="button secondary" disabled={isSubmitting} onClick={resetDeviceVerification} type="button">
                  {t("auth.backToLogin")}
                </button>
              </div>
            </>
          ) : totpChallenge ? (
            <>
              <div className="auth-totp-verification">
                <span>{totpRecoveryMode ? phrase("恢复码（6 位）", "Recovery code (6 characters)") : phrase("身份验证器验证码", "Authenticator code")}</span>
                {totpRecoveryMode ? (
                  <OtpCodeInput
                    allowLetters
                    autoFocus
                    ariaLabel={phrase("恢复码", "Recovery code")}
                    disabled={isSubmitting}
                    onChange={setTotpCode}
                    onComplete={(code) => void handleTotpVerification(code)}
                    value={totpCode}
                  />
                ) : (
                  <OtpCodeInput
                    ariaLabel={phrase("身份验证器验证码", "Authenticator code")}
                    autoFocus
                    disabled={isSubmitting}
                    onChange={setTotpCode}
                    onComplete={(code) => void handleTotpVerification(code)}
                    value={totpCode}
                  />
                )}
                <button
                  className="text-action auth-totp-recovery-toggle"
                  disabled={isSubmitting}
                  onClick={() => {
                    setTotpCode("");
                    setTotpRecoveryMode((current) => !current);
                    setError("");
                  }}
                  type="button"
                >
                  {totpRecoveryMode ? phrase("使用身份验证器", "Use authenticator") : phrase("使用恢复码", "Use recovery code")}
                </button>
              </div>
            </>
          ) : (
            <>
              <label>
                <span>{t("auth.account")}</span>
                <input autoComplete="username" name="account" onChange={(event) => setAccount(event.target.value)} value={account} />
              </label>
              <label>
                <span className="auth-label-row">
                  <span>{t("auth.password")}</span>
                  <Link href={localizedPath("/forgot-password", locale)}>{t("auth.forgotPassword")}</Link>
                </span>
                <PasswordInput autoComplete="current-password" name="password" onChange={(event) => setPassword(event.target.value)} value={password} />
              </label>
              {turnstileRequired ? (
                <div className="auth-turnstile-field">
                  <span>{t("auth.securityCheck")}</span>
                  <TurnstileWidget action="login" onTokenChange={setTurnstileToken} resetKey={turnstileResetKey} siteKey={policy?.turnstile.siteKey ?? ""} />
                </div>
              ) : null}
              <div className="actions">
                <button className="button" disabled={isSubmitting} type="submit">
                  {isSubmitting ? t("auth.loggingIn") : t("auth.login")}
                </button>
                <Link className="button secondary" href={localizedPath("/register", locale)}>
                  {t("auth.register")}
                </Link>
              </div>
              {passkeySupported ? (
                <button
                  className="auth-passkey-button"
                  disabled={isSubmitting}
                  onClick={() => void handlePasskeyLogin()}
                  type="button"
                >
                  <Fingerprint aria-hidden="true" size={17} />
                  {phrase("使用通行密钥登录", "Sign in with a passkey")}
                </button>
              ) : null}
              {googleEnabled ? (
                <button className="auth-passkey-button" disabled={isSubmitting || googleLinkMode} onClick={() => { window.location.href = `${getBrowserApiBaseUrl()}/auth/google/start?returnTo=${encodeURIComponent(new URLSearchParams(window.location.search).get("from") || "/dashboard")}`; }} type="button">
                  <img alt="" aria-hidden="true" className="google-brand-icon" height="17" src="/google-g.svg" width="17" />
                  {phrase("使用 Google 登录", "Continue with Google")}
                </button>
              ) : null}
            </>
          )}
        </form>
      </div>
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
