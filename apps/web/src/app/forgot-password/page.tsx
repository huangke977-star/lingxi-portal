"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { AppToast } from "@/components/app-toast";
import { PasswordInput } from "@/components/password-input";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { useLanguage } from "@/components/language-provider";
import { localizedPath } from "@/lib/i18n";
import {
  getSecurityPolicy,
  requestPasswordRecovery,
  resetPassword,
  type SecurityPolicy,
} from "@/lib/security-api";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const { locale, t } = useLanguage();
  const [resetToken, setResetToken] = useState<string | null>(null);
  const [policy, setPolicy] = useState<SecurityPolicy | null>(null);
  const [email, setEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [requestComplete, setRequestComplete] = useState(false);
  const [resetComplete, setResetComplete] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setResetToken(
        new URLSearchParams(window.location.search).get("token") ?? "",
      );
      getSecurityPolicy().then(setPolicy).catch(() => undefined);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const requiresTurnstile = policy?.turnstile.recoveryEnabled ?? false;
  const recoveryDisabled = policy?.passwordRecoveryEnabled === false;

  function resetChallenge() {
    if (!requiresTurnstile) return;
    setTurnstileToken("");
    setTurnstileResetKey((value) => value + 1);
  }

  async function handleRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!email.trim()) {
      setError(t("auth.enterEmail"));
      return;
    }
    if (requiresTurnstile && !turnstileToken) {
      setError(t("auth.completeTurnstile"));
      return;
    }

    setIsSubmitting(true);
    try {
      await requestPasswordRecovery(email.trim(), turnstileToken || undefined);
      setRequestComplete(true);
      setNotice(t("auth.recoveryEmailSent"));
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : t("auth.recoveryEmailFailed"),
      );
    } finally {
      setIsSubmitting(false);
      resetChallenge();
    }
  }

  async function handleReset(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!resetToken) {
      setError(t("auth.invalidResetLink"));
      return;
    }
    if (newPassword.length < 8) {
      setError(t("auth.passwordAtLeastEight"));
      return;
    }
    if (newPassword !== confirmation) {
      setError(t("auth.passwordMismatch"));
      return;
    }
    if (requiresTurnstile && !turnstileToken) {
      setError(t("auth.completeTurnstile"));
      return;
    }

    setIsSubmitting(true);
    try {
      await resetPassword({
        token: resetToken,
        newPassword,
        turnstileToken: turnstileToken || undefined,
      });
      setResetComplete(true);
      setNotice(t("auth.passwordResetDone"));
    } catch (resetError) {
      setError(
        resetError instanceof Error ? resetError.message : "密码重置失败。",
      );
      resetChallenge();
    } finally {
      setIsSubmitting(false);
    }
  }

  if (resetToken === null) {
    return (
      <section className="auth-page">
        <div className="auth-panel auth-loading-panel">
          <span className="status">{t("auth.recoveryLinkLoading")}</span>
        </div>
      </section>
    );
  }

  const isResetMode = Boolean(resetToken);
  return (
    <section className="auth-page">
      <div className="auth-panel">
        <button
          aria-label={t("auth.backToLogin")}
          className="auth-close"
          onClick={() => router.push(localizedPath("/login", locale))}
          title={t("auth.backToLogin")}
          type="button"
        />
        <div className="auth-panel-head">
          <span className="section-label">{t("auth.accountRecovery")}</span>
          <h1>{isResetMode ? t("auth.setNewPassword") : t("auth.requestPasswordReset")}</h1>
        </div>

        {recoveryDisabled ? (
          <div className="auth-inline-notice">{t("auth.passwordRecoveryDisabled")}</div>
        ) : isResetMode ? (
          resetComplete ? (
            <div className="auth-result-panel">
              <strong>{t("auth.passwordUpdated")}</strong>
              <Link className="text-action primary" href={localizedPath("/login", locale)}>
                {t("auth.backToLogin")}
              </Link>
            </div>
          ) : (
            <form className="form-stack" onSubmit={handleReset}>
              <label>
                <span>{t("auth.newPassword")}</span>
                <PasswordInput
                  autoComplete="new-password"
                  minLength={8}
                  onChange={(event) => setNewPassword(event.target.value)}
                  required
                  value={newPassword}
                />
              </label>
              <label>
                <span>{t("auth.confirmPassword")}</span>
                <PasswordInput
                  autoComplete="new-password"
                  minLength={8}
                  onChange={(event) => setConfirmation(event.target.value)}
                  required
                  value={confirmation}
                />
              </label>
              {requiresTurnstile ? (
                <div className="auth-turnstile-field">
                  <span>{t("auth.securityCheck")}</span>
                  <TurnstileWidget
                    action="password-reset"
                    onTokenChange={setTurnstileToken}
                    resetKey={turnstileResetKey}
                    siteKey={policy?.turnstile.siteKey ?? ""}
                  />
                </div>
              ) : null}
              <button className="button" disabled={isSubmitting} type="submit">
                {isSubmitting ? t("auth.resetting") : t("auth.resetPassword")}
              </button>
            </form>
          )
        ) : requestComplete ? (
          <div className="auth-result-panel">
            <strong>{t("auth.checkEmail")}</strong>
            <p>{t("auth.resetEmailNote")}</p>
            <button
              className="text-action primary"
              onClick={() => setRequestComplete(false)}
              type="button"
            >
              {t("auth.resend")}
            </button>
          </div>
        ) : (
          <form className="form-stack" onSubmit={handleRequest}>
            <label>
              <span>{t("auth.registeredEmail")}</span>
              <input
                autoComplete="email"
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
                value={email}
              />
            </label>
            {requiresTurnstile ? (
              <div className="auth-turnstile-field">
                <span>{t("auth.securityCheck")}</span>
                <TurnstileWidget
                  action="password-recovery"
                  onTokenChange={setTurnstileToken}
                  resetKey={turnstileResetKey}
                  siteKey={policy?.turnstile.siteKey ?? ""}
                />
              </div>
            ) : null}
            <button className="button" disabled={isSubmitting} type="submit">
              {isSubmitting ? t("auth.sending") : t("auth.sendRecoveryEmail")}
            </button>
          </form>
        )}
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
