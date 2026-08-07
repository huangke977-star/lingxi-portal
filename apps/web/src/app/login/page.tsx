"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { AppToast } from "@/components/app-toast";
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

export default function LoginPage() {
  const router = useRouter();
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

    router.push("/");
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");

    if (!account.trim() || !password) {
      setError("请输入账号和密码。");
      return;
    }
    if (turnstileRequired && !turnstileToken) {
      setError("请先完成人机验证。");
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
        setNotice(`验证码已发送至 ${response.emailHint}`);
        return;
      }

      saveAuthTokens(response);
      router.push("/dashboard");
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
          : "登录失败，请稍后重试。",
      );
    } finally {
      if (!isLeavingRef.current) setIsSubmitting(false);
    }
  }

  async function handleDeviceVerification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!deviceChallenge || !/^\d{6}$/.test(deviceCode.trim())) {
      setError("请输入 6 位邮箱验证码。");
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
      router.push("/dashboard");
    } catch (verificationError) {
      setError(
        verificationError instanceof Error
          ? verificationError.message
          : "设备验证失败，请重新登录。",
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
      setNotice(`验证码已重新发送至 ${result.emailHint}`);
    } catch (resendError) {
      setError(
        resendError instanceof Error ? resendError.message : "验证码发送失败。",
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
        <button
          aria-label="返回上一页"
          className="auth-close"
          onClick={handleCancel}
          title="返回上一页"
          type="button"
        />
        <div className="auth-panel-head">
          <span className="section-label">HLOVET</span>
          <h1>{deviceChallenge ? "验证新设备" : "账号登录"}</h1>
        </div>
        <form
          className="form-stack"
          onSubmit={deviceChallenge ? handleDeviceVerification : handleSubmit}
        >
          {deviceChallenge ? (
            <>
              <label>
                <span>邮箱验证码</span>
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
                  placeholder={`已发送至 ${deviceChallenge.emailHint}`}
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
                  {retryAfter > 0 ? `${retryAfter} 秒后重发` : "重新发送"}
                </button>
              </div>
              <div className="actions">
                <button
                  className="button"
                  disabled={isSubmitting}
                  type="submit"
                >
                  {isSubmitting ? "验证中" : "验证并登录"}
                </button>
                <button
                  className="button secondary"
                  disabled={isSubmitting}
                  onClick={resetDeviceVerification}
                  type="button"
                >
                  返回登录
                </button>
              </div>
            </>
          ) : (
            <>
              <label>
                <span>账号或邮箱</span>
                <input
                  autoComplete="username"
                  name="account"
                  onChange={(event) => setAccount(event.target.value)}
                  value={account}
                />
              </label>
              <label>
                <span className="auth-label-row">
                  <span>密码</span>
                  <Link href="/forgot-password">忘记密码</Link>
                </span>
                <PasswordInput
                  autoComplete="current-password"
                  name="password"
                  onChange={(event) => setPassword(event.target.value)}
                  value={password}
                />
              </label>
              {turnstileRequired ? (
                <div className="auth-turnstile-field">
                  <span>安全验证</span>
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
                  {isSubmitting ? "登录中" : "登录"}
                </button>
                <Link className="button secondary" href="/register">
                  注册账号
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
