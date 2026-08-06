"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { AppToast } from "@/components/app-toast";
import { PasswordInput } from "@/components/password-input";
import { TurnstileWidget } from "@/components/turnstile-widget";
import {
  getSecurityPolicy,
  requestPasswordRecovery,
  resetPassword,
  type SecurityPolicy,
} from "@/lib/security-api";

export default function ForgotPasswordPage() {
  const router = useRouter();
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
      setError("请输入邮箱地址。");
      return;
    }
    if (requiresTurnstile && !turnstileToken) {
      setError("请先完成人机验证。");
      return;
    }

    setIsSubmitting(true);
    try {
      await requestPasswordRecovery(email.trim(), turnstileToken || undefined);
      setRequestComplete(true);
      setNotice("找回邮件已发送，请检查邮箱。");
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "找回邮件发送失败。",
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
      setError("重置链接无效，请重新申请。");
      return;
    }
    if (newPassword.length < 8) {
      setError("新密码至少需要 8 位。");
      return;
    }
    if (newPassword !== confirmation) {
      setError("两次输入的密码不一致。");
      return;
    }
    if (requiresTurnstile && !turnstileToken) {
      setError("请先完成人机验证。");
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
      setNotice("密码已重置，请使用新密码登录。");
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
          <span className="status">正在读取重置链接</span>
        </div>
      </section>
    );
  }

  const isResetMode = Boolean(resetToken);
  return (
    <section className="auth-page">
      <div className="auth-panel">
        <button
          aria-label="返回登录"
          className="auth-close"
          onClick={() => router.push("/login")}
          title="返回登录"
          type="button"
        />
        <div className="auth-panel-head">
          <span className="section-label">Account recovery</span>
          <h1>{isResetMode ? "设置新密码" : "找回密码"}</h1>
        </div>

        {recoveryDisabled ? (
          <div className="auth-inline-notice">当前站点未开启密码找回。</div>
        ) : isResetMode ? (
          resetComplete ? (
            <div className="auth-result-panel">
              <strong>密码已更新</strong>
              <Link className="text-action primary" href="/login">
                返回登录
              </Link>
            </div>
          ) : (
            <form className="form-stack" onSubmit={handleReset}>
              <label>
                <span>新密码</span>
                <PasswordInput
                  autoComplete="new-password"
                  minLength={8}
                  onChange={(event) => setNewPassword(event.target.value)}
                  required
                  value={newPassword}
                />
              </label>
              <label>
                <span>确认新密码</span>
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
                  <span>安全验证</span>
                  <TurnstileWidget
                    action="password-reset"
                    onTokenChange={setTurnstileToken}
                    resetKey={turnstileResetKey}
                    siteKey={policy?.turnstile.siteKey ?? ""}
                  />
                </div>
              ) : null}
              <button className="button" disabled={isSubmitting} type="submit">
                {isSubmitting ? "提交中" : "重置密码"}
              </button>
            </form>
          )
        ) : requestComplete ? (
          <div className="auth-result-panel">
            <strong>请检查邮箱</strong>
            <p>若该邮箱已注册，重置链接会发送到邮箱中。</p>
            <button
              className="text-action primary"
              onClick={() => setRequestComplete(false)}
              type="button"
            >
              重新发送
            </button>
          </div>
        ) : (
          <form className="form-stack" onSubmit={handleRequest}>
            <label>
              <span>注册邮箱</span>
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
                <span>安全验证</span>
                <TurnstileWidget
                  action="password-recovery"
                  onTokenChange={setTurnstileToken}
                  resetKey={turnstileResetKey}
                  siteKey={policy?.turnstile.siteKey ?? ""}
                />
              </div>
            ) : null}
            <button className="button" disabled={isSubmitting} type="submit">
              {isSubmitting ? "发送中" : "发送找回邮件"}
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
