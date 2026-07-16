'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useRef, useState } from 'react';
import { AppToast } from '@/components/app-toast';
import { login } from '@/lib/auth-api';
import { saveAuthTokens } from '@/lib/auth-storage';

export default function LoginPage() {
  const router = useRouter();
  const [account, setAccount] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const isLeavingRef = useRef(false);

  function handleCancel() {
    isLeavingRef.current = true;
    const returnTo = new URLSearchParams(window.location.search).get('from');

    if (returnTo?.startsWith('/') && !returnTo.startsWith('//') && returnTo !== '/login') {
      router.push(returnTo);
      return;
    }

    router.push('/');
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    if (!account.trim() || !password) {
      setError('请输入账号和密码。');
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await login({ account, password });
      if (isLeavingRef.current) {
        return;
      }

      saveAuthTokens(response);
      router.push('/dashboard');
    } catch (loginError) {
      if (!isLeavingRef.current) {
        setError(loginError instanceof Error ? loginError.message : '登录失败，请稍后重试。');
      }
    } finally {
      if (!isLeavingRef.current) {
        setIsSubmitting(false);
      }
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
            <span>密码</span>
            <input
              autoComplete="current-password"
              name="password"
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              value={password}
            />
          </label>
          <div className="actions">
            <button className="button" disabled={isSubmitting} type="submit">
              {isSubmitting ? '登录中' : '登录'}
            </button>
            <Link className="button secondary" href="/register">
              注册账号
            </Link>
          </div>
        </form>
      </div>
      <AppToast message={error} onDismiss={() => setError('')} tone="error" />
    </section>
  );
}
