"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { AppToast } from "@/components/app-toast";
import { PasswordInput } from "@/components/password-input";
import { TurnstileWidget } from "@/components/turnstile-widget";
import { ApiRequestError, login } from "@/lib/auth-api";
import { saveAuthTokens } from "@/lib/auth-storage";
import { getSecurityPolicy, type SecurityPolicy } from "@/lib/security-api";

export default function LoginPage() {
  const router = useRouter();
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [policy, setPolicy] = useState<SecurityPolicy | null>(null);
  const [turnstileRequired, setTurnstileRequired] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
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
          void getSecurityPolicy().then(setPolicy).catch(() => undefined);
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
          <h1>账号登录</h1>
        </div>
        <form className="form-stack" onSubmit={handleSubmit}>
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
            <button className="button" disabled={isSubmitting} type="submit">
              {isSubmitting ? "登录中" : "登录"}
            </button>
            <Link className="button secondary" href="/register">
              注册账号
            </Link>
          </div>
        </form>
      </div>
      <AppToast message={error} onDismiss={() => setError("")} tone="error" />
    </section>
  );
}
