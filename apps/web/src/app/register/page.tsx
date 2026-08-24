"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { AppToast } from "@/components/app-toast";
import { LanguageSwitcher } from "@/components/language-switcher";
import { useLanguage } from "@/components/language-provider";
import { PasswordInput } from "@/components/password-input";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { register } from "@/lib/auth-api";
import { saveAuthTokens } from "@/lib/auth-storage";
import {
  getSecurityPolicy,
  requestRegistrationCode,
  type SecurityPolicy,
} from "@/lib/security-api";
import { getPublicSiteSettings } from "@/lib/site-settings-api";
import { localizedPath } from "@/lib/i18n";

export default function RegisterPage() {
  const router = useRouter();
  const { locale, phrase, t } = useLanguage();
  const [username, setUsername] = useState("");
  const [nickname, setNickname] = useState("");
  const [email, setEmail] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [registrationOpen, setRegistrationOpen] = useState(true);
  const [policy, setPolicy] = useState<SecurityPolicy | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSendingCode, setIsSendingCode] = useState(false);
  const [codeSentTo, setCodeSentTo] = useState("");
  const [retryAfter, setRetryAfter] = useState(0);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  const [isCodeChallengeVisible, setIsCodeChallengeVisible] = useState(false);

  useEffect(() => {
    let active = true;
    Promise.allSettled([getPublicSiteSettings(), getSecurityPolicy()]).then(
      ([siteResult, securityResult]) => {
        if (!active) return;
        if (siteResult.status === "fulfilled") {
          setRegistrationOpen(siteResult.value.registrationOpen);
        }
        if (securityResult.status === "fulfilled") {
          setPolicy(securityResult.value);
        }
      },
    );
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

  const requiresEmailCode =
    policy?.registrationEmailVerificationEnabled ?? false;
  const registrationTurnstileEnabled =
    policy?.turnstile.registrationEnabled ?? false;
  const requiresCodeTurnstile =
    requiresEmailCode && registrationTurnstileEnabled;
  const requiresRegistrationTurnstile =
    !requiresEmailCode && registrationTurnstileEnabled;
  const normalizedEmail = email.trim().toLowerCase();
  const codeMatchesCurrentEmail =
    Boolean(codeSentTo) && codeSentTo === normalizedEmail;
  const showCodeTurnstile =
    requiresCodeTurnstile &&
    (!codeMatchesCurrentEmail || isCodeChallengeVisible);

  async function handleSendCode() {
    setError("");
    setNotice("");
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) {
      setError(t("auth.validEmail"));
      return;
    }
    if (requiresCodeTurnstile && !turnstileToken) {
      setIsCodeChallengeVisible(true);
      setError(phrase("请先完成人机验证。", "Complete the human verification first."));
      return;
    }

    setIsSendingCode(true);
    try {
      const result = await requestRegistrationCode(
        normalizedEmail,
        turnstileToken || undefined,
      );
      setCodeSentTo(normalizedEmail);
      setIsCodeChallengeVisible(false);
      setRetryAfter(Math.max(1, result.retryAfterSeconds || 60));
      setNotice(t("auth.codeSent"));
    } catch (sendError) {
      setError(
        sendError instanceof Error ? sendError.message : phrase("验证码发送失败。", "Could not send verification code."),
      );
    } finally {
      setIsSendingCode(false);
      if (requiresCodeTurnstile) {
        setTurnstileToken("");
        setTurnstileResetKey((value) => value + 1);
      }
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");

    if (!registrationOpen) {
      setError(t("auth.registrationClosedShort"));
      return;
    }
    if (
      !username.trim() ||
      !nickname.trim() ||
      !email.trim() ||
      !password ||
      !confirmation
    ) {
      setError(t("auth.completeFields"));
      return;
    }
    if (requiresEmailCode && !verificationCode.trim()) {
      setError(t("auth.enterEmailCode"));
      return;
    }
    if (requiresRegistrationTurnstile && !turnstileToken) {
      setError(phrase("请先完成人机验证。", "Complete the human verification first."));
      return;
    }
    if (password !== confirmation) {
      setError(t("auth.passwordMismatch"));
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await register({
        username,
        nickname,
        email,
        password,
        verificationCode: verificationCode.trim() || undefined,
        turnstileToken: requiresRegistrationTurnstile
          ? turnstileToken || undefined
          : undefined,
      });
      saveAuthTokens(response);
      router.push(localizedPath("/dashboard", locale));
    } catch (registerError) {
      setError(
        registerError instanceof Error
          ? registerError.message
          : t("auth.registrationFailed"),
      );
      if (requiresRegistrationTurnstile) {
        setTurnstileToken("");
        setTurnstileResetKey((value) => value + 1);
      }
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="auth-page auth-page-scrollable">
      <div className="auth-panel auth-panel-wide">
        <div className="auth-language-control"><LanguageSwitcher /></div>
        <div className="auth-panel-head">
          <span className="section-label">HLOVET</span>
          <h1>{t("auth.createAccount")}</h1>
        </div>
        <form className="form-stack" onSubmit={handleSubmit}>
          {!registrationOpen ? (
            <div className="auth-inline-notice">
              {t("auth.registrationClosed")}
            </div>
          ) : null}
          <label>
            <span>{t("auth.username")}</span>
            <input
              autoComplete="username"
              maxLength={32}
              name="username"
              onChange={(event) => setUsername(event.target.value)}
              required
              value={username}
            />
          </label>
          <label>
            <span>{t("auth.nickname")}</span>
            <input
              autoComplete="nickname"
              name="nickname"
              onChange={(event) =>
                setNickname(limitCharacterCount(event.target.value, 24))
              }
              required
              value={nickname}
            />
          </label>
          <label>
            <span>{t("auth.email")}</span>
            <input
              autoComplete="email"
              name="email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>
          {requiresEmailCode ? (
            <>
              {showCodeTurnstile ? (
                <div className="auth-turnstile-field">
                  <span>{t("auth.securityCheck")}</span>
                  <TurnstileWidget
                    action="registration-code"
                    onTokenChange={setTurnstileToken}
                    resetKey={turnstileResetKey}
                    siteKey={policy?.turnstile.siteKey ?? ""}
                  />
                </div>
              ) : null}
              <label>
                <span className="auth-label-row">
                  <span>{t("auth.emailCode")}</span>
                  {codeMatchesCurrentEmail ? (
                    <small>{t("auth.sentTo", { email: codeSentTo })}</small>
                  ) : null}
                </span>
                <span className="auth-code-row">
                  <input
                    autoComplete="one-time-code"
                    inputMode="numeric"
                    maxLength={8}
                    onChange={(event) => setVerificationCode(event.target.value)}
                    value={verificationCode}
                  />
                  <button
                    className="text-action primary"
                    disabled={isSendingCode || retryAfter > 0}
                    onClick={() => void handleSendCode()}
                    type="button"
                  >
                    {isSendingCode
                      ? t("auth.sending")
                      : retryAfter > 0
                        ? phrase(`${retryAfter} 秒后重发`, `Resend in ${retryAfter}s`)
                        : codeMatchesCurrentEmail
                          ? t("auth.resend")
                          : t("auth.sendCode")}
                  </button>
                </span>
              </label>
            </>
          ) : null}
          <label>
            <span>{t("auth.password")}</span>
            <PasswordInput
              autoComplete="new-password"
              name="password"
              onChange={(event) => setPassword(event.target.value)}
              required
              value={password}
            />
          </label>
          <label>
            <span>{t("auth.confirmPassword")}</span>
            <PasswordInput
              autoComplete="new-password"
              name="confirmation"
              onChange={(event) => setConfirmation(event.target.value)}
              required
              value={confirmation}
            />
          </label>
          {requiresRegistrationTurnstile ? (
            <div className="auth-turnstile-field">
              <span>{t("auth.securityCheck")}</span>
              <TurnstileWidget
                action="register"
                onTokenChange={setTurnstileToken}
                resetKey={turnstileResetKey}
                siteKey={policy?.turnstile.siteKey ?? ""}
              />
            </div>
          ) : null}
          <div className="actions">
            <button
              className="button"
              disabled={isSubmitting || !registrationOpen}
              type="submit"
            >
              {isSubmitting ? t("auth.registering") : t("auth.register")}
            </button>
            <Link className="button secondary" href={localizedPath("/login", locale)}>
              {t("auth.backToLogin")}
            </Link>
          </div>
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

function limitCharacterCount(value: string, maximum: number): string {
  return Array.from(value).slice(0, maximum).join("");
}
