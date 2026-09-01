"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Fingerprint } from "lucide-react";
import { browserSupportsWebAuthn, startAuthentication } from "@simplewebauthn/browser";
import { FormEvent, useEffect, useRef, useState } from "react";
import { AppToast } from "@/components/app-toast";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useLanguage } from "@/components/language-provider";
import { OtpCodeInput } from "@/components/otp-code-input";
import { PasswordInput } from "@/components/password-input";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { ApiRequestError, getPasskeyLoginOptions, login, resendDeviceLoginVerification, type DeviceLoginVerificationRequired, type TotpVerificationRequired, verifyDeviceLogin, verifyPasskeyLogin, verifyTotpLogin } from "@/lib/auth-api";
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

  function handleCancel() {
    isLeavingRef.current = true;
    const returnTo = new URLSearchParams(window.location.search).get("from");

    if (returnTo?.startsWith("/") && !returnTo.startsWith("//") && returnTo !== "/login") {
      router.push(returnTo);
      return;
    }

    router.push(localizedPath("/", locale));
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
      router.push(localizedPath("/dashboard", locale));
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
      router.push(localizedPath("/dashboard", locale));
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
      router.push(localizedPath("/dashboard", locale));
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
      router.push(localizedPath("/dashboard", locale));
    } catch (verificationError) {
      setTotpCode("");
      setError(verificationError instanceof Error ? verificationError.message : phrase("双因素认证失败。", "Two-factor verification failed."));
    } finally {
      if (!isLeavingRef.current) setIsSubmitting(false);
    }
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
          <h1>{deviceChallenge ? t("auth.newDevice") : totpChallenge ? phrase("双因素验证", "Two-factor verification") : t("auth.accountLogin")}</h1>
        </div>
        <form className="form-stack" onSubmit={totpChallenge ? (event) => event.preventDefault() : deviceChallenge ? handleDeviceVerification : handleSubmit}>
          {deviceChallenge ? (
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
