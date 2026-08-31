"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { AppToast } from "@/components/app-toast";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useLanguage } from "@/components/language-provider";
import { PasswordInput } from "@/components/password-input";
import { TurnstileWidget } from "@/components/turnstile-widget";
import {
  ApiRequestError,
  login,
  resendDeviceLoginVerification,
  type DeviceLoginVerificationRequired,
  verifyDeviceLogin,
} from "@/lib/auth-api";
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
  const [deviceChallenge, setDeviceChallenge] =
    useState<DeviceLoginVerificationRequired | null>(null);
  const [totpRequired, setTotpRequired] = useState(false);
  const [totpCode, setTotpCode] = useState("");
  const [deviceCode, setDeviceCode] = useState("");
  const [retryAfter, setRetryAfter] = useState(0);
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
    if (retryAfter <= 0) return;
    const timer = window.setInterval(
      () => setRetryAfter((value) => Math.max(0, value - 1)),
      1000,
    );
    return () => window.clearInterval(timer);
  }, [retryAfter]);

  function handleCancel() {
    isLeavingRef.current = true;
    const returnTo = new URLSearchParams(window.location.search).get("from");

    if (
      returnTo?.startsWith("/") &&
      !returnTo.startsWith("//") &&
      returnTo !== "/login"
    ) {
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
        totpCode: totpCode.trim() || undefined,
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
        setTotpRequired(true);
        setTotpCode("");
        setNotice(phrase("请输入身份验证器中的 6 位验证码。", "Enter the 6-digit code from your authenticator."));
        return;
      }

      saveAuthTokens(response);
      router.push(localizedPath("/dashboard", locale));
    } catch (loginError) {
      if (isLeavingRef.current) return;

      if (
        loginError instanceof ApiRequestError &&
        (loginError.code === "TURNSTILE_REQUIRED" || loginError.status === 428)
      ) {
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
      setError(
        loginError instanceof Error
          ? loginError.message
          : t("auth.loginFailed"),
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
      saveAuthTokens(response);
      router.push(localizedPath("/dashboard", locale));
    } catch (verificationError) {
      setError(
        verificationError instanceof Error
          ? verificationError.message
          : t("auth.deviceFailed"),
      );
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
      const result = await resendDeviceLoginVerification(
        deviceChallenge.challengeToken,
      );
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
      setError(
        resendError instanceof Error ? resendError.message : t("auth.loginFailed"),
      );
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

  return (
    <section className="auth-page">
      <div className="auth-panel">
        <div className="auth-language-control"><LanguageSwitcher /></div>
        <button
          aria-label={t("auth.back")}
          className="auth-close"
          onClick={handleCancel}
          title={t("auth.back")}
          type="button"
        />
        <div className="auth-panel-head">
          <span className="section-label">HLOVET</span>
          <h1>{deviceChallenge ? t("auth.newDevice") : totpRequired ? phrase("双因素验证", "Two-factor verification") : t("auth.accountLogin")}</h1>
        </div>
        <form
          className="form-stack"
          onSubmit={deviceChallenge ? handleDeviceVerification : handleSubmit}
        >
          {deviceChallenge ? (
            <>
              <label>
                <span>{t("auth.emailCode")}</span>
                <input
                  autoComplete="one-time-code"
                  autoFocus
                  inputMode="numeric"
                  maxLength={6}
                  name="device-code"
                  onChange={(event) =>
                    setDeviceCode(
                      event.target.value.replace(/\D/g, "").slice(0, 6),
                    )
                  }
                  placeholder={phrase(`已发送至 ${deviceChallenge.emailHint}`, `Sent to ${deviceChallenge.emailHint}`)}
                  value={deviceCode}
                />
              </label>
              <div className="auth-code-actions">
                <button
                  className="text-action primary"
                  disabled={isSubmitting || retryAfter > 0}
                  onClick={() => void handleResendDeviceCode()}
                  type="button"
                >
                  {retryAfter > 0 ? `${retryAfter}s` : t("auth.resend")}
                </button>
              </div>
              <div className="actions">
                <button
                  className="button"
                  disabled={isSubmitting}
                  type="submit"
                >
                  {isSubmitting ? t("auth.verifying") : t("auth.verifyAndLogin")}
                </button>
                <button
                  className="button secondary"
                  disabled={isSubmitting}
                  onClick={resetDeviceVerification}
                  type="button"
                >
                  {t("auth.backToLogin")}
                </button>
              </div>
            </>
          ) : (
            <>
              <label>
                <span>{t("auth.account")}</span>
                <input
                  autoComplete="username"
                  name="account"
                  onChange={(event) => setAccount(event.target.value)}
                  value={account}
                />
              </label>
              <label>
                <span className="auth-label-row">
                  <span>{t("auth.password")}</span>
                  <Link href={localizedPath("/forgot-password", locale)}>{t("auth.forgotPassword")}</Link>
                </span>
                <PasswordInput
                  autoComplete="current-password"
                  name="password"
                  onChange={(event) => setPassword(event.target.value)}
                  value={password}
                />
              </label>
              {totpRequired ? (
                <label>
                  <span>{phrase("身份验证器验证码", "Authenticator code")}</span>
                  <input
                    autoComplete="one-time-code"
                    autoFocus
                    inputMode="numeric"
                    maxLength={6}
                    onChange={(event) => setTotpCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                    placeholder={phrase("输入 6 位验证码或恢复码", "Enter a 6-digit code or recovery code")}
                    value={totpCode}
                  />
                </label>
              ) : null}
              {turnstileRequired ? (
                <div className="auth-turnstile-field">
                  <span>{t("auth.securityCheck")}</span>
                  <TurnstileWidget
                    action="login"
                    onTokenChange={setTurnstileToken}
                    resetKey={turnstileResetKey}
                    siteKey={policy?.turnstile.siteKey ?? ""}
                  />
                </div>
              ) : null}
              <div className="actions">
                <button
                  className="button"
                  disabled={isSubmitting}
                  type="submit"
                >
                  {isSubmitting ? t("auth.loggingIn") : t("auth.login")}
                </button>
                <Link className="button secondary" href={localizedPath("/register", locale)}>
                  {t("auth.register")}
                </Link>
              </div>
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
